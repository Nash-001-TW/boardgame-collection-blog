import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { writeCollectionCopy } from '../src/lib/collection-copies.ts';
import { CollectionV2Writer } from '../src/lib/collection-v2-management.ts';
import { writePhysicalComponent } from '../src/lib/physical-component-management.ts';
import { writeCopyCondition, writePurchase } from '../src/lib/purchase-admin.ts';
import {
    commitSharedQuantity, createQuantityOperationId, quantitySha256, type QuantityEdit,
} from '../src/lib/shared-quantity-commit.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const migrations = readdirSync('migrations').filter(file => /^\d{4}_.*\.sql$/.test(file)
    && Number(file.slice(0, 4)) <= 23).sort();
assert.deepEqual(migrations.map(file => Number(file.slice(0, 4))), Array.from({ length: 23 }, (_, i) => i + 1));
const migrationSql = migrations.map(file => readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
const actor = 'synthetic-admin';
const secret = 'synthetic examination signing key';
const copies = (insert: string, select: string, size: number) =>
    `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<${size})
     INSERT INTO ${insert} SELECT ${select} FROM ids`;

function database(t: TestContext, seed: string, candidate = false) {
    const sql = new DatabaseSync(':memory:');
    t.after(() => sql.close());
    sql.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=OFF');
    for (const migration of migrationSql.slice(0, 22)) sql.exec(migration);
    sql.exec(seed);
    if (candidate) sql.exec(migrationSql[22]);
    return sql;
}

const bulkSeed = [
    copies('v2_collection_items(id,display_name)', "n,'Collection '||n", 1000),
    copies('v2_owned_copies(id,collection_item_id)', 'n,(n-1)/3+1', 3000),
    copies('v2_component_definitions(id,collection_item_id,component_name,expected_quantity)', "n,(n-1)/10+1,'Cards',20", 10000),
    copies('v2_copy_components(id,owned_copy_id,component_definition_id,actual_quantity)', 'n,((n-1)/30)*3+(n-1)%3+1,(n-1)/3+1,19', 30000),
    copies('v2_copy_condition_tags(id,owned_copy_id,condition_code)', "n,n,'missing_parts'", 3000),
].join(';');

const writes = {
    collectionInsert: "INSERT INTO v2_collection_items(id,display_name) VALUES(?+1000,'New')",
    copyEdit: "UPDATE v2_owned_copies SET edition='Modified' WHERE id=?",
    definitionInsert: "INSERT INTO v2_component_definitions(collection_item_id,component_name) VALUES(?,'New cards')",
    definitionRename: "UPDATE v2_component_definitions SET component_name='Renamed',physical_revision=physical_revision+1 WHERE id=?",
    countUpsert: `INSERT INTO v2_copy_components(owned_copy_id,component_definition_id,actual_quantity)
        SELECT owned_copy_id,component_definition_id,20 FROM v2_copy_components WHERE id=?
        ON CONFLICT(owned_copy_id,component_definition_id) DO UPDATE SET
        actual_quantity=excluded.actual_quantity,count_revision=count_revision+1`,
    archive: `INSERT INTO v2_collection_management(collection_item_id,revision,archived_at)
        VALUES(?,1,'2026-11-23') ON CONFLICT(collection_item_id) DO UPDATE SET
        revision=excluded.revision,archived_at=excluded.archived_at`,
    legacyMapInsert: `INSERT INTO v2_legacy_id_map(legacy_table,legacy_id,target_table,target_id)
        SELECT 'collection_components',CAST(id AS TEXT),'v2_component_definitions',id FROM v2_component_definitions WHERE id=?`,
};

function summarize(samples: number[]) {
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    };
}

