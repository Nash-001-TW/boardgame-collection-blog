// Real Edge + compiled Astro pages + actual JWT boundary + disposable SQLite only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {dashboardPreview} from './helpers/admin-dashboard-preview.ts';
import {handleBggAdminRequest} from '../src/lib/bgg-admin-api.ts';
import {handlePublicLiveRelations} from '../src/lib/public-live-relations.ts';
import {bggXml,seedBggRelations} from './helpers/bgg-sync-fixture.ts';
import {handleCollectionCopiesRequest} from '../src/lib/collection-copies-api.ts';
import {handlePublicGameCollection} from '../src/lib/public-game-collection.ts';
import {createLocalGamesPreview} from '../scripts/lib/local-games-preview.ts';
import {getGames} from '../src/lib/games.ts';

const out=process.argv[2];if(!out)throw new Error('An artifact directory is required');await mkdir(out,{recursive:true});
const f=await sleeveWorkflowFixture(),auth=await accessFixture();let server,browser,ws;
async function until(check,label){const end=Date.now()+15000;while(Date.now()<end){try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,70));}throw new Error('Timeout: '+label);}
try{
 seedBggRelations(f.sqlite);let fail=true;const bggToken=crypto.randomUUID()+crypto.randomUUID();
 const bindings={...auth.bindings,DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret,BGG_API_TOKEN:bggToken,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
 const preview=await dashboardPreview(bindings),publicPreview=await createLocalGamesPreview();
 const bundles={};for(const [name,entry]of Object.entries({'bgg':'src/lib/bgg-admin-controller.ts','copies':'src/lib/collection-copies-controller.ts'}))bundles[name]=(await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'iife'})).outputFiles[0].text;
 const jwt=await auth.token();
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host),chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request(url,{method:req.method,headers:req.headers,body:['POST','PATCH'].includes(req.method)?Buffer.concat(chunks):undefined});let response;
  if(url.pathname==='/api/admin/bgg')response=await handleBggAdminRequest(request,bindings,{sleep:async()=>{},fetcher:async url=>{const id=Number(new URL(String(url)).searchParams.get('id'));return fail&&id===900002?new Response('mock failure',{status:503}):new Response(bggXml(id));}});
  else if(url.pathname.startsWith('/api/public/relations/'))response=await handlePublicLiveRelations(request,f.db,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname.startsWith('/api/admin/collection/'))response=await handleCollectionCopiesRequest(request,bindings);
  else if(url.pathname.startsWith('/api/public/collection/'))response=await handlePublicGameCollection(request,bindings,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname==='/bgg.js'||url.pathname==='/copies.js')response=new Response(bundles[url.pathname.slice(1,-3)],{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname==='/preview-games.js')response=new Response(publicPreview.javascript,{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname.startsWith('/admin')){
   const rendered=await preview(request),html=await rendered.text();
   response=new Response(html.replace('</body>',`<script src="/${url.pathname.startsWith('/admin/bgg')?'bgg':'copies'}.js"></script></body>`),{status:rendered.status,headers:rendered.headers});
  }else {const html=await publicPreview.html(url);response=new Response(html??'Not found',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  const body=await response.text();assert.ok(!body.includes(f.secret),'signing key absent');assert.ok(!body.includes(bggToken),'BGG token absent');
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
 async function goto(path){const url=origin+path;await send('Page.navigate',{url});await until(()=>evaluate(url=>location.href===url&&document.readyState==='complete',url),path);await text('h1',path.includes('/admin/bgg')?(path.includes('lang=en')?'BGG sync':'BGG 同步'):'');}
 async function fill(selector,values){await evaluate((selector,values)=>{const form=document.querySelector(selector);form.closest('details')?.setAttribute('open','');for(const [name,value]of Object.entries(values)){const input=form.querySelector('[name='+name+']');if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}},selector,values);}
 async function submit(selector){const box=await evaluate(selector=>{const button=document.querySelector(selector+' button:not([type=button])');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});}
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':jwt}});await width(1440);
 await goto('/admin/bgg?lang=en');
 const sync='[data-bgg-action=sync]';await fill(sync,{ids:'900001,900002'});await submit(sync);await text('[data-bgg-status]','BGG 900002');
 assert.equal(f.sqlite.prepare('SELECT sync_status FROM bgg_games WHERE bgg_id=900001').get().sync_status,'success');assert.equal(f.sqlite.prepare('SELECT sync_status FROM bgg_games WHERE bgg_id=900002').get().sync_status,'failed');
 await goto('/admin/bgg?q=900002&lang=en');await text('article','BGG_HTTP_503');fail=false;await new Promise(r=>setTimeout(r,3100));
 await evaluate(()=>document.querySelector('[data-sync-id="900002"]').click());await text('[data-bgg-status]','Succeeded');
 await goto('/admin/bgg?q=Fixture&lang=en');await new Promise(r=>setTimeout(r,3100));
 await evaluate(()=>{document.querySelectorAll('[data-sync-select]').forEach(input=>input.checked=true);document.querySelector('[data-sync-selected]').click();});await text('[data-bgg-status]','BGG 900002');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM bgg_games WHERE last_success_at IS NOT NULL').get().n,2);
 console.log('PASS real browser mock batch sync, recorded failure, single retry and selected multi-sync; token absent from responses');
 await goto('/admin/bgg?view=relations&domain=game&lang=en');
 const create='[data-bgg-action=relation]';await fill(create,{sourceId:401,targetId:1,type:'other',notes:'PRIVATE_BROWSER_RELATION',confirmed:false});await submit(create);await text('[data-bgg-status]','Relation saved.');
 let id=Number(f.sqlite.prepare("SELECT id FROM v2_game_relations WHERE notes='PRIVATE_BROWSER_RELATION'").get().id);
 await goto('/en/games/'+getGames().find(g=>g.bggId===f.bggId).slug);
 await until(()=>evaluate(()=>{const body=document.querySelector('[data-live-relation-body]');return body&&!body.textContent.includes('Loading')&&!body.textContent.includes('could not');}),'public relations loaded');
 assert.equal(await evaluate(()=>[...document.querySelectorAll('[data-live-relation-body] a')].some(a=>a.href.endsWith('/900001'))),false);
 await goto('/admin/bgg?view=relations&domain=game&lang=en');
 await text('article h2','Base (BGG:900001)');
 const edit='article [data-bgg-action=relation]';await fill(edit,{confirmed:true});await submit(edit);await text('[data-bgg-status]','Relation saved.');
 assert.equal(f.sqlite.prepare('SELECT admin_revision FROM v2_game_relations WHERE id=?').get(id).admin_revision,2);
 await goto('/en/games/'+getGames().find(g=>g.bggId===f.bggId).slug);await text('[data-live-relation-body]','Admin');await text('[data-live-relation-body]','Base');
 assert.ok(!await evaluate(()=>document.querySelector('[data-live-relations]').textContent.includes('PRIVATE')));
 await goto('/admin/bgg?view=relations&domain=game&lang=en');await fill(create,{sourceId:401,targetId:401,type:'other'});await submit(create);await text('[data-bgg-status]','Could not complete');
 console.log('PASS game relation create/edit, pending excluded from public page, confirmed manual source shown and self relation rejected');
 const count=f.sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies').get().n;
 await goto('/admin/bgg?view=relations&domain=collection&lang=en');await fill(create,{sourceId:403,targetId:401,type:'bundle_contains',notes:'PRIVATE_COLLECTION_COMBO'});await submit(create);await text('[data-bgg-status]','Relation saved.');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies').get().n,count);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_collection_relations').get().n,1);
 console.log('PASS collection combination saved independently without creating copies or purchases');
 const collectionPath='/admin/bgg?view=relations&domain=collection';
 f.sqlite.exec(`INSERT INTO v2_collection_items(id,display_name,item_type,acquisition_status) VALUES(406,'Second accessory','accessory','owned');
 INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES(403,CURRENT_TIMESTAMP);`);
 await goto(collectionPath);
 await text('article h2','#403（已封存或找不到）');
 const collectionLink=await evaluate(()=>document.querySelector('[data-shell-sidebar] a[aria-current=page]').textContent.trim());
 assert.equal(collectionLink,'收藏組合');
 await goto('/admin/bgg?view=relations');
 assert.equal(await evaluate(()=>document.querySelector('[data-shell-sidebar] a[aria-current=page]').textContent.trim()),'遊戲關聯');
 await evaluate(()=>document.querySelector('[data-shell-sidebar] a[href="/admin/bgg?view=relations&domain=collection"]').click());
 await text('[data-shell-sidebar] a[aria-current=page]','收藏組合');
 await goto('/admin/collection/401?lang=en');
 const basicLink=await evaluate(()=>[...document.links].find(link=>link.textContent.trim()==='Manage collection relationships').getAttribute('href'));
 await goto(basicLink);
 const field=name=>evaluate(name=>document.querySelector('[data-new-collection-relation] [name='+name+']').value,name);
 assert.equal(await field('targetId'),'401');
 assert.equal(await field('sourceId'),'');
 assert.equal(await evaluate(()=>document.querySelector('select[name=source]').value),'401');
 await goto(collectionPath+'&source=402');
 assert.equal(await field('sourceId'),'402');
 assert.equal(await field('type'),'expansion_of');
 await goto(collectionPath+'&source=404');
 assert.equal(await field('sourceId'),'404');
 assert.equal(await field('type'),'accessory_for');
 await fill(create,{type:'same_series',sourceId:402});
 assert.equal(await field('type'),'same_series');
 await goto(collectionPath+'&source=401');
 for(const [source,type] of [[402,'expansion_of'],[404,'accessory_for'],[406,'accessory_for']]){
  assert.equal(await field('targetId'),'401');
  assert.equal(await field('sourceId'),'');
  await fill(create,{sourceId:source});
  assert.equal(await field('type'),type);
  await submit(create);
  await text('[data-bgg-status]','關聯已儲存。');
  assert.equal(f.sqlite.prepare('SELECT target_item_id FROM v2_collection_relations WHERE source_item_id=? AND relation_type=?').get(source,type).target_item_id,401);
 }
 assert.equal(await field('targetId'),'401');
 await text('article p','配件 → 適用遊戲 · 手動 · 已確認');
 await fill(create,{sourceId:401,targetId:402,type:'expansion_of'});
 await submit(create);
 await text('[data-bgg-status]','無法驗證關聯方向或角色');
 await goto(collectionPath+'&source=402');
 assert.equal(await evaluate(()=>document.querySelectorAll('article.bgg-panel').length),1);
 await evaluate(()=>{const filter=document.querySelector('select[name=source]');filter.value='';filter.form.requestSubmit();});
 await until(()=>evaluate(()=>document.querySelectorAll('article.bgg-panel').length===4),'all collection relations');
 await goto('/admin/collection/402/purchases?lang=en');
 const seriesLink=await evaluate(()=>[...document.querySelectorAll('[data-series-spending] a')].find(link=>link.textContent.trim()==='Manage collection relationships').getAttribute('href'));
 assert.equal(seriesLink,basicLink);
 await goto(seriesLink);
 assert.equal(await field('targetId'),'401');
 console.log('PASS bilingual relation labels, archived fallback, filters, collection entry defaults, three saves, direction rejection and series link');
 for(const [name,path,n] of [
  ['collection-zh-375',collectionPath,375],['collection-zh-1280',collectionPath,1280],
  ['collection-en-1280',collectionPath+'&lang=en',1280],['game-zh-1280','/admin/bgg?view=relations&domain=game',1280],
 ]){
  await width(n);await goto(path);
  await text('article h2',name.startsWith('game')?'BGG:900001':'Base copy');
  const shot=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(out+'/'+name+'.png',Buffer.from(shot.data,'base64'),{flag:'wx'});
 }
 const layouts=[];for(const lang of ['en','zh-TW'])for(const query of ['', '&view=relations&domain=game','&view=relations&domain=collection']){
  await goto('/admin/bgg?lang='+lang+query);await evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));
  for(const n of [1440,1280,1024,768,375,320]){await width(n);const fits=await evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);layouts.push({lang,query,width:n,fits});assert.ok(fits,JSON.stringify(layouts.at(-1)));}
 }
 await writeFile(out+'/layouts.json',JSON.stringify(layouts,null,2));let shot=await send('Page.captureScreenshot',{format:'png'});await writeFile(out+'/admin-mobile.png',Buffer.from(shot.data,'base64'));
 for(const prefix of ['','/en']){await goto(prefix+'/games/'+getGames().find(g=>g.bggId===f.bggId).slug);await text('[data-live-relation-body]',prefix?'Admin':'管理員');for(const n of [1440,375,320]){await width(n);assert.ok(await evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));}}
 await send('Network.setExtraHTTPHeaders',{headers:{}});assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/bgg',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),401);
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':await auth.token({email:'viewer@example.test'})}});assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/bgg',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),403);
 assert.deepEqual(jsErrors,[]);console.log('PASS bilingual responsive admin / public relations and authorization; no external BGG API or remote D1');
}finally{ws?.close();browser?.kill();if(server)await new Promise(r=>server.close(r));f.sqlite.close();auth.restore();}
