import test from 'node:test';
import assert from 'node:assert/strict';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {handlePurchaseAdminRequest} from '../src/lib/purchase-admin-api.ts';
import {readPurchase} from '../src/lib/purchase-admin.ts';

// Characterizes current behavior, not acceptance of the proposed R10 design.
test('R10 preflight: current API cancellation, locks and methods in isolated SQLite',async()=>{
 const f=await sleeveWorkflowFixture(),auth=await accessFixture();
 try{
  const jwt=await auth.token(),bindings={...auth.bindings,DB:f.db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
  let seq=0;
  const payload={id:0,revision:0,date:'2026-11-17',merchant:'Synthetic',reference:'',currency:'TWD',shipping:0,tax:0,fee:0,discount:0,refunded:0,status:'paid',notes:'',method:'manual',lines:[{collectionId:1,description:'Synthetic',quantity:1,price:100,discount:0,allocated:100}]};
  const send=(body:unknown,method='POST')=>handlePurchaseAdminRequest(new Request('http://localhost/api/admin/purchases',{method,headers:{'Content-Type':'application/json',Origin:'http://localhost','X-NotBGG-Request':'1','Idempotency-Key':'r10-preflight-'+(++seq),'Cf-Access-Jwt-Assertion':jwt},body:JSON.stringify(body)}),bindings);
  const created=await send(payload);assert.equal(created.status,201);
  const id=(await created.json() as any).data.id;
  assert.equal((await send({...payload,id,revision:1,status:'cancelled'})).status,201);
  assert.equal((await send({...payload,id,revision:2,status:'cancelled',notes:'Changed while cancelled'})).status,201);
  assert.equal((await send({...payload,id,revision:3,status:'open'})).status,201);
  const line=(await readPurchase(f.db,id)).lines[0].id;
  f.sqlite.prepare('INSERT INTO v2_acquisitions(owned_copy_id,purchase_order_line_id) VALUES(?,?)').run(1,line as number);
  assert.equal((await send({...payload,id,revision:4,status:'cancelled'})).status,409);
  assert.equal((await send({...payload,id,revision:4,status:'paid'})).status,409);
  assert.equal((await send({...payload,id,revision:4},'DELETE')).status,405);
 }finally{f.sqlite.close();auth.restore();}
});
