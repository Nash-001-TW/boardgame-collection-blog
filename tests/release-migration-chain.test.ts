import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import { quantityOperationStatus } from '../src/lib/shared-quantity-commit.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

function migrationFilesThrough(last: number) {
 const files = readdirSync('migrations').filter(file => /^\d{4}_.*\.sql$/.test(file)).sort();
 const chain = files.filter(file => Number(file.slice(0, 4)) <= last);
 assert.deepEqual(chain.map(file => Number(file.slice(0, 4))), Array.from({ length: last }, (_, i) => i + 1));
 return chain;
}

function verifyMigrationHistory(last: number) {
 const db=new DatabaseSync(':memory:');
 try{
  const files = migrationFilesThrough(last);
  let before:{table:string;columns:string;rows:unknown[]}[]=[];
  for(const file of files){
   if(file.startsWith('0012_')){
    db.exec(`INSERT INTO bgg_games(bgg_id,name) VALUES(987654,'Synthetic historical game');
     INSERT INTO collection_items(id,source_key,display_name,bgg_id) VALUES(1,'release-synthetic','Historical collection',987654);
     INSERT INTO sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES(1,630,880);
     INSERT INTO sleeve_requirements(source_key,collection_item_id,size_id,quantity_sheets) VALUES('release-sleeve',1,1,50);`);
    const insert=db.prepare("INSERT INTO collection_components(collection_item_id,component_name,component_type) VALUES(1,?,'expansion')");
    for(let i=0;i<122;i++)insert.run('Synthetic legacy product '+i);
   }
   if(file.startsWith('0017_')){
    db.exec(`INSERT INTO v2_owned_copies(id,collection_item_id,copy_label,notes) VALUES(1,1,'Historical copy','Synthetic private notes');
     INSERT INTO v2_sleeve_products(id,size_id,product_name,sheets_per_pack) VALUES(1,1,'Historical sleeve product',100);
     INSERT INTO v2_sleeve_inventory_transactions(id,product_id,transaction_type,transaction_date,quantity_sheets,owned_copy_id,collection_item_id) VALUES(1,1,'OPENING_BALANCE','2025-01-01',100,NULL,NULL),(2,1,'USE','2025-01-01',-20,1,1);
     INSERT INTO v2_sleeve_applications(id,owned_copy_id,inventory_transaction_id,quantity_sheets) VALUES(1,1,2,20);
     INSERT INTO v2_purchase_orders(id,item_subtotal_minor,merchant_name) VALUES(1,100,'Synthetic historic merchant');
     INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id,unit_price_minor) VALUES(1,1,'Historical line',1,100);
     INSERT INTO v2_purchase_allocations(purchase_order_id,collection_item_id,allocated_minor) VALUES(1,1,100);`);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[];
    before=tables.map(({name})=>{const columns=(db.prepare(`PRAGMA table_info("${name}")`).all() as {name:string}[]).map(c=>'"'+c.name+'"').join(',');return {table:name,columns,rows:db.prepare(`SELECT ${columns} FROM "${name}" ORDER BY rowid`).all()};});
   }
   db.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],file);
  }
  for(const snapshot of before)assert.deepEqual(db.prepare(`SELECT ${snapshot.columns} FROM "${snapshot.table}" ORDER BY rowid`).all(),snapshot.rows,snapshot.table+' historical columns unchanged');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_definitions').get()?.n,122);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_physical_component_sources').get()?.n,0);
  assert.equal(db.prepare('SELECT requirement_id FROM v2_sleeve_applications WHERE id=1').get()?.requirement_id,null);
  assert.equal(db.prepare('SELECT admin_managed FROM v2_purchase_orders WHERE id=1').get()?.admin_managed,0);
  assert.equal(db.prepare('SELECT last_success_at FROM bgg_games WHERE bgg_id=987654').get()?.last_success_at,null);
  for(const table of ['v2_sleeve_admin_commands','v2_collection_copy_commands','v2_sleeve_workflow_commands','v2_purchase_admin_commands','v2_bgg_sync_commands','v2_relation_admin_commands'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_bgg_sync_gate').get()?.n,1);
  if (last >= 23) {
   assert.equal(db.prepare('SELECT COUNT(*) n FROM d1_quantity_changes').get()?.n, 0);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('d1_quantity_requests', 'd1_quantity_results')").get()?.n, 0);
   assert.deepEqual(db.prepare('SELECT collection_id, generation FROM d1_quantity_collection_generation ORDER BY collection_id').all(),
    db.prepare('SELECT id AS collection_id, 1 AS generation FROM v2_collection_items ORDER BY id').all());
   assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_definitions WHERE last_quantity_operation_id IS NOT NULL').get()?.n, 0);
  }
  if (last === 24) {
   assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_applicability_coverage').get()?.n, 0);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_applicability_events').get()?.n, 0);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_applicability_current').get()?.n, 0);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
  // Additive ALTERs are deliberately not rerunnable. Production must use its migration ledger.
  assert.throws(()=>db.exec(readFileSync('migrations/0017_physical_components.sql','utf8')),/duplicate column/i);
 }finally{db.close();}
}

