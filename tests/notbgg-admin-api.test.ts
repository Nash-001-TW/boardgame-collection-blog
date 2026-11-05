import test from 'node:test';
import assert from 'node:assert/strict';
import { handleNotBggAdminRequest, adminRequestLimits } from '../src/lib/notbgg-admin-api.ts';
import { isNotBggAdminPath, authorizeAdminRequest } from '../src/lib/auth/admin-request.ts';
import { isolatedNotBggD1, migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';

test('NotBGG admin security/API with signed JWTs and isolated D1', async t => {
    const fixture = await accessFixture(), local = await isolatedNotBggD1();
    try {
        await migrateIsolatedD1(local.db);
        const jwt = await fixture.token(), bindings = { ...fixture.bindings, DB: local.db,
            NOTBGG_WRITE_LIMITER: { limit: async () => ({ success: true }) } };
        const origin = 'http://notbgg.test', base = '/api/admin/notbgg';
        function request(path = '', method = 'GET', body?: unknown, headers: Record<string, string> = {}, raw = false) {
            return new Request(origin + base + path, { method, headers: { 'Cf-Access-Jwt-Assertion': jwt,
                ...(method !== 'GET' ? { Origin: origin, 'Content-Type': 'application/json', 'X-NotBGG-Request': '1', 'Idempotency-Key': 'synthetic-request' } : {}), ...headers },
                body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body) });
        }
        type JsonResponse = Omit<Response, 'json'> & { json(): Promise<any> };
        const call = (path = '', method = 'GET', body?: unknown, headers?: Record<string, string>, raw = false) => handleNotBggAdminRequest(request(path, method, body, headers, raw), bindings) as Promise<JsonResponse>;
        const count = async () => (await local.db.prepare('SELECT count(*) AS count FROM notbgg_games').first<{ count: number }>())!.count;
        let id = '', revision = 1;
        await t.test('admin pages/API paths are protected; no login/fake headers/token cannot read or write', async () => {
            assert.ok(isNotBggAdminPath('/admin/notbgg/new')); assert.ok(isNotBggAdminPath('/api/admin/notbgg/NotBGG%3A000001/history'));
            assert.ok(!isNotBggAdminPath('/games')); assert.ok(!isNotBggAdminPath('/admin/notbgg-other'));
            for (const value of ['', 'fake.jwt.token']) {
                for (const [path, method, body] of [['', 'GET', undefined], ['', 'POST', { name: 'X', type: 'boardgame' }], ['/NotBGG%3A000001', 'PATCH', {}], ['/NotBGG%3A000001/archive', 'POST', {}]] as const) {
                    assert.equal((await call(path, method, body, { 'Cf-Access-Jwt-Assertion': value, 'Cf-Access-Authenticated-User-Email': 'admin@example.test', actor: 'admin' })).status, 401);
                }
            }
            assert.equal(await count(), 0);
        });
        await t.test('real signature, issuer, audience, expiry and required expiry claim are verified', async () => {
            for (const options of [{ wrongKey: true }, { issuer: 'https://other.cloudflareaccess.com' }, { audience: 'wrong' }, { exp: Math.floor(Date.now() / 1000) - 60 }, { exp: null }]) {
                assert.equal((await call('', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await fixture.token(options) })).status, 401);
            }
            assert.equal((await call('', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await fixture.token({ email: 'other@example.test' }) })).status, 403);
            const missing = await authorizeAdminRequest(request(), { ...bindings, ACCESS_AUD: '' }); assert.deepEqual(missing, { status: 403 });
        });
        await t.test('CSRF: missing/cross Origin, missing custom header and cross-site Fetch Metadata are rejected', async () => {
            for (const headers of [{ Origin: '' }, { Origin: 'https://evil.test' }, { 'X-NotBGG-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string,string>[]) {
                assert.equal((await call('', 'POST', { name: 'CSRF', type: 'boardgame' }, headers)).status, 403);
            }
            assert.equal(await count(), 0);
        });
        await t.test('content type, malformed JSON, declared/streamed body limits, depth and field count', async () => {
            assert.equal((await call('', 'POST', {}, { 'Content-Type': 'text/plain' })).status, 415);
            assert.equal((await call('', 'POST', '{broken', {}, true)).status, 400);
            assert.equal((await call('', 'POST', {}, { 'Content-Length': String(adminRequestLimits.bytes + 1) })).status, 413);
            assert.equal((await call('', 'POST', 'X'.repeat(adminRequestLimits.bytes + 1), {}, true)).status, 413);
            assert.equal((await call('', 'POST', Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['field' + i, null])))).status, 400);
            assert.equal((await call('', 'POST', { nested: [[[[[[[[[[1]]]]]]]]]] })).status, 400);
        });
        await t.test('invalid fields, missing name, numeric bounds, required accessory categories and fake system fields rejected', async () => {
            for (const input of [{ type: 'boardgame' }, { name: 'X', type: 'boardgame', minPlayers: 4, maxPlayers: 2 },
                { name: 'X', type: 'boardgameaccessory', accessoryCategories: [] }, { name: 'X', type: 'boardgameaccessory', minPlayers: 2, accessoryCategories: ['promo'] }]) {
                assert.equal((await call('', 'POST', input)).status, 400);
            }
            for (const key of ['actor', 'email', 'notBggId', 'source', 'createdAt', 'revision', 'linkedBggId', 'primarySource']) {
                assert.equal((await call('', 'POST', { name: 'X', type: 'boardgame', [key]: 'fake' })).status, 400);
            }
            assert.equal(await count(), 0);
        });
        await t.test('create assigns ID and trusted actor; same request replays; administrator/private and public fields separate', async () => {
            const body = { name: 'Private source', type: 'boardgame', editorNotes: 'PRIVATE-ADMIN-NOTE' };
            const created = await call('', 'POST', body); assert.equal(created.status, 201);
            const data = (await created.json()).data; id = data.admin.notBggId;
            assert.equal(id, 'NotBGG:000001'); assert.equal(data.admin.editorNotes, 'PRIVATE-ADMIN-NOTE');
            assert.ok(!JSON.stringify(data.public).includes('PRIVATE-ADMIN-NOTE')); assert.ok(!('editorNotes' in data.public));
            assert.equal((await call('', 'POST', body)).status, 200); assert.equal(await count(), 1);
            assert.equal((await call('', 'POST', { ...body, name: 'Different' })).status, 409);
            const hist = await call('/' + encodeURIComponent(id) + '/history');
            assert.equal((await hist.json()).data.items[0].actor, 'verified-admin-subject');
            assert.equal(created.headers.get('Cache-Control'), 'no-store');
        });
        await t.test('edit uses expected revision; conflicts retain original state and do not create a fake revision', async () => {
            const path = '/' + encodeURIComponent(id);
            assert.equal((await call(path, 'PATCH', { changes: { name: 'No revision' } })).status, 400);
            assert.equal((await call(path, 'PATCH', { expectedRevision: 1, changes: { name: 'Edited' } })).status, 200); revision = 2;
            assert.equal((await call(path, 'PATCH', { expectedRevision: 1, changes: { name: 'Stale' } })).status, 409);
            assert.equal((await call(path, 'PATCH', { expectedRevision: 2, changes: { actor: 'fake' } })).status, 400);
            assert.equal((await (await call(path)).json()).data.admin.name, 'Edited');
            const history = (await (await call(path + '/history?limit=1')).json()).data;
            assert.equal(history.items.length, 1); assert.equal(history.nextRevision, 1);
            assert.equal((await (await call(path + '/history?afterRevision=1')).json()).data.items[0].operation, 'update');
        });
        await t.test('accessory references resolve through Repository; unknown BGG/NotBGG do not create fake games', async () => {
            for (const ref of [{ source: 'bgg', bggId: 205637 }, { source: 'notbgg', notBggId: 'NotBGG:888888' }]) {
                const rejected = await call('', 'POST', { name: 'Kit', type: 'boardgameaccessory', accessoryCategories: ['promo'], relatedGameIds: [ref] }, { 'Idempotency-Key': 'related-bad' });
                assert.equal(rejected.status, 400); assert.equal((await rejected.json()).error.code, 'INVALID_REFERENCE');
            }
            const created = await call('', 'POST', { name: 'Valid kit', type: 'boardgameaccessory', accessoryCategories: ['promo', 'storage'], relatedGameIds: [{ source: 'notbgg', notBggId: id }] }, { 'Idempotency-Key': 'related-valid' });
            assert.equal(created.status, 201); const kit = (await created.json()).data.admin;
            assert.equal(kit.relatedGameIds.length, 1); assert.equal(kit.accessoryCategories.length, 2);
            assert.equal((await call('/' + encodeURIComponent(kit.notBggId), 'PATCH', { expectedRevision: 1, changes: { relatedGameIds: [{ source: 'notbgg', notBggId: kit.notBggId }] } })).status, 400);
        });
        await t.test('list search/ID/pagination are bounded, archived rows explicit, list omits private notes', async () => {
            const firstPage = (await (await call('?limit=1')).json()).data; assert.equal(firstPage.items.length, 1); assert.ok(firstPage.nextCursor);
            assert.ok(!JSON.stringify(firstPage).includes('PRIVATE-ADMIN-NOTE'));
            assert.equal((await (await call('?q=' + encodeURIComponent(id))).json()).data.items[0].notBggId, id);
            assert.equal((await (await call('?q=Edited')).json()).data.items.length, 1);
            assert.equal((await call('?limit=10000')).status, 400);
            assert.equal((await call('?includeArchived=not-boolean')).status, 400);
            assert.equal((await (await call('?limit=1&after=' + encodeURIComponent(firstPage.nextCursor))).json()).data.items.length, 1);
        });
        await t.test('archive retains ID and read-only history; anonymous/history remains forbidden', async () => {
            const path = '/' + encodeURIComponent(id);
            assert.equal((await call(path + '/archive', 'POST', { expectedRevision: revision })).status, 200);
            const history = (await (await call(path + '/history')).json()).data.items;
            assert.deepEqual(history.map((row: any) => row.operation), ['create', 'update', 'archive']);
            assert.equal((await (await call(path)).json()).data.admin.notBggId, id);
            assert.equal((await call(path, 'PATCH', { expectedRevision: 3, changes: { name: 'Reopen' } })).status, 409);
            assert.equal((await call(path + '/history', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': '' })).status, 401);
            assert.equal((await (await call('?q=' + encodeURIComponent(id))).json()).data.items.length, 0);
            assert.equal((await (await call('?includeArchived=true&q=' + encodeURIComponent(id))).json()).data.items.length, 1);
        });
        await t.test('404/405/503/429/500 are distinct and never leak internal SQL or credentials', async () => {
            assert.equal((await call('/NotBGG%3A888888')).status, 404); assert.equal((await call('/NotBGG%3A1')).status, 400);
            assert.equal((await call('', 'DELETE')).status, 405);
            assert.equal((await handleNotBggAdminRequest(request(), fixture.bindings)).status, 503);
            const limited = await handleNotBggAdminRequest(request('', 'POST', {}), { ...bindings, NOTBGG_WRITE_LIMITER: { limit: async () => ({ success: false }) } });
            assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
            const broken = { prepare: () => { throw new Error('SECRET_SQL_TABLE_AND_TOKEN'); } } as unknown as D1Database;
            const failed = await handleNotBggAdminRequest(request(), { ...bindings, DB: broken });
            assert.equal(failed.status, 500); assert.ok(!(await failed.text()).includes('SECRET_SQL'));
        });
    } finally { await local.dispose(); fixture.restore(); }
});
