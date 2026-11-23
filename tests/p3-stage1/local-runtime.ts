import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile,appendFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {migrationStatements} from '../helpers/notbgg-local-d1.ts';

export const root=process.env.P3_RUN_ROOT!;
export const workspace=process.env.P3_WORKSPACE!;
export const hash=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
export const evidence=path.join(root,'evidence');
export async function trace(row:unknown){await appendFile(path.join(evidence,'query-trace.ndjson'),JSON.stringify(row)+'\n');}
export async function openLocal(){
 if(!root||!workspace||path.resolve(process.cwd())!==path.resolve(root))throw Error('BLOCKED: isolated cwd required');
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(input:any,init?:any)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)){await appendFile(path.join(evidence,'network-denials.ndjson'),JSON.stringify({channel:'node-fetch',host:u.hostname})+'\n');throw Error('ISOLATION_STOP external fetch');}return originalFetch(input,init);};
 let denied=0;
 const state=path.join(root,'state'),tmp=path.join(root,'tmp');await mkdir(state,{recursive:false});
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("P3 SYNTHETIC LOCAL ONLY")}}',host:'127.0.0.1',port:0,compatibilityDate:'2026-10-01',d1Databases:{P3_TEST:'p3-stage1-synthetic-'+path.basename(root)},resourcePersistencePath:state,resourceTmpPath:tmp,telemetry:{enabled:false},outboundService:()=>{denied++;void appendFile(path.join(evidence,'network-denials.ndjson'),JSON.stringify({channel:'worker-outbound'})+'\n');throw Error('ISOLATION_STOP Worker outbound');}}));
 let db:any;const stats={bootstrapRowsWritten:0,testRowsWritten:0,queries:0};let phase='bootstrap';
 const dispose=async()=>{await runtime.dispose();globalThis.fetch=originalFetch;await writeFile(path.join(evidence,'runtime-stop.json'),JSON.stringify({disposed:true,denied,stats,at:new Date().toISOString()},null,2));};
 try{
  const native=await runtime.getD1Database('P3_TEST');
  const wrap=(sql:string,args:any[]=[])=>{
   const exec=async(method:string,column?:string)=>{const start=performance.now();try{const s=native.prepare(sql).bind(...args);const result=await (method==='first'?s.first(column):method==='run'?s.run():s.all());stats.queries++;const meta=result?.meta;if(meta?.rows_written)phase==='bootstrap'?stats.bootstrapRowsWritten+=meta.rows_written:stats.testRowsWritten+=meta.rows_written;await trace({phase,method,sqlHash:hash(sql),sqlBytes:Buffer.byteLength(sql),parameterCount:args.length,parameterTypes:args.map(v=>v===null?'null':typeof v),parameterHash:hash(args),durationMs:performance.now()-start,changes:meta?.changes,rowsWritten:meta?.rows_written,success:true});return result;}catch(e){await trace({phase,method,sqlHash:hash(sql),parameterCount:args.length,durationMs:performance.now()-start,success:false,error:String(e).slice(0,400)});throw e;}};
   return {bind:(...a:any[])=>wrap(sql,a),all:()=>exec('all'),run:()=>exec('run'),first:(column?:string)=>exec('first',column),native:()=>native.prepare(sql).bind(...args),sql,args};
  };
  db={prepare:(sql:string)=>wrap(sql),batch:async(stmts:any[])=>{const t=performance.now();try{const r=await native.batch(stmts.map(s=>s.native()));stats.queries++;for(const x of r){if(x.meta?.rows_written)phase==='bootstrap'?stats.bootstrapRowsWritten+=x.meta.rows_written:stats.testRowsWritten+=x.meta.rows_written;}await trace({phase,method:'batch',sqlHashes:stmts.map(s=>hash(s.sql)),parameters:stmts.map(s=>({count:s.args.length,types:s.args.map((v:any)=>v===null?'null':typeof v),hash:hash(s.args)})),durationMs:performance.now()-t,success:true,meta:r.map((x:any)=>x.meta)});return r;}catch(e){await trace({phase,method:'batch',durationMs:performance.now()-t,success:false,error:String(e).slice(0,400)});throw e;}}};
  const manifest=JSON.parse(await readFile(path.join(evidence,'manifest.json'),'utf8'));
  for(const f of manifest.schemaHashes){const original=await readFile(path.join(root,'schema-input',f.file));if(createHash('sha256').update(original).digest('hex')!==f.sha256)throw Error('BLOCKED schema hash mismatch');const text=original.toString('utf8');const queries=migrationStatements(text).filter(s=>!/^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END);$/i.test(s.trim()));await db.batch(queries.map(s=>db.prepare(s)));}
  const candidate=await readFile(path.join(workspace,'tests','p3-stage1','sql','stage1-only.sql'),'utf8');await db.batch(migrationStatements(candidate).map(s=>db.prepare(s)));
  phase='test';await writeFile(path.join(evidence,'runtime-ready.json'),JSON.stringify({runtime:'Miniflare local D1',state,tmp,binding:'P3_TEST',remoteProxy:false,kv:0,stats,ready:true},null,2));
  return {db,dispose,stats,assertIsolation:()=>{if(denied)throw Error('ISOLATION_STOP outbound attempted');}};
 }catch(e){try{await dispose();}catch(cleanup){await writeFile(path.join(evidence,'runtime-stop-error.json'),JSON.stringify({error:String(cleanup)}));}throw e;}
}
