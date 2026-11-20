import {HttpError} from './notbgg-admin-api';

export function purchaseInteger(value:unknown,min=0,max=1_000_000_000_000):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new HttpError(400,'INVALID_PURCHASE_INPUT');return value;
}
function text(value:unknown,max=1000):string{if(typeof value!=='string'||value.length>max||value.includes('\0'))throw new HttpError(400,'INVALID_PURCHASE_INPUT');return value.trim();}
export function purchaseDate(value:unknown):string|null{const date=text(value,10);if(!date)return null;const time=Date.parse(date+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date)throw new HttpError(400,'INVALID_PURCHASE_INPUT');return date;}
function fields(input:Record<string,unknown>,keys:string[]){if(Object.keys(input).some(key=>!keys.includes(key)))throw new HttpError(400,'UNKNOWN_FIELD');}
async function digest(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}

/** Integer largest remainder allocation. Input order breaks ties deterministically. */
export function proportionalAllocation(total:number,weights:number[]):number[]{
 purchaseInteger(total);weights.forEach(value=>purchaseInteger(value));
 const sum=weights.reduce((n,w)=>n+BigInt(w),0n);if(!sum)throw new HttpError(400,'ALLOCATION_WEIGHTS_REQUIRED');
 const rows=weights.map((w,index)=>({index,amount:BigInt(total)*BigInt(w)/sum,remainder:BigInt(total)*BigInt(w)%sum}));
 let left=BigInt(total)-rows.reduce((n,r)=>n+r.amount,0n);
 for(const row of [...rows].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(left<=0n)break;row.amount++;left--;}
 return rows.map(row=>Number(row.amount));
}

async function receipt(db:D1Database,actor:string,key:string|null,body:unknown,namespace:string){
 if(!key||!/^[A-Za-z0-9_-]{8,128}$/.test(key))throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY');
 const requestKey=await digest([namespace,actor,key]),hash=await digest(body);
 const replay=async()=>{const row=await db.prepare('SELECT request_hash,result_id FROM v2_purchase_admin_commands WHERE request_key=?').bind(requestKey).first<{request_hash:string;result_id:number}>();if(!row)return null;if(row.request_hash!==hash)throw new HttpError(409,'IDEMPOTENCY_CONFLICT');return {id:row.result_id,replayed:true};};
 return {requestKey,hash,replay};
}

