// Real Edge + compiled Astro pages + actual JWT boundary + disposable SQLite only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {dashboardPreview} from './helpers/admin-dashboard-preview.ts';
import {handlePurchaseAdminRequest} from '../src/lib/purchase-admin-api.ts';
import {handleCollectionCopiesRequest} from '../src/lib/collection-copies-api.ts';
import {handlePublicGameCollection} from '../src/lib/public-game-collection.ts';
import {createLocalGamesPreview} from '../scripts/lib/local-games-preview.ts';
import {getGames} from '../src/lib/games.ts';

const out=process.argv[2];if(!out)throw new Error('An artifact directory is required');await mkdir(out,{recursive:true});
const f=await sleeveWorkflowFixture(),auth=await accessFixture();let server,browser,ws;
async function until(check,label){const end=Date.now()+15000;while(Date.now()<end){try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,70));}throw new Error('Timeout: '+label);}
try{
 f.sqlite.exec("INSERT INTO v2_owned_copies(id,collection_item_id) VALUES(4,1)");
 const bindings={...auth.bindings,DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
 const preview=await dashboardPreview(bindings),publicPreview=await createLocalGamesPreview();
 const bundles={};for(const [name,entry]of Object.entries({'purchase':'src/lib/purchase-admin-controller.ts','copies':'src/lib/collection-copies-controller.ts'}))bundles[name]=(await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
 const jwt=await auth.token();
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host),chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request(url,{method:req.method,headers:req.headers,body:['POST','PATCH'].includes(req.method)?Buffer.concat(chunks):undefined});let response;
  if(url.pathname==='/api/admin/purchases')response=await handlePurchaseAdminRequest(request,bindings);
  else if(url.pathname.startsWith('/api/admin/collection/'))response=await handleCollectionCopiesRequest(request,bindings);
  else if(url.pathname.startsWith('/api/public/collection/'))response=await handlePublicGameCollection(request,bindings,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname==='/purchase.js'||url.pathname==='/copies.js')response=new Response(bundles[url.pathname.slice(1,-3)],{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname==='/preview-games.js')response=new Response(publicPreview.javascript,{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname.startsWith('/admin')){
   const rendered=await preview(request),html=await rendered.text();
   response=new Response(html.replace('</body>',`<script src="/${url.pathname.startsWith('/admin/purchases')?'purchase':'copies'}.js"></script></body>`),{status:rendered.status,headers:rendered.headers});
  }else {const html=await publicPreview.html(url);response=new Response(html??'Not found',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  const body=await response.text();assert.ok(!body.includes(f.secret),'signing key absent');
  const headers=new Headers(response.headers);headers.delete('Content-Length');
  res.writeHead(response.status,Object.fromEntries(headers));res.end(body);
 }catch(error){console.error(error);res.writeHead(500);res.end('Fixture error');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--proxy-server=http://127.0.0.1:9','--remote-debugging-port=0','--user-data-dir='+await mkdtemp(out+'/edge-'),'about:blank'],{windowsHide:true,stdio:'ignore'});
 // The last argument before about:blank is the isolated profile.
 const profile=browser.spawnargs.find(a=>a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
 const port=await until(async()=>Number((await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0]),'Edge debugging');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let serial=0;const pending=new Map(),jsErrors=[];
 ws.addEventListener('message',({data})=>{const reply=JSON.parse(data);if(reply.method==='Runtime.exceptionThrown')jsErrors.push(reply.params.exceptionDetails.text);if(reply.method==='Page.javascriptDialogOpening')void send('Page.handleJavaScriptDialog',{accept:true});pending.get(reply.id)?.(reply);});
 function send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},12000);pending.set(id,reply=>{pending.delete(id);clearTimeout(timer);reply.error?reject(new Error(reply.error.message)):resolve(reply.result);});ws.send(JSON.stringify({id,method,params}));});}
 async function evaluate(fn,...args){const r=await send('Runtime.evaluate',{expression:'('+fn.toString()+')(...'+JSON.stringify(args)+')',returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
 const text=(selector,expected)=>until(()=>evaluate((selector,expected)=>[...document.querySelectorAll(selector)].some(el=>el.textContent.includes(expected)),selector,expected),expected);
 const width=n=>send('Emulation.setDeviceMetricsOverride',{width:n,height:1000,mobile:false,deviceScaleFactor:1});
 async function goto(path){await send('Page.navigate',{url:origin+path});await text(path.includes('/copies')?'h2':'h1',path.includes('/purchases')?(path.includes('lang=en')?'Purchases':'採購'):path.includes('/copies')?(path.includes('lang=en')?'Collection copies, languages and editions':'收藏副本、語言與版本'):'');}
 async function fill(selector,values){await evaluate((selector,values)=>{const form=document.querySelector(selector);form.closest('details')?.setAttribute('open','');for(const [name,value]of Object.entries(values)){const input=form.querySelector('[name='+name+']');if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}},selector,values);}
 async function submit(selector){const box=await evaluate(selector=>{const button=document.querySelector(selector+' button:not([type=button])');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});}
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':jwt}});await width(1440);
 await goto('/admin/purchases?lang=en');await evaluate(()=>document.querySelector('a[href*="new=1"]').click());await until(()=>evaluate(()=>!!document.querySelector('[data-purchase-form]')),'new purchase form');
 const form='[data-purchase-form]';
 await fill(form,{date:'2026-11-12',merchant:'Browser merchant',reference:'PRIVATE_BROWSER_ORDER',currency:'TWD',status:'paid',shipping:1,method:'weighted',notes:'PRIVATE_BROWSER_NOTE'});
 await fill('[data-purchase-line]',{collectionId:1,description:'Cards',quantity:1,price:100});
 await evaluate(()=>document.querySelector('[data-add-line]').click());
 await fill('[data-purchase-line]:nth-child(2)',{collectionId:2,description:'Tokens',quantity:1,price:200});
 await text('[data-money-preview]','300 / 301 / 0');await submit(form);await text('[data-purchase-status]','Purchase saved.');
 const id=Number(f.sqlite.prepare("SELECT id FROM v2_purchase_orders WHERE order_reference='PRIVATE_BROWSER_ORDER'").get().id);
 assert.equal(f.sqlite.prepare('SELECT paid_minor FROM v2_purchase_order_reconciliation WHERE purchase_order_id=?').get(id).paid_minor,301);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies').get().n,4);
 await fill(form,{shipping:2,method:'manual'});await fill('[data-purchase-line]',{allocated:50});await fill('[data-purchase-line]:nth-child(2)',{allocated:100});await submit(form);await text('[data-purchase-status]','Purchase saved.');
 assert.equal(f.sqlite.prepare('SELECT unallocated_minor FROM v2_purchase_order_reconciliation WHERE purchase_order_id=?').get(id).unallocated_minor,152);
 await text('main','Allocation incomplete');
 console.log('PASS browser multi-item purchase creation, proportional rounding, edit, incomplete allocation and no automatic copies');
 await goto('/admin/purchases?new=1&lang=en');
 await fill(form,{date:'2026-11-12',merchant:'Browser merchant',currency:'USD',status:'paid',method:'direct'});await fill('[data-purchase-line]',{collectionId:1,description:'Second purchase',price:100,allocated:100});await submit(form);await text('[data-purchase-status]','Purchase saved.');
 await goto('/admin/purchases?year=2026&merchant=Browser&collection=1&lang=en');await text('main','TWD');await text('main','USD');
 console.log('PASS repeated collection purchase, independent currencies and year/merchant/collection filters');
 const condition='[data-copy-id="4"] [data-copy-action=condition]';
 await goto('/admin/collection/1/copies?lang=en');await fill(condition,{seal:'sealed',inspection:'unchecked',trade:'new',details:'PRIVATE_BROWSER_CONDITION'});
 await evaluate(selector=>{document.querySelector(selector+' [name=tags][value=sealed]').checked=true;},condition);await submit(condition);await text('[data-copy-status]','Copy saved.');
 await fill(condition,{seal:'unsealed',inspection:'checked',date:'2026-11-12',details:'PRIVATE_BROWSER_DAMAGE'});
 await evaluate(selector=>{document.querySelectorAll(selector+' [name=tags]').forEach(input=>input.checked=['missing_parts','moisture_damage'].includes(input.value));},condition);await submit(condition);await text('[data-copy-status]','Copy saved.');
 assert.equal(f.sqlite.prepare('SELECT inspection_status FROM v2_owned_copies WHERE id=4').get().inspection_status,'checked');
 assert.deepEqual(f.sqlite.prepare('SELECT condition_code FROM v2_copy_condition_tags WHERE owned_copy_id=4 ORDER BY condition_code').all().map(r=>r.condition_code),['missing_parts','moisture_damage']);
 const before=f.sqlite.prepare('SELECT actual_quantity FROM v2_copy_components ORDER BY id').all();
 await fill(condition,{details:'Stale attempt'});f.sqlite.exec('UPDATE v2_owned_copies SET condition_revision=condition_revision+1 WHERE id=4');await submit(condition);await text('[data-copy-status]','changed');
 assert.deepEqual(f.sqlite.prepare('SELECT actual_quantity FROM v2_copy_components ORDER BY id').all(),before);
 console.log('PASS sealed-to-inspected copy, missing/damaged tags, inspection date, stale revision and unchanged component counts');
 const layouts=[];
 for(const lang of ['en','zh-TW'])for(const path of ['/admin/purchases?new=1&lang=','/admin/collection/1/copies?lang=']){
  await goto(path+lang);await evaluate(()=>document.querySelectorAll('details').forEach(el=>el.open=true));
  for(const n of [1440,1024,768,375,320]){await width(n);const fits=await evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);layouts.push({lang,path,width:n,fits});assert.ok(fits,JSON.stringify(layouts.at(-1)));}
 }
 await writeFile(out+'/layouts.json',JSON.stringify(layouts,null,2));const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(out+'/copy-mobile.png',Buffer.from(shot.data,'base64'));
 await goto('/en/games/'+getGames().find(g=>g.bggId===f.bggId).slug);await text('[data-public-collection-body]','Copy records');assert.ok(!await evaluate(()=>document.querySelector('[data-public-game-collection]').textContent.includes('PRIVATE')));
 await send('Network.setExtraHTTPHeaders',{headers:{}});
 assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/purchases',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),401);
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':await auth.token({email:'viewer@example.test'})}});
 assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/purchases',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),403);
 assert.deepEqual(jsErrors,[]);console.log('PASS both languages / five widths / two admin pages, public privacy and denied unauthenticated / non-admin writes');
}finally{ws?.close();browser?.kill();if(server)await new Promise(r=>server.close(r));f.sqlite.close();auth.restore();}
