import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { transform } from "@astrojs/compiler-rs";
import { experimental_AstroContainer } from "astro/container";
import { getGames } from "../src/lib/games.ts";
import { adaptCollectionV2Rows } from "../src/lib/collection-v2-adapter.ts";
import type { CollectionV2Row } from "../src/lib/collection-v2-repository.ts";

// Render pure Astro components without loading the site config/adapter or remote resources.
async function component(file: string) {
    const result = await build({ entryPoints: [file], bundle: true, write: false,
        platform: "node", format: "cjs", packages: "external", plugins: [{ name: "astro-fixture",
            setup(builder) {
                builder.onLoad({ filter: /\.astro$/ }, async args => {
                    const compiled = await transform(await readFile(args.path, "utf8"), {
                        filename: args.path.replaceAll("\\", "/"), internalURL: "astro/compiler-runtime", resultScopedSlot: true,
                        resolvePath: specifier => specifier
                    });
                    return { contents: compiled.code.replace(/^import ["'][^"']+\?astro&type=style[^"']*["'];?$/gm, ""), loader: "ts" };
                });
            }
        }] });
    const module = { exports: {} as { default: Parameters<experimental_AstroContainer["renderToString"]>[0] } };
    new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
    return module.exports.default;
}

test('collection component renders distinct synthetic copies without database access', async () => {
    const row = (id: number): CollectionV2Row => ({
        id, game_id: 1, display_name: `Synthetic copy ${id}`, item_type: 'base',
        acquisition_status: 'owned', wishlist: 0, notes: null, record_scope: 'production',
        created_at: '', updated_at: '', bgg_id: 205637, primary_name: 'Synthetic game',
        game_type: 'base', standalone_status: 'unknown', catalog_source: 'import'
    });
    const collectionGames = adaptCollectionV2Rows([row(7001), { ...row(7002), acquisition_status: 'preordered', wishlist: 1 }]);
    const container = await experimental_AstroContainer.create();
    const Collection = await component('src/components/CollectionPage.astro');
    for (const lang of ['zh-TW', 'en'] as const) {
        const html = await container.renderToString(Collection, { props: { lang, collectionGames } });
        assert.equal((html.match(/data-collection-id=/g) ?? []).length, 2);
        assert.match(html, /data-collection-id="7001"/);
        assert.match(html, /data-collection-id="7002"/);
        assert.match(html, /data-wishlist="true"/);
        assert.match(html, /data-preorder="true"/);
    }
});

test("actual Astro relation markup hides technical evidence and chooses local/external links", async () => {
    const container = await experimental_AstroContainer.create();
    const catalog = getGames();
    const game = catalog.find(game => game.bggId === 381248)!;
    const html = await container.renderToString(await component("src/components/GameRelations.astro"), {
        props: { game, catalog, lang: "en" }
    });
    assert.match(html, /href="\/en\/games\/bgg-411053"/);
    assert.match(html, /href="https:\/\/boardgamegeek.com\/boardgame\/451355"[^>]*target="_blank"/);
    assert.match(html, /Version relation/);
    assert.match(html, /class="relation-id"[^>]*>BGG #411053/);
    assert.match(html, /Game name or #BGG ID/);
    assert.doesNotMatch(html, /inbound|directionStatus|directionBasis|reverse-index|boardgameimplementation|boardgameexpansion/);
    assert.doesNotMatch(html, /href="\/en\/games\/bgg-451355"/);
});

test('detail exposes source families as safe metadata and omits an empty family row',async()=>{
 const original=getGames().find(game=>game.bggId===205637)!;
 const container=await experimental_AstroContainer.create(),Detail=await component('src/components/GameDetail.astro');
 for(const lang of ['zh-TW','en'] as const){
  const game={...original,bgg:{...original.bgg!,families:[{id:1,name:'Game: A &amp; B'},{id:2,name:'&lt;img src=x onerror=alert(1)&gt;'}]}};
  const html=await container.renderToString(Detail,{props:{game,lang}});
  assert.ok(html.includes(lang==='en'?'BGG families':'BGG 家族分類'));
  assert.match(html,/Game: A &amp; B/);assert.doesNotMatch(html,/Game: A &amp;amp; B/);
  assert.match(html,/&lt;img src=x/);assert.doesNotMatch(html,/<img src=x/);
  const empty=await container.renderToString(Detail,{props:{game:{...game,bgg:{...game.bgg,families:[]}},lang}});
  assert.ok(!empty.includes(lang==='en'?'BGG families':'BGG 家族分類'));
 }
});

test("actual Astro signal markup labels Family versus name and explicitly limits the claim", async () => {
    const container = await experimental_AstroContainer.create();
    const game = getGames().find(game => game.bggId === 411053)!.bgg;
    const html = await container.renderToString(await component("src/components/GameSignals.astro"), {
        props: { game, lang: "zh-TW" }
    });
    assert.match(html, /BGG Family/);
    assert.match(html, /名稱線索/);
    assert.match(html, /Crowdfunding: Gamefound/);
    assert.match(html, /Stretch Goals/);
    assert.match(html, /不代表限定品、免費獎勵或付費加購/);
});

test("compact signals show at most two hints while detailed signals retain all evidence sources", async () => {
    const container = await experimental_AstroContainer.create();
    const sample = { ...getGames().find(game => game.bggId === 411053)!.bgg!, name: "Promo Stretch Goals",
        families: [{ id: 1, name: "Promotional: Cards" }, { id: 2, name: "Crowdfunding: Gamefound" }] };
    const view = await component("src/components/GameSignals.astro");
    const compact = await container.renderToString(view, { props: { game: sample, lang: "en", compact: true } });
    const full = await container.renderToString(view, { props: { game: sample, lang: "en" } });
    assert.equal(compact.match(/data-signal-kind=/g)?.length, 2);
    assert.equal(full.match(/data-signal-kind=/g)?.length, 4);
    assert.match(compact, /BGG Family/);
    assert.match(full, /Name hint/);
    assert.match(full, /not confirmation of exclusivity/);
});

test("actual catalog controls use count-free type navigation and collapsed advanced filters", async () => {
    const container = await experimental_AstroContainer.create();
    const html = await container.renderToString(await component("src/components/CatalogBrowserControls.astro"), {
        props: { lang: "en", module: "games", typeCounts: { all: 9, base: 4, expansion: 3, accessory: 1, unknown: 1 } }
    });
    assert.match(html, /data-game-filter="base"[^>]*aria-pressed="true"/);
    assert.doesNotMatch(html, /data-game-type-advanced|type-count/);
    assert.match(html, /<details[^>]*data-game-advanced/);
    assert.match(html, /data-game-filter="unknown"/);
    assert.match(html, /data-game-view="list"/);
});

test("catalog page computes counts from its own entries and keeps non-base entries available", async () => {
    const catalog = getGames();
    const games = [295770, 411053, 448621].map(id => catalog.find(game => game.bggId === id)!);
    games.push({ bggId: 999999, slug: "pending-test-only", name: "Pending test entry", bgg: null });
    const container = await experimental_AstroContainer.create();
    const html = await container.renderToString(await component("src/components/GameList.astro"), {
        props: { games, lang: "en" }
    });
    assert.equal((html.match(/<img\b/g)??[]).length,1);
    assert.match(html, /data-loading-mode="progressive"/);
    assert.match(html, /"itemType":"unknown"/);
    assert.match(html, /href="\/en\/games\/frosthaven"/);
    assert.match(html, /href="\/en\/games\/bgg-411053"/);
});

test("advanced header contains its hidden clear action and no time explanation in either language", async () => {
    const container = await experimental_AstroContainer.create();
    const view = await component("src/components/CatalogBrowserControls.astro");
    for (const lang of ["en", "zh-TW"]) {
        const html = await container.renderToString(view, { props: { lang, module: "games" } });
        assert.match(html, /<summary[\s\S]*data-game-advanced-summary[^>]*hidden[\s\S]*data-game-clear-advanced[^>]*hidden[\s\S]*<\/summary>/);
        assert.match(html, /data-game-time/);
        assert.doesNotMatch(html, /依 BGG 最長|120 分鐘歸入|unknown time|maximum playing time/i);
    }
});

test("decoded catalog names remain safe Astro text, never injected markup", async () => {
    const container = await experimental_AstroContainer.create();
    const html = await container.renderToString(await component("src/components/GameList.astro"), {
        props: { games: [{ bggId: 99999999, slug: "safe-name", name: 'Darwin&#039;s &amp; &lt;img src=x onerror=alert(1)&gt;', bgg: null }], lang: "en" }
    });
    assert.match(html, /Darwin&#39;s|Darwin's/);
    assert.match(html, /&lt;img src=x/);
    assert.doesNotMatch(html, /<h2[^>]*>[^<]*<img|Darwin&amp;#039;/);
    assert.match(html, /"bggId":"99999999"/);
});

test("navigation only prefetches the localized catalog from other sections", async () => {
    const container = await experimental_AstroContainer.create();
    const header = await component("src/components/Header.astro");
    for (const [lang, home, games] of [["zh-TW", "/", "/games"], ["en", "/en", "/en/games"]]) {
        const html = await container.renderToString(header, { request: new Request(`http://bgg.test${home}`), props: { lang } });
        const links = html.match(/<a\b[^>]*data-astro-prefetch="load"[^>]*>/g) ?? [];
        assert.equal(links.length, 2); // mobile and desktop, same target
        for (const link of links) assert.ok(link.includes(`href="${games}"`));
        const current = await container.renderToString(header, { request: new Request(`http://bgg.test${games}`), props: { lang } });
        assert.doesNotMatch(current, /data-astro-prefetch="load"/);
    }
});

test("catalog SSR renders only 24 default cards with an inert full index and no-JS links", async()=>{
    const container=await experimental_AstroContainer.create();
    const html=await container.renderToString(await component('src/components/GameList.astro'),{props:{games:getGames(),lang:'en'}});
    const grid=html.match(/<div class="game-grid"[^>]*>([\s\S]*?)<nav data-game-pagination/)![1];
    assert.equal((grid.match(/data-game-card/g)??[]).length,24);
    assert.equal((grid.match(/<img\b/g)??[]).length,24);
    const json=html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/)![1];
    assert.equal(JSON.parse(json).records.length,getGames().length);
    assert.ok(!json.includes('<'));
    assert.ok(html.includes('Complete game catalog'));
    assert.ok(html.includes('href="/en/games/frosthaven"'));
});

test('detail empty fields and malicious description remain safe readable text',async()=>{
    const sample=getGames()[0];
    const game={...sample,bggId:9999999,bgg:{...sample.bgg!,bggId:9999999,image:undefined,thumbnail:undefined,
        name:'Long &amp; safe &lt;title&gt;',description:'<script>window.bad=1</script><p>Safe &amp; sound</p>&lt;img src=x onerror=alert(1)&gt;',
        year:0,minPlayers:0,maxPlayers:0,minPlayTime:0,maxPlayTime:0,bestPlayerCounts:[],minAge:undefined,averageWeight:undefined,
        averageRating:undefined,bggRating:undefined,usersRated:undefined,overallRank:undefined,categoryRanks:[],
        designers:[],artists:[],publishers:[],categories:[],mechanics:[],expansions:[],implementations:[],compilations:[]}};
    const container=await experimental_AstroContainer.create();
    const html=await container.renderToString(await component('src/components/GameDetail.astro'),{props:{game,lang:'en'}});
    assert.ok(html.includes('No cover available'));assert.ok(html.includes('No sleeve data available'));
    assert.ok(html.includes('Safe &amp; sound'));assert.ok(!html.includes('window.bad=1'));
    assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('NaN'));
});

test('detail complexity omits numeric value and classification for every invalid rating in both languages',async()=>{
    const actual=getGames().find(g=>g.bggId===226690)!;
    const container=await experimental_AstroContainer.create(),Detail=await component('src/components/GameDetail.astro');
    for(const lang of ['zh-TW','en'] as const)for(const value of [null,undefined,0,-1,NaN,Infinity,5.01,0.99]){
        const game={...actual,bgg:{...actual.bgg!,averageWeight:value as number,complexity:'Light' as const}};
        const html=await container.renderToString(Detail,{props:{game,lang}});
        const quick=html.slice(html.indexOf('class="quick-stats'),html.indexOf('class="ratings'));
        const values=[...quick.matchAll(/<strong[^>]*>(.*?)<\/strong>/gs)].map(m=>m[1]);
        assert.equal(values.at(-1),'—');assert.doesNotMatch(quick,/<small\b/);
    }
});

test('valid detail scores retain numeric formatting and the existing classification thresholds',async()=>{
    const actual=getGames().find(g=>g.bggId===226690)!;
    const container=await experimental_AstroContainer.create(),Detail=await component('src/components/GameDetail.astro');
    const {translateBggComplexity}=await import('../src/i18n/utils.ts');
    const cases=[[1,'Light'],[1.49,'Light'],[1.5,'Medium Light'],[2,'Medium Light'],[2.5,'Medium'],[3,'Medium'],[3.5,'Medium Heavy'],[4,'Medium Heavy'],[4.5,'Heavy'],[5,'Heavy']] as const;
    for(const lang of ['zh-TW','en'] as const)for(const [averageWeight,complexity] of cases){
        const game={...actual,bgg:{...actual.bgg!,averageWeight,complexity}};
        const html=await container.renderToString(Detail,{props:{game,lang}});
        const quick=html.slice(html.indexOf('class="quick-stats'),html.indexOf('class="ratings'));
        assert.ok(quick.includes(`${averageWeight.toFixed(2)} / 5`));assert.ok(quick.includes(translateBggComplexity(complexity,lang)));assert.match(quick,/<small\b/);
    }
});


test('C4 detail defers full-size dialog image and relation thumbnails reserve space',async()=>{
    const container=await experimental_AstroContainer.create();
    const html=await container.renderToString(await component('src/components/GameDetail.astro'),{props:{game:getGames().find(g=>g.bggId===205637)!,lang:'en'}});
    const dialog=html.slice(html.indexOf('<dialog'),html.indexOf('</dialog>'));
    assert.match(dialog,/data-dialog-cover/);assert.match(dialog,/data-src=/);assert.doesNotMatch(dialog,/<img[^>]*\ssrc=/);
    assert.match(html,/data-cover-error-label="Image unavailable"/);
    assert.match(html,/loading="lazy" decoding="async" width="42" height="55"/);
});


test('C4 missing catalog image URL renders a stable text placeholder without an image request',async()=>{
    const original=getGames().find(g=>g.bggId===205637)!;
    const game={...original,bgg:{...original.bgg!,thumbnail:'',image:''}};
    const container=await experimental_AstroContainer.create();
    const html=await container.renderToString(await component('src/components/GameList.astro'),{props:{games:[game],lang:'en'}});
    assert.match(html,/No cover available/);assert.doesNotMatch(html,/<img\b/);
});