test('seven paired single-statement write measurements', t => {
    const baseline = database(t, bulkSeed);
    const candidate = database(t, bulkSeed, true);
    const counts = {
        v2_collection_items: 1000, v2_owned_copies: 3000, v2_component_definitions: 10000,
        v2_copy_components: 30000, v2_copy_condition_tags: 3000,
    };
    for (const sql of [baseline, candidate]) {
        for (const [table, expected] of Object.entries(counts)) {
            assert.equal(sql.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, expected);
        }
        assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    }
    for (const [operation, query] of Object.entries(writes)) {
        const statements = [baseline.prepare(query), candidate.prepare(query)];
        const samples: [number[], number[]] = [[], []];
        // Alternate ordering and exclude 20 distinct warm-up writes from each side.
        for (let i = 1; i <= 220; i++) {
            for (const side of [i % 2, 1 - i % 2]) {
                const start = performance.now();
                const result = statements[side].run(i);
                const elapsed = performance.now() - start;
                assert.equal(result.changes, 1, operation);
                if (i > 20) samples[side].push(elapsed);
            }
        }
        const [before, after] = samples.map(summarize);
        t.diagnostic(JSON.stringify({
            operation, n: 200, before, after,
            medianRatio: after.median / before.median, p95Ratio: after.p95 / before.p95,
        }));
    }
});

const smallSeed = `
    INSERT INTO v2_collection_items(id,display_name) VALUES(1,'Synthetic'),(2,'Other');
    INSERT INTO v2_owned_copies(id,collection_item_id) VALUES(1,1),(2,2);
    INSERT INTO v2_sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES(1,630,880);
    INSERT INTO v2_sleeve_requirements(id,collection_item_id,size_id,quantity_sheets) VALUES(1,1,1,20);
`;
const createBody = { action: 'create', collectionId: 1, name: 'Cards', type: 'card', unit: 'card', expected: 20, confirmed: true };
const physical = (sql: DatabaseSync, key: string, body: Record<string, unknown>) =>
    writePhysicalComponent(sqliteD1(sql), secret, actor, key, body);

async function quantityFixture(sql: DatabaseSync) {
    const created = await physical(sql, 'review-create', createBody);
    assert.ok('id' in created);
    const edit: QuantityEdit = {
        definitionId: created.id, beforeRevision: 1, beforeQuantity: 20, afterQuantity: 19,
        name: 'Cards', type: 'card', unit: 'card', reason: 'Synthetic correction',
    };
    const sourceSignature = String(sql.prepare('SELECT signature FROM v2_physical_component_sources').get()?.signature);
    const generation = String(sql.prepare('SELECT generation FROM d1_quantity_collection_generation WHERE collection_id=1').get()?.generation);
    const evidence = String(sql.prepare(`
        SELECT json_object('version',1,'rule','expected-minus-checked-v1',
            'oldExpected',20,'newExpected',19,'items',json(evidence_items)) AS value
        FROM d1_quantity_admission WHERE id=?
    `).get(edit.definitionId)?.value);
    const baseline = {
        databaseEpoch: 'synthetic-review', collectionId: 1, recordScope: 'production' as const,
        evidenceVersion: 1 as const, generation, sourceSignature, evidenceDigest: await quantitySha256(evidence),
    };
    return { edit, evidence, baseline, id: await createQuantityOperationId(actor, edit, baseline) };
}

test('admission read with 200 copies and one successful service commit', async t => {
    const sql = database(t, smallSeed + copies('v2_owned_copies(id,collection_item_id)', 'n+2,1', 199), true);
    const { edit, baseline, id } = await quantityFixture(sql);
    const admission = sql.prepare('SELECT * FROM d1_quantity_admission WHERE id=?');
    const samples = Array.from({ length: 200 }, () => {
        const start = performance.now();
        const row = admission.get(edit.definitionId);
        const elapsed = performance.now() - start;
        assert.equal(JSON.parse(String(row?.evidence_items)).length, 200);
        return elapsed;
    });
    const start = performance.now();
    const result = await commitSharedQuantity(sqliteD1(sql), actor, id, edit, baseline, async () => true);
    const elapsed = performance.now() - start;
    assert.equal(result.outcome, 'COMMITTED');
    assert.equal(sql.prepare('SELECT expected_quantity FROM v2_component_definitions WHERE id=?').get(edit.definitionId)?.expected_quantity, 19);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM d1_quantity_history').get()?.n, 1);
    t.diagnostic(JSON.stringify({ admission200Copies: summarize(samples), n: samples.length, commitMs: elapsed }));
});

