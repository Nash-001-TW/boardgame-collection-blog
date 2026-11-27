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
import {relationPageContext} from '../src/lib/relation-page-context.ts';
import {getGames} from '../src/lib/games.ts';
import {seedXrelB} from './helpers/xrel-b-fixture.ts';

const out=process.argv[2];if(!out)throw new Error('An artifact directory is required');await mkdir(out,{recursive:true});
const f=await sleeveWorkflowFixture(),auth=await accessFixture();let server,browser,ws;
async function until(check,label){const end=Date.now()+15000;while(Date.now()<end){try{const value=await check();if(value)return value;}catch{}await new Promise(r=>setTimeout(r,70));}throw new Error('Timeout: '+label);}
try{
 seedBggRelations(f.sqlite);let fail=true;const bggToken=crypto.randomUUID()+crypto.randomUUID();
 const bindings={...auth.bindings,DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret,BGG_API_TOKEN:bggToken,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
 const preview=await dashboardPreview(bindings),publicPreview=await createLocalGamesPreview();
 const bundles={};
 const options={bundle:true,write:false,platform:'browser',format:'iife'};
 for(const [name,entry] of Object.entries({bgg:'src/lib/bgg-admin-controller.ts',copies:'src/lib/collection-copies-controller.ts'})){
  bundles[name]=(await build({...options,entryPoints:[entry]})).outputFiles[0].text;
 }
 bundles.shell=(await build({...options,stdin:{
  contents:'import {connectAdminShell} from "./src/lib/admin-shell-controller.ts"; connectAdminShell();',
  resolveDir:process.cwd(),
 }})).outputFiles[0].text;
 const jwt=await auth.token();
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host),chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request(url,{method:req.method,headers:req.headers,body:['POST','PATCH'].includes(req.method)?Buffer.concat(chunks):undefined});let response;
  if(url.pathname==='/api/admin/bgg')response=await handleBggAdminRequest(request,bindings,{sleep:async()=>{},fetcher:async url=>{const id=Number(new URL(String(url)).searchParams.get('id'));return fail&&id===900002?new Response('mock failure',{status:503}):new Response(bggXml(id));}});
  else if(url.pathname.startsWith('/api/public/relations/'))response=await handlePublicLiveRelations(request,f.db,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname.startsWith('/api/admin/collection/'))response=await handleCollectionCopiesRequest(request,bindings);
  else if(url.pathname.startsWith('/api/public/collection/'))response=await handlePublicGameCollection(request,bindings,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname==='/bgg.js'||url.pathname==='/copies.js'||url.pathname==='/shell.js')response=new Response(bundles[url.pathname.slice(1,-3)],{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname==='/preview-games.js')response=new Response(publicPreview.javascript,{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname.startsWith('/admin')){
   const rendered=await preview(request),html=await rendered.text();
   response=new Response(html.replace('</body>',`<script src="/${url.pathname.startsWith('/admin/bgg')?'bgg':'copies'}.js"></script><script src="/shell.js"></script></body>`),{status:rendered.status,headers:rendered.headers});
  }else {const html=await publicPreview.html(url);response=new Response(html??'Not found',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8'}});}
  const body=await response.text();assert.ok(!body.includes(f.secret),'signing key absent');assert.ok(!body.includes(bggToken),'BGG token absent');
  const headers=new Headers(response.headers);headers.delete('Content-Length');
  res.writeHead(response.status,Object.fromEntries(headers));res.end(body);
 }catch(error){console.error(error);res.writeHead(500);res.end('Fixture error');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new',...(process.env.D1_A3_EDGE_LOCAL_TEST_MODE==='1'?['--no-sandbox']:[]),'--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--proxy-server=http://127.0.0.1:9','--remote-debugging-port=0','--user-data-dir='+await mkdtemp(out+'/edge-'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','inherit']});
 // The last argument before about:blank is the isolated profile.
 const profile=browser.spawnargs.find(a=>a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
 const port=await until(async()=>Number((await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0]),'Edge debugging');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let serial=0;const pending=new Map(),jsErrors=[];
 ws.addEventListener('message',({data})=>{const reply=JSON.parse(data);if(reply.method==='Runtime.exceptionThrown')jsErrors.push(reply.params.exceptionDetails.text);if(reply.method==='Page.javascriptDialogOpening'){jsErrors.push('Unexpected native dialog');void send('Page.handleJavaScriptDialog',{accept:false});}pending.get(reply.id)?.(reply);});
 function send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},12000);pending.set(id,reply=>{pending.delete(id);clearTimeout(timer);reply.error?reject(new Error(reply.error.message)):resolve(reply.result);});ws.send(JSON.stringify({id,method,params}));});}
 async function evaluate(fn,...args){const r=await send('Runtime.evaluate',{expression:'('+fn.toString()+')(...'+JSON.stringify(args)+')',returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
 const text=(selector,expected)=>until(()=>evaluate((selector,expected)=>[...document.querySelectorAll(selector)].some(el=>el.textContent.includes(expected)),selector,expected),expected);
 const width=n=>send('Emulation.setDeviceMetricsOverride',{width:n,height:1000,mobile:false,deviceScaleFactor:1});
 const ready=url=>until(()=>evaluate(url=>location.href===url&&document.readyState==='complete',url),url);
 async function goto(path){const url=origin+path;await send('Page.navigate',{url});await ready(url);}
 const click=selector=>evaluate(selector=>document.querySelector(selector).click(),selector);
 const create='[data-bgg-action=relation]';
 async function openEditor(id){
  if(id===undefined) await click('.relation-heading-actions [data-relation-open=relation-editor]');
  else {
   await click('[data-id="'+id+'"] summary');
   await click('[data-id="'+id+'"] [data-relation-edit]');
  }
  await until(()=>evaluate(()=>document.querySelector('#relation-editor').matches(':modal')),'editor dialog');
 }
 async function fill(selector,values){
  if(selector===create&&!await evaluate(()=>document.querySelector('#relation-editor').open))await openEditor();
  await evaluate((selector,values)=>{const form=document.querySelector(selector);for(const [name,value]of Object.entries(values)){const input=form.querySelector('[name='+name+']');if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}},selector,values);
 }
 async function shot(name){
  const image=await send('Page.captureScreenshot',{format:'png'});
  await writeFile(out+'/'+name+'.png',Buffer.from(image.data,'base64'),{flag:'wx'});
 }
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
 await fill(create,{sourceId:401,targetId:1,type:'other',notes:'PRIVATE_BROWSER_RELATION',confirmed:false});await submit(create);await text('[data-bgg-status]','Relation saved.');
 let id=Number(f.sqlite.prepare("SELECT id FROM v2_game_relations WHERE notes='PRIVATE_BROWSER_RELATION'").get().id);
 await goto('/en/games/'+getGames().find(g=>g.bggId===f.bggId).slug);
 await until(()=>evaluate(()=>{const body=document.querySelector('[data-live-relation-body]');return body&&!body.textContent.includes('Loading')&&!body.textContent.includes('could not');}),'public relations loaded');
 assert.equal(await evaluate(()=>[...document.querySelectorAll('[data-live-relation-body] a')].some(a=>a.href.endsWith('/900001'))),false);
 await goto('/admin/bgg?view=relations&domain=game&lang=en');
 await text('.relation-endpoints small','BGG:900001');
 await width(1280);await openEditor(id);await shot('game-en-edit-1280');await fill(create,{confirmed:true});await submit(create);await text('[data-bgg-status]','Relation saved.');
 assert.equal(f.sqlite.prepare('SELECT admin_revision FROM v2_game_relations WHERE id=?').get(id).admin_revision,2);
 await goto('/en/games/'+getGames().find(g=>g.bggId===f.bggId).slug);await text('[data-live-relation-body]','Admin');await text('[data-live-relation-body]','Base');
 assert.ok(!await evaluate(()=>document.querySelector('[data-live-relations]').textContent.includes('PRIVATE')));
 await goto('/admin/bgg?view=relations&domain=game&lang=en');await fill(create,{sourceId:401,targetId:401,type:'other'});await submit(create);await text('#relation-editor [role=alert]','INVALID_RELATION');
 assert.deepEqual(await evaluate(()=>Object.fromEntries(new FormData(document.querySelector('#relation-editor form')))),{
  domain:'game',id:'0',revision:'0',sourceId:'401',targetId:'401',type:'other',notes:'',
 });
 const rawId=f.sqlite.prepare("INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,relation_source) VALUES (403,405,'other','bgg') RETURNING id").get().id;
 await goto('/admin/bgg?view=relations&domain=game&lang=en');
 assert.equal(await evaluate(id=>document.querySelector('[data-id="'+id+'"][data-origin=bgg]').querySelector('button,summary'),rawId),null);
 f.sqlite.exec("INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,relation_source) VALUES (404,405,'other','manual')");
 const archiveId=f.sqlite.prepare('SELECT max(id) id FROM v2_game_relations').get().id;
 await goto('/admin/bgg?view=relations&domain=game&lang=en');
 await click('[data-id="'+archiveId+'"] summary');
 await click('[data-id="'+archiveId+'"] [data-relation-archive]');
 assert.equal(await evaluate(()=>document.querySelector('#relation-archive').matches(':modal')),true);
 await text('#relation-archive','history is retained');
 await click('#relation-archive [data-relation-close]');
 assert.equal(f.sqlite.prepare('SELECT archived_at FROM v2_game_relations WHERE id=?').get(archiveId).archived_at,null);
 await click('[data-id="'+archiveId+'"] [data-relation-archive]');
 await submit('[data-bgg-action=archive]');
 await text('[data-bgg-status]','Relation archived.');
 assert.ok(f.sqlite.prepare('SELECT archived_at FROM v2_game_relations WHERE id=?').get(archiveId).archived_at);
 console.log('PASS archive confirmation, cancel, archive and raw BGG row protection');
 console.log('PASS game relation create/edit, pending excluded from public page, confirmed manual source shown and self relation rejected');
 const count=f.sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies').get().n;
 await goto('/admin/bgg?view=relations&domain=collection&lang=en');await fill(create,{sourceId:403,targetId:401,type:'bundle_contains'});await submit(create);await text('[data-bgg-status]','Relation saved.');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies').get().n,count);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_collection_relations').get().n,1);
 console.log('PASS collection combination saved independently without creating copies or purchases');
 const collectionPath='/admin/bgg?view=relations&domain=collection';
 f.sqlite.exec(`INSERT INTO v2_collection_items(id,display_name,item_type,acquisition_status) VALUES(406,'Second accessory','accessory','owned');
 INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES(403,CURRENT_TIMESTAMP);`);
 await goto(collectionPath);
 await text('.relation-endpoints','#403（已封存或找不到）');
 const collectionLink=await evaluate(()=>document.querySelector('[data-shell-sidebar] a[aria-current=page]').textContent.trim());
 assert.equal(collectionLink,'收藏組合');
 await goto('/admin/bgg?view=relations');
 assert.equal(await evaluate(()=>document.querySelector('[data-shell-sidebar] a[aria-current=page]').textContent.trim()),'遊戲關聯');
 await evaluate(()=>document.querySelector('[data-shell-sidebar] a[href="/admin/bgg?view=relations&domain=collection"]').click());
 await text('[data-shell-sidebar] a[aria-current=page]','收藏組合');
 await goto('/admin/collection/401?lang=en');
 const basicLink=await evaluate(()=>[...document.links].find(link=>link.textContent.trim()==='Manage collection relationships').getAttribute('href'));
 await goto(basicLink);
 const field=async name=>{if(!await evaluate(()=>document.querySelector('#relation-editor').open))await openEditor();return evaluate(name=>document.querySelector('#relation-editor [name='+name+']').value,name);};
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
 await text('.relation-type','配件 → 適用遊戲');
 await fill(create,{sourceId:401,targetId:402,type:'expansion_of'});
 await submit(create);
 await text('#relation-editor [role=alert]','無法驗證關聯方向或角色');
 assert.equal(await field('sourceId'),'401');assert.equal(await field('targetId'),'402');
 await width(375);await shot('collection-zh-error-375');
 await click('#relation-editor [data-relation-swap]');
 assert.equal(await field('sourceId'),'402');assert.equal(await field('targetId'),'401');
 assert.equal(await field('type'),'expansion_of');
 await text('[data-relation-preview]','Expansion copy');
 await text('[data-relation-hint]','本體或獨立遊戲');
 await goto(collectionPath+'&source=402');
 assert.equal(await evaluate(()=>document.querySelectorAll('[data-relation-row]').length),1);
 await evaluate(()=>{const filter=document.querySelector('select[name=source]');filter.value='';filter.form.requestSubmit();});
 await until(()=>evaluate(()=>document.querySelectorAll('[data-relation-row]').length===4),'all collection relations');
 await goto('/admin/collection/402/purchases?lang=en');
 const seriesLink=await evaluate(()=>[...document.querySelectorAll('[data-series-spending] a')].find(link=>link.textContent.trim()==='Manage collection relationships').getAttribute('href'));
 assert.equal(seriesLink,basicLink);
 await goto(seriesLink);
 assert.equal(await field('targetId'),'401');
 console.log('PASS bilingual relation labels, archived fallback, filters, collection entry defaults, three saves, direction rejection and series link');
 f.sqlite.prepare('UPDATE v2_collection_items SET display_name=? WHERE id=406').run('LongName'.repeat(35));
 f.sqlite.exec('UPDATE v2_collection_relations SET id=9007199254740990 WHERE source_item_id=406');
 const gamePath='/admin/bgg?view=relations';
 const contexts=[
  {key:'cache',path:'/admin/bgg',active:'BGG 同步與快取',include:'最多 3 筆',exclude:'同一個資料範圍'},
  {key:'game',path:gamePath,active:'遊戲關聯',include:'Promo',exclude:'同一個資料範圍'},
  {key:'collection',path:collectionPath,active:'收藏組合',include:'同一個資料範圍',exclude:'Promo'},
 ];
 async function assertContext(entry){
  const expected=relationPageContext(new URL(origin+entry.path));
  const result=await evaluate(()=>({
   heading:document.querySelector('h1').textContent,
   title:document.title,
   breadcrumb:document.querySelector('[data-relation-breadcrumb]').textContent.trim(),
   active:document.querySelector('[data-shell-sidebar] a[aria-current=page]').textContent.trim(),
   pageLinks:document.querySelectorAll('main nav a').length,
  }));
  assert.equal(result.heading,expected.title);
  assert.ok(result.title.startsWith(expected.title+' | '));
  assert.equal(result.breadcrumb,expected.breadcrumb.join(' / '));
  assert.equal(result.active,entry.active);
  assert.ok(result.pageLinks<=2);
 }
 await width(1280);await goto(contexts[0].path);await assertContext(contexts[0]);
 for(const entry of contexts.slice(1)){
  await click('[data-shell-sidebar] a[href="'+entry.path+'"]');
  await ready(origin+entry.path);await assertContext(entry);
 }
 await send('Page.reload');await ready(origin+collectionPath);await assertContext(contexts[2]);
 const history=await send('Page.getNavigationHistory');
 for(const [offset,entry] of [[-1,contexts[1]],[0,contexts[2]]]){
  await send('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex+offset].id});
  await ready(origin+entry.path);await assertContext(entry);
 }
 console.log('PASS sidebar navigation, titles, breadcrumb, reload, Back and Forward');
 const layouts=[];
 for(const lang of ['zh-TW','en'])for(const entry of contexts){
  const path=entry.path+(lang==='en'?(entry.path.includes('?')?'&':'?')+'lang=en':'');
  await goto(path);
  if(lang==='zh-TW')await assertContext(entry);
  for(const n of [1280,375,320,360,390,414,430]){
   await width(n);
   const layout=await evaluate(()=>({
    fits:document.documentElement.scrollWidth<=document.documentElement.clientWidth,
    actions:[...document.querySelectorAll('.relation-actions summary')].every(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;}),
    toolbar:[...document.querySelectorAll('.relation-heading-actions button')].every(el=>el.getBoundingClientRect().right<=innerWidth),
   }));
   layouts.push({lang,context:entry.key,width:n,...layout});
   assert.ok(layout.fits&&layout.actions&&layout.toolbar,JSON.stringify(layouts.at(-1)));
   if(lang==='zh-TW'&&[1280,375].includes(n))await shot(entry.key+'-zh-'+n);
  }
  await click('[data-relation-open=relation-rules]');
  assert.equal(await evaluate(()=>document.querySelector('#relation-rules').matches(':modal')),true);
  if(lang==='zh-TW'){
   const rules=await evaluate(()=>document.querySelector('#relation-rules').textContent);
   assert.ok(rules.includes(entry.include)&&!rules.includes(entry.exclude),rules);
   if(entry.key==='collection'){await width(375);await shot('collection-zh-rules-375');}
  }
  await click('#relation-rules button');
 }
 await writeFile(out+'/layouts.json',JSON.stringify(layouts,null,2));
 await width(375);
 await goto(collectionPath);
 await click('[data-shell-open]');
 assert.equal(await evaluate(paths=>document.querySelector('[data-shell-drawer]').matches(':modal')&&paths.every(path=>document.querySelector('[data-shell-drawer] a[href="'+path+'"]')),contexts.map(entry=>entry.path)),true);
 await click('[data-shell-close]');
 assert.equal(await evaluate(()=>document.querySelector('[data-shell-drawer]').open),false);
 await goto(collectionPath+'&source=405');
 await text('[data-relation-empty]','沒有符合的關聯');
 await openEditor();
 await shot('collection-zh-add-375');
 const search='#relation-editor [data-relation-search]';
 await evaluate(selector=>{const field=document.querySelector(selector);field.value='Expansion copy';field.dispatchEvent(new Event('input',{bubbles:true}));},search);
 assert.deepEqual(await evaluate(()=>[...document.querySelector('#relation-editor [name=sourceId]').options].filter(o=>o.value&&!o.hidden&&!o.selected).map(o=>o.value)),['402']);
 console.log('PASS domain rules, mobile navigation, empty list, search and '+layouts.length+' responsive checks');
 for(const prefix of ['','/en']){await goto(prefix+'/games/'+getGames().find(g=>g.bggId===f.bggId).slug);await text('[data-live-relation-body]',prefix?'Admin':'管理員');for(const n of [1440,375,320]){await width(n);assert.ok(await evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));}}
 const screenshots=process.argv[3];
 if(screenshots){
  await mkdir(screenshots,{recursive:true});
  // Existing regressions above work on a separate set of identities.
  f.sqlite.exec("UPDATE v2_game_relations SET id=id+100 WHERE id>0");
  seedXrelB(f.sqlite);
  const path=gamePath+'&domain=game&source=231&lang=zh-TW';
  f.sqlite.prepare('UPDATE v2_games SET primary_name=? WHERE id=228').run('Tiny Epic Cthulhu: Cult of Chaos — Collector’s Edition ' + 'LongUnbrokenExpansionName'.repeat(2));
  await goto(path);
  assert.equal(await evaluate(()=>document.querySelector('[data-relation-origin-filter][aria-pressed=true]').value),'manual');
  const measurements=[];
  const activate=async selector=>{
   await evaluate(selector=>document.querySelector(selector).focus(),selector);
   await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
   await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  };
  for(const filter of ['manual','bgg','all']){
   if(filter!=='manual'){
    await activate('[data-relation-origin-filter][value='+filter+']');
    await until(()=>evaluate(value=>new URL(location.href).searchParams.get('origin')===value&&document.readyState==='complete',filter),'origin '+filter);
   }
   const observed=await evaluate(()=>[...document.querySelectorAll('[data-relation-row]')].map(row=>({
    id:row.dataset.id??null, origin:[...row.querySelectorAll('[data-source-badge]')].map(badge=>badge.textContent).join('＋'),
    actions:row.querySelectorAll('[data-relation-edit],[data-relation-archive]').length,
   })));
   const manual={id:'1',origin:filter==='all'?'BGG 原始＋手動':'手動',actions:2};
   const raw={id:null,origin:'BGG 原始',actions:0};
   assert.deepEqual(observed,filter==='manual'?[manual]:filter==='bgg'?[raw,raw]:[manual,raw]);
   for(const n of [1440,375,320]){
    await width(n);
    await evaluate(async()=>{
     window.scrollTo({top:0,behavior:'instant'});
     await document.fonts.ready;
     await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    });
    assert.ok(await evaluate(()=>scrollY===0&&document.documentElement.scrollWidth<=document.documentElement.clientWidth));
    const firstRowY=await evaluate(()=>document.querySelector('[data-relation-row]').getBoundingClientRect().top);
    measurements.push({filter,width:n,firstRowY});
    if(n<768){
     assert.ok(firstRowY>=0&&firstRowY<=300,JSON.stringify(measurements.at(-1)));
     assert.ok(await evaluate(()=>[...document.querySelectorAll('.relation-heading-actions button,.relation-actions summary,[data-relation-origin-filter],[data-relation-filter-toggle],.relation-filter-tags a')].every(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;})));
    }
    const image=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(screenshots+'/game-relations-'+filter+'-'+n+'.png',Buffer.from(image.data,'base64'));
   }
  }
  await writeFile(screenshots+'/admin-first-row-y.json',JSON.stringify(measurements,null,2));
  await send('Page.reload');
  await until(()=>evaluate(()=>document.readyState==='complete'&&document.querySelector('[data-relation-origin-filter][aria-pressed=true]')?.value==='all'),'reload origin');
  await text('.relation-filter-tags','全部關聯');
  await text('.relation-state','方向待確認');
  await text('.relation-state','方向已判定');
  assert.ok(await evaluate(()=>['規則說明','新增關聯'].every(name=>document.querySelector('.relation-heading-actions button[aria-label="'+name+'"]'))));
  await activate('[data-relation-filter-toggle]');
  assert.equal(await evaluate(()=>document.querySelector('[data-relation-filter-toggle]').getAttribute('aria-expanded')),'true');
  await activate('.relation-filter-tags a[aria-label^=移除資料來源]');
  await until(()=>evaluate(()=>document.querySelector('[data-relation-origin-filter][aria-pressed=true]')?.value==='manual'),'remove origin');
  await goto(path.replace('source=231','source=999999'));
  await text('[data-relation-empty]','沒有符合的關聯');

  const insert=f.sqlite.prepare("INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,archived_at) VALUES(?,231,'other',CURRENT_TIMESTAMP)");
  const game=f.sqlite.prepare("INSERT INTO v2_games(id,primary_name,game_type) VALUES(?,?,'base')");
  for(let i=0;i<21;i++){
   game.run(1000+i,'Page fixture '+i);
   insert.run(1000+i);
  }
  for(const filter of ['manual','all']){
   await goto(path+'&origin='+filter);
   await text('.game-relation-pagination',filter==='manual'?'第 1 頁':'第 1–20 筆，共 23 筆');
   await activate('.game-relation-pagination [rel=next]');
   await text('.game-relation-pagination',filter==='manual'?'第 2 頁':'第 21–23 筆，共 23 筆');
   await activate('.game-relation-pagination [rel=prev]');
   await text('.game-relation-pagination',filter==='manual'?'第 1 頁':'第 1–20 筆，共 23 筆');
  }
  const links=Array.from({length:21},(_,i)=>({id:510000+i,name:'BGG page fixture '+i}));
  f.sqlite.prepare("UPDATE bgg_games SET cache_json=json_set(cache_json,'$.implementations',json(?)) WHERE bgg_id=404893").run(JSON.stringify(links));
  await goto(path+'&origin=bgg');
  await text('.game-relation-pagination','第 1–20 筆，共 23 筆');
  await activate('.game-relation-pagination [rel=next]');
  await text('.game-relation-pagination','第 21–23 筆，共 23 筆');
  await activate('.game-relation-pagination [rel=prev]');
  await text('.game-relation-pagination','第 1–20 筆，共 23 筆');
  console.log('PASS B-UI mobile row position, touch targets, keyboard, removable filters and multi-page pagination');
  f.sqlite.exec("UPDATE bgg_games SET cache_json='invalid fixture JSON' WHERE bgg_id=404893");
  await goto(path+'&origin=all');
  await text('main [role=alert]','無法載入資料');
  assert.equal(await evaluate(()=>document.querySelector('[data-relation-empty]')),null);
  console.log('PASS XREL-B origin switching, read-only controls, read error and nine responsive screenshots');
 }
 await send('Network.setExtraHTTPHeaders',{headers:{}});assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/bgg',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),401);
 await send('Network.setExtraHTTPHeaders',{headers:{'Cf-Access-Jwt-Assertion':await auth.token({email:'viewer@example.test'})}});assert.equal(await evaluate(async()=>{const r=await fetch('/api/admin/bgg',{method:'POST',headers:{'Content-Type':'application/json','X-NotBGG-Request':'1'},body:'{}'});return r.status;}),403);
 assert.deepEqual(jsErrors,[]);console.log('PASS bilingual responsive admin / public relations and authorization; no external BGG API or remote D1');
}finally{ws?.close();browser?.kill();if(server)await new Promise(r=>server.close(r));f.sqlite.close();auth.restore();}
