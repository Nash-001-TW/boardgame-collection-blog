import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesRelationQuery, readRelationViewState } from '../src/lib/detail-relations-controller.ts';

test('relation search accepts trimmed BGG IDs and exact #ID queries',()=>{
 const game={id:359609,name:'Revised Core Set'};
 assert.equal(matchesRelationQuery(game,' 359609 '),true);
 assert.equal(matchesRelationQuery(game,' #359609 '),true);
 assert.equal(matchesRelationQuery(game,'#205637'),false);
 assert.equal(matchesRelationQuery(game,'#35960'),false);
});
test('same-name targets remain distinguishable by BGG ID',()=>{
 const rows=[{id:1,name:'Same name'},{id:2,name:'Same name'}];
 assert.equal(rows.filter(row=>matchesRelationQuery(row,'same')).length,2);
 assert.deepEqual(rows.filter(row=>matchesRelationQuery(row,'#2')).map(row=>row.id),[2]);
});
test('ordinary substring, case-insensitive and numeric title searches are retained',()=>{
 assert.equal(matchesRelationQuery({id:10,name:'Dark Matter: Science Expansion'},' MATTER '),true);
 assert.equal(matchesRelationQuery({id:10,name:'1989: Dawn of Freedom'},'1989'),true);
 assert.equal(matchesRelationQuery({id:10,name:'Dark Matter'},'nothing'),false);
});
test('blank search retains all relations',()=>{
 assert.equal(matchesRelationQuery({id:1,name:'Game'},'  '),true);
});
test('relation history is bound to each detail route and restores its own batch',()=>{
 const state={path:'/games/bgg-205637',query:'Arkham',kind:'expansions',limit:40,listY:280,pageY:900};
 assert.deepEqual(readRelationViewState(state,state.path,117),state);
 assert.equal(readRelationViewState(state,'/games/bgg-359609',117),null);
 assert.equal(readRelationViewState(state,'/en/games/bgg-205637',117),null);
 assert.equal(readRelationViewState({...state,limit:500},state.path,117)?.limit,117);
});
test('malformed relation history fails back to normal initial browsing',()=>{
 const state={path:'/games/bgg-205637',query:'',kind:'all',limit:20,listY:0,pageY:0};
 for(const invalid of [null,{}, {...state,kind:'unknown'}, {...state,limit:NaN},{...state,limit:0},{...state,listY:-1},{...state,pageY:Infinity},{...state,query:42}])
  assert.equal(readRelationViewState(invalid,state.path,117),null);
});
