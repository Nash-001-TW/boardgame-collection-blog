// Candidate only: rendered R06 form + actual controller + authenticated API against disposable SQLite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
const output = process.argv[2];
const photoMode = process.argv[3] === '--photos';
if (!output) throw new Error('A disposable artifact directory is required');
// A4 validation leaves the reviewed A3 screenshots intact.
const screenshots = join(output, 'D1-A3-screenshots');
const historyScreenshots = join(output, 'D1-A4-screenshots');
await mkdir(output, { recursive: !photoMode });

// Resolve the fixture's extensionless TypeScript imports without changing the authorized Node command.
const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { handlePhysicalComponentRequest } from "./src/lib/physical-component-admin-api.ts";' +
            'export { adminPhotoPath, handleComponentPhotoRead, handleComponentPhotoWrite } from "./src/lib/component-photo-api.ts";' +
            'export { memoryPhotoStore } from "./tests/helpers/component-photo-store.ts";' +
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
const { handlePhysicalComponentRequest, dashboardPreview, accessFixture, sleeveWorkflowFixture,
    adminPhotoPath, handleComponentPhotoRead, handleComponentPhotoWrite, memoryPhotoStore } = loaded.exports;
const fixture = await sleeveWorkflowFixture();
const auth = await accessFixture();
let server, browser, ws;
const submitted = [];
let nextCommit;
let blockedCommitKey;
let rejectStatus = false;
let rejectCreateCount = false;
let releaseCommit;
const timeoutMs = 4_000;