export async function writePurchase(db:D1Database,actor:string,key:string|null,body:Record<string,unknown>){
 fields(body,['id','revision','date','merchant','reference','currency','shipping','tax','fee','discount','refunded','status','notes','method','lines']);
 const id=purchaseInteger(body.id),revision=purchaseInteger(body.revision),date=purchaseDate(body.date),merchant=text(body.merchant,200),reference=text(body.reference,200),notes=text(body.notes,3000);
 const currency=text(body.currency,3);if(!/^[A-Z]{3}$/.test(currency))throw new HttpError(400,'INVALID_PURCHASE_INPUT');
 const status=body.status;if(!['open','paid','partially_received','completed','cancelled'].includes(String(status)))throw new HttpError(400,'INVALID_PURCHASE_INPUT');
 const method=body.method;if(!['manual','direct','weighted'].includes(String(method)))throw new HttpError(400,'INVALID_PURCHASE_INPUT');
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>30)throw new HttpError(400,'INVALID_PURCHASE_INPUT');
 const lines=body.lines.map((value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'INVALID_PURCHASE_INPUT');const line=value as Record<string,unknown>;
  fields(line,['collectionId','description','quantity','price','discount','allocated']);
  const collectionId=purchaseInteger(line.collectionId,1),description=text(line.description,200),quantity=purchaseInteger(line.quantity,1,10000),price=purchaseInteger(line.price),discount=purchaseInteger(line.discount),allocated=purchaseInteger(line.allocated);
  const net=BigInt(quantity)*BigInt(price)-BigInt(discount);if(!description||net<0n||net>1_000_000_000_000n)throw new HttpError(400,'INVALID_PURCHASE_INPUT');
  return {collectionId,description,quantity,price,discount,allocated,net:Number(net)};
 });
 const shipping=purchaseInteger(body.shipping),tax=purchaseInteger(body.tax),fee=purchaseInteger(body.fee),discount=purchaseInteger(body.discount),refunded=purchaseInteger(body.refunded);
 const subtotal=lines.reduce((sum,line)=>sum+BigInt(line.net),0n),total=subtotal+BigInt(shipping)+BigInt(tax)+BigInt(fee)-BigInt(discount)-BigInt(refunded);
 if(subtotal>1_000_000_000_000n||total<0n||total>1_000_000_000_000n)throw new HttpError(400,'INVALID_PURCHASE_INPUT');
 const amounts=method==='weighted'?proportionalAllocation(Number(total),lines.map(line=>line.net)):lines.map(line=>line.allocated);
 if(amounts.reduce((n,a)=>n+BigInt(a),0n)>total)throw new HttpError(400,'ALLOCATION_EXCEEDS_TOTAL');
 const normalized={id,revision,date,merchant,reference,notes,currency,status,method,lines,shipping,tax,fee,discount,refunded,amounts};
 const command=await receipt(db,actor,key,normalized,'purchase');const replay=await command.replay();if(replay)return replay;
 // Reserve identity in a single batch using the command key as a private temporary reference.
 // A failed guard is forced to rollback through the NOT NULL receipt below.
 const statements:D1PreparedStatement[]=[];
 if(id){
  const old=await readPurchase(db,id);
  if(old.order.admin_managed!==1||old.order.admin_revision!==revision||old.locked)throw new HttpError(409,'PURCHASE_READ_ONLY');
  if(lines.length<old.lines.length)throw new HttpError(400,'PURCHASE_LINES_RETAINED');
  // New editor-owned allocations can be replaced atomically. Historical graphs are never claimed.
  statements.push(db.prepare(`UPDATE v2_purchase_orders SET admin_revision=admin_revision+1 WHERE id=? AND admin_managed=1 AND admin_revision=?
   AND NOT EXISTS(SELECT 1 FROM v2_acquisitions WHERE purchase_order_line_id IN(SELECT id FROM v2_purchase_order_lines WHERE purchase_order_id=v2_purchase_orders.id))
   AND NOT EXISTS(SELECT 1 FROM v2_sleeve_inventory_transactions WHERE purchase_order_line_id IN(SELECT id FROM v2_purchase_order_lines WHERE purchase_order_id=v2_purchase_orders.id))
   AND NOT EXISTS(SELECT 1 FROM v2_purchase_allocations a LEFT JOIN v2_purchase_order_lines l ON l.id=a.purchase_order_line_id
    WHERE a.purchase_order_id=v2_purchase_orders.id AND (a.owned_copy_id IS NOT NULL OR l.purchase_order_id IS NOT v2_purchase_orders.id OR l.collection_item_id IS NOT a.collection_item_id))
   AND (SELECT COUNT(*) FROM v2_purchase_allocations WHERE purchase_order_id=v2_purchase_orders.id)=(SELECT COUNT(*) FROM v2_purchase_order_lines WHERE purchase_order_id=v2_purchase_orders.id)
   RETURNING id`).bind(id,revision));
  statements.push(db.prepare(`INSERT INTO v2_purchase_admin_commands(request_key,request_hash,actor,result_id) VALUES(?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END)`).bind(command.requestKey,command.hash,actor,id));
  statements.push(db.prepare('DELETE FROM v2_purchase_allocations WHERE purchase_order_id=?').bind(id));
 }else{
  // The source receipt is inserted immediately after this row; no ID guessing and no copy creation.
  statements.push(db.prepare(`INSERT INTO v2_purchase_orders(order_reference,merchant_name,ordered_at,currency_code,item_subtotal_minor,shipping_minor,tax_minor,fee_minor,discount_minor,refunded_minor,status,notes,admin_managed,admin_revision)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,1) RETURNING id`).bind(reference||null,merchant||null,date,currency,Number(subtotal),shipping,tax,fee,discount,refunded,String(status),notes||null));
  statements.push(db.prepare('INSERT INTO v2_purchase_admin_commands(request_key,request_hash,actor,result_id) VALUES(?,?,?,last_insert_rowid())').bind(command.requestKey,command.hash,actor));
 }
 const target='(SELECT result_id FROM v2_purchase_admin_commands WHERE request_key=?)';
 if(id)statements.push(db.prepare(`UPDATE v2_purchase_orders SET order_reference=?,merchant_name=?,ordered_at=?,currency_code=?,item_subtotal_minor=?,shipping_minor=?,tax_minor=?,fee_minor=?,discount_minor=?,refunded_minor=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=${target}`)
  .bind(reference||null,merchant||null,date,currency,Number(subtotal),shipping,tax,fee,discount,refunded,String(status),notes||null,command.requestKey));
 for(const [index,line] of lines.entries()){
  statements.push(db.prepare(`INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id,quantity,unit_price_minor,line_discount_minor)
   SELECT ${target},?,?,c.id,?,?,? FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id
   WHERE c.id=? AND m.archived_at IS NULL AND c.record_scope='production'
   ON CONFLICT(purchase_order_id,line_number) DO UPDATE SET description=excluded.description,collection_item_id=excluded.collection_item_id,quantity=excluded.quantity,unit_price_minor=excluded.unit_price_minor,line_discount_minor=excluded.line_discount_minor RETURNING id`)
   .bind(command.requestKey,index+1,line.description,line.quantity,line.price,line.discount,line.collectionId));
  // A line that fails collection eligibility must abort the whole order, not disappear silently.
  statements.push(db.prepare(`INSERT INTO v2_purchase_allocations(purchase_order_id,purchase_order_line_id,collection_item_id,allocated_minor,allocation_method)
   VALUES(${target},CASE WHEN changes()=1 THEN (SELECT id FROM v2_purchase_order_lines WHERE purchase_order_id=${target} AND line_number=?) ELSE NULL END,?,?,?)`)
   .bind(command.requestKey,command.requestKey,index+1,line.collectionId,amounts[index],String(method)));
  // NULL line FK is permitted by the old schema, so enforce our line count and reference at commit.
 }
 statements.push(db.prepare(`INSERT INTO v2_purchase_admin_commands(request_key,request_hash,actor,result_id)
   SELECT ?,'guard',?,CASE WHEN (SELECT COUNT(*) FROM v2_purchase_allocations WHERE purchase_order_id=${target} AND purchase_order_line_id IS NOT NULL)=?
   THEN ${target} ELSE NULL END`).bind(command.requestKey+':guard',actor,command.requestKey,lines.length,command.requestKey));
 try{await db.batch(statements);const saved=await command.replay();return {id:saved!.id,replayed:false};}
 catch(error){const saved=await command.replay();if(saved)return saved;if(/constraint|allocation|order net/i.test(String(error)))throw new HttpError(409,'PURCHASE_STATE_CHANGED');throw error;}
}

