import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { isolatedNotBggD1, migrateIsolatedD1, migrationStatements } from './helpers/notbgg-local-d1';

const ledger = 'v2_sleeve_inventory_transactions';
const migration = readFileSync('migrations/0025_sleeve_gift_and_ledger_locks.sql', 'utf8');

const seed = `
        INSERT INTO v2_collection_items(id, display_name) VALUES(1,'Linked'),(2,'Legacy'),(3,'Free');
        INSERT INTO v2_owned_copies(id, collection_item_id, copy_label) VALUES(1,1,'A'),(2,2,'B');
        INSERT INTO v2_sleeve_sizes(id, width_tenth_mm, height_tenth_mm) VALUES(101,631,881),(102,451,681);
        INSERT INTO v2_sleeve_products(id,size_id,product_name,sheets_per_pack)
        VALUES(1,101,'Pack',100),(2,101,'Unused',100);
        INSERT INTO v2_component_definitions(id,collection_item_id,component_name) VALUES(1,1,'Cards');
        INSERT INTO v2_copy_components(id,owned_copy_id,component_definition_id) VALUES(1,1,1);
        INSERT INTO v2_sleeve_requirements(id,collection_item_id,component_definition_id,size_id,quantity_sheets)
        VALUES(1,1,1,101,30),(2,2,NULL,101,30),(3,3,NULL,101,30);
        INSERT INTO ${ledger}(id,source_key,product_id,transaction_type,transaction_date,quantity_sheets,pack_count,
          sheets_per_pack_snapshot,collection_item_id,owned_copy_id)
        VALUES(1,'opening',1,'OPENING_BALANCE','2026-11-25',50,NULL,NULL,NULL,NULL),
              (2,'purchase',1,'PURCHASE','2026-11-25',100,1,100,NULL,NULL),
              (3,'use',1,'USE','2026-11-25',-10,NULL,NULL,1,1),
              (4,'return',1,'RETURN','2026-11-25',2,NULL,NULL,NULL,NULL),
              (5,'adjust',1,'ADJUST','2026-11-25',-3,NULL,NULL,NULL,NULL),
              (6,'discard',1,'DISCARD','2026-11-25',-5,NULL,NULL,NULL,NULL),
              (7,'legacy-use',1,'USE','2026-11-25',-2,NULL,NULL,2,2),
              (99,'deleted',1,'ADJUST','2026-11-25',1,NULL,NULL,NULL,NULL);
        DELETE FROM ${ledger} WHERE id=99;
        INSERT INTO v2_sleeve_applications(owned_copy_id,copy_component_id,inventory_transaction_id,quantity_sheets,requirement_id)
        VALUES(1,1,3,10,1),(2,NULL,7,2,NULL);
`;

function fixture(t: TestContext) {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const files = readdirSync('migrations').filter(file => /^00(?:0[1-9]|1[0-9]|2[0-3])_.*\.sql$/.test(file)).sort();
    assert.equal(files.length, 23);
    for (const file of files) db.exec(readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
    db.exec(seed);
    return db;
}

function apply(db: DatabaseSync) {
    db.exec('BEGIN');
    try {
        db.exec(migration);
        assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
        db.exec('COMMIT');
    } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
    }
}

function schema(db: DatabaseSync) {
    return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all()
        .map(row => ({ type: row.type, name: row.name, tbl_name: row.tbl_name, sql: typeof row.sql === 'string' ? row.sql.replace(/\r\n/g, '\n') : row.sql }));
}

function data(db: DatabaseSync) {
    return [ledger, 'v2_sleeve_products', 'v2_sleeve_requirements', 'v2_sleeve_applications'].map(
        table => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    );
}

function ledgerStructure(db: DatabaseSync) {
    return [
        db.prepare(`PRAGMA table_xinfo(${ledger})`).all(),
        db.prepare(`PRAGMA foreign_key_list(${ledger})`).all(),
        db.prepare(`PRAGMA index_list(${ledger})`).all().sort((a,b) => String(a.name).localeCompare(String(b.name)))
            .map(({seq: _seq, ...index}) => [index, db.prepare('SELECT * FROM pragma_index_xinfo(?)').all(index.name)]),
    ];
}