test('each distinct 0023 RAISE message is exercised', async t => {
    const sql = database(t, smallSeed, true);
    const { edit, baseline, evidence, id } = await quantityFixture(sql);
    const definition = edit.definitionId;
    const exe = (stmt: string) => sql.exec(stmt);
    const cases: [string, string][] = [
        ['D1_EPOCH_IMMUTABLE', 'UPDATE d1_quantity_epoch SET epoch=epoch'],
        ['D1_EPOCH_IMMUTABLE', 'DELETE FROM d1_quantity_epoch'],
        ['D1_EPOCH_IMMUTABLE', 'INSERT OR REPLACE INTO d1_quantity_epoch SELECT * FROM d1_quantity_epoch'],
        ['D1_INITIAL_MARKER_FORBIDDEN', "INSERT INTO v2_component_definitions(collection_item_id,component_name,last_quantity_operation_id) VALUES(1,'Bad','marker')"],
        ['D1_REVISION_REGRESSION', `UPDATE v2_component_definitions SET physical_revision=0 WHERE id=${definition}`],
        ['D1_MARKER_WITHOUT_CHANGE', `UPDATE v2_component_definitions SET last_quantity_operation_id='marker' WHERE id=${definition}`],
        ['D1_CURRENT_OPERATION_REQUIRED', `UPDATE v2_component_definitions SET expected_quantity=19 WHERE id=${definition}`],
        ['D1_GENERATION_IDENTITY', 'INSERT INTO d1_quantity_collection_generation VALUES(999,1)'],
        ['D1_GENERATION_IDENTITY', 'DELETE FROM d1_quantity_collection_generation WHERE collection_id=2'],
        ['D1_GENERATION_IDENTITY', 'UPDATE v2_collection_items SET id=999 WHERE id=2'],
        ['D1_GENERATION_IDENTITY', "INSERT OR REPLACE INTO v2_collection_items(id,display_name) VALUES(2,'Replacement')"],
        ['D1_GENERATION_NOT_MONOTONIC', 'UPDATE d1_quantity_collection_generation SET generation=generation+2 WHERE collection_id=2'],
        ['D1_COPY_IDENTITY', 'INSERT OR REPLACE INTO v2_owned_copies(id,collection_item_id) VALUES(2,2)'],
        ['D1_DEFINITION_IDENTITY', `INSERT OR REPLACE INTO v2_component_definitions(id,collection_item_id,component_name) VALUES(${definition},1,'Replacement')`],
        ['D1_ARCHIVE_IMMUTABLE', 'UPDATE v2_collection_management SET archived_at=NULL WHERE collection_item_id=2'],
        ['D1_ARCHIVE_IMMUTABLE', 'DELETE FROM v2_collection_management WHERE collection_item_id=2'],
        ['D1_MANAGEMENT_IDENTITY', "INSERT INTO v2_collection_management(collection_item_id,revision,request_key) VALUES(1,1,'synthetic-archive')"],
        ['D1_MANAGEMENT_IDENTITY', "UPDATE v2_collection_management SET request_key='new' WHERE collection_item_id=2"],
        ['D1_COUNT_IDENTITY', `INSERT INTO v2_copy_components(owned_copy_id,component_definition_id) VALUES(2,${definition})`],
        ['D1_TAG_IDENTITY', "INSERT INTO v2_copy_condition_tags(id,owned_copy_id,condition_code) VALUES(1,2,'missing_parts')"],
        ['D1_RELATED_IDENTITY', 'UPDATE v2_owned_copies SET id=999 WHERE id=2'],
        ['D1_RELATED_IDENTITY', `UPDATE v2_component_definitions SET id=999 WHERE id=${definition}`],
        ['D1_RELATED_IDENTITY', 'UPDATE v2_copy_components SET id=999 WHERE id=1'],
        ['D1_RELATED_IDENTITY', 'UPDATE v2_copy_condition_tags SET id=999 WHERE id=1'],
        ['D1_LEGACY_MAP_IDENTITY', "INSERT OR REPLACE INTO v2_legacy_id_map(id,legacy_table,legacy_id,target_table,target_id) VALUES(1,'collection_items','2','v2_collection_items',2)"],
        ['D1_LEGACY_MAP_IDENTITY', 'UPDATE v2_legacy_id_map SET target_id=2 WHERE id=1'],
    ];
    exe(`INSERT INTO v2_collection_management(collection_item_id,revision,request_key,archived_at)
            VALUES(2,1,'synthetic-archive','2026-11-23');
         INSERT INTO v2_copy_condition_tags(id,owned_copy_id,condition_code) VALUES(1,2,'sleeved');
         INSERT INTO v2_legacy_id_map(id,legacy_table,legacy_id,target_table,target_id)
            VALUES(1,'collection_items','1','v2_collection_items',1);
         INSERT INTO v2_copy_components(id,owned_copy_id,component_definition_id) VALUES(1,1,${definition})`);
    const seen = new Set<string>();
    const expect = (message: string, operation: () => unknown, label: string) => {
        assert.throws(operation, { message }, label);
        seen.add(message);
    };
    for (const [message, statement] of cases) expect(message, () => exe(statement), statement);

    const receipt = sql.prepare(`INSERT INTO d1_quantity_changes(operation_id,actor,digest,definition_id,collection_id,
        record_scope,source_signature,before_revision,before_quantity,after_quantity,name,component_type,unit,reason,
        evidence_json,before_generation,after_revision)
        VALUES(?,?,?,?,1,'production',?,1,20,19,'Cards','card','card','Synthetic correction',?,CAST(? AS INTEGER),2)`);
    // Refresh evidence after the setup count changed collection 1.
    const freshEvidence = String(sql.prepare(`SELECT json_object('version',1,'rule','expected-minus-checked-v1',
        'oldExpected',20,'newExpected',19,'items',json(evidence_items)) AS value FROM d1_quantity_admission WHERE id=?`)
        .get(definition)?.value);
    const generation = String(sql.prepare('SELECT generation FROM d1_quantity_collection_generation WHERE collection_id=1').get()?.generation);
    const insert = (snapshot = freshEvidence, version = generation) =>
        receipt.run(id, actor, id.slice(36), definition, baseline.sourceSignature, snapshot, version);
    expect('D1_QUANTITY_STATE_CHANGED', () => insert(evidence, baseline.generation), 'stale receipt');

    exe('CREATE TRIGGER review_ignore_update BEFORE UPDATE ON v2_component_definitions BEGIN SELECT RAISE(IGNORE); END');
    expect('D1_EXPECTED_ONE_DEFINITION_UPDATE', insert, 'zero-row update fault injection');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM d1_quantity_history').get()?.n, 0);
    exe('DROP TRIGGER review_ignore_update');
    insert();
    expect('D1_HISTORY_EXISTS', insert, 'duplicate receipt');
    expect('D1_HISTORY_IMMUTABLE', () => exe('UPDATE d1_quantity_changes SET reason=reason'), 'update receipt');
    expect('D1_HISTORY_IMMUTABLE', () => exe('DELETE FROM d1_quantity_changes'), 'delete receipt');

    exe('DROP TRIGGER d1_generation_no_delete; DELETE FROM d1_quantity_collection_generation WHERE collection_id=2');
    expect('D1_GENERATION_MISSING', () => exe("UPDATE v2_owned_copies SET edition='Invalid' WHERE id=2"), 'missing generation fault injection');
    const declared = new Set(Array.from(migrationSql[22].matchAll(/RAISE\(ABORT, '(D1_[A-Z_]+)'\)/g), match => match[1]));
    assert.deepEqual(seen, declared);
});

