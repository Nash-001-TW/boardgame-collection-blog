import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';

const args=process.argv.slice(2), value=k=>args[args.indexOf(k)+1];
const workspace=path.resolve(value('--workspace')),root=path.resolve(value('--run-root'));
const expected=path.join(workspace,'.wrangler','p3-stage1','runs','P3S1-20261118-001');
if(root!==expected||value('--phase')!=='1'||value('--runtime')!=='miniflare-local'||!args.includes('--offline')||!args.includes('--allow-synthetic-bootstrap')||!args.includes('--retain-state'))throw Error('BLOCKED: invalid launch scope');
if(path.resolve(process.cwd())!==root)throw Error('BLOCKED: wrong cwd');
for(let p=root;p;){const s=await fs.lstat(p);if(s.isSymbolicLink())throw Error('BLOCKED: linked path');const parent=path.dirname(p);if(parent===p)break;p=parent;}
const evidence=path.join(root,'evidence');await fs.mkdir(evidence,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['runner.mjs','local-runtime.ts','trusted-snapshot.ts','stage1.test.ts','sql/stage1-only.sql','tsconfig.json'].map(f=>path.join(workspace,'tests','p3-stage1',f));
const productFiles=['src/lib/component-classifier.ts','src/lib/component-classifier-adapter.ts','src/lib/physical-component-proof.ts','tests/helpers/notbgg-local-d1.ts','package-lock.json'].map(f=>path.join(workspace,f));
const schemas=(await fs.readdir(path.join(workspace,'migrations'))).filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort();
if(schemas.length!==22||schemas.some((f,i)=>Number(f.slice(0,4))!==i+1))throw Error('BLOCKED: unexpected schema inputs');
const marker=path.join(root,'started.json');await fs.writeFile(marker,JSON.stringify({pid:process.pid,started:new Date().toISOString()}),{flag:'wx'});
const forbidden=Object.keys(process.env).filter(k=>/^(CLOUDFLARE_|CF_|BGG_|ACCESS_|ADMIN_|NODE_OPTIONS$|NODE_PATH$)|PROXY/i.test(k));
if(forbidden.length)throw Error('BLOCKED: forbidden inherited env names');
for(const [k,sub]of Object.entries({TEMP:'tmp',TMP:'tmp',HOME:'home',USERPROFILE:'home',APPDATA:'appdata',LOCALAPPDATA:'localappdata',XDG_CONFIG_HOME:'config',XDG_CACHE_HOME:'cache'}))if(path.resolve(process.env[k]??'')!==path.join(root,sub))throw Error('BLOCKED: env outside run root '+k);
const fileHashes=[];for(const p of [...sourceFiles,...productFiles])fileHashes.push({path:p,sha256:hash(await fs.readFile(p))});
// Allow only the explicitly reviewed direct imports. Transitive Miniflare is installed code.
for(const p of sourceFiles.filter(p=>/\.(ts|mjs)$/.test(p))){const text=await fs.readFile(p,'utf8');for(const m of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)){const s=m[1];if(!s.startsWith('node:')&&!s.startsWith('./')&&!s.startsWith('../../src/lib/component-classifier')&&!s.startsWith('../../src/lib/physical-component-proof')&&!s.startsWith('../helpers/notbgg-local-d1')&&s!=='miniflare')throw Error('BLOCKED: unreviewed direct import '+s);}}
const schemaDir=path.join(root,'schema-input');await fs.mkdir(schemaDir,{recursive:false});const schemaHashes=[];
for(const f of schemas){const b=await fs.readFile(path.join(workspace,'migrations',f));const dest=path.join(schemaDir,f);await fs.writeFile(dest,b,{flag:'wx'});if(hash(await fs.readFile(dest))!==hash(b))throw Error('BLOCKED: schema copy hash');schemaHashes.push({file:f,sha256:hash(b)});}
const packages={};for(const p of ['miniflare','workerd','tsx'])packages[p]=JSON.parse(await fs.readFile(path.join(workspace,'node_modules',p,'package.json'),'utf8')).version;
const manifest={runId:path.basename(root),startedUTC:new Date().toISOString(),startedTaipei:new Date().toLocaleString('sv-SE',{timeZone:'Asia/Taipei'}),pid:process.pid,workspace:await fs.realpath(workspace),root:await fs.realpath(root),cwd:process.cwd(),node:process.version,platform:process.platform,arch:process.arch,os:os.release(),packages,fileHashes,schemaHashes,envNames:Object.keys(process.env).sort(),network:'worker outbound deny; Node fetch loopback only; not OS-wide firewall',remoteBindings:0,kvBindings:0,status:'PREPARED',verification:'LOCAL_D1_COMPATIBLE / NOT_REMOTE_D1_VERIFIED'};
await fs.writeFile(path.join(evidence,'manifest.json'),JSON.stringify(manifest,null,2));
await fs.writeFile(path.join(evidence,'network-denials.ndjson'),'');
const out=createWriteStream(path.join(evidence,'stdout.log'),{flags:'wx'}),err=createWriteStream(path.join(evidence,'stderr.log'),{flags:'wx'});
const childArgs=[path.join(workspace,'node_modules','tsx','dist','cli.mjs'),'--tsconfig',path.join(workspace,'tests','p3-stage1','tsconfig.json'),'--test','--test-concurrency=1','--test-reporter=tap',path.join(workspace,'tests','p3-stage1','stage1.test.ts')];
const child=spawn(process.execPath,childArgs,{cwd:root,env:{...process.env,P3_RUN_ROOT:root,P3_WORKSPACE:workspace},shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
manifest.childPid=child.pid;manifest.command={file:process.execPath,args:childArgs};await fs.writeFile(path.join(evidence,'manifest.json'),JSON.stringify(manifest,null,2));
child.stdout.on('data',b=>{out.write(b);process.stdout.write(b);});child.stderr.on('data',b=>{err.write(b);process.stderr.write(b);});
// Outer Process.Kill(true) is the 15-minute process-tree backstop; never target other processes.
let exit;try{exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});}catch(e){exit={code:1,error:String(e)};}
await new Promise(r=>out.end(r));await new Promise(r=>err.end(r));
manifest.finishedUTC=new Date().toISOString();manifest.childExit=exit;manifest.childStopped=true;
const changed=[];for(const f of fileHashes)if(hash(await fs.readFile(f.path))!==f.sha256)changed.push(f.path);
for(const f of schemaHashes)if(hash(await fs.readFile(path.join(workspace,'migrations',f.file)))!==f.sha256)changed.push(f.file);
manifest.sourceChanges=changed;manifest.status=changed.length?'ISOLATION_STOP':exit.code===0?'STAGE1_EXECUTION_COMPLETE':'STOPPED_SEE_CASES';
await fs.writeFile(path.join(evidence,'manifest.json'),JSON.stringify(manifest,null,2));
process.exitCode=changed.length?2:exit.code??1;
