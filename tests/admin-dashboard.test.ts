import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';
import { handleNotBggAdminRequest } from '../src/lib/notbgg-admin-api.ts';
import { dashboardPreview, r01Fixture } from './helpers/admin-dashboard-preview.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const languages = [
    {
        lang: 'zh-TW', suffix: '',
        headings: ['管理工作台', '快捷操作', '收藏與資料概況', '待處理項目'],
        unavailable: '無法取得', sources: ['BGG 資料', 'NotBGG 資料'],
        purchase: '已記錄採購成本', sleeve: '卡套狀況', components: '組件狀況',
    },
    {
        lang: 'en', suffix: '?lang=en',
        headings: ['Management Dashboard', 'Quick actions', 'Collection and data overview', 'Pending work'],
        unavailable: 'Unavailable', sources: ['BGG records', 'NotBGG records'],
        purchase: 'Recorded purchase costs', sleeve: 'Sleeve status', components: 'Component status',
    },
] as const;

const managementRoutes = ['/admin/collection', '/admin/sleeves', '/admin/purchases', '/admin/bgg'];

function request(path: string, token?: string) {
    return new Request('http://localhost' + path, {
        headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
    });
}

function section(html: string, headingId: string) {
    const match = html.match(new RegExp('<section\\b[^>]*aria-labelledby="' + headingId + '"[^>]*>[\\s\\S]*?</section>'));
    assert.ok(match, 'Missing R01 section: ' + headingId);
    return match[0];
}

function card(html: string, title: string) {
    const match = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)]
        .find(([body]) => body.includes(title));
    assert.ok(match, 'Missing R01 card: ' + title);
    return match[0];
}

test('R01 renders the real bilingual dashboard and management links behind Access JWT', async t => {
    const { sqlite, db } = r01Fixture('empty');
    t.after(() => sqlite.close());
    const auth = await accessFixture();
    t.after(auth.restore);
    const bindings = { ...auth.bindings, DB: db, LOCAL_ADMIN_DEV: 'false' };
    const render = await dashboardPreview(bindings);
    const jwt = await auth.token();

    await t.test('valid JWT renders the main blocks and opens the rendered quick-action links', async () => {
        for (const { lang, suffix, headings, unavailable } of languages) {
            const response = await render(request('/admin?lang=' + lang, jwt));
            assert.equal(response.status, 200, lang);
            const html = await response.text();
            const main = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/)?.[0];
            assert.ok(main, lang);
            const renderedHeadings = [...main.matchAll(/<h[12]\b[^>]*>([^<]*)<\/h[12]>/g)]
                .map(([, heading]) => heading.trim());
            assert.deepEqual(renderedHeadings, [...headings], lang);
            assert.ok(!main.includes(unavailable), lang);

            const actions = section(main, 'quick-actions');
            for (const route of ['/admin/collection/new', ...managementRoutes]) {
                const href = route + suffix;
                assert.ok(actions.includes('href="' + href + '"'), href);
                const destination = await render(request(href, jwt));
                assert.equal(destination.status, 200, href);
                assert.match(await destination.text(), /<main\b/, href);
            }
        }
    });

    await t.test('Access middleware rejects missing, wrong-key, other-account and expired JWTs', async () => {
        const rejected = [
            { label: 'missing', token: undefined, dedicatedStatus: 401 },
            { label: 'wrong key', token: await auth.token({ wrongKey: true }), dedicatedStatus: 401 },
            { label: 'other account', token: await auth.token({ email: 'other@example.test' }), dedicatedStatus: 403 },
            { label: 'expired', token: await auth.token({ exp: Math.floor(Date.now() / 1000) - 60 }), dedicatedStatus: 401 },
        ];
        for (const { label, token, dedicatedStatus } of rejected) {
            // The general admin middleware returns 403 for every failed Access check.
            // The management destinations use the dedicated branch, which distinguishes 401 and 403.
            assert.equal((await render(request('/admin', token))).status, 403, label);
            for (const route of [...managementRoutes, '/admin/notbgg']) {
                assert.equal((await render(request(route, token))).status, dedicatedStatus, route + ': ' + label);
            }
            assert.equal((await render(request('/admin/notbgg', token))).status, dedicatedStatus, label);
        }
    });

    await t.test('valid JWT still opens NotBGG and authorizes the existing management API reads', async () => {
        const notBgg = await render(request('/admin/notbgg', jwt));
        assert.equal(notBgg.status, 200);
        assert.match(await notBgg.text(), /<main\b/);
        assert.equal((await handleNotBggAdminRequest(request('/api/admin/notbgg', jwt), bindings)).status, 200);
        assert.equal((await handleCollectionAdminRequest(
            request('/api/admin/collection?scope=production', jwt), bindings,
        )).status, 200);
    });
});

test('R01 keeps both languages usable with real missing tables after migration 0013', async t => {
    const sqlite = new DatabaseSync(':memory:');
    t.after(() => sqlite.close());
    const migrations = readdirSync('migrations')
        .filter(file => /^\d+.*\.sql$/.test(file) && file <= '0013_v2_record_scope.sql').sort();
    assert.equal(migrations.at(-1), '0013_v2_record_scope.sql');
    for (const file of migrations) sqlite.exec(readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));

    const db = sqliteD1(sqlite);
    await assert.rejects(db.prepare('SELECT 1 FROM notbgg_games').first(), /no such table: notbgg_games/);
    await assert.rejects(db.prepare('SELECT 1 FROM v2_collection_management').first(), /no such table: v2_collection_management/);
    await assert.rejects(db.prepare('SELECT 1 FROM v2_bgg_sync_gate').first(), /no such table: v2_bgg_sync_gate/);

    const auth = await accessFixture();
    t.after(auth.restore);
    const render = await dashboardPreview({ ...auth.bindings, DB: db, LOCAL_ADMIN_DEV: 'false' });
    const jwt = await auth.token();

    for (const { lang, suffix, unavailable, sources, purchase, sleeve, components } of languages) {
        const response = await render(request('/admin?lang=' + lang, jwt));
        assert.equal(response.status, 200, lang);
        const html = await response.text();
        const overview = section(html, 'dashboard-overview');
        for (const label of sources) {
            const row = overview.match(new RegExp('<dt\\b[^>]*>' + label + '</dt>\\s*<dd\\b[^>]*>([\\s\\S]*?)</dd>'));
            assert.ok(row?.[1].includes(unavailable), lang + ': ' + label);
        }
        assert.ok(card(overview, purchase).includes(unavailable), lang + ': ' + purchase);
        assert.ok(section(html, 'pending-work').includes(unavailable), lang + ': pending work');

        // These blocks use tables already present in 0013.
        const collection = card(overview, lang === 'en' ? 'Total collections' : '收藏總數');
        assert.match(collection, /<p\b[^>]*class="[^"]*admin-kit-number[^"]*"[^>]*>\s*\d+\s*<\/p>/, lang);
        assert.ok(card(overview, sleeve).includes(unavailable), lang + ': ' + sleeve);
        {
            const block = card(overview, components);
            assert.match(block, /<dd\b[^>]*>\s*\d+\s*<\/dd>/, lang + ': ' + components);
            assert.ok(!block.includes(unavailable), lang + ': ' + components);
        }
        const actions = section(html, 'quick-actions');
        for (const route of ['/admin/collection/new', ...managementRoutes]) {
            assert.ok(actions.includes('href="' + route + suffix + '"'), lang + ': ' + route);
        }
        const destination = await render(request('/admin/collection/new' + suffix, jwt));
        assert.equal(destination.status, 200, lang);
        assert.match(await destination.text(), /<main\b/, lang);
    }
});
