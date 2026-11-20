import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {bggXml,seedBggRelations} from './helpers/bgg-sync-fixture.ts';
import {handleBggAdminRequest} from '../src/lib/bgg-admin-api.ts';
import {readBggSync} from '../src/lib/bgg-sync-admin.ts';
import {readPublicLiveRelations,handlePublicLiveRelations} from '../src/lib/public-live-relations.ts';
import {readRelationAdmin} from '../src/lib/relation-admin.ts';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('0022 preserves old cache timestamps and relation rows without importing history',()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')&&f<'0022').sort())sqlite.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
  sqlite.exec(`INSERT INTO bgg_games(bgg_id,name,updated_at) VALUES(999,'Historical','2000-01-01');
   INSERT INTO v2_games(id,bgg_id,primary_name) VALUES(1,999,'One'),(2,998,'Two');
   INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,notes) VALUES(1,2,'other','PRIVATE_HISTORY');`);
  const before=sqlite.prepare('SELECT * FROM v2_game_relations').get();
  sqlite.exec(readFileSync('migrations/0022_bgg_sync_and_relations.sql','utf8'));
  const {admin_revision,admin_confirmed,archived_at,...after}=sqlite.prepare('SELECT * FROM v2_game_relations').get()!;
  assert.deepEqual(after,{...before});assert.equal(admin_revision,0);assert.equal(admin_confirmed,0);assert.equal(archived_at,null);
  const cache=sqlite.prepare('SELECT * FROM bgg_games').get()!;assert.equal(cache.last_success_at,null);assert.equal(cache.last_attempt_at,null);assert.equal(cache.cache_json,null);assert.equal(cache.updated_at,'2000-01-01');assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_bgg_sync_commands').get()?.n,0);
 }finally{sqlite.close();}
});

