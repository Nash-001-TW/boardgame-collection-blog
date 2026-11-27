import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';

const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
const screenshots = join(output, 'UI-S1-screenshots');
await mkdir(screenshots, { recursive: true });

const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { dashboardPreview } from "./tests/helpers/admin-dashboard-preview.ts";' +
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
const { dashboardPreview, accessFixture, sleeveWorkflowFixture } = loaded.exports;
const fixture = await sleeveWorkflowFixture();
const auth = await accessFixture();
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
    const bindings = { ...auth.bindings, DB: fixture.db, PHYSICAL_COMPONENT_SIGNING_KEY: fixture.secret };
    const renderPage = await dashboardPreview(bindings);
    const token = await auth.token();
    // Astro Container emits the actual page markup. Serve the bundled shell script separately.
    const script = (await build({
        stdin: {
            resolveDir: process.cwd(),
            contents: 'import "./src/lib/admin-navigation"; import {connectAdminShell} from "./src/lib/admin-shell-controller"; connectAdminShell();',
        },
        bundle: true, write: false, platform: 'browser', format: 'iife',
    })).outputFiles[0].text;
    const banner = new Map(await Promise.all([800, 1600].map(async width => {
        const path = '/images/admin/banner-' + width + '.webp';
        return [path, await readFile('public' + path)];
    })));
    server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://' + req.headers.host);
            if (banner.has(url.pathname)) {
                res.writeHead(200, { 'Content-Type': 'image/webp' }).end(banner.get(url.pathname));
                return;
            }
            if (url.pathname === '/shell.js') {
                res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script);
                return;
            }
            const headers = new Headers(req.headers);
            headers.set('Cf-Access-Jwt-Assertion', token);
            const rendered = await renderPage(new Request(url, { headers }));
            const responseHeaders = new Headers(rendered.headers);
            responseHeaders.delete('Content-Length');
            res.writeHead(rendered.status, Object.fromEntries(responseHeaders));
            res.end((await rendered.text()).replace('</body>', '<script src="/shell.js"></script></body>'));
        } catch (error) {
            res.writeHead(500).end(String(error));
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const profile = await mkdtemp(join(output, 'shell-edge-'));
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
    const routes = [
        ['overview', '/admin', '/admin'],
        ['collection', '/admin/collection', '/admin/collection'],
        ['collection-new', '/admin/collection/new', '/admin/collection'],
        ['collection-edit', '/admin/collection/1', '/admin/collection'],
        ['copies', '/admin/collection/1/copies', '/admin/collection'],
        ['components', '/admin/collection/1/components', '/admin/collection'],
        ['classification', '/admin/collection/components/classification', '/admin/collection/components/classification'],
        ['sleeves', '/admin/sleeves', '/admin/sleeves'],
        ['requirements', '/admin/collection/1/sleeves', '/admin/collection'],
        ['related-purchases', '/admin/collection/1/purchases', '/admin/collection'],
        ['purchases', '/admin/purchases', '/admin/purchases'],
        ['bgg', '/admin/bgg', '/admin/bgg'],
        ['notbgg', '/admin/notbgg', '/admin/notbgg'],
        ['notbgg-new', '/admin/notbgg/new', '/admin/notbgg'],
        ['notbgg-edit', '/admin/notbgg/000001', '/admin/notbgg'],
        ['notbgg-link', '/admin/notbgg/000001/link', '/admin/notbgg'],
        ['notbgg-relations', '/admin/notbgg/000001/relations', '/admin/notbgg'],
    ];
    const setViewport = width => cdp('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    let captures = 0;
    const capture = async name => {
        const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
        await writeFile(join(screenshots, name + '.png'), Buffer.from(data, 'base64'));
        captures++;
    };
    for (const width of [1440, 768, 375]) {
        await setViewport(width);
        for (const [name, path, expected] of routes) {
            await navigate(path);
            const result = await evaluate(() => {
                const current = [...document.querySelectorAll('.shell-nav [aria-current=page]')];
                const image = document.querySelector('.shell-banner');
                const group = current[0]?.closest('.shell-group');
                return {
                    current: current.map(a => a.getAttribute('href')),
                    currentLabel: current[0]?.textContent.trim(),
                    expanded: group?.querySelector('button')?.getAttribute('aria-expanded') ?? null,
                    main: document.querySelectorAll('main').length,
                    skipTarget: document.querySelectorAll('#editor-content').length,
                    status: performance.getEntriesByType('navigation')[0].responseStatus,
                    pageWidth: document.documentElement.scrollWidth,
                    image: image ? { height: image.height, width: image.width, loaded: image.naturalWidth > 0,
                        alt: image.alt, hidden: image.getAttribute('aria-hidden'), position: getComputedStyle(image).objectPosition } : null,
                };
            });
            assert.equal(result.status, 200, path);
            assert.deepEqual(result.current, [expected], path);
            if (name === 'bgg') assert.equal(result.currentLabel, 'BGG 同步與快取');
            assert.equal(result.expanded, name === 'overview' ? null : 'true', path);
            assert.equal(result.main, 1, path);
            assert.equal(result.skipTarget, 1, path);
            assert.ok(result.pageWidth <= width, path + ' overflows at ' + width + ': ' + result.pageWidth);
            if (name === 'overview') {
                assert.ok(result.image.loaded && result.image.alt === '' && result.image.hidden === 'true');
                if (width === 375) {
                    assert.equal(result.image.height, 72);
                    assert.equal(result.image.position, '50% 62%');
                } else {
                    assert.ok(Math.abs(result.image.height - result.image.width / 3) <= 1);
                }
            } else assert.equal(result.image, null, path);
            await capture(width + '-' + name);
        }
        pass('16 routes, active items, default groups, main, overflow and banner at ' + width);
    }
    for (const width of [768, 375]) {
        await setViewport(width);
        await navigate('/admin/collection');
        await evaluate(() => document.querySelector('[data-shell-open]').click());
        const drawerState = await evaluate(() => ({
            modal: document.querySelector('[data-shell-drawer]').matches(':modal'),
            expanded: document.querySelector('[data-shell-open]').getAttribute('aria-expanded'),
            focused: document.activeElement.matches('[data-shell-close]'),
        }));
        assert.deepEqual(drawerState, { modal: true, expanded: 'true', focused: true });
        assert.ok(await evaluate(() => {
            document.querySelector('main a').focus();
            const drawer = document.querySelector('[data-shell-drawer]');
            return drawer.contains(document.activeElement) && getComputedStyle(drawer).overscrollBehavior === 'contain';
        }));
        await capture(width + '-drawer');
        await press('Escape', 27);
        await until(() => evaluate(() => !document.querySelector('[data-shell-drawer]').open &&
            document.activeElement.matches('[data-shell-open]') &&
            document.activeElement.getAttribute('aria-expanded') === 'false'), 'Escape restores menu button');
        await evaluate(() => document.querySelector('[data-shell-open]').click());
        await evaluate(() => document.querySelector('[data-shell-close]').click());
        await until(() => evaluate(() => !document.querySelector('[data-shell-drawer]').open &&
            document.activeElement.matches('[data-shell-open]')), 'close button restores menu button');
        pass('modal drawer, background isolation, Escape and close button at ' + width);
    }

    await setViewport(1440);
    await navigate('/admin/collection?status=owned&scope=test&q=synthetic');
    const groupState = () => evaluate(() => [
        document.querySelector('[aria-controls=admin-nav-collection]').getAttribute('aria-expanded'),
        document.getElementById('admin-nav-collection').hidden,
    ]);
    assert.deepEqual(await groupState(), ['true', false]);
    await evaluate(() => {
        const group = document.querySelector('[aria-controls=admin-nav-collection]');
        group.focus();
        group.click();
    });
    assert.deepEqual(await groupState(), ['false', true]);
    await evaluate(() => document.querySelector('[aria-controls=admin-nav-collection]').click());
    assert.deepEqual(await groupState(), ['true', false]);
    pass('current group opens by default and toggles with its button');

    await press('Tab', 9);
    assert.ok(await evaluate(() => document.activeElement.matches('.shell-nav a[href="/admin/collection"]') &&
        document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle === 'solid'));
    await capture('1440-keyboard-focus');
    pass('Tab visits the sidebar with a visible focus indicator');

    const targets = await evaluate(() => ({
        links: [...document.querySelectorAll('#admin-nav-collection a')].map(link => link.search),
        current: document.querySelector('.shell-nav [aria-current=page]').search,
        language: Object.fromEntries(new URL(document.querySelector('[data-language-switch]').href).searchParams),
    }));
    // Q135 (#35) adds the collection combinations entry to the collection group.
    assert.deepEqual(targets.links, ['', '?tab=owned', '?tab=wishlist', '?tab=preordered', '?view=relations&domain=collection', '']);
    assert.equal(targets.current, '?tab=owned');
    assert.deepEqual(targets.language, { status: 'owned', scope: 'test', q: 'synthetic', lang: 'en' });
    await navigate('/admin/bgg?view=relations&lang=en');
    assert.ok(await evaluate(() => document.documentElement.lang === 'en' &&
        document.querySelector('.shell-nav [aria-current=page]').textContent.trim() === 'Game relations' &&
        new URL(document.querySelector('[data-language-switch]').href).searchParams.get('view') === 'relations'));
    pass('collection filters, BGG relations and query-preserving language switch');

    // Compare actual computed colors for shell text, icons, current markers and the focus edge.
    const samples = await evaluate(() => {
        const samples = [];
        const style = selector => getComputedStyle(document.querySelector(selector));
        const sidebar = style('.shell-sidebar').backgroundColor;
        const current = style('.shell-nav [aria-current=page]');
        const focusTarget = document.querySelector('.shell-nav [aria-current=page]');
        focusTarget.focus();
        samples.push(['Brand', style('.shell-brand strong').color, sidebar, 4.5]);
        samples.push(['Brand subtitle', style('.shell-brand small').color, sidebar, 4.5]);
        samples.push(['Navigation', style('.shell-nav button').color, sidebar, 4.5]);
        samples.push(['Footer', style('.shell-footer a').color, sidebar, 4.5]);
        samples.push(['Icon', style('.shell-nav button svg').color, sidebar, 3]);
        samples.push(['Current text', current.color, current.backgroundColor, 4.5]);
        samples.push(['Current marker', current.borderLeftColor, current.backgroundColor, 3]);
        samples.push(['Focus edge', current.outlineColor, sidebar, 3]);
        const surface = style('body').backgroundColor;
        const body = style('body');
        const read = name => body.getPropertyValue(name).trim();
        for (const name of ['success', 'warning', 'danger', 'info', 'neutral', 'wish', 'preorder']) {
            samples.push([name, read('--' + name), read('--' + name + '-soft'), 4.5]);
        }
        samples.push(['Muted text', read('--ink-muted'), surface, 4.5]);
        return samples;
    });
    function luminance(color) {
        const rgb = color.startsWith('#') ? color.slice(1).match(/../g).map(hex => Number.parseInt(hex, 16))
            : color.match(/\d+/g).slice(0, 3).map(Number);
        return rgb.map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92
            : ((channel + .055) / 1.055) ** 2.4).reduce((total, channel, i) => total + channel * [.2126, .7152, .0722][i], 0);
    }
    for (const [label, text, background, minimum] of samples) {
        const values = [luminance(text), luminance(background)].sort((a, b) => b - a);
        const ratio = (values[0] + .05) / (values[1] + .05);
        assert.ok(ratio >= minimum, label + ' contrast: ' + ratio.toFixed(2));
        console.log('CONTRAST ' + label + ' ' + ratio.toFixed(2) + ':1');
    }
    pass(samples.length + ' WCAG AA color pairs');
    console.log(checks + ' browser checks passed; ' + captures + ' synthetic screenshots saved.');
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
