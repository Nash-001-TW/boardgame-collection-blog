// B-3D offline Edge/CDP complexity regression; synthetic ratings exist only in memory.
// All non-loopback requests are intercepted; covers are labelled synthetic images.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');const assert=require('node:assert/strict');
const output=process.argv[2];const results=[];let browser,server,client;
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
async function check(name,fn){await fn();results.push({name,status:'PASS'});}
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const {createLocalGamesPreview}=await import('../scripts/lib/local-games-preview.ts');const preview=await createLocalGamesPreview();
 server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/preview-games.js'){res.setHeader('Content-Type','text/javascript');res.end(preview.javascript);return;}
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
 const profile=path.join(output,'edge-profile');const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','LOCALAPPDATA'])if(process.env[key])env[key]=process.env[key];
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
 await client.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.IntersectionObserver=undefined;'});
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const viewport=async(width,height)=>client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
 await viewport(1440,1000);
 const wait=async(expr)=>{for(let n=0;n<160;n++){if(await client.eval(expr))return;await pause(50);}throw new Error('UI_WAIT_FAILED');};
 const goto=async(route,detail=false)=>{await client.send('Page.navigate',{url:origin+route});await wait(`location.pathname===${JSON.stringify(route.split('?')[0])} && document.querySelector(${JSON.stringify(detail?'[data-detail-v2][data-ready="true"]':'[data-game-browser][data-initialized="true"]')})!==null`);};
 const click=async selector=>client.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const input=async(selector,value)=>client.eval(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
 const screenshot=async name=>{await pause(250);const data=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,name),Buffer.from(data.data,'base64'));};
 await check('catalog total 765, Grid/List and initial 24 DOM',async()=>{
  await goto('/games?filter=all');await wait(`document.querySelectorAll('[data-game-card]').length===24`);
  assert.match(await client.eval(`document.querySelector('[data-game-result-count]').textContent`),/765/);
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
 await check('no browser runtime exceptions',async()=>assert.deepEqual(errors,[]));
 await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({status:'PASS',results,quality,syntheticCovers,externalBlocked,externalNetworkAllowed:false,coverage:'Real compiled Astro components; synthetic offline cover images; no full Cloudflare build'},null,2));
 console.log(JSON.stringify({status:'PASS',checks:results.length,output,quality}));
})().catch(async()=>{process.exitCode=1;await fs.writeFile(path.join(output,'browser-results.json'),JSON.stringify({status:'FAIL',errorCode:'BROWSER_ACCEPTANCE_FAILED',results},null,2));console.log(JSON.stringify({status:'FAIL',completed:results,errorCode:'BROWSER_ACCEPTANCE_FAILED'}));}).finally(async()=>{
 if(client){try{await client.send('Browser.close');}catch{}client.ws.close();}
 if(browser&&browser.exitCode===null)await Promise.race([new Promise(r=>browser.once('exit',r)),pause(5000)]);
 if(browser&&browser.exitCode===null)browser.kill();
 if(server)await new Promise(r=>server.close(r));
});