function insert(db: DatabaseSync, type: string, quantity: number, packs: number | null = null,
    snapshot: number | null = null, unitPrice: number | null = null, totalPrice: number | null = null) {
    return db.prepare(`INSERT INTO ${ledger}(product_id,transaction_type,transaction_date,quantity_sheets,
        pack_count,sheets_per_pack_snapshot,unit_pack_price_minor,total_price_minor)
        VALUES(1,?,'2026-11-25',?,?,?,?,?)`).run(type,quantity,packs,snapshot,unitPrice,totalPrice);
}

test('0025 preserves data, sequence and schema outside its declared changes', t => {
    const db = fixture(t);
    const rows = data(db);
    const objects = schema(db);
    const structure = ledgerStructure(db);
    const balance = db.prepare('SELECT * FROM v2_sleeve_inventory_balance ORDER BY product_id').all();
    apply(db);
    assert.deepEqual(data(db), rows);
    assert.deepEqual(ledgerStructure(db), structure);
    assert.deepEqual(db.prepare('SELECT * FROM v2_sleeve_inventory_balance ORDER BY product_id').all(), balance);
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    const after = schema(db);
    assert.deepEqual(objects.filter(row => !after.some(next => next.name === row.name)).map(row => row.name), [
        'v2_sleeve_application_protect_transaction_delete',
        'v2_sleeve_application_protect_transaction_update',
        'v2_sleeve_inventory_validate_delete',
        'v2_sleeve_inventory_validate_update',
    ]);
    assert.deepEqual(after.filter(row => !objects.some(old => old.name === row.name)).map(row => row.name), [
        'v2_sleeve_inventory_immutable_delete',
        'v2_sleeve_inventory_immutable_update',
        'v2_sleeve_product_pack_locked',
    ]);
    assert.deepEqual(after.filter(row => objects.some(old => old.name === row.name && old.sql !== row.sql)).map(row => row.name),
        ['v2_requirement_used_no_update', ledger]);
    assert.equal(insert(db, 'GIFT', 1).lastInsertRowid, 100);
});

test('0025 validates GIFT, transaction direction and existing insert guards', t => {
    const db = fixture(t);
    apply(db);
    insert(db, 'GIFT', 200, 2, 100, 0, 0);
    insert(db, 'GIFT', 7);
    assert.equal(db.prepare('SELECT balance_sheets FROM v2_sleeve_inventory_balance WHERE product_id=1').get()?.balance_sheets, 339);
    for (const params of [
        ['GIFT', 10, null, 5], ['GIFT', 10, 2, null], ['GIFT', 11, 2, 5],
        ['GIFT', 1, null, null, 1, 0], ['GIFT', 1, null, null, 0, 1],
        ['GIFT', -1], ['RETURN', -1], ['ADJUST', 0], ['PURCHASE', 10],
    ] as const) {
        const [type, quantity, packs, snapshot, unitPrice, totalPrice] = params;
        assert.throws(() => insert(db, type, quantity, packs, snapshot, unitPrice, totalPrice), /CHECK constraint failed/);
    }
    insert(db, 'RETURN', 1);
    insert(db, 'ADJUST', 1);
    insert(db, 'ADJUST', -1);
    assert.throws(() => insert(db, 'USE', -999), /would make stock negative/);
    assert.throws(() => db.exec(`INSERT INTO ${ledger}(product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,owned_copy_id)
        VALUES(1,'GIFT','2026-11-25',1,2,1)`), /copy belongs to another collection/);
    assert.throws(() => db.exec(`INSERT INTO ${ledger}(product_id,transaction_type,transaction_date,quantity_sheets)
        VALUES(99,'GIFT','2026-11-25',1)`), /FOREIGN KEY/);
    const giftId = insert(db, 'GIFT', 1).lastInsertRowid;
    assert.throws(() => db.exec(`INSERT INTO v2_sleeve_applications(owned_copy_id,inventory_transaction_id,quantity_sheets)
        VALUES(1,${giftId},1)`), /must match a USE transaction/);
    const use = db.prepare(`INSERT INTO ${ledger}(product_id,transaction_type,transaction_date,quantity_sheets,collection_item_id,owned_copy_id)
        VALUES(1,'USE','2026-11-25',-21,1,1)`).run().lastInsertRowid;
    assert.throws(() => db.exec(`INSERT INTO v2_sleeve_applications(owned_copy_id,copy_component_id,inventory_transaction_id,quantity_sheets,requirement_id)
        VALUES(1,1,${use},21,1)`), /SLEEVE_WORKFLOW_STATE_CHANGED/);
});

