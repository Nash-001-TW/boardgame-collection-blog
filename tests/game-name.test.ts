import assert from "node:assert/strict";
import test from "node:test";
import { decodeGameName } from "../src/lib/game-name.ts";
import { translateGameName } from "../src/i18n/utils.ts";
import { buildGameCatalog } from "../src/lib/game-catalog.ts";
import { formatAdvancedFilterCount } from "../src/i18n/catalog-browser.ts";

test("game display names decode common entities once", () => {
    assert.equal(decodeGameName("Darwin&#039;s Journey / &#39; / &#x27;"), "Darwin's Journey / ' / '");
    assert.equal(decodeGameName("&quot;A&amp;B&quot; &lt;C&gt;"), '"A&B" <C>');
    assert.equal(decodeGameName("&amp;#039;"), "&#039;");
    assert.equal(decodeGameName("Plain & safe"), "Plain & safe");
    for (const lang of ["en", "zh-TW"] as const) {
        assert.equal(translateGameName(99999999, "Darwin&#039;s Journey", lang), "Darwin's Journey");
    }
});

test("display decoding preserves source names and catalog identifiers", () => {
    const catalog = buildGameCatalog({}, [{ bggId: 123, slug: "raw-slug", name: "A&amp;B" }]);
    assert.equal(decodeGameName(catalog[0].name), "A&B");
    assert.deepEqual(catalog[0], { bggId: 123, slug: "raw-slug", name: "A&amp;B", bgg: null });
});

test("advanced count has no zero label and uses the existing language", () => {
    assert.equal(formatAdvancedFilterCount(0, "zh-TW"), "");
    assert.equal(formatAdvancedFilterCount(2, "zh-TW"), "2 項條件");
    assert.equal(formatAdvancedFilterCount(1, "en"), "1 filter");
    assert.equal(formatAdvancedFilterCount(4, "en"), "4 filters");
});
