import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import test from 'node:test';
import { sqliteD1 } from './helpers/sqlite-d1.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { handleCollectionCopiesRequest } from '../src/lib/collection-copies-api.ts';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';
import { CollectionV2Writer } from '../src/lib/collection-v2-management.ts';
import { CollectionV2Repository } from '../src/lib/collection-v2-repository.ts';
import { dashboardPreview } from './helpers/admin-dashboard-preview.ts';
import { createLocalGamesPreview } from '../scripts/lib/local-games-preview.ts';
import { getGameDetails } from '../src/lib/games.ts';

test('collection gaps: managed copies, independent wishlist flag and BGG entry',async t=>{
    const sqlite=new DatabaseSync(':memory:');
    const auth=await accessFixture();
    try{
        for(const file of readdirSync('migrations').filter(file=>file.endsWith('.sql')).sort()){
            sqlite.exec(readFileSync('migrations/'+file,'utf8').replace(/^\uFEFF/,''));
        }
        sqlite.exec(`INSERT INTO v2_collection_items(id,display_name,acquisition_status,wishlist,record_scope,notes) VALUES
            (1,'Owned and wishlisted','owned',1,'production','{"personal_comment":"PRIVATE_COMMENT"}'),
            (2,'Preordered wishlist','preordered',1,'production',NULL),
            (3,'Regular owned','owned',0,'production',NULL),
            (4,'Isolated test','owned',1,'test',NULL);
            INSERT INTO v2_owned_copies(id,collection_item_id,copy_label,language_code,edition)
            VALUES(1,1,'Legacy copy','zh-TW','Legacy edition'),(2,3,'Other collection copy',NULL,NULL);
            INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES(1,630,880);
            INSERT INTO v2_sleeve_requirements(collection_item_id,owned_copy_id,size_id,quantity_sheets) VALUES(1,1,1,50);
        `);
        const db=sqliteD1(sqlite);
        const bindings={...auth.bindings,DB:db,NOTBGG_WRITE_LIMITER:{limit:async()=>({success:true})}};
        const token=await auth.token();
        let next=0;
        const body={expectedRevision:0,label:'Second copy',language:'en',edition:'Second edition'};
        const send=(input:object,method='POST',key='copy-request-'+(++next),jwt:string|null=token,path='/api/admin/collection/1/copies')=>
            handleCollectionCopiesRequest(new Request('http://localhost'+path,{method,headers:{
                Origin:'http://localhost','Content-Type':'application/json','X-NotBGG-Request':'1','Idempotency-Key':key,
                ...(jwt?{'Cf-Access-Jwt-Assertion':jwt}:{}),
            },body:JSON.stringify(input)}),bindings);
        let second=0;
        await t.test('authorization, scope isolation, create retry and existing graph preservation',async()=>{
            assert.equal((await send(body,'POST',undefined,null)).status,401);
            assert.equal((await send(body,'POST',undefined,await auth.token({email:'viewer@example.test'}))).status,403);
            assert.equal((await send(body,'POST',undefined,token,'/api/admin/collection/1/copies?scope=test')).status,404);
            assert.equal((await send({...body,collectionId:3})).status,400);
            const created=await send(body,'POST','copy-create-001');assert.equal(created.status,201);
            second=(await created.json() as {data:{copyId:number}}).data.copyId;
            assert.equal((await send(body,'POST','copy-create-001')).status,200);
            assert.equal((await send({...body,label:'Changed'},'POST','copy-create-001')).status,409);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies WHERE collection_item_id=1').get()?.n,2);
            assert.equal(sqlite.prepare('SELECT edition FROM v2_owned_copies WHERE id=1').get()?.edition,'Legacy edition');
            assert.equal(sqlite.prepare('SELECT quantity_sheets FROM v2_sleeve_requirements WHERE owned_copy_id=1').get()?.quantity_sheets,50);
            assert.equal(sqlite.prepare('SELECT managed_copy_id FROM v2_collection_management WHERE collection_item_id=1').get()?.managed_copy_id,null);
        });
        await t.test('copy edit CAS, foreign copy rejection and complete rollback',async()=>{
            const edit={...body,expectedRevision:1,copyId:second,language:'ja',edition:'Japanese edition'};
            assert.equal((await send({...edit,copyId:2},'PATCH')).status,409);
            assert.equal(sqlite.prepare('SELECT revision FROM v2_collection_management WHERE collection_item_id=1').get()?.revision,1);
            assert.equal((await send({...edit,language:12},'PATCH')).status,400);
            sqlite.exec("CREATE TRIGGER copy_failure BEFORE INSERT ON v2_collection_copy_commands BEGIN SELECT RAISE(ABORT,'rollback fixture'); END");
            assert.equal((await send(edit,'PATCH')).status,503);
            assert.equal(sqlite.prepare('SELECT language_code FROM v2_owned_copies WHERE id=?').get(second)?.language_code,'en');
            assert.equal(sqlite.prepare('SELECT revision FROM v2_collection_management WHERE collection_item_id=1').get()?.revision,1);
            sqlite.exec('DROP TRIGGER copy_failure');
            assert.equal((await send(edit,'PATCH')).status,200);
            assert.equal((await send({...edit,edition:'Stale'},'PATCH')).status,409);
            assert.equal(sqlite.prepare('SELECT language_code FROM v2_owned_copies WHERE id=?').get(second)?.language_code,'ja');
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_purchase_orders').get()?.n,0);
            const writer=new CollectionV2Writer(db);
            await assert.rejects(writer.patchFields(1,{displayName:'Stale collection'},{actor:'fixture',scope:'production',revision:1}),/CONFLICT/);
        });
        await t.test('wishlist flag independent of acquisition, scopes, grouping and invalid filters',async()=>{
            const request=async(query:string)=>{
                const result=await handleCollectionAdminRequest(new Request('http://localhost/api/admin/collection?view=records&'+query,
                    {headers:{'Cf-Access-Jwt-Assertion':token}}),bindings);
                return {status:result.status,data:await result.json() as {data:{groups:{items:{id:number;wishlist:number}[]}[]}}};
            };
            assert.deepEqual((await request('wishlist=1')).data.data.groups.flatMap(g=>g.items.map(i=>i.id)),[1,2]);
            assert.deepEqual((await request('wishlist=1&status=owned')).data.data.groups.flatMap(g=>g.items.map(i=>i.id)),[1]);
            assert.deepEqual((await request('wishlist=0')).data.data.groups.flatMap(g=>g.items.map(i=>i.id)),[3]);
            assert.deepEqual((await request('wishlist=1&scope=test')).data.data.groups.flatMap(g=>g.items.map(i=>i.id)),[4]);
            assert.equal((await request('wishlist=maybe')).status,400);
            assert.deepEqual((await request('wishlist=1&after=1')).data.data.groups.flatMap(g=>g.items.map(i=>i.id)),[2]);
        });
        await t.test('real copy UI is bilingual, authorization precedes rendering and public projection remains private',async()=>{
            const render=await dashboardPreview(bindings);
            for(const lang of ['zh-TW','en']){
                const response=await render(new Request('http://localhost/admin/collection/1/copies?lang='+lang,{headers:{'Cf-Access-Jwt-Assertion':token}}));
                assert.equal(response.status,200);
                const html=await response.text();
                assert.match(html,/Japanese edition/);
                assert.ok(html.includes(lang==='en'?'Add a copy':'新增一份副本'));
            }
            assert.equal((await render(new Request('http://localhost/admin/collection/1/copies'))).status,401);
            const publicRows=await new CollectionV2Repository(db).getProductionItems();
            assert.equal(publicRows.length,3);
            const preview=await createLocalGamesPreview({publicDb:db});
            const collection=await preview.html(new URL('http://localhost/collection'));
            assert.ok(!collection?.includes('PRIVATE_COMMENT'));
            const game=getGameDetails()[0];
            for(const prefix of ['','/en']){
                const html=await preview.html(new URL('http://localhost'+prefix+'/games/'+game.slug));
                assert.ok(html?.includes('game=BGG%3A'+game.bggId));
                assert.ok(html?.includes(prefix? 'Add to collection (admin)' : '管理員加入收藏'));
            }
        });
        await t.test('archive blocks further copy writes without deleting copies or sleeve references',async()=>{
            await new CollectionV2Writer(db).update(1,null,{actor:'fixture',scope:'production',expectedRevision:2},true);
            assert.equal((await send({...body,expectedRevision:3})).status,409);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_owned_copies WHERE collection_item_id=1').get()?.n,2);
            assert.equal(sqlite.prepare('SELECT quantity_sheets FROM v2_sleeve_requirements WHERE owned_copy_id=1').get()?.quantity_sheets,50);
            assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
        });
    }finally{auth.restore();sqlite.close();}
});
