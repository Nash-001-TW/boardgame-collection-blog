import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { classifyStoredComponents } from '../src/lib/component-classifier-adapter.ts';
import { handlePhysicalComponentRequest } from '../src/lib/physical-component-admin-api.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { dashboardPreview } from './helpers/admin-dashboard-preview.ts';

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
                'Idempotency-Key': key, ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}),
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
            const edit = { action: 'edit', definitionId: cardId, definitionRevision: 1, name: 'Renamed cards', type: 'card', unit: 'card', expected: 21 };
            assert.equal((await send({ ...edit, definitionId: legacyId })).status, 409);
            assert.equal((await send({ ...edit, definitionId: 99 })).status, 409);
            assert.equal((await send(edit)).status, 200);
            assert.equal((await send(edit)).status, 409);
            sqlite.prepare("INSERT INTO v2_legacy_id_map(legacy_table,legacy_id,target_table,target_id) VALUES ('collection_components','900','v2_component_definitions',?)").run(cardId);
            assert.equal((await classify())[2].reason, 'PHYSICAL_SOURCE_CONFLICT');
            assert.equal((await send({ ...edit, definitionRevision: 2 })).status, 409);
            sqlite.prepare("DELETE FROM v2_legacy_id_map WHERE legacy_id='900' AND target_id=?").run(cardId);
        });

        await t.test('copy counts enforce revision, quantity, same collection and rollback', async () => {
            const count = { action: 'count', definitionId: cardId, definitionRevision: 2, copyId: 50, revision: 0, actual: 0 };
            assert.equal((await send({ ...count, actual: -1 })).status, 400);
            assert.equal((await send({ ...count, copyId: 51 })).status, 409);
            sqlite.exec("CREATE TRIGGER reject_count BEFORE INSERT ON v2_copy_components BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
            assert.equal((await send(count)).status, 503);
            assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM v2_copy_components').get()?.n, 0);
            sqlite.exec('DROP TRIGGER reject_count');
            assert.equal((await send(count)).status, 200);
            assert.equal((await send({ ...count, actual: 10 })).status, 409);
            assert.equal((await send({ ...count, revision: 1, actual: 20 })).status, 200);
            assert.equal(sqlite.prepare('SELECT actual_quantity FROM v2_copy_components').get()?.actual_quantity, 20);
            assert.equal((await send({ action: 'edit', definitionId: cardId, definitionRevision: 2, name: 'Not cards',
                type: 'token', unit: 'piece', expected: 20 })).status, 409);
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
            const route = '/admin/collection/components/';
            const request = (path: string, token?: string) => render(new Request('http://localhost' + route + path,
                { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }));
            assert.equal((await request('manage')).status, 401);
            const page = await request('manage?lang=en&collection=' + collectionId, jwt);
            assert.equal(page.status, 200);
            const html = await page.text();
            assert.match(html, /Renamed cards/);
            assert.match(html, /Confirmed physical component/);
            assert.match(html, /data-physical-action="create"/);
            assert.match(html, /data-physical-action="count"/);
            assert.match(await (await request('classification', jwt)).text(), /已確認實體組件/);
        });

        await t.test('the full evidence limit blocks existing writes and new definitions', async () => {
            sqlite.exec(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<10001)
                INSERT INTO v2_collection_items(id,display_name) SELECT n+1000,'Overflow' FROM ids`);
            const [result] = await classifyStoredComponents(db, [cardId], { secret });
            assert.equal(result.reason, 'EVIDENCE_UNAVAILABLE');
            assert.equal((await send({ ...create, name: 'Overflow component' }, 'test-command-003')).status, 503);
            assert.equal((await send({ action: 'count', definitionId: cardId, definitionRevision: 2,
                copyId: 50, revision: 2, actual: 30 })).status, 503);
            assert.equal(sqlite.prepare('SELECT actual_quantity FROM v2_copy_components').get()?.actual_quantity, 20);
        });
    } finally {
        auth.restore();
        sqlite.close();
    }
});
