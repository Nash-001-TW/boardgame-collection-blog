import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';

const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
const screenshots = join(output, 'UI-S5A-screenshots');
await mkdir(screenshots, { recursive: true });

const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { dashboardPreview, collectionDetailFixture } from "./tests/helpers/admin-dashboard-preview.ts"; export { handleCollectionAdminRequest } from "./src/lib/collection-admin-api.ts"; export { handleCollectionCopiesRequest } from "./src/lib/collection-copies-api.ts"; export { accessFixture } from "./tests/helpers/notbgg-access-fixture.ts";',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    define: { 'import.meta.url': JSON.stringify(import.meta.url), 'import.meta.env': 'undefined' },
});
const physicalHarness = await build({
    stdin: {resolveDir: process.cwd(), contents:
        'export { handlePhysicalComponentRequest } from "./src/lib/physical-component-admin-api.ts";' +
        'export { sleeveWorkflowFixture } from "./tests/helpers/sleeve-workflow-fixture.ts";'},
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    define: { 'import.meta.url': JSON.stringify(import.meta.url), 'import.meta.env': 'undefined' },
});
const physical = { exports: {} };
new Function('require', 'module', 'exports', physicalHarness.outputFiles[0].text)(
    createRequire(import.meta.url), physical, physical.exports,
);
const loaded = { exports: {} };
new Function('require', 'module', 'exports', harness.outputFiles[0].text)(
    createRequire(import.meta.url), loaded, loaded.exports,
);
const { dashboardPreview, collectionDetailFixture, accessFixture, handleCollectionAdminRequest, handleCollectionCopiesRequest } = loaded.exports;
const fixtures = Object.fromEntries(['normal', 'header', 'copies'].map(state => [state, collectionDetailFixture(state === 'normal' ? undefined : state)]));
let server, browser, ws;
let physicalFixture;
let scenario = 'normal';
let checks = 0;