test('R06 and v2 service results and persisted business fields agree with 0022', async t => {
    async function exercise(sql: DatabaseSync) {
        const db = sqliteD1(sql);
        const writer = new CollectionV2Writer(db);
        const context = { actor, scope: 'production' as const };
        const created = await physical(sql, 'review-create', createBody);
        assert.ok('id' in created);
        const definitionId = created.id;
        const rename = { action: 'edit', definitionId, definitionRevision: 1, name: 'Renamed',
            type: 'card', unit: 'card' };
        const count = { action: 'count', definitionId, definitionRevision: 2, copyId: 1, revision: 0, actual: 18 };
        const results = [
            created,
            await physical(sql, 'review-create', createBody),
            await physical(sql, 'review-rename', rename),
            await physical(sql, 'review-count', count),
            await physical(sql, 'review-count-update', { ...count, revision: 1, actual: 19 }),
            await physical(sql, 'review-assign', { action: 'assign', definitionId, definitionRevision: 2, requirementId: 1, revision: 0 }),
        ];
        await assert.rejects(physical(sql, 'review-change', { ...rename, definitionRevision: 2,
            expected: 21, previousExpected: 20 }), { status: 409, code: 'D1_QUANTITY_PREVIEW_REQUIRED' });
        const copy = await writeCollectionCopy(db, 1, 'production', actor, 'review-copy-create', { expectedRevision: 0, label: null, language: null, edition: 'New' }, false);
        const copyEdit = await writeCollectionCopy(db, 1, 'production', actor, 'review-copy-edit', {
            expectedRevision: 1, copyId: copy.copyId, label: null, language: null, edition: 'Updated',
        }, true);
        const condition = await writeCopyCondition(db, 1, 'production', actor, 'review-condition', {
            action: 'condition', copyId: copy.copyId, revision: 0, seal: 'unsealed', inspection: 'unchecked',
            trade: 'unknown', date: '', details: '', tags: ['sleeved'],
        });
        await writer.patchFields(1, { displayName: 'Updated collection' }, { ...context, revision: 2 });
        sql.exec(`BEGIN;
            INSERT INTO v2_games(id,primary_name,game_type,catalog_source) VALUES(1,'Synthetic title','base','manual');
            INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES(1,'synthetic-game','synthetic-hash');
            INSERT INTO notbgg_games(seq,game_id,name,type) VALUES(1,1,'Synthetic title','boardgame');
            INSERT INTO notbgg_game_revisions(seq,revision,snapshot_json,actor) VALUES(1,1,'{}','synthetic-admin');
            COMMIT`);
        const ref = { source: 'notbgg' as const, notBggId: 'NotBGG:000001' };
        const data = { displayName: 'Managed collection', acquisitionStatus: 'owned', edition: 'Initial', priceMinor: 80 };
        const createContext = { ...context, idempotencyKey: 'review-collection', createCopy: true };
        const collectionRef = { ...ref, notBggId: (await import('../src/lib/game-identity.ts')).formatNotBggId(1) };
        const collection = await writer.create(collectionRef, data, createContext);
        const collectionReplay = await writer.create(collectionRef, data, createContext);
        await writer.update(collection.collectionId, { ...data, edition: 'Revised', priceMinor: 90 },
            { ...context, expectedRevision: 1 });
        const order = {
            id: 0, revision: 0, date: '2026-11-23', merchant: 'Synthetic merchant', reference: '', currency: 'TWD',
            shipping: 0, tax: 0, fee: 0, discount: 0, refunded: 0, status: 'paid', notes: '', method: 'direct',
            lines: [{ collectionId: 1, description: 'Synthetic order', quantity: 1, price: 100, discount: 0, allocated: 100 }],
        };
        const purchase = await writePurchase(db, actor, 'review-purchase', order);
        const purchaseEdit = await writePurchase(db, actor, 'review-purchase-edit', { ...order, id: purchase.id, revision: 1, notes: 'Updated order' });
        await writer.update(1, undefined, { ...context, expectedRevision: 3 }, true);
        await assert.rejects(writer.update(1, undefined, { ...context, expectedRevision: 4 }, true), { code: 'ARCHIVED' });

        const projection = [
            'SELECT component_name,expected_quantity,physical_revision FROM v2_component_definitions',
            'SELECT actual_quantity,count_revision FROM v2_copy_components',
            'SELECT component_definition_id,quantity_sheets FROM v2_sleeve_requirements',
            'SELECT edition,seal_status,condition_revision FROM v2_owned_copies ORDER BY id',
            'SELECT condition_code FROM v2_copy_condition_tags',
            'SELECT display_name FROM v2_collection_items ORDER BY id',
            'SELECT revision,archived_at IS NOT NULL AS archived FROM v2_collection_management ORDER BY collection_item_id',
            'SELECT revision,operation FROM v2_collection_events ORDER BY collection_item_id,revision',
            'SELECT notes,admin_revision,item_subtotal_minor FROM v2_purchase_orders ORDER BY id',
            'SELECT allocated_minor FROM v2_purchase_allocations ORDER BY id',
        ].map(query => sql.prepare(query).all());
        assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
        assert.equal(projection[0][0]?.expected_quantity, 20);
        assert.equal(projection[1][0]?.actual_quantity, 19);
        assert.equal(projection[2][0]?.component_definition_id, definitionId);
        assert.equal(projection[6][0]?.archived, 1);
        if (sql.prepare("SELECT name FROM sqlite_schema WHERE name='d1_quantity_history'").get()) {
            assert.equal(sql.prepare('SELECT count(*) AS n FROM d1_quantity_history').get()?.n, 0);
        }
        return { results, copy, copyEdit, condition, collection, collectionReplay, purchase, purchaseEdit, projection };
    }
    assert.deepEqual(await exercise(database(t, smallSeed)), await exercise(database(t, smallSeed, true)));
});