async function until(check, label) {
    const deadline = Date.now() + 15_000;
    let lastError;
    while (Date.now() < deadline) {
        try {
            if (await check()) return;
        } catch (error) {
            // Page reload can invalidate an evaluation context.
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw new Error('Timed out: ' + label, { cause: lastError });
}

try {
    const bindings = { ...auth.bindings, DB: fixture.db, PHYSICAL_COMPONENT_SIGNING_KEY: fixture.secret,
        NOTBGG_WRITE_LIMITER: { limit: async () => ({ success: true }) }, COMPONENT_PHOTOS: memoryPhotoStore() };
    const renderPage = await dashboardPreview(bindings);
    const token = await auth.token();
    const entry = 'src/lib/physical-component-admin-controller.ts';
    const source = await readFile(entry, 'utf8');
    const productionTimeout = 'setTimeout(() => controller.abort(), quantityTimeoutMs)';
    assert.ok(source.includes(productionTimeout), 'test timeout injection must match the production constant');
    const script = (await build({
        stdin: { contents: source.replace(productionTimeout,
            'setTimeout(() => controller.abort(), window.d1QuantityTimeoutForTest ?? quantityTimeoutMs)'),
            sourcefile: entry, resolveDir: 'src/lib', loader: 'ts' },
        bundle: true, write: false, platform: 'browser', format: 'iife',
    })).outputFiles[0].text;
    fixture.sqlite.exec("UPDATE v2_owned_copies SET copy_label = 'Open box' WHERE id = 1");
    fixture.sqlite.exec('UPDATE v2_copy_components SET actual_quantity = 28 WHERE owned_copy_id = 1');
    server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://' + req.headers.host);
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const request = new Request(url, { method: req.method, headers: req.headers,
                body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
            let response;
            if (url.pathname === '/api/admin/collection/components') {
                const raw = await request.clone().text();
                const body = JSON.parse(raw);
                const key = request.headers.get('Idempotency-Key');
                submitted.push({ body, raw, key });
                if (body.action === 'quantity-commit') {
                    // Edge may retry a dropped HTTP exchange before fetch rejects. Keep dropping this
                    // operation until the controller reaches its explicit status check.
                    if (key === blockedCommitKey) { res.destroy(); return; }
                    const mode = nextCommit;
                    nextCommit = undefined;
                    if (mode === 'not-delivered') {
                        blockedCommitKey = key;
                        res.destroy();
                        return;
                    }
                    if (mode === 'timeout') return; // Wait for the controller to abort; leave SQLite untouched.
                    if (mode === 'hold') await new Promise(resolve => { releaseCommit = resolve; });
                    response = await handlePhysicalComponentRequest(request, bindings);
                    if (mode === 'lost-reply' && response.ok) {
                        blockedCommitKey = key;
                        res.destroy();
                        return;
                    }
                } else if (body.action === 'count' && rejectCreateCount) {
                    rejectCreateCount = false;
                    response = Response.json({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 });
                } else if (body.action === 'quantity-status' && rejectStatus) {
                    rejectStatus = false;
                    response = Response.json({ success: false, error: { code: 'FORBIDDEN' } }, { status: 403 });
                } else {
                    if (body.action === 'quantity-status' && key === blockedCommitKey) blockedCommitKey = undefined;
                    response = await handlePhysicalComponentRequest(request, bindings);
                }
            } else if (photoMode && url.pathname === adminPhotoPath) {
                response = await handleComponentPhotoWrite(request, bindings);
            } else if (photoMode && url.pathname.startsWith(adminPhotoPath + '/')) {
                response = await handleComponentPhotoRead(request, bindings, url.pathname.split('/').at(-1), true);
            } else if (photoMode && url.pathname.startsWith('/media/components/')) {
                response = await handleComponentPhotoRead(request, bindings, url.pathname.split('/').at(-1), false);
            } else if (url.pathname === '/physical-controller.js') {
                response = new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
            } else {
                const rendered = await renderPage(request);
                response = new Response((await rendered.text()).replace('</body>', '<script src="/physical-controller.js"></script></body>'),
                    { status: rendered.status, headers: rendered.headers });
            }
            const headers = new Headers(response.headers);
            headers.delete('Content-Length');
            res.writeHead(response.status, Object.fromEntries(headers));
            res.end(Buffer.from(await response.arrayBuffer()));
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
    async function evaluate(fn, ...args) {
        const response = await cdp('Runtime.evaluate', {
            expression: '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')',
            awaitPromise: true, returnByValue: true,
        });
        if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
        return response.result.value;
    }
    const select = 'form[data-physical-action="edit"]:has(input[name="definitionId"][value="' + fixture.cardId + '"])';
    const dialog = '[data-d1-preview]';
    const status = () => evaluate(() => document.querySelector('[data-physical-status]')?.textContent ?? '');
    const history = key => key
        ? fixture.sqlite.prepare('SELECT COUNT(*) n FROM d1_quantity_history WHERE operation_id = ?').get(key).n
        : fixture.sqlite.prepare('SELECT COUNT(*) n FROM d1_quantity_history').get().n;
    const field = name => evaluate((selector, name) => document.querySelector(selector)?.elements.namedItem(name)?.value, select, name);
    const pending = () => evaluate(id => JSON.parse(sessionStorage.getItem(
        'physical-quantity-pending:v1:' + location.pathname + ':' + id)), fixture.cardId);
    const visible = selector => evaluate(selector => {
        const element = document.querySelector(selector);
        return !!element?.getClientRects().length;
    }, selector);
    const locked = () => evaluate(selector => {
        const form = document.querySelector(selector);
        return form.elements.namedItem('expected').disabled && form.querySelector('[data-quantity-submit]').disabled;
    }, select);
    const text = selector => evaluate(selector => document.querySelector(selector)?.textContent.trim(), selector);
    const click = selector => evaluate(selector => document.querySelector(selector).click(), selector);
    const esc = async () => {
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    };
    const change = (expected, reason = '') => evaluate((selector, expected, reason) => {
        const form = document.querySelector(selector);
        form.closest('[data-component-management]').open = true;
        form.closest('details').open = true;
        const input = form.elements.namedItem('expected');
        input.value = String(expected);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        form.elements.namedItem('reason').value = reason;
    }, select, expected, reason);
    const submit = () => click(select + ' [data-quantity-submit]');
    const preview = async expected => {
        await change(expected, 'Synthetic browser correction');
        await submit();
        await until(() => visible(dialog), 'quantity preview');
    };
    const action = name => click(select + ' [data-quantity-action="' + name + '"]');
    const confirm = () => click('[data-d1-confirm]');
    const recovery = select + ' [data-quantity-recovery]';
    const retry = select + ' [data-quantity-action="retry"]';
    const submittedAs = action => submitted.filter(request => request.body.action === action);
    const pass = name => console.log('PASS ' + name);
    async function viewport(width, height) {
        await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    }
    async function capture(name, target, destination = screenshots) {
        await mkdir(destination, { recursive: true });
        for (const [layout, width, height] of [['desktop', 1440, 1000], ['mobile', 375, 900]]) {
            await viewport(width, height);
            await evaluate(async target => {
                const node = document.querySelector(target);
                if (!node?.getClientRects().length) throw new Error('Screenshot target is missing: ' + target);
                if (node instanceof HTMLDialogElement) node.scrollTop = 0;
                else node.scrollIntoView({ block: 'center', behavior: 'instant' });
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }, target);
            if (target === dialog && width === 375) {
                const geometry = await evaluate(selector => {
                    const box = document.querySelector(selector).getBoundingClientRect();
                    return [Math.round(box.width), Math.round(box.height), Math.round(box.bottom)];
                }, dialog);
                assert.deepEqual(geometry, [width, height, height]);
            }
            const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
            await writeFile(join(destination, layout + '-' + name + '.png'), Buffer.from(data, 'base64'));
        }
        await viewport(1440, 1000);
    }
    await cdp('Page.enable');
    await cdp('Network.enable');
    await cdp('Network.setExtraHTTPHeaders', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    await viewport(1440, 1000);
    await cdp('Page.navigate', { url: origin + '/admin/collection/1/components' });
    await until(async () => await field('previousExpected') === '30', 'R06 edit form');

    if (photoMode) {
        const photoDialog = '[data-component-photo-dialog]';
        const opener = '[data-component-photo-open="' + fixture.cardId + '"]';
        const count = '[data-component-thumb]' + opener;
        const manage = '[data-physical-component-list] ' + opener;
        const previewImage = '[data-photo-preview]';
        const getPhoto = () => fixture.sqlite.prepare('SELECT * FROM v2_component_photos WHERE definition_id=?').get(fixture.cardId);
        await cdp('DOM.enable');
        async function choose(color, name) {
            const png = await evaluate(color => {
                const canvas = document.createElement('canvas');
                canvas.width = 1800;
                canvas.height = 900;
                const context = canvas.getContext('2d');
                context.fillStyle = color;
                context.fillRect(0, 0, 1800, 900);
                return canvas.toDataURL('image/png').split(',')[1];
            }, color);
            const imagePath = resolve(output, name + '.png');
            await writeFile(imagePath, Buffer.from(png, 'base64'));
            const { root } = await cdp('DOM.getDocument');
            const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-photo-input="file"]' });
            assert.ok(nodeId);
            await cdp('DOM.setFileInputFiles', { nodeId, files: [imagePath] });
            await until(() => evaluate(selector => {
                const image = document.querySelector(selector);
                return !image.hidden && image.complete && image.naturalWidth === 1600 && image.naturalHeight === 800;
            }, previewImage), 'encoded photo preview');
        }
        async function photoScreenshots(name, target) {
            for (const width of [1280, 375]) {
                await viewport(width, 900);
                await evaluate(async selector => {
                    const element = document.querySelector(selector);
                    element.scrollIntoView({ block: 'center' });
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                }, target);
                const size = await evaluate(selector => Math.round(document.querySelector(selector).getBoundingClientRect().width), count);
                assert.equal(size, width === 1280 ? 112 : 80);
                const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
                await writeFile(join(output, name + '-zh-' + width + '.png'), Buffer.from(data, 'base64'));
            }
            await viewport(1280, 900);
        }
        const readPublic = key => fetch(origin + '/media/components/' + key);
        await evaluate(() => { document.querySelector('[data-component-management]').open = true; });
        await click(manage);
        assert.equal(await visible(photoDialog), true);
        assert.match(await text(photoDialog), /照片會套用到所有副本/);
        assert.equal(await evaluate(() => document.querySelector('[data-photo-input="camera"]').getAttribute('capture')), 'environment');
        await choose('#3069a8', 'fixture-blue');
        assert.equal(getPhoto(), undefined);
        await photoScreenshots('preview', photoDialog);
        pass('management entry, camera field, file picker and preview before upload');
        await click('[data-photo-save]');
        await until(async () => getPhoto()?.revision === 1 && await visible(count + ' img')
            && await evaluate(selector => document.querySelector(selector)?.naturalWidth === 224, count + ' img'), 'first thumbnail');
        const first = getPhoto();
        assert.equal(first.width, 1600);
        assert.equal((await readPublic(first.object_key)).status, 200);
        await photoScreenshots('count-photo', count);
        pass('confirmed upload and responsive R06 thumbnail');

        await click(count);
        await until(() => evaluate(() => document.querySelector('[data-photo-current]')?.naturalWidth === 1600), 'full photo from count card');
        await choose('#b74639', 'fixture-red');
        assert.equal(getPhoto().revision, 1);
        await click('[data-photo-private]');
        await click('[data-photo-save]');
        await until(async () => getPhoto()?.revision === 2 && await evaluate((selector, key) =>
            document.querySelector(selector)?.src.endsWith('/' + key), count + ' img', getPhoto().thumb_key), 'replacement thumbnail');
        const second = getPhoto();
        assert.notEqual(first.object_key, second.object_key);
        assert.equal(second.is_public, 0);
        assert.equal((await readPublic(first.object_key)).status, 404);
        assert.equal((await readPublic(second.object_key)).status, 404);
        pass('count entry opens full photo and replaces it with a private photo');

        await click(count);
        await until(() => evaluate(() => document.querySelector('[data-photo-current]')?.naturalWidth === 1600
            && document.querySelector('[data-photo-private]').checked), 'private photo in Admin');
        const cache = await evaluate(async selector => {
            const response = await fetch(document.querySelector(selector).src);
            return [response.status, response.headers.get('Cache-Control')];
        }, '[data-photo-current]');
        assert.equal(cache[0], 200);
        assert.match(cache[1], /no-store/);
        await click('[data-photo-private]');
        await click('[data-photo-save]');
        await until(async () => getPhoto()?.revision === 3 && await evaluate((selector, key) =>
            document.querySelector(selector)?.src.endsWith('/' + key), count + ' img', getPhoto().thumb_key), 'visibility-only save');
        const third = getPhoto();
        assert.equal((await readPublic(third.object_key)).status, 200);
        pass('private Admin read and visibility-only save rotate the URLs');

        await click(count);
        const confirmOpened = new Promise(resolve => {
            ws.addEventListener('message', function onMessage({ data }) {
                if (JSON.parse(data).method !== 'Page.javascriptDialogOpening') return;
                ws.removeEventListener('message', onMessage);
                resolve();
            });
        });
        await evaluate(() => { setTimeout(() => document.querySelector('[data-photo-remove]').click(), 0); });
        await confirmOpened;
        await cdp('Page.handleJavaScriptDialog', { accept: true });
        await until(async () => !getPhoto() && await visible(count + ' svg') && !await visible(photoDialog), 'photo removal');
        assert.equal((await readPublic(third.object_key)).status, 404);
        assert.equal(fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM v2_component_photo_orphans').get().n, 6);
        await photoScreenshots('removed', count);
        pass('removal restores the generic icon and queues all six old R2 objects');
    } else {

    await change(30);
    assert.equal(await visible(select + ' [data-quantity-reason]'), false);
    assert.equal(await text(select + ' [data-quantity-submit]'), '儲存');
    await change(31);
    assert.equal(await visible(select + ' [data-quantity-reason]'), true);
    assert.equal(await text(select + ' [data-quantity-submit]'), '預覽更正');
    assert.equal(await evaluate(selector => document.querySelector(selector + ' [name="reason"]').required, select), true);
    await submit();
    assert.equal(submitted.length, 0);
    await change(30);
    assert.equal(await visible(select + ' [data-quantity-reason]'), false);
    assert.equal(await text(select + ' [data-quantity-submit]'), '儲存');
    await change(31, '合成測試：校正基本版卡牌');
    await capture('form', select + ' [data-quantity-reason]');
    pass('reason visibility, button labels and blank reason');

    await submit();
    await until(() => visible(dialog), 'first preview');
    assert.equal(submitted[0].key, null);
    assert.deepEqual(await evaluate(() => [...document.querySelectorAll('[data-d1-details] details')].map(group => group.open)),
        [true, false, false]);
    assert.match(await text('[data-d1-details]'), /Open box/);
    assert.equal(await evaluate(() => document.activeElement.matches('[data-d1-title]')), true);
    await capture('preview', dialog);
    await click('[data-d1-cancel]');
    assert.equal(await visible(dialog), false);
    assert.equal(await pending(), null);
    assert.equal(history(), 0);
    pass('cancel leaves no receipt or pending operation');

    await preview(31);
    await esc();
    await until(() => evaluate(selector => document.activeElement.matches(selector + ' [data-quantity-submit]'), select), 'Esc restores focus');
    assert.equal(await visible(dialog), false);
    assert.equal(await pending(), null);

    await preview(31);
    nextCommit = 'hold';
    await confirm();
    await until(() => releaseCommit, 'held commit request');
    assert.equal((await pending()).key, submittedAs('quantity-commit').at(-1).key);
    assert.equal(await evaluate(() => document.querySelector('[data-d1-confirm]').disabled &&
        document.querySelector('[data-d1-cancel]').disabled), true);
    await esc();
    assert.equal(await visible(dialog), true, 'pending commit unexpectedly closed the dialog: ' + await text(recovery));
    await capture('sending', dialog);
    releaseCommit();
    releaseCommit = undefined;
    pass('Esc closes before sending and is ignored during commit');
    await until(async () => await field('previousExpected') === '31' && (await status()).includes('30 → 31'), 'commit reload');
    assert.equal(history(), 1);
    assert.equal(await pending(), null);
    await capture('success', '[data-physical-status]');
    pass('successful commit reloads with new value and one receipt');

    const historyPanel = 'article:has(input[name="definitionId"][value="' + fixture.cardId + '"]) [data-d1-history]';
    const historyEntry = historyPanel + ' [data-d1-history-entry]';
    const historyDetail = historyEntry + ' [data-d1-history-detail]';
    assert.equal(await text(historyPanel + ' > summary'), '更正歷史（1）');
    assert.equal(await evaluate(selector => document.querySelector(selector).open, historyPanel), false);
    await click('[data-component-management] > summary');
    await capture('history-collapsed', historyPanel, historyScreenshots);
    await click(historyPanel + ' > summary');
    assert.match(await text(historyEntry + ' > summary'), /30 → 31 張.*Synthetic browser correction/s);
    await click(historyEntry + ' > summary');
    assert.equal(await visible(historyDetail), true);
    const openBox = await evaluate(selector => {
        const row = [...document.querySelectorAll(selector + ' tbody tr')].find(row => row.cells[0].textContent.includes('Open box'));
        return row && [...row.cells].slice(1).map(cell => cell.textContent.trim());
    }, historyDetail);
    assert.deepEqual(openBox, ['28', '缺 2 張', '缺 3 張']);
    await capture('history-expanded', historyPanel, historyScreenshots);
    pass('history after reload shows one receipt, its reason and frozen per-copy assessment');

    await preview(32);
    nextCommit = 'lost-reply';
    await confirm();
    await until(() => visible(recovery), 'lost reply');
    assert.equal(history(), 2);
    assert.equal(await locked(), true);
    assert.equal(await visible(retry), false);
    await capture('unknown-step-1', recovery);
    await action('status');
    await until(async () => await field('previousExpected') === '32' && (await status()).includes('31 → 32'), 'lost reply status');
    assert.equal(await pending(), null);
    assert.equal(history(), 2);
    pass('lost response after write resolves via status');

    await preview(33);
    nextCommit = 'not-delivered';
    await confirm();
    await until(() => visible(recovery), 'undelivered request');
    const dropped = submittedAs('quantity-commit').at(-1);
    assert.equal(history(dropped.key), 0);
    await action('status');
    await until(() => visible(retry), 'status still unknown');
    assert.equal(history(dropped.key), 0);
    await capture('unknown-step-2', recovery);
    await action('retry');
    await until(async () => await field('previousExpected') === '33' && (await status()).includes('32 → 33'), 'same operation retry');
    const replay = submittedAs('quantity-commit').at(-1);
    assert.equal(replay.raw, dropped.raw);
    assert.equal(replay.key, dropped.key);
    assert.equal(history(dropped.key), 1);
    assert.equal(history(), 3);
    pass('undelivered request is resent with identical content and exactly one receipt');

    await preview(34);
    nextCommit = 'timeout';
    await evaluate(value => { window.d1QuantityTimeoutForTest = value; }, timeoutMs);
    const started = Date.now();
    await confirm();
    await until(() => visible(recovery), 'commit abort timeout');
    assert.ok(Date.now() - started >= timeoutMs - 100);
    assert.equal(await locked(), true);
    assert.equal(history(), 3);
    const timedOut = await pending();
    assert.ok(timedOut?.key);
    pass('injected timeout leaves pending operation and locks quantity');

    rejectStatus = true;
    await action('status');
    await until(async () => (await text(recovery)).includes('無法查詢結果'), 'status 403');
    assert.deepEqual(await pending(), timedOut);
    assert.equal(await locked(), true);
    assert.equal(await visible(retry), false);
    pass('status 403 preserves pending operation');

    const checksBeforeReload = submittedAs('quantity-status').length;
    await cdp('Page.reload');
    await until(async () => submittedAs('quantity-status').length === checksBeforeReload + 1 &&
        (await text(recovery)).includes('請先查詢結果'), 'automatic status on reload');
    assert.deepEqual(await pending(), timedOut);
    assert.equal(await visible(retry), false);
    assert.equal(history(), 3);
    await action('status');
    await until(() => visible(retry), 'manual status after automatic check');
    assert.equal(submittedAs('quantity-status').length, checksBeforeReload + 2);
    await action('retry');
    await until(async () => await field('previousExpected') === '34' && (await status()).includes('33 → 34'), 'timeout recovery');
    assert.equal(history(timedOut.key), 1);
    pass('reload checks pending operation once without submitting a write');

    await preview(35);
    const countResponse = await evaluate(async definitionId => {
        const form = document.querySelector('form[data-physical-action="count"]:has([name="definitionId"][value="' + definitionId + '"])');
        const data = new FormData(form);
        const response = await fetch('/api/admin/collection/components', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NotBGG-Request': '1' },
            body: JSON.stringify({ action: 'count', definitionId, definitionRevision: Number(data.get('definitionRevision')),
                copyId: Number(data.get('copyId')), revision: Number(data.get('revision')), actual: 29, countedOn: '2026-01-05' }),
        });
        return response.status;
    }, fixture.cardId);
    assert.equal(countResponse, 200);
    await confirm();
    const rejection = select + ' [data-quantity-notice]';
    await until(async () => (await text(rejection)).includes('預覽之後資料有變動'), 'superseded confirmation');
    assert.equal(await pending(), null);
    assert.equal(await locked(), false);
    assert.equal(history(), 4);
    assert.equal(await field('previousExpected'), '34');
    await capture('not-committed', rejection);
    await action('preview');
    await until(() => visible(dialog), 'preview again after superseded');
    await click('[data-d1-cancel]');
    pass('count supersedes preview, clears pending, unlocks and allows a new preview');

    await change(34);
    await evaluate(selector => document.querySelector(selector + ' [name="name"]').value = 'Ordinary browser rename', select);
    await submit();
    await until(async () => await field('name') === 'Ordinary browser rename' && (await status()).includes('已儲存'), 'ordinary edit');
    assert.equal(history(), 4);
    pass('ordinary edit saves without a quantity receipt');
    const p0aScreenshots = join(output, 'P0A-screenshots');
    const row = '[data-count-row]:has(form[data-physical-action="count"] [name="definitionId"][value="' + fixture.cardId + '"])';
    const toggle = row + ' [data-applicability-toggle]';
    const trail = '[data-applicability-history="' + fixture.cardId + '"]';
    const countForm = row + ' form[data-physical-action="count"]';
    const opening = origin + '/admin/collection/1/components?copy=1';
    const english = opening + '&lang=en';
    const snapshot = async (name, selector, width) => {
        await viewport(width, 950);
        await evaluate(async selector => {
            const node = document.querySelector(selector);
            assertVisible(node);
            node.scrollIntoView({ block: 'center', behavior: 'instant' });
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            function assertVisible(element) {
                if (!element?.getClientRects().length) throw new Error('Missing screenshot target: ' + selector);
            }
        }, selector);
        assert.ok(await evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
        await mkdir(p0aScreenshots, { recursive: true });
        await writeFile(join(p0aScreenshots, name + '-' + width + '.png'), Buffer.from(data, 'base64'), { flag: 'wx' });
    };
    const setApplicable = async prompt => {
        const opened = new Promise(resolve => {
            const listener = ({ data }) => {
                const event = JSON.parse(data);
                if (event.method !== 'Page.javascriptDialogOpening') return;
                ws.removeEventListener('message', listener);
                resolve(event.params);
            };
            ws.addEventListener('message', listener);
        });
        const clicked = click(toggle);
        const event = await Promise.race([opened, clicked.then(() => { throw new Error('Missing confirmation dialog'); })]);
        assert.equal(event.type, 'confirm');
        assert.match(event.message, prompt);
        await cdp('Page.handleJavaScriptDialog', { accept: true });
        await clicked;
    };
    const excluded = () => visible(row + ' [data-applicability-excluded]');
    const useCopy = id => evaluate(id => {
        const picker = document.querySelector('[data-count-copy]');
        picker.value = String(id);
        picker.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
    const showTrail = async () => evaluate(selector => {
        const history = document.querySelector(selector);
        for (let parent = history; parent; parent = parent.parentElement) {
            if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
    }, trail);

    await cdp('Page.navigate', { url: opening });
    await until(async () => await text(row + ' [data-count-current]') === '29', 'original count');
    await evaluate(() => { window.applicabilityNavigationMarker = true; });
    for (const width of [375, 768, 1280]) await snapshot('zh-before-confirm', toggle, width);
    await setApplicable(/#1 Open box 不適用.*Ordinary browser rename/);
    await until(excluded, 'excluded copy');
    assert.equal(await evaluate(() => window.applicabilityNavigationMarker), true);
    assert.equal(await evaluate(selector => document.querySelector(selector).classList.contains('count-excluded'), row), true);
    assert.equal(await visible(countForm), false);
    for (const width of [375, 768, 1280]) await snapshot('zh-after-confirm', toggle, width);
    pass('applicability fades only the selected row without navigation');

    await cdp('Page.reload');
    await until(async () => await excluded() && !await evaluate(() => window.applicabilityNavigationMarker), 'persisted exclusion after reload');
    await preview(35);
    assert.match(await text('[data-d1-excluded]'), /不列入 1 盒/);
    await click('[data-d1-cancel]');
    pass('D1 preview includes the inapplicable copy in the exclusion count');

    await useCopy(2);
    await until(() => visible(countForm), 'other copy count form');
    await evaluate(selector => {
        const input = document.querySelector(selector + ' [name="actual"]');
        input.value = '27';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, countForm);
    await click(countForm + ' [data-count-save]');
    await until(async () => await text(row + ' [data-count-current]') === '27', 'other copy count saved');
    await useCopy(1);
    await until(excluded, 'first copy still excluded');
    await cdp('Page.navigate', { url: english });
    await until(async () => /Restore applicability/i.test(await text(toggle) ?? ''), 'English excluded row');
    await snapshot('en-excluded', toggle, 1280);
    await setApplicable(/Restore|applicable/i);
    await until(async () => await visible(countForm) && await text(row + ' [data-count-current]') === '29', 'restored original count');
    await snapshot('en-restored', toggle, 1280);
    await showTrail();
    await until(async () => await evaluate(selector => document.querySelectorAll(selector + ' li').length, trail) === 2, 'two applicability events');
    assert.match(await text(trail), /Applicable → Not applicable/i);
    assert.match(await text(trail), /Not applicable → Applicable/i);
    await snapshot('en-history', trail, 1280);
    await cdp('Page.navigate', { url: opening });
    await until(async () => /適用性歷史/.test(await text(trail) ?? ''), 'persistent Chinese history');
    await showTrail();
    assert.equal(await evaluate(selector => document.querySelectorAll(selector + ' li').length, trail), 2);
    for (const width of [375, 768, 1280]) await snapshot('zh-history', trail, width);
    pass('reload, independent count, restore original count and persisted bilingual history');

    console.log('15 browser checks passed, including three applicability checks.');

    const datePicker = '[data-count-date]';
    const savedDate = row + ' [data-counted-on]';
    const saveCount = countForm + ' [data-count-save]';
    const historical = '2026-01-04';
    const dateShots = join(output, 'P0B-screenshots');
    const taipeiToday = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const initial = await evaluate(selector => {
        const input = document.querySelector(selector);
        return [input.value, input.min, input.max, input.labels[0].textContent.trim(), input.offsetHeight];
    }, datePicker);
    assert.deepEqual(initial.slice(0, 4), [taipeiToday, '2000-01-01', taipeiToday, '清點日期']);
    assert.ok(initial[4] >= 44);
    assert.equal(await text(savedDate), '2026-01-05', 'restoring applicability preserves the date');
    const setField = (selector, value) => evaluate(([selector, value]) => {
        const input = document.querySelector(selector);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }, [selector, value]);
    await setField(datePicker, '9999-01-01');
    assert.equal(await evaluate(selector => document.querySelector(selector).disabled, saveCount), true);
    assert.match(await text('[data-count-date-status]'), /有效日期/);
    await setField(datePicker, historical);
    await evaluate(() => { window.countDateNavigationMarker = true; });
    await click(saveCount);
    await until(async () => await text(savedDate) === historical, 'historical date rendered without reload');
    assert.equal(await evaluate(() => window.countDateNavigationMarker), true);
    assert.equal(await text(row + ' [data-count-current]'), '29');

    await mkdir(dateShots, { recursive: true });
    const captureDate = async (name, width) => {
        await viewport(width, 1250);
        await evaluate(() => {
            document.querySelector('[data-count-picker]').scrollIntoView({ block: 'start', behavior: 'instant' });
        });
        assert.ok(await evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
        await writeFile(join(dateShots, name + '-' + width + '.png'), Buffer.from(data, 'base64'), { flag: 'wx' });
    };
    await captureDate('zh-saved', 1280);
    await useCopy(2);
    await until(async () => await text(savedDate) === taipeiToday, 'other copy date');
    assert.equal(await evaluate(selector => document.querySelector(selector).value, datePicker), historical);
    await useCopy(1);
    await until(async () => await text(savedDate) === historical, 'original copy date');
    await cdp('Page.reload');
    await until(async () => await text(savedDate) === historical && !await evaluate(() => window.countDateNavigationMarker),
        'historical date persisted after reload');
    assert.ok(await evaluate(() => [...document.querySelectorAll('[data-counted-on]')].some(node => node.textContent === '未記錄')));
    for (const width of [375, 768, 1280]) await captureDate('zh-count-dates', width);
    await cdp('Page.navigate', { url: english });
    await until(async () => await text(savedDate) === historical
        && await evaluate(() => [...document.querySelectorAll('[data-counted-on]')].some(node => node.textContent === 'Not recorded')),
    'English count dates');
    await captureDate('en-count-dates', 1280);
    pass('count date defaults, future-date guard, in-place save, reload, copy switch and applicability restoration');

    const createForm = '[data-physical-action="create"]';
    const createName = createForm + ' [name="name"]';
    const sameExpected = createForm + ' [data-create-match-expected]';
    const createStatus = '[data-create-status]';
    const createScreenshots = join(output, 'R06-CC-screenshots');
    await mkdir(createScreenshots);
    async function captureCreate(name, selector, widths = [375, 1280]) {
        for (const width of widths) {
            await viewport(width, 900);
            const overflow = await evaluate(async selector => {
                const target = document.querySelector(selector);
                target.scrollIntoView({ block: 'center', behavior: 'instant' });
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return document.documentElement.scrollWidth > document.documentElement.clientWidth;
            }, selector);
            assert.equal(overflow, false, name + ' at ' + width);
            const { data } = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
            await writeFile(join(createScreenshots, name + '-' + width + '.png'), Buffer.from(data, 'base64'));
        }
    }
    async function fillCreate(name, actual) {
        await evaluate((selector, name, actual) => {
            const form = document.querySelector(selector);
            form.closest('details').open = true;
            form.elements.namedItem('name').value = name;
            form.elements.namedItem('type').value = 'token';
            form.elements.namedItem('unit').value = 'piece';
            form.elements.namedItem('expected').value = '5';
            form.elements.namedItem('expected').dispatchEvent(new Event('input', { bubbles: true }));
            const input = form.elements.namedItem('actual');
            if (input) input.value = actual;
            form.elements.namedItem('confirmed').checked = true;
        }, createForm, name, actual ?? '');
    }
    const createdRow = name => '[data-count-values][data-component-name$=" ' + name + '"]';
    async function submitCreate(name) {
        assert.equal(await evaluate(selector => document.querySelector(selector).reportValidity(), createForm), true);
        await click(createForm + ' [type="submit"]');
        try {
            await until(() => visible(createdRow(name)), 'created row ' + name);
        } catch (error) {
            throw new Error('Create status: ' + await text(createStatus) + '; create requests: ' + submittedAs('create').length, { cause: error });
        }
        assert.equal(await evaluate(selector => {
            const name = document.querySelector(selector);
            return window.createNavigationMarker && document.activeElement === name && name.value === '' &&
                name.closest('details').open && name.form.elements.namedItem('actual').value === '';
        }, createName), true);
    }
    await cdp('Page.navigate', { url: opening });
    await until(() => evaluate(selector => document.querySelector(selector)?.disabled, sameExpected), 'blank expected');
    await until(async () => {
        await useCopy(2);
        return evaluate(() => new URL(location.href).searchParams.get('copy') === '2');
    }, 'existing controller switches to the second copy');
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await evaluate(() => {
        window.createNavigationMarker = true;
        const date = document.querySelector('[data-count-date]');
        date.value = '2026-01-02';
        date.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const [index, actual] of [0, 5, 3].entries()) {
        const name = 'Create token ' + (index + 1);
        await fillCreate(name, index === 1 ? '' : actual);
        if (index === 1) {
            assert.equal(await evaluate(selector => {
                const button = document.querySelector(selector);
                button.focus();
                return document.activeElement === button;
            }, sameExpected), true);
            await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
            await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
            await until(() => evaluate(selector =>
                document.querySelector(selector).elements.namedItem('actual').value === '5', createForm), 'keyboard matches expected');
            await captureCreate('zh-filled', createForm, [375, 768, 1280]);
            const targets = await evaluate(selector => [...document.querySelector(selector).querySelectorAll(
                'input:not([type="hidden"],[type="checkbox"]), select, button, label:has([type="checkbox"])'
            )].map(target => Math.min(target.offsetHeight, target.offsetWidth)), createForm);
            assert.ok(targets.length > 0 && targets.every(size => size >= 44), 'create form touch targets');
        }
        await submitCreate(name);
        assert.equal(await text(createdRow(name) + ' [data-count-current]'), String(actual));
        assert.equal(await text(createdRow(name) + ' [data-counted-on]'), '2026-01-02');
        assert.equal(submittedAs('count').at(-1).body.copyId, 2);
        assert.equal(submittedAs('create').at(-1).body.actual, undefined);
    }
    await captureCreate('zh-continuous', createdRow('Create token 3'));
    pass('three consecutive in-place create and count saves, selected copy, chosen date and keyboard match');

    await fillCreate('Uncounted token');
    await submitCreate('Uncounted token');
    assert.equal(await text(createdRow('Uncounted token') + ' [data-count-current]'), '未清點');
    pass('blank actual creates an uncounted component');

    await fillCreate('Retry token', 4);
    rejectCreateCount = true;
    await submitCreate('Retry token');
    assert.match(await text(createStatus), /組件已建立，但這份副本的清點未儲存/);
    await captureCreate('zh-partial', createStatus);
    const retryRow = createdRow('Retry token');
    await evaluate(selector => {
        const actual = document.querySelector(selector);
        actual.value = '4';
        actual.dispatchEvent(new Event('input', { bubbles: true }));
    }, retryRow + ' [name="actual"]');
    await click(retryRow + ' [data-count-save]');
    await until(async () => await text(retryRow + ' [data-count-current]') === '4', 'supplemental count');
    await setApplicable(/不適用/);
    await until(() => excluded(), 'rebound applicability');
    const newId = submittedAs('count').at(-1).body.definitionId;
    const newEdit = '[data-physical-action="edit"]:has([name="definitionId"][value="' + newId + '"])';
    await evaluate(selector => {
        const form = document.querySelector(selector);
        form.closest('details').open = true;
        form.elements.namedItem('name').value = 'Edited retry token';
    }, newEdit);
    await click(newEdit + ' [data-quantity-submit]');
    await until(() => visible(createdRow('Edited retry token')), 'rebound edit');
    pass('partial failure leaves the component and rebound count, applicability and edit work');

    await cdp('Page.navigate', { url: english });
    await until(() => visible('[data-component-management] > summary'), 'English form');
    await fillCreate('English token', 2);
    assert.equal(await text(sameExpected), 'Same as expected');
    await captureCreate('en-filled', createForm, [1280]);
    fixture.sqlite.exec("UPDATE v2_owned_copies SET seal_status = 'sealed' WHERE collection_item_id = 1");
    for (const [url, language, reason] of [[opening, 'zh', '沒有可清點的在藏未封膜副本'],
        [english, 'en', 'No eligible unsealed copies are in the collection']]) {
        await cdp('Page.navigate', { url });
        await until(async () => (await text(createForm))?.includes(reason), 'no eligible copies');
        await fillCreate('No count available');
        assert.equal(await visible(createForm + ' [name="actual"]'), false);
        await captureCreate(language + '-no-copy', createForm, language === 'en' ? [1280] : [375, 1280]);
    }
    pass('bilingual no-copy state and responsive create form');
    }

} finally {
    releaseCommit?.();
    ws?.close();
    browser?.kill();
    if (server?.listening) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
    fixture.sqlite.close();
    auth.restore();
}
