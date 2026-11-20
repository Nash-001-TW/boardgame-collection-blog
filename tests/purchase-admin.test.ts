import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {handlePurchaseAdminRequest} from '../src/lib/purchase-admin-api.ts';
import {handleCollectionCopiesRequest} from '../src/lib/collection-copies-api.ts';
import {proportionalAllocation,readPurchase,readPurchases} from '../src/lib/purchase-admin.ts';
import {readPublicGameCollection} from '../src/lib/public-game-collection.ts';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('0021 adds empty command storage without importing historical purchases or copy notes',()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')&&f<'0021').sort())sqlite.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
  sqlite.exec(`INSERT INTO v2_collection_items(id,display_name,notes) VALUES(1,'Historical','{"price":9999}');
   INSERT INTO v2_owned_copies(id,collection_item_id,notes) VALUES(1,1,'Old private notes');
   INSERT INTO v2_purchase_orders(id,item_subtotal_minor,notes) VALUES(1,123,'Old order');`);
  const before=sqlite.prepare('SELECT * FROM v2_purchase_orders WHERE id=1').get();
  sqlite.exec(readFileSync('migrations/0021_purchase_and_copy_admin.sql','utf8'));
  const {admin_managed,admin_revision,...after}=sqlite.prepare('SELECT * FROM v2_purchase_orders WHERE id=1').get()!;
  assert.equal(admin_managed,0);assert.equal(admin_revision,0);assert.deepEqual(after,{...before});
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_purchase_orders').get()?.n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_purchase_admin_commands').get()?.n,0);
  const copy=sqlite.prepare('SELECT * FROM v2_owned_copies WHERE id=1').get()!;assert.equal(copy.notes,'Old private notes');assert.equal(copy.condition_details,null);assert.equal(copy.condition_revision,0);
 }finally{sqlite.close();}
});

