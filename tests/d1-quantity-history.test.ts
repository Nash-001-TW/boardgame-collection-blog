import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readQuantityHistory } from '../src/lib/d1-quantity-history';
import { quantityPreviewView } from '../src/lib/d1-quantity-preview-view';
import { projectQuantitySnapshot } from '../src/lib/shared-quantity-preview';
import { sqliteD1 } from './helpers/sqlite-d1';

const item = {
    copyId: 1, definitionId: 10, inventory: 'in_collection' as const, actual: 99,
    inspection: 'checked' as const, countId: 3, countRevision: 1,
    evidenceStatus: 'OBSERVED_CURRENT_COUNT', edition: '初版', language: 'zh-TW',
};
const snapshot = { version: 1, rule: 'expected-minus-checked-v1', oldExpected: 103, newExpected: 100, items: [item] };
const actor = 'synthetic-actor-abcdef';

function fixture() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
        CREATE TABLE d1_quantity_history (
            collection_id INTEGER, definition_id INTEGER, actor TEXT, before_quantity INTEGER,
            after_quantity INTEGER, unit TEXT, reason TEXT, evidence_json TEXT, before_generation INTEGER,
            committed_at INTEGER, after_revision INTEGER
        );
        CREATE TABLE v2_owned_copies (id INTEGER, collection_item_id INTEGER, copy_label TEXT);
        CREATE TABLE current_counts (copy_id INTEGER, actual INTEGER);
        INSERT INTO v2_owned_copies VALUES (1, 1, '目前名稱'), (2, 2, '其他收藏副本');
        INSERT INTO current_counts VALUES (1, 99);
    `);
    const db = sqliteD1(sqlite);
    const insert = sqlite.prepare("INSERT INTO d1_quantity_history VALUES (?, ?, ?, 103, 100, '張', ?, ?, 1, ?, ?)");
    return {
        sqlite, db,
        add({ collection = 1, definition = 10, stamp = 1_700_000_000, revision = 2,
            reason = '合成理由', evidence = JSON.stringify(snapshot) } = {}) {
            insert.run(collection, definition, actor, reason, evidence, stamp, revision);
        },
        async read(definition = 10) {
            const history = await readQuantityHistory(db, 1, false);
            assert.equal(history.status, 'ready');
            return history.byDefinition.get(definition) ?? [];
        },
    };
}

test('D1-05 restores 99 and shortages 4 → 1 after the current count is updated to 100', async t => {
    const f = fixture();
    t.after(() => f.sqlite.close());
    f.add();
    f.sqlite.exec('UPDATE current_counts SET actual = 100 WHERE copy_id = 1');
    const [entry] = await f.read();
    assert.equal(entry.isoTime, '2023-11-14T22:13:20.000Z');
    assert.match(entry.time, /06:13/);
    assert.equal(entry.change, '103 → 100 張');
    assert.deepEqual(entry.detail?.rows, [{ name: '目前名稱 · 初版 / zh-TW', actual: '99', before: '缺 4 張', after: '缺 1 張' }]);
    assert.equal(entry.detail?.missing, '4 → 1');
    assert.equal(entry.detail?.actor, '管理員（abcdef）');
    assert.doesNotMatch(JSON.stringify(entry), /synthetic-actor/);
});

test('one collection query groups definitions and sorts newest first with a revision tie-breaker', async t => {
    const f = fixture();
    t.after(() => f.sqlite.close());
    f.add({ reason: 'old' });
    f.add({ stamp: 1_700_000_002, revision: 4, reason: 'newest' });
    f.add({ stamp: 1_700_000_002, revision: 3, reason: 'same second' });
    f.add({ collection: 2, reason: 'other collection' });
    f.add({ definition: 11, reason: 'other definition' });
    let queries = 0;
    const db = { prepare(sql: string) { queries++; return f.db.prepare(sql); } } as D1Database;
    const history = await readQuantityHistory(db, 1, true);
    assert.equal(queries, 1);
    assert.equal(history.status, 'ready');
    assert.deepEqual(history.byDefinition.get(10)?.map(entry => entry.reason), ['newest', 'same second', 'old']);
    assert.deepEqual(history.byDefinition.get(11)?.map(entry => entry.reason), ['other definition']);
});

test('history and preview use identical shortage, extra and unreadable judgements', async t => {
    const f = fixture();
    t.after(() => f.sqlite.close());
    const evidence = { ...snapshot, items: [
        item,
        { ...item, copyId: 2, actual: 102, inventory: 'loaned' as const },
        { ...item, copyId: 3, actual: null, inspection: null, evidenceStatus: 'UNKNOWN' },
    ] };
    f.add({ evidence: JSON.stringify(evidence) });
    const [entry] = await f.read();
    const preview = projectQuantitySnapshot(evidence, { collectionId: 1, generation: '1' },
        { definitionId: 10, beforeQuantity: 103, afterQuantity: 100 });
    assert.equal(preview.status, 'READY');
    const view = quantityPreviewView(preview, new Map(), false, '張');
    const judgements = (rows: typeof view.groups[number]['rows']) =>
        rows.map(({ actual, before, after }) => ({ actual, before, after }));
    assert.ok(entry.detail);
    assert.deepEqual(judgements(entry.detail.rows), judgements(view.groups.flatMap(group => group.rows)));
    assert.equal(entry.detail.affected, '3');
    assert.match(entry.detail.rows[1].name, /副本 #2（已移除）/);
    assert.equal(entry.detail.rows[1].after, '不缺（多 2 張）');
    assert.equal(entry.detail.rows[2].before, '尚未清點');
});

test('damaged or unprojectable evidence keeps the summary and omits assessment details', async t => {
    const f = fixture();
    t.after(() => f.sqlite.close());
    f.add({ reason: 'invalid json', evidence: '{' });
    f.add({ reason: 'wrong definition', evidence: JSON.stringify({ ...snapshot, items: [{ ...item, definitionId: 11 }] }) });
    f.add({ reason: 'missing evidence ID', evidence: JSON.stringify({ ...snapshot, items: [{ ...item, countId: null }] }) });
    const entries = await f.read();
    assert.equal(entries.length, 3);
    assert.ok(entries.every(entry => entry.change === '103 → 100 張' && entry.detail === null));
});

test('missing cosmetic snapshot fields are dashes and removed copies use their snapshot ID', async t => {
    const f = fixture();
    t.after(() => f.sqlite.close());
    f.add({ evidence: JSON.stringify({ ...snapshot, items: [{ ...item, edition: null, language: undefined }] }) });
    f.sqlite.exec('DELETE FROM v2_owned_copies WHERE id = 1');
    const [entry] = await f.read();
    assert.equal(entry.detail?.rows[0].name, '副本 #1（已移除） · — / —');
});

test('missing history view or thrown read returns unavailable and logs one fixed message per read', async t => {
    const f = fixture();
    t.after(() => f.sqlite.close());
    assert.deepEqual(await f.read(), []);
    const log = t.mock.method(console, 'error', () => {});
    f.sqlite.exec('DROP TABLE d1_quantity_history');
    assert.deepEqual(await readQuantityHistory(f.db, 1, false), { status: 'unavailable' });
    const broken = { prepare() { throw new Error('untrusted payload'); } } as unknown as D1Database;
    assert.deepEqual(await readQuantityHistory(broken, 1, false), { status: 'unavailable' });
    assert.deepEqual(log.mock.calls.map(call => call.arguments), [
        // Only the error kind is logged; the thrown message (untrusted payload) must not appear.
        ['D1 quantity history unavailable', { kind: 'Error' }], ['D1 quantity history unavailable', { kind: 'Error' }],
    ]);
});
