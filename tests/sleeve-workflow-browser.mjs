// Real Edge + compiled Astro pages + actual JWT boundary + disposable SQLite only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {dashboardPreview} from './helpers/admin-dashboard-preview.ts';
import {handleSleeveAdminRequest} from '../src/lib/sleeve-admin-api.ts';
import {handlePublicGameCollection} from '../src/lib/public-game-collection.ts';
import {createLocalGamesPreview} from '../scripts/lib/local-games-preview.ts';
import {getGames} from '../src/lib/games.ts';
import {writePhysicalComponent} from '../src/lib/physical-component-management.ts';

const out=process.argv[2];if(!out)throw new Error('An artifact directory is required');await mkdir(out,{recursive:true});
const f=await sleeveWorkflowFixture(),auth=await accessFixture();let server,browser,ws;
async function until(check,label){const end=Date.now()+15000;while(Date.now()<end){try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,70));}throw new Error('Timeout: '+label);}
try{
 const bindings={...auth.bindings,DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
 const preview=await dashboardPreview(bindings),publicPreview=await createLocalGamesPreview();
 const bundles={};for(const [name,entry]of Object.entries({'workflow':'src/lib/sleeve-workflow-controller.ts','sleeve-admin':'src/lib/sleeve-admin-controller.ts'}))bundles[name]=(await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
 const jwt=await auth.token();
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host),chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined});let response;
  if(url.pathname==='/api/admin/sleeves')response=await handleSleeveAdminRequest(request,bindings);
  else if(url.pathname.startsWith('/api/public/collection/'))response=await handlePublicGameCollection(request,bindings,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname==='/workflow.js'||url.pathname==='/sleeve-admin.js')response=new Response(bundles[url.pathname.slice(1,-3)],{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname==='/preview-games.js')response=new Response(publicPreview.javascript,{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname.startsWith('/admin')){
   const rendered=await preview(request),html=await rendered.text();
   response=new Response(html.replace('</body>',`<script src="/${url.pathname==='/admin/collection/1/sleeves'?'workflow':'sleeve-admin'}.js"></script></body>`),{status:rendered.status,headers:rendered.headers});
  }else {const html=await publicPreview.html(url);response=new Response(html??'Not found',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  const body=await response.text();assert.ok(!body.includes(f.secret),'signing key absent');
  const headers=new Headers(response.headers);headers.delete('Content-Length');
  res.writeHead(response.status,Object.fromEntries(headers));res.end(body);
 }catch(error){console.error(error);res.writeHead(500);res.end('Fixture error');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync',...(process.env.D1_A3_EDGE_LOCAL_TEST_MODE==='1'?['--no-sandbox']:[]),'--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0','--user-data-dir='+await mkdtemp(out+'/edge-'),'about:blank'],{windowsHide:true,stdio:'ignore'});
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
 async function goto(path){await send('Page.navigate',{url:origin+path});await text(path.includes('/collection/1/sleeves')?'[data-sleeve-workflow]':'h1',path.includes('/collection/1/sleeves')?(path.includes('lang=en')?'Requirements and assignments':'卡套需求'):path.includes('/games/')?'':path.includes('lang=en')?'Sleeve management':'卡套管理');}
 async function fill(selector,values){await evaluate((selector,values)=>{const form=document.querySelector(selector);for(let el=form.parentElement;el;el=el.parentElement)if(el instanceof HTMLDetailsElement)el.open=true;for(const [name,value]of Object.entries(values)){const input=form.elements.namedItem(name);if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}},selector,values);}
 async function submit(selector){const box=await evaluate(selector=>{const button=document.querySelector(selector+' button');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});}
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':jwt}});await width(1440);
 await goto('/admin/sleeves?view=requirements&lang=en');await evaluate(()=>document.querySelector('a[href*="/admin/collection/1/sleeves"]').click());await text('[data-sleeve-workflow]','Requirements and assignments');
 await goto('/admin/collection/1/sleeves?lang=en');
 const create='[data-workflow-action=requirement]';
 await fill(create,{sizeId:1,quantity:30,notes:'Browser cards',componentId:f.cardId});await submit(create);
 await until(()=>f.sqlite.prepare("SELECT id FROM v2_sleeve_requirements WHERE notes='Browser cards'").get(),'create requirement');
 const id=Number(f.sqlite.prepare("SELECT id FROM v2_sleeve_requirements WHERE notes='Browser cards'").get().id);
 await text('[data-workflow-status]','Saved.');
 const edit=`[data-requirement="${id}"] [data-workflow-action=requirement]`;
 await fill(edit,{notes:'Browser renamed cards'});await submit(edit);await text('[data-workflow-status]','Saved.');
 assert.equal(f.sqlite.prepare('SELECT assignment_revision FROM v2_sleeve_requirements WHERE id=?').get(id).assignment_revision,2);
 const form=copy=>`[data-requirement="${id}"] [data-copy="${copy}"] [data-workflow-action=apply]`;
 await fill(form(1),{productId:1,quantity:10,notPreviouslyRecorded:true});await submit(form(1));await text(`[data-requirement="${id}"] [data-copy="1"]`,'Partially applied');
 assert.equal(f.sqlite.prepare('SELECT SUM(quantity_sheets) n FROM v2_sleeve_inventory_transactions WHERE product_id=1').get().n,90);
 await fill(form(1),{productId:2,quantity:20,notPreviouslyRecorded:true});await submit(form(1));await text(`[data-requirement="${id}"] [data-copy="1"]`,'Complete');
 await fill(form(2),{productId:1,quantity:5,notPreviouslyRecorded:true});await submit(form(2));await text(`[data-requirement="${id}"] [data-copy="2"]`,'Partially applied');
 assert.equal(f.sqlite.prepare('SELECT SUM(quantity_sheets) n FROM v2_sleeve_inventory_transactions WHERE product_id=1').get().n,85);
 assert.equal(await evaluate(selector=>document.querySelector(selector)!==null,edit),false);
 assert.equal(await evaluate((tokenId)=>[...document.querySelectorAll('[name=componentId] option')].some(o=>Number(o.value)===tokenId),f.tokenId),false);
 console.log('PASS browser requirement create/edit, partial/multi-product/independent-copy applications, confirmation and exact stock deductions; locked edits and token exclusion');
 // A stale browser snapshot cannot overwrite the ledger.
 await fill(form(2),{productId:1,quantity:5,notPreviouslyRecorded:true});
 f.sqlite.exec("INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets) VALUES(1,'USE','2026-11-11',-1)");
 await submit(form(2));await text('[data-workflow-status]','Data changed');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_applications').get().n,3);
 console.log('PASS stale ledger error, no partial application or duplicate stock use');
 const layouts=[];
 for(const lang of ['en','zh-TW']){
  await goto('/admin/collection/1/sleeves?lang='+lang);
  for(const n of [1440,1024,768,375,320]){await width(n);const fits=await evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);layouts.push({lang,width:n,fits});assert.ok(fits,JSON.stringify(layouts.at(-1)));}
 }
 await writeFile(out+'/layouts.json',JSON.stringify(layouts,null,2));
 const shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(out+'/admin-mobile.png',Buffer.from(shot.data,'base64'));
 const game=getGames().find(g=>g.bggId===f.bggId);
 await goto('/en/games/'+game.slug);await text('[data-public-requirements-body]','Actual products used');await text('[data-public-requirements-body]','Product B');
 const publicText=await evaluate(()=>document.querySelector('[data-public-game-collection]').textContent);assert.ok(!publicText.includes('PRIVATE'));assert.ok(publicText.includes('Copy 1')&&publicText.includes('Copy 2'));
 await send('Network.setExtraHTTPHeaders',{headers:{}});
 assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/sleeves',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),401);
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':await auth.token({email:'viewer@example.test'})}});
 assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/sleeves',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),403);
 assert.deepEqual(jsErrors,[]);
 f.sqlite.exec(`
   INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES (3,500,700),(4,510,700);
   INSERT INTO v2_sleeve_requirements(collection_item_id,size_id,quantity_sheets) VALUES (1,3,10),(1,4,10),(1,2,200);
   INSERT INTO v2_sleeve_products(size_id,product_name,sheets_per_pack) VALUES (3,'No ledger',50);
 `);
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':jwt}});
 await goto('/admin/collection/1/sleeves?lang=en');
 await text('[data-sleeve-shortage=incomplete]','Data for this size is incomplete');
 await text('[data-sleeve-shortage=no_product]','No sleeve products for this size');
 await text('[data-sleeve-shortage=shortage]','Combined demand for this size across collections exceeds stock');
 console.log('PASS global stock hints do not change the existing workflow');
 const newCards=[];
 for(const [index,expected] of [4,8,1].entries()){
  const result=await writePhysicalComponent(f.db,f.secret,'fixture','browser-batch-card-'+index,
   {action:'create',collectionId:1,name:'Batch cards '+index,type:'card',unit:'card',expected,confirmed:true});
  newCards.push(result.id);
 }
 await writePhysicalComponent(f.db,f.secret,'fixture',null,
  {action:'count',definitionId:newCards[0],definitionRevision:1,copyId:1,revision:0,actual:6,countedOn:'2026-11-01'});
 f.sqlite.exec(`INSERT INTO v2_sleeve_requirements(collection_item_id,component_definition_id,size_id,quantity_sheets)
   VALUES (1,${newCards[0]},4,5),(1,${f.cardId},4,35),(1,${f.cardId},2,0);`);
 const mismatch=f.sqlite.prepare('SELECT id FROM v2_sleeve_requirements WHERE size_id=4 AND component_definition_id=?').get(f.cardId).id;
 await goto('/admin/collection/1/sleeves?lang=zh-TW');
 assert.equal(await evaluate(()=>document.querySelectorAll('[data-size-group][open]').length),0);
 assert.equal(await evaluate(()=>document.querySelectorAll('[data-size-group]').length),4);
 assert.equal(await evaluate(id=>{
  const row=document.querySelector(`[data-requirement="${id}"]`);
  row.closest('[data-size-group]').open=true;row.open=true;
  // The no-product notice and product link are shown once per size group, not on each requirement.
  return row.querySelector('[data-workflow-action=apply]')===null&&!!row.closest('[data-size-group]').querySelector(':scope > .group-notes a[href*="view=products"]');
 },mismatch),true);
 await text(`[data-requirement="${mismatch}"] [data-quantity-mismatch]`,'數量待核對（需求 35 張，清點 30）');
 const setFilter=value=>evaluate(value=>{
  const filter=document.querySelector('[data-workflow-filter]');filter.value=value;filter.dispatchEvent(new Event('change'));
 },value);
 await setFilter('complete');
 assert.equal(await evaluate(()=>document.querySelectorAll('[data-completion=pending]:not([hidden])').length),0);
 await goto('/admin/collection/1/sleeves?lang=zh-TW');
 await until(()=>evaluate(()=>document.querySelector('[data-workflow-filter]').value==='complete'),'persisted complete filter');
 await setFilter('pending');
 assert.equal(await evaluate(()=>document.querySelectorAll('[data-completion=complete]:not([hidden])').length),0);
 await setFilter('all');
 assert.deepEqual(await evaluate(selector=>{
  const top=document.querySelector(selector);
  const sizes=top.querySelector('[name=sizeId]');
  const ordered=[...sizes.options].filter(o=>o.value).map(o=>Number(o.value));
  const search=top.querySelector('[data-size-search]');search.value='45';search.dispatchEvent(new Event('input',{bubbles:true}));
  const found=[...sizes.options].filter(o=>o.value&&!o.hidden).map(o=>Number(o.value));
  return [ordered,found,sizes.value,sizes.querySelector('optgroup').label,sizes.querySelector('option[value="2"]').textContent.trim()];
 },create),[[2,3,4,1],[2],'','本收藏已使用的尺寸','45 × 68 mm（1 種產品）']);
 assert.equal(await evaluate((selector,card)=>{
  const form=document.querySelector(selector);
  const option=form.querySelector(`[name=componentId] option[value="${card}"]`);
  const initiallyHidden=option.hidden&&option.disabled;
  const toggle=form.querySelector('[data-show-all]');toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));
  return initiallyHidden&&!option.hidden&&!option.disabled&&option.textContent.includes('已有需求');
 },create,f.cardId),true);
 const batch='[data-workflow-action=requirements-batch]';
 await fill(batch,{sizeId:2,copyId:1});
 assert.deepEqual(await evaluate((selector,ids)=>{
  const form=document.querySelector(selector);
  const first=form.querySelector(`[data-batch-component="${ids[0]}"]`);
  const hidden=first.hidden;
  const toggle=form.querySelector('[data-show-all]');toggle.checked=true;toggle.dispatchEvent(new Event('change',{bubbles:true}));
  window.workflowPageMarker=true;
  const quantities=ids.map(id=>{
   const row=form.querySelector(`[data-batch-component="${id}"]`);
   const check=row.querySelector('[data-batch-select]');check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));
   return Number(row.querySelector('[data-batch-quantity]').value);
  });
  first.querySelector('[data-batch-quantity]').value='5';
  first.querySelector('[data-batch-quantity]').dispatchEvent(new Event('input',{bubbles:true}));
  return [hidden,quantities,form.querySelector('[data-batch-preview]').textContent];
 },batch,newCards),[true,[6,8,1],'45 × 68 mm · 3 筆 · 共 14 張']);
 await submit(batch);await text('[data-workflow-status]','已儲存。');
 assert.deepEqual(await evaluate(selector=>[
  window.workflowPageMarker,document.querySelector(selector+' [name=sizeId]').value,
  [...document.querySelectorAll('[data-size-group="2"] [data-requirement-component]')].filter(el=>el.textContent.includes('Batch cards')).length
 ],batch),[true,'2',3]);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_requirements WHERE source_key LIKE \'%:%\'').get().n,3);
 f.sqlite.exec(`INSERT INTO v2_sleeve_requirements(collection_item_id,size_id,quantity_sheets)
   VALUES (1,1,1),(1,1,2),(1,2,1),(1,2,2),(1,3,1),(1,3,2),(1,4,1),(1,4,2)`);
 await goto('/admin/collection/1/sleeves?lang=zh-TW');
 for(const n of [1280,375]){
  await width(n);
  assert.equal(await evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  if(n===1280)assert.equal(await evaluate(()=>[...document.querySelectorAll('[data-size-group] > summary')].every(el=>el.getBoundingClientRect().bottom<=innerHeight)),true);
  await evaluate(()=>{
   // The fixture omits the collection header's separate browser bundle.
   for(const img of document.querySelectorAll('.admin-detail-cover img'))if(!img.naturalWidth)img.hidden=true;
  });
  const {cssContentSize}=await send('Page.getLayoutMetrics');
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,
   clip:{x:0,y:0,width:n,height:cssContentSize.height,scale:1}});
  await writeFile(out+`/collection-sleeves-zh-${n}.png`,Buffer.from(shot.data,'base64'));
  await fill(batch,{sizeId:2,copyId:1});
  assert.equal(await evaluate(()=>{
   const button=document.querySelector('[data-workflow-action=requirements-batch] button');
   return button.getBoundingClientRect().height>=44&&document.documentElement.scrollWidth<=document.documentElement.clientWidth;
  }),true);
  await evaluate(()=>{document.querySelector('[data-workflow-action=requirements-batch]').closest('details').open=false;});
 }
 assert.deepEqual(jsErrors,[]);
 console.log('PASS collapsed groups, saved filters, size search/order, component toggle, count mismatch and in-place batch of three; Chinese 1280/375 screenshots');
 console.log('PASS bilingual five-width layouts, public actual products and privacy, unauthenticated/non-admin denied; no Wrangler or remote D1');
}finally{ws?.close();browser?.kill();if(server)await new Promise(r=>server.close(r));f.sqlite.close();auth.restore();}
