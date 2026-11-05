import assert from "node:assert/strict";
import test from "node:test";
import { getGames } from "../src/lib/games.ts";
import type { Game } from "../src/lib/game-catalog.ts";
import type { BggGameData, BggRelationLink } from "../src/lib/bgg-types.ts";
import { getCatalogGameType, getGameRelations, getGameSignals } from "../src/lib/game-content.ts";
import { browserCapabilities } from "../src/lib/game-browser-capabilities.ts";
import { readBrowserUrl, writeBrowserUrl } from "../src/lib/game-browser-url.ts";

const catalog = getGames();
const game = (id: number) => {
    const entry = catalog.find(g => g.bggId === id);
    assert.ok(entry?.bgg, `Missing local metadata for ${id}`);
    return entry;
};

test("raw gameType, not isExpansion, controls accessory and unknown classification", () => {
    assert.equal(getCatalogGameType(game(448621).bgg!.gameType), "accessory");
    assert.equal(game(448621).bgg!.isExpansion, false);
    assert.equal(getCatalogGameType("boardgame"), "base");
    assert.equal(getCatalogGameType("boardgameexpansion"), "expansion");
    for (const raw of [undefined, null, "", "future-type"]) assert.equal(getCatalogGameType(raw), "unknown");
});

test("Retaliation links local Stretch Goals internally and uncached Exertion externally", () => {
    const related = getGameRelations(game(381248), catalog, "zh-TW");
    const stretch = related.find(r => r.targetId === 411053 && r.kind === "expansions")!;
    assert.equal(stretch.href, "/games/bgg-411053");
    assert.equal(stretch.internal, true);
    assert.equal(stretch.rawType, "boardgameexpansion");
    assert.equal(stretch.inbound, undefined);
    const exertion = related.find(r => r.targetId === 451355)!;
    assert.equal(exertion.href, "https://boardgamegeek.com/boardgame/451355");
    assert.equal(exertion.internal, false);
    const reverse = getGameRelations(game(411053), catalog, "en").find(r => r.targetId === 381248)!;
    assert.equal(reverse.href, "/en/games/bgg-381248");
    assert.equal(reverse.inbound, true);
    assert.equal(reverse.targetType, "base");
    const implementation = related.find(r => r.targetId === 167355)!;
    assert.equal(implementation.kind, "implementations");
    assert.equal(implementation.rawType, "boardgameimplementation");
    assert.equal(implementation.inbound, true);
});

test("Frosthaven Promo Scenario relations stay external without local detail metadata", () => {
    const relations = getGameRelations(game(295770), catalog, "en");
    for (const id of [450456, 402665, 402666, 453790, 407830]) {
        const relation = relations.find(r => r.targetId === id)!;
        assert.ok(relation);
        assert.equal(relation.internal, false);
        assert.equal(relation.href, `https://boardgamegeek.com/boardgame/${id}`);
    }
});

test("direct duplicates/self loops/invalid IDs are omitted; cycles are one-hop; types and directions stay distinct", () => {
    const a: Game = { ...game(381248), bggId: 1, slug: "one", bgg: {
        ...game(381248).bgg!, expansions: [{ id: 2, name: "Two" }, { id: 2, name: "duplicate" },
            { id: 1, name: "self" }, { id: -1, name: "invalid" }],
        implementations: [{ id: 2, name: "Two", inbound: true }],
        compilations: [{ id: 2, name: "Two", inbound: false }]
    } };
    const b: Game = { bggId: 2, name: "Two", slug: "two", bgg: {
        ...a.bgg!, expansions: [{ id: 1, name: "One", inbound: true }], implementations: [], compilations: []
    } };
    const relations = getGameRelations(a, [a, b], "en");
    assert.equal(relations.length, 4); // three direct observations plus the preserved peer observation
    assert.deepEqual(relations.map(r => r.kind), ["expansions", "implementations", "compilations", "expansions"]);
    assert.deepEqual(relations.map(r => r.inbound), [undefined, true, false, true]);
    assert.ok(relations.every(r => r.targetId === 2));
    assert.equal(relations.filter(r => r.source === "direct").length, 3);
    assert.equal(relations[3].source, "reverse-index");
    assert.deepEqual(relations[0].evidence.rawNames, ["Two", "duplicate"]);
});

test("reverse-only records disclose their original source/direction; pending detail does not get an internal link", () => {
    const a: Game = { ...game(295770), bggId: 1, bgg: { ...game(295770).bgg!, expansions: [], implementations: [], compilations: [] } };
    const b: Game = { ...game(411053), bggId: 2, bgg: { ...game(411053).bgg!,
        expansions: [], implementations: [], compilations: [{ id: 1, name: "One", inbound: true }] } };
    const result = getGameRelations(a, [a, b], "en");
    assert.equal(result[0].source, "reverse-index");
    assert.equal(result[0].rawType, "boardgamecompilation");
    assert.equal(result[0].originId, 2);
    assert.equal(result[0].originalTargetId, 1);
    assert.equal(result[0].inbound, true); // original direction, not an invented inverse
    const missing = { ...a, bgg: { ...a.bgg!, expansions: [{ id: 3, name: "" }] as BggRelationLink[] } };
    const pending = { bggId: 3, name: "", slug: "pending", bgg: null };
    const external = getGameRelations(missing, [missing, pending], "zh-TW")[0];
    assert.equal(external.internal, false);
    assert.equal(external.name, "BGG #3");
    assert.equal(external.inbound, undefined);
});

test("Family and name evidence are separate and never infer exclusivity, price or rewards from prose", () => {
    const frost = getGameSignals(game(295770).bgg);
    assert.ok(frost.some(s => s.source === "family" && s.value === "Crowdfunding: Kickstarter"));
    const stretch = getGameSignals(game(411053).bgg);
    assert.ok(stretch.some(s => s.kind === "stretch-goals-name" && s.source === "name"));
    assert.ok(stretch.some(s => s.value === "Crowdfunding: Gamefound"));
    const promo = getGameSignals(game(284952).bgg);
    assert.ok(promo.some(s => s.kind === "promo-family"));
    assert.ok(promo.some(s => s.kind === "promo-name"));
    const prose: BggGameData = { ...game(295770).bgg!, name: "Ordinary game",
        description: "Kickstarter Exclusive. Free stretch goals and paid add-on.", families: [] };
    assert.deepEqual(getGameSignals(prose), []);
    assert.deepEqual(getGameSignals(null), []);
    assert.ok(stretch.every(s => ["family", "name"].includes(s.source)));
});

test("accessory/unknown URL filters survive roundtrip and remain catalog-only capabilities", () => {
    const profile = browserCapabilities.games;
    for (const type of ["accessory", "unknown"]) {
        const url = new URL(`https://site.invalid/en/games?filter=${type}&sort=year-desc&page=3`);
        const choices = { ...profile, defaultSort: "name-asc", players: [], times: [], weights: [], mechanics: [], mechanicTags: [], categories: [] };
        const state = readBrowserUrl(url, choices);
        assert.equal(state.filter, type);
        assert.equal(readBrowserUrl(writeBrowserUrl(url, state, choices.defaultSort, profile.parameters), choices).filter, type);
    }
});
