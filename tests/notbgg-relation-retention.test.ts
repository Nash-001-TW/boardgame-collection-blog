import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isolatedNotBggD1,migrateIsolatedD1,migrationStatements} from './helpers/notbgg-local-d1.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';
import {SiteGameRelations} from '../src/lib/site-game-relations.ts';

test('D7A-R: rebuilt 0015 retains legacy and new relations without blocking archive or atomic writes',async t=>{
 const local=await isolatedNotBggD1(),db=local.db;
 try{
  await migrateIsolatedD1(db,'0013_v2_record_scope.sql');
  const apply=async(file:string)=>db.batch(migrationStatements(await readFile('migrations/'+file,'utf8')).map(sql=>db.prepare(sql)));
  await apply('0014_notbgg.sql');
  const repo=new NotBggRepository(db);
  const target=(await repo.create({name:'Synthetic target',type:'boardgame'},{actor:'test',idempotencyKey:'retention-target'})).game;
  const owner=(await repo.create({name:'Synthetic accessory',type:'boardgameaccessory',accessoryCategories:['storage'],relatedGameIds:[{source:'notbgg',notBggId:target.notBggId}]},{actor:'test',idempotencyKey:'retention-owner'})).game;
  const legacy=await db.prepare('SELECT * FROM site_game_relations').first<{id:number;source_game_id:number;target_game_id:number}>();assert.ok(legacy);
  await apply('0015_notbgg_collection.sql');await apply('0016_notbgg_link_commands.sql');
  const relations=new SiteGameRelations(db);
  const graph=async()=>({edges:(await db.prepare('SELECT * FROM site_game_relations ORDER BY id').all()).results,events:(await db.prepare('SELECT * FROM site_relation_events ORDER BY id').all()).results});
  await t.test('0013→0014→0015→0016 preserves legacy row and restores delete-only guard',async()=>{
   assert.deepEqual(await db.prepare('SELECT * FROM site_game_relations WHERE id=?').bind(legacy.id).first(),legacy);
   const trigger=await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='site_game_relations_no_delete'").first<{sql:string}>();assert.match(trigger!.sql,/BEFORE DELETE ON site_game_relations/i);
   assert.equal((await db.prepare('PRAGMA foreign_keys').first<{foreign_keys:number}>())!.foreign_keys,1);
  });
  await t.test('legacy row without audit FK cannot be hard deleted; failed batch restores earlier writes',async()=>{
   assert.equal((await db.prepare('SELECT count(*) n FROM site_relation_events').first<{n:number}>())!.n,0);
   const before=await graph();
   await assert.rejects(db.prepare('DELETE FROM site_game_relations WHERE id=?').bind(legacy.id).run(),/Archive site relations/);
   await assert.rejects(db.batch([db.prepare('UPDATE site_game_relations SET archived_at=CURRENT_TIMESTAMP WHERE id=?').bind(legacy.id),db.prepare('DELETE FROM site_game_relations WHERE id=?').bind(legacy.id)]),/Archive site relations/);
   assert.deepEqual(await graph(),before);
  });
  await t.test('legitimate archive retains original row and immutable event',async()=>{
   await relations.archive(owner.notBggId,legacy.id,'test');
   const row=await db.prepare('SELECT * FROM site_game_relations WHERE id=?').bind(legacy.id).first<Record<string,unknown>>();assert.ok(row!.archived_at);assert.deepEqual({...row,archived_at:null},legacy);
   const event=await db.prepare('SELECT * FROM site_relation_events WHERE relation_id=?').bind(legacy.id).first<{id:number;operation:string}>();assert.equal(event!.operation,'archived');
   await assert.rejects(db.prepare('DELETE FROM site_relation_events WHERE id=?').bind(event!.id).run(),/Immutable audit/);
   await assert.rejects(db.prepare('DELETE FROM site_game_relations WHERE id=?').bind(legacy.id).run(),/Archive site relations/);
  });
  await t.test('new relation insertion, normal profile edit and archive remain supported',async()=>{
   const id=await relations.add(owner.notBggId,{source:'notbgg',notBggId:target.notBggId},'compatible_with','kept','test');
   await repo.update(owner.notBggId,{name:'Edited accessory'},{actor:'test',expectedRevision:1});
   await assert.rejects(db.prepare('DELETE FROM site_game_relations WHERE id=?').bind(id).run(),/Archive site relations/);
   await relations.archive(owner.notBggId,id,'test');
   assert.equal((await db.prepare('SELECT count(*) n FROM site_relation_events WHERE relation_id=?').bind(id).first<{n:number}>())!.n,2);
   await repo.archive(owner.notBggId,{actor:'test',expectedRevision:2});
   assert.equal((await repo.getRevisionHistory(owner.notBggId)).length,3);
   assert.equal((await relations.list(owner.notBggId)).length,2);
  });
  await t.test('foreign keys and original identity/revision retention remain active',async()=>{
   await assert.rejects(db.prepare('DELETE FROM v2_games WHERE id=?').bind(legacy.target_game_id).run());
   await assert.rejects(db.prepare('DELETE FROM notbgg_game_revisions WHERE seq=?').bind(Number(owner.notBggId.slice(7))).run());
   assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  });
  await t.test('failed new relation audit insertion rolls back entire batch',async()=>{
   const before=await graph();
   await assert.rejects(db.batch([db.prepare("INSERT INTO site_game_relations(source_game_id,target_game_id,relation_type,created_by) VALUES (?,?,'accessory_for','test')").bind(legacy.source_game_id,legacy.target_game_id),db.prepare("INSERT INTO site_relation_events(relation_id,operation,actor) VALUES(last_insert_rowid(),'created','')")]));
   assert.deepEqual(await graph(),before);
  });
 }finally{await local.dispose();}
});
