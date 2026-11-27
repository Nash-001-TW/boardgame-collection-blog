import { HttpError } from './notbgg-admin-api';
import { sleeveInteger, commitSleeveCommand } from './sleeve-admin';
import { classifyStoredComponents, maxEvidenceRows } from './component-classifier-adapter';

const evidenceSize=`((SELECT COUNT(*) FROM v2_component_definitions)+(SELECT COUNT(*) FROM collection_components)
 +(SELECT COUNT(*) FROM collection_items)+(SELECT COUNT(*) FROM v2_collection_items)
 +(SELECT COUNT(*) FROM v2_legacy_id_map WHERE (legacy_table='collection_components' AND target_table='v2_component_definitions')
 OR (legacy_table='collection_items' AND target_table='v2_collection_items')))`;
async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function description(value:unknown){if(typeof value!=='string'||value.trim().length>1000)throw new HttpError(400,'INVALID_SLEEVE_INPUT');return value.trim();}

const componentProof=(id='?',signature='?',revision='?')=>`EXISTS (SELECT 1 FROM v2_physical_component_candidates p WHERE p.id=${id} AND p.collection_item_id=c.id
 AND p.component_type='card' AND p.quantity_unit='card' AND p.signature=${signature} AND p.physical_revision=${revision} AND ${evidenceSize}<=?)`;
const requirementScope=`SELECT c.id FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
 WHERE c.id=? AND m.archived_at IS NULL AND EXISTS(SELECT 1 FROM v2_sleeve_sizes WHERE id=?)
 AND (? IS NULL OR EXISTS(SELECT 1 FROM v2_owned_copies WHERE id=? AND collection_item_id=c.id))`;

