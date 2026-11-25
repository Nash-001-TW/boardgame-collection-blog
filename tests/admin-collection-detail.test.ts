import assert from 'node:assert/strict';
import test from 'node:test';
import { readCollectionHeader } from '../src/lib/collection-v2-management';
import { accessFixture } from './helpers/notbgg-access-fixture';
import { collectionDetailFixture, dashboardPreview } from './helpers/admin-dashboard-preview';

test('legacy physical-component route redirects without reading D1', async t => {
    const auth = await accessFixture();
    t.after(auth.restore);
    let reads = 0;
    const render = await dashboardPreview({...auth.bindings, DB:{prepare() {
        reads++;
        throw new Error('Unexpected D1 read');
    }}});
    const headers = {'Cf-Access-Jwt-Assertion':await auth.token()};
    for (const [query, location] of [
        ['?collection=6&scope=test&lang=en', '/admin/collection/6/components?scope=test&lang=en'],
        ['?collection=1', '/admin/collection/1/components?scope=production'],
        ['?lang=en&scope=test', '/admin/collection?lang=en'],
        ['?collection=0&lang=en', '/admin/collection?lang=en'],
        ['?collection=9007199254740992', '/admin/collection'],
    ]) {
        const response = await render(new Request('https://admin.example.test/admin/collection/components/manage' + query, {headers}));
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), location);
    }
    assert.equal(reads, 0);
});

test('physical-component route validates collection and scope and isolates the two reads', async t => {
    const fixture = collectionDetailFixture();
    t.after(() => fixture.sqlite.close());
    const auth = await accessFixture();
    t.after(auth.restore);
    const render = await dashboardPreview({...auth.bindings, DB:fixture.db});
    const headers = {'Cf-Access-Jwt-Assertion':await auth.token()};
    const page = (id: string, query = '') => render(new Request(
        'https://admin.example.test/admin/collection/' + id + '/components' + query, {headers}));
    assert.equal((await page('invalid')).status, 400);
    assert.equal((await page('1', '?scope=invalid')).status, 400);
    assert.equal((await page('99999')).status, 404);
    assert.equal((await page('6')).status, 404);
    assert.equal((await page('6', '?scope=test')).status, 200);
    const prepare = fixture.db.prepare.bind(fixture.db);
    let failHeader = true;
    fixture.db.prepare = (sql: string) => {
        if (failHeader ? sql.includes('AS game_name') && sql.includes('WITH static')
            : sql.includes('SELECT c.display_name, c.record_scope')) {
            throw new Error('Synthetic read failure');
        }
        return prepare(sql);
    };
    assert.equal((await page('6')).status, 404);
    const missingHeader = await page('1');
    assert.equal(missingHeader.status, 200);
    const html = await missingHeader.text();
    assert.match(html, /無法取得收藏頁首/);
    assert.match(html, /data-physical-manager/);
    failHeader = false;
    const missingPanel = await page('1');
    assert.equal(missingPanel.status, 503);
    const partial = await missingPanel.text();
    assert.match(partial, /<h1>Alpha<\/h1>/);
    assert.match(partial, /無法讀取實體組件資料/);
});

test('header uses R01 ownership and R02 cover precedence, and counts held copies only', async t => {
    const {db, sqlite} = collectionDetailFixture();
    t.after(() => sqlite.close());
    const owned = await readCollectionHeader(db, 1, 'production');
    assert.equal(owned?.owned, 1);
    assert.equal(owned?.copies, 2);
    assert.equal(owned?.source_id, 'BGG:900001');
    assert.equal(owned?.image, 'https://example.invalid/cover.webp');
    const archived = await readCollectionHeader(db, 2, 'production');
    assert.equal(archived?.owned, 0);
    assert.equal(archived?.wishlist, 1);
    assert.ok(archived?.archived_at);
    const notBgg = await readCollectionHeader(db, 3, 'production');
    assert.equal(notBgg?.owned, 1);
    assert.equal(notBgg?.acquisition_status, 'preordered');
    assert.equal(notBgg?.source_id, 'NotBGG:000001');
    assert.equal(notBgg?.image, null); // safeImage rejects the fixture's relative URL.
    assert.equal((await readCollectionHeader(db, 4, 'production'))?.image, null);
    assert.equal((await readCollectionHeader(db, 5, 'production'))?.source_id, null);
    assert.equal(await readCollectionHeader(db, 6, 'production'), null);
    assert.equal((await readCollectionHeader(db, 6, 'test'))?.display_name, 'Test record');
    assert.throws(() => db.prepare('SELECT 1 UNION SELECT 2 INTERSECT SELECT 3 EXCEPT SELECT 4 UNION SELECT 5'), /term limit/);
});