test('0025 locks transactions, product pack attributes and every non-note requirement field', t => {
    const db = fixture(t);
    apply(db);
    for (const id of [1, 3]) {
        assert.throws(() => db.exec(`UPDATE ${ledger} SET notes='changed' WHERE id=${id}`), /SLEEVE_TRANSACTION_IMMUTABLE/);
        assert.throws(() => db.exec(`DELETE FROM ${ledger} WHERE id=${id}`), /SLEEVE_TRANSACTION_IMMUTABLE/);
    }
    for (const change of ['size_id=102', 'sheets_per_pack=50']) {
        assert.throws(() => db.exec(`UPDATE v2_sleeve_products SET ${change} WHERE id=1`), /SLEEVE_PRODUCT_PACK_LOCKED/);
        db.exec(`UPDATE v2_sleeve_products SET ${change} WHERE id=2`);
    }
    db.exec("UPDATE v2_sleeve_products SET product_name='Renamed',is_active=0 WHERE id=1");
    const mutations = {
        id: '99', source_key: "'changed'", collection_item_id: '3', owned_copy_id: '1',
        component_definition_id: 'NULL', size_id: '102', quantity_sheets: '31', source_fragment: "'changed'",
        assignment_status: "'confirmed'", assignment_revision: '1', created_at: "'2026-01-01'",
    };
    const locked = db.prepare('PRAGMA table_xinfo(v2_sleeve_requirements)').all().map(row => row.name)
        .filter(name => name !== 'notes' && name !== 'updated_at');
    assert.deepEqual(Object.keys(mutations).sort(), locked.sort());
    for (const [column, value] of Object.entries(mutations)) {
        assert.throws(() => db.exec(`UPDATE v2_sleeve_requirements SET ${column}=${value},notes='changed' WHERE id=1`),
            /SLEEVE_REQUIREMENT_IN_USE/, column);
    }
    for (const id of [1, 2]) {
        db.exec(`UPDATE v2_sleeve_requirements SET notes='edited',updated_at='2026-11-25' WHERE id=${id}`);
        assert.throws(() => db.exec(`DELETE FROM v2_sleeve_requirements WHERE id=${id}`), /SLEEVE_REQUIREMENT_IN_USE/);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v2_sleeve_requirements WHERE notes='edited' AND updated_at='2026-11-25'").get()?.n, 2);
    assert.throws(() => db.exec('UPDATE v2_sleeve_requirements SET quantity_sheets=31 WHERE id=2'), /SLEEVE_REQUIREMENT_IN_USE/);
    db.exec('UPDATE v2_sleeve_requirements SET size_id=102,quantity_sheets=5 WHERE id=3; DELETE FROM v2_sleeve_requirements WHERE id=3');
});

test('0025 replay fails without changing schema, data or sequence', t => {
    const db = fixture(t);
    apply(db);
    insert(db, 'GIFT', 1);
    const objects = schema(db);
    const rows = data(db);
    const sequence = db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all();
    assert.throws(() => apply(db), /no such trigger: v2_sleeve_inventory_validate_update/);
    assert.deepEqual(schema(db), objects);
    assert.deepEqual(data(db), rows);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(), sequence);
});

test('0025 rolls back if legacy data violates the tightened RETURN check', t => {
    const db = fixture(t);
    insert(db, 'RETURN', -1);
    const objects = schema(db);
    const rows = data(db);
    assert.throws(() => apply(db), /CHECK constraint failed/);
    assert.deepEqual(schema(db), objects);
    assert.deepEqual(data(db), rows);
});

