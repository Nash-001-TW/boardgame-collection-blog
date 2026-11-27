import assert from 'node:assert/strict';
import {test} from 'node:test';
import {collectionRelationPage,readCrossLayerCollections,readCrossLayerRelations} from '../src/lib/cross-layer-relations.ts';
import {readRelationAdmin,writeRelation} from '../src/lib/relation-admin.ts';
import {accessFixture} from './helpers/notbgg-access-fixture.ts';
import {dashboardPreview} from './helpers/admin-dashboard-preview.ts';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {seedXrelB} from './helpers/xrel-b-fixture.ts';

test('XREL-C cross-layer acceptance with disposable SQLite',async t=>{
 const f=await sleeveWorkflowFixture();
 t.after(()=>f.sqlite.close());
 seedXrelB(f.sqlite,true);
 const params=new URLSearchParams({domain:'game',origin:'all',source:'231'});
 async function load() {
  const {identities}=await readRelationAdmin(f.db,new URLSearchParams({domain:'collection'}));
  const data=await readCrossLayerCollections(f.db);
  const cross=await readCrossLayerRelations(f.db,identities.map(row=>({
   id:Number(row.id),bgg_id:Number(row.bgg_id)||null,seq:Number(row.seq)||null,
  })),data);
  return {data,cross};
 }
 const apply=(sql:string)=>f.sqlite.exec(sql);
 await t.test('C01 official combination fixture retains BGG and confirmed manual evidence',async()=>{
  const {data,cross}=await load();
  const page=await collectionRelationPage(data,cross,0,'all',0);
  assert.deepEqual([...page.checks.values()].map(row=>[row.state,row.sources,row.confirmation]),[
   ['linked',['bgg','manual'],'confirmed'],['addable',[],null],['addable',[],null],
  ]);
 });
 await t.test('C02 bundle does not map',async()=>{
  assert.equal((await (await load()).cross.assess(263,262,'bundle_contains')).state,'not_applicable');
 });
 await t.test('C03 missing game blocks mapping',async()=>{
  const row=await (await load()).cross.assess(2,262,'other');
  assert.deepEqual([row.state,row.reason],['blocked','missing_game']);
 });
 await t.test('C04 game direction mismatch blocks mapping',async()=>{
  const row=await (await load()).cross.assess(262,263,'expansion_of');
  assert.deepEqual([row.state,row.reason],['blocked','direction']);
 });
 await t.test('C05 recursive game cycle includes requires_base in the expansion family',async()=>{
  apply(`UPDATE v2_game_relations SET archived_at=CURRENT_TIMESTAMP WHERE id=1;
   INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type) VALUES(231,229,'requires_base'),(229,228,'requires_base')`);
  try {
   const row=await (await load()).cross.assess(263,262,'requires_base');
   assert.deepEqual([row.state,row.reason],['blocked','cycle']);
  } finally {apply("DELETE FROM v2_game_relations WHERE relation_type='requires_base'; UPDATE v2_game_relations SET archived_at=NULL WHERE id=1");}
 });
 await t.test('C06 missing and malformed endpoint cache only affect that combination',async()=>{
  const cached=String(f.sqlite.prepare('SELECT cache_json FROM bgg_games WHERE bgg_id=466375').get()?.cache_json);
  const update=f.sqlite.prepare('UPDATE bgg_games SET cache_json=? WHERE bgg_id=466375');
  try {
   for (const value of [null,'{']) {
    update.run(value);
    const {cross}=await load();
    const row=await cross.assess(264,262,'accessory_for');
    assert.deepEqual([row.state,row.reason],['unavailable','cache_unavailable']);
    assert.equal((await cross.assess(265,262,'accessory_for')).state,'addable');
   }
  } finally {update.run(cached);}
 });
 await t.test('C07 filter applies to the full list before paging, leaving global counts intact',async()=>{
  const {data,cross}=await load();
  const page=await collectionRelationPage(data,cross,0,'addable',0);
  assert.deepEqual(page.rows.map(row=>row.source_item_id),[264,265]);
  assert.deepEqual(page.counts,{all:3,linked:1,addable:2,blocked:0});
 });
 await t.test('C08 #263 receives the BGG suggestion before a combination exists',async()=>{
  apply("UPDATE v2_collection_relations SET archived_at=CURRENT_TIMESTAMP WHERE source_item_id=263");
  try {
   assert.deepEqual((await load()).cross.suggestions()?.[263]?.map(({target,type})=>[target,type]),[[262,'expansion_of']]);
  } finally {apply("UPDATE v2_collection_relations SET archived_at=NULL WHERE source_item_id=263");}
 });
 await t.test('C09 multiple targets are offered within the source scope',async()=>{
  apply(`UPDATE v2_collection_relations SET archived_at=CURRENT_TIMESTAMP WHERE source_item_id=263;
   INSERT INTO v2_collection_items(id,game_id,display_name,record_scope) VALUES
   (266,231,'Second edition','production'),(267,231,'Test edition','test')`);
  try {
   const {cross}=await load();
   assert.deepEqual(cross.suggestions()?.[263]?.map(row=>row.target).sort(),[262,266]);
   const reverse=await cross.reverse({source_game_id:228,target_game_id:231,relation_type:'expansion_of'});
   assert.deepEqual(reverse?.pairs.map(row=>row.to.id).sort(),[262,266]);
  } finally {
   apply("DELETE FROM v2_collection_items WHERE id IN(266,267); UPDATE v2_collection_relations SET archived_at=NULL WHERE source_item_id=263");
  }
 });
 await t.test('C10 existing combination is not suggested again',async()=>{
  assert.equal((await load()).cross.suggestions()?.[263],undefined);
 });
 await t.test('C11 existing combination is available from the merged expansion row',async()=>{
  const list=await readRelationAdmin(f.db,params);
  const result=await (await load()).cross.reverse(list.rows.find(row=>row.id===1)!);
  assert.deepEqual(result?.pairs.map(row=>[row.from.id,row.to.id,row.existing]),[[263,262,true]]);
 });
 await t.test('C12 missing collection endpoint returns a reason and no pairing',async()=>{
  const result=await (await load()).cross.reverse({source_game_id:228,target_game_id:999,relation_type:'expansion_of'});
  assert.deepEqual(result,{missing:'target',pairs:[]});
 });
 await t.test('C13 reverse link renders a prefilled collection form and does not write',async()=>{
  const auth=await accessFixture();
  try {
   apply("UPDATE v2_collection_relations SET archived_at=CURRENT_TIMESTAMP WHERE source_item_id=263");
   const preview=await dashboardPreview({...auth.bindings,DB:f.db,PHYSICAL_COMPONENT_SIGNING_KEY:f.secret});
   const path='http://localhost/admin/bgg?view=relations&domain=';
   const headers={'Cf-Access-Jwt-Assertion':await auth.token()};
   const listing=await preview(new Request(path+'collection&source=262&gameState=addable',{headers}));
   assert.equal(listing.status,200);
   assert.deepEqual((await listing.text()).match(/data-cross-state="[^"]+"/g),['data-cross-state="addable"','data-cross-state="addable"']);
   const game=await preview(new Request(path+'game&origin=all&source=231',{headers}));
   const link=(await game.text()).match(/href="([^"]*relationTarget=262[^"]*)"/)?.[1]?.replaceAll('&amp;','&');
   assert.ok(link);
   const before=f.sqlite.prepare('SELECT * FROM v2_collection_relations ORDER BY id').all();
   const page=await preview(new Request(new URL(link,path),{headers}));
   assert.equal(page.status,200);
   const html=await page.text();
   assert.match(html,/data-relation-prefill="expansion_of"/);
   assert.match(html,/<option value="263"[^>]* selected[^>]*>/);
   assert.match(html,/<option value="262"[^>]* selected[^>]*>/);
   assert.deepEqual(f.sqlite.prepare('SELECT * FROM v2_collection_relations ORDER BY id').all(),before);
  } finally {
   auth.restore();
   apply("UPDATE v2_collection_relations SET archived_at=NULL WHERE source_item_id=263");
  }
 });
 await t.test('C14 writeRelation retains the direction rejection and error code',async()=>{
  await assert.rejects(writeRelation(f.db,'fixture','invalid-direction',{
   action:'save',domain:'game',id:0,revision:0,sourceId:231,targetId:228,type:'expansion_of',confirmed:false,notes:'',
  }),{status:400,code:'RELATION_DIRECTION_UNVERIFIED'});
 });
 await t.test('Q210 suggestions stop at the inclusive 1000-entry boundary',async()=>{
  const insert=f.sqlite.prepare("INSERT INTO v2_collection_items(id,game_id,display_name) VALUES(?,231,'Extra edition')");
  try {
   for(let i=1000;i<2000;i++)insert.run(i);
   assert.equal((await load()).cross.suggestions()?.[263]?.length,1000);
   insert.run(2000);
   assert.equal((await load()).cross.suggestions(),null);
  } finally {apply('DELETE FROM v2_collection_items WHERE id>=1000');}
 });
});
