import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPreview } from './helpers/admin-dashboard-preview.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';

const route = '/admin/collection/components/classification';
const notes = JSON.stringify({
    migration: '0012', legacy_table: 'collection_components',
    legacy_id: 7, legacy_component_type: 'base',
});

function evidence(kind: string, payload: object) {
    return { kind, payload: JSON.stringify(payload) };
}

function definition(id: number, migrationNotes: string | null = null) {
    return evidence('definition', { id, collection_item_id: 23, notes: migrationNotes });
}

const source = [
    evidence('legacy_component', { id: 7, collection_item_id: 11, component_type: 'base' }),
    evidence('legacy_collection', { id: 11 }),
    evidence('collection', { id: 23 }),
    evidence('map', {
        legacy_table: 'collection_components', legacy_id: '7',
        target_table: 'v2_component_definitions', target_id: 1,
    }),
    evidence('map', {
        legacy_table: 'collection_items', legacy_id: '11',
        target_table: 'v2_collection_items', target_id: 23,
    }),
];
const displayRows = Array.from({ length: 51 }, (_, index) => ({
    id: index + 1, collection_item_id: 23, collection_name: 'Test collection',
    component_name: 'Component #' + (index + 1), component_type: 'card',
}));
const globalRows = [...source, ...displayRows.map(({ id }) => definition(id, id === 1 ? notes : null))];

test('Admin component classification uses real Astro rendering and Access middleware', async t => {
    const auth = await accessFixture();
    let display = displayRows;
    let snapshot = globalRows;
    let totalRows: number | undefined;
    let failure: 'display' | 'evidence' | undefined;
    const reads: string[] = [];
    const db = {
        prepare(sql: string) {
            const statement = sql.trim();
            if (statement.startsWith('SELECT d.id,')) {
                assert.match(statement, /WHERE d.id > \?\s+ORDER BY d.id\s+LIMIT \?/);
                return { bind(after: number, limit: number) {
                    assert.equal(limit, 51);
                    return { async all() {
                        reads.push('display');
                        if (failure === 'display') throw new Error('synthetic list failure');
                        return { success: true, results: display.filter(row => row.id > after).slice(0, limit) };
                    } };
                } };
            }
            assert.match(statement, /^WITH evidence/);
            assert.match(statement, /FROM v2_component_definitions\s+UNION ALL/);
            assert.match(statement, /LIMIT 10001$/);
            assert.doesNotMatch(statement, /\?/);
            return { async all() {
                reads.push('evidence');
                if (failure === 'evidence') throw new Error('synthetic evidence failure');
                return {
                    success: true,
                    results: snapshot.map(row => ({ ...row, total_rows: totalRows ?? snapshot.length })),
                };
            } };
        },
    };

    try {
        const render = await dashboardPreview({ ...auth.bindings, DB: db, LOCAL_ADMIN_DEV: 'true' });
        const admin = await auth.token();
        const request = (query: string, token?: string) => render(new Request('http://localhost' + route + query, {
            headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
        }));
        const read = async (query = '', status = 200) => {
            reads.length = 0;
            const response = await request(query, admin);
            assert.equal(response.status, status);
            assert.equal(response.headers.get('Cache-Control'), 'no-store');
            return response.text();
        };

        await t.test('missing and non-admin JWTs are denied before any read', async () => {
            assert.equal((await request('')).status, 401);
            assert.equal((await request('', await auth.token({ email: 'other@example.test' }))).status, 403);
            assert.deepEqual(reads, []);
        });

        await t.test('admin gets bilingual classifications, reasons and a read-only list', async () => {
            for (const [query, legacy, unknown, reason] of [
                ['', '歷史商品來源', '待確認', '缺少歷史組件對照'],
                ['?lang=en', 'Legacy product source', 'Pending verification', 'Legacy component mapping is missing'],
            ]) {
                const html = await read(query);
                for (const text of [legacy, unknown, reason, 'Test collection (#23)', 'Component #1']) {
                    assert.ok(html.includes(text), text);
                }
                assert.match(html, /<code\b[^>]*>card<\/code>/);
                assert.doesNotMatch(html, /已確認實體組件|Confirmed physical component|<(button|form)\b/i);
                assert.deepEqual(reads, ['display', 'evidence']);
            }
        });

        await t.test('a claim from page two invalidates page one without narrowing the evidence read', async () => {
            snapshot = [...globalRows.slice(0, -1), definition(51, notes)];
            const first = await read('?lang=en');
            assert.match(first, /Multiple definitions claim the same legacy source[\s\S]*Multiple definitions claim the same legacy source/);
            assert.match(first, /lang=en(?:&amp;|&)after=50/);
            assert.doesNotMatch(first, /Legacy product source|Component #51/);
            assert.deepEqual(reads, ['display', 'evidence']);
            const next = await read('?lang=en&after=50');
            assert.match(next, /Component #51/);
            assert.doesNotMatch(next, /Component #1</);
            assert.deepEqual(reads, ['display', 'evidence']);
            snapshot = globalRows;
        });

        await t.test('empty data, invalid cursor and failed reads are distinct', async () => {
            display = [];
            assert.match(await read(), /此頁沒有組件定義/);
            assert.deepEqual(reads, ['display']);
            assert.match(await read('?after=-1', 400), /分頁參數無效/);
            assert.deepEqual(reads, []);
            failure = 'display';
            const html = await read('', 503);
            assert.match(html, /無法讀取組件定義/);
            assert.doesNotMatch(html, /此頁沒有組件定義/);
            display = displayRows;
            failure = 'evidence';
            const unavailable = await read();
            assert.match(unavailable, /分類證據無法驗證/);
            assert.match(unavailable, /待確認/);
            assert.doesNotMatch(unavailable, /此頁沒有組件定義|歷史商品來源|已確認實體組件/);
            failure = undefined;
        });

        await t.test('10,000 rows can classify, while overflow and truncated rows fail closed', async () => {
            const additional = Array.from({ length: 10_000 - globalRows.length }, (_, index) =>
                evidence('collection', { id: 100 + index }));
            snapshot = [...globalRows, ...additional];
            assert.match(await read(), /歷史商品來源/);
            snapshot = [...snapshot, evidence('collection', { id: 20_000 })];
            const overflow = await read();
            assert.match(overflow, /分類證據無法驗證/);
            assert.doesNotMatch(overflow, /歷史商品來源|已確認實體組件/);
            snapshot = globalRows;
            totalRows = snapshot.length + 1;
            const truncated = await read();
            assert.match(truncated, /待確認/);
            assert.doesNotMatch(truncated, /歷史商品來源|已確認實體組件/);
        });
    } finally {
        auth.restore();
    }
});
