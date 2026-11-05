// B-4.3C/B-4.4/B-4.5 current-cache UI regression; external requests blocked, no data writes.
// All non-loopback requests are intercepted; covers are labelled synthetic images.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
const output=process.argv[2];const results=[];const onlyFailedCase=process.argv.includes('--case=b43c');
const b44=process.argv.includes('--batch=b44'),b45=process.argv.includes('--batch=b45'),onlyBatch=process.argv.includes('--case=batch');
const c1=process.argv.includes('--case=c1'),c1Relations=process.argv.includes('--case=c1-relations');
const c1Catalog=process.argv.includes('--case=c1-catalog');
const c3=process.argv.includes('--case=c3');
const c2=process.argv.includes('--case=c2');
const c2Focused=process.argv.includes('--case=c2-focused');
const expectedCatalogCount=Object.keys(require('../src/data/bgg-cache.json')).length;
let browser,server,client,profile;let activeCase='SETUP',stage='SETUP',currentId=null,language=null;
class CDP{
 constructor(ws){this.ws=ws;this.pending=new Map();this.next=0;this.events=new Map();ws.addEventListener('message',e=>{
  const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error('CDP_REJECTED')):p.resolve(m.result);}}
  else for(const fn of this.events.get(m.method)||[])fn(m.params);
 });}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.next;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP_TIMEOUT'));},15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
 on(event,fn){this.events.set(event,[...(this.events.get(event)||[]),fn]);}
 async eval(expression){const result=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error('BROWSER_EVALUATION_FAILED');return result.result.value;}
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function check(name,fn){
 if(onlyFailedCase&&!name.startsWith('B43C '))return;
 if(c1Relations&&!name.startsWith('C1 relations'))return;
 if(c1Catalog&&!name.startsWith('C1 catalog'))return;
 if(c3&&!/^(C3 |C1 relations|Arkham 117|no browser runtime exceptions)/.test(name))return;
 if(c2&&!/^(C2 |catalog total|players\/time|real zero|mobile Grid|Base Expansion|C1 catalog|no browser runtime exceptions)/.test(name))return;
 if(c2Focused&&!/^(C2 |no browser runtime exceptions)/.test(name))return;
 if(c1&&!/^(catalog total|players\/time|real zero|Arkham 117|mobile Grid|both-language|Base Expansion|C1 |no browser runtime exceptions)/.test(name))return;
 if(onlyBatch&&!/^(catalog total|Base Expansion|Arkham 117|B4[45] |no browser runtime exceptions)/.test(name))return;
 activeCase=name;stage=name;await fn();results.push({name,status:'PASS'});
}
(async()=>{

 const {createLocalGamesPreview}=await import('../scripts/lib/local-games-preview.ts');const preview=await createLocalGamesPreview();
  const {build}=require('esbuild');
 const collectionBundle=await build({entryPoints:['src/lib/game-list-controller.ts'],bundle:true,write:false,format:'iife',globalName:'CollectionController',platform:'browser'});
 const collectionScript=collectionBundle.outputFiles[0].text+'\nCollectionController.initializeGameListController({root:document.querySelector("[data-game-browser]"),pageSize:2,debounceMs:10});';
 const select=(attr,values)=>`<select ${attr}>${values.map(v=>`<option value="${v}">${v||'Any'}</option>`).join('')}</select>`;
 const collectionFixture=()=>`<!doctype html><html lang="zh-TW"><body><section data-game-browser data-browser-module="collection" data-locale="zh-TW">
 <input data-game-search><select data-game-sort><option value="name-asc">Name</option><option value="year-desc">Year</option></select><button data-game-reset>Reset</button>
 ${['all','owned','wishlist'].map(v=>`<button data-game-filter="${v}">${v}</button>`).join('')}
 ${select('data-game-players',['','2'])}${select('data-game-time',['','60'])}${select('data-game-weight',['','2-3'])}${select('data-game-mechanic',[''])}
 <button data-tag-chip data-tag-kind="category" data-tag-id="20">Category</button><p data-game-result-count></p><div data-game-grid>
 ${Array.from({length:7},(_,i)=>`<article data-game-card data-name="遊戲 ${i}" data-year="${2020+i}" data-owned="true" data-wishlist="${i<4}" data-mechanics="10" data-mechanic-names="Drafting" data-categories="20" data-min-players="1" data-max-players="4" data-max-time="60" data-weight="2.5"><a href="/games/bgg-205637">Game ${i}</a></article>`).join('')}
 </div><nav data-game-pagination></nav></section><script src="/collection-controller.js"></script></body></html>`;
 server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/preview-games.js'){res.setHeader('Content-Type','text/javascript');res.end(preview.javascript);return;}
    if(url.pathname==='/collection-controller.js'){res.setHeader('Content-Type','text/javascript');res.end(collectionScript);return;}
  if(/^\/(en\/)?collection$/.test(url.pathname)){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(collectionFixture());return;}
 let html=await preview.html(url);
  if(html && url.pathname==='/games' && url.searchParams.has('complexityFixture')){
   html=html.replace(/(<script type="application\/json"[^>]*>)([\s\S]*?)(<\/script>)/,(all,start,json,end)=>{
    const payload=JSON.parse(json);const seed=payload.records[0];
    const values=[undefined,null,0,-1,NaN,Infinity,5.01,0.99,1,2,3,4,5,2.75];
    payload.records=values.map((value,index)=>({...seed,href:'',dataset:{...seed.dataset,bggId:String(9000000+index),name:'Complexity fixture '+String(index).padStart(2,'0'),itemType:'base',weight:value==null?'':String(value)}}));
    return start+JSON.stringify(payload).replaceAll('<','\\u003c')+end;
   });
  }
  res.statusCode=html?200:404;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html||'Not found');
 }catch{res.statusCode=500;res.end('LOCAL_PREVIEW_FAILED');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 profile=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'bgg-b43c-browser-'));const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync',
  '--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
 ],{windowsHide:true,stdio:'ignore',env});
 let port;for(let n=0;n<100;n++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await pause(100);}}
 if(!port)throw new Error('BROWSER_START_FAILED');
 const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});client=new CDP(ws);
 const errors=[];client.on('Runtime.exceptionThrown',()=>errors.push('BROWSER_SCRIPT_EXCEPTION'));
 await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 let externalBlocked=0,syntheticCovers=0;
 client.on('Fetch.requestPaused',async e=>{try{
  if(e.request.url.startsWith(origin+'/'))await client.send('Fetch.continueRequest',{requestId:e.requestId});
  else if(e.resourceType==='Image'){syntheticCovers++;await client.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'}],body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="440"><rect width="320" height="440" fill="#355f7b"/><text x="24" y="100" fill="white" font-size="21">OFFLINE TEST COVER</text><text x="24" y="140" fill="white" font-size="17">Synthetic image</text></svg>').toString('base64')});}
  else{externalBlocked++;await client.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'BlockedByClient'});}
 }catch{errors.push('INTERCEPT_FAILED');}});
 await client.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.__nativeIntersectionObserver=window.IntersectionObserver;window.IntersectionObserver=undefined;if(location.search.includes("autoFixture=1"))window.IntersectionObserver=window.__nativeIntersectionObserver;'});
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const viewport=async(width,height)=>client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
 await viewport(1440,1000);
 const wait=async(expr)=>{for(let n=0;n<160;n++){if(await client.eval(expr))return;await pause(50);}throw new Error('UI_WAIT_FAILED');};
 const goto=async(route,detail=false)=>{await client.send('Page.navigate',{url:origin+route});await wait(`location.pathname===${JSON.stringify(route.split('?')[0])} && document.querySelector(${JSON.stringify(detail?'[data-detail-v2][data-ready="true"]':'[data-game-browser][data-initialized="true"]')})!==null`);};
 const click=async selector=>client.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const input=async(selector,value)=>client.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 const screenshot=async()=>{}; // Successful runs intentionally keep no screenshots.
 await check(`catalog total ${expectedCatalogCount}, Grid/List and initial 24 DOM`,async()=>{
  await goto('/games?filter=all');await wait(`document.querySelectorAll('[data-game-card]').length===24`);
  assert.equal(Number((await client.eval(`document.querySelector('[data-game-result-count]').textContent`)).replace(/\D/g,'')),expectedCatalogCount);
  await click('[data-game-view="list"]');assert.equal(await client.eval(`document.querySelector('[data-game-browser]').dataset.view`),'list');
  await click('[data-game-view="grid"]');assert.equal(await client.eval(`document.querySelector('[data-game-browser]').dataset.view`),'grid');
 });
 await check('three new games searchable by ID and classified as expansion',async()=>{
  for(const id of [226690,233977,237424]){await input('[data-game-search]',String(id));await wait(`document.querySelectorAll('[data-game-card]').length===1 && document.querySelector('[data-game-card]').dataset.bggId==='${id}'`);assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.itemType`),'expansion');}
 });
 await check('players/time/weight combination filters; unknown zero excluded from weight ranges',async()=>{
  await goto('/games?q=233977&filter=expansion&players=2&time=61-120&weight=3-4');await wait(`document.querySelectorAll('[data-game-card]').length===1`);
  await input('[data-game-players]','6plus');assert.equal(await client.eval(`document.querySelectorAll('[data-game-card]').length`),1);
  await goto('/games?q=226690&filter=expansion&weight=1-2');await wait(`document.querySelectorAll('[data-game-card]').length===0`);
 });
 await check('new detail pages, raw image fields, safe relation roles and local base links',async()=>{
  const cache=JSON.parse(await fs.readFile('src/data/bgg-cache.json','utf8'));
  for(const id of [226690,233977,237424]){
   await goto(`/games/bgg-${id}`,true);
   assert.equal(await client.eval(`document.querySelector('[data-cover-open] img').getAttribute('src')`),cache[id].image);
   assert.equal(await client.eval(`document.querySelector('[data-relation-id="205637"] small').textContent`),'本體');
   assert.equal(await client.eval(`document.querySelector('[data-relation-id="205637"] a').getAttribute('href')`),'/games/bgg-205637');
   assert.doesNotMatch(await client.eval(`document.querySelector('[data-detail-relations]').textContent`),/inbound|derived|explicit|directionStatus|directionBasis/);
   assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);
  }
 });
 const quality=[];
 await check('real zero-weight detail shows dash without a classification hint',async()=>{
  await goto('/games/bgg-226690',true);quality.push({id:226690,quickStat:await client.eval(`Array.from(document.querySelectorAll('.quick-stats>div')).at(-1).textContent`)});
  assert.equal(await client.eval(`document.querySelector('.quick-stats>div:last-child strong').textContent`),'—');assert.equal(await client.eval(`document.querySelectorAll('.quick-stats>div:last-child small').length`),0);
  await screenshot('desktop-new-game.png');
  await viewport(375,812);assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);await screenshot('mobile-new-game.png');await viewport(1440,1000);
 });
 await check('Arkham 117/116/1, initial 20, load more 40 and no duplicates',async()=>{
  await goto('/games/bgg-205637',true);assert.match(await client.eval(`document.querySelector('[data-relation-filter="all"]').textContent`),/117/);
  assert.match(await client.eval(`document.querySelector('[data-relation-filter="expansions"]').textContent`),/116/);assert.match(await client.eval(`document.querySelector('[data-relation-filter="implementations"]').textContent`),/1/);
  assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),20);await click('[data-relation-more]');assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),40);
  assert.equal(await client.eval(`new Set(Array.from(document.querySelectorAll('[data-relation-list]>li')).map(n=>n.dataset.relationId)).size`),40);
  for(const name of ['Marie Lambeau','Labyrinths of Lunacy','Jenny Barnes']){await input('[data-relation-search]',name);assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),1);assert.equal(await client.eval(`document.querySelector('[data-relation-list] small').textContent`),'擴充');}
  await input('[data-relation-search]','');await click('[data-relation-filter="implementations"]');assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),1);await click('[data-relation-filter="all"]');
  await screenshot('desktop-arkham-relations.png');await viewport(375,812);assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);await screenshot('mobile-arkham.png');await viewport(1440,1000);
 });
 await check('mobile Grid/List and navigation back restores query, batch and scroll',async()=>{
  await viewport(375,812);await goto('/games?q=Arkham&filter=all&view=list&page=2');await wait(`document.querySelectorAll('[data-game-card]').length===48`);
  assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);await screenshot('mobile-list.png');await click('[data-game-view="grid"]');await screenshot('mobile-grid.png');
  await viewport(1440,1000);await goto('/games?q=Arkham&filter=all&view=list&page=2');await wait(`document.querySelectorAll('[data-game-card]').length===48`);
  await client.eval(`scrollTo(0,600)`);await pause(200);const saved=await client.eval(`({url:location.href,y:scrollY})`);
  await click('[data-game-grid] a[href]');await wait(`document.querySelector('[data-detail-v2][data-ready="true"]')!==null`);await click('[data-detail-back]');await wait(`location.href===${JSON.stringify(saved.url)} && document.querySelectorAll('[data-game-card]').length===48`);
  await wait(`Math.abs(scrollY-${saved.y})<180`);
 });

 await check('both-language missing complexity and valid score formatting',async()=>{
  for(const prefix of ['', '/en']){
   await goto(`${prefix}/games/bgg-226690`,true);
   assert.equal(await client.eval(`document.querySelector('.quick-stats>div:last-child strong').textContent`),'—');assert.equal(await client.eval(`document.querySelectorAll('.quick-stats>div:last-child small').length`),0);
   await goto(`${prefix}/games/bgg-233977`,true);
   assert.equal(await client.eval(`document.querySelector('.quick-stats>div:last-child strong').textContent`),'3.56 / 5');assert.equal(await client.eval(`document.querySelectorAll('.quick-stats>div:last-child small').length`),1);
  }
 });
 await check('synthetic invalid rating matrix: all missing last in sorting, excluded from every valid filter',async()=>{
  await goto('/games?filter=all&sort=weight-desc&complexityFixture=1');
  await wait(`document.querySelectorAll('[data-game-card]').length===14`);
  const ids=()=>client.eval(`Array.from(document.querySelectorAll('[data-game-card]')).map(c=>Number(c.dataset.bggId))`);
  assert.deepEqual(await ids(),[9000012,9000011,9000010,9000013,9000009,9000008,9000000,9000001,9000002,9000003,9000004,9000005,9000006,9000007]);
  for(const [filter,expected] of [['1-2',[9000008]],['2-3',[9000013,9000009]],['3-4',[9000010]],['4-5',[9000012,9000011]]]){
   await input('[data-game-weight]',filter);await wait(`document.querySelectorAll('[data-game-card]').length===${expected.length}`);assert.deepEqual(await ids(),expected);
  }
  await input('[data-game-weight]','');await wait(`document.querySelectorAll('[data-game-card]').length===14`);
  await click('[data-game-view="list"]');assert.equal(await client.eval(`document.querySelector('[data-game-browser]').dataset.view`),'list');assert.equal((await ids()).length,14);
 });

 await check('all ten authorized games: search, type, details, roles, links and B3D missing values',async()=>{
  const batch=[279196,284354,295594,298128,301760,309374,316188,317014,318833,326045];
  const cache=JSON.parse(await fs.readFile('src/data/bgg-cache.json','utf8'));
  const {translateGameName}=await import('../src/i18n/utils.ts');
  for(const id of batch){
   await goto(`/games?q=${id}`);await wait(`document.querySelectorAll('[data-game-card]').length===1`);
   assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.bggId`),String(id));
   assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.itemType`),'expansion');
   const valid=Number.isFinite(cache[id].averageWeight)&&cache[id].averageWeight>=1&&cache[id].averageWeight<=5;
   assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.weight`),valid?String(cache[id].averageWeight):'');
   await click('[data-game-view="list"]');assert.equal(await client.eval(`document.querySelector('[data-game-browser]').dataset.view`),'list');
   for(const prefix of ['', '/en']){
    await goto(`${prefix}/games/bgg-${id}`,true);
    assert.equal(await client.eval(`document.querySelector('h1').textContent`),translateGameName(id,cache[id].name,prefix?'en':'zh-TW'));
    assert.equal(await client.eval(`document.querySelector('[data-cover-open] img').getAttribute('src')`),cache[id].image);
    assert.equal(await client.eval(`document.querySelector('[data-relation-id="205637"] small').textContent`),prefix?'Base game':'本體');
    assert.equal(await client.eval(`document.querySelector('[data-relation-id="205637"] a').getAttribute('href')`),`${prefix}/games/bgg-205637`);
    assert.doesNotMatch(await client.eval(`document.querySelector('[data-detail-relations]').textContent`),/inbound|derived|explicit|directionStatus|directionBasis/);
    const value=await client.eval(`document.querySelector('.quick-stats>div:last-child strong').textContent`);
    assert.equal(value,valid?`${cache[id].averageWeight.toFixed(2)} / 5`:'—');
    assert.equal(await client.eval(`document.querySelectorAll('.quick-stats>div:last-child small').length`),valid?1:0);
    if(cache[id].maxPlayTime===0)assert.equal(await client.eval(`document.querySelectorAll('.quick-stats>div')[2].querySelector('strong').textContent`),'—');
    const links=await client.eval(`Array.from(document.querySelectorAll('[data-relation-list] a')).map(a=>({href:a.getAttribute('href'),rel:a.getAttribute('rel'),target:a.getAttribute('target')}))`);
    for(const link of links){if(link.href.startsWith('https://boardgamegeek.com/')){assert.equal(link.target,'_blank');assert.match(link.rel,/noopener/);assert.match(link.rel,/noreferrer/);}else assert.ok(link.href.startsWith(prefix+'/games/'));}
   }
   await goto('/games/bgg-205637',true);await input('[data-relation-search]',String(''));
   await input('[data-relation-search]',cache[id].name.replaceAll('&#039;',"'"));
   assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),1);
   assert.equal(await client.eval(`document.querySelector('[data-relation-list]>li').dataset.relationId`),String(id));
   assert.equal(await client.eval(`document.querySelector('[data-relation-list] small').textContent`),'擴充');
   assert.equal(await client.eval(`document.querySelector('[data-relation-list] a').getAttribute('href')`),`/games/bgg-${id}`);
  }
  await goto('/games?q=252897');await wait(`document.querySelectorAll('[data-game-card]').length===1`);
  assert.ok((await client.eval(`document.querySelector('[data-game-card] h2').textContent`)).includes("Night's Usurper"));
  await viewport(375,812);await goto('/games/bgg-295594',true);assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);await screenshot('mobile-new-barkham.png');
  await viewport(1440,1000);await goto('/games/bgg-301760',true);await screenshot('desktop-new-beta-2019.png');
 });

 await check('Base Expansion Accessory categories use the complete current dataset',async()=>{
  const cache=JSON.parse(await fs.readFile('src/data/bgg-cache.json','utf8'));
  for(const [filter,type] of [['base','boardgame'],['expansion','boardgameexpansion'],['accessory','boardgameaccessory']]){
   const expected=Object.values(cache).filter(g=>g.gameType===type).length;
   await goto('/games?filter='+filter);
   await wait(`document.querySelectorAll('[data-game-card]').length===${Math.min(24,expected)}`);
   assert.equal(Number((await client.eval(`document.querySelector('[data-game-result-count]').textContent`)).replace(/\D/g,'')),expected);
   assert.equal(await client.eval(`Array.from(document.querySelectorAll('[data-game-card]')).every(c=>c.dataset.itemType===${JSON.stringify(filter)})`),true);
  }
 });
  await check('collection shared controller: URL restore, filters, history and reset, synthetic records only',async()=>{
  await goto('/collection?filter=owned&sort=year-desc&page=2&source=friend');
  assert.equal(await client.eval(`document.querySelector('[data-game-sort]').value`),'year-desc');
  assert.equal(await client.eval(`document.querySelectorAll('[data-game-card]').length`),2);
  await click('[data-game-filter="wishlist"]');await wait(`location.search.includes('filter=wishlist')`);
  assert.equal(await client.eval(`new URL(location.href).searchParams.has('page')`),false);
  await client.eval(`history.back()`);await wait(`document.querySelector('[data-game-filter="owned"]').getAttribute('aria-pressed')==='true'`);
  await client.eval(`history.forward()`);await wait(`document.querySelector('[data-game-filter="wishlist"]').getAttribute('aria-pressed')==='true'`);
  await input('[data-game-search]','not-present');await wait(`document.querySelectorAll('[data-game-card]').length===0`);
  await click('[data-game-reset]');await wait(`document.querySelectorAll('[data-game-card]').length===2`);
  assert.equal(await client.eval(`new URL(location.href).search`),'?source=friend');
  await viewport(375,812);assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);
 });
  await check('sleeve selector preserves independent size rounding for 50, 100 and 200',async()=>{
  await goto('/games/frosthaven',true);
  assert.ok(await client.eval(`document.querySelectorAll('[data-sleeve-count]').length>0`));
  for(const pack of ['50','100','200']){
   await input('[data-sleeve-pack-size]',pack);
   const proof=await client.eval(`(()=>{const rows=Array.from(document.querySelectorAll('[data-sleeve-count]'));return {actual:rows.map(r=>Number(r.querySelector('[data-sleeve-packs]').textContent.replace(/,/g,''))),expected:rows.map(r=>Math.ceil(Number(r.dataset.sleeveCount)/${Number(pack)})),total:Number(document.querySelector('[data-sleeve-total-packs]').textContent.replace(/,/g,''))};})()`);
   assert.deepEqual(proof.actual,proof.expected);assert.equal(proof.total,proof.expected.reduce((n,x)=>n+x,0));
  }
 });
  await check(b45?'B45 final ten imported games and unchanged bilingual core version links':b44?'B44 ten imported games and unchanged bilingual core version links':'B43C nine imported games and bilingual conservative Implementation links',async()=>{
  const cache=JSON.parse(await fs.readFile('src/data/bgg-cache.json','utf8'));
  const {getGames}=await import('../src/lib/games.ts');
  const {detailRelations}=await import('../src/lib/detail-relations.ts');
  const {translateGameName}=await import('../src/i18n/utils.ts');
  const catalog=getGames(),root=catalog.find(game=>game.bggId===205637),rootRows=detailRelations(root,catalog,'zh-TW');
  const batch=b45?[405997,414602,414695,415432,420615,424487,428491,429274,432297,439466,359609]:b44?[377055,377056,379286,382509,382510,391772,394077,397102,405995,405996,359609]:[347147,347148,347149,348234,354504,358212,358213,359609,369493];
  for(const id of batch){
   currentId=id;stage='CATALOG_SEARCH';const game=catalog.find(game=>game.bggId===id),kind=id===359609?'implementations':'expansions';
   await goto('/games?q='+id);await wait(`document.querySelectorAll('[data-game-card]').length===1`);
   assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.bggId`),String(id));
   const type={boardgame:'base',boardgameexpansion:'expansion',boardgameaccessory:'accessory'}[cache[id].gameType]||'unknown';
   assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.itemType`),type);
   for(const prefix of ['', '/en']){
    language=prefix||'zh-TW';stage='DETAIL_OPEN';await goto(`${prefix}/games/${game.slug}`,true);
    stage='DETAIL_TITLE';assert.equal(await client.eval(`document.querySelector('h1').textContent`),translateGameName(id,cache[id].name,prefix?'en':'zh-TW'));
    stage='DETAIL_BGG_ID';assert.equal(await client.eval(`document.querySelector('a[href="https://boardgamegeek.com/boardgame/${id}"]')!==null`),true);
    stage='DETAIL_MISSING_VALUES';assert.doesNotMatch(await client.eval(`document.querySelector('[data-detail-v2]').innerText`),/\bundefined\b/);
    // Relations are deliberately rendered in batches of 20. Filter through the UI
    // before asserting a target that may not be in the initial batch (Revised Core).
    stage='DETAIL_RELATION_FILTER';await click(`[data-relation-filter="${kind}"]`);
    await wait(`document.querySelector('[data-relation-id="205637"] a')!==null`);
    stage='DETAIL_BASE_LINK';assert.equal(await client.eval(`document.querySelector('[data-relation-id="205637"] a').getAttribute('href')`),`${prefix}/games/${root.slug}`);
    stage='DETAIL_ROLE';assert.equal(await client.eval(`document.querySelector('[data-relation-id="205637"] small').textContent`),kind==='implementations'?(prefix?'Version relation':'版本關聯'):(prefix?'Base game':'本體'));
   }
   const query=rootRows.find(row=>row.id===id).name;
   stage='ROOT_RELATION_SEARCH';await goto(`/games/${root.slug}`,true);await input('[data-relation-search]',query);
   await wait(`document.querySelectorAll('[data-relation-id="${id}"]').length===1`);
   const matches=await client.eval(`Array.from(document.querySelectorAll('[data-relation-list]>li')).map(row=>({id:Number(row.dataset.relationId),name:row.querySelector('strong').textContent}))`);
   const expectedMatches=rootRows.filter(row=>row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
   assert.equal(matches.length,Math.min(20,expectedMatches.length));
   assert.deepEqual(matches.map(row=>row.id).sort((a,b)=>a-b),expectedMatches.slice(0,20).map(row=>row.id).sort((a,b)=>a-b));
   assert.equal(new Set(matches.map(row=>row.id)).size,matches.length);
   assert.ok(matches.every(row=>row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
   assert.equal(await client.eval(`document.querySelector('[data-relation-id="${id}"]').dataset.relationId`),String(id));
   assert.equal(await client.eval(`document.querySelector('[data-relation-id="${id}"] a').getAttribute('href')`),`/games/${game.slug}`);
   assert.equal(await client.eval(`document.querySelector('[data-relation-id="${id}"] small').textContent`),kind==='implementations'?'版本關聯':'擴充');
  }
  const revised=catalog.find(game=>game.bggId===359609);
  await viewport(375,812);await goto(`/games/${revised.slug}`,true);
  assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);
  await screenshot('mobile-revised-core-set.png');await viewport(1440,1000);await screenshot('desktop-revised-core-set.png');
 });
 await check('C1 relations: numeric identity, initial image failure and all 117 local targets',async()=>{
  await goto('/games/bgg-205637',true);
  assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),20);
  await input('[data-relation-search]','359609');
  await wait(`document.querySelectorAll('[data-relation-list]>li').length===1`);
  assert.equal(await client.eval(`document.querySelector('[data-relation-list]>li').dataset.relationId`),'359609');
  assert.equal(await client.eval(`document.querySelector('[data-relation-list] .relation-id').textContent`),'BGG #359609');
  assert.equal(await client.eval(`document.querySelector('[data-relation-list] small').textContent`),'版本關聯');
  await goto('/games/bgg-359609',true);await input('[data-relation-search]','#205637');
  await wait(`document.querySelectorAll('[data-relation-list]>li').length===1`);
  assert.equal(await client.eval(`document.querySelector('[data-relation-list] a').getAttribute('href')`),'/games/bgg-205637');
  assert.equal(await client.eval(`document.querySelector('[data-relation-list] small').textContent`),'版本關聯');
  await goto('/games/bgg-205637',true);
  const firstImage=await client.eval(`(()=>{const img=document.querySelector('[data-relation-list] img');const id=img.closest('li').dataset.relationId;img.dispatchEvent(new Event('error'));return id;})()`);
  assert.equal(await client.eval(`document.querySelector('[data-relation-id="${firstImage}"] img')===null && document.querySelector('[data-relation-id="${firstImage}"] .relation-placeholder')!==null`),true);
  while(await client.eval(`!document.querySelector('[data-relation-more]').hidden`))await click('[data-relation-more]');
  const all=await client.eval(`Array.from(document.querySelectorAll('[data-relation-list]>li')).map(row=>({id:Number(row.dataset.relationId),href:row.querySelector('a').getAttribute('href'),idLabel:row.querySelector('.relation-id').textContent}))`);
  const cache=JSON.parse(await fs.readFile('src/data/bgg-cache.json','utf8'));
  const targets=[...new Set([...cache['205637'].expansions,...cache['205637'].implementations,...cache['205637'].compilations].map(link=>link.id))];
  assert.equal(all.length,117);assert.equal(new Set(all.map(row=>row.id)).size,117);
  assert.deepEqual(all.map(row=>row.id).sort((a,b)=>a-b),targets.sort((a,b)=>a-b));
  assert.ok(all.every(row=>row.href.startsWith('/games/')&&row.idLabel===`BGG #${row.id}`));
  await goto('/en/games/bgg-205637',true);await input('[data-relation-search]','359609');
  await wait(`document.querySelectorAll('[data-relation-list]>li').length===1`);
  assert.equal(await client.eval(`document.querySelector('[data-relation-list] a').getAttribute('href')`),'/en/games/bgg-359609');
  assert.equal(await client.eval(`document.querySelector('[data-relation-list] small').textContent`),'Version relation');
 });
 await check('C1 catalog: real auto-load and complete sorted 815-record batches',async()=>{
  await viewport(1280,600);await goto('/games?filter=all&autoFixture=1');
  await wait(`document.querySelectorAll('[data-game-card]').length===24`);
  assert.equal(await client.eval(`typeof IntersectionObserver`),'function');
  assert.ok(await client.eval(`document.querySelectorAll('[data-game-card] img').length<=24`));
  await client.eval(`window.scrollTo(0,document.documentElement.scrollHeight)`);
  await wait(`document.querySelectorAll('[data-game-card]').length>24`);
  await client.eval(`window.scrollTo(0,0)`);
  const autoCount=await client.eval(`document.querySelectorAll('[data-game-card]').length`);
  for(let batch=0;batch<40;batch++){
   const previous=await client.eval(`document.querySelectorAll('[data-game-card]').length`);
   if(previous===815)break;
   await click('[data-load-more]');
   await wait(`document.querySelectorAll('[data-game-card]').length>${previous}`);
  }
  const actual=await client.eval(`Array.from(document.querySelectorAll('[data-game-card]')).map(card=>Number(card.dataset.bggId))`);
  const {getGames}=await import('../src/lib/games.ts');const {buildCatalogPayload}=await import('../src/lib/catalog-payload.ts');
  const names=buildCatalogPayload(getGames(),'zh-TW').records.map(record=>({id:Number(record.dataset.bggId),name:record.dataset.name}));
  const expected=await client.eval(`(()=>{const compare=new Intl.Collator('zh-TW',{numeric:true,sensitivity:'base'});return ${JSON.stringify(names)}.sort((a,b)=>compare.compare(a.name,b.name)||a.id-b.id).map(row=>row.id);})()`);
  assert.equal(actual.length,815);assert.equal(new Set(actual).size,815);assert.deepEqual(actual,expected);
  stage='C1_ALL_LOADED_BUTTON_DISABLED';
  assert.equal(await client.eval(`document.querySelector('[data-load-more]').disabled`),true);
  await input('[data-game-search]','__c1_no_matching_game__');await wait(`document.querySelectorAll('[data-game-card]').length===0`);
  assert.match(await client.eval(`document.querySelector('[data-load-status]').textContent`),/沒有符合條件/);
  await input('[data-game-search]','359609');await wait(`document.querySelectorAll('[data-game-card]').length===1`);
  assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.bggId`),'359609');
  console.log(JSON.stringify({initialCards:24,autoLoadedCards:autoCount,completeCards:actual.length,uniqueCards:new Set(actual).size}));
  await viewport(1440,1000);
 });
 await check('C1 detail: base, expansion, accessory, source metadata and responsive missing values',async()=>{
  const {getGames}=await import('../src/lib/games.ts');const {translateGameName}=await import('../src/i18n/utils.ts');
  const {decodeGameName}=await import('../src/lib/game-name.ts');const catalog=getGames();
  for(const id of [295770,327293,448621,226690])for(const prefix of ['', '/en']){
   const game=catalog.find(game=>game.bggId===id);await goto(`${prefix}/games/${game.slug}`,true);
   assert.equal(await client.eval(`document.querySelector('h1').textContent`),translateGameName(id,game.bgg.name,prefix?'en':'zh-TW'));
   assert.equal(await client.eval(`document.querySelector('a[href="https://boardgamegeek.com/boardgame/${id}"]')!==null`),true);
   assert.doesNotMatch(await client.eval(`document.querySelector('[data-detail-v2]').innerText`),/\b(?:undefined|NaN)\b/);
   if(game.bgg.families.length){
    const family=await client.eval(`Array.from(document.querySelectorAll('.metadata>div')).find(row=>row.querySelector('dt').textContent===${JSON.stringify(prefix?'BGG families':'BGG 家族分類')})?.querySelector('dd').textContent`);
    for(const item of game.bgg.families)assert.ok(family.includes(decodeGameName(item.name)));
   }
   await viewport(375,812);assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);await viewport(1440,1000);
  }
 });
 await check('C3 relation navigation restores per-entry filters, batch and scroll',async()=>{
  for(const prefix of ['', '/en']){
  await viewport(prefix?375:1440,prefix?812:1000);await goto(`${prefix}/games/bgg-205637`,true);
  await click('[data-relation-filter="expansions"]');await input('[data-relation-search]','Arkham');
  await click('[data-relation-more]');
  stage='C3_SCROLL_BEFORE_NAVIGATION';
  await client.eval(`document.querySelector('[data-detail-relations]').scrollIntoView({behavior:'instant'});document.querySelector('[data-relation-list]').scrollTop=280`);
  await wait(`scrollY>0&&document.querySelector('[data-relation-list]').scrollTop>0`);
  const before=await client.eval(`({count:document.querySelectorAll('[data-relation-list]>li').length,y:scrollY,listY:document.querySelector('[data-relation-list]').scrollTop})`);
  assert.equal(before.count,40);assert.ok(before.y>0);assert.ok(before.listY>0);
  const target=await client.eval(`document.querySelector('[data-relation-list] a').getAttribute('href')`);
  await click('[data-relation-list] a');await wait(`location.pathname===${JSON.stringify(target)}&&document.querySelector('[data-detail-v2][data-ready]')!==null`);
  await client.eval(`history.back()`);await wait(`location.pathname===${JSON.stringify(prefix+'/games/bgg-205637')}&&document.querySelector('[data-detail-relations][data-ready]')!==null`);
  stage='C3_BACK_RESTORED';
  await wait(`document.querySelectorAll('[data-relation-list]>li').length===40`);
  assert.equal(await client.eval(`document.querySelector('[data-relation-search]').value`),'Arkham');
  assert.equal(await client.eval(`document.querySelector('[data-relation-filter="expansions"]').getAttribute('aria-pressed')`),'true');
  await wait(`Math.abs(scrollY-${before.y})<5&&Math.abs(document.querySelector('[data-relation-list]').scrollTop-${before.listY})<5`);
  stage='C3_RELOAD_WITHOUT_BFCACHE';
  await client.send('Page.reload',{ignoreCache:true});
  await wait(`document.querySelector('[data-detail-relations][data-ready]')!==null&&document.querySelectorAll('[data-relation-list]>li').length===40`);
  assert.equal(await client.eval(`document.querySelector('[data-relation-search]').value`),'Arkham');
  assert.equal(await client.eval(`document.querySelector('[data-relation-filter="expansions"]').getAttribute('aria-pressed')`),'true');
  await wait(`Math.abs(scrollY-${before.y})<5&&Math.abs(document.querySelector('[data-relation-list]').scrollTop-${before.listY})<5`);
  await client.eval(`history.forward()`);await wait(`location.pathname===${JSON.stringify(target)}&&document.querySelector('[data-detail-v2][data-ready]')!==null`);
  assert.equal(await client.eval(`document.querySelector('[data-relation-search]').value`),'');
  }
  await viewport(1440,1000);
 });
 await check('C3 empty result, filter reset, mobile wrapping and keyboard focus',async()=>{
  for(const prefix of ['', '/en']){
   await viewport(375,812);await goto(`${prefix}/games/bgg-205637`,true);
   await input('[data-relation-search]','__no_relation_matches__');
   assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),0);
   const message=await client.eval(`document.querySelector('[data-relation-empty]')?.textContent`);
   assert.match(message||'',prefix?/No matching relations/:/沒有符合條件的關聯/);
   assert.equal(await client.eval(`document.querySelector('[data-relation-empty]').hidden`),false);
   await input('[data-relation-search]','');await click('[data-relation-more]');
   assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),40);
   await click('[data-relation-filter="implementations"]');
   assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),1);
   assert.equal(await client.eval(`document.querySelector('[data-relation-list]>li').dataset.relationId`),'359609');
   await input('[data-relation-search]','#359609');await click('[data-relation-filter="expansions"]');
   assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),0);
   await click('[data-relation-filter="implementations"]');
   assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),1);
   assert.equal(await client.eval(`document.querySelector('[data-relation-search]').value`),'#359609');
   await input('[data-relation-search]','');
   await click('[data-relation-filter="all"]');assert.equal(await client.eval(`document.querySelectorAll('[data-relation-list]>li').length`),20);
   await client.eval(`document.querySelector('[data-relation-search]').focus()`);
   await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   assert.equal(await client.eval(`document.activeElement.dataset.relationFilter`),'all');
   assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);
   assert.equal(await client.eval(`Array.from(document.querySelectorAll('[data-relation-list] strong')).every(n=>n.scrollWidth<=n.clientWidth||n.parentElement.scrollWidth<=n.parentElement.clientWidth)`),true);
   assert.ok(await client.eval(`document.querySelector('[data-relation-more]').getBoundingClientRect().height>=44`));
  }
  await viewport(1440,1000);
 });
 await check('C2 exact ID and bilingual name search keep automatic and explicit scopes',async()=>{
  for(const prefix of ['', '/en']){
   await goto(prefix+'/games');
   for(const id of [205637,359609,327293,448621]){
    await input('[data-game-search]',` #${id} `);
    await wait(`document.querySelectorAll('[data-game-card]').length===1&&document.querySelector('[data-game-card]').dataset.bggId==='${id}'`);
   }
   const {getGames}=await import('../src/lib/games.ts');const {translateGameName}=await import('../src/i18n/utils.ts');
   const darwin=getGames().find(g=>g.name.includes('Darwin')&&g.name.includes('Journey'));assert.ok(darwin);
   const {decodeGameName}=await import('../src/lib/game-name.ts');
   const query=decodeGameName(darwin.name).toUpperCase();
   await input('[data-game-search]',` ${query} `);await wait(`document.querySelector('[data-game-card][data-bgg-id="${darwin.bggId}"]')!==null`);
   await input('[data-game-search]',translateGameName(205637,getGames().find(g=>g.bggId===205637).name,prefix?'en':'zh-TW'));
   await wait(`document.querySelector('[data-game-card][data-bgg-id="205637"]')!==null`);
   await input('[data-game-search]','Arkham');await wait(`document.querySelectorAll('[data-game-card]').length>1`);
   await click('[data-game-filter="expansion"]');await input('[data-game-search]','#205637');
   await wait(`document.querySelectorAll('[data-game-card]').length===0`);
   assert.match(await client.eval(`document.querySelector('[data-load-status]').textContent`),prefix ? /No matching games/ : /沒有符合條件/);
   await input('[data-game-search]','');await wait(`document.querySelectorAll('[data-game-card]').length===24`);
   assert.equal(await client.eval(`document.querySelector('[data-game-filter="expansion"]').getAttribute('aria-pressed')`),'true');
   await click('[data-game-reset]');assert.equal(await client.eval(`document.querySelector('[data-game-filter="base"]').getAttribute('aria-pressed')`),'true');
  }
 });
 await check('C2 all six sorts are globally ordered, stable and shared by views/batches',async()=>{
  const {getGames}=await import('../src/lib/games.ts');const {buildCatalogPayload}=await import('../src/lib/catalog-payload.ts');
  const games=getGames(),records=buildCatalogPayload(games,'en').records;
  const source=records.map(r=>({id:Number(r.dataset.bggId),name:r.dataset.name,year:games.find(g=>g.bggId===Number(r.dataset.bggId)).bgg.year,rating:games.find(g=>g.bggId===Number(r.dataset.bggId)).bgg.averageRating,weight:games.find(g=>g.bggId===Number(r.dataset.bggId)).bgg.averageWeight}));
  for(const mode of ['name-asc','name-desc','year-asc','year-desc','bgg-rating-desc','weight-desc']){
   await goto('/en/games?filter=all&sort='+mode);
   const expected=await client.eval(`(()=>{const rows=${JSON.stringify(source)},c=new Intl.Collator('en',{numeric:true,sensitivity:'base'}),mode=${JSON.stringify(mode)};const valid=(x,key)=>Number.isFinite(x)&&x>0&&(key!=='weight'||x>=1&&x<=5)&&(key!=='rating'||x>=1&&x<=10);return rows.sort((a,b)=>{let d=0;if(mode.startsWith('name'))d=c.compare(a.name,b.name)*(mode==='name-desc'?-1:1);else{const key=mode.startsWith('year')?'year':mode.startsWith('weight')?'weight':'rating';const x=valid(a[key],key)?a[key]:null,y=valid(b[key],key)?b[key]:null;d=x===null?(y===null?0:1):y===null?-1:(x-y)*(mode==='year-asc'?1:-1);}return d||c.compare(a.name,b.name)||a.id-b.id;}).map(r=>r.id);})()`);
   const ids=()=>client.eval(`Array.from(document.querySelectorAll('[data-game-card]')).map(n=>Number(n.dataset.bggId))`);
   assert.deepEqual(await ids(),expected.slice(0,24));
   await click('[data-game-view="list"]');assert.deepEqual(await ids(),expected.slice(0,24));
   const labels=await client.eval(`Array.from(document.querySelectorAll('[data-game-card]')).map(n=>n.querySelector('[data-catalog-id]').textContent)`);
   assert.deepEqual(labels,expected.slice(0,24).map(id=>'BGG #'+id));
   await click('[data-load-more]');await wait(`document.querySelectorAll('[data-game-card]').length===48`);
   assert.deepEqual(await ids(),expected.slice(0,48));
   await client.send('Page.reload',{ignoreCache:true});await wait(`document.querySelector('[data-game-browser][data-initialized]')!==null&&document.querySelectorAll('[data-game-card]').length===48`);
   assert.deepEqual(await ids(),expected.slice(0,48));
  }
 });
 await check('C2 advanced filters clear individually and together without losing unrelated URL state',async()=>{
  await viewport(375,812);
  await goto('/en/games?q=Arkham&filter=expansion&sort=name-desc&view=list&players=2&time=61-120&weight=2-3');
  assert.equal(await client.eval(`document.querySelector('[data-game-advanced-summary]').textContent`),'3 filters');
  await input('[data-game-weight]','');
  assert.equal(await client.eval(`document.querySelector('[data-game-advanced-summary]').textContent`),'2 filters');
  assert.equal(await client.eval(`new URL(location.href).searchParams.has('weight')`),false);
  await click('[data-game-clear-advanced]');
  assert.equal(await client.eval(`document.querySelector('[data-game-clear-advanced]').hidden`),true);
  const state=await client.eval(`Object.fromEntries(new URL(location.href).searchParams)`);
  assert.deepEqual(state,{q:'Arkham',filter:'expansion',sort:'name-desc',view:'list'});
  assert.equal(await client.eval(`document.querySelector('[data-game-advanced]').open`),false);
  const {getGames}=await import('../src/lib/games.ts');const mechanic=String(getGames().find(g=>g.bggId===205637).bgg.mechanics[0].id);
  await goto('/en/games?q=%23205637&players=2&time=61-120&weight=3-4&mechanic='+mechanic);
  await wait(`document.querySelectorAll('[data-game-card]').length===1`);
  assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.bggId`),'205637');
  assert.equal(await client.eval(`document.querySelector('[data-game-advanced-summary]').textContent`),'4 filters');
  assert.equal(await client.eval(`document.querySelector('[data-game-mechanic]').value`),mechanic);
  assert.equal(await client.eval(`document.documentElement.scrollWidth<=innerWidth`),true);
  await client.eval(`document.querySelector('[data-game-search]').focus()`);
  await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await client.eval(`document.activeElement.hasAttribute('data-game-reset')`),true);
  await viewport(1440,1000);
 });
 await check('no browser runtime exceptions',async()=>assert.deepEqual(errors,[]));

 console.log(JSON.stringify({status:'PASS',checks:results.length,output,quality}));
})().catch(async error=>{
 process.exitCode=1;
 const evidence={status:'FAIL',errorCode:error.code==='ERR_ASSERTION'?'ASSERTION_MISMATCH':error.message,activeCase,stage,id:currentId,language,actual:error.actual,expected:error.expected,completed:results};
 if(client)try{evidence.page=await client.eval(`({path:location.pathname,title:document.querySelector('h1')?.textContent,relationIds:Array.from(document.querySelectorAll('[data-relation-list]>li')).map(n=>n.dataset.relationId)})`);}catch{}
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'failure.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}).finally(async()=>{
 if(client){try{await client.send('Browser.close');}catch{}client.ws.close();}
 if(browser&&browser.exitCode===null)await Promise.race([new Promise(r=>browser.once('exit',r)),pause(5000)]);
 if(browser&&browser.exitCode===null)browser.kill();
 if(server)await new Promise(r=>server.close(r));
 if(profile&&path.dirname(path.resolve(profile))===path.resolve(require('node:os').tmpdir())&&path.basename(profile).startsWith('bgg-b43c-browser-'))await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
});
