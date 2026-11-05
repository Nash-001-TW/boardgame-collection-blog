import assert from "node:assert/strict";
import test from "node:test";
import { browserCapabilities } from "../src/lib/game-browser-capabilities.ts";
import { readBrowserUrl, writeBrowserUrl, getEffectiveBrowserFilter } from "../src/lib/game-browser-url.ts";
import { matchesCatalogSearch, validCatalogStatistic, catalogRange } from '../src/lib/catalog-browsing.ts';

const profile = browserCapabilities.games;
const choices = { ...profile, defaultSort: "name-asc", players: [], times: [], weights: [],
    mechanics: [], mechanicTags: [], categories: [] };
const read = (query = "") => readBrowserUrl(new URL(`https://site.invalid/games${query}`), choices);

test('catalog search supports exact #ID, ordinary numeric/name substrings and safe decoded text',()=>{
 const row={bggId:'205637',name:'詭鎮奇談',originalName:"Arkham Horror: Darwin's & Journey"};
 for(const query of [' #205637 ','205637','2056',' ARKHAM ','詭鎮',"Darwin's &",''])assert.equal(matchesCatalogSearch(row,query),true);
 for(const query of ['#2056','#359609','AHC01'])assert.equal(matchesCatalogSearch(row,query),false);
 const same=[row,{...row,bggId:'359609'}];
 assert.equal(same.filter(r=>matchesCatalogSearch(r,'Arkham')).length,2);
 assert.equal(same.filter(r=>matchesCatalogSearch(r,'#359609')).length,1);
});
test('catalog missing statistics and ranges are never represented by zero or NaN',()=>{
 for(const value of [undefined,null,0,-1,NaN,Infinity])for(const field of ['year','rating'] as const)assert.equal(validCatalogStatistic(value,field),null);
 assert.equal(validCatalogStatistic(2020,'year'),2020);assert.equal(validCatalogStatistic(7.5,'rating'),7.5);
 assert.equal(validCatalogStatistic(11,'rating'),null);
 assert.equal(catalogRange(0,0),'—');assert.equal(catalogRange(undefined,4),'—');assert.equal(catalogRange(4,2),'—');assert.equal(catalogRange(2,Infinity),'—');
 assert.equal(catalogRange(1,4),'1–4');assert.equal(catalogRange(2,2),'2');
});

test("first visit defaults to base; searching all types does not overwrite the remembered selection", () => {
    const state = read();
    assert.equal(state.filter, "base");
    assert.equal(state.filterExplicit, false);
    assert.equal(getEffectiveBrowserFilter(state, true), "base");
    state.q = "Stretch Goals";
    assert.equal(getEffectiveBrowserFilter(state, true), "all");
    assert.equal(state.filter, "base");
    state.q = "";
    assert.equal(getEffectiveBrowserFilter(state, true), "base");
});

test("explicit base/all/expansion selections survive sharing and clearing search", () => {
    for (const filter of ["base", "all", "expansion", "accessory", "unknown"]) {
        const state = read(`?filter=${filter}&q=Promo&view=list&page=2`);
        assert.equal(state.filterExplicit, true);
        assert.equal(getEffectiveBrowserFilter(state, true), filter);
        const url = writeBrowserUrl(new URL("https://site.invalid/games"), state, "name-asc", profile.parameters, profile.defaultFilter);
        assert.equal(url.searchParams.get("filter"), filter);
        assert.deepEqual(readBrowserUrl(url, choices), state);
        state.q = "";
        assert.equal(getEffectiveBrowserFilter(state, true), filter);
    }
});

test("implicit search URLs remain automatic while explicit all is distinct", () => {
    const state = read("?q=Promo&view=list");
    const url = writeBrowserUrl(new URL("https://site.invalid/games?source=friend#list"), state, "name-asc", profile.parameters, profile.defaultFilter);
    assert.equal(url.searchParams.has("filter"), false);
    assert.equal(url.searchParams.get("view"), "list");
    assert.equal(url.hash, "#list");
    assert.equal(getEffectiveBrowserFilter(readBrowserUrl(url, choices), true), "all");
    assert.equal(read("?filter=all").filterExplicit, true);
});

test("bad view/type inputs normalize safely; collection keeps its existing default and grid-only view", () => {
    const state = read("?filter=bad&view=bad");
    assert.equal(state.filter, "base");
    assert.equal(state.filterExplicit, false);
    assert.equal(state.view, "grid");
    const collection = readBrowserUrl(new URL("https://site.invalid/collection?q=Promo&view=list"), {
        ...choices, ...browserCapabilities.collection
    });
    assert.equal(collection.view, "grid");
    assert.equal(getEffectiveBrowserFilter(collection, false), "all");
});
