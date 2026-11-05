import assert from 'node:assert/strict';
import test from 'node:test';
import { relationDisplayLabel,relationDisplayItems,relationFilterLabels } from '../src/lib/relation-display.ts';
import type { DetailDirectionResult } from '../src/lib/detail-relations.ts';
import { detailRelations } from '../src/lib/detail-relations.ts';
import { getGames } from '../src/lib/games.ts';
import { POST_B1_IDS } from './fixtures/import-batches.ts';
import type { Game } from '../src/lib/game-catalog.ts';
const result=(semanticRole:DetailDirectionResult['semanticRole'],directionStatus:DetailDirectionResult['directionStatus']='derived',hasConflict=false):DetailDirectionResult=>({currentGameId:1,relatedGameId:2,relationType:'expansions',semanticRole,directionStatus,hasConflict,directionBasis:[],evidenceIndexes:[],usedEvidenceIndexes:[]});
const cases=[['base','本體','Base game'],['expansion','擴充','Expansion'],['unknown','本體／擴充關聯','Base / expansion relation']] as const;
for(const [role,zh,en] of cases)test(`A3 ${role} maps to a bilingual user-facing label`,()=>{assert.equal(relationDisplayLabel('expansions',result(role),'zh-TW'),zh);assert.equal(relationDisplayLabel('expansions',result(role),'en'),en);});
test('A3 conflict, missing or inconsistent results never show a confirmed role',()=>{
 for(const r of [undefined,result('base','conflict'),result('expansion','derived',true),result('base','unknown')])assert.equal(relationDisplayLabel('expansions',r,'zh-TW'),'本體／擴充關聯');
});
for(const [kind,zh,en] of [['implementations','版本關聯','Version relation'],['compilations','合集關聯','Compilation relation']] as const)test(`A3 ${kind} never makes version or containment claims`,()=>{
 assert.equal(relationDisplayLabel(kind,result('base','explicit'),'zh-TW'),zh);assert.equal(relationDisplayLabel(kind,undefined,'en'),en);
});
test('A3 multiple types produce all labels, with evidence left only in the data model',()=>{
 const sample=getGames()[0];const a:Game={...sample,bggId:1,bgg:{...sample.bgg!,gameType:'boardgame',expansions:[{id:2,name:'Peer'}],implementations:[{id:2,name:'Peer'}],compilations:[{id:2,name:'Peer'}]}};
 const b:Game={...sample,bggId:2,bgg:{...sample.bgg!,gameType:'boardgameexpansion',expansions:[{id:1,name:'Base',inbound:true}],implementations:[],compilations:[]}};
 const model=detailRelations(a,[a,b],'zh-TW'),rows=relationDisplayItems(model,'zh-TW');assert.equal(rows.length,1);assert.equal(model[0].evidence.length,4);
 assert.deepEqual(rows[0].roleLabels,['擴充','版本關聯','合集關聯']);assert.ok(!('sources' in rows[0]));assert.ok(!('directions' in rows[0]));assert.ok(!('evidence' in rows[0]));
 for(const kind of ['expansions','implementations','compilations'] as const)assert.equal(rows.filter(r=>r.kinds.includes(kind)).length,1);
 assert.deepEqual(Object.keys(relationFilterLabels('zh-TW')),['all','expansions','implementations','compilations']);
});
test('A3 actual Arkham targets/counts and all four requested display roles are correct',()=>{
 // Preserve the pre-B-3C acceptance sample; current production data has a separate B-3C test.
 const catalog=getGames().filter(g=>!POST_B1_IDS.includes(g.bggId)),base=catalog.find(g=>g.bggId===205637)!;const model=detailRelations(base,catalog,'zh-TW');const rows=relationDisplayItems(model,'zh-TW');
 assert.equal(rows.length,117);assert.equal(new Set(rows.map(r=>r.id)).size,117);assert.equal(rows.filter(r=>r.kinds.includes('expansions')).length,116);assert.equal(rows.filter(r=>r.kinds.includes('implementations')).length,1);
 assert.equal(rows.filter(r=>r.roleLabels.includes('擴充')).length,64);assert.equal(rows.filter(r=>r.roleLabels.includes('本體／擴充關聯')).length,52);
 for(const [id,label] of [[327293,'擴充'],[359609,'版本關聯'],[379286,'本體／擴充關聯']] as const)assert.deepEqual(rows.find(r=>r.id===id)!.roleLabels,[label]);
 assert.ok(rows.find(r=>r.id===327293)!.internal);assert.equal(rows.find(r=>r.id===359609)!.href,'https://boardgamegeek.com/boardgame/359609');
 const child=catalog.find(g=>g.bggId===327293)!;assert.deepEqual(relationDisplayItems(detailRelations(child,catalog,'zh-TW'),'zh-TW').find(r=>r.id===205637)!.roleLabels,['本體']);
 assert.doesNotMatch(JSON.stringify(rows),/inbound|directionStatus|directionBasis|explicit|derived|conflict|unknown|reverse-index/);
 assert.equal(model.reduce((n,r)=>n+r.evidence.length,0),181);
});
