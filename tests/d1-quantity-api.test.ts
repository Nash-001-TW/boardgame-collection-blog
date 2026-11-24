import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { handlePhysicalComponentRequest } from '../src/lib/physical-component-admin-api.ts';
import { writePhysicalComponent } from '../src/lib/physical-component-management.ts';
import type { QuantityBaseline } from '../src/lib/shared-quantity-commit.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { sqliteD1 } from './helpers/sqlite-d1.ts';

const secret = 'synthetic isolated quantity API signing key';
const actor = 'verified-admin-subject';
const migrations = readdirSync('migrations').filter(name => /^00(?:0[1-9]|1[0-9]|2[0-3])_.*\.sql$/.test(name)).sort();
const previewBody = { action: 'quantity-preview', definitionId: 1, definitionRevision: 1,
    previousExpected: 103, expected: 100, name: 'Cards', type: 'card', unit: 'card', reason: 'Synthetic correction' };

async function fixture(t: TestContext, auth: Awaited<ReturnType<typeof accessFixture>>) {
    const sql = new DatabaseSync(':memory:');
    t.after(() => sql.close());
    for (const name of migrations) sql.exec(readFileSync('migrations/' + name, 'utf8').replace(/^\uFEFF/, ''));
    sql.exec("INSERT INTO v2_collection_items(id, display_name) VALUES (1, 'Synthetic collection')");
    const db = sqliteD1(sql);
    await writePhysicalComponent(db, secret, actor, 'synthetic-create', {
        action: 'create', collectionId: 1, name: 'Cards', type: 'card', unit: 'card', expected: 103, confirmed: true,
    });
    sql.exec(`
        INSERT INTO v2_owned_copies(id, collection_item_id, inventory_status)
        VALUES (1, 1, 'in_collection'), (2, 1, 'loaned'), (3, 1, 'sold');
        INSERT INTO v2_copy_components(owned_copy_id, component_definition_id, actual_quantity, inspection_status,
            last_checked_at, count_revision)
        VALUES (1, 1, 99, 'checked', '2026-01-01 01:02:03', 1),
               (2, 1, 110, 'checked', '2026-01-02 01:02:03', 1);
    `);
    let inserts = 0;
    let loseResponse = false;
    let loseRecoveryReads = false;
    let unavailableKey = false;
    let unexpectedBindingError = false;
    const failedReads = new Set<string>();
    const binding = { ...db, prepare(query: string) {
        for (const fragment of failedReads) {
            if (query.includes(fragment)) throw new Error('Synthetic D1 read failure');
        }
        const statement = db.prepare(query);
        if (!query.includes('INSERT INTO d1_quantity_changes')) return statement;
        inserts++;
        return { bind(...args: unknown[]) {
            const bound = statement.bind(...args);
            return { async run() {
                const result = await bound.run();
                if (loseResponse) {
                    if (loseRecoveryReads) {
                        failedReads.add('AS advanced');
                        failedReads.add('WHERE h.operation_id = ?');
                    }
                    throw new Error('Synthetic response loss');
                }
                return result;
            } };
        } } as D1PreparedStatement;
    } } as D1Database;
    const jwt = await auth.token();
    const send = async (body: object, key?: string, token = jwt) => {
        const response = await handlePhysicalComponentRequest(new Request('http://localhost/api/admin/collection/components', {
            method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'X-NotBGG-Request': '1',
                'Cf-Access-Jwt-Assertion': token, ...(key && { 'Idempotency-Key': key }) }, body: JSON.stringify(body),
        }), { ...auth.bindings, DB: binding, get PHYSICAL_COMPONENT_SIGNING_KEY() {
            if (unexpectedBindingError) throw new TypeError('Synthetic binding error');
            return unavailableKey ? undefined : secret;
        },
            NOTBGG_WRITE_LIMITER: { async limit() { return { success: true }; } } });
        const payload = await response.json() as {
            data?: { outcome?: string; code?: string; replayed?: boolean; operationId: string; baseline: QuantityBaseline;
                previewToken: string; impact: { affectedCopies: number; details: Array<{
                    row: { actual: number; applicability: { revision: number } }; loaned: boolean;
                    before: { units: number }; after: { units: number };
                }> } };
            error?: { code: string };
        };
        return { status: response.status, ...payload };
    };
    const preview = async () => {
        const result = await send(previewBody);
        assert.equal(result.status, 200);
        assert.ok(result.data);
        const { operationId, baseline, previewToken, impact } = result.data;
        return { operationId, impact, body: { ...previewBody, action: 'quantity-commit', baseline, previewToken } };
    };
    const state = () => ({
        definition: sql.prepare('SELECT * FROM v2_component_definitions').all(),
        generations: sql.prepare('SELECT * FROM d1_quantity_collection_generation').all(),
        counts: sql.prepare('SELECT * FROM v2_copy_components').all(),
        copies: sql.prepare('SELECT * FROM v2_owned_copies').all(),
        sources: sql.prepare('SELECT * FROM v2_physical_component_sources').all(),
        history: sql.prepare('SELECT * FROM d1_quantity_changes').all(),
        changes: sql.prepare('SELECT total_changes() AS total').get()?.total,
    });
    return { sql, send, preview, state, failedReads, inserts: () => inserts,
        loseResponse: (blockRecovery = false) => { loseResponse = true; loseRecoveryReads = blockRecovery; },
        loseKey: () => { unavailableKey = true; },
        failBinding: () => { unexpectedBindingError = true; },
    };
}

