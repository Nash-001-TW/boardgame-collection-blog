import assert from 'node:assert/strict';
import test from 'node:test';
import { readSleeveShortage } from '../src/lib/sleeve-shortage';
import { readSleeveAdmin } from '../src/lib/sleeve-admin';
import { readAdminDashboardSummary } from '../src/lib/admin-dashboard-summary';
import { r01Fixture } from './helpers/admin-dashboard-preview';

type State = Parameters<typeof r01Fixture>[0];
function fixture(t: { after: (fn: () => void) => void }, state?: State, omitSyntheticOpening = false) {
    const result = r01Fixture(state, undefined, omitSyntheticOpening);
    t.after(() => result.sqlite.close());
    return result;
}

test('expands each requirement, includes loaned copies, limits specified copies and excludes archived and test collections', async t => {
    const { db, sqlite } = fixture(t, 'shortage');
    sqlite.exec(`
        UPDATE v2_sleeve_requirements SET quantity_sheets=100 WHERE collection_item_id=1;
        INSERT INTO v2_owned_copies(id,collection_item_id,copy_label,inventory_status) VALUES
            (2,1,'Loaned','loaned'),(3,1,'Sold','sold'),(4,1,'Gifted','gifted_away'),(5,1,'Lost','lost');
        UPDATE v2_sleeve_requirements SET owned_copy_id=2 WHERE size_id=3;
        INSERT INTO v2_sleeve_requirements(collection_item_id,owned_copy_id,size_id,quantity_sheets)
            VALUES (1,3,3,500),(1,4,3,500),(1,5,3,500);
    `);
    const result = await readSleeveShortage(db);
    assert.equal(result.rows.find(row => row.id === 1)?.pending, 200);
    assert.equal(result.rows.find(row => row.id === 3)?.pending, 100);
    assert.equal(result.rows.find(row => row.id === 2)?.requirementCount, 0);
});

test('two collections needing 80 each with 100 available have a global gap of 60', async t => {
    const { db, sqlite } = fixture(t, 'shortage');
    sqlite.exec(`
        UPDATE v2_sleeve_requirements SET quantity_sheets=80 WHERE collection_item_id=1 AND size_id=1;
        INSERT INTO v2_owned_copies(id,collection_item_id,copy_label) VALUES (2,3,'Other');
        INSERT INTO v2_sleeve_requirements(collection_item_id,size_id,quantity_sheets) VALUES (3,1,80);
        INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets)
            VALUES (1,'ADJUST','2026-11-25',90);
    `);
    const row = (await readSleeveShortage(db)).rows.find(row => row.id === 1);
    assert.deepEqual([row?.pending, row?.available, row?.gap], [160, 100, 60]);
});

test('applied quantities are deducted by requirement and copy, including multiple products', async t => {
    const { db, sqlite } = fixture(t, 'shortage');
    sqlite.exec(`
        INSERT INTO v2_sleeve_products(id,size_id,product_name,sheets_per_pack) VALUES (5,1,'Other product',100);
        INSERT INTO v2_sleeve_inventory_transactions(id,product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,owned_copy_id)
            VALUES (5,5,'OPENING_BALANCE','2026-11-25',100,NULL,NULL),
                   (6,1,'USE','2026-11-25',-5,1,1),(7,5,'USE','2026-11-25',-7,1,1);
        UPDATE v2_sleeve_requirements SET component_definition_id=1 WHERE id=1;
        INSERT INTO v2_sleeve_applications(owned_copy_id,copy_component_id,inventory_transaction_id,quantity_sheets,requirement_id)
            VALUES (1,1,6,5,1),(1,1,7,7,1);
        INSERT INTO v2_owned_copies(collection_item_id,copy_label,inventory_status) VALUES (1,'Second','loaned');
    `);
    const row = (await readSleeveShortage(db)).rows.find(row => row.id === 1);
    assert.deepEqual([row?.pending, row?.available, row?.gap], [48, 98, 0]);
});

test('separates missing products, unestablished stock, tracked zero and all inactive products', async t => {
    const { db, sqlite } = fixture(t, 'shortage');
    sqlite.exec(`
        INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES (7,500,730);
        INSERT INTO v2_sleeve_products(id,size_id,product_name,sheets_per_pack) VALUES (7,7,'Recorded zero',50);
        INSERT INTO v2_sleeve_requirements(collection_item_id,size_id,quantity_sheets) VALUES (1,7,30);
        INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets)
            VALUES (7,'OPENING_BALANCE','2026-11-25',30);
        INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets)
            VALUES (7,'ADJUST','2026-11-25',-30);
    `);
    const result = await readSleeveShortage(db);
    const values = (id: number) => {
        const row = result.rows.find(row => row.id === id)!;
        return [row.status, row.available, row.gap, row.inactiveStock];
    };
    assert.deepEqual(values(4), ['no_product', null, null, 0]);
    assert.deepEqual(values(3), ['incomplete', null, null, 0]);
    assert.deepEqual(values(6), ['shortage', 0, 30, 100]);
    assert.deepEqual(values(5), ['sufficient', 30, 0, 0]);
    assert.deepEqual(values(7), ['shortage', 0, 30, 0]);
});

