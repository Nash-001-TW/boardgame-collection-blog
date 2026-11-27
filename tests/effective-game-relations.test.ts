import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {sleeveWorkflowFixture} from './helpers/sleeve-workflow-fixture.ts';
import {seedXrelB,expansionName,compilationName} from './helpers/xrel-b-fixture.ts';
import {handlePublicLiveRelations,readPublicLiveRelations} from '../src/lib/public-live-relations.ts';
import {readManualGameRelationPage,readRelationAdmin,writeRelation} from '../src/lib/relation-admin.ts';
import {NotBggRepository} from '../src/lib/notbgg-repository.ts';

async function fixture(t: TestContext) {
 const f=await sleeveWorkflowFixture();
 t.after(()=>f.sqlite.close());
 seedXrelB(f.sqlite);
 return {...f, publicRows:async ()=>(await readPublicLiveRelations(f.db,'BGG:404893','en')).relations,
  admin:(query='')=>readRelationAdmin(f.db,new URLSearchParams(query))};
}

test('B01: equivalent confirmed expansion merges and the compilation stays unconfirmed',async t=>{
 const f=await fixture(t);
 const rows=await f.publicRows();
 assert.equal(rows.length,2);
 assert.deepEqual(rows.find(r=>r.name===expansionName),{
  name:expansionName,href:'/en/games/bgg/408254',source:'bgg',sources:['bgg','manual'],
  kind:'expansion_of',role:'expansion',owned:true,image:'https://example.test/thumb.png',
 });
 assert.deepEqual(rows.filter(r=>r.name===compilationName).map(r=>[r.kind,r.role,r.sources]),[
  ['compilations','unconfirmed',['bgg']],
 ]);
});

for(const [id,change,expected] of [
 ['B02',"archived_at=CURRENT_TIMESTAMP",[['expansions','bgg']]],
 ['B03',"relation_type='requires_base'",[['expansions','bgg'],['requires_base','manual']]],
 ['B04',"admin_confirmed=0",[['expansions','bgg']]],
] as const)test(id+': public source eligibility '+change,async t=>{
 const f=await fixture(t);
 f.sqlite.exec('UPDATE v2_game_relations SET '+change+' WHERE id=1');
 assert.deepEqual((await f.publicRows()).filter(r=>r.name===expansionName).map(r=>[r.kind,r.source]),expected);
});

test('B05: unresolved direction and reverse manual endpoints do not merge',async t=>{
 const f=await fixture(t);
 f.sqlite.exec('UPDATE v2_game_relations SET source_game_id=231,target_game_id=228 WHERE id=1');
 assert.deepEqual((await f.publicRows()).filter(r=>r.name===expansionName).map(r=>[r.kind,r.role]),[
  ['expansions','expansion'],['expansion_of','base'],
 ]);
 f.sqlite.exec('UPDATE v2_game_relations SET source_game_id=228,target_game_id=231 WHERE id=1');
 f.sqlite.exec("UPDATE bgg_games SET cache_json=json_remove(cache_json,'$.expansions') WHERE bgg_id=408254");
 assert.deepEqual((await f.publicRows()).filter(r=>r.name===expansionName).map(r=>[r.kind,r.role]),[
  ['expansions','unconfirmed'],['expansion_of','expansion'],
 ]);
});

