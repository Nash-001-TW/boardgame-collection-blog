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
const loaded = { exports: {} };
new Function('require', 'module', 'exports', harness.outputFiles[0].text)(
    createRequire(import.meta.url), loaded, loaded.exports,
);
const { dashboardPreview, collectionDetailFixture, accessFixture, handleCollectionAdminRequest, handleCollectionCopiesRequest } = loaded.exports;
const fixtures = Object.fromEntries(['normal', 'header', 'copies'].map(state => [state, collectionDetailFixture(state === 'normal' ? undefined : state)]));
let server, browser, ws;
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
            const headers = new Headers(req.headers);
            headers.set('Cf-Access-Jwt-Assertion', token);
            const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(await Array.fromAsync(req));
            const request = new Request(url, {headers, method:req.method, body});
            if (url.pathname === '/s5a-client.js') {
                res.writeHead(200, {'Content-Type':'application/javascript'}).end(client.outputFiles[0].text);
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
    function cdp(method, params = {}) {
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
            ws.send(JSON.stringify({ id, method, params }));
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
        await until(() => evaluate(url => location.href === url && document.readyState === 'complete', targetUrl), targetUrl);
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
        ['/admin/collection/components/manage', '?collection=6&scope=test&lang=en'],
        ['/admin/sleeves/requirements', '?collection=6&scope=test&lang=en'],
        ['/admin/purchases', '?collection=6&scope=test&lang=en'],
    ]);
    await capture('english');
    pass('English, NotBGG public link and three legacy destinations retain scope and language');

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
    const onPath = path => until(() => evaluate(url => location.href === url && document.readyState === 'complete', origin + path + query), path);
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
    console.log('Checks passed: ' + checks);
} finally {
    ws?.close();
    browser?.kill();
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    for (const fixture of Object.values(fixtures)) fixture.sqlite.close();
}
