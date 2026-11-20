import assert from 'node:assert/strict';
import test from 'node:test';
import { publicCollectionFixture } from './helpers/public-collection-fixture.ts';
import { readPublicGameCollection,handlePublicGameCollection } from '../src/lib/public-game-collection.ts';
import { collectionOwned } from '../src/lib/collection-ownership.ts';

test('public detail collection and sleeve projection from isolated synthetic SQLite',async t=>{
    const f=await publicCollectionFixture();
    const key='BGG:'+f.bggId;
    try{
        await t.test('managed requirements, active size references, copies and privacy whitelist',async()=>{
            const result=await readPublicGameCollection(f.db,key,f.secret);
            assert.equal(result.collections.length,1);
            assert.deepEqual(result.collections[0],{
                id:1,name:'Public collection',status:'owned',owned:true,wishlist:true,preordered:false,copyCount:3,inCollectionCopyCount:2,
                versions:[{language:null,edition:null,count:1},{language:'en',edition:'Second edition',count:1},{language:'zh-TW',edition:'First edition',count:1}],
            });
            assert.deepEqual(result.requirements.map(row=>row.component.status),['physical_card','unassigned','legacy_product','pending','pending']);
            assert.equal(result.requirements[0].component.name,'Confirmed cards');
            assert.equal(result.requirements[0].scope,'copy');
            assert.equal(result.requirements[1].scope,'collection');
            assert.equal(result.requirements[0].quantity,50);
            assert.deepEqual(result.requirements[0].products,[{name:'Public product',brand:'Public brand',sheetsPerPack:100,thicknessMicrons:60}]);
            assert.deepEqual(result.requirements[0].size,{id:1,widthMm:63,heightMm:88});
            assert.equal(result.ratingVisibility,'not_public');
            const json=JSON.stringify(result);
            assert.doesNotMatch(json,/PRIVATE_|signature|request_digest|personal_rating|9\.5|123456|234567|price|balance|actor/i);
            for(const secret of f.privateValues)assert.ok(!json.includes(secret));
        });
        await t.test('empty records and query failures have different public responses',async()=>{
            const empty=await readPublicGameCollection(f.db,'BGG:'+f.emptyId,f.secret);
            assert.deepEqual(empty.collections,[]);assert.deepEqual(empty.requirements,[]);
            const failing={prepare(sql:string){
                if(sql.includes('FROM v2_sleeve_products'))return {bind(){return this;},all:async()=>({success:false,results:[]})};
                return f.db.prepare(sql);
            }} as unknown as D1Database;
            const response=await handlePublicGameCollection(new Request('http://localhost/api/public/collection/'+key),{DB:failing},key);
            assert.equal(response.status,503);
            assert.equal(response.headers.get('Cache-Control'),'no-store');
            assert.equal((await response.json() as {success:boolean}).success,false);
            assert.equal((await handlePublicGameCollection(new Request('http://localhost/'),{},key)).status,503);
            assert.equal((await handlePublicGameCollection(new Request('http://localhost/',{method:'POST'}),{DB:f.db},key)).status,405);
            assert.equal((await handlePublicGameCollection(new Request('http://localhost/'),{DB:f.db},'BGG:01')).status,400);
        });
        await t.test('unavailable, truncated or invalid proof never confirms a card',async()=>{
            const unavailable={prepare(sql:string){
                if(sql.includes('WITH evidence'))return {all:async()=>({success:false,results:[]})};
                return f.db.prepare(sql);
            }} as unknown as D1Database;
            const result=await readPublicGameCollection(unavailable,key,f.secret);
            assert.equal(result.requirements.length,5);
            assert.equal(result.requirements[0].component.status,'unavailable');
            assert.equal(result.componentVerificationUnavailable,true);
            const invalid=await readPublicGameCollection(f.db,key,'invalid signing key with at least thirty two bytes');
            assert.equal(invalid.requirements[0].component.status,'pending');
            const truncated={prepare(sql:string){
                if(sql.includes('WITH evidence'))return {all:async()=>{
                    const original=await f.db.prepare(sql).all<Record<string,unknown>>();
                    return {...original,results:original.results.map(row=>({...row,total_rows:10001}))};
                }};
                return f.db.prepare(sql);
            }} as unknown as D1Database;
            assert.equal((await readPublicGameCollection(truncated,key,f.secret)).requirements[0].component.status,'unavailable');
        });
        await t.test('cross-collection evidence remains pending and only confirmed aliases combine records',async()=>{
            f.sqlite.exec('UPDATE v2_sleeve_requirements SET owned_copy_id=4 WHERE id=1');
            assert.equal((await readPublicGameCollection(f.db,key,f.secret)).requirements[0].component.status,'pending');
            f.sqlite.exec('UPDATE v2_sleeve_requirements SET owned_copy_id=1 WHERE id=1');
            const separate=await readPublicGameCollection(f.db,'NotBGG:000001',f.secret);
            assert.deepEqual(separate.collections.map(row=>row.id),[2]);
            assert.equal(separate.collections[0].preordered,true);
            f.sqlite.prepare("INSERT INTO notbgg_bgg_links VALUES(1,?,'bgg','pending')").run(f.bggId);
            assert.deepEqual((await readPublicGameCollection(f.db,key,f.secret)).collections.map(row=>row.id),[1]);
            f.sqlite.exec("UPDATE notbgg_bgg_links SET status='linked'");
            for(const identity of [key,'NotBGG:000001']){
                const joined=await readPublicGameCollection(f.db,identity,f.secret);
                assert.deepEqual(joined.collections.map(row=>row.id),[1,2]);
                assert.equal(joined.requirements.length,6);
            }
            const archived=await handlePublicGameCollection(new Request('http://localhost/'),{DB:f.db},'NotBGG:000002');
            assert.equal(archived.status,404);
        });
        await t.test('bounded bulk reads and legacy ownership values preserve existing semantics',async()=>{
            const calls:string[]=[];
            const measured={prepare(sql:string){calls.push(sql);return f.db.prepare(sql);}} as D1Database;
            await readPublicGameCollection(measured,key,f.secret);
            assert.ok(calls.length<=7,'BGG details use a bounded set of bulk queries');
            assert.equal(calls.filter(sql=>sql.includes('WITH evidence')).length,1);
            for(const [value,expected]of [[true,true],[false,false],[1,true],[0,false],['1',true],['0',false],['true',true],['false',false]]){
                assert.equal(collectionOwned('unknown',value),expected);
            }
            assert.equal(collectionOwned('owned',null),true);
            assert.equal(collectionOwned('preordered',null),false);
            f.sqlite.exec("WITH RECURSIVE ids(n) AS (VALUES(100) UNION ALL SELECT n+1 FROM ids WHERE n<600) INSERT INTO v2_sleeve_requirements(id,collection_item_id,size_id,quantity_sheets) SELECT n,1,1,1 FROM ids");
            const expanded=await readPublicGameCollection(f.db,key,f.secret);
            assert.equal(expanded.requirements.length,507);
        });
    }finally{f.sqlite.close();}
});