test('BGG mock synchronization and separate relation graphs',async t=>{
 const f=await sleeveWorkflowFixture(),auth=await accessFixture();
 try{
 seedBggRelations(f.sqlite);const token=crypto.randomUUID()+crypto.randomUUID(),jwt=await auth.token();
 const bindings={...auth.bindings,DB:f.db,BGG_API_TOKEN:token,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
 let mode='success',calls=0,sequence=0;const delays:number[]=[];
 const fetcher:typeof fetch=async(input,init)=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://boardgamegeek.com');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer '+token);assert.equal(init?.redirect,'error');
  if(mode==='http')return new Response(token,{status:503});if(mode==='xml')return new Response('<items><item>');if(mode==='wrong')return new Response(bggXml(42));if(mode==='echo')return new Response(bggXml(Number(url.searchParams.get('id'))).replace('Fixture description',token));if(mode==='throw')throw new Error(token);if(mode==='timeout')throw new DOMException('timed out','TimeoutError');if(mode==='large')return new Response('x'.repeat(2_000_001));
  const id=Number(url.searchParams.get('id'));return new Response(bggXml(id,id===900002?'boardgameexpansion':'boardgame',id===900002?'<link type="boardgameexpansion" id="900001" value="Base" inbound="true"/>':''));};
 const dependencies={fetcher,sleep:async(ms:number)=>{delays.push(ms);}};
 const req=(body:unknown,key:string,jwtValue:string|null=jwt)=>new Request('http://localhost/api/admin/bgg',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost','X-NotBGG-Request':'1','Idempotency-Key':key,...(jwtValue?{'Cf-Access-Jwt-Assertion':jwtValue}:{})},body:JSON.stringify(body)});
 const send=(body:unknown,key='bgg-test-'+(++sequence),jwtValue:string|null=jwt)=>{f.sqlite.exec('UPDATE v2_bgg_sync_gate SET next_allowed=0');return handleBggAdminRequest(req(body,key,jwtValue),bindings,dependencies);};
 const relation=(domain='game',sourceId=402,targetId=401,type='expansion_of')=>({domain,action:'save',id:0,revision:0,sourceId,targetId,type,confirmed:true,notes:'PRIVATE_RELATION_NOTE'});
 const snapshot=()=>JSON.stringify(['v2_games','v2_collection_items','v2_owned_copies','v2_component_definitions','v2_copy_components','v2_sleeve_requirements','v2_sleeve_applications','v2_purchase_orders'].map(table=>f.sqlite.prepare('SELECT * FROM '+table+' ORDER BY id').all()));
 await t.test('authorization, bounded batches and no credential inputs accepted',async()=>{
  assert.equal((await send({action:'sync',ids:[900001]},undefined,null)).status,401);
  assert.equal((await send({action:'sync',ids:[900001]},undefined,await auth.token({email:'viewer@example.test'}))).status,403);
  for(const ids of [[],[0],[1,1],[1,2,3,4],['1']])assert.equal((await send({action:'sync',ids})).status,400);
  assert.equal((await send({action:'sync',ids:[900001],token:'fake'})).status,400);assert.equal(calls,0);
 });
 await t.test('success reuses full parser, batch spacing, replay and no personal mutations',async()=>{
  const before=snapshot(),response=await send({action:'sync',ids:[900001,900002]},'sync-two-items');assert.equal(response.status,201);
  assert.ok(!(await response.text()).includes(token));assert.equal(calls,2);assert.deepEqual(delays,[2000]);
  const row=f.sqlite.prepare('SELECT * FROM bgg_games WHERE bgg_id=900001').get()!,cache=JSON.parse(String(row.cache_json));
  assert.equal(cache.name,'Fixture 900001');assert.deepEqual(cache.alternativeNames,['Alternative']);assert.equal(cache.designers[0].name,'Designer');assert.equal(cache.averageRating,7.5);assert.equal(cache.overallRank,10);assert.ok(row.last_success_at);
  assert.equal((await send({action:'sync',ids:[900001,900002]},'sync-two-items')).status,200);assert.equal(calls,2);assert.equal(snapshot(),before);
 });
 await t.test('HTTP/XML/identity/timeout/size failures preserve success and sanitize credentials',async()=>{
  const previous=f.sqlite.prepare('SELECT cache_json,last_success_at FROM bgg_games WHERE bgg_id=900001').get();
  for(const failure of ['http','xml','wrong','echo','throw','timeout','large']){mode=failure;const start=calls;const response=await send({action:'sync',ids:[900001]});assert.equal(response.status,201);const body=await response.text();assert.ok(body.includes('failed'));assert.ok(!body.includes(token));assert.ok(calls-start<=2);assert.deepEqual(f.sqlite.prepare('SELECT cache_json,last_success_at FROM bgg_games WHERE bgg_id=900001').get(),previous);}
  assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT * FROM v2_bgg_sync_commands').all()).includes(token));assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT * FROM bgg_games').all()).includes(token));mode='success';
 });
 await t.test('global lease blocks duplicate concurrency, cooldown and stale sync status',async()=>{
  let release!:()=>void,started!:()=>void;const start=new Promise<void>(r=>started=r),hold=new Promise<void>(r=>release=r);
  f.sqlite.exec('UPDATE v2_bgg_sync_gate SET next_allowed=0');
  const running=handleBggAdminRequest(req({action:'sync',ids:[900003]},'held-sync-001'),bindings,{...dependencies,fetcher:async(...args)=>{started();await hold;return fetcher(...args);}});await start;
  assert.equal((await send({action:'sync',ids:[900004]})).status,409);release();assert.equal((await running).status,201);
  assert.equal((await handleBggAdminRequest(req({action:'sync',ids:[900004]},'cooldown-sync-001'),bindings,dependencies)).status,409);
  f.sqlite.exec("UPDATE bgg_games SET sync_status='syncing',sync_owner='expired' WHERE bgg_id=900001");const list=await readBggSync(f.db,new URLSearchParams({q:'900001'}));assert.equal(list.rows[0].last_error_code,'BGG_INTERRUPTED');
 });
 let relationId=0;
 await t.test('game relations create/edit, role direction, symmetry duplicates and pending status',async()=>{
  assert.equal((await send(relation('game',401,402))).status,400);assert.equal((await send(relation('game',401,401,'other'))).status,400);assert.equal((await send(relation('game',401,999,'other'))).status,400);
  const response=await send(relation());assert.equal(response.status,201);relationId=(await response.json() as any).data.id;
  assert.equal((await send(relation())).status,409);assert.equal((await send({...relation(),id:relationId,revision:1,targetId:405,confirmed:false})).status,201);
  assert.equal((await send({...relation(),id:relationId,revision:1})).status,409);
  assert.equal((await send(relation('game',401,405,'same_series'))).status,201);assert.equal((await send(relation('game',405,401,'same_series'))).status,409);
  assert.equal((await send(relation('game',405,401,'other'))).status,201);assert.equal((await send(relation('game',401,405,'other'))).status,201);
  assert.equal((await send({...relation(),id:relationId,revision:2})).status,201);
 });
 await t.test('collection combinations are separate, no implicit copies/costs and cyclic containment fails',async()=>{
  const before=snapshot();assert.equal((await send(relation('collection'))).status,201);assert.equal((await send(relation('collection',403,401,'bundle_contains'))).status,201);
  assert.equal(snapshot(),before);
  f.sqlite.exec("INSERT INTO v2_collection_items(id,display_name,item_type) VALUES(406,'Second bundle','bundle')");
  assert.equal((await send(relation('collection',403,406,'bundle_contains'))).status,201);assert.equal((await send(relation('collection',406,403,'bundle_contains'))).status,409);
  assert.equal((await send(relation('collection',401,402))).status,400);
  const list=await readRelationAdmin(f.db,new URLSearchParams({domain:'collection',source:'403'}));assert.equal(list.rows.length,2);
  const first=Number(f.sqlite.prepare("SELECT id FROM v2_collection_relations WHERE relation_type='expansion_of'").get()?.id);
  assert.equal((await send({...relation('collection'),id:first,revision:1,targetId:405})).status,201);
  assert.equal((await send({...relation('collection'),id:first,revision:1})).status,409);
 });
 await t.test('public relation sources, base/expansion roles, ownership and private field exclusion',async()=>{
  const base=await readPublicLiveRelations(f.db,'BGG:900001','en');assert.ok(base.relations.some(r=>r.source==='bgg'&&r.role==='expansion'&&r.owned));assert.ok(base.relations.some(r=>r.source==='manual'&&r.kind==='expansion_of'));
  const expansion=await readPublicLiveRelations(f.db,'BGG:900002','zh-TW');assert.ok(expansion.relations.some(r=>r.role==='base'));
  assert.ok(!JSON.stringify(base).includes('PRIVATE'));assert.ok(!JSON.stringify(base).includes(token));assert.ok(!JSON.stringify(base).includes('last_attempt'));
  const failedDb={prepare:()=>{throw new Error(token);}} as unknown as D1Database;const failed=await handlePublicLiveRelations(new Request('http://localhost/api/public/relations/BGG:900001'),failedDb,'BGG:900001');assert.equal(failed.status,503);assert.ok(!(await failed.text()).includes(token));
 });
 await t.test('BGG evidence and manual records are retained across refresh and archive',async()=>{
  const manual=f.sqlite.prepare('SELECT * FROM v2_game_relations WHERE id=?').get(relationId);
  assert.equal((await send({action:'sync',ids:[900001]})).status,201);assert.deepEqual(f.sqlite.prepare('SELECT * FROM v2_game_relations WHERE id=?').get(relationId),manual);
  assert.equal((await send({domain:'game',action:'archive',id:relationId,revision:3})).status,201);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_game_relations WHERE id=?').get(relationId)?.n,1);
  f.sqlite.exec("INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,relation_source) VALUES(401,402,'other','bgg')");
  const official=Number(f.sqlite.prepare("SELECT id FROM v2_game_relations WHERE relation_source='bgg'").get()?.id);
  assert.equal((await send({domain:'game',action:'archive',id:official,revision:0})).status,409);
  const count=f.sqlite.prepare('SELECT COUNT(*) n FROM v2_game_relations').get()?.n;
  f.sqlite.exec("CREATE TRIGGER fixture_relation_failure BEFORE INSERT ON v2_relation_admin_commands BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.equal((await send(relation('game',404,401,'accessory_for'))).status,503);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_game_relations').get()?.n,count);f.sqlite.exec('DROP TRIGGER fixture_relation_failure');
  const baseline=await readBggSync(f.db,new URLSearchParams({q:String(f.bggId)}));assert.equal(baseline.rows[0].last_success_at,null);
 });
 }finally{f.sqlite.close();auth.restore();}
});
