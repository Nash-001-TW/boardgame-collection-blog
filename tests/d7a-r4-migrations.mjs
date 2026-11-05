// Actual project migration directory, fresh LOCAL identities/config/persistence only.
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {migrateIsolatedD1} from './helpers/notbgg-local-d1.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {NotBggLinkRepository} from '../src/lib/notbgg-link-repository.ts';
import {SiteGameRelations} from '../src/lib/site-game-relations.ts';
const evidenceFile='docs/d7a-r4-migration-evidence.json',evidence=JSON.parse(await readFile(evidenceFile,'utf8'));
const migrationDir=path.resolve('migrations'),files=(await readdir(migrationDir)).filter(f=>/^\d+.*\.sql$/.test(f)).sort(),exec=promisify(execFile);
const hash=b=>createHash('sha256').update(b).digest('hex');
const body=await readFile(path.join(migrationDir,'0003_sleeve_size_validation.sql'));
assert.equal(hash(Buffer.concat([Buffer.from([239,187,191]),body])),evidence.encoding.originalSha256);assert.equal(hash(body),evidence.encoding.newSha256);
evidence.cases=[];
for(const upgrade of [false,true]){
 const directory=await mkdtemp(path.join(os.tmpdir(),'notbgg-r4-')),config=path.join(directory,'wrangler.json'),persist=path.join(directory,'state'),id=crypto.randomUUID(),name='r4-synthetic-local';
 const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:path.join(directory,'config')};for(const key of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_EMAIL'])delete env[key];
 let runtime;
 const open=async()=>{runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {}',resourcePersistencePath:path.join(persist,'v3'),d1Databases:{TEST:id},outboundService:()=>new Response('disabled',{status:403})}));return runtime.getD1Database('TEST');};
 const close=async()=>{if(runtime){await runtime.dispose();runtime=undefined;}};
 const apply=async()=>{const args=['d1','migrations','apply',name,'--local','--config',config,'--persist-to',persist];assert.ok(args.includes('--local')&&!args.includes('--remote'));return exec(process.execPath,[path.resolve('node_modules/wrangler/bin/wrangler.js'),...args],{cwd:directory,env,windowsHide:true,maxBuffer:4e6});};
 const tracked=async db=>(await db.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all()).results;
 const schema=async db=>(await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results;
 try{
  await writeFile(config,JSON.stringify({name,compatibility_date:'2026-10-01',d1_databases:[{binding:'TEST',database_name:name,database_id:id,migrations_dir:migrationDir}]}));
  let before=[];let legacy;
  if(upgrade){const db=await open();await migrateIsolatedD1(db,'0013_v2_record_scope.sql');
   await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
   await db.batch(files.filter(f=>f<'0014').map(f=>db.prepare("INSERT INTO d1_migrations(name,applied_at) VALUES(?,'2000-01-01 00:00:00')").bind(f)));before=await tracked(db);
   // If the manager wrongly retries already-applied 0003, fail visibly before UNIQUE.
   await db.prepare("CREATE TRIGGER r4_no_0003_replay BEFORE INSERT ON d1_migrations WHEN NEW.name='0003_sleeve_size_validation.sql' BEGIN SELECT RAISE(ABORT,'R4_UNEXPECTED_0003_REPLAY'); END").run();
   await db.prepare("INSERT INTO v2_games(bgg_id,primary_name,catalog_source) VALUES(194655,'Synthetic existing BGG','bgg')").run();legacy=await db.prepare('SELECT * FROM v2_games WHERE bgg_id=194655').first();await close();
  }
  await apply();let db=await open();const after=await tracked(db);assert.deepEqual(after.map(r=>r.name),files);
  if(upgrade){assert.deepEqual(after.slice(0,13),before);assert.deepEqual(await db.prepare('SELECT * FROM v2_games WHERE bgg_id=194655').first(),legacy);}
  const originalSchema=await schema(db);
  for(const n of ['trg_sleeve_sizes_validate_insert','trg_sleeve_sizes_validate_update','site_game_relations_no_delete','notbgg_link_command_gate','notbgg_linked_type_guard'])assert.ok(originalSchema.some(r=>r.type==='trigger'&&r.name===n),n);
  assert.ok(originalSchema.some(r=>r.type==='index'&&r.name==='idx_site_relations_active'));
  assert.ok((await db.prepare('PRAGMA foreign_key_list(site_game_relations)').all()).results.length>=2);
  assert.equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys,1);
  await db.prepare("INSERT INTO sleeve_sizes(width_tenth_mm,height_tenth_mm) VALUES(100,200)").run();
  await assert.rejects(db.prepare('INSERT INTO sleeve_sizes(width_tenth_mm,height_tenth_mm) VALUES(700,600)').run(),/short side first/);
  await assert.rejects(db.prepare('UPDATE sleeve_sizes SET width_tenth_mm=700,height_tenth_mm=600 WHERE width_tenth_mm=100').run(),/short side first/);
  const repo=new NotBggRepository(db),links=new NotBggLinkRepository(db),relations=new SiteGameRelations(db);
  const game=(await repo.create({name:'Synthetic R4 base',type:'boardgame'},{actor:'synthetic',idempotencyKey:'r4-base'})).game;
  const owner=(await repo.create({name:'Synthetic R4 kit',type:'boardgameaccessory',accessoryCategories:['storage'],relatedGameIds:[{source:'notbgg',notBggId:game.notBggId}]},{actor:'synthetic',idempotencyKey:'r4-kit'})).game;
  const edge=(await relations.list(owner.notBggId))[0];await assert.rejects(db.prepare('DELETE FROM site_game_relations WHERE id=?').bind(edge.id).run(),/Archive site relations/);await relations.archive(owner.notBggId,edge.id,'synthetic');assert.ok((await relations.list(owner.notBggId))[0].archived_at);
  const states=[];for(const action of ['propose','confirm','primary','revoke']){const s=await links.state(game.notBggId);const r=await links.execute(game.notBggId,{action,expectedProfileRevision:1,expectedEventId:s.expectedEventId,reason:'R4 synthetic',...(s.link?{linkId:s.link.id}:{}),...(action==='propose'?{bggId:194655}:{}),...(action==='primary'?{primarySource:'bgg'}:{})},'synthetic');states.push(r.state);}
  assert.deepEqual(states,['candidate','linked','linked','unlinked']);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const dataCounts=async db=>(await db.prepare("SELECT (SELECT count(*) FROM notbgg_ids) ids,(SELECT count(*) FROM notbgg_game_revisions) revisions,(SELECT count(*) FROM notbgg_link_events) linkEvents,(SELECT count(*) FROM site_game_relations) relations").first());
  const counts=await dataCounts(db),beforeRepeat=await tracked(db),beforeSchema=await schema(db);await close();
  const repeat=await apply();db=await open();assert.match(repeat.stdout,/No migrations to apply/i);assert.deepEqual(await tracked(db),beforeRepeat);assert.deepEqual(await schema(db),beforeSchema);assert.deepEqual(await dataCounts(db),counts);
  const row={case:upgrade?'existing synthetic 0013 registration → 0016':'empty → 0001–0016',projectMigrationDirectory:migrationDir,copiedOrPatchedSql:false,status:'PASS',tracking:after,migrationTableColumns:(await db.prepare('PRAGMA table_info(d1_migrations)').all()).results.map(c=>c.name),prior13RegistrationUnchanged:upgrade?true:null,old0003ReplayGuard:upgrade?'not triggered':null,triggerChecks:'INSERT/UPDATE constraints PASS',indexes:'PASS',foreignKeys:'PASS',relationDeleteAndArchive:'PASS',d6States:states,repeatApply:'No migrations to apply; tracking/schema/data counts unchanged'};
  evidence.cases.push(row);console.log(JSON.stringify({case:row.case,status:row.status,migrations:after.length,repeat:row.repeatApply}));
 }finally{await close();if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('notbgg-r4-'))throw new Error('Unsafe cleanup');await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
for(const f of files){const current=hash(await readFile(path.join(migrationDir,f)));assert.equal(current,f==='0003_sleeve_size_validation.sql'?evidence.encoding.newSha256:evidence.originalMigrationHashes[f]);}
evidence.otherMigrationsUnchanged=true;evidence.remoteOperations=false;evidence.status='PASS';await writeFile(evidenceFile,JSON.stringify(evidence,null,2));
