import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
    commitSharedQuantity, confirmedQuantityOperationStatus, createQuantityOperationId, quantityOperationStatus, quantitySha256, type QuantityEdit,
} from '../src/lib/shared-quantity-commit.ts';
import { writePhysicalComponent } from '../src/lib/physical-component-management.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const actor = 'synthetic-admin';
const signature = 'a'.repeat(64);

function scenario(expected: number | null = 103) {
    const sql = new DatabaseSync(':memory:');
    sql.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = OFF');
    for (const file of readdirSync('migrations').filter(file => /^\d{4}_.*\.sql$/.test(file)).sort()) {
        sql.exec(readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
    }
    sql.exec("INSERT INTO v2_collection_items(id, display_name) VALUES (1, 'Synthetic collection')");
    sql.prepare(`
        INSERT INTO v2_component_definitions(id, collection_item_id, component_name, component_type, quantity_unit,
            physical_creation_token, physical_revision, expected_quantity)
        VALUES (1, 1, 'Cards', 'card', 'card', '${'b'.repeat(64)}', 1, CAST(? AS INTEGER))
    `).run(expected);
    sql.exec(`
        INSERT INTO v2_physical_component_sources(definition_id, collection_item_id, record_scope,
            creation_token, actor, request_digest, signature)
        VALUES (1, 1, 'production', '${'b'.repeat(64)}', '${actor}', '${'c'.repeat(64)}', '${signature}');
        INSERT INTO v2_owned_copies(id, collection_item_id, edition) VALUES (1, 1, 'A');
        INSERT INTO v2_copy_components(owned_copy_id, component_definition_id, actual_quantity,
            inspection_status, last_checked_at, count_revision)
        VALUES (1, 1, 99, 'checked', '2026-01-01 01:02:03', 1);
    `);
    const db = sqliteD1(sql);
    const generation = () => String(sql.prepare(
        'SELECT CAST(generation AS TEXT) AS value FROM d1_quantity_collection_generation WHERE collection_id = 1',
    ).get()?.value);
    const history = () => sql.prepare('SELECT * FROM d1_quantity_history ORDER BY after_revision').all();
    const current = () => sql.prepare('SELECT expected_quantity, physical_revision FROM v2_component_definitions WHERE id=1').get();
    async function request(fields: Partial<QuantityEdit> = {}) {
        const edit: QuantityEdit = {
            definitionId: 1, beforeRevision: 1, beforeQuantity: 103, afterQuantity: 100,
            name: 'Cards', type: 'card', unit: 'card', reason: 'Synthetic quantity correction', ...fields,
        };
        const evidence = sql.prepare(`
            SELECT json_object('version', 1, 'rule', 'expected-minus-checked-v1',
                'oldExpected', CAST(? AS INTEGER), 'newExpected', CAST(? AS INTEGER), 'items', json(evidence_items)) AS envelope
            FROM d1_quantity_admission WHERE id=1
        `).get(edit.beforeQuantity, edit.afterQuantity);
        const baseline = { databaseEpoch: 'test-epoch', collectionId: 1, recordScope: 'production' as const,
            evidenceVersion: 1 as const, generation: generation(), sourceSignature: signature,
            evidenceDigest: await quantitySha256(String(evidence?.envelope)) };
        const id = await createQuantityOperationId(actor, edit, baseline);
        return { id, edit, baseline };
    }
    const commit = (r: Awaited<ReturnType<typeof request>>, binding = db) =>
        commitSharedQuantity(binding, actor, r.id, r.edit, r.baseline, async () => true);
    return { sql, db, generation, history, current, request, commit };
}

function loseWriteResponse(db: D1Database): D1Database {
    return { ...db, prepare(query: string) {
        const statement = db.prepare(query);
        if (!query.includes('INSERT INTO d1_quantity_changes')) return statement;
        return { bind(...args: unknown[]) {
            const bound = statement.bind(...args);
            return { async run() { await bound.run(); throw new Error('simulated lost response'); } };
        } } as D1PreparedStatement;
    } } as D1Database;
}

test('generation covers edition and seal ABA, repeat count, UPSERT and cascade delete/recreate', () => {
    const f = scenario();
    try {
        const statements = [
            "UPDATE v2_owned_copies SET edition='B' WHERE id=1",
            "UPDATE v2_owned_copies SET edition='A' WHERE id=1",
            "UPDATE v2_owned_copies SET seal_status='unsealed' WHERE id=1",
            "UPDATE v2_owned_copies SET seal_status='unknown' WHERE id=1",
            'UPDATE v2_copy_components SET count_revision=count_revision+1',
            'UPDATE v2_copy_components SET actual_quantity=98',
            'UPDATE v2_copy_components SET actual_quantity=99',
            `INSERT INTO v2_copy_components(owned_copy_id, component_definition_id, actual_quantity)
             VALUES(1,1,99) ON CONFLICT(owned_copy_id, component_definition_id)
             DO UPDATE SET actual_quantity=excluded.actual_quantity`,
            'DELETE FROM v2_owned_copies WHERE id=1',
            'INSERT INTO v2_owned_copies(id, collection_item_id) VALUES(1,1)',
        ];
        for (const statement of statements) {
            const before = BigInt(f.generation());
            f.sql.exec(statement);
            assert.ok(BigInt(f.generation()) > before, statement);
            if (statement.startsWith('DELETE')) assert.equal(f.sql.prepare('SELECT count(*) n FROM v2_copy_components').get()?.n, 0);
        }
        assert.throws(() => f.sql.exec('INSERT OR REPLACE INTO v2_owned_copies(id, collection_item_id) VALUES(1,1)'), /D1_COPY_IDENTITY/);
        assert.throws(() => f.sql.exec('INSERT OR REPLACE INTO d1_quantity_collection_generation VALUES(1,1)'), /D1_GENERATION_IDENTITY/);
        assert.throws(() => f.sql.exec('DELETE FROM d1_quantity_collection_generation'), /D1_GENERATION_IDENTITY/);
        assert.throws(() => f.sql.exec('UPDATE d1_quantity_collection_generation SET generation=1'), /D1_GENERATION_NOT_MONOTONIC/);
    } finally { f.sql.close(); }
});

test('generation reaches the exact signed integer limit and the next write rolls back', () => {
    const f = scenario();
    try {
        // Place the synthetic fixture close to the limit before restoring the real guard.
        const guard = f.sql.prepare("SELECT sql FROM sqlite_master WHERE name='d1_generation_update_guard'").get();
        f.sql.exec('DROP TRIGGER d1_generation_update_guard; UPDATE d1_quantity_collection_generation SET generation=9223372036854775806');
        f.sql.exec(String(guard?.sql));
        f.sql.exec("UPDATE v2_owned_copies SET edition='last' WHERE id=1");
        assert.equal(f.generation(), '9223372036854775807');
        assert.throws(() => f.sql.exec("UPDATE v2_owned_copies SET edition='overflow' WHERE id=1"), /D1_GENERATION_NOT_MONOTONIC/);
        assert.equal(f.sql.prepare('SELECT edition FROM v2_owned_copies WHERE id=1').get()?.edition, 'last');
    } finally { f.sql.close(); }
});

test('D1-10/12 same operation commits once under competing calls and replays after lost response', async () => {
    const f = scenario();
    try {
        const count = f.sql.prepare('SELECT * FROM v2_copy_components').get();
        const r = await f.request();
        assert.equal((await quantityOperationStatus(f.db, actor, r.id)).outcome, 'UNKNOWN');
        const results = await Promise.all([f.commit(r, loseWriteResponse(f.db)), f.commit(r)]);
        assert.ok(results.every(result => result.outcome === 'COMMITTED'));
        assert.equal(f.history().length, 1);
        assert.equal(f.current()?.expected_quantity, 100);
        assert.deepEqual(f.sql.prepare('SELECT * FROM v2_copy_components').get(), count);
        await assert.rejects(f.commit({ ...r, edit: { ...r.edit, afterQuantity: 0 } }), /IDEMPOTENCY_CONFLICT/);
        await assert.rejects(quantityOperationStatus(f.db, 'another-admin', r.id), /IDEMPOTENCY_CONFLICT/);
        assert.equal((await f.commit(r)).outcome, 'COMMITTED');
    } finally { f.sql.close(); }
});

test('D1-11 history, quantity and generation roll back together on abort or zero-row update', async t => {
    for (const statement of [
        "CREATE TRIGGER inject_failure BEFORE INSERT ON d1_quantity_changes BEGIN SELECT RAISE(ABORT, 'history'); END",
        "CREATE TRIGGER inject_failure AFTER UPDATE ON v2_component_definitions BEGIN SELECT RAISE(ABORT, 'definition'); END",
        'CREATE TRIGGER inject_failure BEFORE UPDATE ON v2_component_definitions BEGIN SELECT RAISE(IGNORE); END',
    ]) await t.test(statement, async () => {
        const f = scenario();
        try {
            const r = await f.request();
            const before = f.current();
            assert.throws(() => f.sql.exec('UPDATE v2_component_definitions SET expected_quantity=0'), /D1_CURRENT_OPERATION_REQUIRED/);
            f.sql.exec(statement);
            assert.equal((await f.commit(r)).outcome, 'UNKNOWN');
            assert.deepEqual(f.current(), before);
            assert.equal(f.generation(), r.baseline.generation);
            assert.equal(f.history().length, 0);
            f.sql.exec('DROP TRIGGER inject_failure');
            assert.equal((await f.commit(r)).outcome, 'COMMITTED');
            assert.throws(() => f.sql.exec('UPDATE d1_quantity_changes SET reason=reason'), /D1_HISTORY_IMMUTABLE/);
            assert.throws(() => f.sql.exec('INSERT OR REPLACE INTO d1_quantity_changes SELECT * FROM d1_quantity_changes'), /D1_HISTORY_EXISTS/);
            const back = await f.request({ beforeRevision: 2, beforeQuantity: 100, afterQuantity: 103 });
            assert.equal((await f.commit(back)).outcome, 'COMMITTED');
            assert.throws(() => f.sql.prepare(`
                UPDATE v2_component_definitions SET expected_quantity=100, physical_revision=4,
                    last_quantity_operation_id=? WHERE id=1
            `).run(r.id), /D1_CURRENT_OPERATION_REQUIRED/);
        } finally { f.sql.close(); }
    });
});

test('D1-13 success survives archive, while archive first makes the delayed original permanently rejectable', async t => {
    for (const commitFirst of [true, false]) await t.test(String(commitFirst), async () => {
        const f = scenario();
        try {
            const r = await f.request();
            if (commitFirst) assert.equal((await f.commit(r)).outcome, 'COMMITTED');
            f.sql.exec("INSERT INTO v2_collection_management(collection_item_id, archived_at) VALUES(1, '2026-11-20')");
            const result = await confirmedQuantityOperationStatus(f.db, actor, r.id, r.edit, r.baseline, async () => true);
            assert.equal(result.outcome, commitFirst ? 'COMMITTED' : 'PERMANENTLY_REJECTED');
            if (result.outcome === 'PERMANENTLY_REJECTED') assert.equal(result.code, 'COLLECTION_ARCHIVED');
            assert.equal((await f.commit(r)).outcome, result.outcome);
            assert.equal((await quantityOperationStatus(f.db, actor, r.id)).outcome, commitFirst ? 'COMMITTED' : 'UNKNOWN');
            assert.equal(f.history().length, Number(commitFirst));
            assert.throws(() => f.sql.exec('INSERT OR REPLACE INTO v2_collection_management(collection_item_id) VALUES(1)'), /D1_MANAGEMENT_IDENTITY/);
        } finally { f.sql.close(); }
    });
});

test('D1-13 a write after service preflight is caught by transactional generation admission', async () => {
    const f = scenario();
    try {
        const r = await f.request();
        const binding = { ...f.db, prepare(query: string) {
            if (query.includes('INSERT INTO d1_quantity_changes')) f.sql.exec(
                "UPDATE v2_owned_copies SET edition='B' WHERE id=1; UPDATE v2_owned_copies SET edition='A' WHERE id=1",
            );
            return f.db.prepare(query);
        } } as D1Database;
        assert.equal((await f.commit(r, binding)).outcome, 'PERMANENTLY_REJECTED');
        assert.equal((await f.commit(r)).outcome, 'PERMANENTLY_REJECTED');
        assert.equal(f.history().length, 0);
    } finally { f.sql.close(); }
});

test('D1-16 transitional evidence includes borrowed copies and retains unknown dates as null', async () => {
    const f = scenario();
    try {
        f.sql.exec("INSERT INTO v2_owned_copies(id,collection_item_id,inventory_status) VALUES (2,1,'loaned'), (3,1,'sold')");
        assert.equal((await f.commit(await f.request())).outcome, 'COMMITTED');
        const before = f.history()[0]?.evidence_json;
        const envelope = JSON.parse(String(before));
        assert.deepEqual(envelope.items.map((item: { copyId: number }) => item.copyId), [1, 2]);
        assert.equal(envelope.items[1].inventory, 'loaned');
        assert.equal(envelope.items[0].countDate, null);
        f.sql.exec('UPDATE v2_copy_components SET actual_quantity=100');
        assert.equal(f.history()[0]?.evidence_json, before);
    } finally { f.sql.close(); }
});

test('D1-16 capacity admits 200 evidence rows and leaves no writes at 201', async t => {
    for (const total of [200, 201]) await t.test(String(total), async () => {
        const f = scenario();
        try {
            const add = f.sql.prepare('INSERT INTO v2_owned_copies(collection_item_id) VALUES(1)');
            for (let i = 1; i < total; i++) add.run();
            assert.equal((await f.commit(await f.request())).outcome, total === 200 ? 'COMMITTED' : 'UNKNOWN');
            assert.equal(f.history().length, Number(total === 200));
        } finally { f.sql.close(); }
    });
});

test('D1-16 exact UTF-8 envelope limit and oversized fields leave no partial success', async t => {
    for (const bytes of [262144, 262145, 270000]) await t.test(String(bytes), async () => {
        const f = scenario();
        try {
            f.sql.exec("UPDATE v2_owned_copies SET edition='' WHERE id=1");
            const empty = f.sql.prepare(`
                SELECT length(CAST(json_object('version', 1, 'rule', 'expected-minus-checked-v1',
                    'oldExpected', 103, 'newExpected', 100, 'items', json(evidence_items)) AS BLOB)) AS bytes
                FROM d1_quantity_admission WHERE id=1
            `).get();
            f.sql.prepare('UPDATE v2_owned_copies SET edition=? WHERE id=1')
                .run('版' + 'x'.repeat(bytes - Number(empty?.bytes) - 3));
            assert.equal((await f.commit(await f.request())).outcome, bytes === 262144 ? 'COMMITTED' : 'UNKNOWN');
            assert.equal(f.history().length, Number(bytes === 262144));
            assert.equal(f.current()?.expected_quantity, bytes === 262144 ? 100 : 103);
        } finally { f.sql.close(); }
    });
});

test('unpreviewed edit and legacy retirement are closed while status remains read-only', async () => {
    const f = scenario();
    try {
        await assert.rejects(writePhysicalComponent(f.db, null, actor, 'legacy-operation', {
            action: 'edit', definitionId: 1, definitionRevision: 1, previousExpected: 103,
            expected: 0, name: 'Cards', type: 'card', unit: 'card', reason: 'Synthetic correction',
        }), /D1_QUANTITY_PREVIEW_REQUIRED/);
        await assert.rejects(writePhysicalComponent(f.db, null, actor, 'legacy-operation', {
            action: 'quantity-retire',
        }), /INVALID_COMPONENT_ACTION/);
        const status = await writePhysicalComponent(f.db, null, actor, 'legacy-operation', { action: 'quantity-status' });
        assert.equal('outcome' in status && status.outcome, 'UNKNOWN');
        assert.equal(f.history().length, 0);
        assert.equal(f.current()?.expected_quantity, 103);
    } finally { f.sql.close(); }
});

test('FIX-001 local SQLite commits integer and NULL evidence with a durable receipt', async t => {
    for (const [before, after] of [[103, 100], [null, 0], [0, null]] as const) {
        await t.test(String(before) + ' -> ' + String(after), async () => {
            const f = scenario(before);
            try {
                const r = await f.request({ beforeQuantity: before, afterQuantity: after });
                assert.equal((await f.commit(r)).outcome, 'COMMITTED');
                assert.deepEqual({ ...f.current() }, { expected_quantity: after, physical_revision: 2 });
                const rows = f.history();
                assert.equal(rows.length, 1);
                assert.equal(rows[0].operation_id, r.id);
                assert.equal(rows[0].before_quantity, before);
                assert.equal(rows[0].after_quantity, after);
                const evidence = JSON.parse(String(rows[0].evidence_json));
                assert.equal(evidence.oldExpected, before);
                assert.equal(evidence.newExpected, after);
                const receipt = await quantityOperationStatus(f.db, actor, r.id);
                assert.equal(receipt.outcome, 'COMMITTED');
                if (receipt.outcome !== 'COMMITTED') assert.fail('missing durable receipt');
                assert.equal(receipt.revision, 2);
                assert.equal(receipt.beforeQuantity, before);
                assert.equal(receipt.afterQuantity, after);
            } finally { f.sql.close(); }
        });
    }
});

test('FIX-001 local SQLite rejects invalid quantities before any database access', async t => {
    for (const invalid of [2.5, -1, NaN, Infinity]) {
        await t.test(String(invalid), async () => {
            const f = scenario();
            try {
                const r = await f.request();
                const before = f.current();
                const generation = f.generation();
                let prepares = 0;
                const binding = { ...f.db, prepare(query: string) {
                    prepares++;
                    return f.db.prepare(query);
                } } as D1Database;
                for (const field of ['beforeQuantity', 'afterQuantity'] as const) {
                    await assert.rejects(f.commit({ ...r, edit: { ...r.edit, [field]: invalid } }, binding),
                        /D1_INVALID_QUANTITY_EDIT/);
                }
                assert.equal(prepares, 0);
                assert.equal(f.history().length, 0);
                assert.deepEqual(f.current(), before);
                assert.equal(f.generation(), generation);
            } finally { f.sql.close(); }
        });
    }
});

test('FIX-001 local SQLite unexpected admission rejection leaves the original operation pending', async () => {
    const f = scenario();
    try {
        const r = await f.request();
        const before = f.current();
        f.sql.exec(`
            CREATE TRIGGER fix001_reject BEFORE INSERT ON d1_quantity_changes
            BEGIN SELECT RAISE(ABORT, 'D1_QUANTITY_STATE_CHANGED'); END
        `);
        let rejectedInsert = false;
        const binding = { ...f.db, prepare(query: string) {
            const statement = f.db.prepare(query);
            if (!query.includes('INSERT INTO d1_quantity_changes')) return statement;
            return { bind(...args: unknown[]) {
                const bound = statement.bind(...args);
                return { async run() {
                    try { return await bound.run(); }
                    catch (error) {
                        rejectedInsert = String(error).includes('D1_QUANTITY_STATE_CHANGED');
                        throw error;
                    }
                } };
            } } as D1PreparedStatement;
        } } as D1Database;
        assert.deepEqual(await f.commit(r, binding), { operationId: r.id, outcome: 'UNKNOWN' });
        assert.ok(rejectedInsert);
        assert.deepEqual(await confirmedQuantityOperationStatus(f.db, actor, r.id, r.edit, r.baseline, async () => true),
            { operationId: r.id, outcome: 'UNKNOWN' });
        assert.equal(f.history().length, 0);
        assert.deepEqual(f.current(), before);
        assert.equal(f.generation(), r.baseline.generation);
        f.sql.exec('DROP TRIGGER fix001_reject');
        assert.equal((await f.commit(r)).outcome, 'COMMITTED');
        assert.equal(f.history().length, 1);
    } finally { f.sql.close(); }
});

test('FIX-002 ordinary component edits work with 0023 and preserve quantity and source guards', async () => {
    const f = scenario();
    try {
        const secret = 'synthetic-fix-002-signing-key-for-local-fixtures';
        assert.equal(f.sql.prepare("SELECT name FROM sqlite_master WHERE name='d1_quantity_requests'").get(), undefined);
        const created = await writePhysicalComponent(f.db, secret, actor, 'fix002-create', {
            action: 'create', collectionId: 1, name: 'Synthetic cards', type: 'card', unit: 'card',
            expected: 20, confirmed: true,
        });
        assert.ok('id' in created && typeof created.id === 'number');
        const definitionId = created.id;
        const readDefinition = () => f.sql.prepare(`
            SELECT component_name, component_type, quantity_unit, expected_quantity, physical_revision
            FROM v2_component_definitions WHERE id=?
        `).get(definitionId);
        const edit = {
            action: 'edit', definitionId, definitionRevision: 1,
            name: 'Renamed synthetic cards', type: 'card', unit: 'card',
        };
        const generation = BigInt(f.generation());
        const edited = await writePhysicalComponent(f.db, secret, actor, 'fix002-ordinary', edit);
        assert.ok('id' in edited && edited.id === definitionId);
        const current = readDefinition();
        assert.deepEqual({ ...current }, {
            component_name: edit.name, component_type: 'card', quantity_unit: 'card',
            expected_quantity: 20, physical_revision: 2,
        });
        assert.ok(BigInt(f.generation()) > generation);
        assert.equal(f.history().length, 0);

        const updatedGeneration = f.generation();
        await assert.rejects(writePhysicalComponent(f.db, secret, actor, null, edit), /COMPONENT_STATE_CHANGED/);
        await assert.rejects(writePhysicalComponent(f.db, secret + '-wrong', actor, null, {
            ...edit, definitionRevision: 2,
        }), /COMPONENT_INELIGIBLE/);
        await assert.rejects(writePhysicalComponent(f.db, secret, actor, null, {
            ...edit, definitionRevision: 2, previousExpected: 20, expected: 21, reason: 'Synthetic correction',
        }), /D1_QUANTITY_PREVIEW_REQUIRED/);
        await assert.rejects(writePhysicalComponent(f.db, secret, actor, null, {
            ...edit, definitionRevision: 2, expected: 21,
        }), /D1_PREVIOUS_QUANTITY_REQUIRED/);
        assert.deepEqual(readDefinition(), current);
        assert.equal(f.generation(), updatedGeneration);
        assert.equal(f.history().length, 0);
    } finally { f.sql.close(); }
});
