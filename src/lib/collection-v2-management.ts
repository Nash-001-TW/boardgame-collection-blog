import { getGames } from './games';
import { getCatalogGameType } from './game-content';
import { parseGameRef,gameCatalogKey } from './game-identity';
import type { GameRef } from './game-identity';
export class CollectionWriteError extends Error { constructor(public code:string){super(code);} }
export type CollectionScope='production'|'test';
export const collectionStatuses=['owned','preordered','wishlist','not_owned','sold','gifted_away','unknown'] as const;
export interface CollectionInput {
 displayName:string; acquisitionStatus:typeof collectionStatuses[number]; wishlist:boolean;
 personalRating:number|null; playCount:number|null; comment:string|null; storageNotes:string|null; accessoryNotes:string|null; sleeveNotes:string|null;
 language:string|null; edition:string|null; purchaseDate:string|null; priceMinor:number|null; currency:string; merchant:string|null;
}
const text=(v:unknown,max=300):string|null=>{if(v===null||v===undefined||v==='')return null;if(typeof v!=='string'||v.length>max)throw new CollectionWriteError('VALIDATION');return v.trim()||null;};
function number(v:unknown,max:number,integer=true):number|null{if(v===null||v===undefined)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||(integer&&!Number.isInteger(v)))throw new CollectionWriteError('VALIDATION');return v;}
const fields=['displayName','acquisitionStatus','wishlist','personalRating','playCount','comment','storageNotes','accessoryNotes','sleeveNotes','language','edition','purchaseDate','priceMinor','currency','merchant'];
export function validateCollectionInput(input:unknown):CollectionInput {
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.includes(k)))throw new CollectionWriteError('VALIDATION');
 const d=input as Record<string,unknown>,displayName=text(d.displayName),status=d.acquisitionStatus??'unknown';
 if(!displayName||!collectionStatuses.includes(status as never)||(d.wishlist!==undefined&&typeof d.wishlist!=='boolean'))throw new CollectionWriteError('VALIDATION');
 const date=text(d.purchaseDate),currency=d.currency??'TWD';
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(new Date(date).getTime())||new Date(date).toISOString().slice(0,10)!==date))throw new CollectionWriteError('VALIDATION');
 if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))throw new CollectionWriteError('VALIDATION');
 return {displayName,acquisitionStatus:status as CollectionInput['acquisitionStatus'],wishlist:d.wishlist===true,
  personalRating:number(d.personalRating,10,false),playCount:number(d.playCount,1e7),comment:text(d.comment,10000),storageNotes:text(d.storageNotes,3000),accessoryNotes:text(d.accessoryNotes,3000),sleeveNotes:text(d.sleeveNotes,3000),
  language:text(d.language,40),edition:text(d.edition),purchaseDate:date,priceMinor:number(d.priceMinor,1e12),currency,merchant:text(d.merchant)};
}
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');
const scopeCheck=(s:string):CollectionScope=>{if(s!=='production'&&s!=='test')throw new CollectionWriteError('VALIDATION');return s;};
const positive=(n:number)=>{if(!Number.isSafeInteger(n)||n<1)throw new CollectionWriteError('VALIDATION');return n;};
const personal=(d:CollectionInput)=>({personal_rating:d.personalRating,play_count:d.playCount,personal_comment:d.comment,storage_notes:d.storageNotes,accessory_notes:d.accessoryNotes,sleeve_notes:d.sleeveNotes,purchase_source_hint:d.merchant,purchase_date_hint:d.purchaseDate,purchase_currency_hint:d.currency});
type AdminRow=Record<string,unknown>&{id:number;notes:string|null;revision:number;game_id:number|null;archived_at:string|null;managed_copy_id:number|null;managed_order_id:number|null;notbgg_seq:number|null;source_archived:string|null};
/** Extends the existing V2 tables, never a parallel collection identity or storage backend. */
export class CollectionV2Writer {
 constructor(private db:D1Database){}
 async list(scope:CollectionScope,after=0,limit=20){scopeCheck(scope);if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100)throw new CollectionWriteError('VALIDATION');return (await this.db.prepare(`SELECT c.id,c.display_name,c.item_type,c.acquisition_status,c.record_scope,m.archived_at,COALESCE(m.revision,0) revision,n.seq notbgg_seq,n.archived_at source_archived FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=c.game_id WHERE c.record_scope=? AND c.id>? ORDER BY c.id LIMIT ?`).bind(scope,after,limit).all()).results;}
 async get(id:number,scope:CollectionScope):Promise<AdminRow|null>{positive(id);scopeCheck(scope);return this.db.prepare(`SELECT c.*,EXISTS(SELECT 1 FROM v2_games g WHERE g.id=c.game_id) resolved_game,COALESCE(m.revision,0) revision,m.archived_at,m.managed_copy_id,m.managed_order_id,n.seq notbgg_seq,n.archived_at source_archived FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id LEFT JOIN notbgg_games n ON n.game_id=c.game_id WHERE c.id=? AND c.record_scope=?`).bind(id,scope).first<AdminRow>();}
 async detail(id:number,scope:CollectionScope){const item=await this.get(id,scope);if(!item)return null;
  const copies=(await this.db.prepare('SELECT * FROM v2_owned_copies WHERE collection_item_id=? ORDER BY id').bind(id).all()).results;
  const purchases=(await this.db.prepare('SELECT o.*,l.id line_id,l.unit_price_minor FROM v2_purchase_order_lines l JOIN v2_purchase_orders o ON o.id=l.purchase_order_id WHERE l.collection_item_id=? ORDER BY o.id').bind(id).all()).results;
  const sleeves=(await this.db.prepare('SELECT id,size_id,quantity_sheets,owned_copy_id FROM v2_sleeve_requirements WHERE collection_item_id=?').bind(id).all()).results;
  return {item,copies,purchases,sleeves};
 }
 async search(q:string){if(q.length>200)throw new CollectionWriteError('VALIDATION');const keyword=q.trim().toLowerCase();
  const bgg=getGames().filter(g=>g.bgg&&(!keyword||`bgg:${g.bggId}`===keyword||`#${g.bggId}`===keyword||g.name.toLowerCase().includes(keyword))).slice(0,20).map(g=>({ref:{source:'bgg' as const,bggId:g.bggId},name:g.name,type:g.bgg!.gameType}));
  const rows=await this.db.prepare(`SELECT seq,name,type FROM notbgg_games WHERE archived_at IS NULL AND (instr(lower(name),?)>0 OR lower(printf('NotBGG:%06d',seq))=?) ORDER BY seq LIMIT 20`).bind(keyword,keyword).all<{seq:number;name:string;type:string}>();
  return [...bgg,...rows.results.map(n=>({ref:parseGameRef({source:'notbgg',notBggId:`NotBGG:${String(n.seq).padStart(6,'0')}`}),name:n.name,type:n.type}))];
 }
 async create(refInput:GameRef,input:unknown,context:{actor:string;idempotencyKey:string;scope:CollectionScope;createCopy:boolean}){
  const ref=parseGameRef(refInput),data=validateCollectionInput(input),scope=scopeCheck(context.scope);
  if(!context.actor||!/^[\w:-]{8,256}$/.test(context.idempotencyKey)||typeof context.createCopy!=='boolean')throw new CollectionWriteError('VALIDATION');
  if(!context.createCopy&&[data.language,data.edition,data.priceMinor,data.purchaseDate,data.merchant].some(v=>v!==null))throw new CollectionWriteError('COPY_REQUIRED');
  const fingerprint=await hash([gameCatalogKey(ref),data,scope,context.createCopy]),key=context.actor+':'+scope+':'+context.idempotencyKey;
  const existing=await this.db.prepare('SELECT collection_item_id,request_hash FROM v2_collection_management WHERE request_key=?').bind(key).first<{collection_item_id:number;request_hash:string}>();
  if(existing){if(existing.request_hash!==fingerprint)throw new CollectionWriteError('IDEMPOTENCY_CONFLICT');return {collectionId:existing.collection_item_id,replayed:true};}
  const statements:D1PreparedStatement[]=[];let gameSql:string,gameArg:number,type:string;
  if(ref.source==='bgg'){
   const g=getGames().find(g=>g.bggId===ref.bggId&&g.bgg);if(!g)throw new CollectionWriteError('INVALID_REFERENCE');
   type=getCatalogGameType(g.bgg!.gameType);
   statements.push(this.db.prepare("INSERT INTO v2_games(bgg_id,primary_name,game_type,catalog_source) VALUES (?,?,?,'bgg') ON CONFLICT(bgg_id) DO NOTHING").bind(g.bggId,g.name,type));gameSql='SELECT id FROM v2_games WHERE bgg_id=?';gameArg=ref.bggId;
  }else{const n=await this.db.prepare('SELECT game_id,type FROM notbgg_games WHERE seq=? AND archived_at IS NULL').bind(Number(ref.notBggId.slice(7))).first<{game_id:number;type:string}>();if(!n)throw new CollectionWriteError('INVALID_REFERENCE');type=n.type==='boardgame'?'base':n.type==='boardgameexpansion'?'expansion':'accessory';gameSql='SELECT game_id FROM notbgg_games WHERE seq=? AND archived_at IS NULL';gameArg=Number(ref.notBggId.slice(7));}
  const token=crypto.randomUUID(); // private, transaction-local lookup; never a public identity
  statements.push(this.db.prepare(`INSERT INTO v2_collection_items(game_id,display_name,item_type,acquisition_status,wishlist,notes,record_scope) VALUES ((${gameSql}),?,?,?,?,?,?)`).bind(gameArg,data.displayName,type,data.acquisitionStatus,Number(data.wishlist),JSON.stringify({...personal(data),d5_create_token:token}),scope));
  const item=`(SELECT id FROM v2_collection_items WHERE json_valid(notes) AND json_extract(notes,'$.d5_create_token')=?)`;
  statements.push(this.db.prepare(`INSERT INTO v2_collection_events(collection_item_id,revision,operation,actor) VALUES (${item},1,'create',?)`).bind(token,context.actor));
  statements.push(this.db.prepare(`INSERT INTO v2_collection_management(collection_item_id,revision,request_key,request_hash) VALUES (${item},1,?,?)`).bind(token,key,fingerprint));
  if(context.createCopy){statements.push(this.db.prepare(`INSERT INTO v2_owned_copies(collection_item_id,language_code,edition) VALUES (${item},?,?)`).bind(token,data.language,data.edition));
   statements.push(this.db.prepare(`UPDATE v2_collection_management SET managed_copy_id=last_insert_rowid() WHERE collection_item_id=${item}`).bind(token));
  }
  if(data.priceMinor!==null){statements.push(this.db.prepare('INSERT INTO v2_purchase_orders(merchant_name,ordered_at,currency_code,item_subtotal_minor) VALUES (?,?,?,?)').bind(data.merchant,data.purchaseDate,data.currency,data.priceMinor));
   statements.push(this.db.prepare(`UPDATE v2_collection_management SET managed_order_id=last_insert_rowid() WHERE collection_item_id=${item}`).bind(token));
   const order=`(SELECT managed_order_id FROM v2_collection_management WHERE collection_item_id=${item})`;
   statements.push(this.db.prepare(`INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id,unit_price_minor) VALUES (${order},1,?,${item},?)`).bind(token,data.displayName,token,data.priceMinor));
   statements.push(this.db.prepare(`INSERT INTO v2_acquisitions(owned_copy_id,purchase_order_line_id,acquired_at) SELECT m.managed_copy_id,l.id,NULL FROM v2_collection_management m JOIN v2_purchase_order_lines l ON l.purchase_order_id=m.managed_order_id WHERE m.collection_item_id=${item}`).bind(token));
   statements.push(this.db.prepare(`INSERT INTO v2_purchase_allocations(purchase_order_id,owned_copy_id,allocated_minor,allocation_method) SELECT managed_order_id,managed_copy_id,?,'direct' FROM v2_collection_management WHERE collection_item_id=${item}`).bind(data.priceMinor,token));
  }
  try{await this.db.batch(statements);}catch{
   const replay=await this.db.prepare('SELECT collection_item_id,request_hash FROM v2_collection_management WHERE request_key=?').bind(key).first<{collection_item_id:number;request_hash:string}>();
   if(replay){if(replay.request_hash!==fingerprint)throw new CollectionWriteError('IDEMPOTENCY_CONFLICT');return {collectionId:replay.collection_item_id,replayed:true};}throw new CollectionWriteError('STORAGE');
  }
  const created=await this.db.prepare('SELECT collection_item_id FROM v2_collection_management WHERE request_key=?').bind(key).first<{collection_item_id:number}>();return {collectionId:created!.collection_item_id,replayed:false};
 }
 async update(id:number,input:unknown,ctx:{actor:string;scope:CollectionScope;expectedRevision:number;createCopy?:boolean},archive=false){
  const current=await this.get(id,ctx.scope);if(!current)throw new CollectionWriteError('NOT_FOUND');if(current.archived_at)throw new CollectionWriteError('ARCHIVED');
  if(!Number.isSafeInteger(ctx.expectedRevision)||ctx.expectedRevision<0||ctx.expectedRevision!==current.revision)throw new CollectionWriteError('CONFLICT');
  if(!ctx.actor||(ctx.createCopy!==undefined&&typeof ctx.createCopy!=='boolean'))throw new CollectionWriteError('VALIDATION');
  const data=archive?null:validateCollectionInput(input),rev=current.revision+1,now=new Date().toISOString();
  const statements=[this.db.prepare('INSERT INTO v2_collection_events(collection_item_id,revision,operation,actor) VALUES (?,?,?,?)').bind(id,rev,archive?'archive':'update',ctx.actor),this.db.prepare(`INSERT INTO v2_collection_management(collection_item_id,revision,archived_at) VALUES (?,?,?) ON CONFLICT(collection_item_id) DO UPDATE SET revision=excluded.revision,archived_at=excluded.archived_at`).bind(id,rev,archive?now:null)];
  if(data){let notes:Record<string,unknown>;try{notes=JSON.parse(current.notes??'{}');if(!notes||typeof notes!=='object'||Array.isArray(notes))throw 0;}catch{notes={legacy_notes:current.notes};}
   if(data.acquisitionStatus!==current.acquisition_status)delete notes.owned;Object.assign(notes,personal(data));
   statements.push(this.db.prepare('UPDATE v2_collection_items SET display_name=?,acquisition_status=?,wishlist=?,notes=?,updated_at=? WHERE id=? AND record_scope=?').bind(data.displayName,data.acquisitionStatus,Number(data.wishlist),JSON.stringify(notes),now,id,ctx.scope));
   if(current.managed_copy_id)statements.push(this.db.prepare('UPDATE v2_owned_copies SET language_code=?,edition=?,updated_at=? WHERE id=? AND collection_item_id=?').bind(data.language,data.edition,now,current.managed_copy_id,id));
   else if(ctx.createCopy){statements.push(this.db.prepare('INSERT INTO v2_owned_copies(collection_item_id,language_code,edition) VALUES (?,?,?)').bind(id,data.language,data.edition),this.db.prepare('UPDATE v2_collection_management SET managed_copy_id=last_insert_rowid() WHERE collection_item_id=?').bind(id));}
   else if([data.language,data.edition,data.purchaseDate,data.priceMinor,data.merchant].some(v=>v!==null))throw new CollectionWriteError('COPY_REQUIRED');
   // Existing purchase graphs are preserved. This editor updates its single managed order only.
   if(current.managed_order_id){if(data.priceMinor===null)throw new CollectionWriteError('PURCHASE_REQUIRED');
    const graph=await this.db.prepare(`SELECT (SELECT count(*) FROM v2_purchase_order_lines WHERE purchase_order_id=?) lines,(SELECT count(*) FROM v2_purchase_allocations WHERE purchase_order_id=? AND (owned_copy_id IS NOT ? OR collection_item_id IS NOT NULL)) others`).bind(current.managed_order_id,current.managed_order_id,current.managed_copy_id).first<{lines:number;others:number}>();
    if(graph?.lines!==1||graph.others)throw new CollectionWriteError('PURCHASE_NOT_MANAGED');
    statements.push(this.db.prepare('UPDATE v2_purchase_allocations SET allocated_minor=0 WHERE purchase_order_id=? AND owned_copy_id=?').bind(current.managed_order_id,current.managed_copy_id),this.db.prepare('UPDATE v2_purchase_orders SET item_subtotal_minor=?,currency_code=?,merchant_name=?,ordered_at=? WHERE id=?').bind(data.priceMinor,data.currency,data.merchant,data.purchaseDate,current.managed_order_id),this.db.prepare('UPDATE v2_purchase_order_lines SET unit_price_minor=?,description=? WHERE purchase_order_id=? AND collection_item_id=?').bind(data.priceMinor,data.displayName,current.managed_order_id,id),this.db.prepare('UPDATE v2_purchase_allocations SET allocated_minor=? WHERE purchase_order_id=? AND owned_copy_id=?').bind(data.priceMinor,current.managed_order_id,current.managed_copy_id));

   }else if(data.priceMinor!==null){
    statements.push(this.db.prepare('INSERT INTO v2_purchase_orders(merchant_name,ordered_at,currency_code,item_subtotal_minor) VALUES (?,?,?,?)').bind(data.merchant,data.purchaseDate,data.currency,data.priceMinor),
     this.db.prepare('UPDATE v2_collection_management SET managed_order_id=last_insert_rowid() WHERE collection_item_id=?').bind(id),
     this.db.prepare('INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id,unit_price_minor) SELECT managed_order_id,1,?,?,? FROM v2_collection_management WHERE collection_item_id=?').bind(data.displayName,id,data.priceMinor,id),
     this.db.prepare('INSERT INTO v2_acquisitions(owned_copy_id,purchase_order_line_id,acquired_at) SELECT managed_copy_id,last_insert_rowid(),NULL FROM v2_collection_management WHERE collection_item_id=?').bind(id),
     this.db.prepare("INSERT INTO v2_purchase_allocations(purchase_order_id,owned_copy_id,allocated_minor,allocation_method) SELECT managed_order_id,managed_copy_id,?,'direct' FROM v2_collection_management WHERE collection_item_id=?").bind(data.priceMinor,id));
   }
  }
  try{await this.db.batch(statements);}catch(e){throw new CollectionWriteError(String(e).includes('COLLECTION_REVISION_CONFLICT')?'CONFLICT':'STORAGE');}
  return this.detail(id,ctx.scope);
 }
}
