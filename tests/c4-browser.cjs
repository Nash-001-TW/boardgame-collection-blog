// C-4: only normal page images use the network; full-catalog phase blocks BGG images.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
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

let browser,server,client,profile;
(async()=>{
 const {createLocalGamesPreview}=await import('../scripts/lib/local-games-preview.ts');const preview=await createLocalGamesPreview();
 server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://localhost');res.setHeader('Content-Type',u.pathname==='/preview-games.js'?'text/javascript':'text/html; charset=utf-8');res.end(u.pathname==='/preview-games.js'?preview.javascript:await preview.html(u));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=process.env.C4_ORIGIN||`http://127.0.0.1:${server.address().port}`;
 profile=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'c4-browser-'));
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await pause(100);}}
 const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));client=new CDP(ws);
 await client.send('Page.enable');await client.send('Runtime.enable');await client.send('Network.enable');
 const samples=new Map(),starts=new Map(),failures=[],errors=[];client.on('Network.requestWillBeSent',e=>starts.set(e.requestId,e.timestamp));client.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.text));
 client.on('Network.responseReceived',e=>{if(e.type==='Image')samples.set(e.requestId,{url:e.response.url,status:e.response.status,cache:!!(e.response.fromDiskCache||e.response.fromPrefetchCache),start:starts.get(e.requestId),ttfb:e.response.timing?e.response.timing.receiveHeadersEnd:null});});
 client.on('Network.loadingFinished',e=>{const s=samples.get(e.requestId);if(s){s.bytes=e.encodedDataLength;s.durationMs=(e.timestamp-s.start)*1000;}});
 client.on('Network.loadingFailed',e=>{if(e.type==='Image')failures.push(e.errorText);});
 await client.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.metrics={cls:0,lcp:null};new PerformanceObserver(l=>l.getEntries().forEach(e=>{if(!e.hadRecentInput)metrics.cls+=e.value})).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{metrics.lcp=l.getEntries().at(-1).startTime}).observe({type:'largest-contentful-paint',buffered:true});`});
 async function go(route){await client.send('Page.navigate',{url:origin+route});for(let i=0;i<100;i++){if(await client.eval(`document.readyState==='complete' && location.pathname.replace(/[/]$/,'')===${JSON.stringify(route.split('?')[0])} && !!document.querySelector('[data-ready="true"], [data-initialized="true"]')`))return;await pause(100);}throw new Error('PAGE_NOT_READY'); }
 for(const width of (process.env.C4_ONLY_SLOW?[]:[1440,390])){
 await client.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
 await go('/games');await pause(4000);
 console.log(JSON.stringify({mode:process.env.C4_MODE|| (process.env.C4_ORIGIN?'astro-dev-real-network':'component-preview-real-network'),width,grid:await client.eval(`({cards:document.querySelectorAll('[data-game-card]').length,loaded:[...document.images].filter(i=>i.naturalWidth>0).length,overflow:document.documentElement.scrollWidth>innerWidth,...metrics,dcl:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd})`)}));
 assert.equal(await client.eval(`document.querySelectorAll('[data-game-card]').length`),24);
 if(process.env.C4_SCREENSHOT && width===1440){const shot=await client.send('Page.captureScreenshot',{format:'png'});await fs.writeFile(process.env.C4_SCREENSHOT,Buffer.from(shot.data,'base64'));}
 const beforeSwitch=samples.size;console.log('switch',await client.eval(`(()=>{const t=performance.now();document.querySelector('[data-game-view="list"]').click();return performance.now()-t})()`));
 await pause(200);console.log('view-added-image-responses',samples.size-beforeSwitch);
 await go('/games/bgg-205637');await pause(4000);
 console.log(JSON.stringify({width,detail:await client.eval(`({main:document.querySelector('[data-cover-open] img')?.naturalWidth,relations:document.querySelectorAll('[data-relation-list] img').length,loaded:[...document.querySelectorAll('[data-relation-list] img')].filter(i=>i.naturalWidth>0).length,overflow:document.documentElement.scrollWidth>innerWidth,...metrics})`)}));
 const moreResult=await client.eval(`(()=>{const first=document.querySelector('[data-relation-list] li'),t=performance.now();document.querySelector('[data-relation-more]').click();return {ms:performance.now()-t,retained:first===document.querySelector('[data-relation-list] li')}})()`);assert.equal(moreResult.retained,true);console.log('more',moreResult);
 }
 await client.send('Network.setCacheDisabled',{cacheDisabled:true});
 await client.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 await client.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:100000,connectionType:'cellular3g'});
 await go('/games');await pause(4000);console.log('slow-network-cold-cache',await client.eval(`({cards:document.querySelectorAll('[data-game-card]').length,...metrics})`));
 await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 if(process.env.C4_ONLY_SLOW)return;
 // Remaining all-catalog exercise is offline: never fetch the complete image catalog.
 console.log('real-network-failures',failures);
 await client.send('Network.setBlockedURLs',{urls:['*://cf.geekdo-images.com/*']});
 await go('/games?filter=all');
 console.log('all-initial',await client.eval(`document.querySelectorAll('[data-game-card]').length`));
 console.log('load48',await client.eval(`(async()=>{const t=performance.now();document.querySelector('[data-load-more]').click();while(document.querySelectorAll('[data-game-card]').length<48)await new Promise(r=>setTimeout(r,10));return {ms:performance.now()-t,cards:document.querySelectorAll('[data-game-card]').length}})()`));
 console.log('load815',await client.eval(`(async()=>{const times=[];while(document.querySelectorAll('[data-game-card]').length<815){const before=document.querySelectorAll('[data-game-card]').length,t=performance.now();document.querySelector('[data-load-more]').click();while(document.querySelectorAll('[data-game-card]').length===before)await new Promise(r=>setTimeout(r,10));times.push(performance.now()-t)}return {cards:document.querySelectorAll('[data-game-card]').length,maxMs:Math.max(...times),totalMs:times.reduce((a,b)=>a+b,0)}})()`));
 console.log('search',await client.eval(`new Promise(resolve=>{const t=performance.now(),i=document.querySelector('[data-game-search]');i.value='#205637';i.dispatchEvent(new Event('input',{bubbles:true}));const poll=setInterval(()=>{if(document.querySelectorAll('[data-game-card]').length===1){clearInterval(poll);resolve({ms:performance.now()-t,id:document.querySelector('[data-game-card]').dataset.bggId})}},10)})`));
 assert.equal(await client.eval(`document.querySelector('[data-game-card]').dataset.bggId`),'205637');
 await pause(500);assert.match(await client.eval(`document.querySelector('[data-image-placeholder]')?.textContent`),/圖片無法載入/);console.log('grid-failed-placeholder',await client.eval(`({images:document.querySelectorAll('[data-game-card] img').length,text:document.querySelector('[data-image-placeholder]')?.textContent})`));
 await go('/games/bgg-205637');await pause(500);console.log('failed-cover',await client.eval(`({placeholder:!!document.querySelector('.cover-column .no-cover'),search:!!document.querySelector('[data-relation-search]')})`));
 assert.equal(await client.eval(`!!document.querySelector('.cover-column .no-cover') && !!document.querySelector('[data-relation-search]')`),true);
 console.log(JSON.stringify({samples:[...samples.values()].slice(0,4),requests:samples.size,failures:failures.slice(0,5),errors}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(client){await client.send('Browser.close').catch(()=>{});client.ws.close()}if(browser)browser.kill();if(server)server.close();if(profile&&path.basename(profile).startsWith('c4-browser-')&&path.dirname(profile)===require('node:os').tmpdir())await fs.rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:200});});
