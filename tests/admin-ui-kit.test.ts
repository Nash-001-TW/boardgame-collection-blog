import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPreview } from './helpers/admin-dashboard-preview';

const request = (query = '') => new Request('http://127.0.0.1/dev/ui-kit' + query);
const bindings = new Proxy({}, {
    get(_target, key) { throw new Error('Unexpected binding access: ' + String(key)); },
});

test('ui kit returns an uncached 404 outside DEV before accessing bindings', async () => {
    const render = await dashboardPreview(bindings, { dev: false });
    const response = await render(request('?lang=en'));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await response.text(), 'Not Found');
});

test('DEV kit renders both languages without Access or D1 and distinguishes zero from unavailable', async () => {
    const render = await dashboardPreview(bindings, { dev: true });
    for (const [lang, title, unavailable] of [
        ['zh-TW', '管理元件展示', '無法取得'],
        ['en', 'Admin component gallery', 'Unavailable'],
    ]) {
        const response = await render(request('?lang=' + lang));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        const html = await response.text();
        assert.ok(html.includes(title));
        assert.match(html, /class="admin-kit-number">0<\/p>/);
        assert.ok(html.includes('<span class="admin-kit-sr">' + unavailable + '</span>'));
        assert.match(html, /<dialog[^>]+id="kit-confirm"/);
    }
});
