import assert from "node:assert/strict";
import test from "node:test";
import cache from "../src/data/bgg-cache.json" with { type: "json" };
import type { BggGameData } from "../src/lib/bgg-types.ts";
import type { CollectionV2Row } from "../src/lib/collection-v2-repository.ts";
import { buildGameCatalog } from "../src/lib/game-catalog.ts";
import { getGames } from "../src/lib/games.ts";
import { adaptCollectionV2Rows } from "../src/lib/collection-v2-adapter.ts";
import { browserCapabilities } from "../src/lib/game-browser-capabilities.ts";
import { readBrowserUrl, writeBrowserUrl } from "../src/lib/game-browser-url.ts";

// Synthetic records are test-only. No records are published or written to a DB.
const basic = Object.values(cache)[0] as BggGameData;
const row = (id: number): CollectionV2Row => ({
    id, game_id: 1, display_name: `Copy ${id}`, item_type: "base",
    acquisition_status: "owned", wishlist: 0, notes: null, record_scope: "production",
    created_at: "", updated_at: "", bgg_id: 1, primary_name: "Catalog game",
    game_type: "base", standalone_status: "unknown", catalog_source: "import"
});

test("cache-only games enter the catalog without creating collection records", () => {
    const catalog = buildGameCatalog({ "1": { ...basic, bggId: 1 }, "2": { ...basic, bggId: 2 } }, [{ bggId: 1 }]);
    const collection = adaptCollectionV2Rows([row(101)]);
    assert.deepEqual(catalog.map(game => game.bggId), [1, 2]);
    assert.equal(catalog.some(game => "collection" in game), false);
    assert.deepEqual(collection.map(record => record.bggId), [1]);
    assert.deepEqual(adaptCollectionV2Rows([]), []);
});

test("two collection records for the same game retain their own identities", () => {
    const records = adaptCollectionV2Rows([row(101), { ...row(102), acquisition_status: "preordered", wishlist: 1 }]);
    assert.equal(records.length, 2);
    assert.deepEqual(records.map(record => record.collectionId), [101, 102]);
    assert.equal(records[0].owned, true);
    assert.equal(records[1].preordered, true);
    assert.equal(records[1].wishlist, true);
});

test("registered games without metadata remain explicit partial entries, not invented details", () => {
    const catalog = buildGameCatalog({}, [{ bggId: 50, name: "Pending", slug: "pending" }, { bggId: 50 }]);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].bgg, null);
    assert.equal(catalog[0].name, "Pending");
    assert.equal(catalog[0].slug, "pending");
});

test("the actual local catalog includes every cached game irrespective of personal imports", () => {
    const ids = new Set(getGames().map(game => game.bggId));
    for (const id of Object.keys(cache)) assert.equal(ids.has(Number(id)), true);
});

test("each module rejects unsupported personal filters and parameters while preserving shared state", () => {
    for (const module of ["games", "collection"] as const) {
        const profile = browserCapabilities[module];
        const choices = { ...profile, defaultSort: "name-asc", players: ["2"], times: ["60"],
            weights: [], mechanics: [], mechanicTags: ["10"], categories: ["20"] };
        const url = new URL("https://test.invalid/?q=遊戲&filter=owned&sort=rating-desc&players=2&page=3&category=20&source=friend");
        const state = readBrowserUrl(url, choices);
        assert.equal(state.filter, module === "games" ? "base" : "owned");
        assert.equal(state.sort, "name-asc");
        assert.equal(state.category, module === "games" ? "" : "20");
        assert.equal(state.q, "遊戲");
        assert.equal(state.page, 3);
        const normalized = writeBrowserUrl(url, state, choices.defaultSort, choices.parameters);
        assert.equal(normalized.searchParams.has("sort"), false);
        assert.equal(normalized.searchParams.get("source"), "friend");
        assert.equal(profile.filters.includes("wantToPlay"), false);
        assert.equal(profile.sorts.includes("rating-desc"), false);
    }
});