test('0023 admission rejects the review-scale classification universe without a partial write', async t => {
    const sql = database(t, smallSeed, true);
    const { edit, baseline, id } = await quantityFixture(sql);
    // Add unrelated collections and definitions. The target generation and snapshot stay current.
    sql.exec(copies('v2_collection_items(id,display_name)', "n+2,'Unrelated'", 998));
    sql.exec(copies('v2_component_definitions(collection_item_id,component_name)', "2,'Unrelated'", 9999));
    const admission = sql.prepare('SELECT classification_rows FROM d1_quantity_admission WHERE id=?').get(edit.definitionId);
    assert.equal(admission?.classification_rows, 11000);
    const result = await commitSharedQuantity(sqliteD1(sql), actor, id, edit, baseline, async () => true);
    assert.equal(result.outcome, 'NOT_COMMITTED');
    assert.ok('code' in result);
    assert.equal(result.code, 'EVIDENCE_UNAVAILABLE');
    assert.equal(sql.prepare('SELECT count(*) AS n FROM d1_quantity_history').get()?.n, 0);
    assert.equal(sql.prepare('SELECT expected_quantity FROM v2_component_definitions WHERE id=?')
        .get(edit.definitionId)?.expected_quantity, 20);
    t.diagnostic(JSON.stringify({ classificationRows: admission.classification_rows, outcome: result.outcome }));
});

