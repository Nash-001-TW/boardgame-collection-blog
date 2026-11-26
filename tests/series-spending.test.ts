import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readSeriesSpending } from '../src/lib/series-spending.ts';
import { readPurchases } from '../src/lib/purchase-admin.ts';
import { readAdminDashboardSummary } from '../src/lib/admin-dashboard-summary.ts';
import { sleeveWorkflowFixture } from './helpers/sleeve-workflow-fixture.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

async function fixture(t: TestContext) {
    const { sqlite, db } = await sleeveWorkflowFixture();
    t.after(() => sqlite.close());
    const prepare = db.prepare.bind(db);
    db.prepare = sql => {
        assert.match(sql.trimStart(), /^SELECT\b/i);
        assert.doesNotMatch(sql, /\b(?:UNION|INTERSECT|EXCEPT|v2_cost_adjustments)\b/i);
        return prepare(sql);
    };
    return { sqlite, db, read: (id = 1) => readSeriesSpending(db, id) };
}

test('an isolated collection has itself as base and no recorded amounts', async t => {
    const { read } = await fixture(t);
    const result = await read();
    assert.equal(result.status, 'ready');
    assert.equal(result.baseId, 1);
    assert.deepEqual(result.members.map(row => row.id), [1]);
    assert.deepEqual(result.totals, []);
    assert.equal(result.missing, 1);
    assert.deepEqual(result.accessories, []);
    assert.deepEqual(result.accessoryTotals, []);
    assert.equal(result.accessoryMissing, 0);
});

test('one-hop collection, game and NotBGG ascent with direct membership and deterministic labels', async t => {
    const { sqlite, read } = await fixture(t);
    sqlite.exec(`
        INSERT INTO v2_games(id,primary_name,game_type) VALUES (2,'Game expansion','expansion'),(3,'Accessory','accessory');
        INSERT INTO v2_collection_items(id,game_id,display_name,item_type) VALUES
          (3,2,'Game expansion','expansion'),(4,3,'NotBGG accessory','accessory'),
          (5,NULL,'Same series','base'),(6,NULL,'Nested expansion','expansion'),(7,NULL,'Other','base');
        INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES(1,'fixture','fixture');
        BEGIN;
        INSERT INTO notbgg_games(seq,game_id,name,type) VALUES (1,3,'Accessory','boardgameaccessory');
        INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) VALUES (1,1,'{}','fixture');
        COMMIT;
        INSERT INTO site_game_relations(source_game_id,target_game_id,relation_type,created_by)
          VALUES (3,1,'compatible_with','fixture');
        INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type,relation_source,admin_confirmed)
          VALUES(2,1,'requires_base','import',0);
        INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type) VALUES
          (2,1,'expansion_of'),(2,1,'same_series'),(1,5,'same_series'),(6,2,'expansion_of'),(1,7,'other');
    `);
    for (const id of [1, 2, 3, 4, 6]) {
        const result = await read(id);
        assert.equal(result.status, 'ready');
        assert.equal(result.baseId, id === 6 ? 2 : 1);
        if (id !== 6) assert.deepEqual(result.members.map(row => [row.id, row.relation_type]), [
            [1, null], [2, 'expansion_of'], [3, 'requires_base'], [5, 'same_series'],
        ]);
        if (id !== 6) assert.deepEqual(result.accessories.map(row => [row.id, row.relation_type]), [[4, 'compatible_with']]);
    }
});

test('multiple valid bases fail closed and return sorted links data before reading costs', async t => {
    const { sqlite, db, read } = await fixture(t);
    sqlite.exec(`
        INSERT INTO v2_collection_items(id,game_id,display_name) VALUES (3,1,'Another base collection');
        INSERT INTO v2_games(id,primary_name) VALUES (2,'Game expansion');
        UPDATE v2_collection_items SET game_id=2 WHERE id=2;
        INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type) VALUES (2,1,'expansion_of');
        INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type) VALUES (2,1,'requires_base');
    `);
    const prepare = db.prepare.bind(db);
    db.prepare = sql => {
        assert.doesNotMatch(sql, /v2_purchase_allocations/);
        return prepare(sql);
    };
    const result = await read(2);
    assert.equal(result.status, 'ambiguous');
    assert.deepEqual(result.candidates.map(row => row.id), [1, 3]);
});