export async function readPurchase(db:D1Database,id:number){
 purchaseInteger(id,1);
 const order=await db.prepare(`SELECT o.*,r.paid_minor,r.allocated_minor,r.unallocated_minor FROM v2_purchase_orders o JOIN v2_purchase_order_reconciliation r ON r.purchase_order_id=o.id WHERE o.id=?`).bind(id).first<Record<string,unknown>>();
 if(!order)throw new HttpError(404,'PURCHASE_NOT_FOUND');
 const [lines,allocations,dependencies]=await Promise.all([
  db.prepare('SELECT * FROM v2_purchase_order_lines WHERE purchase_order_id=? ORDER BY line_number').bind(id).all<Record<string,unknown>>(),
  db.prepare('SELECT * FROM v2_purchase_allocations WHERE purchase_order_id=? ORDER BY id').bind(id).all<Record<string,unknown>>(),
  db.prepare(`SELECT (SELECT COUNT(*) FROM v2_acquisitions WHERE purchase_order_line_id IN(SELECT id FROM v2_purchase_order_lines WHERE purchase_order_id=?))+
   (SELECT COUNT(*) FROM v2_sleeve_inventory_transactions WHERE purchase_order_line_id IN(SELECT id FROM v2_purchase_order_lines WHERE purchase_order_id=?)) n`).bind(id,id).first<{n:number}>()]);
 if(!lines.success||!allocations.success||!dependencies)throw new HttpError(503,'DATABASE_UNAVAILABLE');
 for(const row of [order,...lines.results,...allocations.results])for(const [name,value] of Object.entries(row))if(name.endsWith('_minor')&&value!==null&&!Number.isSafeInteger(value))throw new HttpError(503,'AMOUNT_OUT_OF_RANGE');
 const graphChanged=allocations.results.length!==lines.results.length||lines.results.some((line,index)=>line.line_number!==index+1
  ||allocations.results.filter(a=>a.purchase_order_line_id===line.id&&a.collection_item_id===line.collection_item_id&&a.owned_copy_id===null).length!==1);
 return {order,lines:lines.results,allocations:allocations.results,locked:dependencies.n>0||graphChanged};
}

