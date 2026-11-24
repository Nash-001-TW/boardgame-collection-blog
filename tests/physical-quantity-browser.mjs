// Candidate only: rendered R06 form + actual controller + authenticated API against disposable SQLite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';
const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
// A4 validation leaves the reviewed A3 screenshots intact.
const screenshots = join(output, 'D1-A3-screenshots');
const historyScreenshots = 'docs/D1-A4-screenshots';
await mkdir(output, { recursive: true });

// Resolve the fixture's extensionless TypeScript imports without changing the authorized Node command.
const harness = await build({
    stdin: {
        resolveDir: process.cwd(),
        contents: 'export { handlePhysicalComponentRequest } from "./src/lib/physical-component-admin-api.ts";' +
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
const { handlePhysicalComponentRequest, dashboardPreview, accessFixture, sleeveWorkflowFixture } = loaded.exports;
const fixture = await sleeveWorkflowFixture();
const auth = await accessFixture();
let server, browser, ws;
const submitted = [];
let nextCommit;
let blockedCommitKey;
let rejectStatus = false;
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
        NOTBGG_WRITE_LIMITER: { limit: async () => ({ success: true }) } };
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
                } else if (body.action === 'quantity-status' && rejectStatus) {
                    rejectStatus = false;
                    response = Response.json({ success: false, error: { code: 'FORBIDDEN' } }, { status: 403 });
                } else {
                    if (body.action === 'quantity-status' && key === blockedCommitKey) blockedCommitKey = undefined;
                    response = await handlePhysicalComponentRequest(request, bindings);
                }
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
    await cdp('Page.navigate', { url: origin + '/admin/collection/components/manage?collection=1' });
    await until(async () => await field('previousExpected') === '30', 'R06 edit form');

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
        const copy = form.querySelector('[name="copyId"] option[value="1"]');
        const response = await fetch('/api/admin/collection/components', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NotBGG-Request': '1' },
            body: JSON.stringify({ action: 'count', definitionId, definitionRevision: Number(data.get('definitionRevision')),
                copyId: 1, revision: Number(copy.dataset.revision), actual: 29 }),
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
    console.log('12 browser checks passed; 4 A4 screenshots and 14 temporary A3 screenshots saved.');
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
