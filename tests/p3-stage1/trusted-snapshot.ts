import {classifyStoredComponents} from '../../src/lib/component-classifier-adapter.ts';
import {hash,trace} from './local-runtime.ts';

const trusted=new WeakSet<object>();
const tablePart=(name:string,sql:string)=>`json_object('kind','${name}','rows',json(COALESCE((SELECT json_group_array(json_object(${sql.split('|')[0]})) FROM (${sql.split('|')[1]})),'[]')))`;
const localParts=[
 tablePart('copies',"'id',id,'collection',collection_item_id,'inventory',inventory_status,'seal',seal_status|SELECT * FROM v2_owned_copies ORDER BY id"),
 tablePart('counts',"'id',id,'copy',owned_copy_id,'definition',component_definition_id,'actual',actual_quantity,'status',inspection_status,'revision',count_revision|SELECT * FROM v2_copy_components ORDER BY id"),
 tablePart('details',"'id',id,'collection',collection_item_id,'expected',expected_quantity,'revision',physical_revision|SELECT * FROM v2_component_definitions ORDER BY id"),
 tablePart('dates',"'copy',copy_id,'definition',definition_id,'date',checked_date|SELECT * FROM p3_s1_dates ORDER BY copy_id,definition_id"),
 tablePart('applicability',"'copy',copy_id,'definition',definition_id,'applies',applies|SELECT * FROM p3_s1_applicability ORDER BY copy_id,definition_id"),
 tablePart('current',"'copy',copy_id,'status',status,'n',n,'m',m,'u',u,'date',completed_date,'confirmed',confirmed_at|SELECT * FROM p3_s1_current ORDER BY copy_id"),
 tablePart('range',"'id',id,'scope',record_scope,'archived',archived_at,'revision',revision|SELECT c.id,c.record_scope,m.archived_at,m.revision FROM v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id ORDER BY c.id")
];
function manifestSQL(evidenceSql:string){return `WITH classifier_input AS (${evidenceSql}), local_input AS (SELECT json_array(${localParts.join(',')}) AS doc)
 SELECT 'e:'||kind AS kind,json_object('payload',payload,'total_rows',total_rows) AS payload FROM classifier_input
 UNION ALL SELECT 'l:'||json_extract(j.value,'$.kind'),json_extract(j.value,'$.rows') FROM local_input,json_each(local_input.doc) j`;}
export async function capture(db:any,definitionIds:number[],secret:string,afterCapture?:()=>Promise<void>){
 let snapshot:any;
 const adapterDb={prepare:(sql:string)=>({all:async()=>{if(snapshot)throw Error('Multiple evidence queries unexpected');const fullSQL=manifestSQL(sql);const r=await db.prepare(fullSQL).all();if(!r.success)throw Error('Snapshot unavailable');const rows=r.results.map((x:any)=>({kind:x.kind,payload:x.payload}));snapshot={sql:fullSQL,rows,definitionIds:[...definitionIds],hash:hash(rows),classification:[],local:Object.fromEntries(rows.filter((r:any)=>r.kind.startsWith('l:')).map((r:any)=>[r.kind.slice(2),JSON.parse(r.payload)]))};const originalRows=rows.filter((r:any)=>r.kind.startsWith('e:')).map((r:any)=>({kind:r.kind.slice(2),...JSON.parse(r.payload)}));if(afterCapture)await afterCapture();return {success:true,results:originalRows};}})};
 const classification=await classifyStoredComponents(adapterDb,definitionIds,{secret});
 if(!snapshot)throw Error('Empty requested set is not a complete snapshot');
 if(classification.some(r=>r.reason==='EVIDENCE_UNAVAILABLE'))throw Error('Classification unavailable');
 snapshot.classification=classification;trusted.add(snapshot);
 await trace({method:'trusted-snapshot',hash:snapshot.hash,readSqlHash:hash(snapshot.sql),evidenceRows:snapshot.rows.filter((r:any)=>r.kind.startsWith('e:')).length,classification:classification.map(r=>({id:r.definitionId,class:r.classification,reason:r.reason}))});
 return snapshot;
}
// Multiset equality, not EXCEPT-on-IDs. Duplicate cardinality and JSON value types remain observable.
export function equalityExpression(actualSQL:string){return `NOT EXISTS(
 SELECT 1 FROM (
 SELECT kind,payload,COUNT(*) AS n FROM (${actualSQL}) GROUP BY kind,payload
 EXCEPT SELECT json_extract(value,'$.kind'),json_extract(value,'$.payload'),COUNT(*) FROM json_each(?) GROUP BY json_extract(value,'$.kind'),json_extract(value,'$.payload')
 )) AND NOT EXISTS(
 SELECT 1 FROM (
 SELECT json_extract(value,'$.kind') AS kind,json_extract(value,'$.payload') AS payload,COUNT(*) AS n FROM json_each(?) GROUP BY json_extract(value,'$.kind'),json_extract(value,'$.payload')
 EXCEPT SELECT kind,payload,COUNT(*) FROM (${actualSQL}) GROUP BY kind,payload
 ))`;}
export function guard(db:any,snapshot:any,key:string){if(!trusted.has(snapshot))throw Error('Untrusted snapshot rejected');if(hash(snapshot.rows)!==snapshot.hash)throw Error('Snapshot mutated');const json=JSON.stringify(snapshot.rows);return db.prepare(`INSERT INTO p3_s1_guard(request_id,ok) SELECT ?,CASE WHEN ${equalityExpression(snapshot.sql)} THEN 1 ELSE NULL END`).bind(key,json,json);}
export async function compare(db:any,actualSQL:string,rows:any[]){const json=JSON.stringify(rows);return Number((await db.prepare(`SELECT CASE WHEN ${equalityExpression(actualSQL)} THEN 1 ELSE 0 END AS equal`).bind(json,json).first()).equal);}
export function evaluate(snapshot:any,copy:number,actualOverride?:{definition:number;actual:any;date:string},extra?:{id:number;applies:boolean}){
 const c=snapshot.local.copies.find((r:any)=>r.id===copy);if(!c)throw Error('Copy missing');let n=0,m=0,u=0;const dates:string[]=[];
 for(const cls of snapshot.classification){if(cls.evidence.collectionItemId!==c.collection)continue;
  const exclusion=snapshot.local.applicability.find((r:any)=>r.copy===copy&&r.definition===cls.definitionId);
  if(cls.classification==='UNKNOWN'){u++;continue;}if(cls.classification!=='PHYSICAL_COMPONENT'||exclusion?.applies===0)continue;
  n++;const row=snapshot.local.counts.find((r:any)=>r.copy===copy&&r.definition===cls.definitionId);const change=actualOverride?.definition===cls.definitionId?actualOverride:null;
  const actual=change?change.actual:row?.actual;const status=change?'checked':row?.status;
  if(status==='checked'&&Number.isSafeInteger(actual)&&actual>=0){m++;const date=change?.date??snapshot.local.dates.find((r:any)=>r.copy===copy&&r.definition===cls.definitionId)?.date;if(date)dates.push(date);}
 }
 if(extra?.applies)n++;
 const complete=n>0&&m===n&&u===0&&dates.length===n;
 return {n,m,u,status:complete?'complete':'incomplete',date:complete?dates.sort().at(-1):null};
}
