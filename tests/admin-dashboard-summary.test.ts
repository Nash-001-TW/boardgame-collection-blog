import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readAdminDashboardSummary } from '../src/lib/admin-dashboard-summary';
import { r01Fixture } from './helpers/admin-dashboard-preview';

test('R01 keeps existing collection and source counts and scopes related records to production', async t => {
    const fixture = r01Fixture();
    t.after(() => fixture.sqlite.close());
    const summary = await readAdminDashboardSummary(fixture.db);
    assert.deepEqual({ ...summary.collection }, { total: 3, owned: 2, wishlist: 1, preorder: 1 });
    assert.deepEqual({ ...summary.sleeves }, { sizes: 2, requirements: 1 });
    assert.deepEqual({ ...summary.components }, { definitions: 1, records: 1 });
    assert.deepEqual({ ...summary.sources }, { bgg: 1, notbgg: 1 });
    assert.deepEqual({ ...summary.sync }, { failed: 0 });
    assert.doesNotMatch(readFileSync('src/pages/admin/index.astro', 'utf8'), /庫存不足|sleeve shortage|insufficient stock/i);
});

test('BGG counts current failures regardless of date and matches the interrupted sync filter', async t => {
    const fixture = r01Fixture('warning');
    t.after(() => fixture.sqlite.close());
    fixture.sqlite.exec(`
        UPDATE v2_bgg_sync_gate SET owner = 'active', lease_until = (unixepoch('now') + 3600) * 1000 WHERE id = 1;
        INSERT INTO bgg_games(bgg_id,name,sync_status,sync_owner,last_error_code) VALUES
            (4,'Interrupted','syncing','expired',NULL),
            (5,'Active','syncing','active',NULL),
            (6,'Recovered','success',NULL,'OLD_FAILURE');
    `);
    assert.deepEqual({ ...(await readAdminDashboardSummary(fixture.db)).sync }, { failed: 2 });
});

test('R10 separates currency, archive, statuses and positive balances, preserving valid zero allocations', async t => {
    const fixture = r01Fixture();
    t.after(() => fixture.sqlite.close());
    assert.deepEqual((await readAdminDashboardSummary(fixture.db)).purchases, {
        active: [{ currency: 'EUR', amount: 0 }, { currency: 'TWD', amount: 7000 }, { currency: 'USD', amount: 1500 }],
        archived: [{ currency: 'JPY', amount: 500 }],
        unallocated: [{ currency: 'TWD', amount: 3000 }],
        excess: [], inconsistent: [], review: [], open: 1, cancelled: 1,
    });
});

test('R10 classifies the four exceptions without flagging legal order-level, copy, mixed or manual allocations', async t => {
    const fixture = r01Fixture('warning');
    t.after(() => fixture.sqlite.close());
    const purchase = (await readAdminDashboardSummary(fixture.db)).purchases;
    assert.ok(purchase);
    assert.deepEqual(purchase.inconsistent, [7, 9, 11, 12, 13]);
    assert.deepEqual(purchase.review, [8, 10]);
    assert.deepEqual(purchase.excess, [{ currency: 'TWD', count: 1, amount: 500 }]);
    assert.deepEqual(purchase.unallocated, [{ currency: 'TWD', amount: 3080 }, { currency: 'USD', amount: 500 }]);
    assert.deepEqual(purchase.active.find(row => row.currency === 'TWD'), { currency: 'TWD', amount: 8910 });
});

test('R01 distinguishes genuinely empty data from a failed section', async t => {
    const empty = r01Fixture('empty');
    const failed = r01Fixture('failure');
    t.after(() => { empty.sqlite.close(); failed.sqlite.close(); });
    const summary = await readAdminDashboardSummary(empty.db);
    assert.deepEqual({ ...summary.collection }, { total: 0, owned: 0, wishlist: 0, preorder: 0 });
    assert.deepEqual({ ...summary.sync }, { failed: 0 });
    assert.deepEqual(summary.purchases, {
        active: [], archived: [], unallocated: [], excess: [], inconsistent: [], review: [], open: 0, cancelled: 0,
    });
    assert.match(readFileSync('src/pages/admin/index.astro', 'utf8'), /尚未記錄/);
    const isolated = await readAdminDashboardSummary(failed.db);
    assert.equal(isolated.components, null);
    for (const section of ['collection', 'sleeves', 'sources', 'sync', 'purchases'] as const) assert.ok(isolated[section]);
    assert.deepEqual(Object.values(await readAdminDashboardSummary(undefined)), Array(6).fill(null));
});