export async function readPurchases(db:D1Database,params:URLSearchParams){
 const year=params.get('year')??'',merchant=params.get('merchant')??'',collection=Number(params.get('collection')||0),after=Number(params.get('after')||0);
 if((year&&!/^\d{4}$/.test(year))||merchant.length>200)throw new HttpError(400,'INVALID_PURCHASE_INPUT');purchaseInteger(collection);purchaseInteger(after);
 const filter=`(?='' OR substr(o.ordered_at,1,4)=?) AND (?='' OR instr(lower(COALESCE(o.merchant_name,'')),lower(?))>0)
 AND (?=0 OR EXISTS(SELECT 1 FROM v2_purchase_order_lines l WHERE l.purchase_order_id=o.id AND l.collection_item_id=?)
 OR EXISTS(SELECT 1 FROM v2_purchase_allocations a LEFT JOIN v2_owned_copies c ON c.id=a.owned_copy_id WHERE a.purchase_order_id=o.id AND COALESCE(a.collection_item_id,c.collection_item_id)=?))`;
 const args=[year,year,merchant,merchant,collection,collection,collection];
 const [orders,totals,costs]=await Promise.all([
  db.prepare(`SELECT o.*,r.paid_minor,r.allocated_minor,r.unallocated_minor FROM v2_purchase_orders o JOIN v2_purchase_order_reconciliation r ON r.purchase_order_id=o.id WHERE ${filter} AND o.id>? ORDER BY o.id LIMIT 21`).bind(...args,after).all<Record<string,unknown>>(),
  db.prepare(`SELECT o.currency_code,o.status,SUM(r.paid_minor) net_minor FROM v2_purchase_orders o JOIN v2_purchase_order_reconciliation r ON r.purchase_order_id=o.id WHERE ${filter} GROUP BY o.currency_code,o.status`).bind(...args).all<Record<string,unknown>>(),
  db.prepare(`SELECT COALESCE(a.collection_item_id,c.collection_item_id) collection_item_id,o.currency_code,SUM(a.allocated_minor) allocated_minor
   FROM v2_purchase_allocations a JOIN v2_purchase_orders o ON o.id=a.purchase_order_id LEFT JOIN v2_owned_copies c ON c.id=a.owned_copy_id
   WHERE ${filter} AND (?=0 OR COALESCE(a.collection_item_id,c.collection_item_id)=?) AND o.status IN('paid','partially_received','completed')
   GROUP BY COALESCE(a.collection_item_id,c.collection_item_id),o.currency_code`).bind(...args,collection,collection).all<Record<string,unknown>>()]);
 if(!orders.success||!totals.success||!costs.success)throw new HttpError(503,'DATABASE_UNAVAILABLE');
 // SQLite integer SUM may exceed JavaScript exactness. Never return an approximate monetary value.
 for(const row of [...orders.results,...totals.results,...costs.results])for(const [name,value]of Object.entries(row))if(name.endsWith('_minor')&&value!==null&&!Number.isSafeInteger(value))throw new HttpError(503,'AMOUNT_OUT_OF_RANGE');
 return {orders:orders.results.slice(0,20),totals:totals.results,costs:costs.results,nextCursor:orders.results.length>20?Number(orders.results[19].id):null};
}