test('B06: both NotBGG aliases resolve and the site pair merges with its manual equivalent',async t=>{
 const f=await fixture(t);
 const repository=new NotBggRepository(f.db);
 const profiles=[];
 for(const [name,type,key] of [['Alias base','boardgame','base'],['Alias expansion','boardgameexpansion','expansion'],['Player mat','boardgameaccessory','accessory']] as const){
  profiles.push((await repository.create({name,type},{actor:'fixture',idempotencyKey:'xrel-link-'+key})).game);
 }
 const [base,expansion,accessory]=profiles;
 const link=f.sqlite.prepare(`INSERT INTO notbgg_bgg_links(seq,candidate_bgg_id,bgg_game_id,status,primary_source,created_by,confirmed_by,linked_at)
  VALUES(?,?,?,'linked','notbgg','fixture','fixture',CURRENT_TIMESTAMP)`);
 link.run(Number(base.notBggId.slice(7)),404893,231);
 link.run(Number(expansion.notBggId.slice(7)),408254,228);
 f.sqlite.prepare('UPDATE v2_game_relations SET source_game_id=?,target_game_id=? WHERE id=1').run(expansion.gameId,base.gameId);
 const bgg=(await f.publicRows()).find(r=>r.kind==='expansion_of');
 assert.deepEqual(bgg?.sources,['bgg','manual']);
 assert.equal(bgg?.href,'/en/games/notbgg/'+expansion.notBggId.slice(7));
 f.sqlite.prepare("INSERT INTO site_game_relations(source_game_id,target_game_id,relation_type,created_by) VALUES(?,?,'accessory_for','fixture')").run(accessory.gameId,base.gameId);
 f.sqlite.prepare("INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,admin_confirmed) VALUES(?,231,'accessory_for',1)").run(accessory.gameId);
 assert.equal((await f.publicRows()).filter(r=>r.kind==='accessory_for').length,1);
 assert.deepEqual((await f.admin('origin=all')).rows.find(r=>r.relation_type==='accessory_for')?.sources,['manual','notbgg']);
 f.sqlite.exec("UPDATE v2_game_relations SET source_game_id=target_game_id,target_game_id=source_game_id WHERE relation_type='accessory_for'");
 assert.equal((await f.publicRows()).filter(r=>r.kind==='accessory_for').length,2);
});

test('B07: the existing symmetric duplicate rule applies to same_series only within its type',async t=>{
 const f=await fixture(t);
 const pair={action:'save',domain:'game',id:0,revision:0,sourceId:228,targetId:231,type:'same_series',confirmed:true,notes:''};
 await writeRelation(f.db,'fixture','xrel-symmetric-first',pair);
 const reverse={...pair,sourceId:231,targetId:228};
 await assert.rejects(writeRelation(f.db,'fixture','xrel-symmetric-second',reverse),{status:409});
 await writeRelation(f.db,'fixture','xrel-different-type',{...reverse,type:'other'});
 assert.equal((await f.publicRows()).filter(r=>r.kind==='same_series').length,1);
 assert.equal((await f.publicRows()).filter(r=>r.kind==='other').length,1);
});

test('B08: omitted and manual origins preserve the exact legacy result',async t=>{
 const f=await fixture(t);
 const implicit=await f.admin(),explicit=await f.admin('origin=manual');
 assert.deepEqual(implicit,explicit);
 assert.deepEqual(explicit.rows.map(r=>({...r})),f.sqlite.prepare('SELECT * FROM v2_game_relations ORDER BY id').all().map(r=>({...r})));
 assert.deepEqual(await f.admin('domain=collection&origin=bgg'),await f.admin('domain=collection'));
});

test('B09: BGG-only rows are local, sorted, read-only and offset-paginated',async t=>{
 const f=await fixture(t);
 const items=Array.from({length:20},(_,i)=>({id:500001+i,name:'Extra '+i}));
 f.sqlite.prepare("UPDATE bgg_games SET cache_json=json_set(cache_json,'$.implementations',json(?)) WHERE bgg_id=404893").run(JSON.stringify(items));
 const cache=f.sqlite.prepare("INSERT INTO bgg_games(bgg_id,name,cache_json,last_success_at) VALUES(500000,'Remote',?,CURRENT_TIMESTAMP)");
 cache.run(JSON.stringify({bggId:500000,name:'Remote',implementations:[{id:600001,name:'Remote peer'}]}));
 const first=await f.admin('origin=bgg'),second=await f.admin('origin=bgg&after=20');
 assert.equal(first.nextCursor,20);
 assert.equal(second.nextCursor,null);
 assert.equal(first.rows.length+second.rows.length,22);
 assert.deepEqual(first.rows.slice(0,3).map(r=>[r.source_game_id,r.target_bgg_id,r.relation_type]),[
  [228,404893,'expansions'],[231,408253,'compilations'],[231,500001,'implementations'],
 ]);
 for(const row of [...first.rows,...second.rows]){
  assert.deepEqual(row.sources,['bgg']);
  for(const key of ['id','revision','admin_revision'])assert.ok(!Object.hasOwn(row,key));
 }
 assert.deepEqual((await f.admin('origin=bgg&source=228')).rows.map(r=>r.relation_type),['expansions']);
 f.sqlite.exec(`UPDATE bgg_games SET cache_json=json_set(cache_json,'$.compilations',
  json('[{"id":404893,"name":"Tiny Epic Cthulhu"}]')) WHERE bgg_id=500000`);
 const external=(await f.admin('origin=bgg')).rows[0];
 assert.deepEqual([external.source_game_id,external.source_bgg_id,external.target_bgg_id],[undefined,500000,404893]);
 const oversized=Array.from({length:1000},(_,i)=>({id:500001+i,name:'Extra '+i}));
 f.sqlite.prepare("UPDATE bgg_games SET cache_json=json_set(cache_json,'$.implementations',json(?)) WHERE bgg_id=404893").run(JSON.stringify(oversized));
 await assert.rejects(f.admin('origin=bgg'),{status:503,code:'RELATION_SCOPE_TOO_BROAD'});
 assert.equal((await f.admin('origin=bgg&source=228')).rows.length,1);
});

