import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { handleNotBggAdminRequest, type NotBggAdminBindings } from '../src/lib/notbgg-admin-api.ts';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';
import { handleNotBggLinkRequest } from '../src/lib/notbgg-link-api.ts';
import { NotBggRepository } from '../src/lib/notbgg-repository.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { isolatedNotBggD1, migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';

test('management write limiter: all write routes fail closed before DB access; auth/CSRF precede quota', async t => {
    const auth = await accessFixture(), local = await isolatedNotBggD1();
    try {
        await migrateIsolatedD1(local.db);
        const game = (await new NotBggRepository(local.db).create({ name: 'Synthetic limiter target', type: 'boardgame' },
            { actor: 'synthetic', idempotencyKey: 'limiter-target' })).game;
        const id = encodeURIComponent(game.notBggId), origin = 'https://limiter.example.test';
        const jwt = await auth.token(), timeline: string[] = [], keys: string[] = [];
        const db = new Proxy(local.db, { get(target, property) {
            const value = Reflect.get(target, property);
            if (property === 'prepare' || property === 'batch') return (...args: unknown[]) => {
                timeline.push('db'); return Reflect.apply(value, target, args);
            };
            return typeof value === 'function' ? value.bind(target) : value;
        } });
        type Limiter = NonNullable<NotBggAdminBindings['NOTBGG_WRITE_LIMITER']>;
        const allow: Limiter = { limit: async ({ key }) => { timeline.push('limit'); keys.push(key); return { success: true }; } };
        const routes = [
            { handler: handleNotBggAdminRequest, path: '/api/admin/notbgg', method: 'POST' },
            { handler: handleNotBggAdminRequest, path: '/api/admin/notbgg/' + id, method: 'PATCH' },
            { handler: handleNotBggAdminRequest, path: '/api/admin/notbgg/' + id + '/archive', method: 'POST' },
            { handler: handleCollectionAdminRequest, path: '/api/admin/collection?scope=test', method: 'POST' },
            { handler: handleCollectionAdminRequest, path: '/api/admin/collection/1?scope=test', method: 'PATCH' },
            { handler: handleCollectionAdminRequest, path: '/api/admin/collection/1/archive?scope=test', method: 'POST' },
            { handler: handleNotBggLinkRequest, path: '/api/admin/notbgg/' + id + '/link', method: 'POST' },
            { handler: handleCollectionAdminRequest, path: '/api/admin/notbgg/' + id + '/relations', method: 'POST' },
            { handler: handleCollectionAdminRequest, path: '/api/admin/notbgg/' + id + '/relations/1', method: 'POST' },
        ];
        function request(path: string, method: string, body: unknown = {}, token = jwt, extra: Record<string, string> = {}) {
            return new Request(origin + path, { method, headers: { 'Cf-Access-Jwt-Assertion': token, Origin: origin,
                'X-NotBGG-Request': '1', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...extra },
                ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
        }
        await t.test('missing/invalid binding, exception and malformed decisions reject every write route with zero DB calls', async () => {
            const modes = [undefined, {} as Limiter,
                { limit: async () => { throw new Error('PRIVATE_LIMITER_FAILURE'); } },
                { limit: async () => undefined } as unknown as Limiter,
                { limit: async () => ({ success: 'true' }) } as unknown as Limiter];
            for (const limiter of modes) for (const route of routes) {
                timeline.length = 0;
                const r = await route.handler(request(route.path, route.method), { ...auth.bindings, DB: db, NOTBGG_WRITE_LIMITER: limiter });
                assert.equal(r.status, 503, route.path);
                assert.equal(r.headers.get('Cache-Control'), 'no-store');
                assert.deepEqual(await r.json(), { success: false, error: { code: 'RATE_LIMITER_UNAVAILABLE' } });
                assert.deepEqual(timeline, [], 'no DB query or write before allowance');
            }
        });
        await t.test('over-limit decisions produce explicit 429/Retry-After and zero DB calls on every write route', async () => {
            for (const route of routes) {
                timeline.length = 0;
                const r = await route.handler(request(route.path, route.method), { ...auth.bindings, DB: db,
                    NOTBGG_WRITE_LIMITER: { limit: async () => { timeline.push('limit'); return { success: false }; } } });
                assert.equal(r.status, 429); assert.equal(r.headers.get('Retry-After'), '60');
                assert.deepEqual(await r.json(), { success: false, error: { code: 'RATE_LIMITED' } });
                assert.deepEqual(timeline, ['limit']);
            }
        });
        await t.test('unauthorized Access and failed CSRF do not consume quota or reach DB', async () => {
            const badSignature = await auth.token({ wrongKey: true });
            for (const route of routes) {
                for (const token of ['', badSignature]) {
                    timeline.length = 0;
                    const r = await route.handler(request(route.path, route.method, {}, token), { ...auth.bindings, DB: db, NOTBGG_WRITE_LIMITER: allow });
                    assert.equal(r.status, 401); assert.deepEqual(timeline, []);
                }
                for (const headers of [{ Origin: 'https://other.example.test' }, { 'X-NotBGG-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[]) {
                    timeline.length = 0;
                    const r = await route.handler(request(route.path, route.method, {}, jwt, headers), { ...auth.bindings, DB: db, NOTBGG_WRITE_LIMITER: allow });
                    assert.equal(r.status, 403); assert.deepEqual(timeline, []);
                }
            }
        });
        await t.test('allow decision permits normal profile, collection and D6 writes using the same hashed subject key', async () => {
            const payloads = [
                { ...routes[0], body: { name: 'Synthetic allowed profile', type: 'boardgame' }, status: 201 },
                { ...routes[3], body: { ref: { source: 'notbgg', notBggId: game.notBggId },
                    data: { displayName: 'Synthetic limited collection', acquisitionStatus: 'owned', wishlist: false }, createCopy: false }, status: 201 },
                { ...routes[6], body: { action: 'propose', bggId: 194655, expectedEventId: 0,
                    expectedProfileRevision: 1, reason: 'Synthetic limiter regression' }, status: 200 },
            ];
            for (const route of payloads) {
                timeline.length = 0;
                const r = await route.handler(request(route.path, route.method, route.body), { ...auth.bindings, DB: db, NOTBGG_WRITE_LIMITER: allow });
                assert.equal(r.status, route.status, await r.text());
                assert.equal(timeline[0], 'limit'); assert.ok(timeline.includes('db'));
            }
            assert.equal(keys.length, 3); assert.equal(new Set(keys).size, 1);
            assert.match(keys[0], /^[a-f0-9]{64}$/); assert.notEqual(keys[0], 'verified-admin-subject');
        });
        await t.test('authenticated GETs remain available without a limiter and never call one', async () => {
            for (const route of [routes[0], routes[3], routes[6]]) {
                const r = await route.handler(request(route.path, 'GET'), { ...auth.bindings, DB: db });
                assert.equal(r.status, 200);
            }
        });
        assert.deepEqual((await local.db.prepare('PRAGMA foreign_key_check').all()).results, []);
    } finally { auth.restore(); await local.dispose(); }
});

test('candidate 30/60 binding works with the installed local workerd limiter (not a global strict-quota claim)', async () => {
    const config = JSON.parse(await readFile('wrangler.json', 'utf8'));
    const binding = config.ratelimits.find((x: { name: string }) => x.name === 'NOTBGG_WRITE_LIMITER');
    assert.deepEqual(binding, { name: 'NOTBGG_WRITE_LIMITER', namespace_id: '12071', simple: { limit: 30, period: 60 } } as const);
    const bundle = await build({ stdin: { contents: `
        import {requireAdminWriteLimit,HttpError,response} from './src/lib/notbgg-admin-api.ts';
        export default {async fetch(request,env){try{await requireAdminWriteLimit(env,'synthetic-local-admin');return new Response(null,{status:204});}
        catch(e){if(e instanceof HttpError)return response(e.status,{error:{code:e.code}});throw e;}}};`, resolveDir: process.cwd() },
        bundle: true, write: false, format: 'esm', platform: 'browser' });
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
        ratelimits: { NOTBGG_WRITE_LIMITER: { namespace_id: binding.namespace_id, simple: binding.simple } },
        telemetry: { enabled: false }, outboundService: () => new Response('External access disabled', { status: 403 }) }));
    try {
        const statuses: number[] = [];
        for (let i = 0; i < 60; i++) {
            const r = await runtime.dispatchFetch('https://synthetic.invalid/'); statuses.push(r.status);
            assert.ok([204, 429].includes(r.status));
            if (r.status === 429) { assert.equal(r.headers.get('Retry-After'), '60'); break; }
        }
        assert.equal(statuses[0], 204); assert.ok(statuses.includes(429), 'local sequential binding eventually denied');
        // Cloudflare uses approximate per-location counters; no production/global exact bound is inferred here.
    } finally { await runtime.dispose(); }
});
