import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('release migration chain 0001–0022 and preservation across 0017–0022',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const files=readdirSync('migrations').filter(f=>/^\d{4}_.*\.sql$/.test(f)).sort();
  assert.deepEqual(files.map(f=>Number(f.slice(0,4))),Array.from({length:22},(_,i)=>i+1));
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
  assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check,'ok');
  // Additive ALTERs are deliberately not rerunnable. Production must use its migration ledger.
  assert.throws(()=>db.exec(readFileSync('migrations/0017_physical_components.sql','utf8')),/duplicate column/i);
 }finally{db.close();}
});
