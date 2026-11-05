import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { BggGameData } from '../src/lib/bgg-types.ts';
import { planRelationImport, dryRunReport, RelationPlanError } from '../src/lib/relation-import-plan.ts';
import { parseRelationImportArgs, ImportArgumentError } from '../scripts/bgg-relations-import.ts';
import { POST_B1_IDS } from './fixtures/import-batches.ts';
const cachePath=new URL('../src/data/bgg-cache.json',import.meta.url);
const actual=JSON.parse(readFileSync(cachePath,'utf8')) as Record<string,BggGameData>;
const game=(id:number,changes:Partial<BggGameData>={}):BggGameData=>({...actual['205637'],bggId:id,name:`Game ${id}`,expansions:[],implementations:[],compilations:[],...changes});
const root=()=>game(1,{expansions:[{id:2,name:'Two'},{id:3,name:'Three'}]});
const errorCode=(code:string)=>(e:unknown)=>e instanceof RelationPlanError&&e.code===code;

test('B1 01 existing cached root produces a depth-one dry plan',()=>{
 const plan=planRelationImport({'1':root()},1);assert.equal(plan.mode,'dry-run');assert.equal(plan.depth,1);assert.deepEqual(plan.root,{id:1,name:'Game 1',gameType:'boardgame'});assert.equal(plan.stats.uniqueTargets,2);
});
test('B1 02 a missing root is rejected without creating a download job',()=>{
 assert.throws(()=>planRelationImport({},1),errorCode('ROOT_NOT_CACHED'));
});
test('B1 03 invalid IDs are rejected both by CLI and the planner',()=>{
 for(const id of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>planRelationImport({},id),errorCode('INVALID_ROOT_ID'));
 for(const value of ['0','-1','1.5','NaN','1e3','9007199254740992'])assert.throws(()=>parseRelationImportArgs(['--root',value,'--dry-run']),e=>e instanceof ImportArgumentError&&e.code==='INVALID_ROOT_ID');
});
test('B1 04 an empty direct list returns an explicit notice',()=>{
 const plan=planRelationImport({'1':game(1)},1);assert.equal(plan.stats.directRelationRecords,0);assert.deepEqual(plan.pendingIds,[]);assert.deepEqual(plan.notices,['NO_DIRECT_RELATION_TARGETS']);
});
test('B1 05 duplicate references produce one target and deduplicated evidence',()=>{
 const plan=planRelationImport({'1':game(1,{expansions:[{id:2,name:'Two'},{id:2,name:'Two'},{id:2,name:'Alternate'}]})},1);
 assert.equal(plan.stats.directRelationRecords,3);assert.equal(plan.stats.uniqueTargets,1);assert.equal(plan.stats.duplicateRelationRecords,2);assert.equal(plan.targets[0].evidence.length,1);assert.deepEqual(plan.targets[0].evidence[0].rawNames,['Two','Alternate']);
});
test('B1 06 multiple types are retained without duplicate import IDs',()=>{
 const plan=planRelationImport({'1':game(1,{expansions:[{id:2,name:'Two'}],implementations:[{id:2,name:'Two'}]})},1);
 assert.deepEqual(plan.pendingIds,[2]);assert.equal(plan.stats.multiTypeTargets,1);assert.equal(plan.stats.duplicateRelationRecords,0);assert.equal(plan.stats.repeatedTargetReferences,1);assert.equal(plan.targets[0].evidence.length,2);
 assert.deepEqual(plan.relations.uniqueTargetsByType,{expansions:1,implementations:1,compilations:0});
});
test('B1 07 complete cached targets are skipped',()=>{
 const plan=planRelationImport({'1':root(),'2':game(2)},1);assert.equal(plan.stats.alreadyCached,1);assert.deepEqual(plan.pendingIds,[3]);
});
test('B1 08 missing and incomplete targets are distinguished and queued',()=>{
 const plan=planRelationImport({'1':root(),'2':{bggId:2,name:'Partial'}},1);assert.equal(plan.stats.missingCache,1);assert.equal(plan.stats.incompleteCache,1);assert.deepEqual(plan.pendingIds,[2,3]);
 assert.ok(plan.anomalies.some(a=>a.code==='INCOMPLETE_CACHED_TARGET'));assert.equal(plan.targets[0].cacheStatus,'incomplete');
});
test('B1 09 limit applies after cache skips, in ascending ID order',()=>{
 const plan=planRelationImport({'1':game(1,{expansions:[{id:9,name:'Nine'},{id:3,name:'Three'},{id:2,name:'Two'}]}),'2':game(2)},1,1);
 assert.deepEqual(plan.pendingIds,[3,9]);assert.deepEqual(plan.plannedIds,[3]);assert.deepEqual(plan.deferredIds,[9]);assert.equal(plan.stats.plannedCount,1);
 assert.equal(planRelationImport({'1':root()},1,99).stats.plannedCount,2);
 for(const limit of [0,-1,1.2,Infinity])assert.throws(()=>planRelationImport({'1':root()},1,limit),errorCode('INVALID_LIMIT'));
});
test('B1 10 only root direct arrays are expanded, never target/reverse/second-level links',()=>{
 const plan=planRelationImport({'1':game(1,{expansions:[{id:2,name:'Two'}]}),'2':game(2,{expansions:[{id:3,name:'Third layer'},{id:1,name:'Cycle',inbound:true}]}),'4':game(4,{expansions:[{id:1,name:'Reverse only',inbound:true}]})},1);
 assert.deepEqual(plan.targets.map(t=>t.id),[2]);assert.deepEqual(plan.pendingIds,[]);assert.equal(plan.stats.directRelationRecords,1);
});
test('B1 11 pure planning and real CLI repeated runs leave cache bytes unchanged',()=>{
 const before=readFileSync(cachePath);const input={'1':root()},snapshot=JSON.stringify(input);planRelationImport(input,1);assert.equal(JSON.stringify(input),snapshot);
 const args=['--import','tsx','scripts/bgg-relations-import.ts','--root','205637','--dry-run','--limit','20'];
 const first=spawnSync(process.execPath,args,{encoding:'utf8'}),second=spawnSync(process.execPath,args,{encoding:'utf8'});
 assert.equal(first.status,0,first.stderr);assert.equal(second.status,0,second.stderr);assert.equal(first.stdout,second.stdout);
 const report=JSON.parse(first.stdout),expected=planRelationImport(actual,205637,20);
 assert.equal(report.stats.plannedCount,Math.min(20,expected.pendingIds.length));assert.deepEqual(report.plannedIds,expected.plannedIds);
 assert.deepEqual(report.effects,{apiRequests:0,gameDownloads:0,cacheWrites:0,collectionWrites:0,databaseOperations:0});
 assert.equal(createHash('sha256').update(before).digest('hex'),createHash('sha256').update(readFileSync(cachePath)).digest('hex'));
});
test('B1 12 repeated pure plans are identical',()=>{
 assert.deepEqual(planRelationImport(actual,205637,20),planRelationImport(actual,205637,20));
});
test('B1 CLI supports both option forms, requires dry-run and rejects execution/duplicate flags',()=>{
 assert.deepEqual(parseRelationImportArgs(['--root=205637','--dry-run','--limit=20']),parseRelationImportArgs(['--root','205637','--dry-run','--limit','20']));
 for(const args of [['--root','205637'],['--dry-run'],['--root','1','--root','2','--dry-run'],['--root','1','--dry-run=false'],['--root','1','--dry-run','--execute'],['--root','1','--dry-run','--limit','0']])assert.throws(()=>parseRelationImportArgs(args),ImportArgumentError);
 assert.deepEqual(parseRelationImportArgs(['--help']),{help:true});
});
test('B1 invalid links/self references are reported and never become import jobs',()=>{
 const malformed=game(1,{expansions:[{id:1,name:'Self'},{id:-2,name:'Invalid'},{id:2,name:''}]});
 const plan=planRelationImport({'1':malformed},1);assert.deepEqual(plan.pendingIds,[2]);assert.equal(plan.stats.selfReferences,1);assert.equal(plan.stats.invalidRecords,1);assert.ok(plan.anomalies.some(a=>a.code==='RELATION_NAME_MISSING'));
});
test('B1 root/cache structural problems fail closed',()=>{
 assert.throws(()=>planRelationImport([],1),errorCode('CACHE_SHAPE_INVALID'));assert.throws(()=>planRelationImport({'1':{bggId:1,name:'Partial'}},1),errorCode('ROOT_DATA_INCOMPLETE'));
 const plan=planRelationImport({'1':root(),'2':game(999)},1);assert.equal(plan.targets[0].cacheStatus,'incomplete');assert.ok(plan.targets[0].cacheIssues.includes('BGG_ID_MISMATCH'));
});
test('B1 raw direction evidence survives planning without invoking inference',()=>{
 const plan=planRelationImport({'1':game(1,{expansions:[{id:2,name:'Two',inbound:true},{id:2,name:'Two',inbound:false},{id:3,name:'Three'}]})},1);
 assert.deepEqual(plan.targets[0].evidence.map(e=>e.rawInbound),[true,false]);assert.equal(plan.targets[1].evidence[0].inboundPresence,'missing');assert.deepEqual(plan.relations.directionAttributes,{true:1,false:1,missing:1,unrecognized:0});
});
test('B1 actual Arkham snapshot has 117 targets, 64 cached and 53 pending',()=>{
 // Preserve the historical B-1 fixture after B-3C, rather than rewriting its expected counts.
 const historical=Object.fromEntries(Object.entries(actual).filter(([id])=>!POST_B1_IDS.includes(Number(id))));
 const plan=planRelationImport(historical,205637);assert.equal(plan.stats.directRelationRecords,117);assert.equal(plan.stats.uniqueTargets,117);assert.equal(plan.stats.alreadyCached,64);assert.equal(plan.stats.pendingImport,53);assert.equal(plan.stats.incompleteCache,0);
 assert.deepEqual(plan.relations.rawByType,{expansions:116,implementations:1,compilations:0});assert.equal(plan.stats.duplicateRelationRecords,0);assert.ok(plan.pendingIds.includes(359609));assert.ok(!plan.pendingIds.includes(476751));assert.equal(plan.stats.plannedCount,53);assert.equal(dryRunReport(plan).effects.apiRequests,0);
});
