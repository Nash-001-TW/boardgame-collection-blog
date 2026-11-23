// R1 static preparation. Unknown text is omitted, not regex-scrubbed and trusted.
import {appendFileSync,linkSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const errorNames=new Set(['Error','TypeError','RangeError','SyntaxError','AggregateError','AbortError']);
const networkCodes=new Set(['EACCES','EPERM','ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','EADDRINUSE','EPIPE','ABORT_ERR']);
const fatalCodes=new Set(['OUTBOUND_DENIED','URL_PARSE_REJECTED','UNCAUGHT_EXCEPTION','UNHANDLED_REJECTION','HANDSHAKE_FAILED','EVIDENCE_FAILURE','RUNTIME_LOG_ANOMALY','RUNTIME_LOG_ERROR','DIAGNOSTIC_FAILURE','DISPOSE_FAILED','IPC_FAILURE']);
const loopback=new Set(['127.0.0.1','::1','[::1]']);
const ownMessages=new Set(['fetch failed','Fatal state: stage advancement refused','Non-authorized outbound operation','Invalid fetch URL','Handshake invalid','Handshake closed','Handshake timeout','Handshake input error','Parent control channel failed','Evidence operation failed']);
function read(object,key){try{return {present:key in object,value:object[key]};}catch{return {present:true,value:'UNAVAILABLE'};}}
function safeMessage(value){
  if(typeof value!=='string'||value.length>1024)return 'REDACTED';
  if(ownMessages.has(value))return value;
  // Exact closed grammar; do not derive absent structured fields from the message.
  if(/^connect (EACCES|EPERM|ECONNREFUSED|ECONNRESET|ETIMEDOUT) 127\.0\.0\.1:\d{1,5}$/.test(value)){
    const port=Number(value.slice(value.lastIndexOf(':')+1));if(port>0&&port<=65535)return value;
  }
  return 'REDACTED';
}
function safeStack(value){
  if(typeof value!=='string')return 'UNAVAILABLE';
  // Keep only canonical known source labels and numeric locations, never raw paths/functions.
  const frames=[];
  for(const line of value.slice(0,16000).split('\n').slice(1,33)){
    const internal=line.match(/\((node:(?:net|dns|internal\/process\/task_queues)):(\d+):(\d+)\)$/);
    const worker=line.match(/\(\[worker eval\]:(\d+):(\d+)\)$/);
    if(internal)frames.push({source:internal[1],line:Number(internal[2]),column:Number(internal[3])});
    else if(worker)frames.push({source:'worker-eval',line:Number(worker[1]),column:Number(worker[2])});
  }
  return frames.length?frames:'REDACTED';
}
export function classifyLog(message){
  if(typeof message!=='string'||message.length>16000)return {event:'REDACTED_LOG'};
  const ready=message.match(/^Ready on http:\/\/127\.0\.0\.1:(\d{1,5})\/?$/);
  if(ready&&Number(ready[1])>0&&Number(ready[1])<=65535)return {event:'READY_LOOPBACK',port:Number(ready[1])};
  if(/Request\.cf|getaddrinfo|\b(?:EACCES|EPERM|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b/i.test(message))return {event:'NETWORK_OR_RUNTIME_ANOMALY',text:'REDACTED'};
  for(const raw of message.match(/https?:\/\/[^\s)]+/gi)??[]){try{const u=new URL(raw);if(!['127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password)return {event:'NETWORK_OR_RUNTIME_ANOMALY',text:'REDACTED'};}catch{return {event:'NETWORK_OR_RUNTIME_ANOMALY',text:'REDACTED'};}}
  return {event:'REDACTED_LOG'};
}

export function serializeError(value,depth=0,seen=new WeakSet(),budget={nodes:0}) {
  if(depth>8||++budget.nodes>64)return 'LIMIT';
  if(value===null||typeof value!=='object')return 'REDACTED';
  if(seen.has(value))return 'CIRCULAR';seen.add(value);
  const out={};
  for(const key of ['name','message','stack','code','errno','syscall','address','port']) {
    const field=read(value,key);if(!field.present||field.value===undefined)continue;
    const v=field.value;
    if(key==='name')out[key]=errorNames.has(v)?v:'REDACTED';
    else if(key==='message')out[key]=safeMessage(v);
    else if(key==='stack')out[key]=safeStack(v);
    else if(key==='code')out[key]=networkCodes.has(v)?v:'REDACTED';
    else if(key==='errno')out[key]=Number.isSafeInteger(v)&&Math.abs(v)<=65535?v:'REDACTED';
    else if(key==='syscall')out[key]=['connect','getaddrinfo','read','write','listen','bind'].includes(v)?v:'REDACTED';
    else if(key==='address')out[key]=loopback.has(v)?v:'REDACTED';
    else if(key==='port')out[key]=Number.isInteger(v)&&v>0&&v<=65535?v:'REDACTED';
  }
  try{const field=read(value,'cause');if(field.present&&field.value!==undefined)out.cause=serializeError(field.value,depth+1,seen,budget);}catch{out.cause='UNAVAILABLE';}
  try{const field=read(value,'errors');if(field.present)out.errors=Array.isArray(field.value)?field.value.slice(0,16).map(e=>serializeError(e,depth+1,seen,budget)):'UNAVAILABLE';}catch{out.errors='UNAVAILABLE';}
  return out;
}

export function createEvidence(root,runId) {
  const dir=path.join(root,'evidence');let seq=0,fatal=false;
  const files=new Set(['stages.ndjson','runtime-log.ndjson','network-denials.ndjson','endpoint.json','error.json','fatal.json','child-result.json']);
  function target(name){if(!files.has(name))throw Error('Evidence filename outside allowlist');return path.join(dir,name);}
  function save(name,value){writeFileSync(target(name),JSON.stringify(value,null,2),{flag:'wx'});}
  function append(name,value){appendFileSync(target(name),JSON.stringify(value)+'\n');}
  function transmit(kind,payload){
    const row={kind,runId,seq:++seq,utc:new Date().toISOString(),payload};
    const line=JSON.stringify(row)+'\n';
    if(Buffer.byteLength(line)>16384)throw Error('IPC frame exceeds limit');
    // Synchronous pipe write: no delayed console buffer before a blocking bridge call.
    writeFileSync(1,line);return row;
  }
  function signalFatal(code,error,phase=null){
    if(fatal)return;
    fatal=true;process.exitCode=1;
    const safeCode=fatalCodes.has(code)?code:'EVIDENCE_FAILURE';
    const safePhase=['handshake','import','construct','ready','getD1Database','dispose'].includes(phase)?phase:null;
    const utc=new Date().toISOString();
    const temp=path.join(dir,'error.json.tmp');
    let publication='EVIDENCE_MISSING';
    try{
      const safeError=serializeError(error);
      writeFileSync(temp,JSON.stringify({runId,utc,code:safeCode,phase:safePhase,error:safeError},null,2),{flag:'wx'});
      // Same-directory publication is exclusive. Keep the temporary file if publication fails.
      linkSync(temp,target('error.json'));
      publication='PUBLISHED';
      try{unlinkSync(temp);}catch{/* the published file remains available for review */}
    }catch{/* explicitly report missing evidence through both available channels */}
    // Either channel can fail independently. The parent deadline bounds lost notification.
    try{save('fatal.json',{runId,utc,code:safeCode,errorPublication:publication});}catch{}
    try{transmit('fatal',{code:safeCode,errorPublication:publication});}catch{}
  }
  function assertHealthy(){if(fatal)throw Error('Fatal state: stage advancement refused');}
  function guarded(operation){assertHealthy();try{return operation();}catch(error){signalFatal('EVIDENCE_FAILURE',error);throw Error('Evidence operation failed');}}
  return {save:(name,value)=>guarded(()=>save(name,value)),append:(name,value)=>guarded(()=>append(name,value)),send:(kind,payload)=>guarded(()=>transmit(kind,payload)),signalFatal,assertHealthy,get fatal(){return fatal;},stage(phase,status){
    return guarded(()=>{const row={kind:'stage',runId,seq:seq+1,utc:new Date().toISOString(),payload:{phase,status}};
      // Persist the exact row before transmitting it. Parent compares both copies.
      append('stages.ndjson',row);seq++;const line=JSON.stringify(row)+'\n';if(Buffer.byteLength(line)>16384)throw Error('IPC frame exceeds limit');writeFileSync(1,line);return row;});
  }};
}
