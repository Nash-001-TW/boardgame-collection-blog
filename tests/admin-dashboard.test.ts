import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedNotBggD1, migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { dashboardPreview } from './helpers/admin-dashboard-preview.ts';
import { NotBggRepository } from '../src/lib/notbgg-repository.ts';
import { NotBggLinkRepository } from '../src/lib/notbgg-link-repository.ts';
import { handleNotBggAdminRequest } from '../src/lib/notbgg-admin-api.ts';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';

// No Wrangler config/env files, existing local D1, production credentials or remote DB.
test('dashboard V2: isolated D1 statistics, real pages, Access JWT and JWKS', async t => {
 const local=await isolatedNotBggD1(),auth=await accessFixture(),db=local.db;
 try {
  await migrateIsolatedD1(db);
  const bindings={...auth.bindings,DB:db,LOCAL_ADMIN_DEV:'false'};
  const render=await dashboardPreview(bindings),jwt=await auth.token();
  const request=(path:string,token:string|undefined=jwt)=>new Request('http://localhost'+path,{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
  const page=async(lang='zh-TW')=>{const response=await render(request('/admin?lang='+lang));assert.equal(response.status,200);return response.text();};
  function values(html:string){return [...html.matchAll(/<dd\b[^>]*>\s*([^<]*?)\s*<\/dd>/g)].map(m=>Number(m[1].trim().replaceAll(',','')));}
  const repo=new NotBggRepository(db);
  await t.test('fresh migrated database renders real zero counts and both zero archive hints',async()=>{
   for(const lang of ['zh-TW','en']){const html=await page(lang);assert.deepEqual(values(html),Array(9).fill(0));assert.ok(html.includes(lang==='en'?'Includes 0 archived':'含已封存 0 筆'));}
  });
  const games=[];
  for(let i=0;i<3;i++)games.push((await repo.create({name:'Dashboard isolated '+i,type:'boardgame'},{actor:'fixture',idempotencyKey:'dashboard-'+i})).game);
  // A reserved ID alone is not a game and must not be counted.
  await db.prepare("INSERT INTO notbgg_ids(request_key,request_hash) VALUES ('unused-dashboard-reservation','fixture')").run();
  // Only two legacy-mapped BGG games; an unmapped BGG game must not change bgg_count.
  await db.batch([
   db.prepare("INSERT INTO v2_games(id,bgg_id,primary_name,catalog_source) VALUES (100,101,'Mapped A','bgg'),(101,102,'Mapped B','bgg'),(102,103,'Unmapped','bgg')"),
   db.prepare("INSERT INTO v2_legacy_id_map(legacy_table,legacy_id,target_table,target_id) VALUES ('bgg_games','101','v2_games',100),('bgg_games','102','v2_games',101),('other','103','v2_games',102)"),
   db.prepare(`INSERT INTO v2_collection_items(id,game_id,display_name,item_type,acquisition_status,wishlist,notes,record_scope) VALUES
    (100,100,'Owned','base','owned',0,NULL,'production'),
    (101,100,'Owned override false','base','owned',0,'{"owned":0}','production'),
    (102,100,'Owned override true','base','not_owned',0,'{"owned":1}','production'),
    (103,100,'Preordered wishlist','base','preordered',1,NULL,'production'),
    (104,100,'Preordered only','base','preordered',0,NULL,'production'),
    (105,100,'Wishlist','base','wishlist',1,'malformed-json','production'),
    (106,100,'Ignored test preorder','base','preordered',1,NULL,'test'),
    (107,100,'Ignored test owned','base','owned',1,NULL,'test')`),
   db.prepare("INSERT INTO v2_component_definitions(collection_item_id,component_name) VALUES (100,'A'),(100,'B'),(103,'C'),(106,'Excluded')"),
   db.prepare("INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES (100,630,880),(101,450,680)"),
   db.prepare("INSERT INTO v2_sleeve_requirements(collection_item_id,size_id,quantity_sheets) VALUES (100,100,50),(103,100,80),(105,101,20),(106,101,999)"),
   db.prepare("INSERT INTO v2_purchase_orders(id,acquisition_channel) VALUES (100,'preorder')"),
   db.prepare("INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id) VALUES (100,1,'Already owned via preorder channel',100)")
  ]);
  // Display order: collection, owned, wishlist, preordered, sizes, requirements, components, BGG, NotBGG.
  const expected=[6,2,2,2,2,3,3,2,3];
  await t.test('all nine displayed statistics and 0 archived: zh/en real D1, no placeholders',async()=>{
   for(const lang of ['zh-TW','en']){
    const html=await page(lang);assert.deepEqual(values(html),expected);assert.ok(!html.includes('role="alert"'));
    assert.ok(html.includes(lang==='en'?'Includes 0 archived':'含已封存 0 筆'));
    assert.equal((html.match(/<button\b[^>]*disabled/g)||[]).length,1);
    console.log('dashboard baseline '+lang+': '+JSON.stringify(values(html)));
   }
  });
  await t.test('preordered status is independent of preorder purchase channel and test scope',async()=>{
   // Change only purchase channel: count must remain exactly 2.
   await db.prepare("UPDATE v2_purchase_orders SET acquisition_channel='purchase' WHERE id=100").run();
   assert.equal(values(await page())[3],2);
   await db.prepare("UPDATE v2_purchase_orders SET acquisition_channel='preorder' WHERE id=100").run();
   assert.equal(values(await page())[3],2);
  });
  await t.test('confirmed BGG-linked custom master remains in total, independent of collections',async()=>{
   const links=new NotBggLinkRepository(db),id=games[0].notBggId;
   await links.execute(id,{action:'propose',expectedProfileRevision:1,expectedEventId:0,bggId:194655,reason:'isolated verification'},'fixture');
   const state=await links.state(id);
   await links.execute(id,{action:'confirm',expectedProfileRevision:1,expectedEventId:state.expectedEventId,linkId:state.link!.id,reason:'isolated verification'},'fixture');
   assert.equal((await links.state(id)).state,'linked');assert.deepEqual(values(await page()),expected);
  });
  await t.test('archive nonzero retains total and translates hint',async()=>{
   await repo.archive(games[1].notBggId,{actor:'fixture',expectedRevision:1});
   for(const lang of ['zh-TW','en']){const html=await page(lang);assert.deepEqual(values(html),expected);assert.ok(html.includes(lang==='en'?'Includes 1 archived':'含已封存 1 筆'));}
  });
  await t.test('large real D1 counts: 1,236 total, 1,234 archived; valid identities/revisions',async()=>{
   // Bulk fixture only in disposable D1. Retain every production constraint and immutable revision.
   const seq='WITH RECURSIVE nums(n) AS (SELECT 10000 UNION ALL SELECT n+1 FROM nums WHERE n<11232) ';
   const template=JSON.stringify(games[2]);
   await db.batch([
    db.prepare(seq+"INSERT INTO notbgg_ids(seq,request_key,request_hash) SELECT n,'dashboard-bulk-'||n,'isolated-fixture' FROM nums"),
    db.prepare(seq+"INSERT INTO v2_games(id,primary_name,game_type,catalog_source) SELECT n,'Bulk '||n,'base','manual' FROM nums"),
    db.prepare(seq+"INSERT INTO notbgg_games(seq,game_id,name,type) SELECT n,n,'Bulk '||n,'boardgame' FROM nums"),
    db.prepare(seq+"INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) SELECT n,1,json_set(?,'$.gameId',n,'$.notBggId',printf('NotBGG:%06d',n),'$.name','Bulk '||n),'fixture' FROM nums").bind(template)
   ]);
   await db.batch([
    db.prepare("INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) SELECT seq,2,json_set(snapshot_json,'$.revision',2,'$.archivedAt','2026-01-01T00:00:00.000Z','$.updatedAt','2026-01-01T00:00:00.000Z'),'fixture' FROM notbgg_game_revisions WHERE seq BETWEEN 10000 AND 11232 AND revision=1"),
    db.prepare("UPDATE notbgg_games SET revision=2,archived_at='2026-01-01T00:00:00.000Z',updated_at='2026-01-01T00:00:00.000Z' WHERE seq BETWEEN 10000 AND 11232")
   ]);
   const large=[...expected];large[8]=1236;
   for(const lang of ['zh-TW','en']){const html=await page(lang);assert.deepEqual(values(html),large);assert.ok(html.includes(lang==='en'?'Includes 1,234 archived':'含已封存 1,234 筆'));}
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM notbgg_games WHERE archived_at IS NOT NULL').first<{n:number}>())!.n,1234);
   assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
   console.log('dashboard large: '+JSON.stringify(large)+'; archived=1234');
  });
  await t.test('rendered management links resolve real pages with JWT; absent/wrong/expired tokens reject',async()=>{
   for(const lang of ['zh-TW','en']){
    const html=await page(lang),suffix=lang==='en'?'?lang=en':'';
    for(const route of ['/admin/collection','/admin/notbgg']){
     assert.ok(html.includes('href="'+route+suffix+'"'));
     const response=await render(request(route+suffix));assert.equal(response.status,200);assert.ok((await response.text()).includes('<main'));
     assert.equal((await render(new Request('http://localhost'+route))).status,401);
     assert.equal((await render(request(route,await auth.token({wrongKey:true})))).status,401);
     assert.equal((await render(request(route,await auth.token({email:'other@example.test'})))).status,403);
     assert.equal((await render(request(route,await auth.token({exp:Math.floor(Date.now()/1000)-60})))).status,401);
    }
   }
   assert.equal((await render(new Request('http://localhost/admin'))).status,403);
   const headers={'Cf-Access-Jwt-Assertion':jwt};
   assert.equal((await handleNotBggAdminRequest(new Request('http://localhost/api/admin/notbgg',{headers}),bindings)).status,200);
   assert.equal((await handleCollectionAdminRequest(new Request('http://localhost/api/admin/collection?scope=production',{headers}),bindings)).status,200);
  });
  await t.test('actual missing table causes caught error, HTTP 200 and usable cards in both languages',async()=>{
   const empty=await isolatedNotBggD1();
   try{
    // Stop before NotBGG migrations: reproduce the exact missing notbgg_games table.
    await migrateIsolatedD1(empty.db,'0013_v2_record_scope.sql');
    await assert.rejects(empty.db.prepare('SELECT COUNT(*) FROM notbgg_games').first(),/no such table: notbgg_games/);
    bindings.DB=empty.db;
    for(const lang of ['zh-TW','en']){
     const html=await page(lang);assert.ok(html.includes('role="alert"'));assert.ok(html.includes(lang==='en'?'An error occurred while reading the D1 database':'讀取 D1 資料庫時發生錯誤'));
     assert.equal((html.match(/<article\b/g)||[]).length,4);assert.equal((html.match(/<button\b[^>]*disabled/g)||[]).length,1);
     assert.ok(html.includes('/admin/collection'));assert.ok(html.includes('/admin/notbgg'));assert.ok(html.includes('—'));
    }
   }finally{bindings.DB=db;await empty.dispose();}
  });
 } finally {auth.restore();await local.dispose();}
});
