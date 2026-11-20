import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { sqliteD1 } from './sqlite-d1.ts';
import { writePhysicalComponent } from '../../src/lib/physical-component-management.ts';
import { getGames } from '../../src/lib/games.ts';

export async function sleeveWorkflowFixture(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
 const bggId=getGames().find(g=>g.bgg)!.bggId;
 sqlite.prepare('INSERT INTO v2_games(id,bgg_id,primary_name) VALUES(1,?,?)').run(bggId,'Synthetic game');
 sqlite.exec(`INSERT INTO v2_collection_items(id,game_id,display_name,acquisition_status) VALUES(1,1,'Synthetic collection','owned'),(2,NULL,'Other collection','owned');
 INSERT INTO v2_owned_copies(id,collection_item_id,copy_label,seal_status) VALUES(1,1,'PRIVATE_COPY_LABEL','unsealed'),(2,1,'Second','unsealed'),(3,2,'Other','unsealed');
 INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES(1,630,880),(2,450,680);
 INSERT INTO v2_sleeve_products(id,size_id,product_name,brand,sheets_per_pack) VALUES(1,1,'Product A','Brand A',100),(2,1,'Product B','Brand B',50),(3,2,'Wrong size','Brand C',50);
 INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets,notes) VALUES(1,'OPENING_BALANCE','2026-11-11',100,'PRIVATE_LEDGER'),(2,'OPENING_BALANCE','2026-11-11',100,NULL),(3,'OPENING_BALANCE','2026-11-11',100,NULL);
 INSERT INTO collection_items(id,source_key,display_name) VALUES(1,'synthetic-legacy','Legacy');
 INSERT INTO collection_components(id,collection_item_id,component_name,component_type) VALUES(1,1,'Legacy','expansion');
 INSERT INTO v2_component_definitions(id,collection_item_id,component_name,component_type,notes) VALUES(1,1,'Legacy','other','{"migration":"0012","legacy_table":"collection_components","legacy_id":1,"legacy_component_type":"expansion"}'),(2,1,'Unknown','card',NULL);
 INSERT INTO v2_legacy_id_map(legacy_table,legacy_id,target_table,target_id) VALUES('collection_components','1','v2_component_definitions',1),('collection_items','1','v2_collection_items',1);
 INSERT INTO v2_sleeve_requirements(id,collection_item_id,component_definition_id,size_id,quantity_sheets) VALUES(1,1,1,1,30);`);
 const db=sqliteD1(sqlite),secret=crypto.randomUUID()+crypto.randomUUID();
 const card=await writePhysicalComponent(db,secret,'fixture','fixture-card-create',{action:'create',collectionId:1,name:'Real cards',type:'card',unit:'card',expected:30,confirmed:true});
 const token=await writePhysicalComponent(db,secret,'fixture','fixture-token-create',{action:'create',collectionId:1,name:'Tokens',type:'token',unit:'piece',expected:10,confirmed:true});
 for(const copyId of [1,2])await writePhysicalComponent(db,secret,'fixture',null,{action:'count',definitionId:card.id,definitionRevision:1,copyId,revision:0,actual:30});
 return {sqlite,db,secret,cardId:card.id,tokenId:token.id,bggId};
}
