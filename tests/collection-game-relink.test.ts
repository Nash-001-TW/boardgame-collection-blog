import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';
import { CollectionV2Writer, CollectionWriteError } from '../src/lib/collection-v2-management.ts';
import { getGames } from '../src/lib/games.ts';
import { formatNotBggId } from '../src/lib/game-identity.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { isolatedNotBggD1, migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const migrations = readdirSync('migrations').filter(name => /^00(?:0[1-9]|1\d|2[0-8])_.*\.sql$/.test(name)).sort();

test('relink previews and commits through the authenticated collection API on SQLite 0001–0028', async () => {
 const sqlite = new DatabaseSync(':memory:');
 const auth = await accessFixture();
 try {
  assert.deepEqual(migrations.map(name => Number(name.slice(0,4))), Array.from({length:28}, (_, i) => i+1));
  for (const name of migrations) sqlite.exec(readFileSync('migrations/'+name,'utf8'));
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(sqlite.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  sqlite.exec(`
   BEGIN;
   INSERT INTO v2_games(id,bgg_id,primary_name) VALUES (1,999991,'Old BGG'),(2,NULL,'New expansion');
   INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES (2,'fixture','fixture');
   INSERT INTO notbgg_games(seq,game_id,name,type) VALUES (2,2,'New expansion','boardgameexpansion');
   INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) VALUES (2,1,'{}','fixture');
   INSERT INTO bgg_games(bgg_id,name,last_success_at,cache_json)
     VALUES (999992,'Synced accessory','2026-11-27','{"bggId":999992,"name":"Synced accessory","gameType":"boardgameaccessory"}');
   INSERT INTO v2_collection_items(id,game_id,item_type,display_name,record_scope) VALUES
     (1,1,'base','My copy','test'),(2,2,'expansion','Other copy','test'),(3,NULL,'unknown','Legacy','test');
   INSERT INTO v2_owned_copies(id,collection_item_id) VALUES (1,1);
   INSERT INTO v2_component_definitions(id,collection_item_id,component_name) VALUES (1,1,'Fixture component');
   INSERT INTO v2_copy_components(owned_copy_id,component_definition_id,actual_quantity) VALUES (1,1,0);
   INSERT INTO v2_component_photos(definition_id,object_key,thumb_key,content_type,width,height,byte_size)
     VALUES (1,'fixture/full.webp','fixture/thumb.webp','image/webp',1,1,1);
   INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES (1,617,897);
   INSERT INTO v2_sleeve_requirements(collection_item_id,owned_copy_id,size_id,quantity_sheets) VALUES (1,1,1,42);
   INSERT INTO v2_purchase_orders(id,item_subtotal_minor) VALUES (1,100);
   INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id) VALUES (1,1,'Fixture',1);
   INSERT INTO v2_purchase_allocations(purchase_order_id,owned_copy_id,allocated_minor) VALUES (1,1,100);
   INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type) VALUES (2,1,'expansion_of');
   COMMIT;
  `);
  const token = await auth.token();
  const db = sqliteD1(sqlite);
  const endpoint = 'https://example.test/api/admin/collection/';
  const dependentTables = ['v2_owned_copies','v2_component_definitions','v2_copy_components','v2_component_photos',
   'v2_sleeve_requirements','v2_purchase_orders','v2_purchase_order_lines','v2_purchase_allocations','v2_collection_relations'];
  const dependents = () => dependentTables.map(table => sqlite.prepare('SELECT * FROM '+table+' ORDER BY id').all());
  const before = dependents();
  const ref = {source:'notbgg', notBggId:'NotBGG:000002'};
  const command = {action:'relink', ref, revision:0, renameToGame:false, confirmTypeChange:false};
  const call = async (status: number, options: {id?:number; suffix?:string; body?:object; key?:string; jwt?:string; origin?:string; binding?:D1Database} = {}) => {
   const response = await handleCollectionAdminRequest(new Request(endpoint + (options.id ?? 1) + '?scope=test' + (options.suffix ?? ''), {
    method: options.body ? 'PATCH' : 'GET',
    headers: {'Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':options.key ?? 'relink-0001',
     'Cf-Access-Jwt-Assertion':options.jwt ?? token, Origin:options.origin ?? 'https://example.test'},
    body: options.body && JSON.stringify(options.body),
   }), {...auth.bindings, DB:options.binding ?? db, NOTBGG_WRITE_LIMITER:{limit:async () => ({success:true})}});
   assert.equal(response.status, status, await response.clone().text());
   return response.json() as Promise<{data?:unknown; error?:{code:string}}>;
  };
  const expectError = async (status:number, code:string, options:Parameters<typeof call>[1]) =>
   assert.equal((await call(status, options)).error?.code, code);
  const preview = '&action=relink-preview&ref=NotBGG%3A000002';
  await expectError(401,'UNAUTHENTICATED',{suffix:preview,jwt:''});
  await expectError(401,'UNAUTHENTICATED',{body:command,jwt:''});
  await expectError(403,'ORIGIN_REJECTED',{body:command,origin:'https://elsewhere.test'});
  await expectError(400,'INVALID_IDEMPOTENCY_KEY',{body:command,key:'short'});
  const rowCount = () => sqlite.prepare('SELECT count(*) AS n FROM v2_collection_game_changes').get()?.n;
  assert.deepEqual((await call(200,{suffix:preview})).data, {
   revision:0,current:{gameId:1,name:'Old BGG',sourceId:'BGG:999991',itemType:'base'},
   target:{gameId:2,name:'New expansion',itemType:'expansion',ref},
   sameGame:false,typeChanged:true,hasOtherCollections:true,
   affected:['publicGamePage','seriesSpending','publicSleeves'],
   preserved:{copies:1,components:1,photos:1,counts:1,sleeves:1,purchases:1,relations:1},
  });
  await expectError(409,'TYPE_CHANGE_CONFIRMATION_REQUIRED',{body:command});
  assert.equal(rowCount(),0);
  const accepted = {...command,confirmTypeChange:true};
  const state = () => sqlite.prepare('SELECT game_id,item_type,display_name FROM v2_collection_items WHERE id=1').get();
  const race = await Promise.all([call(200,{body:accepted}),call(200,{body:accepted})]);
  assert.deepEqual(race.map(row => (row.data as {replayed:boolean}).replayed).sort(),[false,true]);
  assert.deepEqual({...state()},{game_id:2,item_type:'expansion',display_name:'My copy'});
  assert.equal(rowCount(),1);
  assert.equal(sqlite.prepare('SELECT operation FROM v2_collection_events WHERE collection_item_id=1 AND revision=1').get()?.operation,'update');
  assert.equal(sqlite.prepare('SELECT revision FROM v2_collection_management WHERE collection_item_id=1').get()?.revision,1);
  await expectError(409,'IDEMPOTENCY_CONFLICT',{body:{...accepted,renameToGame:true}});
  await expectError(409,'CONFLICT',{body:accepted,key:'relink-stale'});
  await expectError(409,'SAME_GAME',{body:{...accepted,revision:1},key:'relink-same'});
  const [change] = (await call(200,{suffix:'&action=relink-history'})).data as Record<string,unknown>[];
  assert.deepEqual({...change,occurred_at:'timestamp'},{
   revision:1,from_game_id:1,to_game_id:2,from_item_type:'base',to_item_type:'expansion',
   actor:'verified-admin-subject',occurred_at:'timestamp',from_name:'Old BGG',to_name:'New expansion',
  });
  assert.match(String(change.occurred_at),/^\d{4}-\d{2}-\d{2} /);
  assert.throws(() => sqlite.exec("UPDATE v2_collection_game_changes SET actor='someone else'"),/Immutable audit/);
  assert.throws(() => sqlite.exec('DELETE FROM v2_collection_game_changes'),/Immutable audit/);

  const bggRef = {source:'bgg', bggId:999992};
  const toBgg = {...accepted,ref:bggRef,revision:1,renameToGame:true};
  await call(200,{suffix:'&action=relink-preview&ref=BGG%3A999992'});
  assert.equal(sqlite.prepare('SELECT id FROM v2_games WHERE bgg_id=999992').get(),undefined);
  sqlite.exec(`CREATE TRIGGER relink_fixture_abort BEFORE UPDATE OF game_id ON v2_collection_items
   BEGIN SELECT RAISE(ABORT,'fixture abort'); END;`);
  await expectError(500,'SERVICE_UNAVAILABLE',{body:toBgg,key:'relink-bgg'});
  assert.equal(rowCount(),1);
  assert.equal(sqlite.prepare('SELECT id FROM v2_games WHERE bgg_id=999992').get(),undefined);
  assert.equal(sqlite.prepare('SELECT revision FROM v2_collection_management WHERE collection_item_id=1').get()?.revision,1);
  sqlite.exec('DROP TRIGGER relink_fixture_abort');
  await call(200,{body:toBgg,key:'relink-bgg'});
  assert.equal(state()?.display_name,'Synced accessory');
  assert.equal(state()?.item_type,'accessory');
  assert.equal(state()?.game_id,sqlite.prepare('SELECT id FROM v2_games WHERE bgg_id=999992').get()?.id);
  assert.equal((await call(200,{body:accepted})).data && rowCount(),2);
  assert.deepEqual(dependents(),before);

  sqlite.exec("INSERT INTO v2_collection_management(collection_item_id,revision,archived_at) VALUES(2,1,'2026-11-27')");
  await expectError(409,'ARCHIVED',{id:2,suffix:preview});
  await expectError(409,'ARCHIVED',{id:2,body:toBgg,key:'relink-archive'});
  const staticGame = getGames().find(game => game.bgg && game.bggId !== 999991 && game.bggId !== 999992);
  assert.ok(staticGame);
  await call(200,{id:3,body:{...accepted,ref:{source:'bgg',bggId:staticGame.bggId}},key:'relink-legacy'});
  assert.deepEqual({...sqlite.prepare('SELECT from_game_id FROM v2_collection_game_changes WHERE collection_item_id=3').get()},{from_game_id:null});
  assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
 } finally {
  auth.restore();
  sqlite.close();
 }
});

test('local D1 relink shares the revision gate with field edits and rolls back the losing batch', async () => {
 const local = await isolatedNotBggD1();
 const {db} = local;
 try {
  await migrateIsolatedD1(db, migrations.at(-1));
  await db.batch([
   db.prepare("INSERT INTO v2_games(id,primary_name) VALUES (1,'Previous'),(2,'Target')"),
   db.prepare("INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES (2,'fixture','fixture')"),
   db.prepare("INSERT INTO notbgg_games(seq,game_id,name,type) VALUES (2,2,'Target','boardgame')"),
   db.prepare("INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) VALUES (2,1,'{}','fixture')"),
   db.prepare("INSERT INTO v2_collection_items(id,game_id,item_type,display_name,record_scope) VALUES (1,1,'base','My copy','test')"),
  ]);
  const ref = {source:'notbgg',notBggId:formatNotBggId(2)} as const;
  const context = {actor:'fixture',scope:'test',revision:0} as const;
  const writer = new CollectionV2Writer(db);
  assert.equal((await writer.previewRelink(1,'test',ref)).typeChanged,false);
  let arrive!: () => void;
  let release!: () => void;
  const arrived = new Promise<void>(resolve => {arrive = resolve;});
  const released = new Promise<void>(resolve => {release = resolve;});
  const slowerDb = {
   prepare: db.prepare.bind(db),
   async batch(statements: D1PreparedStatement[]) {
    arrive();
    await released;
    return db.batch(statements);
   },
  } as D1Database;
  const rejected = assert.rejects(new CollectionV2Writer(slowerDb).relink(1,ref,{
   ...context,idempotencyKey:'slow-relink',confirmTypeChange:false,renameToGame:true,
  }), (error: unknown) => error instanceof CollectionWriteError && error.code === 'CONFLICT');
  await Promise.race([arrived,rejected.then(() => assert.fail('batch did not reach the gate'))]);
  try {
   await writer.patchFields(1,{displayName:'Updated elsewhere'},context);
  } finally {
   release();
  }
  await rejected;
  assert.equal((await writer.get(1,'test'))?.game_id,1);
  assert.deepEqual(await writer.relinkHistory(1,'test'),[]);
  const successful = await writer.relink(1,ref,{
   ...context,revision:1,idempotencyKey:'slow-relink',confirmTypeChange:false,renameToGame:true,
  });
  assert.equal(successful.revision,2);
  assert.equal(successful.header?.display_name,'Target');
  assert.equal((await writer.relinkHistory(1,'test')).length,1);
 } finally {
  await local.dispose();
 }
});
