import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { changeComponentApplicability, readComponentApplicability } from '../src/lib/component-applicability.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const target = { collectionId: 1, copyId: 1, definitionId: 1 };
const actor = 'synthetic-admin';

function fixture(t: { after: (cleanup: () => void) => void }) {
    const sql = new DatabaseSync(':memory:');
    t.after(() => sql.close());
    sql.exec('PRAGMA foreign_keys = ON; PRAGMA recursive_triggers = OFF');
    for (const file of readdirSync('migrations').filter(file => /^00(?:0[1-9]|1[0-9]|2[0-4])_.*\.sql$/.test(file)).sort()) {
        sql.exec(readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
    }
    sql.exec(`
        INSERT INTO v2_collection_items(id, display_name, record_scope)
        VALUES (1, 'Synthetic', 'test'), (2, 'Other', 'test');
        INSERT INTO v2_owned_copies(id, collection_item_id, edition) VALUES (1, 1, 'A'), (2, 2, 'B');
        INSERT INTO v2_component_definitions(id, collection_item_id, component_name, component_type,
            quantity_unit, physical_creation_token, physical_revision, expected_quantity)
        VALUES (1, 1, 'Cards', 'card', 'card', printf('%064x', 1), 1, 20);
        INSERT INTO v2_physical_component_sources(definition_id, collection_item_id, record_scope,
            creation_token, actor, request_digest, signature)
        VALUES (1, 1, 'test', printf('%064x', 1), 'synthetic', printf('%064x', 2), printf('%064x', 3));
    `);
    const db = sqliteD1(sql);
    const mark = () => sql.exec('INSERT INTO v2_component_applicability_coverage VALUES (1)');
    const generation = () => String(sql.prepare(
        'SELECT CAST(generation AS TEXT) AS value FROM d1_quantity_collection_generation WHERE collection_id = 1',
    ).get()?.value);
    const events = () => sql.prepare('SELECT * FROM v2_component_applicability_events ORDER BY revision').all();
    const current = () => ({ ...target, status: 'applicable' as const, revision: 0, generation: generation() });
    const insert = (origin: 'initial' | 'change', copyId = 1, revision = 1, before = 0, after = 1) =>
        db.prepare(`INSERT INTO v2_component_applicability_events
            (collection_id, copy_id, definition_id, revision, before_not_applicable,
             after_not_applicable, actor, origin, before_generation)
            VALUES (1, ?, 1, ?, ?, ?, ?, ?, CAST(? AS INTEGER))`)
            .bind(copyId, revision, before, after, actor, origin, generation());
    return { sql, db, mark, generation, events, current, insert };
}

test('direct initial inserts on an existing copy or a just-created copy abort without side effects', async t => {
    const f = fixture(t);
    const generation = f.generation();
    await assert.rejects(f.insert('initial').run(), /APPLICABILITY_INITIAL_DISABLED/);
    assert.equal(f.generation(), generation);

    await assert.rejects(f.db.batch([
        f.db.prepare('INSERT INTO v2_owned_copies(id, collection_item_id) VALUES (3, 1)'),
        f.insert('initial', 3),
    ]), /APPLICABILITY_INITIAL_DISABLED/);
    assert.equal(f.sql.prepare('SELECT id FROM v2_owned_copies WHERE id=3').get(), undefined);
    assert.equal(f.events().length, 0);
    assert.equal(f.generation(), generation);
});

test('INSERT OR IGNORE cannot suppress initial admission failure', t => {
    const f = fixture(t);
    const generation = f.generation();
    assert.throws(() => f.sql.prepare(`
        INSERT OR IGNORE INTO v2_component_applicability_events
            (collection_id, copy_id, definition_id, revision, before_not_applicable,
             after_not_applicable, actor, origin, before_generation)
        VALUES (1, 1, 1, 1, 0, 1, ?, 'initial', CAST(? AS INTEGER))
    `).run(actor, generation), /APPLICABILITY_INITIAL_DISABLED/);
    assert.deepEqual(f.events(), []);
    assert.equal(f.generation(), generation);
});

test('a multi-row INSERT SELECT cannot leave partial initial history', t => {
    const f = fixture(t);
    f.sql.exec('INSERT INTO v2_owned_copies(id, collection_item_id) VALUES (3, 1)');
    const generation = f.generation();
    const copies = f.sql.prepare('SELECT id FROM v2_owned_copies WHERE collection_item_id=1 ORDER BY id').all();
    assert.deepEqual(copies.map(copy => copy.id), [1, 3]);
    assert.throws(() => f.sql.prepare(`
        INSERT INTO v2_component_applicability_events
            (collection_id, copy_id, definition_id, revision, before_not_applicable,
             after_not_applicable, actor, origin, before_generation)
        SELECT collection_item_id, id, 1, 1, 0, 1, ?, 'initial', CAST(? AS INTEGER)
        FROM v2_owned_copies WHERE collection_item_id=1 ORDER BY id
    `).run(actor, generation), /APPLICABILITY_INITIAL_DISABLED/);
    assert.deepEqual(f.events(), []);
    assert.equal(f.generation(), generation);
});

test('marker presence and read failure do not establish verified coverage', async t => {
    const f = fixture(t);
    const unavailable = { ...target, status: 'unknown', reason: 'SOURCE_UNAVAILABLE' };
    assert.deepEqual(await readComponentApplicability(f.db, target), unavailable);
    f.mark();
    assert.deepEqual(await readComponentApplicability(f.db, target), unavailable);
    const generation = f.generation();
    await assert.rejects(changeComponentApplicability(f.db, {
        current: f.current(), next: 'not_applicable', actor,
    }), /APPLICABILITY_SOURCE_UNAVAILABLE/);
    assert.equal(f.generation(), generation);
    assert.equal(f.events().length, 0);

    const unavailableDb = { prepare() { throw new Error('synthetic read failure'); } } as unknown as D1Database;
    assert.deepEqual(await readComponentApplicability(unavailableDb, target), unavailable);
    assert.deepEqual(await readComponentApplicability(f.db, { ...target, copyId: 2 }),
        { ...target, copyId: 2, status: 'unknown', reason: 'TARGET_INVALID' });
});

test('same-collection, sequential revision and old state guards reject direct change inserts', async t => {
    const f = fixture(t);
    const generation = f.generation();
    await assert.rejects(f.insert('change', 2).run(), /APPLICABILITY_TARGET_INVALID/);
    await assert.rejects(f.insert('change', 1, 2).run(), /APPLICABILITY_STATE_CHANGED/);
    await assert.rejects(f.insert('change', 1, 1, 1, 0).run(), /APPLICABILITY_STATE_CHANGED/);
    assert.equal(f.events().length, 0);
    assert.equal(f.generation(), generation);
});

test('single change rejects a collection of requests before accessing the binding', async () => {
    const noAccess = { prepare() { assert.fail('binding should not be accessed'); } } as unknown as D1Database;
    await assert.rejects(changeComponentApplicability(noAccess,
        [] as unknown as Parameters<typeof changeComponentApplicability>[1]), /APPLICABILITY_CHANGE_INVALID/);
});

test('marker withdrawal and restoration advance generation without granting write authority', async t => {
    const f = fixture(t);
    f.mark();
    const previous = f.current();
    f.sql.exec('DELETE FROM v2_component_applicability_coverage WHERE collection_id=1');
    f.mark();
    assert.equal(BigInt(f.generation()), BigInt(previous.generation) + 2n);
    await assert.rejects(changeComponentApplicability(f.db, {
        current: previous, next: 'not_applicable', actor,
    }), /APPLICABILITY_GENERATION_CHANGED/);
    assert.equal(f.events().length, 0);
});

test('existing history rejects UPDATE, DELETE, REPLACE and parent deletion', async t => {
    const f = fixture(t);
    // Import a synthetic historical row before restoring admission. This is not a coverage
    // issuer or a positive test of the deferred authenticated write path.
    const admission = f.sql.prepare(
        "SELECT sql FROM sqlite_schema WHERE name='v2_component_applicability_event_admit'",
    ).get()?.sql;
    if (typeof admission !== 'string') assert.fail('admission trigger missing');
    f.sql.exec('DROP TRIGGER v2_component_applicability_event_admit');
    await f.insert('change').run();
    f.sql.exec(admission);

    const events = f.events();
    const generation = f.generation();
    const foreignKeys = f.sql.prepare('PRAGMA foreign_key_list(v2_component_applicability_events)').all();
    assert.deepEqual(foreignKeys.map(key => [key.table, key.on_delete]).sort(), [
        ['v2_collection_items', 'RESTRICT'], ['v2_component_definitions', 'RESTRICT'], ['v2_owned_copies', 'RESTRICT'],
    ]);
    assert.throws(() => f.sql.exec("UPDATE v2_component_applicability_events SET actor = 'altered'"),
        /APPLICABILITY_HISTORY_IMMUTABLE/);
    assert.throws(() => f.sql.exec('DELETE FROM v2_component_applicability_events'), /APPLICABILITY_HISTORY_IMMUTABLE/);
    assert.throws(() => f.sql.prepare(`
        INSERT OR REPLACE INTO v2_component_applicability_events
            (collection_id, copy_id, definition_id, revision, before_not_applicable,
             after_not_applicable, actor, origin, before_generation)
        VALUES (1, 1, 1, 1, 0, 1, ?, 'initial', CAST(? AS INTEGER))
    `).run('synthetic-replacement', generation), /APPLICABILITY_INITIAL_DISABLED/);
    assert.deepEqual(f.events(), events);
    assert.equal(f.generation(), generation);
    assert.throws(() => f.sql.exec(`INSERT OR REPLACE INTO v2_component_applicability_events
        SELECT copy_id, definition_id, collection_id, revision, before_not_applicable, after_not_applicable,
            actor, origin, (SELECT generation FROM d1_quantity_collection_generation WHERE collection_id=1), occurred_at
        FROM v2_component_applicability_events`), /APPLICABILITY_STATE_CHANGED/);
    assert.throws(() => f.sql.exec('DELETE FROM v2_owned_copies WHERE id=1'), /FOREIGN KEY/);
    assert.throws(() => f.sql.exec('DELETE FROM v2_component_definitions WHERE id=1'), /PHYSICAL_DEFINITION_IDENTITY|FOREIGN KEY/);
    // Collection deletion would cascade to its definitions in 0007, but must fail with history.
    assert.throws(() => f.sql.exec('DELETE FROM v2_collection_items WHERE id=1'), /PHYSICAL_DEFINITION_IDENTITY|FOREIGN KEY/);
    assert.deepEqual(f.events(), events);
    assert.equal(f.generation(), generation);
});

// DEFERRED_TO_BATCH_2: authenticated coverage, permitted applicability ABA and
// positive multi-exception creation/batch rollback require the real admission path.