test('eligible allocations roll up by currency while shared bundle costs are separate', async t => {
    const { sqlite, read } = await fixture(t);
    sqlite.exec(`
        INSERT INTO v2_collection_items(id,display_name,item_type,record_scope) VALUES
          (3,'Shared bundle','bundle','production'),(4,'Unrelated','base','production'),
          (5,'Archived','base','production'),(6,'Test','base','test'),
          (7,'Archived edge','base','production'),(8,'Accessory without costs','accessory','production'),
          (9,'Unpriced bundle','bundle','production');
        INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES (5,'2026-11-25');
        INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type,archived_at) VALUES
          (2,1,'expansion_of',NULL),(2,1,'accessory_for',NULL),(8,1,'accessory_for',NULL),
          (1,5,'same_series',NULL),(1,6,'same_series',NULL),(1,7,'same_series','2026-11-25'),
          (3,1,'bundle_contains',NULL),(3,2,'bundle_contains',NULL),(3,4,'bundle_contains',NULL),
          (9,1,'bundle_contains',NULL);
        INSERT INTO v2_purchase_orders(id,currency_code,status,item_subtotal_minor) VALUES
          (1,'TWD','paid',1000),(2,'USD','partially_received',100),(3,'TWD','completed',100),
          (4,'TWD','open',200),(5,'TWD','cancelled',300);
        INSERT INTO v2_purchase_allocations(purchase_order_id,collection_item_id,allocated_minor) VALUES
          (1,1,100),(1,2,200),(1,3,500),(2,2,40),(4,1,200),(5,1,300);
        INSERT INTO v2_purchase_allocations(purchase_order_id,owned_copy_id,allocated_minor) VALUES(3,3,50);
    `);
    const result = await read();
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.members.map(row => row.id), [1, 2]);
    assert.deepEqual(result.accessories.map(row => row.id), [8]);
    assert.equal(result.members[1].relation_type, 'expansion_of');
    assert.deepEqual(result.members[1].costs.map(row => [row.currency_code,row.allocated_minor]), [['TWD',250],['USD',40]]);
    assert.deepEqual(result.totals.map(row => [row.currency_code,row.allocated_minor]), [['TWD',350],['USD',40]]);
    assert.equal(result.missing, 0);
    assert.equal(result.accessoryMissing, 1);
    assert.deepEqual(result.bundles.map(row => [row.id,row.included,row.in_series,row.costs[0]?.allocated_minor]), [
        [3,3,2,500], [9,1,1,undefined],
    ]);
    assert.deepEqual(await read(5), {status:'inapplicable'});
    assert.deepEqual(await read(6), {status:'inapplicable'});
});

test('applied sleeves and gifts use sheets and direct collection takes precedence over purchase line', async t => {
    const { sqlite, read } = await fixture(t);
    sqlite.exec(`
        INSERT INTO v2_purchase_orders(id,currency_code,status,item_subtotal_minor) VALUES(1,'TWD','paid',100);
        INSERT INTO v2_purchase_order_lines(id,purchase_order_id,line_number,description,collection_item_id)
          VALUES(1,1,1,'Fixture line',1);
        INSERT INTO v2_sleeve_inventory_transactions(id,product_id,transaction_type,transaction_date,quantity_sheets,owned_copy_id)
          VALUES(10,1,'USE','2026-11-25',-7,1);
        INSERT INTO v2_sleeve_applications(owned_copy_id,inventory_transaction_id,quantity_sheets) VALUES(1,10,7);
        INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,purchase_order_line_id)
          VALUES (1,'GIFT','2026-11-25',11,1,NULL),(1,'GIFT','2026-11-25',13,NULL,1),(1,'GIFT','2026-11-25',17,2,1);
    `);
    const result = await read();
    assert.equal(result.status, 'ready');
    assert.equal(result.applied, 7);
    assert.equal(result.gifts, 24);
    assert.deepEqual(result.totals, []);
});

test('member limit keeps the base and current collection and totals the displayed members', async t => {
    const { sqlite, read } = await fixture(t);
    const collection = sqlite.prepare('INSERT INTO v2_collection_items(id,display_name) VALUES (?,?)');
    const relation = sqlite.prepare("INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type) VALUES (?,1,'expansion_of')");
    for (let id = 10; id < 125; id++) {
        collection.run(id, 'Member ' + id);
        relation.run(id);
    }
    const result = await read(124);
    assert.equal(result.status, 'ready');
    assert.equal(result.truncated, true);
    assert.deepEqual(result.members.map(row => row.id), [1, ...Array.from({length:98}, (_, i) => i + 10), 124]);
    assert.equal(result.missing, 100);
});

