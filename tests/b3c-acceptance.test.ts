import assert from 'node:assert/strict';
import test from 'node:test';
import { getGames } from '../src/lib/games.ts';
import { detailRelations } from '../src/lib/detail-relations.ts';
import { relationDisplayItems } from '../src/lib/relation-display.ts';
import { planRelationImport, cachedGameIssues } from '../src/lib/relation-import-plan.ts';
import { buildCatalogPayload } from '../src/lib/catalog-payload.ts';
import { POST_B3C_IDS } from './fixtures/import-batches.ts';
const ids=[226690,233977,237424];
// Keep the B-3C 765-record historical assertions; later batches have independent acceptance suites.
const catalog=getGames().filter(g=>!POST_B3C_IDS.includes(g.bggId));
const root=catalog.find(g=>g.bggId===205637)!;
test('B3C historical cache has exactly 765 complete records and authorized targets',()=>{
    assert.equal(catalog.filter(g=>g.bgg).length,765);
    for(const id of ids){const entry=catalog.find(g=>g.bggId===id)!;assert.deepEqual(cachedGameIssues(entry.bgg,id),[]);assert.equal(entry.bgg!.gameType,'boardgameexpansion');}
});
test('B3C real planning and A2 statistics match the explicit post-import baseline',()=>{
    const cache=Object.fromEntries(catalog.filter(g=>g.bgg).map(g=>[g.bggId,g.bgg]));const plan=planRelationImport(cache,205637);
    assert.equal(plan.stats.uniqueTargets,117);assert.equal(plan.stats.alreadyCached,67);assert.equal(plan.stats.pendingImport,50);
    const rows=detailRelations(root,catalog,'en');assert.equal(rows.length,117);assert.equal(new Set(rows.map(r=>r.id)).size,117);
    assert.equal(rows.filter(r=>r.directions.expansions?.directionStatus==='derived').length,67);
    assert.equal(rows.filter(r=>r.directions.expansions?.directionStatus==='unknown').length,49);
    assert.equal(rows.filter(r=>r.directions.implementations?.directionStatus==='unknown').length,1);
    assert.ok(rows.every(r=>Object.values(r.directions).every(d=>!d.hasConflict)));
    assert.equal(rows.reduce((n,r)=>n+r.evidence.length,0),184);
});
test('B3C bilingual A3 child/base labels and local routes remain correct',()=>{
    for(const lang of ['zh-TW','en'] as const){
        const rows=relationDisplayItems(detailRelations(root,catalog,lang),lang);
        for(const id of ids){const row=rows.find(r=>r.id===id)!;assert.deepEqual(row.roleLabels,[lang==='en'?'Expansion':'擴充']);assert.equal(row.internal,true);
            const child=catalog.find(g=>g.bggId===id)!;assert.ok(row.href.endsWith(`/games/${child.slug}`));
            const back=relationDisplayItems(detailRelations(child,catalog,lang),lang).find(r=>r.id===205637)!;
            assert.deepEqual(back.roleLabels,[lang==='en'?'Base game':'本體']);assert.equal(back.internal,true);
        }
        assert.doesNotMatch(JSON.stringify(rows),/inbound|directionStatus|directionBasis|explicit|derived|conflict|unknown/);
    }
});
test('B3C entries remain intact; B3D presentation treats raw zero weight as missing',()=>{
    const payload=buildCatalogPayload(catalog,'en');assert.equal(payload.records.length,765);
    for(const id of ids){const record=payload.records.find(r=>r.dataset.bggId===String(id))!;assert.equal(record.dataset.itemType,'expansion');assert.ok(record.image);assert.ok(record.href);}
    assert.equal(catalog.find(g=>g.bggId===226690)!.bgg!.averageWeight,0);
    const zero=payload.records.find(r=>r.dataset.bggId==='226690')!;assert.equal(zero.dataset.weight,'');
});
