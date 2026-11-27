import test from 'node:test';
import assert from 'node:assert/strict';
import { sleeveWorkflowFixture } from './helpers/sleeve-workflow-fixture.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { handleSleeveAdminRequest } from '../src/lib/sleeve-admin-api.ts';
import { readPublicGameCollection } from '../src/lib/public-game-collection.ts';
import { readSleeveWorkflow } from '../src/lib/sleeve-workflow.ts';
import { writePhysicalComponent } from '../src/lib/physical-component-management.ts';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

test('0020 preserves unmapped historical applications and locks their requirements',()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')&&f<'0020').sort())sqlite.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
  sqlite.exec(`INSERT INTO v2_collection_items(id,display_name) VALUES(1,'Historical collection');
   INSERT INTO v2_owned_copies(id,collection_item_id) VALUES(1,1);
   INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES(1,630,880);
   INSERT INTO v2_sleeve_products(id,size_id,product_name,sheets_per_pack) VALUES(1,1,'Old product',100);
   INSERT INTO v2_sleeve_requirements(id,collection_item_id,size_id,quantity_sheets) VALUES(1,1,1,30);
   INSERT INTO v2_sleeve_inventory_transactions(id,product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,owned_copy_id) VALUES(1,1,'OPENING_BALANCE','2025-01-01',100,NULL,NULL),(2,1,'USE','2025-01-01',-20,1,1);
   INSERT INTO v2_sleeve_applications(id,owned_copy_id,inventory_transaction_id,quantity_sheets) VALUES(1,1,2,20);`);
  const before=sqlite.prepare('SELECT * FROM v2_sleeve_applications').get();
  sqlite.exec(readFileSync('migrations/0020_sleeve_requirement_applications.sql','utf8'));
  const after=sqlite.prepare('SELECT * FROM v2_sleeve_applications').get()!;
  const {requirement_id,...existing}=after;assert.equal(requirement_id,null);assert.deepEqual(existing,{...before});
  assert.equal(sqlite.prepare('SELECT SUM(quantity_sheets) n FROM v2_sleeve_inventory_transactions').get()?.n,80);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_workflow_commands').get()?.n,0);
  assert.throws(()=>sqlite.exec('UPDATE v2_sleeve_requirements SET quantity_sheets=40 WHERE id=1'),/SLEEVE_REQUIREMENT_IN_USE/);
  assert.throws(()=>sqlite.exec('DELETE FROM v2_sleeve_requirements WHERE id=1'),/SLEEVE_REQUIREMENT_IN_USE/);
 }finally{sqlite.close();}
});

