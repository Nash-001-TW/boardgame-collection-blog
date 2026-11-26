import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';
import { CollectionV2Repository } from '../src/lib/collection-v2-repository.ts';
import { getGames } from '../src/lib/games.ts';
import { handleNotBggLinkRequest } from '../src/lib/notbgg-link-api.ts';
import { NotBggLinkRepository } from '../src/lib/notbgg-link-repository.ts';
import { NotBggRepository } from '../src/lib/notbgg-repository.ts';
import { readPublicBggIndex } from '../src/lib/public-site-data.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { isolatedNotBggD1, migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';

test('synced BGG catalog in disposable D1 with all migrations', async t => {
    const local = await isolatedNotBggD1();
    t.after(() => local.dispose());
    const { db } = local;
    await migrateIsolatedD1(db);
    const catalog = new CollectionV2Repository(db).management;
    const links = new NotBggLinkRepository(db);
    const id = 980941;
    const ref = (bggId: number) => ({ source: 'bgg' as const, bggId });
    const ctx = { actor: 'fixture', scope: 'production' as const, idempotencyKey: 'catalog-create', createCopy: true };
    const input = { displayName: 'Fixture collection', acquisitionStatus: 'owned' };
    const cache = (bggId: number, name: string, gameType?: string) => JSON.stringify({ bggId, name, gameType });
    const insert = (bggId: number, json: string | null, success = true, status = 'success') =>
        db.prepare("INSERT INTO bgg_games(bgg_id,name,cache_json,last_success_at,sync_status) VALUES (?,'Different row name',?,?,?)")
            .bind(bggId, json, success ? '2026-11-26' : null, status).run();
    await insert(id, cache(id, '新作 Catalog Fixture', 'boardgameexpansion'));
    const lastSuccessfulName = 'Last successful sync fixture';
    await insert(id + 1, cache(id + 1, lastSuccessfulName, 'boardgame'));
    await db.prepare("UPDATE bgg_games SET sync_status='failed' WHERE bgg_id=?").bind(id + 1).run();
    await insert(id + 2, cache(id + 2, 'Invalid catalog', 'boardgame'), false, 'failed');
    await insert(id + 3, '{"name":"Invalid catalog"', true);
    await insert(id + 4, cache(id + 4, 'Invalid catalog'));
    await insert(id + 5, null);
    await insert(id + 6, cache(id + 7, 'Invalid catalog', 'boardgame'));
    const original = (await new NotBggRepository(db).create({ name: 'Fixture profile', type: 'boardgameexpansion' },
        { actor: 'fixture', idempotencyKey: 'catalog-profile' })).game;

    await t.test('name and both ID forms resolve the cache and preserve cached metadata', async () => {
        for (const query of ['新作', 'CATALOG fixture', 'BGG:' + id, '#' + id]) {
            assert.deepEqual(await catalog.search(query), [
                { ref: ref(id), name: '新作 Catalog Fixture', type: 'boardgameexpansion', synced: true },
            ]);
        }
        assert.deepEqual(await catalog.search('Different row name'), []);
    });

    await t.test('the last successful cache stays searchable and usable after a failed sync', async () => {
        const name = lastSuccessfulName;
        const bggRef = ref(id + 1);
        const expected = [{ ref: bggRef, name, type: 'boardgame', synced: true }];
        assert.deepEqual(await catalog.search(name), expected);
        assert.deepEqual(await catalog.search('BGG:' + (id + 1)), expected);
        const created = await catalog.create(bggRef, input, { ...ctx, idempotencyKey: 'catalog-last-success' });
        assert.equal(created.replayed, false);
        const metadata = await db.prepare('SELECT primary_name,game_type FROM v2_games WHERE bgg_id=?').bind(id + 1).first();
        assert.deepEqual(metadata, { primary_name: name, game_type: 'base' });
    });

    await t.test('never-successful and invalid caches are ineligible', async () => {
        assert.deepEqual(await catalog.search('Invalid catalog'), []);
        for (let invalidId = id + 2; invalidId <= id + 6; invalidId++) {
            assert.deepEqual(await catalog.search('BGG:' + invalidId), []);
            await assert.rejects(catalog.create(ref(invalidId), input, ctx), { message: 'INVALID_REFERENCE' });
            await assert.rejects(links.comparison(original.notBggId, invalidId), { message: 'TARGET_NOT_FOUND' });
        }
    });

    await t.test('search deduplicates BGG IDs and keeps NotBGG results after the BGG cap', async () => {
        const staticGame = getGames().find(game => game.bgg)!;
        await insert(staticGame.bggId, cache(staticGame.bggId, 'Synced duplicate', 'boardgame'));
        assert.deepEqual(await catalog.search('BGG:' + staticGame.bggId), [
            { ref: ref(staticGame.bggId), name: 'Synced duplicate', type: 'boardgame', synced: true },
        ]);
        for (let offset = 10; offset < 35; offset++) {
            await insert(id + offset, cache(id + offset, 'Limit fixture', 'boardgame'));
        }
        const profile = (await new NotBggRepository(db).create({ name: 'Limit fixture NotBGG', type: 'boardgame' },
            { actor: 'fixture', idempotencyKey: 'catalog-limit-profile' })).game;
        const matches = await catalog.search('Limit fixture');
        assert.equal(matches.filter(game => game.ref.source === 'bgg').length, 20);
        assert.deepEqual(matches.slice(20), [
            { ref: { source: 'notbgg', notBggId: profile.notBggId }, name: profile.name, type: profile.type },
        ]);
        assert.equal((await catalog.search('')).filter(game => game.ref.source === 'bgg').length, 20);
    });

    await t.test('create uses cache metadata, creates a copy, replays and qualifies for the public index', async () => {
        assert.ok(!(await readPublicBggIndex(db)).includes(id));
        const created = await catalog.create(ref(id), input, ctx);
        assert.equal(created.replayed, false);
        const metadata = await db.prepare('SELECT primary_name,game_type FROM v2_games WHERE bgg_id=?').bind(id).first();
        assert.deepEqual(metadata, { primary_name: '新作 Catalog Fixture', game_type: 'expansion' });
        assert.equal((await catalog.detail(created.collectionId, ctx.scope))?.copies.length, 1);
        assert.deepEqual(await catalog.create(ref(id), input, ctx), { collectionId: created.collectionId, replayed: true });
        assert.equal((await catalog.detail(created.collectionId, ctx.scope))?.copies.length, 1);
        assert.ok((await readPublicBggIndex(db)).includes(id));
    });

    await t.test('NotBGG can compare, propose, confirm and make a synced game primary', async () => {
        const compare = await links.comparison(original.notBggId, id);
        assert.equal(compare.compatible, true);
        assert.deepEqual(compare.bgg.ref, ref(id));
        const context = { expectedProfileRevision: original.revision, reason: 'Fixture review' };
        const proposed = await links.execute(original.notBggId, { ...context, expectedEventId: 0, action: 'propose', bggId: id }, 'fixture');
        assert.equal(proposed.state, 'candidate');
        const confirmed = await links.execute(original.notBggId, { ...context, expectedEventId: proposed.expectedEventId,
            action: 'confirm', linkId: proposed.link!.id }, 'fixture');
        assert.equal(confirmed.state, 'linked');
        assert.equal((await links.execute(original.notBggId, { ...context, expectedEventId: confirmed.expectedEventId,
            action: 'primary', linkId: confirmed.link!.id, primarySource: 'bgg' }, 'fixture')).link?.primary_source, 'bgg');
    });

    await t.test('D1 catalog read failures return 503 through existing API handlers', async () => {
        const auth = await accessFixture();
        try {
            const origin = 'https://example.test';
            const headers = { 'Cf-Access-Jwt-Assertion': await auth.token() };
            const broken = { prepare(sql: string) {
                if (sql.includes('FROM bgg_games')) throw new Error('Fixture D1 failure');
                return db.prepare(sql);
            } } as D1Database;
            const bindings = { ...auth.bindings, DB: broken, NOTBGG_WRITE_LIMITER: { limit: async () => ({ success: true }) } };
            const search = await handleCollectionAdminRequest(new Request(origin + '/api/admin/collection/search?q=fixture', { headers }), bindings);
            const create = await handleCollectionAdminRequest(new Request(origin + '/api/admin/collection', {
                method: 'POST',
                headers: { ...headers, Origin: origin, 'Content-Type': 'application/json', 'X-NotBGG-Request': '1',
                    'Idempotency-Key': 'fixture-d1-unavailable' },
                body: JSON.stringify({ ref: ref(id), data: input, createCopy: true }),
            }), bindings);
            const compare = await handleNotBggLinkRequest(new Request(origin + '/api/admin/notbgg/'
                + original.notBggId + '/link/compare?bggId=' + id, { headers }), bindings);
            for (const response of [search, create, compare]) {
                assert.equal(response.status, 503);
                assert.deepEqual(await response.json(), { success: false, error: { code: 'DATABASE_UNAVAILABLE' } });
            }
        } finally {
            auth.restore();
        }
    });
});
