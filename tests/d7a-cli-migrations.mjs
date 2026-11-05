// Actual Wrangler migration manager, LOCAL ONLY, fresh config/resource IDs and persistence directory.
import {mkdtemp,mkdir,writeFile,readFile,readdir,copyFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';
const nativeBaseline=process.argv.includes('--baseline-native');
const exec=promisify(execFile),directory=await mkdtemp(path.join(os.tmpdir(),'notbgg-d7a-cli-'));
const config=path.join(directory,'wrangler.json'),migrationDir=path.join(directory,'migrations'),persist=path.join(directory,'state');
const id=crypto.randomUUID(),name='d7a-synthetic-local';
const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:path.join(directory,'config')};
delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_API_KEY;delete env.CLOUDFLARE_EMAIL;delete env.CLOUDFLARE_ACCOUNT_ID;
async function run(args){if(!args.includes('--local')||args.includes('--remote')||!args.includes(config))throw new Error('Only isolated local Wrangler is allowed');return exec(process.execPath,[path.resolve('node_modules/wrangler/bin/wrangler.js'),...args],{cwd:directory,env,maxBuffer:4e6,windowsHide:true});}
try{
 await mkdir(migrationDir);await writeFile(config,JSON.stringify({name,compatibility_date:'2026-10-01',d1_databases:[{binding:'TEST',database_name:name,database_id:id,migrations_dir:migrationDir}]}));
 const files=(await readdir('migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 if(nativeBaseline){const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {}',resourcePersistencePath:path.join(persist,'v3'),d1Databases:{TEST:id},outboundService:()=>new Response('disabled',{status:403})}));try{await migrateIsolatedD1(await mf.getD1Database('TEST'),'0013_v2_record_scope.sql');}finally{await mf.dispose();}}
 const results=[];
 for(const through of (nativeBaseline?[]:['0013_v2_record_scope.sql']).concat(['0014_notbgg.sql','0015_notbgg_collection.sql','0016_notbgg_link_commands.sql'])){
  for(const file of files.filter(f=>f<=through&&(!nativeBaseline||f>='0014')))await copyFile(path.resolve('migrations',file),path.join(migrationDir,file));
  const start=performance.now();const applied=await run(['d1','migrations','apply',name,'--local','--config',config,'--persist-to',persist]);
  const query=await run(['d1','execute',name,'--local','--config',config,'--persist-to',persist,'--command','SELECT name FROM d1_migrations ORDER BY id','--json']);
  let tracked;try{tracked=JSON.parse(query.stdout).flatMap(x=>x.results??[]).map(x=>x.name);}catch{tracked=null;}
  results.push({through,ms:performance.now()-start,success:true,tracking:tracked,cliReportedApplied:/successfully|applied|No migrations/i.test(applied.stdout)});
 }
 const evidence=JSON.parse(await readFile(path.resolve('docs/d7a-local-evidence.json'),'utf8'));evidence[nativeBaseline?'wranglerUpgradeMigrations':'wranglerLocalMigrations']=results;await writeFile(path.resolve('docs/d7a-local-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(results,null,2));
}catch(error){const failure={status:'FAIL',localOnly:true,nativeBaseline,message:String(error.message).slice(0,1800),stdout:String(error.stdout??'').slice(-6000)};const evidence=JSON.parse(await readFile(path.resolve('docs/d7a-local-evidence.json'),'utf8'));evidence[nativeBaseline?'wranglerUpgradeMigrations':'wranglerLocalMigrations']=failure;await writeFile(path.resolve('docs/d7a-local-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(failure));process.exitCode=1;}
finally{if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('notbgg-d7a-cli-'))throw new Error('Unsafe cleanup');await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
