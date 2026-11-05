import {d7aBuiltPreview} from './helpers/d7a-built-preview.ts';
import {migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import http from 'node:http';
const require=createRequire(import.meta.url),{chromium}=require(process.argv[2]);
const count=Number(process.argv[4]??10),label=process.argv[5]??'baseline',mode=process.argv[6]??'grid';
const preview=await d7aBuiltPreview(),samples:any[]=[];let server:http.Server|undefined,browser:any;
try{
 await migrateIsolatedD1(preview.db);const repo=new NotBggRepository(preview.db);
 for(const [i,type]of (['boardgame','boardgameexpansion','boardgameaccessory'] as const).entries())await repo.create({name:'Synthetic R3 '+type,type,...(type==='boardgameaccessory'?{accessoryCategories:['storage']}:{} )},{actor:'synthetic',idempotencyKey:'r3-'+i});
 server=http.createServer(async(req,res)=>{try{const headers:Record<string,string>={'Accept-Encoding':'identity'};for(const[k,v]of Object.entries(req.headers))if(typeof v==='string'&&!['host','accept-encoding'].includes(k))headers[k]=v;const r=await preview.fetch('http://127.0.0.1:'+String((server!.address() as any).port)+req.url,headers);res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch{res.statusCode=500;res.end('Local rehearsal failed');}});
 await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+String((server.address() as any).port);
 const mobilePath='/games'+(mode==='list'?'?view=list':'');
 const source=await(await preview.fetch(origin+mobilePath)).text(),ssrIds=[...source.matchAll(/<article[^>]*data-catalog-key="([^"]+)"/g)].map(m=>m[1]);
 for(let i=1;i<=count;i++){
  browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',(route:any)=>new URL(route.request().url()).origin===origin?route.continue():route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"/>'}));
  await context.addInitScript(()=>{
   const w=window as any;w.__name=Object; // tsx keepNames helpers must exist inside the serialized browser function.
   w.r3={cls:0,shiftTotal:0,lcp:null,shifts:[],events:[],frames:[]};let first=0,last=0,sum=0,lastState='';
   const rect=(e:Element|null)=>e?.getBoundingClientRect().toJSON();
   const image=(img:HTMLImageElement)=>({width:img.width,height:img.height,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,complete:img.complete,loading:img.loading,decoding:img.decoding,widthAttr:img.getAttribute('width'),heightAttr:img.getAttribute('height'),aspectRatio:getComputedStyle(img.parentElement!).aspectRatio,rect:rect(img)});
   const state=()=>({at:performance.now(),bodyMargin:document.body?getComputedStyle(document.body).margin:null,fonts:document.fonts.status,view:document.querySelector('[data-game-browser]')?.getAttribute('data-view'),initialized:document.querySelector('[data-game-browser]')?.getAttribute('data-initialized'),countText:document.querySelector('[data-game-result-count]')?.textContent,body:rect(document.body),grid:rect(document.querySelector('[data-game-grid]')),images:[...document.images].slice(0,4).map(image),styles:[...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].map(s=>({path:new URL(s.href).pathname,loaded:!!s.sheet}))});
   new PerformanceObserver(l=>l.getEntries().forEach((e:any)=>{if(e.hadRecentInput)return;if(e.startTime-last>1000||e.startTime-first>5000){first=e.startTime;sum=0;}last=e.startTime;sum+=e.value;w.r3.cls=Math.max(w.r3.cls,sum);w.r3.shiftTotal+=e.value;w.r3.shifts.push({at:e.startTime,value:e.value,sources:e.sources.map((s:any)=>({tag:s.node?.tagName,class:s.node?.className,dataCount:s.node?.hasAttribute?.('data-game-result-count'),before:s.previousRect.toJSON(),after:s.currentRect.toJSON()})),state:state()});})).observe({type:'layout-shift',buffered:true});
   new PerformanceObserver(l=>w.r3.lcp=l.getEntries().at(-1)!.startTime).observe({type:'largest-contentful-paint',buffered:true});
   const mark=(name:string)=>w.r3.events.push({name,...state()});document.addEventListener('DOMContentLoaded',()=>mark('DOMContentLoaded'));window.addEventListener('load',()=>mark('load'));document.fonts.ready.then(()=>mark('fonts.ready'));
   new MutationObserver(ms=>{if(ms.some(m=>m.target instanceof Element&&(m.target.hasAttribute('data-game-result-count')||m.target.hasAttribute('data-game-browser'))))mark('controller/count mutation');}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-initialized','data-view']});
   let end=performance.now()+10000;const frame=()=>{if(document.body){const s=state(),key=JSON.stringify([s.bodyMargin,s.fonts,s.view,s.initialized,s.countText,s.styles]);if(key!==lastState){w.r3.frames.push(s);lastState=key;}}if(performance.now()<end)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
  // Same D7A navigation sequence, but each sample has a fresh browser/context.
  await page.goto(origin+'/games?filter=all&page=35');await page.waitForFunction(()=>document.querySelectorAll('[data-game-grid]>[data-game-card]').length===818);
  await page.setViewportSize({width:390,height:844});const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:100000,connectionType:'cellular3g'});
  await page.goto(origin+mobilePath);await page.waitForFunction(()=>document.querySelector('[data-game-browser]')?.getAttribute('data-initialized')==='true');await page.waitForTimeout(1200);
  const result=await page.evaluate(()=>{const w=window as any;return {...w.r3,final:w.r3.frames.at(-1),dcl:(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domContentLoadedEventEnd,viewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,resources:performance.getEntriesByType('resource').filter((e:any)=>['link','css','script'].includes(e.initiatorType)||/\.(?:woff2?|ttf)(?:\?|$)/.test(e.name)).map((e:any)=>({path:new URL(e.name).pathname,type:e.initiatorType,start:e.startTime,end:e.responseEnd,bytes:e.transferSize})),fontFaces:[...document.fonts].map(f=>({family:f.family,status:f.status})),cardIds:[...document.querySelectorAll<HTMLElement>('[data-game-grid]>[data-game-card]')].map(e=>e.dataset.catalogKey),imageSummary:{total:document.images.length,loaded:[...document.images].filter(e=>e.complete&&e.naturalWidth>0).length,pending:[...document.images].filter(e=>!e.complete).length,failed:[...document.images].filter(e=>e.complete&&!e.naturalWidth).length},initialView:document.querySelector('[data-game-browser]')?.getAttribute('data-view'),overflow:document.documentElement.scrollWidth>innerWidth};});
  if(errors.length||result.lcp===null||!result.frames.length)throw new Error('Invalid browser instrumentation: '+JSON.stringify({errors,lcp:result.lcp,frames:result.frames.length}));
  result.ssrIds=ssrIds;result.sameSsrOrder=JSON.stringify(ssrIds)===JSON.stringify(result.cardIds);result.errors=errors;result.sample=i;result.phase=label;samples.push(result);console.log(JSON.stringify({sample:i,phase:label,cls:result.cls,lcp:result.lcp,shifts:result.shifts.map((s:any)=>({at:s.at,value:s.value,sources:s.sources.map((r:any)=>r.tag+'.'+r.class)})),sameSsrOrder:result.sameSsrOrder}));
  await browser.close();browser=undefined;
 }
 const evidence={phase:label,environment:{engine:'Edge headless; new browser/context per sample; built Worker+ASSETS; local D1; Node bridge',data:'815 BGG + 3 synthetic NotBGG',viewport:'390x844',initialView:mode,network:{latencyMs:150,downloadBytesPerSecond:200000,uploadBytesPerSecond:100000},cpuRate:1,cacheDisabled:true,compression:'identity',images:'synthetic SVG 300x400; no external image requests',observation:'load + controller readiness + 1200ms; frame instrumentation up to 10s'},samples};
 await writeFile('docs/d7a-r3-cls-'+label+'.json',JSON.stringify(evidence,null,2));
}finally{if(browser)await browser.close();if(server)await new Promise<void>(r=>server!.close(()=>r()));await preview.dispose();}