test('0025 rolls back on a real deferred foreign-key violation', t => {
    const db = fixture(t);
    const objects = schema(db);
    const rows = data(db);
    db.exec('BEGIN; PRAGMA defer_foreign_keys = true');
    db.exec(`INSERT INTO ${ledger}(product_id,transaction_type,transaction_date,quantity_sheets)
        VALUES(99,'ADJUST','2026-11-25',1)`);
    assert.throws(() => db.exec(migration), /CHECK constraint failed: violation_count = 0/);
    assert.equal(db.isTransaction, false);
    assert.deepEqual(schema(db), objects);
    assert.deepEqual(data(db), rows);
});

test('0025 runs as a single batch on isolated Miniflare D1', async t => {
    const { db, dispose } = await isolatedNotBggD1();
    t.after(dispose);
    await migrateIsolatedD1(db, '0023_shared_quantity_commit.sql');
    await db.batch(migrationStatements(seed).map(sql => db.prepare(sql)));
    const rows = async (sql: string) => (await db.prepare(sql).all()).results;
    const readData = () => Promise.all([ledger, 'v2_sleeve_products', 'v2_sleeve_requirements',
        'v2_sleeve_applications'].map(table => rows(`SELECT * FROM ${table} ORDER BY id`)));
    const readState = async () => ({
        data: await readData(),
        schema: await rows('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name'),
        sequence: await rows('SELECT * FROM sqlite_sequence ORDER BY name'),
    });
    const statements = migrationStatements(migration);
    const applyBatch = (prefix: string[] = []) => db.batch([...prefix, ...statements].map(sql => db.prepare(sql)));

    await t.test('foreign-key guard rolls back the whole batch', async () => {
        const before = await readState();
        // Preserve the real violation until the migration runs its own guard.
        // Workerd can mask a SQL error when OR ROLLBACK ends its batch transaction.
        await assert.rejects(applyBatch([
            'PRAGMA defer_foreign_keys = true;',
            `INSERT INTO ${ledger}(product_id,transaction_type,transaction_date,quantity_sheets)
                VALUES(99,'ADJUST','2026-11-25',1);`,
        ]), /CHECK constraint failed: violation_count = 0|^Error: internal error; reference = [a-z0-9]+$/);
        assert.deepEqual(await readState(), before);
    });

    const before = await readData();
    await applyBatch();
    assert.deepEqual(await readData(), before);
    assert.deepEqual(await rows('PRAGMA foreign_key_check'), []);

    const after = await readState();
    await assert.rejects(applyBatch(), /no such trigger: v2_sleeve_inventory_validate_update/);
    assert.deepEqual(await readState(), after);

    const run = (sql: string) => db.prepare(sql).run();
    const gift = (quantity: number) => run(`INSERT INTO ${ledger}
        (product_id,transaction_type,transaction_date,quantity_sheets)
        VALUES(1,'GIFT','2026-11-25',${quantity})`);
    assert.equal((await gift(1)).meta.last_row_id, 100);
    await assert.rejects(gift(-1), /CHECK constraint failed/);
    const returned = (quantity: number) => run(`INSERT INTO ${ledger}
        (product_id,transaction_type,transaction_date,quantity_sheets)
        VALUES(1,'RETURN','2026-11-25',${quantity})`);
    assert.equal((await returned(1)).meta.changes, 1);
    await assert.rejects(returned(-1), /CHECK constraint failed/);
    await assert.rejects(run(`UPDATE ${ledger} SET notes='edited' WHERE id=100`), /SLEEVE_TRANSACTION_IMMUTABLE/);
    await assert.rejects(run(`DELETE FROM ${ledger} WHERE id=100`), /SLEEVE_TRANSACTION_IMMUTABLE/);
    assert.equal((await run("UPDATE v2_sleeve_products SET product_name='Renamed' WHERE id=1")).meta.changes, 1);
    await assert.rejects(run('UPDATE v2_sleeve_products SET sheets_per_pack=50 WHERE id=1'),
        /SLEEVE_PRODUCT_PACK_LOCKED/);
    assert.equal((await run("UPDATE v2_sleeve_requirements SET notes='edited' WHERE id=1")).meta.changes, 1);
    await assert.rejects(run('UPDATE v2_sleeve_requirements SET quantity_sheets=31 WHERE id=1'),
        /SLEEVE_REQUIREMENT_IN_USE/);
});
