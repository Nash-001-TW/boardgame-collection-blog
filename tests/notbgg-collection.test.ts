import type {NotBggGame} from '../src/lib/notbgg-contract.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedNotBggD1,migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';
import { NotBggRepository } from '../src/lib/notbgg-repository.ts';
import { CollectionV2Repository } from '../src/lib/collection-v2-repository.ts';
import { SiteGameRelations } from '../src/lib/site-game-relations.ts';
import { adaptCollectionV2Rows } from '../src/lib/collection-v2-adapter.ts';
import { PublicNotBggReader } from '../src/lib/notbgg-public.ts';
import { getGames } from '../src/lib/games.ts';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { migrationStatements } from './helpers/notbgg-local-d1.ts';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
test('D5 isolated V2 collection, copy/purchase preservation, independent site edges and signed admin API',async t=>{
 const local=await isolatedNotBggD1(),db=local.db,auth=await accessFixture();
 try{
  await migrateIsolatedD1(db);const repo=new NotBggRepository(db),collection=new CollectionV2Repository(db),writer=collection.management,relations=new SiteGameRelations(db);
  const games:NotBggGame[]=[];for(const [i,type]of (['boardgame','boardgameexpansion','boardgameaccessory'] as const).entries())games.push((await repo.create({name:`Synthetic D5 ${type}`,type,accessoryCategories:type==='boardgameaccessory'?['storage']:[]},{actor:'test',idempotencyKey:`seed-${i}`})).game);
  const input={displayName:'My copy',acquisitionStatus:'owned',wishlist:false,personalRating:8,playCount:3,comment:'PRIVATE_COMMENT',language:'zh-TW',edition:'First',purchaseDate:'2026-11-01',priceMinor:123456,currency:'TWD',merchant:'PRIVATE_SHOP'};
  const records:number[]=[];
  await t.test('all three NotBGG types create independent V2 collection and physical/purchase identities',async()=>{
   for(const [i,g]of games.entries()){const created=await writer.create({source:'notbgg',notBggId:g.notBggId},input,{actor:'test',idempotencyKey:`create-${i}`,scope:'test',createCopy:true});records.push(created.collectionId);const d=await writer.detail(created.collectionId,'test');assert.equal(d!.item.game_id,g.gameId);assert.equal(d!.copies.length,1);assert.equal(d!.copies[0].language_code,'zh-TW');assert.equal(d!.purchases[0].unit_price_minor,123456);}
   assert.equal(new Set(records).size,3);assert.equal((await writer.list('test')).filter(r=>records.includes(Number(r.id))).length,3);
  });
  await t.test('same game permits separate collectionId; replay idempotent and true concurrent creates never merge',async()=>{
   const ref={source:'notbgg' as const,notBggId:games[0].notBggId},ctx={actor:'test',idempotencyKey:'create-0',scope:'test' as const,createCopy:true};assert.equal((await writer.create(ref,input,ctx)).collectionId,records[0]);
   await assert.rejects(writer.create(ref,{...input,displayName:'Different'},ctx),/IDEMPOTENCY_CONFLICT/);
   const copies=await Promise.all([1,2].map(i=>writer.create(ref,input,{...ctx,idempotencyKey:`separate-${i}`})));assert.equal(new Set(copies.map(c=>c.collectionId)).size,2);assert.ok(copies.every(c=>c.collectionId!==records[0]));
   const same=await Promise.all([1,2,3].map(()=>writer.create(ref,input,{...ctx,idempotencyKey:'actual-concurrent-same'})));assert.equal(new Set(same.map(r=>r.collectionId)).size,1);
  });
  await t.test('late purchase failure atomically rolls back collection, copy, order and audit',async()=>{
   const count=async()=>db.prepare(`SELECT (SELECT count(*) FROM v2_collection_items) items,(SELECT count(*) FROM v2_owned_copies) copies,(SELECT count(*) FROM v2_purchase_orders) orders,(SELECT count(*) FROM v2_collection_events) events`).first();const before=await count();
   await db.prepare("CREATE TRIGGER d5_test_failure BEFORE INSERT ON v2_purchase_allocations WHEN NEW.allocated_minor=987654 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").run();
   await assert.rejects(writer.create({source:'notbgg',notBggId:games[0].notBggId},{...input,priceMinor:987654},{actor:'test',idempotencyKey:'injected-failure',scope:'test',createCopy:true}),/STORAGE/);
   assert.deepEqual(await count(),before);await db.prepare('DROP TRIGGER d5_test_failure').run();
  });
  await t.test('scope controls every lookup/update; production and test never mix',async()=>{
   assert.equal(await writer.get(records[0],'production'),null);await assert.rejects(writer.update(records[0],input,{actor:'test',scope:'production',expectedRevision:1}),/NOT_FOUND/);
   assert.ok(!(await collection.getProductionItems()).some(r=>records.includes(r.id)));
  });
  await t.test('wishlist can acquire its first copy later; purchase date never overwrites physical acquisition date',async()=>{
   const created=await writer.create({source:'notbgg',notBggId:games[2].notBggId},{displayName:'Wishlist',acquisitionStatus:'wishlist',wishlist:true},{actor:'test',idempotencyKey:'wishlist-lifecycle',scope:'test',createCopy:false});
   assert.equal((await writer.detail(created.collectionId,'test'))!.copies.length,0);
   await writer.update(created.collectionId,input,{actor:'test',scope:'test',expectedRevision:1,createCopy:true});
   let d=await writer.detail(created.collectionId,'test');assert.equal(d!.copies.length,1);assert.equal(d!.copies[0].acquisition_date,null);assert.equal(d!.purchases[0].ordered_at,'2026-11-01');
   await db.prepare("UPDATE v2_owned_copies SET acquisition_date='2026-11-03' WHERE id=?").bind(d!.copies[0].id).run();
   await writer.update(created.collectionId,{...input,purchaseDate:'2026-11-02'},{actor:'test',scope:'test',expectedRevision:2,createCopy:true});
   d=await writer.detail(created.collectionId,'test');assert.equal(d!.copies.length,1);assert.equal(d!.copies[0].acquisition_date,'2026-11-03');assert.equal(d!.purchases[0].ordered_at,'2026-11-02');
  });
  await t.test('multi-target and two relation types; nonexistent/self/duplicate rejected; no automatic collection',async()=>{
   await db.prepare("INSERT INTO v2_games(bgg_id,primary_name,catalog_source) VALUES(205637,'BGG target','bgg') ON CONFLICT(bgg_id) DO NOTHING").run();
   const before=(await writer.list('test')).length,kit=games[2];
   await relations.add(kit.notBggId,{source:'notbgg',notBggId:games[0].notBggId},'accessory_for',null,'test');
   await relations.add(kit.notBggId,{source:'bgg',bggId:205637},'compatible_with','PRIVATE_RELATION_NOTE','test');
   await assert.rejects(relations.add(kit.notBggId,{source:'bgg',bggId:205637},'compatible_with',null,'test'),/DUPLICATE_RELATION/);
   await assert.rejects(relations.add(kit.notBggId,{source:'bgg',bggId:999999999},'accessory_for',null,'test'),/INVALID_REFERENCE/);
   await assert.rejects(relations.add(kit.notBggId,{source:'notbgg',notBggId:kit.notBggId},'accessory_for',null,'test'),/INVALID_REFERENCE/);
   await assert.rejects(relations.add(kit.notBggId,{source:'notbgg',notBggId:games[0].notBggId},'expansion_of',null,'test'),/VALIDATION/);
   assert.equal((await writer.list('test')).length,before);const detail=await new PublicNotBggReader(db).detail(kit.notBggId,getGames(),'en');assert.equal(detail!.related.length,2);assert.ok(!JSON.stringify(detail).includes('PRIVATE_RELATION_NOTE'));
   // D3 standard editor only changes accessory_for edges; compatibility remains.
   await repo.update(kit.notBggId,{relatedGameIds:[]},{actor:'test',expectedRevision:1});
   const rows=await relations.list(kit.notBggId);assert.equal(rows.filter(r=>!r.archived_at&&r.relation_type==='compatible_with').length,1);
  });
  await t.test('optimistic edit preserves IDs, copy and purchase data; stale write and archive preserve all graphs',async()=>{
   const before=await writer.detail(records[0],'test');await writer.update(records[0],{...input,displayName:'Edited',priceMinor:120000,language:'en'},{actor:'test',scope:'test',expectedRevision:1});
   await assert.rejects(writer.update(records[0],input,{actor:'test',scope:'test',expectedRevision:1}),/CONFLICT/);
   const after=await writer.detail(records[0],'test');assert.equal(after!.copies[0].id,before!.copies[0].id);assert.equal(after!.purchases[0].id,before!.purchases[0].id);assert.equal(after!.copies[0].language_code,'en');assert.equal(after!.purchases[0].unit_price_minor,120000);
   await repo.archive(games[0].notBggId,{actor:'test',expectedRevision:1});assert.equal((await writer.detail(records[0],'test'))!.copies.length,1);assert.ok((await writer.get(records[0],'test'))!.source_archived);
   await writer.update(records[0],{...input,priceMinor:120000},{actor:'test',scope:'test',expectedRevision:2});
   await writer.update(records[0],undefined,{actor:'test',scope:'test',expectedRevision:3},true);assert.equal((await writer.detail(records[0],'test'))!.copies.length,1);
  });
  await t.test('production public DTO uses NotBGG routes without personal/audit data; BGG custom slug preserved',async()=>{
   const r=await writer.create({source:'notbgg',notBggId:games[1].notBggId},input,{actor:'test',idempotencyKey:'production-local',scope:'production',createCopy:true});
   const row=(await collection.getProductionItems()).find(row=>row.id===r.collectionId)!;const dto=adaptCollectionV2Rows([row],'en')[0];assert.equal(dto.gameUrl,'/en/games/notbgg/000002');assert.ok(!JSON.stringify(dto).includes('PRIVATE_'));
   const b=await writer.create({source:'bgg',bggId:194655},input,{actor:'test',idempotencyKey:'bgg-local',scope:'production',createCopy:true});
   const bg=adaptCollectionV2Rows((await collection.getProductionItems()).filter(r=>r.id===b.collectionId))[0];assert.ok(bg.gameUrl?.includes('santorini'));
   await repo.archive(games[1].notBggId,{actor:'test',expectedRevision:1});const archived=adaptCollectionV2Rows((await collection.getProductionItems()).filter(row=>row.id===r.collectionId))[0];assert.equal(archived.sourceStatus,'archived');assert.equal(archived.gameUrl,null);
  });
  await t.test('independent API Access signatures, allowlist, CSRF, missing binding, scope, idempotency and revisions',async()=>{
   const token=await auth.token(),origin='https://local.example',bindings={...auth.bindings,DB:db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
   const call=(path:string,method='GET',body?:unknown,jwt:string|null=token,extra:Record<string,string>={})=>handleCollectionAdminRequest(new Request(origin+path,{method,headers:{...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{}),'Origin':origin,'X-NotBGG-Request':'1','Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)}),bindings);
   assert.equal((await call('/api/admin/collection','GET',undefined,null)).status,401);assert.equal((await call('/api/admin/collection','POST',{},await auth.token({wrongKey:true}))).status,401);
   assert.equal((await call('/api/admin/collection','POST',{},token,{Origin:'https://evil.example'})).status,403);
   assert.equal((await handleCollectionAdminRequest(new Request(origin+'/api/admin/collection',{headers:{'Cf-Access-Jwt-Assertion':token}}),auth.bindings)).status,503);
   const payload={ref:{source:'notbgg',notBggId:games[2].notBggId},data:input,createCopy:true},path='/api/admin/collection?scope=test';
   const a=await call(path,'POST',payload,token,{'Idempotency-Key':'api-create-01'});assert.equal(a.status,201);const id=(await a.json() as {data:{collectionId:number}}).data.collectionId;
   assert.equal((await call(path,'POST',payload,token,{'Idempotency-Key':'api-create-01'})).status,200);
   assert.equal((await call(`/api/admin/collection/${id}?scope=production`)).status,404);
   assert.equal((await call(`/api/admin/collection/${id}?scope=test`,'PATCH',{expectedRevision:0,data:input})).status,409);
   assert.equal((await call(path,'POST',{...payload,actor:'fake'},token,{'Idempotency-Key':'api-create-02'})).status,400);
  });
 }finally{auth.restore();await local.dispose();}
});
test('0015 preserves populated 0014 edges, committed sequence, original tables and cache hash',async()=>{
 const local=await isolatedNotBggD1();try{
  const db=local.db;await migrateIsolatedD1(db,'0014_notbgg.sql');const repo=new NotBggRepository(db);
  const base=(await repo.create({name:'Existing base',type:'boardgame'},{actor:'old',idempotencyKey:'migration-base'})).game;
  const kit=(await repo.create({name:'Existing accessory',type:'boardgameaccessory',accessoryCategories:['storage'],relatedGameIds:[{source:'notbgg',notBggId:base.notBggId}]},{actor:'old',idempotencyKey:'migration-kit'})).game;
  const before=(await db.prepare('SELECT * FROM site_game_relations').all()).results;
  await db.prepare("UPDATE sqlite_sequence SET seq=500 WHERE name='site_game_relations'").run();
  const sql=await readFile('migrations/0015_notbgg_collection.sql','utf8');await db.batch(migrationStatements(sql).map(s=>db.prepare(s)));
  assert.deepEqual((await db.prepare('SELECT * FROM site_game_relations').all()).results,before);
  const relation=await new SiteGameRelations(db).add(kit.notBggId,{source:'notbgg',notBggId:base.notBggId},'compatible_with',null,'new');assert.equal(relation,501);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal(createHash('sha256').update(await readFile('src/data/bgg-cache.json')).digest('hex'),'1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91');
 }finally{await local.dispose();}
});