test('B10: all retains the manual ID and revision, without mutating either source',async t=>{
 const f=await fixture(t);
 const before=await f.admin();
 const all=await f.admin('origin=all');
 assert.equal(all.rows.length,2);
 assert.deepEqual(all.rows.find(r=>r.id===1),{...before.rows[0],sources:['bgg','manual']});
 assert.deepEqual(await f.admin(),before);
});

test('B11: failed SQL reads surface a service error in public and admin',async t=>{
 const f=await fixture(t);
 const db={prepare:(sql:string)=>{
  if(sql.includes('FROM site_game_relations'))throw new Error('fixture read failure');
  return f.db.prepare(sql);
 }} as D1Database;
 const request=new Request('http://localhost/api/public/relations/BGG:404893');
 const response=await handlePublicLiveRelations(request,db,'BGG:404893');
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{success:false,error:{code:'RELATIONS_UNAVAILABLE'}});
 await assert.rejects(readRelationAdmin(db,new URLSearchParams('origin=all')),/fixture read failure/);
});


test('B-UI: BGG and NotBGG use public thumbnail precedence and sanitize cover URLs',async t=>{
 const f=await fixture(t);
 const repository=new NotBggRepository(f.db);
 const profile=(await repository.create({name:'Cover accessory',type:'boardgameaccessory',
  imageUrl:'https://example.test/custom.png',thumbnailUrl:'https://example.test/custom-thumb.png'
 },{actor:'fixture',idempotencyKey:'xrel-image'})).game;
 f.sqlite.prepare("INSERT INTO site_game_relations(source_game_id,target_game_id,relation_type,created_by) VALUES(?,231,'accessory_for','fixture')").run(profile.gameId);
 let rows=await f.publicRows();
 assert.equal(rows.find(r=>r.name===compilationName)?.image,null);
 assert.equal(rows.find(r=>r.kind==='accessory_for')?.image,'https://example.test/custom-thumb.png');
 await repository.update(profile.notBggId,{thumbnailUrl:null},{actor:'fixture',expectedRevision:profile.revision});
 f.sqlite.exec("UPDATE bgg_games SET cache_json=json_set(cache_json,'$.thumbnail','javascript:invalid') WHERE bgg_id=408254");
 rows=await f.publicRows();
 assert.equal(rows.find(r=>r.kind==='accessory_for')?.image,'https://example.test/custom.png');
 assert.equal(rows.find(r=>r.name===expansionName)?.image,null);
});

test('B-UI: totals are offset-only and manual page numbers support sparse IDs',async t=>{
 const f=await fixture(t);
 const insert=f.sqlite.prepare("INSERT INTO v2_game_relations(id,source_game_id,target_game_id,relation_type,archived_at) VALUES(?,?,231,'other',CURRENT_TIMESTAMP)");
 const game=f.sqlite.prepare("INSERT INTO v2_games(id,primary_name,game_type) VALUES(?,?,'base')");
 for(let i=1;i<=41;i++){
  game.run(1000+i,'Page fixture '+i);
  insert.run(i*3,1000+i);
 }
 const first=await f.admin('origin=manual&source=231');
 assert.ok(!Object.hasOwn(first,'total'));
 const second=await f.admin('source=231&after='+first.nextCursor);
 assert.deepEqual(await readManualGameRelationPage(f.db,first.nextCursor!,231),{page:2,previous:0});
 assert.deepEqual(await readManualGameRelationPage(f.db,second.nextCursor!,231),{page:3,previous:first.nextCursor});
 for(const [origin,expected] of [['bgg',2],['all',43]] as const){
  const result=await f.admin('origin='+origin);
  assert.equal('total' in result ? result.total : undefined,expected);
 }
});