test('a failed D1 result rejects the series read instead of returning partial totals', async t => {
    const { db, read } = await fixture(t);
    const batch = db.batch.bind(db);
    db.batch = async <T>(statements: D1PreparedStatement[]) => {
        const result = await batch<T>(statements);
        if (statements.length === 5) Object.assign(result[1], { success: false });
        return result;
    };
    await assert.rejects(read(), /Series spending query failed/);
});

test('TC01–TC09 and TC12–TC14: accessory allocations, relationships and series statistics remain separate', async t => {
    const { sqlite, db, read } = await fixture(t);
    sqlite.exec(`
        INSERT INTO v2_games(id,primary_name,game_type) VALUES
          (2,'Other base','base'),(3,'Shared','accessory'),(4,'Compatible','accessory'),(5,'Dedicated','accessory'),
          (6,'Game relation accessory','accessory');
        UPDATE v2_games SET bgg_id=990002 WHERE id=2;
        INSERT INTO v2_collection_items(id,game_id,display_name,item_type) VALUES
          (10,3,'Shared','accessory'),(11,4,'Compatible','accessory'),(12,5,'Dedicated','accessory'),
          (13,2,'Other base','base'),(14,NULL,'Accessory-only bundle','bundle'),
          (15,NULL,'Mixed bundle','bundle'),(16,NULL,'Collection-only accessory','accessory'),
          (17,NULL,'Same series','base'),(18,6,'Game relation accessory','accessory');
        INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES(1,'shared','shared'),(2,'compatible','compatible'),(3,'dedicated','dedicated');
        BEGIN;
        INSERT INTO notbgg_games(seq,game_id,name,type) VALUES
          (1,3,'Shared','boardgameaccessory'),(2,4,'Compatible','boardgameaccessory'),(3,5,'Dedicated','boardgameaccessory');
        INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) VALUES
          (1,1,'{}','fixture'),(2,1,'{}','fixture'),(3,1,'{}','fixture');
        COMMIT;
        INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type) VALUES
          (10,1,'accessory_for'),(16,1,'accessory_for'),(2,1,'accessory_for'),(2,1,'expansion_of'),(17,1,'same_series'),
          (14,10,'bundle_contains'),(15,10,'bundle_contains'),(15,1,'bundle_contains');
        INSERT INTO v2_game_relations(source_game_id,target_game_id,relation_type) VALUES (3,1,'accessory_for'),(6,1,'accessory_for');
        INSERT INTO site_game_relations(source_game_id,target_game_id,relation_type,created_by) VALUES
          (3,1,'accessory_for','fixture'),(3,2,'compatible_with','fixture'),
          (4,1,'compatible_with','fixture'),(5,1,'accessory_for','fixture');
        INSERT INTO v2_purchase_orders(id,currency_code,status,item_subtotal_minor) VALUES
          (1,'TWD','paid',600),(2,'USD','partially_received',50),(3,'TWD','completed',30),
          (4,'TWD','open',90),(5,'USD','cancelled',80);
        INSERT INTO v2_purchase_allocations(purchase_order_id,collection_item_id,allocated_minor) VALUES
          (1,1,100),(1,2,200),(1,10,300),(2,10,50),(3,10,20),(3,11,0),(4,12,90),(5,12,80),(3,16,10);
        INSERT INTO v2_owned_copies(id,collection_item_id,copy_label) VALUES (90,10,'Accessory copy');
        INSERT INTO v2_sleeve_inventory_transactions(id,product_id,transaction_type,transaction_date,quantity_sheets,owned_copy_id)
          VALUES(90,1,'USE','2026-11-26',-7,90);
        INSERT INTO v2_sleeve_applications(owned_copy_id,inventory_transaction_id,quantity_sheets) VALUES(90,90,7);
        INSERT INTO v2_sleeve_inventory_transactions(product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id)
          VALUES(1,'GIFT','2026-11-26',11,10);
    `);
    const purchases = () => readPurchases(db, new URLSearchParams());
    const before = await purchases();
    const dashboard = () => readAdminDashboardSummary(sqliteD1(sqlite));
    const dashboardBefore = (await dashboard()).purchases;
    assert.ok(dashboardBefore);
    assert.deepEqual(dashboardBefore.active, [{ currency:'TWD', amount:630 }, { currency:'USD', amount:50 }]);
    const result = await read();
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.members.map(row => [row.id, row.relation_type]), [[1,null],[2,'expansion_of'],[17,'same_series']]);
    assert.deepEqual(result.accessories.map(row => [row.id, row.relation_type, row.costs.map(cost => [cost.currency_code,cost.allocated_minor])]), [
        [10,'accessory_for',[['TWD',320],['USD',50]]], [11,'compatible_with',[['TWD',0]]],
        [12,'accessory_for',[]], [16,'accessory_for',[['TWD',10]]], [18,'accessory_for',[]],
    ]);
    assert.deepEqual(result.totals.map(row => [row.currency_code,row.allocated_minor]), [['TWD',300]]);
    assert.deepEqual(result.accessoryTotals.map(row => [row.currency_code,row.allocated_minor]), [['TWD',330],['USD',50]]);
    assert.equal(result.missing, 1);
    assert.equal(result.accessoryMissing, 2);
    assert.equal(result.applied, 0);
    assert.equal(result.gifts, 0);
    assert.deepEqual(result.bundles.map(row => [row.id,row.included,row.in_series]), [[15,2,1]]);

    const other = await read(13);
    assert.equal(other.status, 'ready');
    assert.deepEqual(other.accessories.map(row => [row.id,row.relation_type]), [[10,'compatible_with']]);
    assert.deepEqual(other.accessoryTotals, result.accessories[0].costs);
    const ambiguous = await read(10);
    assert.equal(ambiguous.status, 'ambiguous');
    assert.deepEqual(ambiguous.candidates.map(row => row.id), [1,13]);

    assert.deepEqual((await purchases()).totals, before.totals);
    sqlite.exec("UPDATE v2_collection_relations SET archived_at='2026-11-26' WHERE source_item_id=16");
    const archived = await read();
    assert.equal(archived.status, 'ready');
    assert.deepEqual(archived.accessories.map(row => row.id), [10,11,12,18]);
    assert.deepEqual(archived.accessoryTotals, other.accessoryTotals);
    assert.equal(archived.accessoryMissing, 2);
    assert.deepEqual(await purchases(), before);
    assert.deepEqual((await dashboard()).purchases, dashboardBefore);

    const batch = db.batch.bind(db);
    db.batch = async <T>(statements: D1PreparedStatement[]) => {
        const result = await batch<T>(statements);
        if (statements.length === 6) Object.assign(result[5], { success: false });
        return result;
    };
    await assert.rejects(read(), /Series spending query failed/);
});