async function until(check, label) {
    const deadline = Date.now() + 18_000;
    let lastError;
    while (Date.now() < deadline) {
        try {
            if (await check()) return;
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw new Error('Timed out: ' + label, { cause: lastError });
}

try {
    const auth = await accessFixture();
    const token = await auth.token();
    const bindings = { ...auth.bindings, DB: fixtures.normal.db, NOTBGG_WRITE_LIMITER: {limit: async () => ({success:true})} };
    const physicalClient = await build({
        entryPoints: ['src/lib/physical-component-admin-controller.ts'],
        bundle: true, write: false, format: 'iife', platform: 'browser',
    });
    const giftHarness = await build({
        stdin: {resolveDir:process.cwd(), contents:
            'export { handleSleeveAdminRequest } from "./src/lib/sleeve-admin-api.ts";' +
            'export { handlePurchaseAdminRequest } from "./src/lib/purchase-admin-api.ts";'},
        bundle:true, write:false, format:'cjs', platform:'node', packages:'external',
        define:{'import.meta.url':JSON.stringify(import.meta.url),'import.meta.env':'undefined'},
    });
    const giftApi = {exports:{}};
    new Function('require','module','exports',giftHarness.outputFiles[0].text)(createRequire(import.meta.url),giftApi,giftApi.exports);
    const giftClient = await build({
        entryPoints:['src/lib/sleeve-admin-controller.ts'],bundle:true,write:false,format:'iife',platform:'browser',
    });
    const renderPage = await dashboardPreview(bindings);
    const client = await build({
        stdin: {resolveDir:process.cwd(), contents:
            'import { initializeCollectionAdmin } from "./src/lib/collection-admin-controller.ts";' +
            'import "./src/lib/collection-copies-controller.ts";' +
            'document.querySelectorAll("[data-collection-admin]").forEach(initializeCollectionAdmin);'},
        bundle:true, write:false, format:'iife', platform:'browser',
    });
    server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://' + req.headers.host);
            if (/^\/images\/admin\/[a-z0-9-]+\.webp$/.test(url.pathname)) {
                const image = await readFile('public' + url.pathname);
                res.writeHead(200, { 'Content-Type': 'image/webp' }).end(image);
                return;
            }
            bindings.DB = fixtures[scenario].db;
            if (physicalFixture) bindings.DB = physicalFixture.db;
            const headers = new Headers(req.headers);
            headers.set('Cf-Access-Jwt-Assertion', token);
            const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(await Array.fromAsync(req));
            const request = new Request(url, {headers, method:req.method, body});
            if (url.pathname === '/slv-gift-client.js') {
                res.writeHead(200, {'Content-Type':'application/javascript'}).end(giftClient.outputFiles[0].text);
                return;
            }
            if (url.pathname === '/api/admin/sleeves' || url.pathname === '/api/admin/purchases') {
                const handle = url.pathname.endsWith('/sleeves') ? giftApi.exports.handleSleeveAdminRequest : giftApi.exports.handlePurchaseAdminRequest;
                const response = await handle(request,bindings);
                res.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text());
                return;
            }
            if (url.pathname === '/admin/sleeves') {
                const response = await renderPage(request);
                res.writeHead(response.status, {'Content-Type':'text/html; charset=utf-8'});
                res.end((await response.text()).replace('</body>', '<script src="/slv-gift-client.js"></script></body>'));
                return;
            }
            if (url.pathname === '/s5a-client.js') {
                res.writeHead(200, {'Content-Type':'application/javascript'}).end(client.outputFiles[0].text);
                return;
            }
            if (url.pathname === '/s5b-client.js') {
                res.writeHead(200, {'Content-Type':'application/javascript'}).end(physicalClient.outputFiles[0].text);
                return;
            }
            if (url.pathname === '/api/admin/collection/components') {
                const response = await physical.exports.handlePhysicalComponentRequest(request, bindings);
                res.writeHead(response.status, {'Content-Type':'application/json'}).end(await response.text());
                return;
            }
            if (url.pathname === '/admin/collection/components/manage' || url.pathname === '/admin/sleeves/requirements') {
                const response = await renderPage(request);
                res.writeHead(response.status, Object.fromEntries(response.headers)).end(await response.text());
                return;
            }
            if (/^\/admin\/collection\/\d+\/components$/.test(url.pathname)) {
                const response = await renderPage(request);
                res.writeHead(response.status, {'Content-Type':'text/html; charset=utf-8'});
                res.end((await response.text()).replace('</body>', '<script src="/s5b-client.js"></script></body>'));
                return;
            }
            if (url.pathname.startsWith('/api/admin/collection/')) {
                const handler = url.pathname.endsWith('/copies') ? handleCollectionCopiesRequest : handleCollectionAdminRequest;
                const response = await handler(request, bindings);
                const result = await response.text();
                if (!response.ok) console.error(req.method, url.pathname, response.status);
                res.writeHead(response.status, {'Content-Type':'application/json'}).end(result);
                return;
            }
            const rendered = await renderPage(request);
            res.writeHead(rendered.status, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end((await rendered.text()).replace('</body>', '<script src="/s5a-client.js"></script></body>'));
        } catch (error) {
            res.writeHead(500).end(String(error));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const {sqlite} of Object.values(fixtures)) {
        sqlite.prepare(`UPDATE bgg_games SET cache_json=json_set(cache_json,'$.thumbnail',?) WHERE bgg_id=900001`)
            .run(origin + '/images/admin/fn-collection.webp');
    }
    const profile = await mkdtemp(join(output, 's5a-edge-'));
    browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        ...(process.env.D1_A3_EDGE_LOCAL_TEST_MODE === '1' ? ['--no-sandbox'] : []),
        '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync',
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--remote-debugging-port=0',
        '--user-data-dir=' + profile, 'about:blank',
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let browserDiagnostics = '';
    browser.stderr.on('data', chunk => { browserDiagnostics = (browserDiagnostics + chunk).slice(-4000); });
    let launchError;
    browser.on('error', error => { launchError = error; });
    let port;
    await until(async () => launchError || browser.exitCode !== null ||
        (port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])), 'browser debug port');
    if (launchError) throw launchError;
    if (browser.exitCode !== null) throw new Error('Edge exited before startup: ' + browser.exitCode + ' ' + browserDiagnostics);
    const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });

    let sequence = 0;
    const calls = new Map();
    ws.addEventListener('message', ({ data }) => {
        const message = JSON.parse(data);
        calls.get(message.id)?.(message);
    });
    function cdp(method, params = {}, sessionId) {
        const id = ++sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                calls.delete(id);
                reject(new Error(method + ' timed out. Edge diagnostics: ' + browserDiagnostics));
            }, 12_000);
            calls.set(id, message => {
                clearTimeout(timer);
                calls.delete(id);
                if (message.error) reject(new Error(message.error.message));
                else resolve(message.result);
            });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
        });
    }

    await cdp('Page.enable');
    await cdp('Emulation.setScrollbarsHidden', { hidden: true });
    const evaluate = async (fn, ...args) => {
        const result = await cdp('Runtime.evaluate', {
            expression: '(' + fn + ')(...' + JSON.stringify(args) + ')', returnByValue: true, awaitPromise: true,
        });
        assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
        return result.result.value;
    };
    const navigate = async path => {
        const targetUrl = origin + path;
        const result = await cdp('Page.navigate', { url: targetUrl });
        assert.equal(result.errorText, undefined, path);
        await until(() => evaluate(url => (location.href === url || (new URL(url).pathname.endsWith('/components') &&
            (() => { const actual = new URL(location.href); actual.searchParams.delete('copy'); return actual.href === url; })())) && document.readyState === 'complete', targetUrl), targetUrl);
    };

    const pass = label => console.log('PASS ' + ++checks + ' ' + label);
    const capture = async name => {
        const { data } = await cdp('Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: false,
        });
        await writeFile(join(screenshots, name + '.png'), Buffer.from(data, 'base64'));
    };

    const details = '/admin/collection/1';
    const copies = details + '/copies';
    const query = '?scope=production&lang=zh-TW';
    const settle = () => until(() => evaluate(() => document.querySelector('[data-collection-form] [name=displayName]')?.value), 'R05 data');
    const resize = width => cdp('Emulation.setDeviceMetricsOverride', {width, height: 1050, deviceScaleFactor: 1, mobile: false});
    for (const [key, path] of [['details', details], ['copies', copies]]) {
        for (const width of [1440, 768, 375]) {
            await resize(width);
            await navigate(path + query);
            if (key === 'details') await settle();
            assert.equal(await evaluate(() => document.documentElement.scrollWidth), width);
            assert.equal(await evaluate(() => document.querySelector('[data-detail-header] h1')?.textContent), 'Alpha');
            assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[data-detail-tabs] [aria-current=page]')]
                .map(a => new URL(a.href).pathname)), [path]);
            await capture(key + '-' + width);
            pass(key + ' ' + width + ' px, active link and no page overflow');
        }
    }

    scenario = 'header';
    await navigate(details + query);
    await settle();
    assert.equal(await evaluate(() => document.querySelector('[data-detail-header] [role=alert]').textContent.includes('無法取得')), true);
    await capture('header-unavailable');
    await navigate(copies + query);
    assert.equal(await evaluate(() => !!document.querySelector('[data-detail-header] [role=alert]') &&
        !!document.querySelector('[data-copy-action=create]')), true);
    pass('header failure leaves both tab contents usable');

    scenario = 'copies';
    await navigate(copies + query + '&after=0');
    assert.equal(await evaluate(() => document.querySelector('[data-detail-header] h1').textContent === 'Alpha' &&
        !!document.querySelector('main > [role=alert]')), true);
    pass('copy read failure preserves header');

    scenario = 'normal';
    for (const suffix of ['', '/copies']) {
        assert.equal((await fetch(origin + '/admin/collection/99999' + suffix)).status, 404);
        assert.equal((await fetch(origin + details + suffix + '?scope=invalid')).status, 400);
    }
    await navigate('/admin/collection/99999');
    assert.equal(await evaluate(() => document.querySelector('[data-detail-header] [role=alert]').textContent.includes('找不到收藏')), true);
    pass('missing collection 404 and invalid scope 400');

    await navigate('/admin/collection/2/copies');
    assert.equal(await evaluate(() => document.querySelector('[data-detail-header]').textContent.includes('已封存') &&
        !document.querySelector('[data-copy-action=create]') && document.querySelector('[data-copy-action=edit] input[name=label]').disabled), true);
    await capture('archived');
    pass('archived collection is marked and copies are read only');

    await navigate('/admin/collection/5');
    assert.equal(await evaluate(() => document.querySelector('[data-detail-header]').textContent.includes('缺少來源身份')), true);
    await capture('missing-source');
    pass('missing source is displayed as text');

    await navigate('/admin/collection/6?scope=test&lang=en');
    await settle();
    assert.equal(await evaluate(() => document.querySelector('[data-detail-header]').textContent.includes('Owned copies') &&
        !!document.querySelector('a[href="/en/games/notbgg/000001"]') &&
        document.querySelector('[data-detail-header] > a').search.includes('scope=test')), true);
    assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[data-detail-tabs] a')].slice(2)
        .map(a => [a.pathname, a.search])), [
        ['/admin/collection/6/components', '?scope=test&lang=en'],
        ['/admin/collection/6/sleeves', '?scope=test&lang=en'],
        ['/admin/collection/6/purchases', '?scope=test&lang=en'],
    ]);
    await capture('english');
    pass('English, NotBGG public link and collection tab destinations retain scope and language');

    await navigate(details + query);
    await settle();
    await evaluate(() => document.querySelector('[data-detail-tabs] a').focus());
    await cdp('Input.dispatchKeyEvent', {type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
    await cdp('Input.dispatchKeyEvent', {type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
    assert.equal(await evaluate(() => document.activeElement.pathname), copies);
    assert.equal(await evaluate(() => document.activeElement.matches(':focus-visible')), true);
    const beginNavigation = () => cdp('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13});
    await evaluate(() => {
        const field = document.querySelector('[data-collection-form] [name=displayName]');
        field.value = 'Unsaved synthetic name';
        field.dispatchEvent(new Event('input', {bubbles:true}));
    });
    let dialog;
    ws.addEventListener('message', ({data}) => {
        const event = JSON.parse(data);
        if (event.method === 'Page.javascriptDialogOpening') dialog = event.params;
    });
    const pendingNavigation = beginNavigation();
    await until(() => dialog, 'beforeunload dialog');
    assert.equal(dialog.type, 'beforeunload');
    await cdp('Page.handleJavaScriptDialog', {accept:false});
    await pendingNavigation;
    assert.equal(await evaluate(() => location.pathname), details);
    pass('Tab focus and Enter invoke unsaved-changes dialog; cancel stays on R05');

    await evaluate(() => {
        const form = document.querySelector('[data-collection-form]');
        form.elements.displayName.value = 'Updated synthetic collection';
        form.requestSubmit();
    });
    await until(() => evaluate(() => document.querySelector('[data-admin-status]').textContent.includes('已儲存收藏')), 'R05 saved');
    assert.equal(fixtures.normal.sqlite.prepare('SELECT display_name FROM v2_collection_items WHERE id=1').get().display_name, 'Updated synthetic collection');
    // The page reloads after saving, so the server-rendered header shows the saved name and the
    // result message is carried across the reload.
    await until(() => evaluate(() => document.querySelector('[data-detail-header] h1')?.textContent === 'Updated synthetic collection'), 'header refreshed after save');
    assert.match(await evaluate(() => document.querySelector('[data-admin-status]').textContent), /已儲存收藏/);
    pass('R05 saves through existing API and the header refreshes');

    await evaluate(() => document.querySelector('[data-detail-tabs] a:nth-child(2)').focus());
    await beginNavigation();
    const onPath = path => until(() => evaluate(url => (location.href === url || (new URL(url).pathname.endsWith('/components') &&
            (() => { const actual = new URL(location.href); actual.searchParams.delete('copy'); return actual.href === url; })())) && document.readyState === 'complete', origin + path + query), path);
    await onPath(copies);
    await cdp('Page.reload');
    await onPath(copies);
    await evaluate(() => history.back());
    await onPath(details);
    await evaluate(() => history.forward());
    await onPath(copies);
    pass('keyboard activation, reload, back and forward preserve tab URLs');

    await evaluate(() => {
        const form = document.querySelector('[data-copy-action=create]');
        form.closest('details').open = true;
        form.elements.label.value = 'New synthetic copy';
        form.requestSubmit();
    });
    await until(() => evaluate(() => document.querySelector('[data-copy-status]')?.textContent.includes('副本已儲存')), 'new copy saved');
    assert.equal(fixtures.normal.sqlite.prepare("SELECT COUNT(*) AS count FROM v2_owned_copies WHERE copy_label='New synthetic copy'").get().count, 1);
    assert.equal(await evaluate(() => document.querySelector('[data-detail-header]').textContent.includes('持有副本 · 3')), true);
    pass('copy creation writes once and refreshed header shows 3 held copies');

    const ratios = await evaluate(() => {
        const luminance = rgb => rgb.map(channel => {
            const value = channel / 255;
            return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const sample = ['[data-detail-header] h1', '[data-detail-header] .admin-kit-badge',
            '[data-detail-tabs] [aria-current=page]', '[data-detail-tabs] a:not([aria-current])',
            '[data-copy-action=edit] input[name=label]', '[data-copy-action=edit] button'];
        return sample.map(selector => {
            const element = document.querySelector(selector);
            const foreground = luminance(rgb(getComputedStyle(element).color));
            let surface = element;
            while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
            const background = luminance(rgb(getComputedStyle(surface).backgroundColor));
            return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
        });
    });
    assert.ok(ratios.every(ratio => ratio >= 4.5), JSON.stringify(ratios));
    pass('WCAG AA sampled contrast ' + ratios.length + '/' + ratios.length + ', minimum ' + Math.min(...ratios).toFixed(2));
    physicalFixture = await physical.exports.sleeveWorkflowFixture();
    bindings.PHYSICAL_COMPONENT_SIGNING_KEY = physicalFixture.secret;
    physicalFixture.sqlite.exec(`
        INSERT INTO v2_collection_management(collection_item_id, archived_at) VALUES (2, '2026-11-25');
        INSERT INTO v2_collection_items(id, display_name, record_scope) VALUES (6, 'Synthetic test collection', 'test');
    `);
    const components = details + '/components';
    const s5bScreenshots = join(output, 'UI-S5B-screenshots');
    await mkdir(s5bScreenshots, { recursive: true });
    const captureComponents = async name => {
        const {data} = await cdp('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false});
        await writeFile(join(s5bScreenshots, name + '.png'), Buffer.from(data, 'base64'));
    };
    await resize(1440);
    await navigate(components + query);
    await evaluate(() => {
        const form = document.querySelector('[data-physical-action=create]');
        form.elements.name.value = 'Synthetic cards';
        form.elements.expected.value = '30';
        form.elements.confirmed.checked = true;
        form.requestSubmit();
    });
    await until(() => evaluate(() => [...document.querySelectorAll('[data-physical-manager] article')].some(article =>
        article.textContent.includes('Synthetic cards') && article.querySelector('[data-classification=PHYSICAL_COMPONENT]')) &&
        // #36 shows the create result inside the form instead of reloading into the page-level status.
        document.querySelector('[data-create-status]').dataset.tone === 'success'), 'component saved and classified');
    pass('R06 creates a synthetic component through the rendered form');
    await evaluate(() => {
        const card = [...document.querySelectorAll('[data-physical-manager] article')].find(article => article.textContent.includes('Synthetic cards'));
        const form = card.querySelector('[data-physical-action=count]');
        form.elements.actual.value = '28';
        form.elements.actual.dispatchEvent(new Event('input', { bubbles: true }));
        form.requestSubmit();
    });
    await until(() => evaluate(() => [...document.querySelectorAll('[data-physical-manager] article')].some(article =>
        article.textContent.includes('Synthetic cards') &&
        article.querySelector('[data-count-current]')?.textContent === '28')),
        'count updated in its row');
    pass('R06 saves a count through the rendered form and updates its row');

    for (const width of [1440, 768, 375]) {
        await resize(width);
        await navigate(components + query);
        assert.equal(await evaluate(() => document.documentElement.scrollWidth), width);
        assert.ok(await evaluate(path => document.querySelector('[data-detail-header] h1').textContent &&
            document.querySelector('[data-detail-tabs] [aria-current=page]').pathname === path &&
            document.querySelector('.shell-nav [aria-current=page]').pathname === '/admin/collection' &&
            ![...document.querySelectorAll('.shell-nav a')].some(a => a.pathname.endsWith('/components/manage')), components));
        await captureComponents('components-' + width);
        pass('R06 ' + width + ' px, detail and sidebar active links, retired menu item absent, no page overflow');
    }
    await navigate('/admin/collection/2/components' + query);
    assert.ok(await evaluate(() => document.querySelector('[data-physical-manager]').textContent.includes('此收藏已封存。') &&
        !document.querySelector('[data-physical-action]')));
    await captureComponents('components-archived');
    pass('archived collection renders R06 read-only with signing configured');

    await navigate(components + '?lang=en');
    assert.ok(await evaluate(() => document.documentElement.lang === 'en' &&
        document.querySelector('[data-detail-tabs] [aria-current=page]').ariaLabel === 'Physical components' &&
        document.querySelector('[data-physical-manager]').textContent.includes('Add physical component')));
    await captureComponents('components-english');
    pass('English R06 headings and forms');

    const redirects = await evaluate(async () => Promise.all([
        '?collection=6&scope=test&lang=en', '?collection=1', '?lang=en', '?collection=invalid&lang=en',
    ].map(async query => {
        const response = await fetch('/admin/collection/components/manage' + query);
        const url = new URL(response.url);
        return [response.redirected, response.status, url.pathname + url.search];
    })));
    assert.deepEqual(redirects, [
        [true, 200, '/admin/collection/6/components?scope=test&lang=en'],
        [true, 200, '/admin/collection/1/components?scope=production'],
        [true, 200, '/admin/collection?lang=en'],
        [true, 200, '/admin/collection?lang=en'],
    ]);
    pass('legacy R06 redirects preserve scope and language and fall back for missing/invalid IDs');
    const s5cScreenshots = join(output, 'UI-S5C-screenshots');
    await mkdir(s5cScreenshots, { recursive: true });
    const captureS5c = async name => {
        const {data} = await cdp('Page.captureScreenshot', {format:'png', captureBeyondViewport:false});
        await writeFile(join(s5cScreenshots, name + '.png'), Buffer.from(data, 'base64'));
    };
    const sleevePath = details + '/sleeves';
    const purchasePath = details + '/purchases';
    physicalFixture.sqlite.exec(`
        WITH RECURSIVE ids(id) AS (SELECT 101 UNION ALL SELECT id + 1 FROM ids WHERE id < 121)
        INSERT INTO v2_purchase_orders (id, ordered_at, merchant_name, currency_code, status, item_subtotal_minor)
        SELECT id, '2026-11-25', 'Synthetic store', CASE WHEN id = 121 THEN 'USD' ELSE 'TWD' END, 'paid', 200 FROM ids;
        INSERT INTO v2_purchase_allocations (purchase_order_id, collection_item_id, allocated_minor)
        SELECT id, 1, 75 FROM v2_purchase_orders WHERE id BETWEEN 101 AND 121;
    `);
    for (const [name, path, selector] of [
        ['sleeves', sleevePath, '[data-sleeve-workflow]'],
        ['purchases', purchasePath, '.admin-collection-purchases'],
    ]) {
        for (const width of [1440, 768, 375]) {
            await resize(width);
            await navigate(path + query);
            assert.equal(await evaluate(() => document.documentElement.scrollWidth), width);
            assert.ok(await evaluate((path, selector) =>
                !!document.querySelector(selector) &&
                document.querySelector('[data-detail-tabs] [aria-current=page]').pathname === path &&
                document.querySelector('.shell-nav [aria-current=page]').pathname === '/admin/collection' &&
                !document.querySelector('.shell-nav a[href*="/sleeves/requirements"]'), path, selector));
            await captureS5c(name + '-' + width);
            pass(name + ' ' + width + ' px, active tab and collection sidebar, no retired entry or page overflow');
        }
    }
    await navigate(purchasePath + '?scope=production&lang=en');
    const purchaseView = await evaluate(() => {
        const panel = document.querySelector('.admin-collection-purchases');
        return {
            lang: document.documentElement.lang,
            costs: [...panel.querySelectorAll(':scope > section:first-of-type li')].map(li => li.textContent.trim()).sort(),
            count: panel.querySelectorAll('.admin-collection-purchase-orders > li').length,
            next: [...panel.querySelectorAll('nav a')].find(link => link.textContent.trim() === 'Next page').search,
            links: [...panel.querySelectorAll('.admin-collection-purchase-links a')].slice(0,2).map(a => a.pathname + a.search),
            forms: panel.querySelectorAll('form').length,
        };
    });
    assert.deepEqual(purchaseView, {
        lang:'en', costs:['TWD · 1500', 'USD · 75'], count:20, next:'?scope=production&lang=en&after=120',
        links:['/admin/purchases?new=1&collection=1&lang=en', '/admin/purchases?collection=1&lang=en'], forms:0,
    });
    await captureS5c('purchases-english');
    await navigate(purchasePath + purchaseView.next);
    assert.deepEqual(await evaluate(() => [...document.querySelectorAll('.admin-collection-purchase-orders h3 a')]
        .map(a => a.pathname + a.search)), ['/admin/purchases?id=121&lang=en']);
    await captureS5c('purchases-page-2');
    pass('related orders use a 20-row cursor, retain scope and language, and display separate currency costs');

    await navigate('/admin/collection/2/purchases' + query);
    assert.ok(await evaluate(() => document.querySelector('[data-detail-header]').textContent.includes('已封存') &&
        document.querySelector('.admin-collection-purchases .admin-kit-empty').textContent.includes('沒有符合條件的採購')));
    await captureS5c('purchases-archived-empty');
    const archivedSleeves = '/admin/collection/2/sleeves' + query;
    assert.equal((await fetch(origin + archivedSleeves)).status, 200);
    await navigate(archivedSleeves);
    assert.ok(await evaluate(() => {
        const panel = document.querySelector('[data-sleeve-workflow]');
        return document.querySelector('[data-detail-header]').textContent.includes('已封存') &&
            !panel.querySelector('form, [data-workflow-action], [role=alert]') &&
            panel.textContent.includes('此收藏已封存，卡套需求僅供保留，不提供操作。');
    }));
    await captureS5c('sleeves-archived');
    pass('archived collection retains its header and cannot render sleeve write forms, purchases show an empty state');

    const db = physicalFixture.db;
    const prepare = db.prepare.bind(db);
    db.prepare = sql => {
        if (sql.includes('FROM v2_purchase_orders o JOIN v2_purchase_order_reconciliation')) throw new Error('Synthetic purchase read failure');
        return prepare(sql);
    };
    assert.equal((await fetch(origin + purchasePath + query)).status, 503);
    await navigate(purchasePath + query);
    assert.ok(await evaluate(() => document.querySelector('[data-detail-header] h1').textContent.includes('Synthetic collection') &&
        document.querySelector('.admin-collection-purchases .admin-kit-alert').textContent.includes('無法取得')));
    await captureS5c('purchases-unavailable');
    db.prepare = prepare;
    pass('purchase read failure returns 503 and preserves the collection header');

    await navigate(sleevePath + '?scope=production&lang=en');
    assert.ok(await evaluate(() => document.documentElement.lang === 'en' &&
        document.querySelector('[data-detail-tabs] [aria-current=page]').ariaLabel === 'Sleeve requirements' &&
        document.querySelector('[data-sleeve-workflow]').textContent.includes('Add sleeve requirement')));
    await captureS5c('sleeves-english');
    const legacySleeves = await fetch(origin + '/admin/sleeves/requirements?collection=1&lang=en', {redirect:'manual'});
    assert.equal(legacySleeves.status, 302);
    assert.equal(legacySleeves.headers.get('location'), sleevePath + '?scope=production&lang=en');
    const globalPurchases = await fetch(origin + '/admin/purchases?collection=1', {redirect:'manual'});
    assert.equal(globalPurchases.status, 200);
    pass('English sleeve controls render, legacy sleeve URL redirects and global purchase filter stays on its own page');

    const giftScreenshots = process.env.SLV_GIFT_SCREENSHOTS ?? join(output, 'SLV-GIFT-screenshots');
    await mkdir(giftScreenshots,{recursive:true});
    const captureGift = async name => {
        const {data} = await cdp('Page.captureScreenshot',{format:'png'});
        await writeFile(join(giftScreenshots,name+'.png'),Buffer.from(data,'base64'));
    };
    const giftFixture = physicalFixture;
    giftFixture.sqlite.exec(`INSERT INTO v2_purchase_orders(id,currency_code,item_subtotal_minor,status) VALUES(208,'TWD',100,'paid');
        INSERT INTO v2_purchase_order_lines(id,purchase_order_id,line_number,description,collection_item_id)
        VALUES(209,208,1,'Synthetic gift source',1)`);
    const sleeveAdmin = '/admin/sleeves';
    const createGiftProduct = '[data-sleeve-action=create]';
    const setForm = (selector, values) => evaluate((selector,values) => {
        const form = document.querySelector(selector);
        form.closest('details')?.setAttribute('open','');
        for (const [name,value] of Object.entries(values)) {
            const input = form.elements.namedItem(name);
            input.value = value;
            input.dispatchEvent(new Event('input',{bubbles:true}));
            input.dispatchEvent(new Event('change',{bubbles:true}));
        }
    },selector,values);
    const submitGift = selector => evaluate(selector => {
        window.confirm = () => true;
        document.querySelector(selector).requestSubmit();
    },selector);
    const savedGift = () => until(() => evaluate(() => document.querySelector('[data-sleeve-status]')?.dataset.tone === 'success'), 'sleeve saved');
    await resize(1440);
    await navigate(sleeveAdmin);
    await setForm(createGiftProduct,{name:'Gift-only sleeves',brand:'Synthetic brand',width:'47.5',height:'100.5',sheetsPerPack:'60'});
    await submitGift(createGiftProduct);
    await savedGift();
    const giftProductId = giftFixture.sqlite.prepare("SELECT id FROM v2_sleeve_products WHERE product_name='Gift-only sleeves'").get().id;
    const productUrl = sleeveAdmin+'?product='+giftProductId;
    const stockForm = '[data-sleeve-action=stock]';
    const editForm = '[data-sleeve-action=edit]';
    await navigate(productUrl);
    assert.ok(await evaluate(selector => [...document.querySelector(selector+' [name=kind]').options].some(option=>option.value==='GIFT'),stockForm));
    await setForm(stockForm,{kind:'GIFT',unit:'pack',quantity:'2'});
    assert.equal(await evaluate(() => document.querySelector('[data-gift-balance]').textContent),'120');
    await evaluate(() => document.querySelector('[data-gift-fields]').scrollIntoView({block:'center'}));
    await captureGift('new-size-first-gift-1440');
    await submitGift(stockForm);
    await savedGift();
    assert.deepEqual([...Object.values(giftFixture.sqlite.prepare(`SELECT transaction_type,quantity_sheets,pack_count,sheets_per_pack_snapshot
        FROM v2_sleeve_inventory_transactions WHERE product_id=?`).get(giftProductId))],['GIFT',120,2,60]);
    pass('New size and first transaction recorded as a two-pack gift');

    await resize(768);
    await setForm(stockForm,{kind:'GIFT',unit:'sheet',quantity:'7',collectionId:'1',giftOrder:'208'});
    await until(() => evaluate(() => document.querySelector('[data-gift-collection]').textContent.includes('Synthetic collection') &&
        document.querySelector('[name=purchaseOrderLineId] option[value="209"]')), 'collection name and order lines');
    await setForm(stockForm,{purchaseOrderLineId:'209'});
    assert.equal(await evaluate(() => document.querySelector('[data-gift-balance]').textContent),'127');
    const giftContrast = await evaluate(() => {
        const rgb = color => color.match(/[\d.]+/g).map(Number);
        const luminance = ([r,g,b]) => [r,g,b].map(value => value / 255)
            .map(value => value <= 0.04045 ? value/12.92 : ((value+0.055)/1.055)**2.4)
            .reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
        return [...document.querySelectorAll('[data-gift-fields] :is(legend,label,p,output,select,input)')]
            .filter(element => element.textContent.trim() || element.value)
            .map(element => {
                let background = element;
                while (background && rgb(getComputedStyle(background).backgroundColor)[3] === 0) background = background.parentElement;
                const foreground = luminance(rgb(getComputedStyle(element).color));
                const surface = background ? luminance(rgb(getComputedStyle(background).backgroundColor)) : 1;
                return (Math.max(foreground,surface)+0.05)/(Math.min(foreground,surface)+0.05);
            });
    });
    assert.ok(giftContrast.length >= 10 && giftContrast.every(ratio => ratio >= 4.5), JSON.stringify(giftContrast));
    pass('Gift fields expose text contrast of at least '+Math.min(...giftContrast).toFixed(2)+':1 across '+giftContrast.length+' samples');
    for (const width of [1440,768,375]) {
        await resize(width);
        assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await evaluate(() => document.querySelector('[data-gift-fields]').scrollIntoView({block:'center'}));
        await captureGift('linked-gift-'+width);
        pass('Linked loose gift form fits '+width+' px');
    }
    await submitGift(stockForm);
    await savedGift();
    const linkedGift = giftFixture.sqlite.prepare('SELECT * FROM v2_sleeve_inventory_transactions WHERE product_id=? ORDER BY id DESC LIMIT 1').get(giftProductId);
    assert.deepEqual([linkedGift.quantity_sheets,linkedGift.pack_count,linkedGift.collection_item_id,linkedGift.purchase_order_line_id,
        linkedGift.unit_pack_price_minor,linkedGift.total_price_minor],[7,null,1,209,null,null]);
    pass('Loose gift links collection and order line with NULL prices');

    await evaluate(selector => document.querySelector(selector).closest('details').open=true,editForm);
    assert.ok(await evaluate(selector => ['width','height','sheetsPerPack'].every(name=>document.querySelector(selector).elements.namedItem(name).readOnly),editForm));
    await evaluate(selector => document.querySelector(selector).scrollIntoView({block:'center'}),editForm);
    await captureGift('product-locked-375');
    pass('Product size and pack quantity are read-only after first gift');
    await navigate(productUrl+'&view=transactions');
    assert.ok(await evaluate(() => document.querySelector('main').innerText.includes('贈送') &&
        document.querySelector('a[href*="/admin/collection/1/purchases"]') &&
        document.querySelector('a[href*="/admin/purchases?id=208"]')));
    await captureGift('ledger-375');
    pass('Gift ledger label, collection link and order link');

    await navigate(purchasePath+query);
    assert.ok(await evaluate(() => document.querySelector('[data-collection-sleeve-gifts]').innerText.includes('Gift-only sleeves') &&
        document.querySelector('[data-collection-sleeve-gifts] a[href*="id=208"]')));
    await evaluate(() => document.querySelector('[data-collection-sleeve-gifts]').scrollIntoView({block:'end'}));
    await captureGift('collection-linked-375');
    pass('Collection lists linked gift and source order');
    await navigate('/admin/collection/2/purchases'+query);
    assert.ok(await evaluate(() => document.querySelector('[data-collection-sleeve-gifts]').innerText.includes('尚無附贈卡套紀錄')));
    await evaluate(() => document.querySelector('[data-collection-sleeve-gifts]').scrollIntoView({block:'end'}));
    await captureGift('collection-empty-375');
    pass('Other collection has an empty gift section');
    db.prepare = sql => {
        if (sql.includes("t.collection_item_id=? AND t.transaction_type='GIFT'")) throw new Error('Synthetic gift read failure');
        return prepare(sql);
    };
    assert.equal((await fetch(origin+purchasePath+query)).status,200);
    await navigate(purchasePath+query);
    assert.ok(await evaluate(() => document.querySelector('[data-detail-header] h1') &&
        document.querySelector('.admin-collection-purchases').innerText.includes('此收藏的已記錄成本') &&
        document.querySelector('[data-collection-sleeve-gifts]').innerText.includes('無法取得')));
    await evaluate(() => document.querySelector('[data-collection-sleeve-gifts]').scrollIntoView({block:'end'}));
    await captureGift('collection-unavailable-375');
    db.prepare = prepare;
    pass('Gift-only read failure preserves HTTP 200, header and purchase data');
    await resize(1440);
    await navigate(productUrl+'&lang=en');
    await setForm(stockForm,{kind:'GIFT',unit:'pack',quantity:'1'});
    assert.ok(await evaluate(() => document.querySelector('[data-gift-fields]').innerText.includes('Price is fixed at zero') &&
        document.querySelector('[data-gift-balance]').textContent==='187'));
    await evaluate(() => document.querySelector('[data-gift-fields]').scrollIntoView({block:'center'}));
    await captureGift('gift-form-en');
    await navigate(purchasePath+'?scope=production&lang=en');
    assert.ok(await evaluate(() => document.querySelector('[data-collection-sleeve-gifts]').innerText.includes('Complimentary sleeves')));
    pass('English gift form, balance and related purchases section');
    const seriesScreenshots = join(output, 'SERIES-screenshots');
    await mkdir(seriesScreenshots);
    giftFixture.sqlite.exec(`
        INSERT INTO v2_collection_items(id,display_name,item_type) VALUES
          (9003,'Synthetic expansion','expansion'),(9004,'Synthetic accessory','accessory'),
          (9005,'Synthetic shared bundle','bundle'),(9006,'Synthetic standalone','base'),
          (9007,'Synthetic ambiguous expansion','expansion'),(9008,'Synthetic first base','base'),
          (9009,'Synthetic second base','base'),(9010,'Synthetic bundle-only game','base'),
          (9011,'Synthetic accessory without costs','accessory'),(9012,'Synthetic zero-cost accessory','accessory');
        INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type) VALUES
          (9003,1,'expansion_of'),(9004,1,'accessory_for'),(9005,1,'bundle_contains'),(9005,9003,'bundle_contains'),(9005,9010,'bundle_contains'),
          (9007,9008,'expansion_of'),(9007,9009,'requires_base'),
          (9012,1,'accessory_for');
        INSERT INTO v2_games(id,primary_name,game_type) VALUES (9011,'Synthetic compatible accessory','accessory');
        UPDATE v2_collection_items SET game_id=9011 WHERE id=9011;
        INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES(9011,'series-accessory','series-accessory');
        BEGIN;
        INSERT INTO notbgg_games(seq,game_id,name,type) VALUES (9011,9011,'Synthetic compatible accessory','boardgameaccessory');
        INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) VALUES(9011,1,'{}','fixture');
        COMMIT;
        INSERT INTO site_game_relations(source_game_id,target_game_id,relation_type,created_by)
          VALUES (9011,1,'compatible_with','fixture');
        INSERT INTO v2_purchase_orders(id,currency_code,item_subtotal_minor,status) VALUES
          (301,'USD',1200,'paid'),(302,'TWD',2400,'completed'),(303,'TWD',350,'paid');
        INSERT INTO v2_purchase_allocations(purchase_order_id,collection_item_id,allocated_minor) VALUES
          (301,9003,1200),(302,9005,2400),(303,9004,350),(303,9012,0);
    `);
    const captureSeries = async (name, selector, width) => {
        const clip = await evaluate((selector, width) => {
            const bounds = document.querySelector(selector).getBoundingClientRect();
            return {x:0,y:Math.max(0,Math.floor(bounds.top + scrollY - 12)),
                width,height:Math.ceil(bounds.height + 24),scale:1};
        }, selector, width);
        const {data} = await cdp('Page.captureScreenshot', {format:'png',clip,captureBeyondViewport:true});
        await writeFile(join(seriesScreenshots, name + '-' + width + '.png'),Buffer.from(data,'base64'),{flag:'wx'});
    };
    for (const width of [375,768,1280]) {
        await resize(width);
        for (const [name,id,pattern] of [
            ['series',1,'合計.*TWD · 1500.*USD · 1275.*其中 0 款尚未記錄成本.*相關配件.*Synthetic accessory.*尚未記錄成本'],
            ['expansion',9003,'Synthetic collection.*本體.*Synthetic expansion.*目前'],
            ['shared-bundle',1,'共用禮包.*Synthetic shared bundle.*共 3 款，其中 2 款在此系列.*TWD · 2400'],
            ['standalone',9006,'尚未建立系列關聯'],
            ['multiple-bases',9007,'此收藏關聯到多個本體.*Synthetic first base.*Synthetic second base'],
        ]) {
            await navigate('/admin/collection/'+id+'/purchases'+query);
            const view = await evaluate(() => {
                const section = document.querySelector('[data-series-spending]');
                return {
                    text: section.innerText.replace(/\s+/g,' '),
                    links: [...section.querySelectorAll('a')].map(a => a.pathname + a.search),
                    fits: document.documentElement.scrollWidth === innerWidth,
                };
            });
            assert.match(view.text,/系列花費合計/);
            assert.match(view.text,new RegExp(pattern));
            assert.ok(view.fits);
            if (name === 'series') {
                assert.ok(view.links.includes('/admin/collection/9003/purchases?lang=zh-TW'));
                const accessories = await evaluate(() => {
                    const section = document.querySelector('[data-series-accessories]');
                    return {
                        heading: section.querySelector('h4').textContent,
                        rows: [...section.querySelectorAll('tbody tr')].map(row => row.innerText.replace(/\s+/g,' ')),
                        subtotal: section.querySelector('ul').innerText,
                        missing: section.querySelector('p').innerText,
                        members: document.querySelector('[aria-label="系列成員"]').innerText,
                    };
                });
                assert.equal(accessories.heading, '配件小計（不併入系列合計）');
                assert.deepEqual(accessories.rows, [
                    'Synthetic accessory 專用 TWD · 350',
                    'Synthetic accessory without costs 相容 尚未記錄成本',
                    'Synthetic zero-cost accessory 專用 TWD · 0',
                ]);
                assert.equal(accessories.subtotal, 'TWD · 350');
                assert.equal(accessories.missing, '其中 1 款配件尚未記錄成本');
                assert.doesNotMatch(accessories.members, /Synthetic accessory/);
            }
            if (name === 'standalone') {
                assert.ok(view.links.includes('/admin/bgg?view=relations&domain=collection&source=9006&lang=zh-TW'));
                assert.equal(await evaluate(() => document.querySelector('[data-series-accessories]') === null), true);
            }
            if (name === 'multiple-bases') assert.ok(view.links.includes('/admin/collection/9009/purchases?lang=zh-TW'));
            await captureSeries(name, name === 'shared-bundle' ? '[data-series-shared-bundles]' : '[data-series-spending]', width);
            pass('Series spending ' + name + ' at ' + width + ' px');
        }
    }
    await navigate('/admin/collection/1/purchases?scope=production&lang=en');
    assert.match(await evaluate(() => document.querySelector('[data-series-accessories]').innerText.replace(/\s+/g,' ')),
        /Related accessories.*Dedicated.*TWD · 350.*Compatible.*No recorded costs.*TWD · 0.*Accessory subtotal \(excluded from series total\).*TWD · 350.*1 accessory without recorded costs/);
    await captureSeries('accessories-en', '[data-series-spending]', 1280);
    pass('English accessories, separate subtotal and zero-cost row');
    await navigate('/admin/collection/9004/purchases'+query);
    assert.match(await evaluate(() => document.querySelector('[data-series-accessories] tbody tr').innerText.replace(/\s+/g,' ')),
        /Synthetic accessory · 目前收藏.*專用.*TWD · 350/);
    assert.ok(await evaluate(() => document.querySelector('[aria-label="系列成員"] a[href^="/admin/collection/1/purchases"]')));
    await captureSeries('current-accessory-zh', '[data-series-spending]', 1280);
    pass('Accessory detail finds the base and marks the current collection');
    const seriesBatch = db.batch.bind(db);
    db.batch = statements => statements.length === 5 || statements.length === 6
        ? Promise.reject(new Error('Synthetic series read failure')) : seriesBatch(statements);
    assert.equal((await fetch(origin+purchasePath+query)).status,200);
    await navigate(purchasePath+query);
    assert.ok(await evaluate(() => document.querySelector('[data-series-spending]').innerText.includes('無法取得系列花費') &&
        document.querySelector('.admin-collection-purchases').innerText.includes('相關訂單') &&
        document.querySelector('[data-collection-sleeve-gifts]').innerText.includes('隨貨附贈的卡套')));
    db.batch = seriesBatch;
    pass('Series-only read failure preserves HTTP 200, orders and gifts');
    physicalFixture.sqlite.close();
    physicalFixture = await physical.exports.sleeveWorkflowFixture();
    bindings.PHYSICAL_COMPONENT_SIGNING_KEY = physicalFixture.secret;
    physicalFixture.sqlite.exec(`
        UPDATE v2_owned_copies SET copy_label='First copy' WHERE id=1;
        INSERT INTO v2_component_definitions(collection_item_id, component_name, physical_creation_token)
            VALUES (1, 'Pending pieces', 'synthetic-unverified');
        INSERT INTO v2_sleeve_requirements(collection_item_id, size_id, quantity_sheets) VALUES (1,2,12);
    `);

    const r06Screenshots = join(output, 'R06-MIN-screenshots');
    await mkdir(r06Screenshots, { recursive: true });
    const captureR06 = async (name, target = '[data-count-picker]') => {
        await evaluate(async selector => {
            document.querySelector(selector).scrollIntoView({ block: 'start', behavior: 'instant' });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, target);
        const listRegion = name.startsWith('count-list-') ? await evaluate(() => {
            const picker = document.querySelector('[data-count-picker]').getBoundingClientRect();
            const management = document.querySelector('[data-component-management]').getBoundingClientRect();
            return { x: 0, y: Math.floor(scrollY + picker.top), width: innerWidth,
                height: Math.ceil(management.bottom - picker.top + 8), scale: 1 };
        }) : undefined;
        const {data} = await cdp('Page.captureScreenshot', {format: 'png',
            ...(listRegion ? {captureBeyondViewport: true, clip: listRegion} : {})});
        await writeFile(join(r06Screenshots, name + '.png'), Buffer.from(data, 'base64'));
    };
    const countPath = components + query + '&copy=1';
    const setCount = (index, value, submit = false) => evaluate((index, value, submit) => {
        const form = document.querySelectorAll('[data-physical-action=count]')[index];
        form.elements.actual.value = value;
        form.elements.actual.dispatchEvent(new Event('input', { bubbles: true }));
        if (submit) form.requestSubmit();
    }, index, value, submit);
    const rowState = () => evaluate(() => Array.from(document.querySelectorAll('[data-physical-action=count]'), form => ({
        input: form.elements.actual.value,
        revision: Number(form.elements.revision.value),
        current: form.closest('[data-count-values]').querySelector('[data-count-current]').textContent,
        status: form.querySelector('[data-count-status]').textContent,
        reload: !form.querySelector('[data-count-reload]').hidden,
        retry: !form.querySelector('[data-count-retry]').hidden,
    })));
    const selected = () => evaluate(() => document.querySelector('[data-count-copy]').value === new URL(location.href).searchParams.get('copy')
        ? document.querySelector('[data-count-copy]').value : '');
    const storedCount = () => physicalFixture.sqlite.prepare(
        'SELECT actual_quantity, count_revision FROM v2_copy_components WHERE owned_copy_id=1 AND component_definition_id=?',
    ).get(physicalFixture.cardId);
    const raw = await (await fetch(origin + components + query + '&copy=2')).text();
    assert.match(raw, /<option value="2" selected/);
    assert.match(raw, /name="copyId" value="2"/);
    await navigate(components + query);
    await until(async () => await selected() === '1', 'default copy in URL');
    assert.ok(await evaluate(() => {
        const list = document.querySelector('[data-count-list]');
        const rows = list.querySelectorAll('[data-count-row]');
        const management = document.querySelector('[data-component-management]');
        return !!(list.compareDocumentPosition(management) & Node.DOCUMENT_POSITION_FOLLOWING) &&
            rows.length === 3 && rows[2].textContent.includes('待確認，不可清點') && !rows[2].querySelector('input') &&
            !management.open && document.querySelector('[data-count-step="-1"]').disabled;
    }));
    await evaluate(() => document.querySelector('[data-count-copy]').focus());
    await cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    assert.equal(await evaluate(() => document.activeElement.dataset.countStep), '1');
    await cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    assert.ok(await evaluate(() => document.activeElement.matches('[data-count-date]')));
    // Edge tabs through the native date input segments before leaving the field.
    for (let tab = 0; tab < 5 && await evaluate(() => document.activeElement.matches('[data-count-date]')); tab++) {
        await cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
        await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    }
    // The first count row's thumbnail is now the photo-dialog button (PHOTO-P1), so it precedes the quantity input.
    assert.ok(await evaluate(() => document.activeElement.matches('[data-count-row] [data-component-thumb]')));
    await cdp('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    await cdp('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9});
    assert.equal(await evaluate(() => document.activeElement.name), 'actual');
    pass('R06 scenario 1: server-selected copy, default URL, panel order and pending row');

    for (const width of [375, 768, 1280, 1440]) {
        await resize(width);
        assert.ok(await evaluate(width => document.documentElement.scrollWidth === width &&
            Array.from(document.querySelectorAll('[data-count-picker] :is(select, button), [data-count-list] :is(input[type=number], [data-count-save])'))
                .every(node => node.getBoundingClientRect().height >= 44), width));
        if (width !== 1440) await captureR06('count-list-zh-' + width);
    }
    await resize(1280);
    await navigate(components + '?lang=en&copy=1');
    assert.match(await evaluate(() => document.querySelector('[data-count-list]').textContent), /Pending verification/);
    await captureR06('count-list-en-1280');
    await navigate(countPath);

    await evaluate(() => { document.body.dataset.pageInstance = 'count-scenario'; });
    await setCount(1, '9');
    await setCount(0, '29', true);
    await until(async () => (await rowState())[0].status === '已確認', 'first count saved');
    assert.deepEqual((await rowState()).map(({input, revision}) => [input, revision]), [['29', 2], ['9', 0]]);
    assert.equal(await evaluate(() => document.body.dataset.pageInstance), 'count-scenario');
    await captureR06('count-success-zh-1280', '[data-count-row]');
    pass('R06 scenario 2: save in place and preserve the other input');

    await cdp('Page.reload');
    await until(async () => await selected() === '1' && (await rowState())[0].current === '29' &&
        await evaluate(() => !document.body.dataset.pageInstance), 'reload stored count');
    pass('R06 scenario 3: reload restores selected copy and saved value');
    await setCount(0, '28', true);
    await until(async () => (await rowState())[0].revision === 3, 'second revision');
    await setCount(0, '27', true);
    await until(async () => (await rowState())[0].revision === 4, 'third revision without reload');
    pass('R06 scenario 4: consecutive saves increment revision in place');

    const {targetId: otherTab} = await cdp('Target.createTarget', {url: origin + countPath});
    try {
        const {sessionId} = await cdp('Target.attachToTarget', {targetId: otherTab, flatten: true});
        await until(async () => {
            const result = await cdp('Runtime.evaluate', {
                expression: 'document.readyState === "complete" && document.querySelector("[data-count-copy]")?.value === "1"',
                returnByValue: true,
            }, sessionId);
            return result.result.value === true;
        }, 'second tab');
        const result = await cdp('Runtime.evaluate', {expression: `(() => {
            const form = document.querySelector('[data-physical-action=count]');
            form.elements.actual.value = '26';
            form.elements.actual.dispatchEvent(new Event('input', { bubbles: true }));
            form.requestSubmit();
        })()`}, sessionId);
        assert.equal(result.exceptionDetails, undefined);
        await until(() => storedCount().count_revision === 5, 'second tab saved');
    } finally {
        await cdp('Target.closeTarget', {targetId: otherTab});
    }
    await setCount(1, '8');
    await setCount(0, '25', true);
    await until(async () => (await rowState())[0].reload, 'only stale row shows reload');
    assert.match((await rowState())[0].status, /資料已變更/);
    assert.deepEqual((await rowState())[1], {input: '8', revision: 0, current: '未清點', status: '', reload: false, retry: false});
    assert.deepEqual([storedCount().actual_quantity, storedCount().count_revision], [26, 5]);
    await captureR06('count-conflict-zh-1280', '[data-count-row]');
    pass('R06 scenario 5: second-tab conflict stays in its row and does not write');

    await evaluate(() => {
        window.confirm = message => { document.body.dataset.confirmMessage = message; return false; };
        document.querySelector('[data-count-step="1"]').click();
    });
    assert.equal(await selected(), '1');
    assert.match(await evaluate(() => document.body.dataset.confirmMessage), /有 2 列尚未儲存/);
    assert.equal((await rowState())[1].input, '8');
    await evaluate(() => document.querySelector('[data-count-reload]').click());
    await until(async () => await selected() === '1' && (await rowState())[0].current === '26' && !(await rowState())[0].reload, 'row reload preserves copy');
    await setCount(1, '7');
    await evaluate(() => {
        window.confirm = () => true;
        document.querySelector('[data-count-step="1"]').click();
    });
    assert.equal(await selected(), '2');
    assert.equal((await rowState())[0].current, '30');
    assert.equal((await rowState())[1].input, '');
    pass('R06 scenario 6: cancel preserves edits, confirmed switch discards, row reload preserves copy');

    await evaluate(() => {
        const fetchOriginal = window.fetch.bind(window);
        window.r06Attempts = [];
        window.fetch = (url, options) => {
            if (JSON.parse(options.body).action === 'count') {
                window.r06Attempts.push([options.headers['Idempotency-Key'], options.body]);
                if (window.r06Attempts.length === 1) return Promise.reject(new TypeError('Synthetic offline request'));
            }
            return fetchOriginal(url, options);
        };
    });
    await setCount(0, '20', true);
    await until(async () => (await rowState())[0].retry, 'network failure offers retry');
    await evaluate(() => document.querySelector('[data-count-retry]').click());
    await until(async () => (await rowState())[0].status === '已確認', 'retry succeeded');
    const attempts = await evaluate(() => window.r06Attempts);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[0], attempts[1]);
    assert.equal(JSON.parse(attempts[1][1]).revision, 1);
    pass('R06 network retry resends exactly the same idempotency key and revision');

    const manage = () => evaluate(() => { document.querySelector('[data-component-management]').open = true; });
    await manage();
    await captureR06('management-expanded-zh-1280', '[data-component-management]');
    await evaluate(() => {
        const form = document.querySelector('[data-physical-action=assign]');
        form.elements.requirementId.selectedIndex = 1;
        form.requestSubmit();
    });
    await until(() => evaluate(() => document.querySelector('[data-physical-status]').dataset.tone === 'success' &&
        document.querySelector('[data-component-management]').textContent.includes('已關聯卡套需求')), 'assignment notice after switching copies');
    assert.equal(await selected(), '2');
    assert.equal(await evaluate(() => document.querySelector('[data-physical-status]').textContent), '已儲存，畫面已更新。');
    assert.equal(physicalFixture.sqlite.prepare('SELECT component_definition_id FROM v2_sleeve_requirements WHERE size_id=2').get().component_definition_id, physicalFixture.cardId);
    pass('R06 assignment and notice after switching copy and reloading; create and edit checked in regression suites');

    await navigate(components + '?lang=en&copy=1');
    await setCount(0, '24', true);
    await until(async () => (await rowState())[0].status === 'Confirmed', 'English success');
    await captureR06('count-success-en-1280', '[data-count-row]');
    physicalFixture.sqlite.prepare(`
        UPDATE v2_copy_components SET actual_quantity=23, counted_on='2026-01-05', count_revision=count_revision+1
        WHERE owned_copy_id=1 AND component_definition_id=?
    `).run(physicalFixture.cardId);
    await setCount(0, '22', true);
    await until(async () => (await rowState())[0].reload, 'English conflict');
    assert.match((await rowState())[0].status, /The record changed/);
    await captureR06('count-conflict-en-1280', '[data-count-row]');

    physicalFixture.sqlite.exec("UPDATE v2_owned_copies SET seal_status='sealed' WHERE collection_item_id=1");
    await navigate(components + query);
    assert.ok(await evaluate(() => !document.querySelector('[data-count-copy]') &&
        document.querySelector('[data-count-picker] a').pathname.endsWith('/copies') &&
        document.querySelector('[data-component-management] [data-physical-action=create]')));
    await captureR06('no-eligible-copy-zh-1280');
    await navigate(components + '?lang=en');
    await manage();
    await captureR06('no-eligible-copy-en-1280');
    await captureR06('management-expanded-en-1280', '[data-component-management]');
    pass('R06 scenario 8: responsive bilingual captures and no eligible copy');
    console.log('Checks passed: ' + checks);
} finally {
    ws?.close();
    browser?.kill();
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    physicalFixture?.sqlite.close();
    for (const fixture of Object.values(fixtures)) fixture.sqlite.close();
}
