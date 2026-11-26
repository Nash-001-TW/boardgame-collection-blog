import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import {
    changeComponentApplicability, readCollectionApplicability, readComponentApplicability,
    validApplicabilityGeneration,
} from '../src/lib/component-applicability.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const target = { collectionId: 1, copyId: 1, definitionId: 1 };
const actor = 'synthetic-admin';
const proof = { definitionRevision: 1, signature: '3'.padStart(64, '0') };
const history = 'v2_component_applicability_events';
const eventColumns = '(collection_id, copy_id, definition_id, revision, before_not_applicable, after_not_applicable, actor, origin, before_generation)';

function fixture(t: TestContext, productionOrder = false) {
    const sql = new DatabaseSync(':memory:');
    t.after(() => sql.close());
    sql.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = OFF');
    const files = readdirSync('migrations').filter(file => /^00(?:0[1-9]|1[0-9]|2[0-5])_.*\.sql$/.test(file)).sort();
    assert.equal(files.length, 25);
    if (productionOrder) files.splice(23, 2, files[24], files[23]);
    const schema = () => sql.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all();
    for (const file of files) {
        const before = productionOrder && file.startsWith('0024_') ? schema() : null;
        sql.exec(readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
        if (before) {
            const names = new Set(before.map(object => object.name));
            assert.deepEqual(schema().filter(object => names.has(object.name)), before);
        }
    }
    sql.exec(`
        INSERT INTO v2_collection_items(id, display_name, record_scope)
        VALUES (1, 'Synthetic', 'test'), (2, 'Other', 'production');
        INSERT INTO v2_owned_copies(id, collection_item_id, edition) VALUES (1, 1, 'A'), (2, 2, 'B'), (3, 1, 'C');
        INSERT INTO v2_component_definitions(id, collection_item_id, component_name, component_type,
            quantity_unit, physical_creation_token, physical_revision, expected_quantity)
        VALUES (1, 1, 'Cards', 'card', 'card', printf('%064x', 1), 1, 20),
               (2, 1, 'Legacy', 'card', 'card', NULL, 0, 20),
               (3, 2, 'Other cards', 'card', 'card', printf('%064x', 3), 1, 20);
        INSERT INTO v2_physical_component_sources(definition_id, collection_item_id, record_scope,
            creation_token, actor, request_digest, signature)
        VALUES (1, 1, 'test', printf('%064x', 1), 'synthetic', printf('%064x', 2), printf('%064x', 3)),
               (3, 2, 'production', printf('%064x', 3), 'synthetic', printf('%064x', 4), printf('%064x', 5));
    `);
    const db = sqliteD1(sql);
    const generation = () => String(sql.prepare(
        'SELECT CAST(generation AS TEXT) AS value FROM d1_quantity_collection_generation WHERE collection_id = 1',
    ).get()?.value);
    const events = () => sql.prepare(`SELECT * FROM ${history} ORDER BY copy_id, definition_id, revision`).all();
    const read = () => readComponentApplicability(db, target);
    const change = (revision: number, next: 'applicable' | 'not_applicable', copyId = 1) =>
        changeComponentApplicability(db, { ...target, ...proof, copyId, revision, next, actor });
    return { sql, db, generation, events, read, change };
}

test('default applicability and three alternating revisions use the current generation', async t => {
    const f = fixture(t);
    const initial = f.generation();
    assert.equal(validApplicabilityGeneration(initial), true);
    assert.deepEqual(await f.read(), { ...target, status: 'applicable', revision: 0, generation: initial });
    assert.deepEqual(await readCollectionApplicability(f.db, 1), []);
    const transitions = ['not_applicable', 'applicable', 'not_applicable'] as const;
    for (const [revision, next] of transitions.entries()) {
        const before = f.generation();
        await f.change(revision, next);
        assert.equal(f.generation(), String(BigInt(before) + 1n));
        assert.deepEqual(await f.read(), { ...target, status: next, revision: revision + 1, generation: f.generation() });
        const event = f.events()[revision];
        assert.equal(String(event.before_generation), before);
        assert.equal(event.actor, actor);
        assert.equal(event.origin, 'change');
        assert.equal(typeof event.occurred_at, 'number');
    }
});

test('stale, skipped and no-op revisions do not change history or generation', async t => {
    const f = fixture(t);
    await f.change(0, 'not_applicable');
    const events = f.events();
    const generation = f.generation();
    await assert.rejects(f.change(0, 'not_applicable'), /APPLICABILITY_STATE_CHANGED/);
    await assert.rejects(f.change(2, 'applicable'), /APPLICABILITY_STATE_CHANGED/);
    await assert.rejects(f.change(1, 'not_applicable'), /APPLICABILITY_STATE_CHANGED/);
    assert.deepEqual(f.events(), events);
    assert.equal(f.generation(), generation);
});

test('cross-collection and non-candidate targets are rejected by reads and writes', async t => {
    const f = fixture(t);
    const generation = f.generation();
    for (const invalid of [{ ...target, copyId: 2 }, { ...target, definitionId: 2 }, { ...target, definitionId: 3 },
        { ...target, collectionId: 99 }]) {
        assert.deepEqual(await readComponentApplicability(f.db, invalid),
            { ...invalid, status: 'unknown', reason: 'TARGET_INVALID' });
        await assert.rejects(changeComponentApplicability(f.db, { ...invalid, ...proof, revision: 0, next: 'not_applicable', actor }),
            /APPLICABILITY_STATE_CHANGED/);
    }
    assert.deepEqual(f.events(), []);
    assert.equal(f.generation(), generation);
});

test('initial history and stale generation are rejected even for direct SQL', t => {
    const f = fixture(t);
    const generation = f.generation();
    const insert = f.sql.prepare(`INSERT OR IGNORE INTO ${history} ${eventColumns}
        VALUES (1, 1, 1, 1, 0, 1, ?, ?, CAST(? AS INTEGER))`);
    assert.throws(() => insert.run(actor, 'initial', generation), /APPLICABILITY_INITIAL_DISABLED/);
    assert.throws(() => insert.run(actor, 'change', String(BigInt(generation) + 1n)), /APPLICABILITY_GENERATION_CHANGED/);
    assert.deepEqual(f.events(), []);
    assert.equal(f.generation(), generation);
});

test('changes after proof verification reject the entire event write', async t => {
    for (const [name, mutation] of [
        ['definition revision', 'UPDATE v2_component_definitions SET physical_revision = 2 WHERE id = 1'],
        ['source signature', `DROP TRIGGER v2_physical_source_no_update;
            UPDATE v2_physical_component_sources SET signature = printf('%064x', 7) WHERE definition_id = 1`],
        ['inventory status', "UPDATE v2_owned_copies SET inventory_status = 'loaned' WHERE id = 1"],
        ['seal status', "UPDATE v2_owned_copies SET seal_status = 'sealed' WHERE id = 1"],
    ]) {
        await t.test(name, async t => {
            const f = fixture(t);
            f.sql.exec(mutation);
            const generation = f.generation();
            await assert.rejects(f.change(0, 'not_applicable'), /APPLICABILITY_STATE_CHANGED/);
            assert.deepEqual(f.events(), []);
            assert.equal(f.generation(), generation);
        });
    }
});

test('multi-row INSERT SELECT rolls back a valid first event under all conflict policies', t => {
    const f = fixture(t);
    const generation = f.generation();
    for (const policy of ['', 'OR IGNORE', 'OR REPLACE']) {
        assert.throws(() => f.sql.prepare(`INSERT ${policy} INTO ${history} ${eventColumns}
            SELECT 1, id, 1, 1, 0, 1, ?, 'change', CAST(? AS INTEGER)
            FROM v2_owned_copies WHERE collection_item_id = 1 ORDER BY id`).run(actor, generation),
        /APPLICABILITY_GENERATION_CHANGED/);
        assert.deepEqual(f.events(), []);
        assert.equal(f.generation(), generation);
    }
});

test('existing history cannot be updated, deleted, replaced or ignored', async t => {
    const f = fixture(t);
    await f.change(0, 'not_applicable');
    const events = f.events();
    const generation = f.generation();
    assert.throws(() => f.sql.exec(`UPDATE ${history} SET actor = 'altered'`), /APPLICABILITY_HISTORY_IMMUTABLE/);
    assert.throws(() => f.sql.exec(`DELETE FROM ${history}`), /APPLICABILITY_HISTORY_IMMUTABLE/);
    for (const policy of ['OR REPLACE', 'OR IGNORE']) {
        assert.throws(() => f.sql.prepare(`INSERT ${policy} INTO ${history} ${eventColumns}
            VALUES (1, 1, 1, 1, 0, 1, ?, 'change', CAST(? AS INTEGER))`).run(actor, generation),
        /APPLICABILITY_STATE_CHANGED/);
    }
    assert.throws(() => f.sql.exec('DELETE FROM v2_owned_copies WHERE id = 1'), /FOREIGN KEY/);
    assert.deepEqual(f.events(), events);
    assert.equal(f.generation(), generation);
});

test('actor length is enforced in the library and under direct INSERT OR IGNORE', async t => {
    const f = fixture(t);
    const generation = f.generation();
    const change = { ...target, ...proof, revision: 0, next: 'not_applicable' as const };
    for (const invalid of ['   ', 'a'.repeat(321)]) {
        await assert.rejects(changeComponentApplicability(f.db, { ...change, actor: invalid }), /APPLICABILITY_CHANGE_INVALID/);
        assert.throws(() => f.sql.prepare(`INSERT OR IGNORE INTO ${history} ${eventColumns}
            VALUES (1, 1, 1, 1, 0, 1, ?, 'change', CAST(? AS INTEGER))`).run(invalid, generation),
        /APPLICABILITY_CHANGE_INVALID/);
    }
    assert.throws(() => f.sql.prepare(`INSERT OR IGNORE INTO ${history} ${eventColumns}
        SELECT c.collection_item_id, c.id, p.id, 1, 0, 1, CASE c.id WHEN 1 THEN ? ELSE ? END, 'change', g.generation
        FROM v2_owned_copies c
        JOIN v2_physical_component_candidates p ON p.collection_item_id = c.collection_item_id
        JOIN d1_quantity_collection_generation g ON g.collection_id = c.collection_item_id
        WHERE c.id IN (1, 2) ORDER BY c.id`).run(actor, 'a'.repeat(321)), /APPLICABILITY_CHANGE_INVALID/);
    assert.deepEqual(f.events(), []);
    assert.equal(f.generation(), generation);
    await changeComponentApplicability(f.db, { ...change, actor: ' ' + 'a'.repeat(320) + ' ' });
    assert.equal(f.events().length, 1);
});

test('a count advances generation without blocking an observed pair revision or losing count evidence', async t => {
    const f = fixture(t);
    const observed = await f.read();
    assert.equal(observed.status, 'applicable');
    f.sql.exec(`INSERT INTO v2_copy_components
        (owned_copy_id, component_definition_id, actual_quantity, inspection_status, last_checked_at, count_revision)
        VALUES (1, 1, 19, 'checked', '2026-11-26T00:00:00Z', 1)`);
    const count = () => f.sql.prepare('SELECT * FROM v2_copy_components').all();
    const evidence = count();
    const generationAfterCount = f.generation();
    assert.notEqual(generationAfterCount, observed.generation);
    await f.change(observed.revision, 'not_applicable');
    assert.equal(String(f.events()[0].before_generation), generationAfterCount);
    await f.change(1, 'applicable');
    assert.deepEqual(count(), evidence);
    assert.equal((await f.read()).status, 'applicable');
});

test('read failures reject and a missing generation fails closed for a valid target', async t => {
    const f = fixture(t);
    const unavailableDb = { prepare() { throw new Error('synthetic read failure'); } } as unknown as D1Database;
    await assert.rejects(readComponentApplicability(unavailableDb, target), /synthetic read failure/);
    await assert.rejects(readCollectionApplicability(unavailableDb, 1), /synthetic read failure/);
    // Simulate a damaged generation table in this disposable database.
    f.sql.exec('DROP TRIGGER d1_generation_no_delete; DELETE FROM d1_quantity_collection_generation WHERE collection_id = 1');
    await assert.rejects(f.read(), /APPLICABILITY_GENERATION_CHANGED/);
    // The guarded INSERT now rejects a missing generation as a zero-row write.
    await assert.rejects(f.change(0, 'not_applicable'), /APPLICABILITY_STATE_CHANGED/);
    assert.deepEqual(f.events(), []);
});

test('collection read returns only current exclusions with their pair revisions', async t => {
    const f = fixture(t);
    await f.change(0, 'not_applicable');
    await f.change(0, 'not_applicable', 3);
    await f.change(1, 'applicable');
    await f.change(2, 'not_applicable');
    await changeComponentApplicability(f.db, { collectionId: 2, copyId: 2, definitionId: 3,
        ...proof, signature: '5'.padStart(64, '0'), revision: 0, next: 'not_applicable', actor });
    const exclusions = async (collectionId: number) =>
        (await readCollectionApplicability(f.db, collectionId)).map(row => ({ ...row }));
    assert.deepEqual(await exclusions(1), [
        { copyId: 1, definitionId: 1, revision: 3 }, { copyId: 3, definitionId: 1, revision: 1 },
    ]);
    await f.change(1, 'applicable', 3);
    assert.deepEqual(await exclusions(1), [{ copyId: 1, definitionId: 1, revision: 3 }]);
    assert.deepEqual(await exclusions(2), [{ copyId: 2, definitionId: 3, revision: 1 }]);
});

test('production order 0001–0023, 0025, 0024 preserves GIFT and sleeve ledger locks', async t => {
    const f = fixture(t, true);
    await f.change(0, 'not_applicable');
    assert.equal((await f.read()).status, 'not_applicable');
    assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
    f.sql.exec(`
        INSERT INTO v2_sleeve_sizes(id, width_tenth_mm, height_tenth_mm) VALUES (1, 631, 881);
        INSERT INTO v2_sleeve_products(id, size_id, product_name, sheets_per_pack) VALUES (1, 1, 'Pack', 100);
        INSERT INTO v2_sleeve_inventory_transactions(product_id, transaction_type, transaction_date, quantity_sheets)
        VALUES (1, 'GIFT', '2026-11-26', 7);
    `);
    assert.equal(f.sql.prepare('SELECT balance_sheets FROM v2_sleeve_inventory_balance WHERE product_id = 1')
        .get()?.balance_sheets, 7);
    assert.throws(() => f.sql.exec(`INSERT INTO v2_sleeve_inventory_transactions
        (product_id, transaction_type, transaction_date, quantity_sheets) VALUES (1, 'GIFT', '2026-11-26', -1)`),
    /CHECK constraint failed/);
    assert.throws(() => f.sql.exec('UPDATE v2_sleeve_inventory_transactions SET quantity_sheets = 8'),
        /SLEEVE_TRANSACTION_IMMUTABLE/);
    assert.throws(() => f.sql.exec('DELETE FROM v2_sleeve_inventory_transactions'), /SLEEVE_TRANSACTION_IMMUTABLE/);
    assert.throws(() => f.sql.exec('UPDATE v2_sleeve_products SET sheets_per_pack = 50'), /SLEEVE_PRODUCT_PACK_LOCKED/);
});