function expectOutcome(result: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['send']>>,
    status: number, outcome: string, code?: string) {
    assert.equal(result.status, status);
    assert.equal(result.data?.outcome, outcome);
    assert.equal(result.data?.code, code);
    assert.equal(result.error?.code, code);
}

test('A2 authorized quantity API with 0023 only', async t => {
    const auth = await accessFixture();
    t.after(auth.restore);
    await t.test('D1-01/04/10 read-only preview, shortage 4 to 1, surplus and checked count preserved', async t => {
        const f = await fixture(t, auth);
        const before = f.state();
        const p = await f.preview();
        assert.deepEqual(f.state(), before);
        assert.equal(p.impact.affectedCopies, 2);
        assert.deepEqual(p.impact.details.map(d => [d.row.actual, d.before.units, d.after.units, d.loaned, d.row.applicability.revision]),
            [[99, 4, 1, false, 0], [110, 0, 0, true, 0]]);
        expectOutcome(await f.send(p.body, p.operationId), 200, 'COMMITTED');
        const after = f.state();
        assert.equal(after.definition[0].expected_quantity, 100);
        assert.equal(after.definition[0].physical_revision, 2);
        assert.deepEqual(after.counts, before.counts);
        assert.deepEqual(after.copies, before.copies);
        assert.equal(after.history.length, 1);
        assert.equal(after.history[0].reason, previewBody.reason);
        assert.equal(after.history[0].actor, actor);
        assert.equal(after.history[0].before_quantity, 103);
        assert.equal(after.history[0].after_quantity, 100);
        const evidence = JSON.parse(String(after.history[0].evidence_json));
        assert.equal(evidence.items[0].countDate, null);
        assert.equal(evidence.items[0].lastSavedAt, before.counts[0].last_checked_at);
        assert.equal(after.history[0].operation_id, p.operationId);
    });

    await t.test('D1-10 ordinary rename writes no receipt and edit cannot change quantity', async t => {
        const f = await fixture(t, auth);
        const changed = await f.send({ ...previewBody, action: 'edit' });
        assert.equal(changed.status, 409);
        assert.equal(changed.error?.code, 'D1_QUANTITY_PREVIEW_REQUIRED');
        assert.equal((await f.send({ ...previewBody, action: 'edit', name: 'Renamed', expected: 103 })).status, 200);
        assert.equal(f.state().definition[0].component_name, 'Renamed');
        assert.deepEqual(f.state().history, []);
    });

    await t.test('D1-11 failed receipt INSERT and zero-row definition update roll back atomically', async t => {
        for (const trigger of [
            "BEFORE INSERT ON d1_quantity_changes BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
            'BEFORE UPDATE ON v2_component_definitions BEGIN SELECT RAISE(IGNORE); END',
        ]) {
            const f = await fixture(t, auth);
            const p = await f.preview();
            f.sql.exec('CREATE TRIGGER synthetic_failure ' + trigger);
            const { changes: _, ...before } = f.state();
            expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
            const { changes: __, ...after } = f.state();
            assert.deepEqual(after, before);
            assert.equal(f.inserts(), 1);
            expectOutcome(await f.send({ ...p.body, action: 'quantity-status' }, p.operationId), 200, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        }
    });

    await t.test('D1-12 lost response replays original receipt and same key with changed content conflicts', async t => {
        const f = await fixture(t, auth);
        const p = await f.preview();
        f.loseResponse();
        const first = await f.send(p.body, p.operationId);
        expectOutcome(first, 200, 'COMMITTED');
        assert.equal(first.data?.replayed, true);
        assert.deepEqual((await f.send(p.body, p.operationId)).data, first.data);
        assert.deepEqual((await f.send({ ...p.body, action: 'quantity-status' }, p.operationId)).data, first.data);
        expectOutcome(await f.send({ ...p.body, reason: 'Changed content' }, p.operationId),
            409, 'NOT_COMMITTED', 'IDEMPOTENCY_CONFLICT');
        assert.equal(f.inserts(), 1);
    });

    await t.test('lost commit response and verification error preserve UNKNOWN until receipt is readable', async t => {
        const f = await fixture(t, auth);
        const p = await f.preview();
        f.loseResponse(true);
        expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        assert.equal(f.state().history.length, 1);
        f.loseKey();
        expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        f.failedReads.clear();
        const replay = await f.send(p.body, p.operationId);
        expectOutcome(replay, 200, 'COMMITTED');
        assert.equal(replay.data?.replayed, true);
        expectOutcome(await f.send({ ...p.body, reason: 'Changed content' }, p.operationId),
            409, 'NOT_COMMITTED', 'IDEMPOTENCY_CONFLICT');
        assert.equal(f.inserts(), 1);
    });

    await t.test('lost commit response and observation read failure preserve UNKNOWN for retry and status', async t => {
        const f = await fixture(t, auth);
        const p = await f.preview();
        f.loseResponse(true);
        expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        assert.equal(f.state().history.length, 1);
        expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        const statusBody = { ...p.body, action: 'quantity-status' };
        expectOutcome(await f.send(statusBody, p.operationId), 200, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        f.failedReads.delete('WHERE h.operation_id = ?');
        expectOutcome(await f.send(statusBody, p.operationId), 200, 'COMMITTED');
        assert.equal(f.inserts(), 1);
    });

    await t.test('epoch read failure preserves UNKNOWN for commit and status unless a receipt resolves it', async t => {
        const f = await fixture(t, auth);
        const p = await f.preview();
        const statusBody = { ...p.body, action: 'quantity-status' };
        const epochQuery = 'SELECT epoch FROM d1_quantity_epoch';
        f.failedReads.add(epochQuery);
        expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        expectOutcome(await f.send(statusBody, p.operationId), 200, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        assert.equal(f.inserts(), 0);
        f.failedReads.delete(epochQuery);
        expectOutcome(await f.send(p.body, p.operationId), 200, 'COMMITTED');
        f.failedReads.add(epochQuery);
        expectOutcome(await f.send(statusBody, p.operationId), 200, 'COMMITTED');
        assert.equal(f.inserts(), 1);
    });

    await t.test('unexpected quantity action exceptions keep commit and status pending and preview unavailable', async t => {
        const f = await fixture(t, auth);
        const p = await f.preview();
        f.failBinding();
        expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        expectOutcome(await f.send({ ...p.body, action: 'quantity-status' }, p.operationId),
            200, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        const preview = await f.send(previewBody);
        assert.equal(preview.status, 503);
        assert.equal(preview.error?.code, 'EVIDENCE_UNAVAILABLE');
        assert.equal(f.inserts(), 0);
    });

    await t.test('admission read exception returns UNKNOWN without attempting a write', async t => {
        const f = await fixture(t, auth);
        const p = await f.preview();
        f.failedReads.add('SELECT p.classification_rows AS classificationRows');
        expectOutcome(await f.send(p.body, p.operationId), 503, 'UNKNOWN', 'D1_RESULT_UNKNOWN');
        assert.equal(f.inserts(), 0);
    });

    await t.test('D1-13 competing operation IDs, intervening ordinary edit, and archive', async t => {
        const f = await fixture(t, auth);
        const a = await f.preview(), b = await f.preview();
        assert.notEqual(a.operationId, b.operationId);
        const results = await Promise.all([f.send(a.body, a.operationId), f.send(b.body, b.operationId)]);
        assert.equal(results.filter(r => r.data?.outcome === 'COMMITTED').length, 1);
        expectOutcome(results.find(r => r.status === 409)!, 409, 'NOT_COMMITTED', 'D1_CONFIRMATION_SUPERSEDED');
        assert.equal(f.state().history.length, 1);
        for (const archive of [false, true]) {
            const other = await fixture(t, auth);
            const p = await other.preview();
            if (archive) other.sql.exec("INSERT INTO v2_collection_management(collection_item_id, archived_at) VALUES (1, '2026-11-23')");
            else assert.equal((await other.send({ action: 'edit', definitionId: 1, definitionRevision: 1, name: 'Edited',
                type: 'card', unit: 'card' })).status, 200);
            const code = archive ? 'COLLECTION_ARCHIVED' : 'D1_CONFIRMATION_SUPERSEDED';
            expectOutcome(await other.send(p.body, p.operationId), 409, 'NOT_COMMITTED', code);
            expectOutcome(await other.send({ ...p.body, action: 'quantity-status' }, p.operationId), 200, 'NOT_COMMITTED', code);
            assert.equal(other.inserts(), 0);
        }
    });

    await t.test('tampered token, different actor, changed epoch and separate database reject confirmation', async t => {
        const f = await fixture(t, auth), other = await fixture(t, auth);
        const p = await f.preview();
        const second = await other.preview();
        assert.notEqual(p.body.baseline.databaseEpoch, second.body.baseline.databaseEpoch);
        const wrongActor = await auth.token({ subject: 'different-subject' });
        const badToken = (p.body.previewToken.startsWith('0') ? '1' : '0') + p.body.previewToken.slice(1);
        for (const result of [
            await f.send({ ...p.body, previewToken: badToken }, p.operationId),
            await f.send(p.body, p.operationId, wrongActor),
            await f.send({ ...p.body, baseline: { ...p.body.baseline, databaseEpoch: second.body.baseline.databaseEpoch } }, p.operationId),
            await other.send(p.body, p.operationId),
        ]) expectOutcome(result, 409, 'NOT_COMMITTED', 'D1_PREVIEW_INVALID');
        assert.equal(f.inserts() + other.inserts(), 0);
    });

    await t.test('global 10,000-row limit returns 503 without attempting a receipt INSERT', async t => {
        const f = await fixture(t, auth);
        const p = await f.preview();
        f.sql.exec(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<9999)
            INSERT INTO v2_collection_items(display_name) SELECT 'Synthetic ' || x FROM n`);
        const failed = await f.send(previewBody);
        assert.equal(failed.status, 503);
        assert.equal(failed.error?.code, 'EVIDENCE_UNAVAILABLE');
        expectOutcome(await f.send(p.body, p.operationId), 503, 'NOT_COMMITTED', 'EVIDENCE_UNAVAILABLE');
        assert.equal(f.inserts(), 0);
        assert.equal(f.state().definition[0].expected_quantity, 103);
    });

    await t.test('preview rejects stale revision, ineligible definition, and oversized snapshot', async t => {
        const f = await fixture(t, auth);
        for (const [body, code] of [
            [{ ...previewBody, definitionRevision: 2 }, 'COMPONENT_STATE_CHANGED'],
            [{ ...previewBody, previousExpected: 102 }, 'COMPONENT_STATE_CHANGED'],
            [{ ...previewBody, definitionId: 999 }, 'COMPONENT_INELIGIBLE'],
        ] as const) {
            const result = await f.send(body);
            assert.equal(result.status, 409);
            assert.equal(result.error?.code, code);
        }
        f.sql.prepare('UPDATE v2_owned_copies SET edition = ? WHERE id = 1').run('x'.repeat(262145));
        const result = await f.send(previewBody);
        assert.equal(result.status, 409);
        assert.equal(result.error?.code, 'D1_EVIDENCE_TOO_LARGE');
        assert.equal(f.inserts(), 0);
    });
});
