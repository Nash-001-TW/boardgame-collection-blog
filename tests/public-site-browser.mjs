// Real Edge + compiled Astro pages + actual JWT boundary + disposable SQLite only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {publicSitePreview} from './helpers/public-site-preview.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {syncBggBatch} from '../src/lib/bgg-sync-admin.ts';
import {publicSitemap} from '../src/lib/public-sitemap.ts';
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
 seedBggRelations(f.sqlite);const bggToken=crypto.randomUUID()+crypto.randomUUID();let version=1,fail=false;
 const custom=(await new NotBggRepository(f.db).create({name:'Browser NotBGG 非 BGG 遊戲',type:'boardgame',description:'Public description',editorNotes:'PRIVATE_EDITOR_NOTES'},{actor:'fixture',idempotencyKey:'browser-public-profile'})).game;
 const insert=f.sqlite.prepare("INSERT INTO v2_collection_items(id,game_id,display_name,acquisition_status,wishlist,notes) VALUES(?,1,?,'owned',1,'PRIVATE_PRICE')");for(let i=0;i<45;i++)insert.run(1000+i,'Browser record '+String(i).padStart(2,'0'));
 const sync=async(ids)=>{f.sqlite.exec('UPDATE v2_bgg_sync_gate SET next_allowed=0');return syncBggBatch(f.db,bggToken,'fixture',crypto.randomUUID(),ids,{sleep:async()=>{},fetcher:async url=>fail?new Response('mock unavailable',{status:503}):new Response(bggXml(Number(new URL(String(url)).searchParams.get('id'))).replace(/Fixture \d+/,version===1?'Live Browser 新遊戲 長名稱測試 Long Game Name':'Live Browser Updated'))});};
 await sync([f.bggId,900001,900999]);
 const bindings={DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret};
 const preview=await publicSitePreview(bindings);
 const jwt=await auth.token();
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://'+req.headers.host),chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request(url,{method:req.method,headers:req.headers,body:['POST','PATCH'].includes(req.method)?Buffer.concat(chunks):undefined});let response;
  if(url.pathname==='/public-site.js')response=new Response(preview.javascript,{headers:{'Content-Type':'text/javascript'}});
  else if(url.pathname.startsWith('/api/public/collection/'))response=await handlePublicGameCollection(request,bindings,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname.startsWith('/api/public/relations/'))response=await handlePublicLiveRelations(request,bindings.DB,decodeURIComponent(url.pathname.split('/').at(-1)));
  else if(url.pathname==='/api/admin/auth-check')response=Response.json({success:false},{status:401});
  else if(url.pathname==='/sitemap.xml')response=await publicSitemap(bindings.DB,url.origin);
  else response=await preview.render(request);
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
 let serial=0,lastStatus=0;const pending=new Map(),jsErrors=[];
 ws.addEventListener('message',({data})=>{const reply=JSON.parse(data);if(reply.method==='Network.responseReceived'&&reply.params.type==='Document')lastStatus=reply.params.response.status;if(reply.method==='Runtime.exceptionThrown')jsErrors.push(reply.params.exceptionDetails.text);if(reply.method==='Page.javascriptDialogOpening')void send('Page.handleJavaScriptDialog',{accept:true});pending.get(reply.id)?.(reply);});
 function send(method,params={}){const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},12000);pending.set(id,reply=>{pending.delete(id);clearTimeout(timer);reply.error?reject(new Error(reply.error.message)):resolve(reply.result);});ws.send(JSON.stringify({id,method,params}));});}
 async function evaluate(fn,...args){const r=await send('Runtime.evaluate',{expression:'('+fn.toString()+')(...'+JSON.stringify(args)+')',returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
 const text=(selector,expected)=>until(()=>evaluate((selector,expected)=>[...document.querySelectorAll(selector)].some(el=>el.textContent.includes(expected)),selector,expected),expected);
 const width=n=>send('Emulation.setDeviceMetricsOverride',{width:n,height:1000,mobile:false,deviceScaleFactor:1});
 async function goto(path){await send('Page.navigate',{url:origin+path});await until(()=>evaluate(()=>!!document.querySelector('h1')),'page heading');}
 async function fill(selector,values){await evaluate((selector,values)=>{const form=document.querySelector(selector);form.closest('details')?.setAttribute('open','');for(const [name,value]of Object.entries(values)){const input=form.querySelector('[name='+name+']');if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));}},selector,values);}
 async function submit(selector){const box=await evaluate(selector=>{const button=document.querySelector(selector+' button:not([type=button])');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};},selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...box});}
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await width(1440);
 await goto('/en');await text('[data-public-home]','Public collection overview');assert.equal(lastStatus,200);assert.ok(!await evaluate(()=>document.body.textContent.includes('PRIVATE')));
 await goto('/en/games');const filters='.public-filters';await fill(filters,{q:'Live Browser',source:'bgg',sort:'year',players:2});await submit(filters);await text('[data-public-browse]','Live Browser');
 assert.equal(await evaluate(()=>document.querySelectorAll('[data-public-card]').length),2);assert.ok(await evaluate(()=>location.search.includes('q=Live+Browser')));
 await until(()=>evaluate(()=>[...document.querySelectorAll('.public-cover span')].some(el=>el.textContent.includes('unavailable'))),'broken cover fallback');
 await evaluate(()=>document.querySelector('.public-advanced summary').click());await fill(filters,{time:'31-60',weight:'2-3',mechanic:'Mechanic',view:'list'});await submit(filters);await until(()=>evaluate(()=>new URL(location.href).searchParams.get('view')==='list'&&document.querySelector('.public-card-grid')?.dataset.view==='list'),'list view loaded');assert.equal(await evaluate(()=>document.querySelectorAll('[data-public-card]').length),2);
 await goto('/en/collection?q=Browser+record&status=wishlist');assert.equal(await evaluate(()=>document.querySelectorAll('[data-public-card]').length),20);
 await evaluate(()=>document.querySelector('a[rel=next]').click());await until(()=>evaluate(()=>new URL(location.href).searchParams.get('page')==='2'),'next page');await text('[data-public-browse]','Browser record 20');
 await evaluate(()=>document.querySelector('[data-public-detail-link]').click());await text('h1','Live Browser');await until(()=>evaluate(()=>[...document.querySelectorAll('[data-detail-back]')].some(a=>a.href.includes('page=2'))),'return URL');
 await evaluate(()=>document.querySelector('[data-detail-back]').click());await text('[data-public-browse]','Browser record 20');assert.ok(await evaluate(()=>location.search.includes('status=wishlist')&&location.search.includes('page=2')));
 await evaluate(()=>document.querySelector('[data-language-switch][lang="zh-TW"]').click());await text('h1','我的收藏');assert.ok(await evaluate(()=>location.search.includes('page=2')&&location.search.includes('q=Browser')));
 console.log('PASS home overview, server search/filter/sort/pagination, broken-image fallback, detail return and language state');
 await goto('/en/games/bgg/900001');await text('h1','Live Browser');assert.equal(lastStatus,200);assert.ok(await evaluate(()=>document.querySelector('link[rel=canonical]').href.endsWith('/en/games/bgg/900001')));
 version=2;await sync([900001]);await send('Page.reload');await text('h1','Live Browser Updated');
 fail=true;await sync([900001]);await send('Page.reload');await text('h1','Live Browser Updated');fail=false;
 await goto('/en/games/bgg/900999');await text('h1','Game not found');assert.equal(lastStatus,404);
 const liveDb=bindings.DB;bindings.DB={prepare:()=>{throw new Error('PRIVATE_DATABASE_FAILURE');}};
 await goto('/en/games/bgg/900001');await text('h1','Game data unavailable');assert.equal(lastStatus,503);assert.ok(!await evaluate(()=>document.body.textContent.includes('PRIVATE_DATABASE_FAILURE')));
 bindings.DB=liveDb;await evaluate(()=>document.querySelector('.public-notice a').click());await text('h1','Live Browser Updated');
 console.log('PASS newly synchronized route without rebuild, immediate updates, last-success preservation and distinct 404 / 503 with retry');
 const layouts=[];
 for(const prefix of ['','/en'])for(const path of ['', '/games?q=Live+Browser&view=list','/collection?q=Browser+record','/games/bgg/900001','/games/notbgg/'+custom.notBggId.slice(7)]){
  await goto((prefix||'')+(path||'/'));if(path.includes('/games/bgg/'))await text('h1','Live Browser Updated');if(path.includes('/notbgg/'))await text('h1','Browser NotBGG');
  await evaluate(()=>document.querySelectorAll('.public-advanced').forEach(details=>details.open=true));
  for(const n of [1440,1024,768,375,320]){await width(n);const fits=await evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);layouts.push({prefix,path,width:n,fits});assert.ok(fits,JSON.stringify(layouts.at(-1)));}
 }
 await writeFile(out+'/layouts.json',JSON.stringify(layouts,null,2));let image=await send('Page.captureScreenshot',{format:'png'});await writeFile(out+'/notbgg-mobile.png',Buffer.from(image.data,'base64'));
 await goto('/en/games?q=Live+Browser');await width(375);await evaluate(()=>document.querySelector('.cat-mobile-menu summary').click());assert.ok(await evaluate(()=>document.querySelector('.cat-mobile-menu').open));await evaluate(()=>document.querySelector('.cat-mobile-menu summary').click());
 await fill(filters,{q:'not-a-real-game-name'});await submit(filters);await text('.public-notice','No matching records');assert.equal(lastStatus,200);
 await goto('/en/games/bgg/900001');await width(320);await until(()=>evaluate(()=>document.querySelector('[data-public-requirements-body]')?.textContent.includes('No managed')),'sleeve empty state');
 assert.ok(!await evaluate(()=>document.body.textContent.includes('PRIVATE')));image=await send('Page.captureScreenshot',{format:'png'});await writeFile(out+'/bgg-mobile.png',Buffer.from(image.data,'base64'));
 const xml=await(await fetch(origin+'/sitemap.xml')).text();assert.ok(xml.includes('<sitemapindex'));assert.ok(!xml.includes('/admin'));
 assert.deepEqual(jsErrors,[]);console.log('PASS bilingual five-width checks for home / catalog / collection / BGG / NotBGG, mobile menu and forms, sleeve / relation blocks, SEO and privacy');
}finally{ws?.close();browser?.kill();if(server)await new Promise(r=>server.close(r));f.sqlite.close();auth.restore();}
