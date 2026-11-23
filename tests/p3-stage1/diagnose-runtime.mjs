import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions,Log,LogLevel} from 'miniflare';

const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
const workspace=path.resolve(value('--workspace')),root=path.resolve(value('--run-root'));
if(root!==path.join(workspace,'.wrangler','p3-stage1','diagnostics','P3D1-20261118-001')||process.cwd()!==root||!args.includes('--offline')||!args.includes('--no-sql'))throw Error('BLOCKED scope');
for(let p=root;;p=path.dirname(p)){if((await fs.lstat(p)).isSymbolicLink())throw Error('BLOCKED linked path');if(path.dirname(p)===p)break;}
for(const [k,v]of Object.entries({TEMP:'tmp',TMP:'tmp',HOME:'home',USERPROFILE:'home',APPDATA:'appdata',LOCALAPPDATA:'localappdata',XDG_CONFIG_HOME:'config',XDG_CACHE_HOME:'cache'}))if(path.resolve(process.env[k]??'')!==path.join(root,v))throw Error('BLOCKED isolated environment '+k);
if(Object.keys(process.env).some(k=>/^(CLOUDFLARE_|CF_|BGG_|ACCESS_|ADMIN_|NODE_OPTIONS$|NODE_PATH$)|PROXY/i.test(k)))throw Error('BLOCKED inherited environment');
const evidence=path.join(root,'evidence');
await fs.writeFile(path.join(root,'started.json'),JSON.stringify({pid:process.pid,utc:new Date().toISOString()}),{flag:'wx'});
const save=(name,data)=>fs.writeFile(path.join(evidence,name),JSON.stringify(data,null,2));
const clean=s=>String(s).replace(/\b(?:Bearer\s+\S+|[a-f0-9]{32,})\b/gi,'[REDACTED]').replace(/(secret|token|authorization|cookie|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]').replace(/https?:\/\/[^\s)]+/g,raw=>{try{const u=new URL(raw);return `${u.protocol}//${u.hostname}${u.port?':'+u.port:''}/[path-redacted]`;}catch{return '[URL-redacted]';}}).slice(0,16000);
function serialize(error,depth=0,seen=new WeakSet(),budget={n:0}){
 if(depth>8||++budget.n>64)return '[LIMIT]';
 if(error===null||typeof error!=='object')return clean(error);
 if(seen.has(error))return '[CIRCULAR]';seen.add(error);
 const out={};
 for(const k of ['name','message','stack','code','errno','syscall','address','port']){try{if(error[k]!==undefined)out[k]=typeof error[k]==='number'?error[k]:clean(error[k]);}catch{out[k]='[UNREADABLE]';}}
 try{if(error.cause!==undefined)out.cause=serialize(error.cause,depth+1,seen,budget);}catch{out.cause='[UNREADABLE]';}
 try{if(Array.isArray(error.errors))out.errors=error.errors.slice(0,16).map(e=>serialize(e,depth+1,seen,budget));}catch{out.errors='[UNREADABLE]';}
 return out;
}
let order=0;const stages=[];
async function stage(phase,result,details={}){const row={order:++order,utc:new Date().toISOString(),elapsedMs:performance.now()-start,phase,result,...details};stages.push(row);await fs.appendFile(path.join(evidence,'stages.ndjson'),JSON.stringify(row)+'\n');}
const start=performance.now(),hash=b=>createHash('sha256').update(b).digest('hex');
const protectedFiles=['runner.mjs','local-runtime.ts','trusted-snapshot.ts','stage1.test.ts','sql/stage1-only.sql','tsconfig.json'].map(f=>path.join(workspace,'tests','p3-stage1',f));
protectedFiles.push(...['src/lib/component-classifier.ts','src/lib/component-classifier-adapter.ts','src/lib/physical-component-proof.ts','tests/helpers/notbgg-local-d1.ts','package-lock.json'].map(f=>path.join(workspace,f)));
const migrations=(await fs.readdir(path.join(workspace,'migrations'))).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort();
if(migrations.length!==22||migrations.some((f,i)=>Number(f.slice(0,4))!==i+1))throw Error('BLOCKED migrations');
protectedFiles.push(...migrations.map(f=>path.join(workspace,'migrations',f)));
const before=[];for(const file of protectedFiles)before.push({file,sha256:hash(await fs.readFile(file))});
const versions={node:process.version};for(const name of ['miniflare','workerd'])versions[name]=JSON.parse(await fs.readFile(path.join(workspace,'node_modules',name,'package.json'),'utf8')).version;
await save('manifest.json',{workspace,root,pid:process.pid,versions,envNames:Object.keys(process.env).sort(),protectedHashes:before,sqlCalls:0,configuration:{host:'127.0.0.1',port:0,binding:'P3_TEST',telemetry:false,remote:0,kv:0},networkBoundary:'Parent fetch loopback allowlist and Worker outbound deny; internal transport not intercepted; not an OS firewall'});
await fs.writeFile(path.join(evidence,'network-denials.ndjson'),'');
let runtime,denied=0,endpoint=null,failure=null,disposeResult='NOT_CONSTRUCTED',phase='construct';
const originalFetch=globalThis.fetch;
const deny=channel=>{denied++;void fs.appendFile(path.join(evidence,'network-denials.ndjson'),JSON.stringify({utc:new Date().toISOString(),channel})+'\n');throw Error('ISOLATION_STOP outbound denied');};
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))return deny('node-fetch');return originalFetch(input,init);};
class SafeLog extends Log {constructor(){super(LogLevel.DEBUG);}logWithLevel(level,message){void fs.appendFile(path.join(evidence,'runtime-log.ndjson'),JSON.stringify({utc:new Date().toISOString(),level,message:clean(message)})+'\n');}error(error){void fs.appendFile(path.join(evidence,'runtime-log.ndjson'),JSON.stringify({utc:new Date().toISOString(),error:serialize(error)})+'\n');}}
try{
 await stage(phase,'START');
 runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("P3 SYNTHETIC LOCAL ONLY")}}',host:'127.0.0.1',port:0,compatibilityDate:'2026-10-01',d1Databases:{P3_TEST:'p3-stage1-synthetic-'+path.basename(root)},resourcePersistencePath:path.join(root,'state'),resourceTmpPath:path.join(root,'tmp'),telemetry:{enabled:false},log:new SafeLog(),outboundService:()=>deny('worker-outbound')}));
 await stage(phase,'SUCCESS');phase='ready';await stage(phase,'START');
 const url=await runtime.ready;endpoint={protocol:url.protocol,host:url.hostname,port:url.port};
 if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('BLOCKED nonloopback ready endpoint');
 await save('endpoint.json',endpoint);await stage(phase,'SUCCESS',{endpoint});
 phase='getD1Database';await stage(phase,'START');
 await runtime.getD1Database('P3_TEST');
 await stage(phase,'SUCCESS');
}catch(error){failure={phase,error:serialize(error),causeStatus:error?.cause===undefined?'CAUSE_UNAVAILABLE':'CAUSE_CHAIN_CAPTURED'};await save('error.json',failure);await stage(phase,'FAIL',{causeStatus:failure.causeStatus});}
finally{
 if(runtime){await stage('dispose','START');try{await runtime.dispose();disposeResult='SUCCESS';await stage('dispose','SUCCESS');}catch(error){disposeResult='FAIL';await save('dispose-error.json',serialize(error));await stage('dispose','FAIL');}}
 globalThis.fetch=originalFetch;
}
const changed=[];for(const item of before)if(hash(await fs.readFile(item.file))!==item.sha256)changed.push(item.file);
const result={status:denied||changed.length?'BLOCKED':failure?'DIAGNOSTIC_COMPLETED_RUNTIME_FAILED':'DIAGNOSTIC_COMPLETED_BINDING_ACQUIRED',versions,endpoint,failure,disposeResult,denied,protectedChanges:changed,sqlCalls:0,stages,finishedUTC:new Date().toISOString(),pid:process.pid};
await save('result.json',result);console.log(JSON.stringify({status:result.status,disposeResult,sqlCalls:0}));process.exitCode=failure||denied||changed.length?1:0;