async function writeRequirementsBatch(db:D1Database,secret:unknown,actor:string,key:string,body:Record<string,unknown>){
 if(Object.keys(body).some(k=>!['action','collectionId','copyId','sizeId','items'].includes(k))
    ||!Array.isArray(body.items)||!body.items.length||body.items.length>100)throw new HttpError(400,'INVALID_SLEEVE_INPUT');
 // The 100-item cap bounds the JSON payload and the guarded INSERT; one collection rarely has that many card components.
 const collection=sleeveInteger(body.collectionId,1),copy=body.copyId===null?null:sleeveInteger(body.copyId,1);
 const size=sleeveInteger(body.sizeId,1);
 const items=body.items.map((item:unknown)=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['componentId','quantity'].includes(k)))
   throw new HttpError(400,'INVALID_SLEEVE_INPUT');
  const entry=item as Record<string,unknown>;
  return {componentId:sleeveInteger(entry.componentId,1),quantity:sleeveInteger(entry.quantity,0,1_000_000)};
 });
 const requestKey=await digest(JSON.stringify(['sleeve-workflow',actor,key]));
 const hash=await digest(JSON.stringify(['requirements-batch',collection,copy,size,items]));
 const sources=requestKey+':*';
 const readIds=async()=>{
  const rows=await db.prepare('SELECT id FROM v2_sleeve_requirements WHERE source_key GLOB ? ORDER BY id').bind(sources).all<{id:number}>();
  if(!rows.success||rows.results.length!==items.length)throw new HttpError(503,'DATABASE_UNAVAILABLE');
  return rows.results.map(row=>row.id);
 };
 const replay=async()=>{
  const row=await db.prepare('SELECT request_hash,result_id FROM v2_sleeve_workflow_commands WHERE request_key=?').bind(requestKey).first<{request_hash:string;result_id:number}>();
  if(!row)return null;
  if(row.request_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT');
  return {id:row.result_id,replayed:true};
 };
 if(await replay())return {ids:await readIds(),replayed:true};

 const definitions=[...new Set(items.map(item=>item.componentId))];
 const classified=await classifyStoredComponents(db,definitions,{secret});
 const revisionRows=await db.prepare('SELECT id,physical_revision FROM v2_component_definitions WHERE id IN (SELECT value FROM json_each(?))')
  .bind(JSON.stringify(definitions)).all<{id:number;physical_revision:number}>();
 if(!revisionRows.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
 const revisions=new Map(revisionRows.results.map(row=>[row.id,row.physical_revision]));
 const signatures=new Map<number,string>();
 for(const definitionId of definitions){
  const result=classified.find(row=>row.definitionId===definitionId);
  if(result?.reason==='EVIDENCE_UNAVAILABLE')throw new HttpError(503,'EVIDENCE_UNAVAILABLE');
  if(!result?.canAssignToSleeves||!result.evidence.physicalSignature)throw new HttpError(409,'COMPONENT_INELIGIBLE');
  signatures.set(definitionId,result.evidence.physicalSignature);
 }
 const input=items.map(item=>({...item,signature:signatures.get(item.componentId),revision:revisions.get(item.componentId)}));
 // Use a bound JSON array so the number of D1 statements and parameters stays constant.
 const statements=[db.prepare(`WITH items AS (
  SELECT key AS position,json_extract(value,'$.componentId') AS component_id,json_extract(value,'$.quantity') AS quantity,
   json_extract(value,'$.signature') AS signature,json_extract(value,'$.revision') AS revision FROM json_each(?)
 ) INSERT INTO v2_sleeve_requirements(source_key,collection_item_id,owned_copy_id,component_definition_id,size_id,quantity_sheets,assignment_status,assignment_revision)
 SELECT ? || items.position,c.id,?,items.component_id,?,items.quantity,'confirmed',1
 FROM (${requirementScope}) c CROSS JOIN items
 WHERE ${componentProof('items.component_id','items.signature','items.revision')} ORDER BY items.position RETURNING id`)
  .bind(JSON.stringify(input),requestKey+':',copy,size,collection,size,copy,copy,maxEvidenceRows)];
 // A guarded INSERT may omit rows. The command's NOT NULL constraint rolls back the entire write.
 statements.push(db.prepare(`INSERT INTO v2_sleeve_workflow_commands(request_key,request_hash,actor,result_id)
  SELECT ?,?,?,CASE WHEN COUNT(*)=? THEN MIN(id) END FROM v2_sleeve_requirements WHERE source_key GLOB ?`)
  .bind(requestKey,hash,actor,items.length,sources));
 const result=await commitSleeveCommand(db,statements,replay,/constraint|SLEEVE_WORKFLOW_STATE_CHANGED/i,'SLEEVE_WORKFLOW_STATE_CHANGED');
 return {ids:await readIds(),replayed:result.replayed};
}

export async function writeSleeveWorkflow(db:D1Database,secret:unknown,actor:string,key:string|null,body:Record<string,unknown>){
 const action=body.action;
 if(action==='requirements-batch'){
  if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY');
  return writeRequirementsBatch(db,secret,actor,key,body);
 }
 const keys=action==='requirement'?['action','id','revision','collectionId','copyId','componentId','sizeId','quantity','notes']
 :action==='apply'?['action','id','revision','copyId','productId','productRevision','lastTransactionId','lastApplicationId','quantity','date','confirmed','notPreviouslyRecorded']:[];
 if(!keys.length||Object.keys(body).some(k=>!keys.includes(k)))throw new HttpError(400,'INVALID_SLEEVE_INPUT');
 if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY');
 const requestKey=await digest(JSON.stringify(['sleeve-workflow',actor,key]));
 const hash=await digest(JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b)))));
 const replay=async()=>{const row=await db.prepare('SELECT request_hash,result_id FROM v2_sleeve_workflow_commands WHERE request_key=?').bind(requestKey).first<{request_hash:string;result_id:number}>();if(!row)return null;if(row.request_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT');return {id:row.result_id,replayed:true};};
 const previous=await replay();if(previous)return previous;
 const id=sleeveInteger(body.id),revision=sleeveInteger(body.revision);
 let definitionId:number|null=null;
 let requirement: {component_definition_id:number|null;collection_item_id:number}|null=null;
 if(action==='requirement')definitionId=body.componentId===null?null:sleeveInteger(body.componentId,1);
 else {
  requirement=await db.prepare('SELECT component_definition_id,collection_item_id FROM v2_sleeve_requirements WHERE id=?').bind(id).first();
  if(!requirement)throw new HttpError(404,'SLEEVE_REQUIREMENT_UNAVAILABLE');
  definitionId=requirement.component_definition_id;
 }
 // Existing legacy references can be retained when editing, but never newly assigned or used.
 const old=action==='requirement'&&id?await db.prepare('SELECT component_definition_id FROM v2_sleeve_requirements WHERE id=?').bind(id).first<{component_definition_id:number|null}>():null;
 const retain=action==='requirement'&&old?.component_definition_id===definitionId;
 let signature:string|null=null,definitionRevision=0;
 if(definitionId!==null&&!retain){
  const [result]=await classifyStoredComponents(db,[definitionId],{secret});
  if(result?.reason==='EVIDENCE_UNAVAILABLE')throw new HttpError(503,'EVIDENCE_UNAVAILABLE');
  if(!result?.canAssignToSleeves||!result.evidence.physicalSignature)throw new HttpError(409,'COMPONENT_INELIGIBLE');
  signature=result.evidence.physicalSignature;
  const definition=await db.prepare('SELECT physical_revision FROM v2_component_definitions WHERE id=?').bind(definitionId).first<{physical_revision:number}>();
  definitionRevision=definition?.physical_revision??0;
 }
 const proof=componentProof();
 const proofArgs=[definitionId,signature,definitionRevision,maxEvidenceRows];
 const statements:D1PreparedStatement[]=[];
 if(action==='requirement'){
  const collection=sleeveInteger(body.collectionId,1),copy=body.copyId===null?null:sleeveInteger(body.copyId,1);
  const size=sleeveInteger(body.sizeId,1),quantity=sleeveInteger(body.quantity,0,1_000_000),notes=description(body.notes);
  // Fixed collection identity. Retaining a legacy reference does not authorize moving it.
  const guard=`${requirementScope} AND (? IS NULL OR ${retain?'EXISTS(SELECT 1 FROM v2_component_definitions WHERE id=? AND collection_item_id=c.id)':proof})`;
  const args=[collection,size,copy,copy,definitionId,...(retain?[definitionId]:proofArgs)];
  if(!id)statements.push(db.prepare(`INSERT INTO v2_sleeve_requirements(source_key,collection_item_id,owned_copy_id,component_definition_id,size_id,quantity_sheets,notes,assignment_status,assignment_revision)
   SELECT ?,c.id,?,?,?,?,?,CASE WHEN ? IS NULL THEN 'unassigned' ELSE 'confirmed' END,1 FROM (${guard}) c RETURNING id`)
   .bind(requestKey,copy,definitionId,size,quantity,notes||null,definitionId,...args));
  else statements.push(db.prepare(`UPDATE v2_sleeve_requirements SET owned_copy_id=?,component_definition_id=?,size_id=?,quantity_sheets=?,notes=?,
   assignment_status=CASE WHEN ? IS NULL THEN 'unassigned' WHEN component_definition_id IS ? THEN assignment_status ELSE 'confirmed' END,assignment_revision=assignment_revision+1,updated_at=CURRENT_TIMESTAMP
   WHERE id=? AND assignment_revision=? AND collection_item_id IN (${guard}) RETURNING id`)
   .bind(copy,definitionId,size,quantity,notes||null,definitionId,definitionId,id,revision,...args));
 }else{
  if(body.confirmed!==true||body.notPreviouslyRecorded!==true)throw new HttpError(400,'SLEEVE_CONFIRMATION_REQUIRED');
  const copy=sleeveInteger(body.copyId,1),product=sleeveInteger(body.productId,1),productRevision=sleeveInteger(body.productRevision);
  const last=sleeveInteger(body.lastTransactionId),lastApplication=sleeveInteger(body.lastApplicationId),quantity=sleeveInteger(body.quantity,1,1_000_000);
  const date=description(body.date),time=Date.parse(date+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date)throw new HttpError(400,'INVALID_SLEEVE_INPUT');
  statements.push(db.prepare(`INSERT INTO v2_sleeve_inventory_transactions(source_key,product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,owned_copy_id)
   SELECT ?,p.id,'USE',?,-?,c.id,o.id FROM v2_sleeve_requirements r JOIN v2_collection_items c ON c.id=r.collection_item_id
   JOIN v2_owned_copies o ON o.id=? AND o.collection_item_id=c.id AND o.inventory_status='in_collection' AND o.seal_status<>'sealed'
   JOIN v2_sleeve_products p ON p.id=? AND p.size_id=r.size_id AND p.is_active=1 AND p.admin_revision=?
   LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
   WHERE r.id=? AND r.assignment_revision=? AND r.component_definition_id=? AND m.archived_at IS NULL
   AND (r.owned_copy_id IS NULL OR r.owned_copy_id=o.id) AND ${proof}
   AND COALESCE((SELECT MAX(id) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id),0)=?
   AND COALESCE((SELECT MAX(id) FROM v2_sleeve_applications WHERE owned_copy_id=o.id AND requirement_id=r.id),0)=?
   AND COALESCE((SELECT SUM(quantity_sheets) FROM v2_sleeve_applications WHERE owned_copy_id=o.id AND requirement_id=r.id),0)+?<=r.quantity_sheets
   AND EXISTS(SELECT 1 FROM v2_copy_components WHERE owned_copy_id=o.id AND component_definition_id=r.component_definition_id AND inspection_status='checked')
   AND NOT EXISTS(SELECT 1 FROM v2_sleeve_applications WHERE owned_copy_id=o.id AND requirement_id IS NULL)
   RETURNING id`).bind(requestKey,date,quantity,copy,product,productRevision,id,revision,definitionId,...proofArgs,last,lastApplication,quantity));
  statements.push(db.prepare(`INSERT INTO v2_sleeve_applications(owned_copy_id,copy_component_id,inventory_transaction_id,quantity_sheets,applied_at,requirement_id)
   SELECT ?,cc.id,t.id,?,?,? FROM v2_sleeve_inventory_transactions t
   JOIN v2_copy_components cc ON cc.owned_copy_id=? AND cc.component_definition_id=? WHERE t.source_key=? RETURNING id`)
   .bind(copy,quantity,date,id,copy,definitionId,requestKey));
 }
 statements.push(db.prepare(`INSERT INTO v2_sleeve_workflow_commands(request_key,request_hash,actor,result_id)
  VALUES(?,?,?,CASE WHEN changes()=1 THEN ${action==='requirement'&&id?'?':'last_insert_rowid()'} ELSE NULL END)`).bind(requestKey,hash,actor,...(action==='requirement'&&id?[id]:[])));
 return commitSleeveCommand(db,statements,replay,/constraint|SLEEVE_REQUIREMENT_IN_USE|SLEEVE_WORKFLOW_STATE_CHANGED|stock negative/i,'SLEEVE_WORKFLOW_STATE_CHANGED');
}

export async function readSleeveWorkflow(db:D1Database,collectionId:number,secret:unknown){
 sleeveInteger(collectionId,1);
 const collection=await db.prepare(`SELECT c.id,c.display_name FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id WHERE c.id=? AND m.archived_at IS NULL`).bind(collectionId).first();
 if(!collection)throw new HttpError(404,'COLLECTION_UNAVAILABLE');
 const queries=[
  ['requirements',`SELECT r.*,s.width_tenth_mm,s.height_tenth_mm FROM v2_sleeve_requirements r JOIN v2_sleeve_sizes s ON s.id=r.size_id WHERE r.collection_item_id=? ORDER BY r.id`],
  ['copies','SELECT id,copy_label,inventory_status,seal_status FROM v2_owned_copies WHERE collection_item_id=? ORDER BY id'],
  ['components','SELECT id,component_name,expected_quantity FROM v2_component_definitions WHERE collection_item_id=? ORDER BY id'],
  ['applications',`SELECT a.id,a.requirement_id,a.owned_copy_id,a.quantity_sheets,a.applied_at,p.product_name,p.brand FROM v2_sleeve_applications a JOIN v2_owned_copies c ON c.id=a.owned_copy_id JOIN v2_sleeve_inventory_transactions t ON t.id=a.inventory_transaction_id JOIN v2_sleeve_products p ON p.id=t.product_id WHERE c.collection_item_id=? ORDER BY a.id`],
  ['counts',`SELECT cc.id,cc.owned_copy_id,cc.component_definition_id,cc.actual_quantity,cc.inspection_status FROM v2_copy_components cc JOIN v2_owned_copies c ON c.id=cc.owned_copy_id WHERE c.collection_item_id=?`],
 ] as const;
 const data:Record<typeof queries[number][0],Record<string,unknown>[]>={requirements:[],copies:[],components:[],applications:[],counts:[]};
 await Promise.all(queries.map(async([name,sql])=>{const result=await db.prepare(sql).bind(collectionId).all<Record<string,unknown>>();if(!result.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');data[name]=result.results;}));
 const [sizes,products]=await Promise.all([
  db.prepare('SELECT id,width_tenth_mm,height_tenth_mm FROM v2_sleeve_sizes ORDER BY width_tenth_mm,height_tenth_mm,id').all<Record<string,unknown>>(),
  db.prepare(`SELECT p.id,p.size_id,p.product_name,p.brand,p.admin_revision,COALESCE(MAX(t.id),0) last_transaction_id,SUM(t.quantity_sheets) balance FROM v2_sleeve_products p LEFT JOIN v2_sleeve_inventory_transactions t ON t.product_id=p.id WHERE p.is_active=1 GROUP BY p.id ORDER BY p.id`).all<Record<string,unknown>>()]);
 if(!sizes.success||!products.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
 const classifications=await classifyStoredComponents(db,data.components.map(row=>Number(row.id)),{secret});
 const eligible=new Set(classifications.filter(row=>row.canAssignToSleeves).map(row=>row.definitionId));
 return {collection,...data,sizes:sizes.results,products:products.results,eligible:[...eligible]};
}