test('all missing-generation RAISE locations abort with their parents present where required', async t => {
    const sql = database(t, smallSeed, true);
    await quantityFixture(sql);
    sql.exec(`
        INSERT INTO v2_collection_items(id,display_name) VALUES(3,'Empty');
        INSERT INTO v2_collection_management(collection_item_id,revision) VALUES(1,1);
        INSERT INTO v2_component_definitions(id,collection_item_id,component_name,physical_creation_token,physical_revision)
            VALUES(2,1,'Second', '${'b'.repeat(64)}',1),(3,1,'Unclaimed',NULL,0);
        INSERT INTO v2_copy_components(id,owned_copy_id,component_definition_id) VALUES(1,1,1);
        INSERT INTO v2_copy_condition_tags(id,owned_copy_id,condition_code) VALUES(1,1,'missing_parts');
        DROP TRIGGER d1_generation_no_delete;
        DELETE FROM d1_quantity_collection_generation WHERE collection_id IN (1,2,3);
        -- Fault injection only. The older immutable source guards take precedence in an intact database.
        DROP TRIGGER v2_physical_source_no_update;
        DROP TRIGGER v2_physical_source_no_delete;
    `);
    const statements = {
        v2_collection_items: {
            update: "UPDATE v2_collection_items SET display_name='Edited' WHERE id=1",
            delete: 'DELETE FROM v2_collection_items WHERE id=3',
        },
        v2_collection_management: {
            insert: 'INSERT INTO v2_collection_management(collection_item_id,revision) VALUES(2,1)',
            update: 'UPDATE v2_collection_management SET revision=2 WHERE collection_item_id=1',
            delete: 'DELETE FROM v2_collection_management WHERE collection_item_id=1',
        },
        v2_owned_copies: {
            insert: 'INSERT INTO v2_owned_copies(collection_item_id) VALUES(1)',
            update: "UPDATE v2_owned_copies SET edition='Edited' WHERE id=1",
            delete: 'DELETE FROM v2_owned_copies WHERE id=2',
        },
        v2_component_definitions: {
            insert: "INSERT INTO v2_component_definitions(collection_item_id,component_name) VALUES(1,'New')",
            update: "UPDATE v2_component_definitions SET component_name='Edited' WHERE id=1",
            delete: 'DELETE FROM v2_component_definitions WHERE id=3',
        },
        v2_physical_component_sources: {
            insert: `INSERT INTO v2_physical_component_sources(definition_id,collection_item_id,record_scope,
                creation_token,actor,request_digest,signature)
                SELECT 2,1,'production','${'b'.repeat(64)}',actor,request_digest,signature
                FROM v2_physical_component_sources WHERE definition_id=1`,
            update: 'UPDATE v2_physical_component_sources SET actor=actor WHERE definition_id=1',
            delete: 'DELETE FROM v2_physical_component_sources WHERE definition_id=1',
        },
        v2_copy_components: {
            insert: 'INSERT INTO v2_copy_components(owned_copy_id,component_definition_id) VALUES(1,2)',
            update: 'UPDATE v2_copy_components SET actual_quantity=1 WHERE id=1',
            delete: 'DELETE FROM v2_copy_components WHERE id=1',
        },
        v2_copy_condition_tags: {
            insert: "INSERT INTO v2_copy_condition_tags(owned_copy_id,condition_code) VALUES(1,'sleeved')",
            update: 'UPDATE v2_copy_condition_tags SET notes=notes WHERE id=1',
            delete: 'DELETE FROM v2_copy_condition_tags WHERE id=1',
        },
    };
    let locations = 0;
    for (const [table, operations] of Object.entries(statements)) {
        for (const [operation, statement] of Object.entries(operations)) {
            assert.throws(() => sql.exec(statement), { message: 'D1_GENERATION_MISSING' }, table + ' ' + operation);
            locations++;
        }
    }
    assert.equal(locations, Array.from(migrationSql[22].matchAll(/RAISE\(ABORT, 'D1_GENERATION_MISSING'\)/g)).length);
});