export const conditionCodes=['sealed','opened_unplayed','sleeved','missing_parts','moisture_damage'] as const;
export async function writeCopyCondition(db:D1Database,collectionId:number,scope:string,actor:string,key:string|null,body:Record<string,unknown>){
 fields(body,['action','copyId','revision','seal','inspection','trade','date','details','tags']);
 const copyId=purchaseInteger(body.copyId,1),revision=purchaseInteger(body.revision),date=purchaseDate(body.date),details=text(body.details,3000);
 if(!['sealed','unsealed','unknown'].includes(String(body.seal))||!['unchecked','checked','needs_review'].includes(String(body.inspection))||!['unknown','new','secondhand_like_new','secondhand_used','secondhand_incomplete','secondhand_damaged'].includes(String(body.trade))
  ||!Array.isArray(body.tags)||body.tags.some(tag=>!conditionCodes.includes(tag))||new Set(body.tags).size!==body.tags.length)throw new HttpError(400,'INVALID_PURCHASE_INPUT');
 if((body.tags.includes('sealed')&&body.seal!=='sealed')||(body.seal==='sealed'&&(body.tags.includes('opened_unplayed')||body.tags.includes('sleeved'))))throw new HttpError(400,'INVALID_COPY_CONDITION');
 const command=await receipt(db,actor,key,{collectionId,scope,...body},'condition'),replay=await command.replay();if(replay)return replay;
 const statements=[db.prepare(`UPDATE v2_owned_copies SET condition_revision=condition_revision+1 WHERE id=? AND collection_item_id=? AND condition_revision=?
  AND EXISTS(SELECT 1 FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id WHERE c.id=? AND c.record_scope=? AND m.archived_at IS NULL)
  AND (?<>'sealed' OR (NOT EXISTS(SELECT 1 FROM v2_sleeve_applications WHERE owned_copy_id=v2_owned_copies.id)
   AND NOT EXISTS(SELECT 1 FROM v2_copy_components WHERE owned_copy_id=v2_owned_copies.id AND inspection_status='checked'))) RETURNING id`).bind(copyId,collectionId,revision,collectionId,scope,String(body.seal)),
  db.prepare(`INSERT INTO v2_purchase_admin_commands(request_key,request_hash,actor,result_id) VALUES(?,?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END)`).bind(command.requestKey,command.hash,actor,copyId)];
 // Delete only explicitly removed tags. Preserved tags retain their IDs, notes and original dates.
 for(const code of conditionCodes)if(!body.tags.includes(code))statements.push(db.prepare('DELETE FROM v2_copy_condition_tags WHERE owned_copy_id=? AND condition_code=?').bind(copyId,code));
 statements.push(db.prepare(`UPDATE v2_owned_copies SET seal_status=?,inspection_status=?,trade_condition=?,condition_checked_at=?,condition_details=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(body.seal),String(body.inspection),String(body.trade),date,details||null,copyId));
 for(const code of body.tags)statements.push(db.prepare(`INSERT INTO v2_copy_condition_tags(owned_copy_id,condition_code) VALUES(?,?) ON CONFLICT(owned_copy_id,condition_code) DO NOTHING`).bind(copyId,String(code)));
 try{await db.batch(statements);return {id:copyId,replayed:false};}catch(error){const saved=await command.replay();if(saved)return saved;if(/constraint|seal_status|sealed|condition/i.test(String(error)))throw new HttpError(409,'COPY_STATE_CHANGED');throw error;}
}
