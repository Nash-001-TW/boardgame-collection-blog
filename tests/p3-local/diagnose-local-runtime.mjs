// L3 candidate: one runtime only; never import Stage 1, SQL helpers, app or configuration.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {createEvidence,classifyLog} from './diagnostic-evidence.mjs';

const args=process.argv.slice(2);
if(args.length!==6||args[0]!=='--workspace'||args[2]!=='--run-root'||args[4]!=='--no-sql'||args[5]!=='--local-functional-policy')throw Error('BLOCKED argument scope');
const workspace=path.resolve(args[1]),root=path.resolve(args[3]),runId='P3L3-20261118-001';
const expected=path.join(workspace,'.wrangler','p3-local','diagnostics',runId);
if(root!==expected||process.cwd()!==root||fileURLToPath(import.meta.url)!==path.join(workspace,'tests','p3-local','diagnose-local-runtime.mjs'))throw Error('BLOCKED paths');
for(let p=root;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())throw Error('BLOCKED reparse');if(path.dirname(p)===p)break;}
const envDirs={TEMP:'tmp',TMP:'tmp',HOME:'home',USERPROFILE:'home',APPDATA:'appdata',LOCALAPPDATA:'localappdata',XDG_CONFIG_HOME:'config',XDG_CACHE_HOME:'cache'};
const allowed=new Set(['SYSTEMROOT','WINDIR','SYSTEMDRIVE','COMSPEC','PATHEXT','PROCESSOR_ARCHITECTURE','PATH','CI','WRANGLER_SEND_METRICS',...Object.keys(envDirs)]);
if(Object.keys(process.env).some(k=>!allowed.has(k.toUpperCase())))throw Error('BLOCKED environment name');
for(const [key,sub]of Object.entries(envDirs))if(path.resolve(process.env[key]??'')!==path.join(root,sub))throw Error('BLOCKED environment path');
if(process.version!=='v24.21.0'||process.env.CI!=='true'||process.env.WRANGLER_SEND_METRICS!=='false')throw Error('BLOCKED runtime/environment version');
const packageVersion=name=>JSON.parse(fs.readFileSync(path.join(workspace,'node_modules',name,'package.json'),'utf8')).version;
if(packageVersion('miniflare')!=='5.20261006.1-alpha'||packageVersion('workerd')!=='1.20261006.1')throw Error('BLOCKED package versions');
const evidence=createEvidence(root,runId);
let runtime,bindingAcquired=false,disposed=false,phase='import',denied=0;
const originalFetch=globalThis.fetch;
function deny(channel,code='OUTBOUND_DENIED'){
  denied++;const err=Error(code==='URL_PARSE_REJECTED'?'Invalid fetch URL':'Non-authorized outbound operation');
  // Fatal delivery must be attempted even if the supplementary denial log fails.
  evidence.signalFatal(code,err);
  try{fs.appendFileSync(path.join(root,'evidence','network-denials.ndjson'),JSON.stringify({runId,utc:new Date().toISOString(),channel,code})+'\n');}catch{evidence.signalFatal('EVIDENCE_FAILURE',Error('Evidence operation failed'));}
  throw err;
}
globalThis.fetch=async(input,init)=>{
  evidence.assertHealthy();let url,source;
  try{source=typeof input==='string'?input:input instanceof URL?input.href:input.url;url=new URL(source);}catch{return deny('parent-fetch','URL_PARSE_REJECTED');}
  // Reject alternative IPv4 encodings/whitespace/backslashes before URL canonicalization.
  if(typeof source!=='string'||!/^https?:\/\/(?:127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?(?:[/?#]|$)/.test(source))return deny('parent-fetch');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!['127.0.0.1','[::1]'].includes(url.hostname))return deny('parent-fetch');
  evidence.assertHealthy();
  return originalFetch(input,{...init,redirect:'error'});
};
const onUncaught=error=>{evidence.signalFatal('UNCAUGHT_EXCEPTION',error);process.exitCode=1;};
const onRejected=error=>{evidence.signalFatal('UNHANDLED_REJECTION',error);process.exitCode=1;};
// Latch blocks every normal stage, import continuation and fetch; parent owns termination.
// exitCode alone is not a stop guarantee. If delivery fails, the independent deadline remains.
process.on('uncaughtException',onUncaught);process.on('unhandledRejection',onRejected);
async function handshake(){
  await new Promise((resolve,reject)=>{
    const input=createInterface({input:process.stdin,terminal:false});let settled=false,timer;
    const finish=(ok,error)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      input.removeListener('line',onLine);input.removeListener('close',onClose);input.removeListener('error',onError);
      input.close();ok?resolve():reject(error);
    };
    const onLine=line=>finish(line===`GO ${runId}`,Error('Handshake invalid'));
    const onClose=()=>finish(false,Error('Handshake closed'));
    const onError=()=>finish(false,Error('Handshake input error'));
    input.on('line',onLine);input.on('close',onClose);input.on('error',onError);
    timer=setTimeout(()=>finish(false,Error('Handshake timeout')),5000);
  });
}
try {
  phase='handshake';
  fs.writeFileSync(path.join(root,'started.json'),JSON.stringify({runId,pid:process.pid,utc:new Date().toISOString()}),{flag:'wx'});
  // Empty required logs are explicit, distinguishable from missing/unflushed evidence.
  for(const name of ['stages.ndjson','runtime-log.ndjson','network-denials.ndjson'])fs.writeFileSync(path.join(root,'evidence',name),'',{flag:'wx'});
  evidence.stage('control','READY');await handshake();evidence.assertHealthy();
  phase='import';
  const {Miniflare,convertV4MiniflareOptions,Log,LogLevel}=await import(pathToFileURL(path.join(workspace,'node_modules','miniflare','dist','src','index.js')).href);
  evidence.assertHealthy();
  class LocalLog extends Log {
    constructor(){super(LogLevel.DEBUG);}
    logWithLevel(level,message){
      evidence.assertHealthy();const summary=classifyLog(message);
      if(!Number.isInteger(level)||level<=LogLevel.WARN||summary.event==='NETWORK_OR_RUNTIME_ANOMALY'){
        evidence.signalFatal('RUNTIME_LOG_ANOMALY',Error('REDACTED'));return;
      }
      evidence.append('runtime-log.ndjson',{runId,utc:new Date().toISOString(),level,summary});
    }
    error(error){evidence.signalFatal('RUNTIME_LOG_ERROR',error);}
  }
  phase='construct';evidence.stage(phase,'START');
  runtime=new Miniflare(convertV4MiniflareOptions({
    modules:true,script:'export default {fetch(){return new Response("P3 SYNTHETIC LOCAL ONLY")}}',
    host:'127.0.0.1',port:0,compatibilityDate:'2026-10-01',cf:false,
    d1Databases:{P3_TEST:'p3-local-synthetic-'+runId},resourcePersistencePath:path.join(root,'state'),resourceTmpPath:path.join(root,'tmp'),
    telemetry:{enabled:false},log:new LocalLog(),outboundService:()=>deny('worker-outbound')
  }));
  evidence.stage(phase,'SUCCESS');phase='ready';evidence.stage(phase,'START');
  const url=await runtime.ready;
  evidence.assertHealthy();
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!/^\d+$/.test(url.port)||Number(url.port)<1||Number(url.port)>65535)throw Error('BLOCKED endpoint');
  const endpoint={protocol:url.protocol,host:url.hostname,port:url.port};evidence.save('endpoint.json',endpoint);evidence.send('endpoint',endpoint);
  evidence.stage(phase,'SUCCESS');phase='getD1Database';evidence.stage(phase,'START');
  await runtime.getD1Database('P3_TEST');evidence.assertHealthy();bindingAcquired=true;evidence.stage(phase,'SUCCESS');
} catch(error) {
  evidence.signalFatal(phase==='handshake'?'HANDSHAKE_FAILED':'DIAGNOSTIC_FAILURE',error,phase);
  process.exitCode=1;
} finally {
  if(runtime){
    try{if(!evidence.fatal)evidence.stage('dispose','START');await runtime.dispose();disposed=true;if(!evidence.fatal)evidence.stage('dispose','SUCCESS');}
    catch(error){evidence.signalFatal('DISPOSE_FAILED',error,'dispose');process.exitCode=1;}
  }
  globalThis.fetch=originalFetch;
}
if(!evidence.fatal){
  try{
    const result={schema:1,runId,utc:new Date().toISOString(),bindingAcquired,disposed,denied,sqlCalls:0,strictIsolationResult:'UNKNOWN_NOT_TESTED'};
    evidence.save('child-result.json',result);
    const childResultSha256=createHash('sha256').update(fs.readFileSync(path.join(root,'evidence','child-result.json'))).digest('hex');
    evidence.send('final',{bindingAcquired,disposed,sqlCalls:0,strictIsolationResult:'UNKNOWN_NOT_TESTED',childResultSha256});
  }catch(error){evidence.signalFatal('EVIDENCE_FAILURE',error);process.exitCode=1;}
}
