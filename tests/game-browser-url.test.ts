import assert from "node:assert/strict";
import test from "node:test";
import { readBrowserUrl, writeBrowserUrl } from "../src/lib/game-browser-url.ts";

const choices = {
    defaultSort: "name-asc", filters: ["all", "owned", "wishlist"],
    sorts: ["name-asc", "year-desc"], players: ["", "2", "6plus"],
    times: ["", "60"], weights: ["", "2-3"], mechanics: ["", "10"],
    mechanicTags: ["10"], categories: ["20"]
};

test("round trip Chinese search and all supported filters without losing unrelated URL data", () => {
    const url = new URL("https://example.test/en/games?campaign=abc&q=桌遊&filter=wishlist&sort=year-desc&players=2&time=60&weight=2-3&mechanic=10&tagMechanic=10&category=20&page=3#list");
    const state = readBrowserUrl(url, choices);
    const output = writeBrowserUrl(url, state, choices.defaultSort);
    assert.deepEqual(readBrowserUrl(output, choices), state);
    assert.equal(state.q, "桌遊");
    assert.equal(state.page, 3);
    assert.equal(output.pathname, "/en/games");
    assert.equal(output.hash, "#list");
    assert.equal(output.searchParams.get("campaign"), "abc");
});

test("unknown options and malformed pages fall back rather than hiding all games", () => {
    for (const page of ["0", "-1", "2.5", "1e3", "Infinity", "999999999999999999999"]) {
        const state = readBrowserUrl(new URL(`https://example.test/?filter=bad&sort=bad&players=99&category=30&page=${page}`), choices);
        assert.equal(state.filter, "all");
        assert.equal(state.sort, "name-asc");
        assert.equal(state.players, "");
        assert.equal(state.category, "");
        assert.equal(state.page, 1);
    }
});

test("reset removes only owned keys and omits defaults", () => {
    const url = new URL("https://example.test/collection?q=old&q=duplicate&page=4&category=20&source=friend#top");
    const defaults = readBrowserUrl(new URL("https://example.test"), choices);
    const output = writeBrowserUrl(url, defaults, choices.defaultSort);
    assert.equal(output.href, "https://example.test/collection?source=friend#top");
});

test("search is bounded and values remain URL-encoded data", () => {
    const url = new URL("https://example.test");
    url.searchParams.set("q", "  " + "遊".repeat(250) + "  ");
    assert.equal(readBrowserUrl(url, choices).q.length, 200);
    url.searchParams.set("q", "<script>&=#中文");
    const state = readBrowserUrl(url, choices);
    assert.equal(readBrowserUrl(writeBrowserUrl(url, state, choices.defaultSort), choices).q, state.q);
});
