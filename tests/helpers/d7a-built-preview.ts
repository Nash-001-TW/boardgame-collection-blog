import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** D7A rehearsal: real built entry/chunks and ASSETS; no Wrangler credentials, env files or remote resources. */
export async function d7aBuiltPreview(runWorkerFirst?:boolean){
 const root=path.resolve('dist/server'),directory=await mkdtemp(path.join(os.tmpdir(),'notbgg-d7a-'));
 const cleanup=async()=>{if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('notbgg-d7a-'))throw new Error('Unsafe cleanup');await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});};
 const generated=JSON.parse(await readFile('dist/server/wrangler.json','utf8'));
 const paths:string[]=[];async function walk(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else if(file.endsWith('.mjs'))paths.push(file);}}
 await walk(root);
 const instrument=`import app from './entry.mjs';import {env} from 'cloudflare:workers';import {AsyncLocalStorage} from 'node:async_hooks';
 const scope=new AsyncLocalStorage();const prototype=Object.getPrototypeOf(env.DB.prepare('SELECT 1'));
 for(const method of ['first','all','run','raw']){const original=prototype[method];prototype[method]=async function(...args){const stats=scope.getStore();if(!stats)return original.apply(this,args);const start=performance.now();stats.count++;try{return await original.apply(this,args)}finally{stats.ms+=performance.now()-start}}}
 export default {async fetch(request,bindings,ctx){return scope.run({count:0,ms:0},async()=>{const start=performance.now();const r=await app.fetch(request,bindings,ctx);const stats=scope.getStore();const response=new Response(r.body,r);response.headers.set('X-D7A-Queries',String(stats.count));response.headers.set('X-D7A-Collation',new Intl.Collator('zh-TW',{numeric:true}).resolvedOptions().locale);response.headers.set('X-D7A-D1-Ms',String(stats.ms));response.headers.set('X-D7A-Handler-Ms',String(performance.now()-start));return response})}};`;
 const modules=[{type:'ESModule' as const,path:path.join(root,'__d7a_instrument.mjs'),contents:instrument},...await Promise.all(paths.map(async file=>({type:'ESModule' as const,path:file,contents:await readFile(file,'utf8')})))];
 const id='d7a-'+crypto.randomUUID();
 const runtime=new Miniflare(convertV4MiniflareOptions({modules,modulesRoot:root,compatibilityDate:generated.compatibility_date,compatibilityFlags:generated.compatibility_flags,
  d1Databases:{DB:id},kvNamespaces:{SESSION:'d7a-kv-'+crypto.randomUUID()},images:{binding:'IMAGES'},
  bindings:{ACCESS_TEAM_DOMAIN:'d7a-synthetic.cloudflareaccess.com',ACCESS_AUD:'d7a-synthetic-audience',ADMIN_EMAIL:'d7a@example.invalid',LOCAL_ADMIN_DEV:'false'},
  assets:{directory:path.resolve('dist/client'),binding:'ASSETS',run_worker_first:runWorkerFirst??generated.assets.run_worker_first,routerConfig:{has_user_worker:true}},
  resourcePersistencePath:directory,resourceTmpPath:path.join(directory,'tmp'),telemetry:{enabled:false},outboundService:()=>new Response('External access blocked',{status:403})}));
 try{const url=await runtime.ready;return {url,db:await runtime.getD1Database('DB') as unknown as D1Database,
  httpFetch:(pathname:string,init?:RequestInit)=>fetch(new URL(pathname,url),{...init,redirect:'manual'}),
  fetch:(url:string,headers?:Record<string,string>)=>runtime.dispatchFetch(url,{redirect:'manual',headers}),
  dispose:async()=>{await runtime.dispose();await cleanup();}};}catch(error){await runtime.dispose();await cleanup();throw error;}
}
