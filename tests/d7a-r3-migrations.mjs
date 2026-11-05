// Diagnostic controls only: repository migrations are never rewritten.
import {unstable_splitSqlQuery as split} from 'wrangler';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {isolatedNotBggD1,migrateIsolatedD1,migrationStatements} from './helpers/notbgg-local-d1.ts';
const files=(await readdir('migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
const originals=new Map(await Promise.all(files.map(async f=>[f,await readFile('migrations/'+f)])));
const hash=b=>createHash('sha256').update(b).digest('hex');
const sql=originals.get('0003_sleeve_size_validation.sql').toString('utf8');
const result={versions:{wrangler:'4.149.0',node:process.version},order:files,bomFiles:files.filter(f=>originals.get(f).subarray(0,3).equals(Buffer.from([239,187,191]))),splitter:{original:split(sql),bomRemovedInMemory:split(sql.replace(/^\uFEFF/,''))},native:{},cli:[],unchangedHashes:{}};
assert.equal(result.splitter.original.length,3);assert.equal(result.splitter.original[1],'END');assert.equal(result.splitter.bomRemovedInMemory.length,2);
const local=await isolatedNotBggD1();try{
 await migrateIsolatedD1(local.db,'0002_normalize_sleeve_sizes.sql');
 result.versions.sqlite='NOT MEASURED: local D1 authorizer rejects sqlite_version()';result.versions.miniflare=JSON.parse(await readFile('node_modules/miniflare/package.json','utf8')).version;
 result.native.columns=(await local.db.prepare('PRAGMA table_info(sleeve_sizes)').all()).results.map(c=>c.name);
 try{await local.db.batch(result.splitter.original.map(s=>local.db.prepare(s)));result.native.fragmented='UNEXPECTED SUCCESS';}catch(e){result.native.fragmented=String(e);}
 assert.match(result.native.fragmented,/incomplete input/i);
 // Keep BOM on first complete statement: SQLite accepts it; only the CLI splitter fails.
 const complete=migrationStatements(sql);await local.db.batch(complete.map((s,i)=>local.db.prepare((i===0?'\uFEFF':'')+s)));
 result.native.completeWithBom=(await local.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_sleeve_sizes_validate_%' ORDER BY name").all()).results;
 assert.equal(result.native.completeWithBom.length,2);
 await assert.rejects(local.db.prepare('INSERT INTO sleeve_sizes(width_tenth_mm,height_tenth_mm) VALUES(700,600)').run(),/short side first/);
 result.native.constraint='PASS';
}finally{await local.dispose();}
const exec=promisify(execFile);
for(const normalized of [false,true]){
 const directory=await mkdtemp(path.join(os.tmpdir(),'notbgg-r3-migrations-'));
 try{
  const config=path.join(directory,'wrangler.json'),migrations=path.join(directory,'migrations'),persist=path.join(directory,'state'),name='r3-synthetic';await mkdir(migrations);
  for(const[f,b]of originals)await writeFile(path.join(migrations,f),normalized?b.toString('utf8').replace(/^\uFEFF/,''):b);
  await writeFile(config,JSON.stringify({name,compatibility_date:'2026-10-01',d1_databases:[{binding:'TEST',database_name:name,database_id:crypto.randomUUID(),migrations_dir:migrations}]}));
  const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:path.join(directory,'config')};for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_EMAIL'])delete env[key];
  const run=args=>{assert.ok(args.includes('--local')&&!args.includes('--remote')&&args.includes(config));return exec(process.execPath,[path.resolve('node_modules/wrangler/bin/wrangler.js'),...args],{cwd:directory,env,windowsHide:true,maxBuffer:4e6});};
  const row={control:normalized?'BOM removed in disposable copies ONLY':'original bytes',status:'PASS',migrations:[],error:null};
  try{await run(['d1','migrations','apply',name,'--local','--config',config,'--persist-to',persist]);}catch(e){row.status='FAIL';row.error=String(e.stderr).replace(/\x1b\[[0-9;]*m/g,'').split('Logs were written')[0].trim();}
  const query=await run(['d1','execute',name,'--local','--config',config,'--persist-to',persist,'--command',"SELECT name FROM d1_migrations ORDER BY id",'--json']);row.migrations=JSON.parse(query.stdout).flatMap(x=>x.results??[]).map(x=>x.name);
  if(normalized){assert.equal(row.status,'PASS');assert.deepEqual(row.migrations,files);const checks=await run(['d1','execute',name,'--local','--config',config,'--persist-to',persist,'--command','PRAGMA foreign_key_check','--json']);row.foreignKeys=JSON.parse(checks.stdout).flatMap(x=>x.results??[]);assert.deepEqual(row.foreignKeys,[]);}
  else{assert.equal(row.status,'FAIL');assert.deepEqual(row.migrations,files.slice(0,2));assert.match(row.error,/incomplete input/i);}
  result.cli.push(row);console.log(JSON.stringify(row));
 }finally{if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('notbgg-r3-migrations-'))throw new Error('Unsafe cleanup');await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
for(const[f,b]of originals){assert.deepEqual(await readFile('migrations/'+f),b);result.unchangedHashes[f]=hash(b);}
await writeFile('docs/d7a-r3-migration-evidence.json',JSON.stringify(result,null,2));console.log('R3 migration investigation complete; all repository migration hashes unchanged');
