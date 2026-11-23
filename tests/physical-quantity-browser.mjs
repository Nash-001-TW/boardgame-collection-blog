// Candidate only: rendered R06 form + actual controller + authenticated API against disposable SQLite.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';
import { handlePhysicalComponentRequest } from '../src/lib/physical-component-admin-api.ts';
import { dashboardPreview } from './helpers/admin-dashboard-preview.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { sleeveWorkflowFixture } from './helpers/sleeve-workflow-fixture.ts';

const output = process.argv[2];
if (!output) throw new Error('A disposable artifact directory is required');
await mkdir(output, { recursive: true });
const fixture = await sleeveWorkflowFixture();
const auth = await accessFixture();
let server, browser, ws;
const submitted = [];
let simulateLostReply = true;

async function until(check, label) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        try { if (await check()) return; } catch { /* Page reload can invalidate an evaluation context. */ }
        await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw new Error('Timed out: ' + label);
}

try {
    const bindings = { ...auth.bindings, DB: fixture.db, PHYSICAL_COMPONENT_SIGNING_KEY: fixture.secret,
        NOTBGG_WRITE_LIMITER: { limit: async () => ({ success: true }) } };
    const preview = await dashboardPreview(bindings);
    const token = await auth.token();
    const script = (await build({ entryPoints: ['src/lib/physical-component-admin-controller.ts'],
        bundle: true, write: false, platform: 'browser', format: 'iife' })).outputFiles[0].text;
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
                response = await handlePhysicalComponentRequest(request, bindings);
                if (simulateLostReply && body.action === 'edit' && body.previousExpected === 30 && body.expected === 0 && response.ok) {
                    simulateLostReply = false;
                    res.destroy();
                    return;
                }
            } else if (url.pathname === '/physical-controller.js') {
                response = new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
            } else {
                const rendered = await preview(request);
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
        '--headless=new', '--no-first-run', '--disable-background-networking', '--disable-component-update',
        '--disable-extensions', '--disable-sync', '--proxy-server=http://127.0.0.1:9', '--remote-debugging-port=0',
        '--user-data-dir=' + profile, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    let port;
    await until(async () => port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]), 'browser debug port');
    const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
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
            const timer = setTimeout(() => { calls.delete(id); reject(new Error(method + ' timed out')); }, 12_000);
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
    const status = () => evaluate(() => document.querySelector('[data-physical-status]')?.textContent ?? '');
    const history = () => fixture.sqlite.prepare('SELECT COUNT(*) n FROM d1_quantity_history').get().n;
    const field = name => evaluate((selector, name) => document.querySelector(selector)?.elements.namedItem(name)?.value, select, name);
    await cdp('Page.enable');
    await cdp('Network.enable');
    await cdp('Network.setExtraHTTPHeaders', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    await cdp('Page.navigate', { url: origin + '/admin/collection/components/manage?collection=1&lang=en' });
    await until(async () => await field('previousExpected') === '30', 'R06 edit form');

    await evaluate(selector => {
        const form = document.querySelector(selector);
        form.closest('details').open = true;
        form.elements.namedItem('expected').value = '0';
        form.requestSubmit();
    }, select);
    await until(async () => (await status()).includes('Enter a reason'), 'required reason');
    assert.equal(submitted.length, 0);
    assert.equal(await field('expected'), '0');
    await evaluate(selector => {
        const form = document.querySelector(selector);
        form.elements.namedItem('reason').value = 'Synthetic browser correction';
        form.requestSubmit();
    }, select);
    await until(async () => (await status()).includes('result is unknown'), 'lost response UI');
    assert.equal(history(), 1);
    assert.equal(submitted[0].body.previousExpected, 30);
    assert.equal(submitted[0].body.expected, 0);

    await evaluate(selector => {
        const form = document.querySelector(selector);
        form.elements.namedItem('expected').value = '1';
        form.requestSubmit();
    }, select);
    assert.equal(submitted.length, 1, 'ordinary submit must not start a second correction');
    await cdp('Page.reload');
    await until(async () => await field('previousExpected') === '0' &&
        await evaluate(selector => document.querySelector(selector + ' [data-quantity-operation-id]')?.textContent, select) === submitted[0].key,
    'restore original operation on reload');
    assert.equal(await field('reason'), 'Synthetic browser correction');
    await evaluate(selector => document.querySelector(selector + ' [data-quantity-action="retry"]').click(), select);
    await until(() => submitted.length === 2, 'replay through API');
    assert.equal(submitted[1].key, submitted[0].key);
    assert.equal(submitted[1].raw, submitted[0].raw);
    await until(async () => (await status()).includes('Saved.'), 'saved after replay');
    assert.equal(history(), 1);

    await evaluate(selector => {
        const form = document.querySelector(selector);
        form.closest('details').open = true;
        form.elements.namedItem('name').value = 'Ordinary browser rename';
        form.requestSubmit();
    }, select);
    await until(async () => submitted.length === 3 && await field('name') === 'Ordinary browser rename' &&
        (await status()).includes('Saved.'), 'ordinary edit');
    assert.equal(history(), 1);
} finally {
    ws?.close();
    browser?.kill();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    fixture.sqlite.close();
    auth.restore();
}
