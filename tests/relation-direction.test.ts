import assert from 'node:assert/strict';
import test from 'node:test';
import { getGames } from '../src/lib/games.ts';
import { POST_B1_IDS } from './fixtures/import-batches.ts';
import type { Game } from '../src/lib/game-catalog.ts';
import type { BggRelationLink } from '../src/lib/bgg-types.ts';
import { createRelationIndex, getGameRelations } from '../src/lib/game-content.ts';
import type { RelationKind } from '../src/lib/game-content.ts';
import { detailRelations } from '../src/lib/detail-relations.ts';
import { combineRoleClaims, resolveRelationDirection } from '../src/lib/relation-direction.ts';
import type { RelationEvidence } from '../src/lib/relation-direction.ts';
const seed=getGames()[0];
function game(id:number,type='boardgame'):Game{return {...seed,bggId:id,slug:`game-${id}`,name:`Game ${id}`,bgg:{...seed.bgg!,bggId:id,name:`Game ${id}`,gameType:type,expansions:[],implementations:[],compilations:[]}};}
function pair(){const base=game(1),child=game(2,'boardgameexpansion');base.bgg!.expansions=[{id:2,name:'Child'}];child.bgg!.expansions=[{id:1,name:'Base',inbound:true}];return {base,child,catalog:[base,child]};}
function direction(a:Game,b:Game,catalog:Game[],kind:RelationKind='expansions'){
 return detailRelations(a,catalog,'en').find(r=>r.id===b.bggId)!.directions[kind]!;
}
test('A2 01 direct missing plus peer true derives an expansion without rewriting the missing value',()=>{
 const {base,child,catalog}=pair();const row=detailRelations(base,catalog,'en')[0],d=row.directions.expansions!;
 assert.equal(d.semanticRole,'expansion');assert.equal(d.directionStatus,'derived');assert.equal(row.evidence.length,2);
 assert.equal(row.evidence[0].rawInbound,undefined);assert.equal(row.evidence[0].inboundPresence,'missing');
 assert.equal(row.evidence[d.usedEvidenceIndexes[0]].rawInbound,true);
});
test('A2 02 expansion own true explicitly identifies its boardgame base',()=>{
 const {base,child,catalog}=pair();const d=direction(child,base,catalog);assert.equal(d.semanticRole,'base');assert.equal(d.directionStatus,'explicit');
});
test('A2 03 direct missing alone stays unknown, regardless of a convincing game name',()=>{
 const {base,child,catalog}=pair();child.bgg!.expansions=[];child.name='Expansion Mythos Pack fan expansion';
 assert.equal(direction(base,child,catalog).directionStatus,'unknown');
});
test('A2 04 reverse-only true creates one UI target and derives the role',()=>{
 const {base,child,catalog}=pair();base.bgg!.expansions=[];assert.equal(detailRelations(base,catalog,'en').length,1);assert.equal(direction(base,child,catalog).directionStatus,'derived');
});
test('A2 05 both endpoints survive but never create two UI targets',()=>{
 const {base,catalog}=pair();assert.equal(getGameRelations(base,catalog,'en').length,2);assert.equal(detailRelations(base,catalog,'en').length,1);
});
test('A2 06 repeated same-source observations are deduplicated without losing alternate raw names',()=>{
 const {base,catalog}=pair();base.bgg!.expansions.push({id:2,name:'Alternate label'},{id:2,name:'Child'});
 const rows=getGameRelations(base,catalog,'en');assert.equal(rows.length,2);assert.deepEqual(rows[0].evidence.rawNames,['Child','Alternate label']);
});
test('A2 07 direct and peer provenance includes original endpoint IDs, types and raw true',()=>{
 const {base,catalog}=pair();const row=detailRelations(base,catalog,'en')[0];assert.deepEqual(row.evidence.map(e=>[e.sourceGameId,e.targetGameId,e.origin,e.rawInbound]),[[1,2,'direct',undefined],[2,1,'reverse',true]]);
 assert.ok(row.evidence.every(e=>e.evidenceSource==='local-cache'));assert.equal(row.evidence[1].sourceGameType,'boardgameexpansion');
});
test('A2 08 mutually exclusive already-interpreted synthetic role claims conflict',()=>{
 const {base,catalog}=pair();const evidence=getGameRelations(base,catalog,'en').map(r=>r.evidence);
 // This reducer fixture supplies interpreted roles; it does not invent a false flag rule.
 const result=combineRoleClaims(1,2,'expansions',evidence,[{semanticRole:'base',directionBasis:'PREINTERPRETED_ROLE',evidence:evidence[0]},{semanticRole:'expansion',directionBasis:'PREINTERPRETED_ROLE',evidence:evidence[1]}]);
 assert.equal(result.hasConflict,true);assert.equal(result.semanticRole,'unknown');assert.equal(result.directionStatus,'conflict');
 const unrelated={...evidence[1],sourceGameId:3};
 const separate=combineRoleClaims(1,2,'expansions',[evidence[0],unrelated],[{semanticRole:'base',directionBasis:'PREINTERPRETED_ROLE',evidence:evidence[0]},{semanticRole:'expansion',directionBasis:'PREINTERPRETED_ROLE',evidence:unrelated}]);
 assert.equal(separate.hasConflict,false);assert.equal(separate.semanticRole,'base');
});
for(const [n,kind] of [['09','implementations'],['10','compilations']] as const){
 test(`A2 ${n} ${kind} true/missing preserves sources and never assigns expansion roles`,()=>{
  const {base,child,catalog}=pair();base.bgg!.expansions=[];child.bgg!.expansions=[];
  base.bgg![kind]=[{id:2,name:'Peer'}];child.bgg![kind]=[{id:1,name:'Base',inbound:true}];
  const d=direction(base,child,catalog,kind);assert.equal(d.directionStatus,'unknown');assert.equal(d.semanticRole,'unknown');assert.equal(d.hasConflict,false);
  assert.equal(detailRelations(base,catalog,'en')[0].evidence.length,2);
 });
}
test('A2 11 synthetic false is present and retained, but supplies no unverified role',()=>{
 const {base,child,catalog}=pair();base.bgg!.expansions[0].inbound=false;child.bgg!.expansions=[];
 const row=detailRelations(base,catalog,'en')[0];assert.equal(row.evidence[0].rawInbound,false);assert.equal(row.evidence[0].inboundPresence,'present');
 assert.equal(row.directions.expansions!.directionStatus,'unknown');assert.deepEqual(row.directions.expansions!.directionBasis,['FALSE_SEMANTICS_UNVERIFIED']);
});
test('A2 12 the same peer keeps separate per-type direction results',()=>{
 const {base,child,catalog}=pair();base.bgg!.implementations=[{id:2,name:'Peer',inbound:true}];const rows=detailRelations(base,catalog,'en');assert.equal(rows.length,1);
 assert.equal(rows[0].directions.expansions!.directionStatus,'derived');assert.equal(rows[0].directions.implementations!.directionStatus,'unknown');
 assert.ok(rows[0].kinds.includes('expansions')&&rows[0].kinds.includes('implementations'));
});
test('A2 13 repeat processing and explicit index reuse are stable and do not mutate inputs',()=>{
 const {base,catalog}=pair();const before=JSON.stringify(catalog),index=createRelationIndex(catalog);
 assert.deepEqual(getGameRelations(base,catalog,'en',index),getGameRelations(base,catalog,'en'));
 assert.deepEqual(detailRelations(base,catalog,'en'),detailRelations(base,catalog,'en'));assert.equal(JSON.stringify(catalog),before);
});
test('A2 14 detail compatibility keeps the existing UI batching/search/filter data contract',()=>{
 const {base,catalog}=pair();const row=detailRelations(base,catalog,'en')[0];assert.ok(row.id&&row.name&&row.href);assert.ok(row.kinds.includes('expansions'));assert.ok(row.sources.every(s=>s.includes('inbound=')));
 // Evidence indexes avoid repeating full records in every serialized direction result.
 assert.ok(!('evidence' in row.directions.expansions!));assert.deepEqual(row.directions.expansions!.evidenceIndexes,[0,1]);
});
test('A2 15 local bilingual and missing-target external links remain correct',()=>{
 const {base,child,catalog}=pair();assert.equal(detailRelations(base,catalog,'zh-TW')[0].href,'/games/game-2');assert.equal(detailRelations(base,catalog,'en')[0].href,'/en/games/game-2');
 child.bgg=null;const row=detailRelations(base,catalog,'en')[0];assert.equal(row.href,'https://boardgamegeek.com/boardgame/2');assert.equal(row.internal,false);assert.equal(row.directions.expansions!.directionStatus,'unknown');
});
test('A2 16 mismatched endpoints/types and unknown normalized values fail closed',()=>{
 const {base,catalog}=pair();const e=getGameRelations(base,catalog,'en')[1].evidence;const types=new Map([[1,'boardgame'],[2,'boardgameexpansion']]);
 for(const bad of [{...e,targetGameId:3},{...e,sourceGameType:'boardgame'},{...e,origin:'direct' as const}])assert.equal(resolveRelationDirection(1,2,'expansions',[bad],types).directionStatus,'unknown');
 base.bgg!.expansions[0]={id:2,name:'Peer',inbound:'false'} as unknown as BggRelationLink;
 const raw=getGameRelations(base,catalog,'en')[0].evidence;assert.equal(raw.inboundPresence,'unrecognized');assert.equal(raw.rawInbound,undefined);assert.equal(raw.unrecognizedValue,'false');
});
test('A2 17 missing and unverified false never count as contradictory role evidence',()=>{
 const {base,child,catalog}=pair();base.bgg!.expansions[0].inbound=false;const d=direction(base,child,catalog);assert.equal(d.directionStatus,'derived');assert.equal(d.hasConflict,false);
 base.bgg!.expansions[0].inbound=undefined;child.bgg!.expansions[0].inbound=undefined;assert.equal(direction(base,child,catalog).hasConflict,false);
});
test('A2 18 actual Arkham snapshot has 117 targets, 181 observations, 64 derived and 53 unknown',()=>{
 // Historical pre-B-3C snapshot: retain all original A-2 expectations.
 const catalog=getGames().filter(g=>!POST_B1_IDS.includes(g.bggId)),base=catalog.find(g=>g.bggId===205637)!,rows=detailRelations(base,catalog,'en');
 assert.equal(rows.length,117);assert.equal(new Set(rows.map(r=>r.id)).size,117);assert.equal(rows.reduce((n,r)=>n+r.evidence.length,0),181);
 const expansion=rows.flatMap(r=>r.directions.expansions?[r.directions.expansions]:[]),implementation=rows.flatMap(r=>r.directions.implementations?[r.directions.implementations]:[]);
 assert.equal(expansion.length,116);assert.equal(implementation.length,1);assert.equal(expansion.filter(d=>d.directionStatus==='derived'&&d.semanticRole==='expansion').length,64);
 assert.equal(expansion.filter(d=>d.directionStatus==='unknown').length,52);assert.equal(implementation[0].directionStatus,'unknown');assert.ok(rows.every(r=>Object.values(r.directions).every(d=>!d.hasConflict)));
});