const cases = {
    unknown_copy: "INSERT INTO v2_owned_copies(collection_item_id,copy_label,inventory_status) VALUES (3,'Unknown','unknown')",
    missing_copy: "UPDATE v2_owned_copies SET inventory_status='sold' WHERE id=2",
    unknown_stock: '',
    legacy_application: `INSERT INTO v2_sleeve_inventory_transactions(id,product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,owned_copy_id)
        VALUES (99,3,'USE','2026-11-25',-1,3,2);
        INSERT INTO v2_sleeve_applications(owned_copy_id,inventory_transaction_id,quantity_sheets) VALUES (2,99,1)`,
    invalid_quantity: `DROP TRIGGER v2_application_requirement_validate;
        INSERT INTO v2_sleeve_inventory_transactions(id,product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,owned_copy_id)
        VALUES (99,3,'USE','2026-11-25',-30,3,2);
        INSERT INTO v2_sleeve_applications(owned_copy_id,inventory_transaction_id,quantity_sheets,requirement_id)
        VALUES (2,99,30,99)`,
} as const;
for (const [reason, sql] of Object.entries(cases)) {
    test(reason + ' affects only the related size', async t => {
        const { db, sqlite } = fixture(t, 'shortage', reason === 'unknown_stock');
        sqlite.exec(`
            INSERT INTO v2_owned_copies(id,collection_item_id,copy_label) VALUES (2,3,'Second collection');
            INSERT INTO v2_sleeve_requirements(id,collection_item_id,size_id,quantity_sheets) VALUES (99,3,5,20);
            ${sql};
        `);
        const result = await readSleeveShortage(db);
        const row = result.rows.find(row => row.id === 5)!;
        assert.equal(row.status, 'incomplete');
        assert.deepEqual(row.reasons, [reason]);
        assert.deepEqual([row.available, row.gap], [null, null]);
        assert.equal(result.rows.find(row => row.id === 1)?.status, 'shortage');
        assert.equal(result.rows.find(row => row.id === 4)?.status, 'no_product');
    });
}

test('gift is available stock even as the first transaction', async t => {
    const { db, sqlite } = fixture(t, 'shortage', true);
    sqlite.exec(`INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets)
        VALUES (3,'GIFT','2026-11-25',30)`);
    const row = (await readSleeveShortage(db)).rows.find(row => row.id === 5);
    assert.deepEqual([row?.available,row?.gap,row?.status], [30,0,'sufficient']);
});

test('status ordering, size filters and R01 counts share the same results', async t => {
    const { db } = fixture(t, 'shortage');
    const sizes = (query: string) => readSleeveAdmin(db, new URLSearchParams('view=sizes&' + query), undefined);
    assert.deepEqual((await sizes('')).rows.map(row => row.id), [6, 1, 3, 2, 4, 5]);
    assert.deepEqual((await sizes('status=shortage&size=1')).rows.map(row => row.id), [1]);
    assert.deepEqual((await sizes('status=demand')).rows.map(row => row.id), [6, 1, 3, 4, 5]);
    const dashboard = await readAdminDashboardSummary(db);
    assert.equal(dashboard.sleeves?.shortage, (await sizes('status=shortage')).rows.length);
    assert.equal(dashboard.sleeves?.incomplete, (await sizes('status=incomplete')).rows.length);
});

test('sleeve failure is isolated on R01 and unsafe numeric results are rejected', async t => {
    const baseline = fixture(t);
    const failed = fixture(t, 'sleeve-failure');
    assert.deepEqual(await readAdminDashboardSummary(failed.db), { ...await readAdminDashboardSummary(baseline.db), sleeves: null });
    await assert.rejects(readSleeveShortage(failed.db), /Synthetic sleeve read failure/);
    baseline.sqlite.exec('UPDATE v2_sleeve_requirements SET quantity_sheets=9007199254740992 WHERE collection_item_id=1');
    await assert.rejects(readSleeveShortage(baseline.db));
});

test('production-shaped snapshot with no products or copies keeps all demanded sizes in no_product', async t => {
    const { db, sqlite } = fixture(t);
    sqlite.exec(`
        DELETE FROM v2_copy_components;
        DELETE FROM v2_purchase_allocations;
        DELETE FROM v2_owned_copies;
        INSERT INTO v2_sleeve_requirements(collection_item_id,size_id,quantity_sheets) VALUES (3,2,30);
    `);
    const result = await readSleeveShortage(db);
    assert.deepEqual(result.totals, { shortage: 0, incomplete: 0, no_product: 2 });
    assert.ok(result.rows.every(row => row.pending === null && row.available === null && row.gap === null));
});

test('unlocatable legacy applications appear in aggregate without contaminating any size', async t => {
    const { db, sqlite } = fixture(t, 'shortage');
    sqlite.exec(`
        PRAGMA foreign_keys = OFF;
        DROP TRIGGER v2_sleeve_application_validate_insert;
        INSERT INTO v2_sleeve_applications(owned_copy_id,inventory_transaction_id,quantity_sheets)
            VALUES (1,999,10);
        PRAGMA foreign_keys = ON;
    `);
    const result = await readSleeveShortage(db);
    assert.equal(result.unlocatedHistoricalCount, 1);
    assert.ok(result.rows.every(row => row.historicalCount === 0 && !row.reasons.includes('legacy_application')));
});