test('batch requirement API validates scope and creates independent records atomically',async t=>{
 const f=await sleeveWorkflowFixture(),auth=await accessFixture();
 try{
  const jwt=await auth.token();
  const bindings={...auth.bindings,DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
  const makeCard=async(collectionId:number,name:string)=>(await writePhysicalComponent(f.db,f.secret,'fixture','batch-fixture-'+name,
   {action:'create',collectionId,name,type:'card',unit:'card',expected:8,confirmed:true})).id;
  const second=await makeCard(1,'second'),third=await makeCard(1,'third'),other=await makeCard(2,'foreign');
  const items=[{componentId:f.cardId,quantity:5},{componentId:second,quantity:8},{componentId:third,quantity:1}];
  const body={action:'requirements-batch',collectionId:1,copyId:1,sizeId:2,items};
  const send=(payload:unknown=body,key='requirements-batch-test',token:string|null=jwt,origin='http://localhost')=>
   handleSleeveAdminRequest(new Request('http://localhost/api/admin/sleeves',{method:'POST',headers:{
    'Content-Type':'application/json',Origin:origin,'X-NotBGG-Request':'1','Idempotency-Key':key,...(token?{'Cf-Access-Jwt-Assertion':token}:{})
   },body:JSON.stringify(payload)}),bindings);
  const total=()=>f.sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_requirements').get()?.n;
  await t.test('rejects unauthenticated and cross-origin commands',async()=>{
   assert.equal((await send(body,undefined,null)).status,401);
   assert.equal((await send(body,undefined,jwt,'http://cross-origin.test')).status,403);
   assert.equal(total(),1);
  });
  await t.test('rejects invalid quantity, size and shape',async()=>{
   for(const quantity of [-1,0.5,1_000_001,'5']){
    assert.equal((await send({...body,items:[items[0],{...items[1],quantity}]})).status,400);
   }
   assert.equal((await send({...body,sizeId:0})).status,400);
   assert.equal((await send({...body,sizeId:999})).status,409);
   assert.equal((await send({...body,items:[]})).status,400);
   assert.equal(total(),1);
  });
  await t.test('rejects ineligible components and rolls back when any valid card belongs to another collection',async()=>{
   assert.equal((await send({...body,items:[items[0],{componentId:f.tokenId,quantity:1}]})).status,409);
   assert.equal((await send({...body,items:[items[0],{componentId:other,quantity:1}]})).status,409);
   assert.equal((await send({...body,copyId:3})).status,409);
   assert.equal(total(),1);
   assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_workflow_commands').get()?.n,0);
  });
  await t.test('concurrent matching requests replay the original IDs and changed payload conflicts',async()=>{
   const responses=await Promise.all([send(),send()]);
   assert.deepEqual(responses.map(response=>response.status).sort(),[200,201]);
   const created=await responses.find(response=>response.status===201)!.json() as {data:{ids:number[];replayed:boolean}};
   const replay=await responses.find(response=>response.status===200)!.json();
   assert.equal(created.data.replayed,false);
   assert.deepEqual(replay,{success:true,data:{ids:created.data.ids,replayed:true}});
   assert.equal((await send({...body,items:[...items.slice(0,2),{...items[2],quantity:2}]})).status,409);
   const rows=f.sqlite.prepare('SELECT id,source_key,component_definition_id,quantity_sheets,assignment_revision FROM v2_sleeve_requirements WHERE id<>1 ORDER BY id').all();
   assert.deepEqual(rows.map(row=>[row.id,row.component_definition_id,row.quantity_sheets,row.assignment_revision]),items.map((item,i)=>[created.data.ids[i],item.componentId,item.quantity,1]));
   assert.equal(new Set(rows.map(row=>row.source_key)).size,3);
   assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM v2_sleeve_inventory_transactions WHERE transaction_type='USE'").get()?.n,0);
  });
 }finally{f.sqlite.close();auth.restore();}
});

test('sleeve requirement and copy application workflow, isolated SQLite',async t=>{
 const f=await sleeveWorkflowFixture(),auth=await accessFixture();
 try{
 const jwt=await auth.token(),bindings={...auth.bindings,DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
 let sequence=0;
 const send=(body:unknown,key='workflow-test-'+(++sequence),token:string|null=jwt)=>handleSleeveAdminRequest(new Request('http://localhost/api/admin/sleeves',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost','X-NotBGG-Request':'1','Idempotency-Key':key,...(token?{'Cf-Access-Jwt-Assertion':token}:{})},body:JSON.stringify(body)}),bindings);
 const requirement={action:'requirement',id:0,revision:0,collectionId:1,copyId:null,componentId:f.cardId,sizeId:1,quantity:30,notes:'PRIVATE_REQUIREMENT'};
 const last=(product=1)=>Number(f.sqlite.prepare('SELECT MAX(id) n FROM v2_sleeve_inventory_transactions WHERE product_id=?').get(product)?.n);
 const balance=(product=1)=>Number(f.sqlite.prepare('SELECT SUM(quantity_sheets) n FROM v2_sleeve_inventory_transactions WHERE product_id=?').get(product)?.n);
 let id=0;
 const apply=(quantity:number,product=1,copy=1,previous=0)=>({action:'apply',id,revision:1,copyId:copy,productId:product,productRevision:0,lastTransactionId:last(product),lastApplicationId:previous,quantity,date:'2026-11-11',confirmed:true,notPreviouslyRecorded:true});
 await t.test('admin authorization, strict fields and safe empty source migration',async()=>{
  assert.equal((await send(requirement,undefined,null)).status,401);
  assert.equal((await send(requirement,undefined,await auth.token({email:'viewer@example.test'}))).status,403);
  assert.equal((await send({...requirement,classification:'PHYSICAL_COMPONENT'})).status,400);
  assert.equal((await send({...requirement,componentId:f.tokenId})).status,409);
  assert.equal((await send({...requirement,componentId:2})).status,409);
  assert.equal((await send({...requirement,componentId:1})).status,409);
  assert.equal((await send({...requirement,copyId:3})).status,409);
  assert.equal(f.sqlite.prepare('SELECT component_definition_id FROM v2_sleeve_requirements WHERE id=1').get()?.component_definition_id,1);
 });
 await t.test('unassigned creation, editing and legacy reference retention do not deduct stock',async()=>{
  const result=await send({...requirement,componentId:null},'create-unassigned');assert.equal(result.status,201);
  const record=(await result.json() as any).data.id;
  assert.equal((await send({...requirement,id:record,revision:1,quantity:20})).status,201);
  assert.equal((await send({...requirement,id:record,revision:1,quantity:10})).status,409);
  assert.equal((await send({...requirement,id:1,revision:0,componentId:1,quantity:35})).status,201);
  assert.equal(balance(),100);
 });
 await t.test('requirement creation replay and scope and product safeguards',async()=>{
  const result=await send(requirement,'create-main-requirement');assert.equal(result.status,201);id=(await result.json() as any).data.id;
  assert.equal((await send(requirement,'create-main-requirement')).status,200);
  assert.equal((await send({...requirement,quantity:31},'create-main-requirement')).status,409);
  assert.equal((await send(apply(5,3))).status,409);
  assert.equal((await send(apply(5,1,3))).status,409);
  assert.equal((await send({...apply(5),notPreviouslyRecorded:false})).status,400);
  assert.equal((await send({...apply(5),quantity:-1})).status,400);
  assert.equal((await send({...apply(5),date:'2026-02-30'})).status,400);
 });
 await t.test('atomic partial use, replay, stale application and locked requirement',async()=>{
  const command=apply(10),response=await send(command,'apply-main-first');assert.equal(response.status,201);const a=(await response.json() as any).data.id;
  assert.equal(balance(),90);
  assert.equal((await send(command,'apply-main-first')).status,200);assert.equal(balance(),90);
  assert.equal((await send(apply(5))).status,409);
  assert.equal((await send({...requirement,id,revision:1,quantity:99})).status,409);
  assert.equal((await send(apply(25,2,1,a))).status,409);
  assert.equal((await send(apply(20,2,1,a))).status,201);
  assert.equal(balance(2),80);
  assert.equal((await send(apply(15,1,2))).status,201);assert.equal(balance(),75);
  const view=await readSleeveWorkflow(f.db,1,f.secret);
  assert.equal(view.applications!.filter(a=>a.requirement_id===id&&a.owned_copy_id===1).reduce((n,a)=>n+Number(a.quantity_sheets),0),30);
  assert.equal(view.applications!.filter(a=>a.requirement_id===id&&a.owned_copy_id===2).reduce((n,a)=>n+Number(a.quantity_sheets),0),15);
 });
 await t.test('insufficient stock, stale ledger and downstream failure rollback both records',async()=>{
  const row=f.sqlite.prepare('SELECT MAX(id) id FROM v2_sleeve_applications WHERE requirement_id=? AND owned_copy_id=2').get(id)!;
  const valid=apply(5,1,2,Number(row.id));
  assert.equal((await send({...valid,lastTransactionId:0})).status,409);
  f.sqlite.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON v2_sleeve_workflow_commands BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
  const before=balance(),count=f.sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_applications').get()?.n;
  assert.equal((await send(valid)).status,503);
  assert.equal(balance(),before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_applications').get()?.n,count);
  f.sqlite.exec('DROP TRIGGER fixture_failure');
  f.sqlite.prepare("INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets) VALUES(1,'USE','2026-11-11',?)").run(-before);
  assert.equal((await send(apply(5,1,2,Number(row.id)))).status,409);assert.equal(balance(),0);
 });
 await t.test('public actual products are copy-specific, verified and privacy whitelisted',async()=>{
  const data=await readPublicGameCollection(f.db,'BGG:'+f.bggId,f.secret),r=data.requirements.find(r=>r.id===id)!;
  assert.deepEqual(r.applications.map(a=>[a.copyNumber,a.quantity,a.product]),[[1,10,'Product A'],[1,20,'Product B'],[2,15,'Product A']]);
  assert.equal(data.requirements.find(r=>r.id===1)!.applications.length,0);
  const json=JSON.stringify(data);for(const value of ['PRIVATE',f.secret,'signature','transaction_date','admin_revision','inventory_transaction_id'])assert.ok(!json.includes(value),value);
 });
 await t.test('copy-specific scope, sealed copies and evidence failure remain closed',async()=>{
  const response=await send({...requirement,copyId:1});assert.equal(response.status,201);
  const scoped=(await response.json() as any).data.id;
  assert.equal((await send({...apply(1,2,2),id:scoped})).status,409);
  f.sqlite.exec("UPDATE v2_owned_copies SET seal_status='sealed' WHERE id=1");
  assert.equal((await send({...apply(1,2,1),id:scoped})).status,409);
  f.sqlite.exec("UPDATE v2_owned_copies SET seal_status='unsealed' WHERE id=1");
  const closed={...bindings,PHYSICAL_COMPONENT_SIGNING_KEY:'invalid'};
  const result=await handleSleeveAdminRequest(new Request('http://localhost/api/admin/sleeves',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost','X-NotBGG-Request':'1','Idempotency-Key':'invalid-proof-test','Cf-Access-Jwt-Assertion':jwt},body:JSON.stringify({...apply(1,2,1),id:scoped})}),closed);
  assert.equal(result.status,409);
 });
 }finally{f.sqlite.close();auth.restore();}
});
