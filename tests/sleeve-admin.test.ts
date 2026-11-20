import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { sqliteD1 } from './helpers/sqlite-d1.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { handleSleeveAdminRequest } from '../src/lib/sleeve-admin-api.ts';
import { readSleeveAdmin } from '../src/lib/sleeve-admin.ts';
import { writePhysicalComponent } from '../src/lib/physical-component-management.ts';

test('sleeve admin through real SQLite, signed authentication and existing ledger constraints',async t=>{
    const sqlite=new DatabaseSync(':memory:');
    const auth=await accessFixture();
    try {
        for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort()){
            if(file.startsWith('0018_')){
                sqlite.exec(`INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES(1,630,880);
                    INSERT INTO v2_sleeve_products(id,size_id,brand,product_name,sheets_per_pack) VALUES(1,1,'Legacy brand','Existing product',100);
                    INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets) VALUES(1,'OPENING_BALANCE','2026-01-01',50);
                    INSERT INTO collection_items(id,source_key,display_name) VALUES(1,'test','Fixture');
                    INSERT INTO collection_components(id,collection_item_id,component_name,component_type) VALUES(1,1,'Legacy expansion','expansion');
                    INSERT INTO v2_collection_items(id,display_name) VALUES(1,'Fixture collection'),(2,'Other collection');
                    INSERT INTO v2_component_definitions(id,collection_item_id,component_name,notes)
                    VALUES(1,1,'Legacy expansion','{"migration":"0012","legacy_table":"collection_components","legacy_id":1,"legacy_component_type":"expansion"}'),
                    (2,1,'Unverified',NULL);
                    INSERT INTO v2_legacy_id_map(legacy_table,legacy_id,target_table,target_id)
                    VALUES('collection_components','1','v2_component_definitions',1),('collection_items','1','v2_collection_items',1);
                    INSERT INTO v2_sleeve_requirements(id,collection_item_id,component_definition_id,size_id,quantity_sheets)
                    VALUES(1,1,1,1,45),(2,1,2,1,10),(3,1,NULL,1,20);
                `);
            }
            sqlite.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
        }
        const db=sqliteD1(sqlite);
        const secret=crypto.randomUUID()+crypto.randomUUID();
        const bindings={...auth.bindings,DB:db,PHYSICAL_COMPONENT_SIGNING_KEY:secret,
            NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
        const token=await auth.token();
        let sequence=0;
        const send=(body:unknown,key='sleeve-command-'+(++sequence),jwt:string|null=token,origin='http://localhost')=>
            handleSleeveAdminRequest(new Request('http://localhost/api/admin/sleeves',{
                method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-NotBGG-Request':'1','Idempotency-Key':key,
                    ...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{})},body:JSON.stringify(body),
            }),bindings);
        const product={action:'create',name:'New product',brand:'Fixture brand',width:63,height:88,sheetsPerPack:100,thickness:60,notes:'',active:true};
        let id=0;
        const stock=(kind:string,quantity:number,last:number,revision=1)=>({action:'stock',productId:id,revision,lastTransactionId:last,kind,quantity,date:'2026-11-11',notes:'Explicit fixture operation'});
        const last=()=>Number(sqlite.prepare('SELECT COALESCE(MAX(id),0) n FROM v2_sleeve_inventory_transactions WHERE product_id=?').get(id)?.n);
        const balance=()=>Number(sqlite.prepare('SELECT SUM(quantity_sheets) n FROM v2_sleeve_inventory_transactions WHERE product_id=?').get(id)?.n);

        await t.test('migration preserves existing products and ledger, auth and strict input',async()=>{
            assert.equal(sqlite.prepare('SELECT admin_revision FROM v2_sleeve_products WHERE id=1').get()?.admin_revision,0);
            assert.equal(sqlite.prepare('SELECT SUM(quantity_sheets) n FROM v2_sleeve_inventory_transactions WHERE product_id=1').get()?.n,50);
            assert.equal((await send(product,undefined,null)).status,401);
            assert.equal((await send(product,undefined,await auth.token({email:'viewer@example.test'}))).status,403);
            assert.equal((await send(product,undefined,token,'https://other.example')).status,403);
            assert.equal((await send({...product,classification:'PHYSICAL_COMPONENT'})).status,400);
            assert.equal((await send({...product,sheetsPerPack:0})).status,400);
        });

        await t.test('create, read, edit, CAS, replay and atomic rollback',async()=>{
            const created=await send(product,'sleeve-create-001');assert.equal(created.status,201);
            id=(await created.json() as {data:{id:number}}).data.id;
            assert.equal((await send(product,'sleeve-create-001')).status,200);
            assert.equal((await send({...product,name:'Changed'},'sleeve-create-001')).status,409);
            let list=await readSleeveAdmin(db,new URLSearchParams({product:String(id)}),secret);
            assert.equal(list.rows[0].balance,null);
            assert.equal((await send({...product,action:'edit',productId:id,revision:1,name:'Renamed'})).status,201);
            assert.equal((await send({...product,action:'edit',productId:id,revision:1,width:64})).status,409);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_sizes WHERE width_tenth_mm=640').get()?.n,0);
            sqlite.exec("CREATE TRIGGER synthetic_command_failure BEFORE INSERT ON v2_sleeve_admin_commands BEGIN SELECT RAISE(ABORT,'rollback test'); END");
            assert.equal((await send({...product,name:'Rollback',width:65})).status,503);
            assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM v2_sleeve_products WHERE product_name='Rollback'").get()?.n,0);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_sizes WHERE width_tenth_mm=650').get()?.n,0);
            sqlite.exec('DROP TRIGGER synthetic_command_failure');
            list=await readSleeveAdmin(db,new URLSearchParams({q:'Renamed'}),secret);assert.equal(list.rows.length,1);
        });

        await t.test('stock snapshots, replay, stale state and nonnegative inventory',async()=>{
            assert.equal((await send(stock('USE',1,0,2))).status,409);
            assert.equal((await send(stock('OPENING_BALANCE',10,0,2))).status,201);
            const opening=last();
            assert.equal((await send(stock('OPENING_BALANCE',5,opening,2))).status,409);
            const purchase=stock('PURCHASE',2,opening,2);
            assert.equal((await send(purchase,'sleeve-purchase-001')).status,201);
            assert.equal(balance(),210);
            assert.equal((await send(purchase,'sleeve-purchase-001')).status,200);assert.equal(balance(),210);
            assert.equal((await send(stock('USE',211,last(),2))).status,409);assert.equal(balance(),210);
            const current=last();
            assert.equal((await send(stock('USE',20,current,2))).status,201);assert.equal(balance(),190);
            assert.equal((await send(stock('USE',10,current,2))).status,409);
            assert.equal((await send(stock('RETURN',5,last(),2))).status,201);
            assert.equal((await send(stock('ADJUST',-3,last(),2))).status,201);
            assert.equal((await send(stock('DISCARD',2,last(),2))).status,201);assert.equal(balance(),190);
            assert.equal((await send({...stock('ADJUST',1,last(),2),date:'2026-02-30'})).status,400);
            assert.equal((await send(stock('ADJUST',0,last(),2))).status,400);
            assert.equal((await send({...product,action:'edit',productId:id,revision:2,width:64})).status,409);
            assert.equal((await send({...product,action:'edit',productId:id,revision:2,sheetsPerPack:50})).status,201);
            assert.equal(sqlite.prepare("SELECT sheets_per_pack_snapshot n FROM v2_sleeve_inventory_transactions WHERE product_id=? AND transaction_type='PURCHASE'").get(id)?.n,100);
        });

        await t.test('requirement classification uses trusted evidence without changing assignments',async()=>{
            const physical=await writePhysicalComponent(db,secret,'fixture','physical-card-001',{
                action:'create',collectionId:1,name:'Real cards',type:'card',unit:'card',expected:10,confirmed:true,
            });
            sqlite.prepare('INSERT INTO v2_sleeve_requirements(collection_item_id,component_definition_id,size_id,quantity_sheets) VALUES(1,?,1,10)').run(physical.id);
            const result=await readSleeveAdmin(db,new URLSearchParams({view:'requirements'}),secret);
            assert.deepEqual(result.rows.map(row=>row.classification),['LEGACY_PRODUCT','UNKNOWN',null,'PHYSICAL_COMPONENT']);
            assert.equal(sqlite.prepare('SELECT component_definition_id FROM v2_sleeve_requirements WHERE id=1').get()?.component_definition_id,1);
            assert.equal(sqlite.prepare('SELECT quantity_sheets FROM v2_sleeve_requirements WHERE id=1').get()?.quantity_sheets,45);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_applications').get()?.n,0);
            assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
        });

        await t.test('deactivation retains ledger, blocks stock and supports list pagination',async()=>{
            assert.equal((await send({action:'archive',productId:id,revision:3})).status,201);
            assert.equal((await send(stock('PURCHASE',1,last(),4))).status,409);
            assert.equal(balance(),190);
            assert.equal((await readSleeveAdmin(db,new URLSearchParams({active:'inactive'}),secret)).rows[0].id,id);
            for(let i=0;i<22;i++)sqlite.prepare('INSERT INTO v2_sleeve_products(size_id,product_name,sheets_per_pack) VALUES(1,?,100)').run('Page '+i);
            const first=await readSleeveAdmin(db,new URLSearchParams(),secret);
            assert.equal(first.rows.length,20);assert.ok(first.nextCursor);
            const second=await readSleeveAdmin(db,new URLSearchParams({after:String(first.nextCursor)}),secret);
            assert.ok(second.rows.length);assert.ok(second.rows.every(row=>Number(row.id)>Number(first.nextCursor)));
        });
    }finally{auth.restore();sqlite.close();}
});
