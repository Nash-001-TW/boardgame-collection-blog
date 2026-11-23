import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {classifyComponentDefinitions,type ComponentClassificationSnapshot} from '../src/lib/component-classifier.ts';

// Explicit remote read-only audit. Raw private notes are never returned or persisted.
// Known migration fields unrelated to classification are removed inside D1.
// Unknown note keys fail closed; never export the embedded legacy_notes value.
const sql=`WITH proof_notes AS (
 SELECT id,collection_item_id,
 CASE WHEN json_valid(notes) THEN json_remove(notes,'$.legacy_notes','$.legacy_bgg_id','$.legacy_owned','$.legacy_match_status','$.legacy_quantity_unit') ELSE NULL END notes,
 CASE WHEN notes IS NULL THEN 0 WHEN json_valid(notes)=1 AND json_type(notes)='object'
 AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(notes) THEN notes ELSE '{}' END)
 WHERE key NOT IN('migration','legacy_table','legacy_id','legacy_component_type','legacy_notes','legacy_bgg_id','legacy_owned','legacy_match_status','legacy_quantity_unit')) THEN 0 ELSE 1 END withheld
 FROM v2_component_definitions)
SELECT 'definition' kind,json_object('id',id,'collection_item_id',collection_item_id,'notes',CASE WHEN withheld=0 THEN notes ELSE NULL END,'withheld',withheld) payload FROM proof_notes
UNION ALL SELECT 'legacy_component',json_object('id',id,'collection_item_id',collection_item_id,'component_type',component_type) FROM collection_components
UNION ALL SELECT 'legacy_collection',json_object('id',id) FROM collection_items
UNION ALL SELECT 'collection',json_object('id',id) FROM v2_collection_items
UNION ALL SELECT 'map',json_object('legacy_table',legacy_table,'legacy_id',legacy_id,'target_table',target_table,'target_id',target_id) FROM v2_legacy_id_map
WHERE (legacy_table='collection_components' AND target_table='v2_component_definitions') OR (legacy_table='collection_items' AND target_table='v2_collection_items');`;
const output=execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','boardgame-collection-db','--remote','--command',sql,'--json'],{
 encoding:'utf8',maxBuffer:8_000_000,env:{...process.env,WRANGLER_LOG_PATH:resolve('.wrangler/r01-r07-classification-readonly.log')},stdio:['ignore','pipe','pipe'],
});
const response=JSON.parse(output);
if(response.length!==1||response[0].success!==true||response[0].meta.rows_written!==0)throw new Error('Read-only audit response unavailable');
const rows=response[0].results as {kind:string;payload:string}[];
const snapshot:any={status:'complete',definitions:[],legacyComponents:[],legacyCollections:[],collections:[],legacyMaps:[]};
const keys:Record<string,string>={definition:'definitions',legacy_component:'legacyComponents',legacy_collection:'legacyCollections',collection:'collections',map:'legacyMaps'};
let withheld=0;
for(const row of rows){const payload=JSON.parse(row.payload);if(payload.withheld)withheld++;delete payload.withheld;snapshot[keys[row.kind]].push(payload);}
const counts:Record<string,number>={};
const reasonCounts:Record<string,number>={};
if(rows.length>10_000||withheld)throw new Error('Cannot report exact classification: evidence limit or withheld non-proof notes');
for(const row of classifyComponentDefinitions(snapshot.definitions.map((d:any)=>d.id),snapshot as ComponentClassificationSnapshot)){
 counts[row.classification]=(counts[row.classification]??0)+1;
 reasonCounts[row.reason]=(reasonCounts[row.reason]??0)+1;
}
process.stdout.write(JSON.stringify({evidenceRows:rows.length,withheldPrivateNotes:withheld,classification:counts,reasons:reasonCounts,rowsWritten:response[0].meta.rows_written},null,2)+'\n');
