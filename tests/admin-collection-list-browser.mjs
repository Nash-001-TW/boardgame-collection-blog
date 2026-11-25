import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';

const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
const screenshots = join(output, 'UI-S4-screenshots');
await mkdir(screenshots, { recursive: true });

const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { dashboardPreview, r02Fixture } from "./tests/helpers/admin-dashboard-preview.ts"; export { handleCollectionAdminRequest } from "./src/lib/collection-admin-api.ts"; export { accessFixture } from "./tests/helpers/notbgg-access-fixture.ts";',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    define: { 'import.meta.url': JSON.stringify(import.meta.url), 'import.meta.env': 'undefined' },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', harness.outputFiles[0].text)(
    createRequire(import.meta.url), loaded, loaded.exports,
);
const { dashboardPreview, r02Fixture, accessFixture, handleCollectionAdminRequest } = loaded.exports;
const fixtures = Object.fromEntries(['normal', 'counts', 'list'].map(state => [state, r02Fixture(state === 'normal' ? undefined : state)]));
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
    const bindings = { ...auth.bindings, DB: fixtures.normal.db };
    const renderPage = await dashboardPreview(bindings);
    const client = await build({
        stdin: {resolveDir:process.cwd(), contents:
            'import { initializeCollectionAdmin } from "./src/lib/collection-admin-controller.ts";' +
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
            const request = new Request(url, {headers});
            if (url.pathname === '/r02-client.js') {
                res.writeHead(200, {'Content-Type':'application/javascript'}).end(client.outputFiles[0].text);
                return;
            }
            if (url.pathname === '/api/admin/collection') {
                const response = await handleCollectionAdminRequest(request, bindings);
                res.writeHead(response.status, {'Content-Type':'application/json'}).end(await response.text());
                return;
            }
            const rendered = await renderPage(request);
            res.writeHead(rendered.status, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end((await rendered.text()).replace('</body>', '<script src="/r02-client.js"></script></body>'));
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
    const documentResponse = await fetch(origin + '/admin/collection?status=owned');
    assert.equal(documentResponse.status, 200);
    assert.match(await documentResponse.text(), /data-r02-results/);
    const apiResponse = await fetch(origin + '/api/admin/collection?page=1&tab=owned');
    assert.equal(apiResponse.status, 200);
    assert.equal((await apiResponse.json()).data.list.total, 3);
    console.log('Loopback preflight passed for the Astro list and authenticated paged API.');
    const profile = await mkdtemp(join(output, 'r02-edge-'));
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

    const listPath = '/admin/collection';
    const ready = async () => until(() => evaluate(() => {
        const root = document.querySelector('.admin-r02');
        return root && !root.querySelector('[aria-busy=true]') &&
            (root.querySelector('[data-collection-id], [data-r02-empty]:not([hidden]), [data-r02-error]:not([hidden])') !== null);
    }), 'R02 list settled');
    const open = async query => { await navigate(listPath + query); await ready(); };
    const assertWidth = async width => assert.equal(await evaluate(() => document.documentElement.scrollWidth), width);
    const counts = () => evaluate(() => [...document.querySelectorAll('[data-count]')]
        .map(el => (el.querySelector('[aria-hidden=true]') ?? el).textContent.trim()));
    const rows = () => evaluate(() => [...document.querySelectorAll('[data-collection-id]')].map(el => Number(el.dataset.collectionId)));
    const key = async (name, code) => {
        const params = {key:name, code:name, windowsVirtualKeyCode:code};
        await cdp('Input.dispatchKeyEvent', {type:'rawKeyDown', ...params});
        if (name === 'Enter') await cdp('Input.dispatchKeyEvent', {type:'char', ...params, text:'\r', unmodifiedText:'\r'});
        await cdp('Input.dispatchKeyEvent', {type:'keyUp', ...params});
    };

    for (const width of [1440, 768, 375]) {
        await cdp('Emulation.setDeviceMetricsOverride', {width, height:900, deviceScaleFactor:1, mobile:false});
        await open('');
        await assertWidth(width);
        assert.deepEqual(await counts(), ['48', '3', '2', '1']);
        assert.equal((await rows()).length, 20);
        const layout = await evaluate(() => ({
            display:getComputedStyle(document.querySelector('tr[data-collection-id]')).display,
            status:document.querySelector('main h1').textContent.trim(),
            minHeight:Math.min(...[...document.querySelectorAll('.admin-r02 a, .admin-r02 button, .admin-r02 summary, .admin-r02 input, .admin-r02 select')]
                .filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect().height)),
        }));
        assert.deepEqual([layout.display, layout.status], [width === 375 ? 'grid' : 'table-row', '收藏管理']);
        assert.ok(layout.minHeight >= 44);
        if (width === 375) {
            assert.ok(await evaluate(() => {
                const [cover, name, status] = document.querySelector('tr[data-collection-id]').cells;
                const coverBox = cover.getBoundingClientRect();
                const nameBox = name.getBoundingClientRect();
                const statusBox = status.getBoundingClientRect();
                return coverBox.top === nameBox.top && coverBox.right === nameBox.left
                    && statusBox.top >= coverBox.bottom && statusBox.width === coverBox.width + nameBox.width
                    && getComputedStyle(cover.querySelector('.admin-kit-cell-label')).display === 'none'
                    && getComputedStyle(name.querySelector('.admin-kit-cell-label')).display === 'none'
                    && name.querySelector('small').textContent.includes('#');
            }));
        }
        await evaluate(async () => {
            const cover = document.querySelector('tr[data-collection-id] img');
            if (cover) await cover.decode();
        });
        await capture('r02-' + width);
        pass(width + 'px, 20 rows, 44px controls, no horizontal scrolling');
    }
    await cdp('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});

    scenario = 'counts';
    await open('');
    assert.equal((await rows()).length, 20);
    assert.deepEqual(await counts(), ['—', '—', '—', '—']);
    assert.equal(await evaluate(() => document.querySelectorAll('[data-count] .admin-kit-sr').length), 4);
    await capture('r02-counts-unavailable');
    pass('unavailable tab counts leave rows visible');

    scenario = 'list';
    await open('');
    assert.deepEqual(await counts(), ['48', '3', '2', '1']);
    assert.ok(await evaluate(() => !document.querySelector('[data-r02-error]').hidden && document.querySelector('[data-r02-empty]').hidden));
    assert.ok(await evaluate(() => {
        const banner = document.querySelector('[data-r02-error]');
        return !!banner.closest('[aria-live="assertive"]')
            && banner.querySelector('a').textContent.trim() === '重試'
            && document.querySelector('[data-admin-status]').textContent.trim() === '';
    }));
    await capture('r02-list-unavailable');
    scenario = 'normal';
    await evaluate(() => document.querySelector('[data-r02-error] a').click());
    await ready();
    assert.equal((await rows()).length, 20);
    pass('unavailable list preserves counts and can be retried');

    await open('?q=zz-no-results');
    assert.ok(await evaluate(() => !document.querySelector('[data-r02-empty]').hidden && document.querySelector('[data-r02-error]').hidden));
    await capture('r02-empty');
    await evaluate(() => document.querySelector('[data-r02-empty] a').click());
    await until(() => evaluate(() => !new URL(location.href).searchParams.has('q')), 'clear URL');
    await ready();
    pass('empty state and clear filters');

    await open('');
    await evaluate(() => document.querySelector('.admin-r02-search summary').focus());
    await key('Enter', 13);
    await until(() => evaluate(() => document.querySelector('.admin-r02-search details').open), 'more filters opened by Enter');
    assert.equal(await evaluate(() => document.querySelector('select[name=status]').length), 8);
    await capture('r02-more-filters');
    await evaluate(() => { document.querySelector('.admin-r02-search details').open = false; });
    await evaluate(() => document.querySelector('tr[data-collection-id] summary').focus());
    await key('Enter', 13);
    await until(() => evaluate(() => document.querySelector('.admin-r02-actions').open), 'actions opened by Enter');
    await key('Tab', 9);
    assert.ok(await evaluate(() => document.activeElement.matches('.admin-r02-actions a')));
    assert.equal(await evaluate(() => document.querySelectorAll('.admin-r02-actions[open] a').length), 5);
    await capture('r02-actions');
    await key('Escape', 27);
    assert.ok(await evaluate(() => !document.querySelector('.admin-r02-actions').open && document.activeElement.matches('.admin-r02-actions summary')));
    pass('more filters and keyboard operation with focus restoration');

    await open('?view=grouped');
    assert.equal(await evaluate(() => document.querySelectorAll('[data-collection-group]').length), 4);
    assert.deepEqual((await rows()).slice(0, 2), [1, 2]);
    await capture('r02-grouped');
    pass('group headers and contiguous collection records');

    await open('?lang=en');
    assert.ok(await evaluate(() => document.documentElement.lang === 'en' && /More filters/.test(document.querySelector('main').innerText)));
    await capture('r02-en');
    pass('English labels and scope-aware actions');

    await evaluate(() => {
        const q = document.querySelector('[name=q]');
        q.value = 'Synthetic edition';
        const players = document.querySelector('[name=players]');
        players.value = '4';
        players.dispatchEvent(new Event('change', {bubbles:true}));
    });
    await until(() => evaluate(() => new URL(location.href).searchParams.get('players') === '4'), 'filter URL');
    await ready();
    const filtered = await rows();
    const filterUrl = await evaluate(() => location.href);
    await cdp('Page.reload');
    await until(() => evaluate(url => location.href === url && document.readyState === 'complete', filterUrl), 'reload');
    await ready();
    assert.deepEqual(await rows(), filtered);
    assert.equal(await evaluate(() => document.querySelector('[name=q]').value), 'Synthetic edition');
    await evaluate(() => document.querySelector('[aria-label="Next page"]').click());
    await until(() => evaluate(() => new URL(location.href).searchParams.get('page') === '2'), 'second page');
    await ready();
    assert.notDeepEqual(await rows(), filtered);
    await evaluate(() => document.querySelector('[data-r02-pagination]').scrollIntoView({block:'end'}));
    await capture('r02-pagination');
    await evaluate(() => document.querySelector('[aria-label="Previous page"]').click());
    await until(() => evaluate(() => new URL(location.href).searchParams.get('page') === '1'), 'first page');
    await ready();
    assert.deepEqual(await rows(), filtered);
    await evaluate(() => history.back());
    await until(() => evaluate(() => new URL(location.href).searchParams.get('page') === '2'), 'browser history');
    await ready();
    await evaluate(() => history.forward());
    await until(() => evaluate(() => new URL(location.href).searchParams.get('page') === '1'), 'browser forward');
    await ready();
    assert.deepEqual(await rows(), filtered);
    pass('filter URL, reload, pagination and browser history');

    for (const [query, tab, records] of [
        ['status=owned','owned',[1,2,5]], ['wishlist=1','wishlist',[2,3]], ['status=preordered','preordered',[3]],
        ['tab=owned','owned',[1,3,5]], ['tab=wishlist','wishlist',[2,3]], ['tab=preordered','preordered',[3]],
    ]) {
        await open('?' + query);
        assert.deepEqual(await rows(), records);
        assert.ok(await evaluate(tab => [...document.querySelectorAll('.shell-nav [aria-current=page]')]
            .some(link => new URL(link.href).searchParams.get('tab') === tab), tab));
        if (!query.startsWith('tab=')) assert.equal(await evaluate(() => document.querySelector('[data-r02-chips]').childElementCount), 1);
    }
    await open('?status=owned&scope=test&q=Test');
    assert.equal(await evaluate(() => new URL(document.querySelector('[data-language-switch]').href).searchParams.toString()),
        'status=owned&scope=test&q=Test&lang=en');
    pass('new sidebar links and legacy filter URLs');

    await open('');
    const contrast = await evaluate(() => {
        const luminance = color => {
            const values = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255);
            const linear = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
            return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        const selectors = [
            '[data-r02-new]', '[data-tab=all]', '[data-tab=owned]', '[data-tab=wishlist] [data-count]',
            '.admin-r02 th', '.admin-r02 td small', '.admin-r02-cover', '.admin-r02 h1',
            ...['success','wish','preorder','neutral'].map(tone => '.admin-r02 .admin-kit-badge[data-tone=' + tone + ']'),
        ];
        return selectors.map(selector => {
            const element = document.querySelector(selector);
            const foreground = getComputedStyle(element).color;
            let surface = element;
            while (getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') surface = surface.parentElement;
            const [light, dark] = [luminance(foreground), luminance(getComputedStyle(surface).backgroundColor)].sort((a,b) => b - a);
            return [selector, (light + 0.05) / (dark + 0.05)];
        });
    });
    for (const [selector, ratio] of contrast) assert.ok(ratio >= 4.5, selector + ' contrast ' + ratio);
    pass('WCAG AA contrast ' + contrast.length + '/' + contrast.length + ', minimum ' + Math.min(...contrast.map(([,ratio]) => ratio)).toFixed(2) + ':1');

    console.log(checks + ' browser checks passed; 11 synthetic screenshots saved.');
} finally {
    ws?.close();
    browser?.kill();
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    for (const fixture of Object.values(fixtures)) fixture.sqlite.close();
}
