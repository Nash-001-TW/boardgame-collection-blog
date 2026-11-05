import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { createLocalGamesPreview } from '../scripts/lib/local-games-preview.ts';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]);
const target=process.argv[4];
await fs.mkdir(target,{recursive:true});
const preview=await createLocalGamesPreview();
const html=process.argv[5]?await fs.readFile(path.join(process.argv[5],'games.html'),'utf8'):await preview.html(new URL('http://localhost/games'));
const javascript=process.argv[5]?await fs.readFile(path.join(process.argv[5],'games.js'),'utf8'):preview.javascript;
const home=await preview.html(new URL('http://localhost/'));
if(!html)throw new Error('NO_HTML');
await fs.writeFile(path.join(target,'games.html'),html);
await fs.writeFile(path.join(target,'games.js'),javascript);
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
 res.setHeader('Cache-Control','public,max-age=600');
 const body=req.url?.startsWith('/games')?html:req.url==='/preview-games.js'?`performance.mark('catalog-start');${javascript};performance.mark('catalog-end');`: home??'';
 res.setHeader('Content-Type',req.url==='/preview-games.js'?'text/javascript':'text/html; charset=utf-8');
 res.setHeader('Content-Encoding','gzip');res.end(gzipSync(body));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser=await chromium.launch({headless:true,executablePath:process.argv[3]});
try{
 const nojs=await browser.newContext();const staticPage=await nojs.newPage();await staticPage.route('**/preview-games.js',(r: {fulfill(options: {body:string;contentType:string}):Promise<void>})=>r.fulfill({body:'',contentType:'text/javascript'}));await staticPage.goto(origin+'/games');
 const initial=await staticPage.evaluate(()=>({nodes:document.querySelectorAll('*').length,cards:document.querySelectorAll('[data-game-card]').length}));await nojs.close();
 const samples=[];
 for(let i=0;i<5;i++){
 const context=await browser.newContext();const page=await context.newPage();
 await page.addInitScript(()=>{(window as any).IntersectionObserver=undefined;});
 async function read(){await page.waitForFunction(()=>document.querySelector('[data-game-result-count]')?.textContent?.includes('325'));return page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;return {readyMs:performance.getEntriesByName('catalog-end')[0].startTime,initMs:performance.getEntriesByName('catalog-end')[0].startTime-performance.getEntriesByName('catalog-start')[0].startTime,transferBytes:n.transferSize,decodedBytes:n.decodedBodySize,nodes:document.querySelectorAll('*').length,cards:document.querySelectorAll('[data-game-card]').length};});}
 await page.goto(origin+'/games');const cold=await read();
 await page.goto(origin+'/');await page.locator('.cat-desktop-nav a[href="/games"]').click();const warm=await read();
 await page.goto(origin+'/');await page.evaluate(async()=>{await fetch('/games');});await page.locator('.cat-desktop-nav a[href="/games"]').click();const prefetched=await read();
 await page.evaluate(()=>{const button=document.querySelector('[data-load-more]')!;button.addEventListener('click',()=>{performance.mark('batch-start');},{capture:true,once:true});const observer=new MutationObserver(()=>{if(document.querySelector('[data-game-grid]')!.children.length===48){performance.mark('batch-end');observer.disconnect();}});observer.observe(document.querySelector('[data-game-grid]')!,{childList:true});});const start=await page.evaluate(()=>performance.now());await page.locator('[data-load-more]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-game-grid] > article').length===48);const batch=await page.evaluate((s:number)=>performance.now()-s,start);
 const batchWorkMs=await page.evaluate(()=>performance.getEntriesByName('batch-end')[0].startTime-performance.getEntriesByName('batch-start')[0].startTime);samples.push({cold,warm,prefetched,batchMs:batch,batchWorkMs});await context.close();
 }
 const result={htmlBytes:Buffer.byteLength(html),gzipBytes:gzipSync(html).length,initial,samples,limitations:'Local gzip HTTP, warm cache and explicit fetch-prefetch simulation; images blocked by CSP; not Astro adapter/dev cold start or production network.'};
 await fs.writeFile(path.join(target,'metrics.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();server.close();}
