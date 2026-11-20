import { DatabaseSync } from 'node:sqlite';
import { sqliteD1 } from './sqlite-d1.ts';
import { getGames } from '../../src/lib/games.ts';
import { physicalSigningKey,physicalSourceMessage,signPhysicalValue } from '../../src/lib/physical-component-proof.ts';

/** Disposable synthetic schema only. Never executes migrations or discovers existing databases. */
export async function publicCollectionFixture(){
    const sqlite=new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE bgg_games(bgg_id INTEGER PRIMARY KEY,name TEXT,cache_json TEXT,last_success_at TEXT);
        CREATE TABLE v2_sleeve_applications(id INTEGER PRIMARY KEY,requirement_id INTEGER,owned_copy_id INTEGER,copy_component_id INTEGER,inventory_transaction_id INTEGER,quantity_sheets INTEGER);
        CREATE TABLE v2_copy_components(id INTEGER PRIMARY KEY,owned_copy_id INTEGER,component_definition_id INTEGER);
        CREATE TABLE v2_sleeve_inventory_transactions(id INTEGER PRIMARY KEY,product_id INTEGER,transaction_type TEXT,quantity_sheets INTEGER,owned_copy_id INTEGER,collection_item_id INTEGER);
        CREATE TABLE v2_games(id INTEGER PRIMARY KEY,bgg_id INTEGER,primary_name TEXT);
        CREATE TABLE notbgg_games(seq INTEGER PRIMARY KEY,game_id INTEGER,name TEXT,thumbnail_url TEXT,image_url TEXT,archived_at TEXT);
        CREATE TABLE notbgg_bgg_links(seq INTEGER,candidate_bgg_id INTEGER,primary_source TEXT,status TEXT);
        CREATE TABLE v2_collection_items(id INTEGER PRIMARY KEY,game_id INTEGER,display_name TEXT,acquisition_status TEXT,wishlist INTEGER,record_scope TEXT,notes TEXT);
        CREATE TABLE v2_collection_management(collection_item_id INTEGER PRIMARY KEY,archived_at TEXT);
        CREATE TABLE v2_owned_copies(id INTEGER PRIMARY KEY,collection_item_id INTEGER,language_code TEXT,edition TEXT,inventory_status TEXT,copy_label TEXT,notes TEXT);
        CREATE TABLE v2_sleeve_sizes(id INTEGER PRIMARY KEY,width_tenth_mm INTEGER,height_tenth_mm INTEGER);
        CREATE TABLE v2_sleeve_requirements(id INTEGER PRIMARY KEY,collection_item_id INTEGER,owned_copy_id INTEGER,component_definition_id INTEGER,size_id INTEGER,quantity_sheets INTEGER,notes TEXT);
        CREATE TABLE v2_sleeve_products(id INTEGER PRIMARY KEY,size_id INTEGER,brand TEXT,product_name TEXT,sheets_per_pack INTEGER,thickness_microns INTEGER,is_active INTEGER,notes TEXT,default_pack_price_minor INTEGER);
        CREATE TABLE v2_component_definitions(id INTEGER PRIMARY KEY,collection_item_id INTEGER,notes TEXT,physical_creation_token TEXT,component_name TEXT,component_type TEXT,quantity_unit TEXT);
        CREATE TABLE v2_physical_component_sources(definition_id INTEGER PRIMARY KEY,creation_token TEXT,collection_item_id INTEGER,record_scope TEXT,actor TEXT,request_digest TEXT,signature TEXT);
        CREATE TABLE collection_items(id INTEGER PRIMARY KEY);
        CREATE TABLE collection_components(id INTEGER PRIMARY KEY,collection_item_id INTEGER,component_type TEXT);
        CREATE TABLE v2_legacy_id_map(legacy_table TEXT,legacy_id TEXT,target_table TEXT,target_id INTEGER);
    `);
    const known=getGames().filter(game=>game.bgg);
    const bggId=known[0].bggId,otherId=known[1].bggId,emptyId=known[2].bggId;
    sqlite.prepare('INSERT INTO v2_games VALUES(1,?,?), (2,NULL,?), (3,?,?), (4,NULL,?)')
        .run(bggId,'BGG fixture','NotBGG fixture',otherId,'Other','Archived');
    sqlite.exec(`
        INSERT INTO notbgg_games VALUES(1,2,'Custom fixture',NULL,NULL,NULL),(2,4,'Archived custom',NULL,NULL,'2026-01-01');
        INSERT INTO v2_collection_items VALUES
            (1,1,'Public collection','owned',1,'production','{"owned":"true","personal_rating":9.5,"personal_comment":"PRIVATE_COMMENT","purchase_source_hint":"PRIVATE_SHOP","d5_create_token":"PRIVATE_CREATE_TOKEN"}'),
            (2,2,'Preordered copy','preordered',1,'production',NULL),
            (3,1,'PRIVATE_TEST_COLLECTION','owned',0,'test',NULL),
            (4,1,'PRIVATE_ARCHIVED_COLLECTION','owned',0,'production',NULL),
            (5,3,'PRIVATE_OTHER_COLLECTION','owned',0,'production',NULL);
        INSERT INTO v2_collection_management VALUES(4,'2026-01-01');
        INSERT INTO v2_owned_copies VALUES
            (1,1,'zh-TW','First edition','in_collection','PRIVATE_COPY_LABEL','PRIVATE_COPY_NOTE'),
            (2,1,'en','Second edition','sold','PRIVATE_SOLD_COPY','PRIVATE_SOLD_NOTE'),
            (3,1,NULL,NULL,'in_collection','PRIVATE_UNLABELLED','PRIVATE_UNLABELLED_NOTE'),
            (4,2,'ja',NULL,'in_collection','PRIVATE_OTHER_COPY','PRIVATE_OTHER_COPY_NOTE');
        INSERT INTO v2_sleeve_sizes VALUES(1,630,880),(2,450,680),(3,700,1000);
        INSERT INTO v2_component_definitions VALUES
            (10,1,NULL,NULL,'Confirmed cards','card','card'),
            (11,1,'{"migration":"0012","legacy_table":"collection_components","legacy_id":5,"legacy_component_type":"expansion"}',NULL,'PRIVATE_LEGACY_NAME','other','other'),
            (12,1,NULL,NULL,'PRIVATE_UNKNOWN_NAME','card','card'),
            (13,1,NULL,NULL,'PRIVATE_TOKEN_NAME','token','piece');
        INSERT INTO collection_items VALUES(11);
        INSERT INTO collection_components VALUES(5,11,'expansion');
        INSERT INTO v2_legacy_id_map VALUES('collection_components','5','v2_component_definitions',11),('collection_items','11','v2_collection_items',1);
        INSERT INTO v2_sleeve_requirements VALUES
            (1,1,1,10,1,50,'PRIVATE_REQUIREMENT_NOTE'),
            (2,1,NULL,NULL,1,10,'PRIVATE_UNASSIGNED_NOTE'),
            (3,1,NULL,11,2,5,'PRIVATE_LEGACY_NOTE'),
            (4,1,NULL,12,1,6,'PRIVATE_UNKNOWN_NOTE'),
            (5,1,NULL,13,1,3,'PRIVATE_TOKEN_NOTE'),
            (6,3,NULL,NULL,1,999,'PRIVATE_TEST_REQUIREMENT'),
            (7,4,NULL,NULL,1,888,'PRIVATE_ARCHIVED_REQUIREMENT'),
            (8,5,NULL,NULL,1,777,'PRIVATE_OTHER_REQUIREMENT'),
            (9,2,NULL,NULL,1,4,'PRIVATE_LINKED_REQUIREMENT');
        INSERT INTO v2_sleeve_products VALUES
            (1,1,'Public brand','Public product',100,60,1,'PRIVATE_PRODUCT_NOTE',123456),
            (2,1,'PRIVATE_INACTIVE_BRAND','PRIVATE_INACTIVE_PRODUCT',50,NULL,0,'PRIVATE_PRODUCT_NOTE',234567),
            (3,3,'PRIVATE_UNRELATED_BRAND','PRIVATE_UNRELATED_PRODUCT',50,NULL,1,'PRIVATE_OTHER_PRODUCT_NOTE',345678),
            (4,2,NULL,'Small product',50,NULL,1,'PRIVATE_SMALL_PRODUCT_NOTE',456789);
    `);
    const secret=crypto.randomUUID()+crypto.randomUUID();
    const signing=await physicalSigningKey(secret);
    if(!signing)throw new Error('Fixture key unavailable');
    const privateValues=[secret];
    for(const definition of [10,13]){
        const token=await signPhysicalValue(signing,'fixture-token-'+definition);
        const digest=await signPhysicalValue(signing,'fixture-digest-'+definition);
        const signature=await signPhysicalValue(signing,physicalSourceMessage(token,1,'production','PRIVATE_ACTOR',digest));
        sqlite.prepare('UPDATE v2_component_definitions SET physical_creation_token=? WHERE id=?').run(token,definition);
        sqlite.prepare("INSERT INTO v2_physical_component_sources VALUES(?,?,1,'production','PRIVATE_ACTOR',?,?)").run(definition,token,digest,signature);
        privateValues.push(token,digest,signature);
    }
    return {sqlite,db:sqliteD1(sqlite),secret,bggId,otherId,emptyId,privateValues,game:known[0]};
}
