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
import { B42_IDS, B43_COMMITTED_IDS, B44_IDS, B45_IDS } from './fixtures/import-batches.ts';
const catalog=getGames().filter(g=>![...B43_COMMITTED_IDS,...B44_IDS,...B45_IDS].includes(g.bggId)),root=catalog.find(g=>g.bggId===205637)!;
const cache=Object.fromEntries(catalog.filter(g=>g.bgg).map(g=>[g.bggId,g.bgg]));
test('B4.2 actual cache contains 785 valid entries with exactly the authorized ten additions',()=>{
    assert.equal(Object.keys(cache).length,785);
    const before=Object.fromEntries(Object.entries(cache).filter(([id])=>!B42_IDS.includes(Number(id))));
    assert.equal(Object.keys(before).length,775);
    assert.equal(createHash('sha256').update(JSON.stringify(before,null,2)+'\n').digest('hex'),'4d6e5b68a573d81db5643102d89e945b7e1b779b5e4cc58e9719b176de7d7709');
    for(const id of B42_IDS){const b=cache[id]!;assert.deepEqual(cachedGameIssues(b,id),[]);assert.equal(b.gameType,'boardgameexpansion');assert.ok(b.image);assert.ok(b.thumbnail);}
});
test('B4.2 depth-one plan is 117 targets, 87 complete and 30 pending',()=>{
    const p=planRelationImport(cache,205637);assert.equal(p.stats.uniqueTargets,117);assert.equal(p.stats.alreadyCached,87);assert.equal(p.stats.pendingImport,30);
    assert.equal(p.stats.duplicateRelationRecords,0);assert.ok(B42_IDS.every(id=>!p.pendingIds.includes(id)));
});
test('B4.2 A2 observed results are 87 derived, 29 unknown expansions and one unknown implementation',()=>{
    const rows=detailRelations(root,catalog,'zh-TW');assert.equal(rows.length,117);assert.equal(rows.reduce((n,r)=>n+r.evidence.length,0),204);
    assert.equal(rows.filter(r=>r.directions.expansions?.directionStatus==='derived').length,87);
    assert.equal(rows.filter(r=>r.directions.expansions?.directionStatus==='unknown').length,29);
    assert.equal(rows.filter(r=>r.directions.implementations?.directionStatus==='unknown').length,1);
    assert.ok(rows.every(r=>Object.values(r.directions).every(d=>!d.hasConflict)));
    for(const id of B42_IDS){const row=rows.find(r=>r.id===id)!;assert.equal(row.directions.expansions?.semanticRole,'expansion');
        assert.ok(cache[id]!.expansions.some(l=>l.id===205637&&l.inbound===true));
        assert.equal(root.bgg!.expansions.find(l=>l.id===id)!.inbound,undefined);
    }
});
test('B4.2 A3 bilingual labels, deduplication, and every local/external relationship link remain correct',()=>{
    for(const lang of ['zh-TW','en'] as const){
        const parentRows=relationDisplayItems(detailRelations(root,catalog,lang),lang);
        for(const id of B42_IDS){const child=catalog.find(g=>g.bggId===id)!;
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
test('B4.2 zero weights remain missing in presentation and zero times do not pass time filters',()=>{
    const payload=buildCatalogPayload(catalog,'en');assert.equal(payload.records.length,785);
    for(const id of B42_IDS){const b=cache[id]!,record=payload.records.find(r=>r.dataset.bggId===String(id))!;
        assert.equal(record.dataset.itemType,'expansion');assert.equal(record.dataset.weight,String(validGameComplexity(b.averageWeight)??''));
        if(b.maxPlayTime===0){assert.equal(record.time,'—');for(const time of ['30','31-60','61-120','over120'])assert.equal(matchesPlayingTime(b.maxPlayTime,time),false);}
    }
});
test('B4.2 historical post-import cache SHA256 matches the independently captured committed result',()=>{
    assert.equal(createHash('sha256').update(JSON.stringify(cache,null,2)+'\n').digest('hex'),'91e9bcb17d0047832d0d76cf33e5676f3ba54b4cd4e1918e2356819de0a176ad');
});