test('TC10: mixed relationships share the original cap and reserve the current accessory slot', async t => {
    const { sqlite, read } = await fixture(t);
    const collection = sqlite.prepare('INSERT INTO v2_collection_items(id,display_name) VALUES (?,?)');
    const relation = sqlite.prepare('INSERT INTO v2_collection_relations(source_item_id,target_item_id,relation_type) VALUES (?,1,?)');
    for (let id = 10; id < 125; id++) {
        collection.run(id, 'Related ' + id);
        relation.run(id, id % 2 ? 'same_series' : 'accessory_for');
    }
    sqlite.exec(`
        INSERT INTO v2_purchase_orders(id,currency_code,status,item_subtotal_minor) VALUES(1,'TWD','paid',80);
        INSERT INTO v2_purchase_allocations(purchase_order_id,collection_item_id,allocated_minor)
          VALUES(1,108,40),(1,124,20),(1,109,20);
    `);
    const result = await read(124);
    assert.equal(result.status, 'ready');
    assert.equal(result.truncated, true);
    assert.deepEqual(result.members.map(row => row.id), [1, ...Array.from({length:49}, (_, i) => i * 2 + 11)]);
    assert.deepEqual(result.accessories.map(row => row.id), [...Array.from({length:49}, (_, i) => i * 2 + 10), 124]);
    assert.deepEqual(result.totals, []);
    assert.deepEqual(result.accessoryTotals, [{ currency_code:'TWD', allocated_minor:20 }]);
});
