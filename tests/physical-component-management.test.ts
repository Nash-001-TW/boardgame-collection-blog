import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { classifyStoredComponents } from '../src/lib/component-classifier-adapter.ts';
import { handlePhysicalComponentRequest } from '../src/lib/physical-component-admin-api.ts';
import { isCountDate, todayInTaipei } from '../src/lib/physical-component-values.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { dashboardPreview } from './helpers/admin-dashboard-preview.ts';

test('count date changes at Taipei midnight and validates Gregorian dates', () => {
    const before = todayInTaipei(new Date('2026-11-25T15:59:00Z'));
    const after = todayInTaipei(new Date('2026-11-25T16:00:00Z'));
    assert.equal(before, '2026-11-25');
    assert.equal(after, '2026-11-26');
    assert.equal(isCountDate('2026-11-26', before), false);
    assert.equal(isCountDate('2026-11-26', after), true);
    assert.equal(isCountDate('2024-02-29', after), true);
    assert.equal(isCountDate('2025-02-29', after), false);
});

function d1ForSqlite(sqlite: DatabaseSync) {
    function prepare(sql: string, args: SQLInputValue[] = []) {
        const read = () => {
            const statement = sqlite.prepare(sql);
            if (statement.columns().length) return statement.all(...args);
            statement.run(...args);
            return [];
        };
        return {
            bind: (...values: SQLInputValue[]) => prepare(sql, values),
            all: async () => ({ success: true, results: read() }),
            first: async (column?: string) => {
                const row = read()[0];
                return row ? (column ? row[column] : row) : null;
            },
            read,
        };
    }
    const db = {
        prepare,
        async batch(statements: ReturnType<typeof prepare>[]) {
            sqlite.exec('BEGIN');
            try {
                const results = statements.map(statement => ({ success: true, results: statement.read() }));
                sqlite.exec('COMMIT');
                return results;
            } catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        },
    };
    return db as unknown as D1Database;
}

