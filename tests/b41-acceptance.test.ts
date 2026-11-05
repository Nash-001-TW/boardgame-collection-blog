import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { getGames } from '../src/lib/games.ts';
import { detailRelations } from '../src/lib/detail-relations.ts';
import { relationDisplayItems } from '../src/lib/relation-display.ts';
import { cachedGameIssues, planRelationImport } from '../src/lib/relation-import-plan.ts';
import { buildCatalogPayload } from '../src/lib/catalog-payload.ts';
import { validGameComplexity } from '../src/lib/game-complexity.ts';
import { matchesPlayingTime } from '../src/lib/catalog-browsing.ts';
import { B41_IDS, B42_IDS, B43_COMMITTED_IDS, B44_IDS, B45_IDS } from './fixtures/import-batches.ts';
// Retain the original B-4.1 assertions against its unchanged 775-record snapshot.
const catalog=getGames().filter(g=>![...B42_IDS,...B43_COMMITTED_IDS,...B44_IDS,...B45_IDS].includes(g.bggId)),root=catalog.find(g=>g.bggId===205637)!;
const cache=Object.fromEntries(catalog.filter(g=>g.bgg).map(g=>[g.bggId,g.bgg]));
test('B4.1 historical cache contains 775 valid entries with exactly its authorized ten additions',()=>{
    assert.equal(Object.keys(cache).length,775);
    const before=Object.fromEntries(Object.entries(cache).filter(([id])=>!B41_IDS.includes(Number(id))));
    assert.equal(Object.keys(before).length,765);
    assert.equal(createHash('sha256').update(JSON.stringify(before,null,2)+'\n').digest('hex'),'211157073d21d65e2707fa121d2628d6715b2d75417b3e99ff3f0bd660c91bdd');
    for(const id of B41_IDS){const b=cache[id]!;assert.deepEqual(cachedGameIssues(b,id),[]);assert.equal(b.gameType,'boardgameexpansion');assert.ok(b.image);assert.ok(b.thumbnail);}
});
test('B4.1 depth-one plan is 117 targets, 77 complete and 40 pending',()=>{
    const p=planRelationImport(cache,205637);assert.equal(p.stats.uniqueTargets,117);assert.equal(p.stats.alreadyCached,77);assert.equal(p.stats.pendingImport,40);
    assert.equal(p.stats.duplicateRelationRecords,0);assert.ok(B41_IDS.every(id=>!p.pendingIds.includes(id)));
});
test('B4.1 A2 observed results are 77 derived, 39 unknown expansions and one unknown implementation',()=>{
    const rows=detailRelations(root,catalog,'zh-TW');assert.equal(rows.length,117);assert.equal(rows.reduce((n,r)=>n+r.evidence.length,0),194);
    assert.equal(rows.filter(r=>r.directions.expansions?.directionStatus==='derived').length,77);
    assert.equal(rows.filter(r=>r.directions.expansions?.directionStatus==='unknown').length,39);
    assert.equal(rows.filter(r=>r.directions.implementations?.directionStatus==='unknown').length,1);
    assert.ok(rows.every(r=>Object.values(r.directions).every(d=>!d.hasConflict)));
    for(const id of B41_IDS){const row=rows.find(r=>r.id===id)!;assert.equal(row.directions.expansions?.semanticRole,'expansion');
        assert.ok(cache[id]!.expansions.some(l=>l.id===205637&&l.inbound===true));
        assert.equal(root.bgg!.expansions.find(l=>l.id===id)!.inbound,undefined);
    }
});
test('B4.1 A3 bilingual labels, deduplication, and every local/external relationship link remain correct',()=>{
    for(const lang of ['zh-TW','en'] as const){
        const parentRows=relationDisplayItems(detailRelations(root,catalog,lang),lang);
        for(const id of B41_IDS){const child=catalog.find(g=>g.bggId===id)!;
            assert.deepEqual(parentRows.find(r=>r.id===id)!.roleLabels,[lang==='en'?'Expansion':'擴充']);
            const rows=relationDisplayItems(detailRelations(child,catalog,lang),lang);
            assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
            assert.deepEqual(rows.find(r=>r.id===205637)!.roleLabels,[lang==='en'?'Base game':'本體']);
            for(const row of rows){const local=catalog.find(g=>g.bggId===row.id&&g.bgg);assert.equal(row.internal,!!local);
                assert.equal(row.href,local?`${lang==='en'?'/en':''}/games/${encodeURIComponent(local.slug)}`:`https://boardgamegeek.com/boardgame/${row.id}`);
                if(row.kinds.includes('implementations'))assert.ok(row.roleLabels.includes(lang==='en'?'Version relation':'版本關聯'));
                if(row.kinds.includes('compilations'))assert.ok(row.roleLabels.includes(lang==='en'?'Compilation relation':'合集關聯'));
            }
            assert.doesNotMatch(JSON.stringify(rows),/inbound|directionStatus|directionBasis|explicit|derived|conflict|unknown/);
        }
    }
});
test('B4.1 zero weights remain missing in presentation and zero times do not pass time filters',()=>{
    const payload=buildCatalogPayload(catalog,'en');assert.equal(payload.records.length,775);
    for(const id of B41_IDS){const b=cache[id]!,record=payload.records.find(r=>r.dataset.bggId===String(id))!;
        assert.equal(record.dataset.itemType,'expansion');assert.equal(record.dataset.weight,String(validGameComplexity(b.averageWeight)??''));
        if(b.maxPlayTime===0){assert.equal(record.time,'—');for(const time of ['30','31-60','61-120','over120'])assert.equal(matchesPlayingTime(b.maxPlayTime,time),false);}
    }
});
test('B4.1 historical snapshot SHA256 matches the independently captured committed result',()=>{
    assert.equal(createHash('sha256').update(JSON.stringify(cache,null,2)+'\n').digest('hex'),'4d6e5b68a573d81db5643102d89e945b7e1b779b5e4cc58e9719b176de7d7709');
});
