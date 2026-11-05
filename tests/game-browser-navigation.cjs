// Offline browser integration: all documents/scripts are fulfilled in memory.
// Usage: node tests/game-browser-navigation.cjs [path-to-playwright-module] [browser-executable]
const assert = require("node:assert/strict");
const { build } = require("esbuild");
const { chromium } = require(process.argv[2] || "playwright");

(async () => {
    const bundle = await build({ entryPoints: ["src/lib/game-list-controller.ts"],
        bundle: true, write: false, format: "iife", globalName: "BrowserController", platform: "browser" });
    const browser = await chromium.launch({ headless: true,
        ...(process.argv[3] ? { executablePath: process.argv[3] } : {}) });
    try {
        const page = await browser.newPage();
        const options = (attr, values) => `<select ${attr}>${values.map(v => `<option value="${v}">${v || "Any"}</option>`).join("")}</select>`;
        const fixture = (module = "collection") => `<section data-game-browser data-browser-module="${module}" data-locale="zh-TW">
          <input data-game-search><select data-game-sort><option value="name-asc">Name</option><option value="year-desc">Year</option></select>
          <button data-game-reset>Reset</button>
          ${(module === "games" ? ["all", "base", "expansion", "accessory", "unknown"] : ["all", "owned", "wishlist"]).map(v => `<button data-game-filter="${v}">${v}</button>`).join("")}
          ${options("data-game-players", ["", "2"])}${options("data-game-time", ["", "60"])}
          ${options("data-game-weight", ["", "2-3"])}${options("data-game-mechanic", [""])}
          <button data-tag-chip data-tag-kind="mechanic" data-tag-id="10">Mechanic</button>
          <button data-tag-chip data-tag-kind="category" data-tag-id="20">Category</button>
          ${module === "games" ? `<button data-game-view="grid">Grid</button><button data-game-view="list">List</button><p data-game-effective-type></p>` : ""}<p data-game-result-count></p><div data-game-grid>
          ${Array.from({length: 7}, (_, i) => `<article data-game-card data-item-type="${["accessory", "unknown", "expansion"][i] || "base"}" data-original-name="${i === 2 ? "Stretch Goals Promo" : ""}" data-name="桌遊 ${i}" data-year="${2020+i}" data-owned="true" data-wishlist="${i<4}" data-mechanics="10" data-mechanic-names="Drafting" data-categories="20" data-min-players="1" data-max-players="4" data-max-time="60" data-weight="2.5"><a href="/detail">Game ${i}</a></article>`).join("")}
          </div><nav data-game-pagination></nav></section>
          <script src="/controller.js"></script>`;
        await page.route("**/*", route => {
            const url = new URL(route.request().url());
            if (url.hostname !== "bgg.test") return route.abort();
            return route.fulfill({ contentType: url.pathname === "/controller.js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8",
                body: url.pathname === "/controller.js" ? bundle.outputFiles[0].text + '\nBrowserController.initializeGameListController({root:document.querySelector("[data-game-browser]"),pageSize:2,debounceMs:10});' :
                    url.pathname === "/detail" ? "<h1>Offline detail fixture</h1>" : fixture(url.pathname.endsWith('/games') ? "games" : "collection") });
        });
        const visible = () => page.locator("[data-game-grid] [data-game-card]").count();
        await page.goto("http://bgg.test/collection?filter=owned&sort=year-desc&page=2&source=friend#list");
        await page.waitForFunction(() => document.querySelector("[data-game-pagination]").textContent.includes("2 / 4"));
        assert.equal(await visible(), 2);
        assert.equal(await page.locator("[data-game-sort]").inputValue(), "year-desc");
        await page.reload();
        await page.waitForFunction(() => document.querySelector("[aria-current=page]")?.textContent === "2");
        await page.locator("[data-game-grid] a").first().click();
        await page.goBack();
        await page.waitForFunction(() => document.querySelector("[aria-current=page]")?.textContent === "2");

        await page.locator('[data-game-filter="wishlist"]').click();
        await page.waitForURL(/filter=wishlist/);
        assert.equal(new URL(page.url()).searchParams.has("page"), false);
        await page.goBack();
        assert.equal(await page.locator('[data-game-filter="owned"]').getAttribute("aria-pressed"), "true");
        await page.goForward();
        assert.equal(await page.locator('[data-game-filter="wishlist"]').getAttribute("aria-pressed"), "true");
        await page.locator('[data-tag-kind="category"]').click();
        await page.waitForURL(/category=20/);
        await page.reload();
        assert.equal(await page.locator('[data-tag-kind="category"]').getAttribute("aria-pressed"), "true");

        await page.locator("[data-game-search]").fill("不存在");
        await page.waitForURL(/q=/);
        assert.equal(await visible(), 0);
        await page.locator("[data-game-reset]").click();
        const reset = new URL(page.url());
        assert.equal(reset.search, "?source=friend");
        assert.equal(reset.hash, "#list");
        assert.equal(await visible(), 2);

        // Cancelling a debounce via sort must not reset a later page on pagehide.
        await page.evaluate(() => {
            const input = document.querySelector("[data-game-search]");
            input.value = "桌遊";
            input.dispatchEvent(new Event("input"));
            document.querySelector("[data-game-sort]").dispatchEvent(new Event("change"));
            [...document.querySelectorAll("[data-game-pagination] button")]
                .find(button => button.textContent === "2").click();
        });
        await page.locator("[data-game-grid] a").first().click();
        await page.goBack();
        await page.waitForFunction(() => document.querySelector("[aria-current=page]")?.textContent === "2");

        await page.goto("http://bgg.test/en/collection?filter=bad&players=99&page=999");
        await page.waitForFunction(() => document.querySelector("[aria-current=page]")?.textContent === "4");
        assert.equal(new URL(page.url()).search, "?page=4");
        await page.locator("[data-game-players]").selectOption("2");
        await page.waitForURL(/players=2/);

        await page.goto("http://bgg.test/games?filter=owned&sort=rating-desc&category=20&page=999&source=friend");
        await page.waitForFunction(() => document.querySelector("[aria-current=page]")?.textContent === "2");
        assert.equal(new URL(page.url()).search, "?source=friend&page=2");
        assert.equal(await page.locator('[data-game-filter="owned"]').count(), 0);
        await page.locator('[data-game-filter="accessory"]').click();
        await page.waitForURL(/filter=accessory/);
        assert.equal(await visible(), 1);
        assert.equal(await page.locator('[data-game-grid] [data-game-card]').getAttribute('data-item-type'), 'accessory');
        await page.reload();
        assert.equal(await page.locator('[data-game-filter="accessory"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await visible(), 1);
        await page.locator('[data-game-filter="base"]').click();
        assert.equal(await page.locator('[data-game-grid] [data-item-type="accessory"]').count(), 0);
        await page.goBack();
        assert.equal(await page.locator('[data-game-filter="accessory"]').getAttribute('aria-pressed'), 'true');
        await page.goForward();
        assert.equal(await page.locator('[data-game-filter="base"]').getAttribute('aria-pressed'), 'true');
        await page.locator('[data-game-filter="unknown"]').click();
        assert.equal(await visible(), 1);
        assert.equal(await page.locator('[data-game-grid] [data-game-card]').getAttribute('data-item-type'), 'unknown');
        await page.goto("http://bgg.test/games");
        assert.equal(await page.locator('[data-game-filter="base"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('[data-game-grid] [data-item-type="accessory"]').count(), 0);
        await page.locator('[data-game-search]').fill('Stretch Goals');
        await page.waitForURL(/q=/);
        assert.equal(await visible(), 1);
        assert.equal(await page.locator('[data-game-grid] [data-game-card]').getAttribute('data-item-type'), 'expansion');
        assert.match(await page.locator('[data-game-effective-type]').textContent(), /全部類型/);
        assert.equal(new URL(page.url()).searchParams.has('filter'), false);
        await page.reload();
        assert.equal(await visible(), 1);
        await page.locator('[data-game-search]').fill('');
        await page.waitForFunction(() => document.querySelector('[data-game-filter="base"]').getAttribute('aria-pressed') === 'true');
        await page.locator('[data-game-filter="expansion"]').click();
        await page.locator('[data-game-search]').fill('桌遊');
        await page.waitForURL(/q=/);
        assert.equal(await visible(), 1);
        assert.match(await page.locator('[data-game-effective-type]').textContent(), /擴充/);
        await page.locator('[data-game-search]').fill('');
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('q'));
        assert.equal(await page.locator('[data-game-filter="expansion"]').getAttribute('aria-pressed'), 'true');
        await page.locator('[data-game-filter="all"]').click();
        await page.getByRole('button', {name: '2', exact:true}).click();
        const beforeView = await page.locator('[data-game-grid] [data-game-card]').evaluateAll(cards => cards.map(card => card.dataset.name));
        await page.locator('[data-game-view="list"]').click();
        assert.equal(new URL(page.url()).searchParams.get('view'), 'list');
        assert.equal(new URL(page.url()).searchParams.get('page'), '2');
        assert.deepEqual(await page.locator('[data-game-grid] [data-game-card]').evaluateAll(cards => cards.map(card => card.dataset.name)), beforeView);
        await page.reload();
        assert.equal(await page.locator('[data-game-browser]').getAttribute('data-view'), 'list');
        await page.locator('[data-game-view="grid"]').click();
        await page.goBack();
        assert.equal(await page.locator('[data-game-browser]').getAttribute('data-view'), 'list');
        await page.goForward();
        assert.equal(await page.locator('[data-game-browser]').getAttribute('data-view'), 'grid');
        await page.locator('[data-game-reset]').click();
        assert.equal(await page.locator('[data-game-filter="base"]').getAttribute('aria-pressed'), 'true');
        await page.goto("http://bgg.test/collection");
        // History API failure must not disable browsing or silently imply URL persistence.
        await page.evaluate(() => { history.pushState = () => { throw new Error("fixture"); }; });
        await page.locator('[data-game-filter="wishlist"]').click();
        assert.equal(await page.locator('[role="status"]').isVisible(), true);
        assert.equal(await visible(), 2);
        console.log("PASS: URL restore, reload, detail return, back/forward, tags, empty/reset, parameter validation, page clamp, history failure; no network services used");
    } finally { await browser.close(); }
})().catch(error => { console.error("FAIL: offline browser navigation test", error); process.exitCode = 1; });