test('purchase allocations and private copy conditions in isolated SQLite',async t=>{
 const f=await sleeveWorkflowFixture(),auth=await accessFixture();
 try{
 f.sqlite.exec(`INSERT INTO v2_purchase_orders(id,merchant_name,item_subtotal_minor,status,notes) VALUES(31,'Legacy merchant',100,'paid','PRIVATE_LEGACY_ORDER');
 INSERT INTO v2_purchase_order_lines(id,purchase_order_id,line_number,description,collection_item_id,unit_price_minor) VALUES(31,31,1,'Historical line',1,100);
 INSERT INTO v2_purchase_allocations(id,purchase_order_id,owned_copy_id,allocated_minor) VALUES(31,31,1,100);
 INSERT INTO v2_owned_copies(id,collection_item_id,notes) VALUES(4,1,'PRIVATE_EXISTING_NOTES');
 UPDATE v2_collection_items SET notes='{"price":999999,"purchase_date_hint":"2000-01-01"}' WHERE id=1;`);
 const oldOrder=f.sqlite.prepare('SELECT * FROM v2_purchase_orders WHERE id=31').get(),oldAllocation=f.sqlite.prepare('SELECT * FROM v2_purchase_allocations WHERE id=31').get();
 const jwt=await auth.token(),bindings={...auth.bindings,DB:f.db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
 let sequence=0;
 const request=(path:string,body:unknown,key:string,token:string|null,method='POST')=>new Request('http://localhost'+path,{method,headers:{'Content-Type':'application/json',Origin:'http://localhost','X-NotBGG-Request':'1','Idempotency-Key':key,...(token?{'Cf-Access-Jwt-Assertion':token}:{})},body:JSON.stringify(body)});
 const send=(body:unknown,key='purchase-test-'+(++sequence),token:string|null=jwt)=>handlePurchaseAdminRequest(request('/api/admin/purchases',body,key,token),bindings);
 const line=(collectionId=1,price=100)=>({collectionId,description:'PRIVATE_PRODUCT',quantity:1,price,discount:0,allocated:0});
 const body={id:0,revision:0,date:'2026-11-12',merchant:'PRIVATE_MERCHANT',reference:'PRIVATE_ORDER_NUMBER',currency:'TWD',shipping:1,tax:0,fee:0,discount:0,refunded:0,status:'paid',notes:'PRIVATE_ORDER_NOTE',method:'weighted',lines:[line(),line(2,200)]};
 let id=0;
 await t.test('auth, integer precision, limits, dates and proportional remainder',async()=>{
  assert.equal((await send(body,undefined,null)).status,401);assert.equal((await send(body,undefined,await auth.token({email:'viewer@example.test'}))).status,403);
  assert.deepEqual(proportionalAllocation(100,[1,1,1]),[34,33,33]);assert.deepEqual(proportionalAllocation(301,[100,200]),[100,201]);
  assert.equal((await send({...body,shipping:0.1})).status,400);assert.equal((await send({...body,date:'2026-02-30'})).status,400);
  assert.equal((await send({...body,method:'manual',lines:[{...line(),allocated:102}]})).status,400);
  assert.equal((await send({...body,lines:[{...line(),quantity:10000,price:1e12}]})).status,400);
  assert.equal((await send({...body,classification:'trusted'})).status,400);
 });
 await t.test('multi-item order, exact allocation, replay and no automatic copies',async()=>{
  const count=f.sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies').get()?.n;
  const response=await send(body,'purchase-create-001');assert.equal(response.status,201);id=(await response.json() as any).data.id;
  assert.equal((await send(body,'purchase-create-001')).status,200);assert.equal((await send({...body,fee:1},'purchase-create-001')).status,409);
  const detail=await readPurchase(f.db,id);assert.equal(detail.order.paid_minor,301);assert.equal(detail.order.unallocated_minor,0);assert.deepEqual(detail.allocations.map(a=>a.allocated_minor),[100,201]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies').get()?.n,count);
 });
 await t.test('atomic edit, incomplete allocation, stable lines and historical graphs preserved',async()=>{
  const before=await readPurchase(f.db,id),edit={...body,id,revision:1,method:'manual',shipping:5,lines:[{...line(),allocated:50},{...line(2,200),allocated:100}]};
  assert.equal((await send(edit)).status,201);const after=await readPurchase(f.db,id);
  assert.deepEqual(after.lines.map(l=>l.id),before.lines.map(l=>l.id));assert.equal(after.order.unallocated_minor,155);
  assert.equal((await send(edit)).status,409);assert.equal((await send({...body,id:31,revision:0})).status,409);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM v2_purchase_orders WHERE id=31').get(),oldOrder);assert.deepEqual(f.sqlite.prepare('SELECT * FROM v2_purchase_allocations WHERE id=31').get(),oldAllocation);
 });
 await t.test('currencies and filters, repeat purchases, legacy hints never double counted',async()=>{
  assert.equal((await send({...body,currency:'USD',shipping:0,lines:[line()]})).status,201);
  assert.equal((await send({...body,status:'open',lines:[line()]})).status,201);
  const data=await readPurchases(f.db,new URLSearchParams({collection:'1'}));
  assert.deepEqual(data.costs.map(r=>[r.currency_code,r.allocated_minor]).sort(),[['TWD',150],['USD',100]]);
  assert.ok(!JSON.stringify(data.costs).includes('999999'));
  const year=await readPurchases(f.db,new URLSearchParams({year:'2026',merchant:'PRIVATE_MERCHANT'}));assert.equal(year.orders.length,3);
  assert.equal((await readPurchases(f.db,new URLSearchParams({year:'2025'}))).orders.length,0);
 });
 await t.test('invalid target and late transaction failure rollback entire order',async()=>{
  const n=f.sqlite.prepare('SELECT COUNT(*) n FROM v2_purchase_orders').get()?.n;
  assert.equal((await send({...body,lines:[line(),line(999)]})).status,409);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_purchase_orders').get()?.n,n);
  f.sqlite.exec("CREATE TRIGGER fixture_purchase_failure BEFORE INSERT ON v2_purchase_admin_commands WHEN NEW.request_hash='guard' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.equal((await send(body)).status,503);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_purchase_orders').get()?.n,n);f.sqlite.exec('DROP TRIGGER fixture_purchase_failure');
 });
 const condition={action:'condition',copyId:4,revision:0,seal:'sealed',inspection:'unchecked',trade:'new',date:'',details:'PRIVATE_DAMAGE_NOTE',tags:['sealed']};
 const saveCondition=(input:unknown,key='condition-test-'+(++sequence),token:string|null=jwt)=>handleCollectionCopiesRequest(request('/api/admin/collection/1/copies',input,key,token,'PATCH'),bindings);
 await t.test('copy conditions, dates, missing/damaged tags, replay and counts stay independent',async()=>{
  const counts=f.sqlite.prepare('SELECT * FROM v2_copy_components ORDER BY id').all(),status=f.sqlite.prepare('SELECT acquisition_status FROM v2_collection_items WHERE id=1').get();
  assert.equal((await saveCondition(condition,'condition-sealed')).status,200);assert.equal((await saveCondition(condition,'condition-sealed')).status,200);
  assert.equal((await saveCondition({...condition,revision:1,seal:'unsealed',inspection:'checked',date:'2026-11-12',tags:['missing_parts','moisture_damage']})).status,200);
  assert.equal(f.sqlite.prepare('SELECT condition_checked_at FROM v2_owned_copies WHERE id=4').get()?.condition_checked_at,'2026-11-12');
  assert.equal((await saveCondition({...condition,revision:1})).status,409);
  assert.equal((await saveCondition({...condition,revision:2,seal:'unsealed'})).status,400);
  assert.equal((await saveCondition({...condition,copyId:3})).status,409);
  assert.equal((await saveCondition({...condition,copyId:1})).status,409);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM v2_copy_components ORDER BY id').all(),counts);assert.deepEqual(f.sqlite.prepare('SELECT acquisition_status FROM v2_collection_items WHERE id=1').get(),status);
  assert.equal(f.sqlite.prepare('SELECT notes FROM v2_owned_copies WHERE id=4').get()?.notes,'PRIVATE_EXISTING_NOTES');
  assert.equal((await saveCondition(condition,undefined,null)).status,401);
  assert.equal((await saveCondition(condition,undefined,await auth.token({email:'viewer@example.test'}))).status,403);
 });
 await t.test('condition rollback and public privacy',async()=>{
  const before=f.sqlite.prepare('SELECT * FROM v2_owned_copies WHERE id=4').get(),tags=f.sqlite.prepare('SELECT * FROM v2_copy_condition_tags WHERE owned_copy_id=4').all();
  f.sqlite.exec("CREATE TRIGGER fixture_condition_failure BEFORE UPDATE OF condition_details ON v2_owned_copies BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
  assert.equal((await saveCondition({...condition,revision:2,seal:'unsealed',tags:[]})).status,503);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM v2_owned_copies WHERE id=4').get(),before);assert.deepEqual(f.sqlite.prepare('SELECT * FROM v2_copy_condition_tags WHERE owned_copy_id=4').all(),tags);f.sqlite.exec('DROP TRIGGER fixture_condition_failure');
  const json=JSON.stringify(await readPublicGameCollection(f.db,'BGG:'+f.bggId,f.secret));for(const term of ['PRIVATE','merchant_name','order_reference','allocated_minor','condition_details','condition_checked_at'])assert.ok(!json.includes(term),term);
 });
 await t.test('referenced order graphs stay read only and currency cancellation does not inflate costs',async()=>{
  const detail=await readPurchase(f.db,id),lineId=detail.lines[0].id;
  f.sqlite.prepare("INSERT INTO v2_acquisitions(owned_copy_id,purchase_order_line_id) VALUES(1,?)").run(lineId as number);
  assert.equal((await readPurchase(f.db,id)).locked,true);
  assert.equal((await send({...body,id,revision:2})).status,409);
  const before=await readPurchases(f.db,new URLSearchParams({collection:'1'}));
  assert.equal((await send({...body,status:'cancelled'})).status,201);
  const after=await readPurchases(f.db,new URLSearchParams({collection:'1'}));assert.deepEqual(after.costs,before.costs);
 });
 }finally{f.sqlite.close();auth.restore();}
});