test('physical component workflow through Admin API, real SQLite and Astro rendering', async t => {
    const sqlite = new DatabaseSync(':memory:');
    const auth = await accessFixture();
    const secret = 'local-only synthetic signing key for tests';
    const migration = '0017_physical_components.sql';
    const read = (file: string) => readFileSync('migrations/' + file, 'utf8').replace(/^\uFEFF/, '');
    try {
        for (const file of readdirSync('migrations').filter(file => file.endsWith('.sql') && file < migration).sort()) {
            if (file.startsWith('0012_')) {
                sqlite.exec(`
                    INSERT INTO collection_items(id,source_key,display_name) VALUES (1,'synthetic','Synthetic collection');
                    INSERT INTO collection_components(id,collection_item_id,component_name,component_type)
                    VALUES (1,1,'Historical product','expansion');
                    INSERT INTO sleeve_sizes(id,width_tenth_mm,height_tenth_mm) VALUES (1,630,880);
                    INSERT INTO sleeve_requirements(id,source_key,collection_item_id,component_id,size_id,quantity_sheets)
                    VALUES (1,'historical',1,1,1,45);
                `);
            }
            sqlite.exec(read(file));
        }
        const legacyBefore = sqlite.prepare(`
            SELECT d.id AS definition, r.id AS requirement, r.quantity_sheets, m.legacy_id
            FROM v2_component_definitions d JOIN v2_sleeve_requirements r ON r.component_definition_id = d.id
            JOIN v2_legacy_id_map m ON m.target_id = d.id AND m.target_table = 'v2_component_definitions'
        `).get();
        assert.ok(legacyBefore);
        sqlite.exec(read(migration));
        sqlite.exec(read('0023_shared_quantity_commit.sql'));
        sqlite.exec(read('0024_component_applicability.sql'));
        sqlite.exec(read('0026_count_date.sql'));
        assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_physical_component_sources').get()?.n, 0);
        assert.equal(sqlite.prepare('SELECT component_definition_id FROM v2_sleeve_requirements WHERE source_key=?')
            .get('historical')?.component_definition_id, legacyBefore.definition);
        assert.equal(sqlite.prepare('SELECT quantity_sheets FROM v2_sleeve_requirements WHERE source_key=?')
            .get('historical')?.quantity_sheets, 45);
        const collectionId = Number(sqlite.prepare('SELECT id FROM v2_collection_items').get()?.id);
        const sizeId = Number(sqlite.prepare('SELECT id FROM v2_sleeve_sizes').get()?.id);
        const legacyId = Number(legacyBefore.definition);
        sqlite.exec(`
            INSERT INTO v2_collection_items(id,display_name) VALUES (90,'Other collection');
            INSERT INTO v2_owned_copies(id,collection_item_id) VALUES (50,${collectionId}),(51,90);
            INSERT INTO v2_sleeve_requirements(id,collection_item_id,size_id,quantity_sheets)
            VALUES (60,${collectionId},${sizeId},20),(61,90,${sizeId},30);
            INSERT INTO v2_component_definitions(id,collection_item_id,component_name,component_type)
            VALUES (99,${collectionId},'Unverified card','card');
        `);
        const db = d1ForSqlite(sqlite);
        const bindings = { ...auth.bindings, DB: db, PHYSICAL_COMPONENT_SIGNING_KEY: secret,
            NOTBGG_WRITE_LIMITER: { async limit() { return { success: true }; } } };
        const jwt = await auth.token();
        const url = 'http://localhost/api/admin/collection/components';
        const create = { action: 'create', collectionId, name: 'Cards', type: 'card', unit: 'card', expected: 20, confirmed: true };
        const send = (body: object, key = 'test-command-001', token: string | null = jwt, origin = 'http://localhost') =>
            handlePhysicalComponentRequest(new Request(url, { method: 'POST', headers: {
                Origin: origin, 'Content-Type': 'application/json', 'X-NotBGG-Request': '1',
                ...(key && { 'Idempotency-Key': key }), ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}),
            }, body: JSON.stringify(body) }), bindings);
        const resultId = async (response: Response) => (await response.json() as { data: { id: number } }).data.id;
        let cardId = 0;
        let tokenId = 0;

        await t.test('authentication, CSRF, strict input, atomic creation and retry', async () => {
            assert.equal((await send(create, 'test-command-001', null)).status, 401);
            assert.equal((await send(create, 'test-command-001', await auth.token({ email: 'viewer@example.test' }))).status, 403);
            assert.equal((await send(create, 'test-command-001', jwt, 'https://other.example')).status, 403);
            assert.equal((await send({ ...create, classification: 'PHYSICAL_COMPONENT' })).status, 400);
            assert.equal((await send({ ...create, confirmed: false })).status, 400);
            sqlite.exec("CREATE TRIGGER reject_source BEFORE INSERT ON v2_physical_component_sources BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
            assert.equal((await send(create)).status, 503);
            assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM v2_component_definitions WHERE component_name='Cards'").get()?.n, 0);
            sqlite.exec('DROP TRIGGER reject_source');
            const created = await send(create);
            assert.equal(created.status, 201);
            cardId = await resultId(created);
            assert.equal(await resultId(await send(create)), cardId);
            assert.equal((await send({ ...create, name: 'Other' })).status, 409);
            const token = await send({ ...create, name: 'Tokens', type: 'token', unit: 'piece' }, 'test-command-002');
            assert.equal(token.status, 201);
            tokenId = await resultId(token);
        });

        await t.test('classification, editing and fail-closed conflicts', async () => {
            const ids = [legacyId, 99, cardId, tokenId];
            const classify = () => classifyStoredComponents(db, ids, { secret });
            assert.deepEqual((await classify()).map(result => result.classification),
                ['LEGACY_PRODUCT', 'UNKNOWN', 'PHYSICAL_COMPONENT', 'PHYSICAL_COMPONENT']);
            assert.equal((await classifyStoredComponents(db, [cardId], { secret: 'different signing key with enough bytes' }))[0].classification, 'UNKNOWN');
            const forgedToken = '0'.repeat(64);
            sqlite.prepare(`INSERT INTO v2_component_definitions
                (id, collection_item_id, component_name, physical_creation_token, physical_revision)
                VALUES (110, ?, 'Forged', ?, 1)`).run(collectionId, forgedToken);
            sqlite.prepare(`INSERT INTO v2_physical_component_sources
                (definition_id, collection_item_id, record_scope, creation_token, actor, request_digest, signature)
                VALUES (110, ?, 'production', ?, 'attacker', ?, ?)`).run(collectionId, forgedToken, forgedToken, forgedToken);
            assert.equal((await classifyStoredComponents(db, [110], { secret }))[0].reason, 'PHYSICAL_SOURCE_INVALID');
            assert.throws(() => sqlite.prepare('UPDATE v2_physical_component_sources SET signature=? WHERE definition_id=?').run('0'.repeat(64), cardId), /IMMUTABLE/);
            assert.throws(() => sqlite.prepare('UPDATE v2_component_definitions SET collection_item_id=90 WHERE id=?').run(cardId), /IDENTITY/);
            const edit = { action: 'edit', definitionId: cardId, definitionRevision: 1, name: 'Renamed cards', type: 'card', unit: 'card' };
            const definition = sqlite.prepare('SELECT * FROM v2_component_definitions WHERE id=?');
            const before = definition.get(cardId);
            const changes = sqlite.prepare('SELECT total_changes() AS writes');
            const writesBefore = changes.get();
            const rejected = await send({ ...edit, previousExpected: 20, expected: 21, reason: 'Correct the test quantity' });
            assert.equal(rejected.status, 409);
            assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'D1_QUANTITY_PREVIEW_REQUIRED');
            assert.deepEqual(definition.get(cardId), before);
            assert.deepEqual(changes.get(), writesBefore);
            assert.equal((await send({ ...edit, definitionId: legacyId })).status, 409);
            assert.equal((await send({ ...edit, definitionId: 99 })).status, 409);
            assert.equal((await send(edit)).status, 200);
            const staleEdit = await send(edit);
            assert.equal(staleEdit.status, 409);
            assert.equal((await staleEdit.json() as { error: { code: string } }).error.code, 'COMPONENT_STATE_CHANGED');
            sqlite.prepare("INSERT INTO v2_legacy_id_map(legacy_table,legacy_id,target_table,target_id) VALUES ('collection_components','900','v2_component_definitions',?)").run(cardId);
            assert.equal((await classify())[2].reason, 'PHYSICAL_SOURCE_CONFLICT');
            assert.equal((await send({ ...edit, definitionRevision: 2 }, 'test-conflicted-source')).status, 409);
            sqlite.prepare("DELETE FROM v2_legacy_id_map WHERE legacy_id='900' AND target_id=?").run(cardId);
        });

        await t.test('copy counts enforce revision, quantity, same collection and rollback', async () => {
            const count = { action: 'count', definitionId: cardId, definitionRevision: 2, copyId: 50, revision: 0, actual: 0, countedOn: '2026-01-05' };
            assert.equal((await send({ ...count, actual: -1 })).status, 400);
            assert.equal((await send({ ...count, copyId: 51 })).status, 409);
            sqlite.exec("CREATE TRIGGER reject_count BEFORE INSERT ON v2_copy_components BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
            assert.equal((await send(count)).status, 503);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_copy_components').get()?.n, 0);
            sqlite.exec('DROP TRIGGER reject_count');
            for (const countedOn of [undefined, '9999-01-01', '1999-12-31', '2026-1-05', '2026-02-30', 20260105]) {
                const rejected = await send({ ...count, countedOn });
                assert.equal(rejected.status, 400);
                assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'INVALID_COUNT_DATE');
                assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_copy_components').get()?.n, 0);
            }
            sqlite.exec("CREATE TRIGGER reject_count_date BEFORE INSERT ON v2_copy_components BEGIN SELECT RAISE(ABORT, 'COUNT_DATE_INVALID'); END");
            const invalidAtWrite = await send(count);
            assert.equal(invalidAtWrite.status, 400);
            assert.equal((await invalidAtWrite.json() as { error: { code: string } }).error.code, 'INVALID_COUNT_DATE');
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_copy_components').get()?.n, 0);
            sqlite.exec('DROP TRIGGER reject_count_date');
            const result = await send(count);
            assert.equal(result.status, 200);
            assert.equal((await result.json() as { data: { countedOn: string } }).data.countedOn, count.countedOn);
            const target = () => sqlite.prepare('SELECT counted_on, last_checked_at FROM v2_copy_components WHERE owned_copy_id=50').get();
            assert.equal(target()?.counted_on, count.countedOn);
            assert.match(String(target()?.last_checked_at), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
            assert.equal((await send({ ...count, actual: 10, countedOn: '2026-01-06' })).status, 409);
            assert.equal(target()?.counted_on, count.countedOn);
            // Isolate the sibling row so the existing downstream workflow retains its original fixture.
            sqlite.exec('SAVEPOINT count_date_sibling');
            try {
                sqlite.exec("INSERT INTO v2_owned_copies(id, collection_item_id) SELECT 52, collection_item_id FROM v2_owned_copies WHERE id=50");
                assert.equal((await send({ ...count, copyId: 52, countedOn: '2026-01-04' })).status, 200);
                assert.equal((await send({ ...count, revision: 1, actual: 20, countedOn: '2026-01-03' })).status, 200);
                assert.equal(target()?.counted_on, '2026-01-03');
                assert.equal(sqlite.prepare('SELECT counted_on FROM v2_copy_components WHERE owned_copy_id=52').get()?.counted_on, '2026-01-04');
            } finally {
                sqlite.exec('ROLLBACK TO count_date_sibling; RELEASE count_date_sibling');
            }
            assert.equal((await send({ ...count, revision: 1, actual: 20, countedOn: '2026-01-03' })).status, 200);
            assert.equal(target()?.counted_on, '2026-01-03');
            assert.equal(sqlite.prepare('SELECT actual_quantity FROM v2_copy_components').get()?.actual_quantity, 20);
            const locked = await send({ action: 'edit', definitionId: cardId, definitionRevision: 2, name: 'Renamed cards',
                type: 'token', unit: 'piece', expected: 20 }, 'test-locked-type');
            assert.equal(locked.status, 409);
            assert.equal((await locked.json() as { error: { code: string } }).error.code, 'PHYSICAL_TYPE_IN_USE');
        });

        await t.test('applicability guards writes and restores the original count', async () => {
            const action = { action: 'applicability', definitionId: cardId, definitionRevision: 2,
                copyId: 50, revision: 0, next: 'not_applicable' };
            const count = { action: 'count', definitionId: cardId, definitionRevision: 2, copyId: 50, revision: 2, actual: 20, countedOn: '2026-01-05' };
            const stored = () => sqlite.prepare('SELECT * FROM v2_copy_components').all();
            const before = stored();
            const checkError = async (body: object, status: number, code: string) => {
                const result = await send(body);
                assert.equal(result.status, status);
                assert.equal((await result.json() as { error: { code: string } }).error.code, code);
            };
            await checkError({ ...action, next: 'invalid' }, 400, 'INVALID_COMPONENT_INPUT');
            await checkError({ ...action, definitionId: 99 }, 409, 'COMPONENT_INELIGIBLE');
            await checkError({ ...action, definitionRevision: 1 }, 409, 'COMPONENT_STATE_CHANGED');
            await checkError({ ...action, copyId: 51 }, 409, 'COMPONENT_STATE_CHANGED');
            sqlite.exec("UPDATE v2_owned_copies SET seal_status = 'sealed' WHERE id = 50");
            await checkError(action, 409, 'COMPONENT_STATE_CHANGED');
            sqlite.exec("UPDATE v2_owned_copies SET seal_status = 'unsealed' WHERE id = 50");
            sqlite.exec('SAVEPOINT archived_applicability');
            try {
                sqlite.prepare(`INSERT INTO v2_collection_management(collection_item_id, archived_at) VALUES (?, '2026-11-26')
                    ON CONFLICT(collection_item_id) DO UPDATE SET archived_at = excluded.archived_at`).run(collectionId);
                assert.equal((await send(action)).status, 409);
                assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_component_applicability_events').get()?.n, 0);
            } finally {
                sqlite.exec('ROLLBACK TO archived_applicability; RELEASE archived_applicability');
            }
            const preview = { action: 'quantity-preview', definitionId: cardId, definitionRevision: 2,
                previousExpected: 20, expected: 25, name: 'Renamed cards', type: 'card', unit: 'card', reason: 'Synthetic correction' };
            const previewBody = async () => {
                const response = await send(preview, '');
                assert.equal(response.status, 200);
                return (await response.json() as { data: { operationId: string; baseline: object; previewToken: string;
                    impact: { classification: { not_applicable: number } } } }).data;
            };
            const oldPreview = await previewBody();
            const response = await send(action);
            assert.equal(response.status, 200);
            const applied = (await response.json() as { data: { status: string; revision: number; actor: string } }).data;
            assert.equal(applied.status, 'not_applicable');
            assert.equal(applied.revision, 1);
            assert.ok(applied.actor);
            await checkError(action, 409, 'COMPONENT_STATE_CHANGED');
            await checkError(count, 409, 'COMPONENT_NOT_APPLICABLE');
            assert.deepEqual(stored(), before);
            assert.equal((await previewBody()).impact.classification.not_applicable, 1);
            const rejected = await send({ ...preview, action: 'quantity-commit', baseline: oldPreview.baseline,
                previewToken: oldPreview.previewToken }, oldPreview.operationId);
            assert.equal(rejected.status, 409);
            assert.equal((await send({ ...action, revision: 1, next: 'applicable' })).status, 200);
            assert.deepEqual(stored(), before);
            sqlite.exec('SAVEPOINT restored_count');
            assert.equal((await send(count)).status, 200);
            sqlite.exec('ROLLBACK TO restored_count; RELEASE restored_count');
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_component_applicability_events').get()?.n, 2);
        });

        await t.test('assignment is card-only and preserves quantities, old assignments and stock', async () => {
            const assign = { action: 'assign', definitionId: cardId, definitionRevision: 2, requirementId: 60, revision: 0 };
            assert.equal((await send({ ...assign, definitionId: tokenId, definitionRevision: 1 })).status, 409);
            assert.equal((await send({ ...assign, definitionId: 99 })).status, 409);
            assert.equal((await send({ ...assign, requirementId: 61 })).status, 409);
            assert.equal((await send({ ...assign, requirementId: Number(legacyBefore.requirement) })).status, 409);
            assert.equal((await send(assign)).status, 200);
            assert.equal((await send(assign)).status, 409);
            const row = sqlite.prepare('SELECT * FROM v2_sleeve_requirements WHERE id=60').get();
            assert.equal(row?.component_definition_id, cardId);
            assert.equal(row?.quantity_sheets, 20);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_sleeve_inventory_transactions').get()?.n, 0);
            assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
        });

        await t.test('Admin pages render real classifications and write controls', async () => {
            const render = await dashboardPreview(bindings);
            const route = '/admin/collection/' + collectionId + '/components?lang=en';
            const request = (path: string, token?: string) => render(new Request('http://localhost' + path,
                { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }));
            assert.equal((await request(route)).status, 401);
            const page = await request(route, jwt);
            assert.equal(page.status, 200);
            const html = await page.text();
            assert.match(html, /Renamed cards/);
            assert.match(html, /Confirmed physical component/);
            assert.match(html, /data-physical-action="create"/);
            assert.match(html, /data-physical-action="count"/);
            assert.match(html, /data-count-picker[\s\S]*data-count-list[\s\S]*data-component-management/);
            assert.match(html, /name="copyId" value="50"/);
            assert.match(html, /name="revision" value="2"/);
            assert.match(html, /data-count-current[^>]*>20<\/span>/);
            assert.match(html, /data-count-status role="status" aria-live="polite"/);
            assert.match(html, /name="previousExpected"/);
            assert.match(html, /name="reason"/);
            assert.match(html, /data-quantity-action="retry"/);
            assert.match(await (await request('/admin/collection/components/classification', jwt)).text(), /已確認實體組件/);
        });

        await t.test('ordinary maintenance preserves omitted and equal quantities without quantity history', async () => {
            const initial = sqlite.prepare('SELECT physical_revision AS revision, expected_quantity AS expected FROM v2_component_definitions WHERE id=?').get(cardId);
            const edit = { action: 'edit', definitionId: cardId, definitionRevision: Number(initial?.revision),
                name: 'Ordinary rename', type: 'card', unit: 'card' };
            const history = sqlite.prepare('SELECT COUNT(*) n FROM d1_quantity_history').get();
            assert.equal((await send(edit, 'test-maintenance-omit')).status, 200);
            assert.equal((await send({ ...edit, definitionRevision: edit.definitionRevision + 1,
                name: 'Another ordinary rename', expected: initial?.expected, previousExpected: initial?.expected },
            'test-maintenance-equal')).status, 200);
            assert.equal(sqlite.prepare('SELECT expected_quantity AS expected FROM v2_component_definitions WHERE id=?').get(cardId)?.expected, initial?.expected);
            assert.deepEqual(sqlite.prepare('SELECT COUNT(*) n FROM d1_quantity_history').get(), history);
        });

        await t.test('the full evidence limit blocks existing writes and new definitions', async () => {
            sqlite.exec(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<10001)
                INSERT INTO v2_collection_items(id,display_name) SELECT n+1000,'Overflow' FROM ids`);
            const [result] = await classifyStoredComponents(db, [cardId], { secret });
            assert.equal(result.reason, 'EVIDENCE_UNAVAILABLE');
            assert.equal((await send({ ...create, name: 'Overflow component' }, 'test-command-003')).status, 503);
            assert.equal((await send({ action: 'count', definitionId: cardId, definitionRevision: 2,
                copyId: 50, revision: 2, actual: 30, countedOn: '2026-01-05' })).status, 503);
            assert.equal(sqlite.prepare('SELECT actual_quantity FROM v2_copy_components').get()?.actual_quantity, 20);
        });
    } finally {
        auth.restore();
        sqlite.close();
    }
});
