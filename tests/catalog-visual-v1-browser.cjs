// Run with node --import tsx; all requests are intercepted, including cover images.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.argv[2] || "playwright");

(async () => {
    const { createLocalGamesPreview } = await import("../scripts/lib/local-games-preview.ts");
    const preview = await createLocalGamesPreview();
    const browser = await chromium.launch({ headless: true, ...(process.argv[3] ? { executablePath:process.argv[3] } : {}) });
    const output = fs.mkdtempSync(path.join(process.argv[4] || os.tmpdir(), "games-v1-"));
    try {
        const context = await browser.newContext({ viewport:{width:1280,height:800} });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", error => { errors.push(error.message); console.error("Browser error:", error.message); });
        const covers = new Map();
        let failedFirstCover = false;
        const routeRequest = async route => {
            const url = new URL(route.request().url());
            if (route.request().resourceType() === "image") {
                if (!failedFirstCover) { failedFirstCover=true; return route.abort(); }
                if (!covers.has(url.href)) covers.set(url.href, covers.size % 3);
                const [width,height] = [[300,500],[500,250],[320,320]][covers.get(url.href)];
                return route.fulfill({contentType:"image/svg+xml",body:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#a9c8dc"/><text x="15" y="40" font-size="22">${width} × ${height}</text></svg>`});
            }
            if (url.hostname !== "bgg.test") return route.abort();
            if (url.pathname === "/preview-games.js") return route.fulfill({contentType:"text/javascript; charset=utf-8",body:preview.javascript});
            const html = await preview.html(url);
            return route.fulfill({status:html ? 200 : 404,contentType:"text/html; charset=utf-8",body:html || "Not found"});
        };
        await context.route("**/*", routeRequest);
        // Deterministic manual-fallback phase; actual IntersectionObserver is tested separately below.
        await page.addInitScript(() => { window.IntersectionObserver = undefined; });
        await page.goto("http://bgg.test/games");
        await page.waitForFunction(() => document.querySelector('[data-game-grid]')?.children.length === 24);
        const grid = page.locator("[data-game-grid]");
        assert.equal(await page.locator('[data-game-card]').count(),24);
        assert.equal(await page.locator('[data-catalog-payload]').count(),0);
        assert.equal(await grid.locator("img").count(), 24);
        assert.equal(await grid.locator('img[loading="eager"]').count(),4);
        assert.equal(await grid.locator('img[loading="lazy"]').count(),20);
        await page.waitForFunction(()=>[...document.querySelectorAll('[data-game-grid] [data-game-card]')].some(card=>card.dataset.imageFallback && card.querySelector('img')?.getAttribute('src')===card.dataset.imageFallback && card.querySelector('img')?.naturalWidth>0));
        assert.equal(await page.locator('[data-game-filter="base"]').getAttribute("aria-pressed"), "true");
        assert.equal(await page.locator("[data-game-type-advanced]").count(), 0);
        assert.equal(await page.locator("[data-game-advanced]").getAttribute("open"), null);
        assert.equal(await page.locator('[data-game-clear-advanced]').isVisible(),false);
        assert.equal(await page.locator('[data-game-advanced-summary]').isVisible(),false);
        assert.equal(await grid.locator(".list-only:visible").count(), 0);
        await page.waitForFunction(() => [...document.querySelectorAll('[data-game-grid] img')].slice(0,3).every(img => img.naturalWidth > 0));
        assert.ok(await grid.locator('img').evaluateAll(images => images.every(image=>getComputedStyle(image).objectFit==='contain')));
        const loadedCovers = await grid.locator('[data-image-loaded="true"]').evaluateAll(shells => shells.map(shell => {
            const image = shell.querySelector('img');
            return { shellHeight:shell.getBoundingClientRect().height, imageHeight:image.getBoundingClientRect().height,
                fit:getComputedStyle(image).objectFit };
        }));
        assert.ok(loadedCovers.length >= 3);
        assert.ok(loadedCovers.every(cover => cover.shellHeight>=cover.imageHeight-1 && cover.fit==='contain'));
        assert.ok(loadedCovers.every(cover=>cover.shellHeight>0));
        assert.equal(await grid.locator(".game-card").evaluateAll(cards => cards.every(card => !card.style.gridRowEnd)), true);
        if(process.env.C4_SCREENSHOTS)await page.screenshot({path:path.join(output,"desktop-grid.png"),fullPage:false});
        const historyBefore = await page.evaluate(()=>history.length);
        const firstCard=await grid.locator('[data-game-card]').first().elementHandle();
        await page.locator("[data-load-more]").click();
        await page.waitForFunction(()=>document.querySelector('[data-game-grid]').children.length===48);
        assert.equal(await firstCard.evaluate(card=>card===document.querySelector('[data-game-grid] [data-game-card]')),true);
        assert.equal(await page.evaluate(()=>history.length), historyBefore);
        assert.equal(new URL(page.url()).searchParams.get("page"), "2");
        assert.equal(await grid.locator("[data-game-card]").evaluateAll(cards => new Set(cards.map(c=>c.dataset.bggId)).size),48);
        // Simulate one local render failure and verify a user-operable retry.
        await page.evaluate(()=>{
            const original = document.createElement.bind(document);
            document.createElement = function(name,...args) { if(name==='img'){document.createElement=original;throw new Error('test-only render failure');} return original(name,...args); };
        });
        await page.locator("[data-load-more]").click();
        await page.waitForFunction(()=>document.querySelector('[data-load-status]').textContent.includes('載入失敗'));
        assert.equal(new URL(page.url()).searchParams.get("page"),"2");
        await page.locator("[data-load-more]").click();
        await page.waitForFunction(()=>document.querySelector('[data-game-grid]').children.length===72);

        await page.locator("[data-game-search]").fill("Stretch Goals");
        await page.waitForFunction(()=>document.querySelector('[data-game-grid]').children.length===4);
        assert.equal(await page.locator("[data-game-effective-type]").count(),0);
        assert.equal(await page.locator('[data-game-filter="all"]').getAttribute("aria-pressed"),"true");
        await page.locator('[data-game-filter="expansion"]').click();
        await page.locator("[data-game-search]").fill("Promo");
        await page.waitForFunction(()=>!document.querySelector('[data-game-grid] [data-item-type="base"]'));
        await page.locator("[data-game-search]").fill("");
        await page.waitForFunction(()=>!new URL(location.href).searchParams.has('q'));
        assert.equal(await page.locator('[data-game-filter="expansion"]').getAttribute('aria-pressed'),'true');
        assert.equal(new URL(page.url()).searchParams.has('page'),false);

        await page.locator('[data-game-advanced] summary').click();
        await page.locator('[data-game-players]').selectOption('2');
        await page.locator('[data-game-time]').selectOption('31-60');
        assert.equal(await page.locator('[data-game-advanced-summary]').textContent(),'2 項條件');
        if(process.env.C4_SCREENSHOTS)await page.screenshot({path:path.join(output,'desktop-advanced-filters.png'),fullPage:false});
        await page.locator('[data-game-weight]').selectOption('2-3');
        const mechanic = await page.locator('[data-game-mechanic] option').evaluateAll(options=>options.find(o=>/^\d+$/.test(o.value) && /合作/.test(o.textContent))?.value);
        assert.ok(mechanic, "Chinese mechanic translations must be used");
        await page.locator('[data-game-mechanic]').selectOption(mechanic);
        await page.locator('[data-game-advanced] summary').click();
        assert.equal(await page.locator('[data-game-advanced-summary]').textContent(),'4 項條件');
        assert.equal(await page.locator('[data-game-clear-advanced]').isVisible(),true);
        const query = new URL(page.url()).search;
        const english = page.locator('.cat-language-switcher [lang="en"]');
        assert.equal(new URL(await english.getAttribute('href')).search,query);
        await english.click();
        await page.waitForURL(/\/en\/games/);
        assert.equal(await page.locator('[data-game-mechanic]').inputValue(),mechanic);
        assert.doesNotMatch(await page.locator('[data-game-mechanic] option:checked').textContent(),/[\u4e00-\u9fff]/);
        assert.equal(await page.locator('[data-game-advanced-summary]').textContent(),'4 filters');
        assert.equal(await page.locator('[data-game-clear-advanced]').textContent(),'Clear filters');
        const beforeClear = new URL(page.url());
        await page.locator('[data-game-clear-advanced]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('[data-game-advanced]').getAttribute('open'),null);
        assert.equal(await page.locator('[data-game-clear-advanced]').isVisible(),false);
        assert.equal(await page.locator('[data-game-advanced-summary]').isVisible(),false);
        for (const key of ['players','time','weight','mechanic','page']) assert.equal(new URL(page.url()).searchParams.has(key),false);
        assert.equal(new URL(page.url()).searchParams.get('filter'),beforeClear.searchParams.get('filter'));
        await page.goBack();
        assert.equal(await page.locator('[data-game-advanced-summary]').textContent(),'4 filters');
        await page.locator('[data-game-clear-advanced]').click();
        assert.equal(await page.locator('[data-game-time]').inputValue(),'');
        assert.equal(await page.locator('[data-game-weight]').inputValue(),'');
        assert.equal(await page.locator('[data-game-advanced]').getAttribute('open'),null);

        // Clearing advanced fields preserves all unrelated URL state and resets the batch.
        await page.goto('http://bgg.test/en/games?q=Promo&filter=expansion&sort=name-desc&view=list&players=2&time=31-60');
        await page.waitForFunction(()=>document.querySelector('[data-game-clear-advanced]')?.hidden===false);
        await page.locator('[data-game-clear-advanced]').click();
        const cleared = new URL(page.url());
        for(const [key,value] of [['q','Promo'],['filter','expansion'],['sort','name-desc'],['view','list']]) assert.equal(cleared.searchParams.get(key),value);
        assert.equal(cleared.pathname,'/en/games');
        assert.ok(await grid.locator('[data-game-card]').count()>0);
        assert.ok(await grid.locator('[data-game-card]').count()<=24);
        await page.reload();
        assert.equal(await page.locator('[data-game-clear-advanced]').isVisible(),false);

        await page.goto('http://bgg.test/en/games?q=Darwin');
        await page.waitForFunction(()=>document.querySelector('[data-game-grid]')?.textContent.includes("Darwin's Journey"));
        assert.doesNotMatch(await grid.textContent(),/&#0?39;/);
        await page.locator('[data-game-view="list"]').click();
        assert.match(await grid.textContent(),/Darwin's Journey/);

        await page.locator('[data-game-reset]').click();
        await page.locator('[data-game-filter="all"]').click();
        await page.locator('[data-game-view="list"]').click();
        const listIds=await grid.locator('[data-game-card]').evaluateAll(cards=>cards.map(c=>c.dataset.bggId));
        await page.locator('[data-game-view="grid"]').click();
        assert.deepEqual(await grid.locator('[data-game-card]').evaluateAll(cards=>cards.map(c=>c.dataset.bggId)),listIds);
        await page.goBack();
        assert.equal(await page.locator('[data-game-browser]').getAttribute('data-view'),'list');
        await page.reload();
        assert.equal(await page.locator('[data-game-browser]').getAttribute('data-view'),'list');
        await page.setViewportSize({width:375,height:812});
        await page.locator('[data-game-advanced] summary').click();
        await page.locator('[data-game-players]').selectOption('2');
        assert.equal(await page.locator('[data-game-clear-advanced]').isVisible(),true);
        if(process.env.C4_SCREENSHOTS)await page.screenshot({path:path.join(output,'mobile-advanced-filters.png'),fullPage:false});
        await page.locator('[data-game-advanced] summary').click();
        await page.locator('[data-game-clear-advanced]').click();
        assert.equal(await page.locator('[data-game-advanced]').getAttribute('open'),null);
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(process.env.C4_SCREENSHOTS)await page.screenshot({path:path.join(output,'mobile-list.png'),fullPage:false});
        await page.locator('[data-game-view="grid"]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('[data-game-browser]').getAttribute('data-view'),'grid');
        await page.locator('[data-load-more]').click();
        await page.waitForFunction(()=>document.querySelector('[data-game-grid]').children.length===48);
        await page.evaluate(()=>window.scrollTo({top:900,behavior:'instant'}));
        await page.waitForFunction(()=>scrollY>600);
        assert.equal(await page.locator('[data-back-to-top]').isVisible(),true);
        const href = await grid.locator('.game-link[href]').evaluateAll(links=>links.find(a=>a.getBoundingClientRect().top>0 && a.getBoundingClientRect().top<innerHeight-150)?.getAttribute('href'));
        assert.ok(href);
        const before=await page.evaluate(()=>scrollY);
        await grid.locator(`a[href="${href}"]`).click();
        await page.waitForURL(url=>url.pathname!=='/en/games');
        await page.goBack();
        await page.waitForFunction(()=>document.querySelector('[data-game-grid]')?.children.length===48);
        await page.waitForFunction(y=>Math.abs(scrollY-y)<180,before);
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.locator('[data-back-to-top]').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(()=>scrollY===0);
        if(process.env.C4_SCREENSHOTS)await page.screenshot({path:path.join(output,'mobile-grid.png'),fullPage:false});
        assert.deepEqual(errors,[]);

        const failed=await context.newPage();
        await failed.route('**/*',route=>route.request().resourceType()==='image'?route.abort():routeRequest(route));
        await failed.goto('http://bgg.test/games');
        await failed.waitForFunction(()=>[...document.querySelectorAll('[data-game-card]')].slice(0,4).every(card=>!card.querySelector('img')));
        await failed.locator('[data-game-view="list"]').click();
        assert.match(await failed.locator('[data-image-placeholder]').first().textContent(),/圖片無法載入/);
        assert.ok(await failed.locator('[data-image-container]').first().evaluate(el=>el.getBoundingClientRect().height>0));
        console.log('filter-to-next-frame-ms',await failed.evaluate(()=>new Promise(resolve=>{const start=performance.now();document.querySelector('[data-game-filter="expansion"]').click();requestAnimationFrame(()=>resolve(performance.now()-start));})));
        await failed.close();

        const automatic=await context.newPage(); // no init-script override on this new page
        await automatic.goto('http://bgg.test/games');
        await automatic.waitForFunction(()=>document.querySelector('[data-game-grid]')?.children.length>=24);
        await automatic.evaluate(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'instant'}));
        await automatic.waitForFunction(()=>document.querySelector('[data-game-grid]').children.length>24);
        await automatic.close();
        const noJs=await browser.newContext({javaScriptEnabled:false});
        await noJs.route('**/*',routeRequest);
        const basic=await noJs.newPage();
        await basic.goto('http://bgg.test/games');
        assert.equal(await basic.locator('[data-game-grid] [data-game-card]').count(),24);
        assert.ok(await basic.locator('noscript a[href*="/games/"]').count()>=762);
        assert.equal(await basic.locator('[data-game-grid] h2').first().isVisible(),true);
        await noJs.close();
        console.log(JSON.stringify({result:'PASS',screenshots:output,checks:'actual Astro UI, proportional covers, scoped search, combined filters, translated mechanics/language links, list/grid, retry, progressive loading, history/scroll restore, mobile width, keyboard/reduced motion'}));
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