test('Release-03 historical migrations 0001–0022 preserve historical rows', () => verifyMigrationHistory(22));
test('candidate migrations 0001–0023 preserve historical rows and start with empty D1 history', () => verifyMigrationHistory(23));
test('candidate 0024 preserves migrated rows without backfilling applicability or coverage', () => verifyMigrationHistory(24));

test('candidate 0001–0024 apply in order on a clean database', () => {
 const db = new DatabaseSync(':memory:');
 try {
  for (const file of migrationFilesThrough(24)) {
   db.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], file);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_applicability_current').get()?.n, 0);
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
 } finally { db.close(); }
});

test('0024 preserves a committed 0023 event, receipt, marker and advanced generation', async () => {
 const db = new DatabaseSync(':memory:');
 try {
  for (const file of migrationFilesThrough(23)) {
   db.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
  }
  const digest = 'a'.repeat(64);
  const operationId = 'q1.' + 'd'.repeat(32) + '.' + digest;
  const actor = 'synthetic-upgrade';
  db.exec(`
   INSERT INTO v2_collection_items (id, display_name, record_scope) VALUES (501, 'Synthetic upgrade', 'test');
   INSERT INTO v2_component_definitions (id, collection_item_id, component_name, component_type,
     quantity_unit, expected_quantity, physical_revision, physical_creation_token)
   VALUES (501, 501, 'Cards', 'card', 'card', 20, 1, printf('%064x', 501));
   INSERT INTO v2_physical_component_sources (definition_id, collection_item_id, record_scope,
     creation_token, actor, request_digest, signature)
   VALUES (501, 501, 'test', printf('%064x', 501), 'synthetic-upgrade', printf('%064x', 2), printf('%064x', 3));
   INSERT INTO v2_owned_copies (id, collection_item_id) VALUES (501, 501);
   INSERT INTO v2_copy_components (owned_copy_id, component_definition_id, actual_quantity, inspection_status)
   VALUES (501, 501, 17, 'checked');
  `);
  db.prepare(`
   INSERT INTO d1_quantity_changes (operation_id, actor, digest, definition_id, collection_id,
     record_scope, source_signature, before_revision, before_quantity, after_quantity,
     name, component_type, unit, reason, evidence_json, before_generation, after_revision)
   SELECT ?, ?, ?, p.id, p.collection_item_id, p.record_scope, p.signature, p.physical_revision, 20, 18,
     'Cards', 'card', 'card', 'Synthetic correction',
     json_object('version', 1, 'rule', 'expected-minus-checked-v1',
       'oldExpected', 20, 'newExpected', 18, 'items', json(p.evidence_items)),
     g.generation, 2
   FROM d1_quantity_admission p JOIN d1_quantity_collection_generation g ON g.collection_id=p.collection_item_id
   WHERE p.id=501
  `).run(operationId, actor, digest);

  const binding = sqliteD1(db);
  const snapshot = () => ({
   event: db.prepare('SELECT * FROM d1_quantity_history WHERE operation_id=?').get(operationId),
   definition: db.prepare('SELECT expected_quantity, physical_revision, last_quantity_operation_id FROM v2_component_definitions WHERE id=501').get(),
   generation: db.prepare('SELECT CAST(generation AS TEXT) AS value FROM d1_quantity_collection_generation WHERE collection_id=501').get()?.value,
  });
  const before = snapshot();
  const receipt = await quantityOperationStatus(binding, actor, operationId);
  assert.ok(before.event);
  assert.equal(before.definition?.last_quantity_operation_id, operationId);
  assert.equal(before.definition?.expected_quantity, 18);
  assert.equal(before.definition?.physical_revision, 2);
  assert.equal(typeof before.generation, 'string');
  assert.ok(BigInt(String(before.generation)) > 1n);
  assert.equal(receipt.outcome, 'COMMITTED');

  db.exec(readFileSync('migrations/0024_component_applicability.sql','utf8').replace(/^\uFEFF/,''));
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(await quantityOperationStatus(binding, actor, operationId), receipt);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_applicability_coverage').get()?.n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM v2_component_applicability_events').get()?.n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
 } finally { db.close(); }
});
