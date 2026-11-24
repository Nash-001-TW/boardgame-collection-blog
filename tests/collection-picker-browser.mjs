import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';

const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
const screenshots = 'docs/R06-picker-screenshots';
const route = '/admin/collection/components/manage';
await mkdir(output, { recursive: true });
await mkdir(screenshots, { recursive: true });

const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { handleCollectionAdminRequest } from "./src/lib/collection-admin-api.ts";' +
            'export { dashboardPreview } from "./tests/helpers/admin-dashboard-preview.ts";' +
            'export { accessFixture } from "./tests/helpers/notbgg-access-fixture.ts";' +
            'export { sleeveWorkflowFixture } from "./tests/helpers/sleeve-workflow-fixture.ts";',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    define: { 'import.meta.url': JSON.stringify(import.meta.url), 'import.meta.env': 'undefined' },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', harness.outputFiles[0].text)(
    createRequire(import.meta.url), loaded, loaded.exports,
);
const { handleCollectionAdminRequest, dashboardPreview, accessFixture, sleeveWorkflowFixture } = loaded.exports;
const fixture = await sleeveWorkflowFixture();
const auth = await accessFixture();
let server, browser, ws;
let checks = 0;
const requests = [];
const search = '[data-collection-picker] input';
const row = '[data-picker-results] a';

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
    const bindings = { ...auth.bindings, DB: fixture.db, PHYSICAL_COMPONENT_SIGNING_KEY: fixture.secret };
    const renderPage = await dashboardPreview(bindings);
    const token = await auth.token();
    const script = (await build({
        entryPoints: ['src/lib/collection-picker-controller.ts'],
        bundle: true, write: false, platform: 'browser', format: 'iife',
    })).outputFiles[0].text;
    fixture.sqlite.exec(`
        INSERT INTO v2_games(id,bgg_id,primary_name) VALUES(8,12345,'百戰天蟲');
        INSERT INTO v2_collection_items(id,game_id,display_name,acquisition_status,record_scope) VALUES
            (137,8,'百戰天蟲','owned','production'),
            (12345,8,'百戰天蟲：擴充','wishlist','production'),
            (12346,8,'百戰天蟲：測試資料','owned','test');
    `);
    const insert = fixture.sqlite.prepare("INSERT INTO v2_collection_items(id,display_name,acquisition_status,record_scope) VALUES(?,?,'preordered','production')");
    for (let i = 0; i < 21; i++) insert.run(200 + i, '游標合成收藏 ' + (i + 1));

    server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://' + req.headers.host);
            const headers = new Headers(req.headers);
            headers.set('Cf-Access-Jwt-Assertion', token);
            const request = new Request(url, { headers });
            let response;
            if (url.pathname === '/api/admin/collection') {
                const query = url.searchParams.get('q');
                requests.push(Object.fromEntries(url.searchParams));
                if (query === 'Timeout') return;
                response = query === 'Unavailable'
                    ? Response.json({ success: false }, { status: 503 })
                    : await handleCollectionAdminRequest(request, bindings);
            } else if (url.pathname === '/picker-controller.js') {
                response = new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
            } else {
                const rendered = await renderPage(request);
                response = new Response((await rendered.text()).replace('</body>', '<script src="/picker-controller.js"></script></body>'),
                    { status: rendered.status, headers: rendered.headers });
            }
            const responseHeaders = new Headers(response.headers);
            responseHeaders.delete('Content-Length');
            res.writeHead(response.status, Object.fromEntries(responseHeaders));
            res.end(await response.text());
        } catch (error) {
            res.writeHead(500);
            res.end(String(error));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const profile = await mkdtemp(join(output, 'r06-edge-'));
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
    if (browser.exitCode !== null) throw new Error('Edge exited before startup: ' + browser.exitCode);
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
    const evaluate = async (fn, ...args) => {
        const result = await cdp('Runtime.evaluate', {
            expression: '(' + fn + ')(...' + JSON.stringify(args) + ')', returnByValue: true,
        });
        assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
        return result.result.value;
    };
    const navigate = async (suffix = '') => {
        const targetUrl = origin + route + suffix;
        await cdp('Page.navigate', { url: targetUrl });
        await until(() => evaluate(url => location.href === url && document.readyState === 'complete', targetUrl), targetUrl);
    };
    const text = selector => evaluate(value => document.querySelector(value)?.textContent.trim(), selector);
    const links = () => evaluate(selector => [...document.querySelectorAll(selector)].map(link => link.textContent), row);
    const expectText = (selector, message) => until(async () => (await text(selector))?.includes(message), message);
    const submit = value => evaluate((selector, query) => {
        const input = document.querySelector(selector);
        input.value = query;
        input.form.requestSubmit();
    }, search, value);
    const press = async (key, code) => {
        await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    };
    const pass = label => console.log('PASS ' + ++checks + ' ' + label);
    async function capture(name) {
        for (const [layout, width, height] of [['desktop', 1440, 900], ['mobile', 375, 812]]) {
            await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: layout === 'mobile' });
            const size = await evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
            assert.equal(size.width, width);
            assert.ok(size.scrollWidth <= width, layout + ' has horizontal overflow');
            const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
            await writeFile(join(screenshots, layout + '-' + name + '.png'), Buffer.from(data, 'base64'));
        }
        await cdp('Emulation.clearDeviceMetricsOverride');
    }

    await navigate();
    assert.equal(await evaluate(selector => document.querySelector(selector)?.type, search), 'search');
    assert.equal(requests.length, 0);
    await capture('initial');
    pass('no parameter shows a search form');

    await submit('百戰');
    await until(async () => (await links()).length === 2, 'production name results');
    assert.ok((await links()).every(value => !value.includes('測試資料')));
    assert.deepEqual(requests.at(-1), { q: '百戰', scope: 'production', view: 'records', limit: '20', after: '0' });
    await capture('results');
    await evaluate(selector => document.querySelector(selector).click(), row);
    await until(() => evaluate(() => location.search === '?collection=137&lang=zh-TW' &&
        document.querySelector('main h2')?.textContent.includes('#137')), 'selected collection');
    assert.equal(await evaluate(selector => !!document.querySelector(selector), search), false);
    pass('name search links to the correct collection and excludes test records');

    await navigate();
    const beforeNumeric = requests.length;
    await submit('12345');
    await until(async () => (await links()).length === 2, 'numeric results');
    assert.deepEqual(requests.slice(beforeNumeric).map(request => request.q).sort(), ['12345', 'bgg:12345']);
    const numeric = await links();
    assert.ok(numeric[0].includes('#137') && numeric[0].includes('依 BGG ID') && !numeric[0].includes('依收藏 ID'));
    assert.ok(numeric[1].includes('#12345') && numeric[1].includes('依收藏 ID') && numeric[1].includes('依 BGG ID'));
    await capture('dual-match');
    pass('numeric BGG results show both bases on one deduplicated row');

    await navigate('?collection=99999');
    await expectText('main [role="alert"]', '找不到收藏');
    assert.ok(await evaluate(selector => !!document.querySelector(selector), search));
    pass('missing collection keeps its error and shows the picker');

    await navigate('?collection=bogus');
    await expectText('main [role="alert"]', '收藏 ID 無效');
    assert.ok(await evaluate(selector => !!document.querySelector(selector), search));
    pass('malformed collection shows the picker');

    await submit('無此合成收藏');
    await expectText('[data-picker-status]', '找不到符合的收藏');
    await capture('empty');
    pass('zero rows show the empty state');

    await submit('Unavailable');
    await expectText('[data-picker-status]', '暫時無法搜尋，請稍後再試');
    assert.equal((await links()).length, 0);
    await capture('unavailable');
    pass('failed API response shows unavailable');

    await submit('Timeout');
    await expectText('[data-picker-status]', '搜尋中');
    await expectText('[data-picker-status]', '暫時無法搜尋，請稍後再試');
    pass('API timeout shows unavailable');

    await navigate('?q=' + encodeURIComponent('百戰'));
    await until(async () => (await links()).length === 2, 'query restored on navigation');
    const beforeReload = requests.length;
    await cdp('Page.reload', { ignoreCache: true });
    await until(async () => requests.length > beforeReload && (await links()).length === 2, 'reload repeats query');
    assert.equal(await evaluate(selector => document.querySelector(selector).value, search), '百戰');
    pass('reload retains the query and repeats the search');

    await evaluate(selector => document.querySelector(selector).focus(), search);
    await press('Tab', 9);
    await press('Tab', 9);
    assert.ok(await evaluate(selector => document.activeElement === document.querySelector(selector) &&
        document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle === 'solid', row));
    await press('Enter', 13);
    await until(() => evaluate(() => new URLSearchParams(location.search).get('collection') === '137'), 'keyboard link activation');
    pass('keyboard reaches a visibly focused row and Enter opens it');

    await navigate('?lang=en&q=' + encodeURIComponent('游標合成收藏'));
    await until(async () => (await links()).length === 20, 'first cursor page');
    assert.ok((await links())[0].includes('Preordered'));
    await evaluate(() => document.querySelector('[data-picker-next]').click());
    await until(async () => (await links()).length === 1, 'second cursor page');
    assert.equal(requests.at(-1).after, '219');
    await evaluate(() => document.querySelector('[data-picker-previous]').click());
    await until(async () => (await links()).length === 20, 'previous cursor page');
    assert.equal(requests.at(-1).after, '0');
    pass('cursor pagination renders 20 records and supports previous and next in English');

    console.log(checks + ' browser checks passed; 10 synthetic screenshots saved.');
} finally {
    ws?.close();
    browser?.kill();
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    fixture.sqlite.close();
    auth.restore();
}
