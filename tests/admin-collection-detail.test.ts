import assert from 'node:assert/strict';
import test from 'node:test';
import { readCollectionHeader } from '../src/lib/collection-v2-management';
import { accessFixture } from './helpers/notbgg-access-fixture';
import { collectionDetailFixture, dashboardPreview } from './helpers/admin-dashboard-preview';

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
