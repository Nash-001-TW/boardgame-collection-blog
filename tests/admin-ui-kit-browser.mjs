import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';

const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
const screenshots = join(output, 'UI-S2-screenshots');
await mkdir(screenshots, { recursive: true });

const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { dashboardPreview } from "./tests/helpers/admin-dashboard-preview.ts";',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
    define: { 'import.meta.url': JSON.stringify(import.meta.url), 'import.meta.env': 'undefined' },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', harness.outputFiles[0].text)(
    createRequire(import.meta.url), loaded, loaded.exports,
);
const { dashboardPreview } = loaded.exports;
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

    const renderPage = await dashboardPreview({}, { dev: true });
    server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://' + req.headers.host);
            if (/^\/images\/admin\/[a-z-]+\.webp$/.test(url.pathname)) {
                const image = await readFile('public' + url.pathname);
                res.writeHead(200, { 'Content-Type': 'image/webp' }).end(image);
                return;
            }
            const rendered = await renderPage(new Request(url));
            const headers = new Headers(rendered.headers);
            headers.delete('Content-Length');
            headers.set('Content-Type', 'text/html; charset=utf-8');
            res.writeHead(rendered.status, Object.fromEntries(headers));
            res.end(await rendered.text());
        } catch (error) {
            res.writeHead(500).end(String(error));
        }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const profile = await mkdtemp(join(output, 'kit-edge-'));
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
    const press = async (key, code) => {
        await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
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
    const closeup = async (selector, name, focus = false) => {
        const clip = await evaluate((selector, focus) => {
            const element = document.querySelector(selector);
            if (focus) element.querySelector('button').focus();
            const rect = element.getBoundingClientRect();
            return { x: Math.max(0, rect.left + scrollX - 10), y: Math.max(0, rect.top + scrollY - 10),
                width: rect.width + 20, height: rect.height + 20, scale: 1 };
        }, selector, focus);
        const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
        await writeFile(join(screenshots, name + '.png'), Buffer.from(data, 'base64'));
    };

    assert.equal((await fetch(origin + '/dev/ui-kit')).status, 200);
    for (const [width, columns] of [[1440, 5], [768, 3], [375, 2]]) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await navigate('/dev/ui-kit');
        const result = await evaluate(async () => {
            const images = [...document.querySelectorAll('main img')];
            for (const img of images) img.loading = 'eager';
            await Promise.all(images.map(img => img.decode()));
            return {

                width: document.documentElement.scrollWidth,
                columns: getComputedStyle(document.querySelector('[data-grid=tiles]')).gridTemplateColumns.split(' ').length,
                statColumns: getComputedStyle(document.querySelector('[data-grid=stats]')).gridTemplateColumns.split(' ').length,
                tableRow: getComputedStyle(document.querySelector('.admin-kit-table tbody tr')).display,
                buttons: [...document.querySelectorAll('main button')].filter(el => el.getClientRects().length).every(el => el.offsetHeight >= 44 && el.offsetWidth >= 44),
                statOpacity: getComputedStyle(document.querySelector('.admin-kit-watermark')).opacity,
                stepperAligned: new Set([...document.querySelector('.admin-kit-stepper').children].slice(0, 3)
                    .map(el => el.getBoundingClientRect().top + el.offsetHeight / 2)).size === 1,
                main: document.querySelectorAll('main').length,
            };
        });

        assert.equal(result.main, 1);
        assert.equal(result.width, width);
        assert.equal(result.columns, columns);
        assert.equal(result.statColumns, width === 1440 ? 4 : 2);
        assert.equal(result.tableRow, width === 375 ? 'grid' : 'table-row');
        assert.ok(result.buttons);
        assert.ok(result.stepperAligned);
        assert.ok(Number(result.statOpacity) <= .3);
        await capture('ui-kit-' + width);
        if (width === 1440) {
            await press('Tab', 9);
            await closeup('#buttons', 'buttons-focus', true);
            await closeup('#stats', 'unavailable-stat');
            await closeup('#alerts', 'unavailable-alert');
            await closeup('#empty', 'empty-and-error');
        }
        pass('layout, touch size and illustration at ' + width);
    }

    await navigate('/dev/ui-kit?lang=en');
    assert.equal(await evaluate(() => document.documentElement.lang), 'en');
    await evaluate(() => document.querySelector('#tab-overview').focus());
    await press('ArrowRight', 39);
    assert.deepEqual(await evaluate(() => [document.activeElement.id, new URLSearchParams(location.search).get('tab'),
        document.querySelector('#panel-copies').hidden]), ['tab-copies', 'copies', false]);
    await evaluate(() => document.querySelector('[data-step="1"]').click());
    assert.equal(await evaluate(() => document.querySelector('#demo-quantity').value), '4');
    await evaluate(() => document.querySelector('#buttons button').click());
    assert.ok(await evaluate(() => document.querySelector('#kit-confirm').open));
    await press('Escape', 27);
    assert.ok(await evaluate(() => !document.querySelector('#kit-confirm').open));
    pass('English, tab keyboard and URL, stepper and confirmation dialog');
    await navigate('/dev/ui-kit?lang=en&q=Evergreen&state=owned&sort=desc&page=8');
    assert.deepEqual(await evaluate(() => [
        document.querySelectorAll('.admin-kit-chip').length,
        document.querySelectorAll('.admin-kit-table tbody tr').length,
        document.querySelector('[aria-sort]').getAttribute('aria-sort'),
        document.querySelector('#pagination [aria-current]').textContent,
    ]), [2, 1, 'descending', '8']);
    pass('filter, sorting and pagination query states');
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('[aria-busy=true] .admin-kit-spinner')).animationName), 'none');
    const pairs = await evaluate(() => {
        const samples = ['[data-variant=primary]', '[data-variant=secondary]', '[data-variant=danger]',
            '[data-variant=ghost]', ...['brand', 'wood', 'success', 'warning'].map(tone => '.admin-kit-tile[data-tone=' + tone + ']'),
            ...['brand', 'wish', 'preorder', 'success'].map(tone => '.admin-kit-stat[data-tone=' + tone + ']'),
            ...['danger', 'info', 'success', 'neutral'].map(tone => '.admin-kit-badge[data-tone=' + tone + ']'),
            '.admin-kit-alert[data-tone=danger]', '.admin-kit-alert[data-tone=warning]', '.admin-kit-notice[data-tone=danger]',
            '.admin-kit-notice[data-tone=info]', '.admin-kit-field', '.admin-kit-header time'];
        return samples.map(selector => {
            const element = document.querySelector(selector);
            const foreground = getComputedStyle(element).color;
            let background = 'rgba(0, 0, 0, 0)';
            for (let current = element; current && background === 'rgba(0, 0, 0, 0)'; current = current.parentElement) {
                background = getComputedStyle(current).backgroundColor;
            }
            return [selector, foreground, background === 'rgba(0, 0, 0, 0)' ? 'rgb(255, 255, 255)' : background];
        });
    });
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    for (const [selector, foreground, background] of pairs) {
        const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
        const ratio = (high + .05) / (low + .05);
        assert.ok(ratio >= 4.5, selector + ' contrast: ' + ratio.toFixed(2));
        console.log('CONTRAST ' + selector + ' ' + ratio.toFixed(2) + ':1');
    }
    pass('reduced motion and ' + pairs.length + ' WCAG AA color pairs');
    console.log(checks + ' browser checks passed; 7 synthetic screenshots saved.');
} finally {
    ws?.close();
    browser?.kill();
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}
