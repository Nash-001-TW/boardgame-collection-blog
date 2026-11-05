import assert from "node:assert/strict";
import test from "node:test";
import { matchesPlayingTime, getKnownExpansionCounts } from "../src/lib/catalog-browsing.ts";
import { getGames } from "../src/lib/games.ts";
import type { Game } from "../src/lib/game-catalog.ts";

test("time buckets are disjoint on maximum duration; legacy cumulative filters still work", () => {
    for (const [max, expected] of [[30,"30"],[31,"31-60"],[60,"31-60"],[61,"61-120"],[120,"61-120"],[121,"over120"]] as const) {
        assert.deepEqual(["30","31-60","61-120","over120"].filter(mode => matchesPlayingTime(max, mode)), [expected]);
    }
    for (const value of [null, 0, -1, NaN]) assert.equal(matchesPlayingTime(value, "30"), false);
    assert.equal(matchesPlayingTime(45, "60"), true);
    assert.equal(matchesPlayingTime(75, "90"), true);
});

test("expansion counts deduplicate directional relations, not Promo/platform text or unrelated types", () => {
    const basic = getGames().find(game => game.bggId === 295770)!;
    const parent: Game = { ...basic, bggId: 1, bgg: { ...basic.bgg!,
        expansions: [{id:2,name:"Uncached",inbound:false},{id:2,name:"duplicate",inbound:false},
            {id:1,name:"self",inbound:false},{id:3,name:"Promo with unknown direction"},{id:4,name:"parent",inbound:true}],
        implementations: [{id:5,name:"Implementation",inbound:false}], compilations: [] } };
    const child: Game = { ...parent, bggId:6, bgg: { ...parent.bgg!, gameType:"boardgameexpansion",
        expansions:[{id:1,name:"base",inbound:true}], implementations:[] } };
    assert.equal(getKnownExpansionCounts([parent,child]).get(1), 2); // uncached 2 + verified reverse 6
    assert.equal(getKnownExpansionCounts([{...parent,bgg:{...parent.bgg!,expansions:[]}}]).get(1), undefined);
});
