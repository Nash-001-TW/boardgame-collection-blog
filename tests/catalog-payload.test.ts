import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogPayload } from '../src/lib/catalog-payload.ts';
import { getGames } from '../src/lib/games.ts';

test('compact payload contains every catalog game and no personal records or full BGG descriptions',()=>{
    const games=getGames(), payload=buildCatalogPayload(games,'en');
    assert.equal(payload.records.length,games.length);
    assert.equal(new Set(payload.records.map(r=>r.dataset.bggId)).size,games.length);
    assert.ok(payload.records.some(r=>r.dataset.bggId==='448621'&&r.dataset.itemType==='accessory'));
    for(const r of payload.records){
        assert.ok(!('description' in r));assert.ok(!('collection' in r));
        assert.ok(!('owned' in r.dataset));assert.ok(!('purchasePrice' in r.dataset));
        assert.ok(!('mechanicNames' in r.dataset)); // labels are deduplicated in the dictionary
        for(const id of r.dataset.mechanics.split(',').filter(Boolean)) assert.equal(typeof payload.mechanics[id],'string');
    }
});

test('translated compact data preserves IDs and relationship counts across languages',()=>{
    const games=getGames(), en=buildCatalogPayload(games,'en'), zh=buildCatalogPayload(games,'zh-TW');
    assert.deepEqual(en.records.map(r=>[r.dataset.bggId,r.expansions,r.dataset.mechanics]),zh.records.map(r=>[r.dataset.bggId,r.expansions,r.dataset.mechanics]));
    assert.equal(en.mechanics['2082'],'Worker Placement');assert.equal(zh.mechanics['2082'],'工人放置');
});
test('real missing year and player ranges remain missing in the catalog projection',()=>{
 const games=getGames(),payload=buildCatalogPayload(games,'en');
 const missingYear=games.find(g=>g.bgg?.year===0)!;assert.ok(missingYear);
 assert.equal(payload.records.find(r=>r.dataset.bggId===String(missingYear.bggId))!.dataset.year,'');
 const missingPlayers=games.filter(g=>g.bgg&&!(g.bgg.minPlayers>0&&g.bgg.maxPlayers>=g.bgg.minPlayers));assert.ok(missingPlayers.length>0);
 for(const g of missingPlayers)assert.equal(payload.records.find(r=>r.dataset.bggId===String(g.bggId))!.players,'—');
});