test('detail routes return 404 and 400, and isolate header and copy failures', async t => {
    const fixtures = [collectionDetailFixture(), collectionDetailFixture('header'), collectionDetailFixture('copies')];
    t.after(() => fixtures.forEach(({sqlite}) => sqlite.close()));
    const auth = await accessFixture();
    const bindings = {...auth.bindings, DB:fixtures[0].db};
    const render = await dashboardPreview(bindings);
    const headers = {'Cf-Access-Jwt-Assertion':await auth.token()};
    const page = (suffix: string) => render(new Request('https://admin.example.test/admin/collection/' + suffix, {headers}));
    for (const tab of ['', '/copies']) {
        assert.equal((await page('99999' + tab)).status, 404);
        assert.equal((await page('1' + tab + '?scope=invalid')).status, 400);
    }
    bindings.DB = fixtures[1].db;
    for (const [suffix, form] of [['1', /data-collection-form/], ['1/copies', /data-copy-action="create"/]] as const) {
        const response = await page(suffix);
        assert.equal(response.status, 200);
        const html = await response.text();
        assert.match(html, /無法取得收藏頁首/);
        assert.match(html, form);
    }
    bindings.DB = fixtures[2].db;
    const response = await page('1/copies');
    assert.equal(response.status, 503);
    const html = await response.text();
    assert.match(html, /<h1>Alpha<\/h1>/);
    assert.match(html, /無法讀取副本/);
});

test('legacy sleeve route redirects without reading D1', async t => {
    const auth = await accessFixture();
    t.after(auth.restore);
    let reads = 0;
    const render = await dashboardPreview({...auth.bindings, DB:{prepare() {
        reads++;
        throw new Error('Unexpected D1 read');
    }}});
    const headers = {'Cf-Access-Jwt-Assertion':await auth.token()};
    for (const [query, location] of [
        ['?collection=6&scope=test&lang=en', '/admin/collection/6/sleeves?scope=test&lang=en'],
        ['?collection=1', '/admin/collection/1/sleeves?scope=production'],
        ['?lang=en&scope=test', '/admin/sleeves?lang=en'],
        ['?collection=0&lang=en', '/admin/sleeves?lang=en'],
        ['?collection=9007199254740992', '/admin/sleeves'],
    ]) {
        const response = await render(new Request('https://admin.example.test/admin/sleeves/requirements' + query, {headers}));
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), location);
    }
    assert.equal(reads, 0);
});

test('sleeve and purchase tabs validate ID and scope and isolate purchase read failures', async t => {
    const {db, sqlite} = collectionDetailFixture();
    t.after(() => sqlite.close());
    const auth = await accessFixture();
    t.after(auth.restore);
    const render = await dashboardPreview({...auth.bindings, DB:db});
    const headers = {'Cf-Access-Jwt-Assertion':await auth.token()};
    const page = (path: string) => render(new Request('https://admin.example.test/admin' + path, {headers}));
    for (const tab of ['sleeves', 'purchases']) {
        assert.equal((await page('/collection/invalid/' + tab)).status, 400);
        assert.equal((await page('/collection/1/' + tab + '?scope=invalid')).status, 400);
        assert.equal((await page('/collection/99999/' + tab)).status, 404);
        assert.equal((await page('/collection/6/' + tab)).status, 404);
        assert.equal((await page('/collection/6/' + tab + '?scope=test')).status, 200);
    }

    sqlite.exec(`
        INSERT INTO v2_purchase_orders (id, currency_code, status, item_subtotal_minor) VALUES
          (51, 'TWD', 'paid', 150), (52, 'USD', 'completed', 20), (53, 'TWD', 'open', 900);
        INSERT INTO v2_purchase_allocations (purchase_order_id, collection_item_id, allocated_minor) VALUES
          (51, 1, 100), (51, 2, 50), (52, 1, 20), (53, 1, 900);
    `);
    const purchases = await page('/collection/1/purchases');
    assert.equal(purchases.status, 200);
    const html = await purchases.text();
    const costs = html.match(/<h2>此收藏的已記錄成本<\/h2>(.*?)<\/section>/s)?.[1] ?? '';
    assert.match(costs, /TWD · 100/);
    assert.match(costs, /USD · 20/);
    assert.doesNotMatch(costs, /\b(50|120|150|900)\b/);
    assert.match(html, /150 \/ 150 \/ 0/);
    assert.match(html, /\/admin\/purchases\?new=1&amp;collection=1/);
    assert.equal((await page('/purchases?collection=1')).status, 200);

    const prepare = db.prepare.bind(db);
    let failHeader = false;
    db.prepare = (sql: string) => {
        if (failHeader ? sql.includes('AS game_name') && sql.includes('WITH static')
            : sql.includes('FROM v2_purchase_orders o JOIN v2_purchase_order_reconciliation')) {
            throw new Error('Synthetic read failure');
        }
        return prepare(sql);
    };
    const failed = await page('/collection/1/purchases');
    assert.equal(failed.status, 503);
    const failedHtml = await failed.text();
    assert.match(failedHtml, /<h1>Alpha<\/h1>/);
    assert.match(failedHtml, /無法取得相關採購資料/);
    failHeader = true;
    assert.equal((await page('/collection/6/purchases')).status, 404);
    const missingHeader = await page('/collection/1/purchases');
    assert.equal(missingHeader.status, 200);
    assert.match(await missingHeader.text(), /無法取得收藏頁首.*此收藏的已記錄成本/s);
});
