import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';

const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
const screenshots = join(output, 'UI-S3-screenshots');
await mkdir(screenshots, { recursive: true });

const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { dashboardPreview, r01Fixture } from "./tests/helpers/admin-dashboard-preview.ts"; export { accessFixture } from "./tests/helpers/notbgg-access-fixture.ts";',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    define: { 'import.meta.url': JSON.stringify(import.meta.url), 'import.meta.env': 'undefined' },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', harness.outputFiles[0].text)(
    createRequire(import.meta.url), loaded, loaded.exports,
);
const { dashboardPreview, r01Fixture, accessFixture } = loaded.exports;
const fixtures = Object.fromEntries(['normal', 'warning', 'empty', 'failure'].map(state => [state, r01Fixture(state)]));
let server, browser, ws;
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
    const bindings = { ...auth.bindings, DB: fixtures.normal.db };
    const renderPage = await dashboardPreview(bindings);
    server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://' + req.headers.host);
            if (/^\/images\/admin\/[a-z0-9-]+\.webp$/.test(url.pathname)) {
                const image = await readFile('public' + url.pathname);
                res.writeHead(200, { 'Content-Type': 'image/webp' }).end(image);
                return;
            }
            const scenario = url.searchParams.get('fixture') ?? 'normal';
            bindings.DB = fixtures[scenario].db;
            const headers = new Headers(req.headers);
            headers.set('Cf-Access-Jwt-Assertion', token);
            const rendered = await renderPage(new Request(url, { headers }));
            res.writeHead(rendered.status, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(await rendered.text());
        } catch (error) {
            res.writeHead(500).end(String(error));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const profile = await mkdtemp(join(output, 'dashboard-edge-'));
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
        const { cssContentSize } = await cdp('Page.getLayoutMetrics');
        const { data } = await cdp('Page.captureScreenshot', {
            format: 'png', captureBeyondViewport: true,
            clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 },
        });
        await writeFile(join(screenshots, name + '.png'), Buffer.from(data, 'base64'));
    };
    const inspect = () => evaluate(async () => {
        const images = [...document.querySelectorAll('main img, .shell-banner')];
        for (const image of images) image.loading = 'eager';
        await Promise.all(images.map(image => image.decode()));
        const main = document.querySelector('main');
        const columns = name => getComputedStyle(main.querySelector('[data-grid=' + name + ']')).gridTemplateColumns.split(' ').length;
        return {
            width: document.documentElement.scrollWidth,
            status: performance.getEntriesByType('navigation')[0].responseStatus,
            lang: document.documentElement.lang,
            headings: [...main.querySelectorAll('h1,h2')].map(element => element.textContent.trim()),
            actions: [...main.querySelectorAll('.admin-kit-tile')].map(element => element.getAttribute('href')),
            tiles: columns('tiles'),
            stats: columns('stats'),
            panels: [...main.querySelectorAll('.dashboard-panels')].map(grid =>
                getComputedStyle(grid).gridTemplateColumns.split(' ').length),
            alert: main.querySelector('.admin-kit-alert')?.innerText ?? '',
            pending: main.querySelector('[aria-labelledby=pending-work]').textContent,
            text: main.innerText,
            warnings: [...main.querySelectorAll('.admin-kit-notice')].map(element => [
                element.querySelector('summary').textContent.trim(),
                [...element.querySelectorAll('a')].map(link => link.getAttribute('href')),
            ]),
            counts: [...main.querySelectorAll('.admin-kit-number')].map(element => element.innerText.trim()),
            watermark: [...main.querySelectorAll('.admin-kit-watermark')].every(element =>
                Number(getComputedStyle(element).opacity) <= .3 && element.getAttribute('aria-hidden') === 'true'),
        };
    });

    for (const [width, tiles, stats] of [[1440, 5, 4], [768, 3, 2], [375, 2, 2]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await navigate('/admin');
        const result = await inspect();
        assert.equal(result.status, 200);
        assert.deepEqual([result.width, result.tiles, result.stats], [width, tiles, stats]);
        assert.deepEqual(result.panels, width === 375 ? [1, 1] : [3, 3]);
        assert.deepEqual(result.headings, ['管理工作台', '快捷操作', '收藏與資料概況', '待處理項目']);
        assert.deepEqual(result.actions, ['/admin/collection/new', '/admin/collection', '/admin/purchases', '/admin/sleeves', '/admin/bgg']);
        assert.deepEqual(result.counts, ['3', '2', '1', '1']);
        assert.equal(result.alert, '');
        assert.match(result.text, /TWD\s*70\.00/);
        assert.match(result.text, /JPY\s*500/);
        assert.doesNotMatch(result.text, /庫存不足|待確認分類|尚未對應|近期活動/);
        assert.ok(result.watermark);
        await capture('r01-' + width);
        pass('normal state, links, layout and watermarks at ' + width);
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    await navigate('/admin?fixture=warning');
    let result = await inspect();
    assert.match(result.alert, /目前有 1 筆同步失敗/);
    assert.match(result.pending, /BGG 同步失敗/);
    assert.deepEqual(result.warnings, [
        ['不一致 5 筆', [7, 9, 11, 12, 13].map(id => '/admin/purchases?id=' + id)],
        ['待核 2 筆', [8, 10].map(id => '/admin/purchases?id=' + id)],
    ]);
    assert.ok(await evaluate(() => document.querySelector('.admin-kit-pending a').getAttribute('href') === '/admin/bgg?state=failed'));
    await evaluate(() => { for (const details of document.querySelectorAll('main details')) details.open = true; });
    await capture('r01-warnings');
    pass('BGG alert and pending link, both R10 warning categories and order links');

    await navigate('/admin?fixture=empty');
    result = await inspect();
    assert.deepEqual(result.counts, ['0', '0', '0', '0']);
    assert.equal(result.alert, '');
    assert.match(result.pending, /目前沒有待處理項目/);
    assert.equal((result.text.match(/尚未記錄/g) ?? []).length, 2);
    await capture('r01-empty');
    pass('real zero counts, no BGG alert, no recorded costs and empty pending work');

    await navigate('/admin?fixture=failure');
    result = await inspect();
    assert.deepEqual(result.counts, ['3', '2', '1', '1']);
    assert.equal(result.alert, '');
    assert.equal(await evaluate(() => document.querySelectorAll('main .admin-kit-sr').length), 2);
    assert.match(result.text, /JPY\s*500/);
    await capture('r01-section-failure');
    pass('component read failure stays isolated');

    await navigate('/admin?lang=en');
    result = await inspect();
    assert.equal(result.lang, 'en');
    assert.deepEqual(result.headings, ['Management Dashboard', 'Quick actions', 'Collection and data overview', 'Pending work']);
    assert.ok(result.actions.every(href => href.endsWith('?lang=en')));
    await capture('r01-en');
    pass('English content and language-preserving links');

    console.log(checks + ' browser checks passed; 7 synthetic screenshots saved.');
} finally {
    ws?.close();
    browser?.kill();
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    for (const fixture of Object.values(fixtures)) fixture.sqlite.close();
}
