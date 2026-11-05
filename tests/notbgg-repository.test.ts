import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isolatedNotBggD1, migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';
import { NotBggRepository, NotBggRepositoryError } from '../src/lib/notbgg-repository.ts';
import { formatNotBggId } from '../src/lib/game-identity.ts';
import { NotBggValidationError } from '../src/lib/notbgg-validation.ts';

const actor = 'synthetic-admin';
const ctx = (idempotencyKey: string) => ({ actor, idempotencyKey });
const edit = (expectedRevision: number) => ({ actor, expectedRevision });
const conflict = (code: string) => (error: unknown) => error instanceof NotBggRepositoryError && error.code === code;

test('NotBGG repository: real isolated local D1, never Wrangler/remote bindings', async t => {
    const hash = () => readFile('src/data/bgg-cache.json').then(data => createHash('sha256').update(data).digest('hex'));
    const beforeHash = await hash();
    const local = await isolatedNotBggD1(), db = local.db, repo = new NotBggRepository(db);
    const scalar = async (sql: string) => Number(Object.values((await db.prepare(sql).first())!)[0]);
    let first: Awaited<ReturnType<typeof repo.create>>['game'];
    let second: typeof first;
    try {
        await t.test('all existing migrations plus 0014 apply to a brand-new D1; V2 schema and foreign keys survive', async () => {
            assert.equal(await scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='v2_games'"), 0);
            const baseline = await migrateIsolatedD1(db);
            const existingNames=new Set(baseline.v2Before.map(row=>row.name));
            assert.deepEqual((await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'v2_%' ORDER BY name").all<{name:string;sql:string}>()).results.filter(row=>existingNames.has(row.name)), baseline.v2Before);
            for (const table of ['v2_games', 'v2_collection_items', 'v2_owned_copies', 'v2_sleeve_requirements', 'notbgg_ids', 'notbgg_games', 'notbgg_game_revisions', 'site_game_relations', 'notbgg_bgg_links', 'notbgg_link_events']) {
                assert.ok(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first());
            }
            assert.equal(await scalar('PRAGMA foreign_keys'), 1);
            await assert.rejects(db.prepare("INSERT INTO notbgg_accessory_categories(seq,category) VALUES (999,'promo')").run());
            await assert.rejects(db.prepare("INSERT INTO notbgg_link_events(link_id,action,actor,state_json) VALUES (999999,'proposed','test','{}')").run(), /FOREIGN KEY/);
        });
        await t.test('first two NotBGG identities start at 1 regardless of existing V2 internal IDs; full fields round trip', async () => {
            first = (await repo.create({ name: ' First ', type: 'boardgame', minPlayers: 1, maxPlayers: 4, minPlaytime: 10, maxPlaytime: 30,
                recommendedPlayers: [2], designers: ['Designer'], artists: ['Artist'], publishers: ['Publisher'], alternateNames: ['Alias'],
                categories: ['My category'], mechanics: ['My mechanic'], families: ['Family'], description: 'Text', minAge: 8,
                yearPublished: 1700, imageUrl: 'https://example.com/cover', thumbnailUrl: 'https://example.com/thumb', referenceUrls: ['https://example.com/ref'], editorNotes: 'Private' }, ctx('first'))).game;
            second = (await repo.create({ name: 'Second', type: 'boardgameexpansion' }, ctx('second'))).game;
            assert.equal(first.notBggId, 'NotBGG:000001'); assert.equal(second.notBggId, 'NotBGG:000002');
            assert.equal(first.yearPublished, 1700); assert.deepEqual(first.mechanics, ['My mechanic']); assert.equal(first.revision, 1);
            assert.deepEqual(await repo.getByInternalGameId(first.gameId), first);
            const history = await repo.getRevisionHistory(first.notBggId);
            assert.equal(history.length, 1); assert.equal(history[0].actor, actor); assert.equal(history[0].snapshot.gameId, first.gameId);
            assert.equal(history[0].snapshot.editorNotes, 'Private');
        });
        await t.test('same key and normalized content replay; different content conflicts without extra game/revision', async () => {
            const input = { name: 'Idempotent', type: 'boardgame' as const };
            const a = await repo.create(input, ctx('repeat')), b = await repo.create({ ...input, name: ' Idempotent ' }, ctx('repeat'));
            assert.equal(a.replayed, false); assert.equal(b.replayed, true); assert.equal(a.game.notBggId, b.game.notBggId);
            await assert.rejects(repo.create({ ...input, name: 'Changed' }, ctx('repeat')), conflict('IDEMPOTENCY_CONFLICT'));
            assert.equal((await repo.getRevisionHistory(a.game.notBggId)).length, 1);
        });
        await t.test('ACTUAL concurrent distinct requests: 24 overlapping D1-backed creates, no duplicate IDs/internal IDs', async () => {
            const results = await Promise.all(Array.from({ length: 24 }, (_, i) => repo.create({ name: `Concurrent ${i}`, type: 'boardgame' }, ctx(`parallel-${i}`))));
            assert.equal(new Set(results.map(r => r.game.notBggId)).size, 24);
            assert.equal(new Set(results.map(r => r.game.gameId)).size, 24);
            assert.ok(results.every(r => r.game.revision === 1));
        });
        await t.test('ACTUAL concurrent identical key: 12 overlapping creates commit exactly one profile and first revision', async () => {
            const results = await Promise.all(Array.from({ length: 12 }, () => repo.create({ name: 'Same request', type: 'boardgame' }, ctx('parallel-same'))));
            assert.equal(new Set(results.map(r => r.game.notBggId)).size, 1);
            assert.equal(results.filter(r => !r.replayed).length, 1);
            assert.equal((await repo.getRevisionHistory(results[0].game.notBggId)).length, 1);
        });
        await t.test('ACTUAL concurrent same key/different payload: exactly one winner', async () => {
            const outcomes = await Promise.allSettled(['A', 'B'].map(name => repo.create({ name, type: 'boardgame' }, ctx('race-conflict'))));
            assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
            const rejected = outcomes.find(r => r.status === 'rejected') as PromiseRejectedResult;
            assert.ok(conflict('IDEMPOTENCY_CONFLICT')(rejected.reason));
        });
        await t.test('injected first-revision failure rolls back V2/profile; only an inactive immutable reservation remains; retry succeeds', async () => {
            const games = await scalar('SELECT count(*) FROM v2_games'), profiles = await scalar('SELECT count(*) FROM notbgg_games');
            await db.prepare("CREATE TRIGGER test_fail_create BEFORE INSERT ON notbgg_game_revisions WHEN json_extract(NEW.snapshot_json,'$.name')='Fail create' BEGIN SELECT RAISE(ABORT,'INJECTED'); END").run();
            await assert.rejects(repo.create({ name: 'Fail create', type: 'boardgame' }, ctx('failed')), conflict('STORAGE'));
            const reservation = (await db.prepare("SELECT seq FROM notbgg_ids WHERE request_key='failed'").first<{ seq: number }>())!;
            assert.equal(await repo.getByNotBggId(formatNotBggId(reservation.seq)), null);
            assert.equal(await scalar('SELECT count(*) FROM v2_games'), games); assert.equal(await scalar('SELECT count(*) FROM notbgg_games'), profiles);
            await assert.rejects(db.prepare('DELETE FROM notbgg_ids WHERE seq=?').bind(reservation.seq).run());
            await db.prepare('DROP TRIGGER test_fail_create').run();
            const retried = await repo.create({ name: 'Fail create', type: 'boardgame' }, ctx('failed'));
            assert.equal(retried.game.notBggId, formatNotBggId(reservation.seq));
        });
        await t.test('failure after first revision and category writes rolls back ALL game/child/history rows', async () => {
            const profiles = await scalar('SELECT count(*) FROM notbgg_games'), revisions = await scalar('SELECT count(*) FROM notbgg_game_revisions');
            await assert.rejects(repo.create({ name: 'Missing target', type: 'boardgameaccessory', accessoryCategories: ['promo'],
                relatedGameIds: [{ source: 'notbgg', notBggId: formatNotBggId(888888) }] }, ctx('bad-target')), conflict('STORAGE'));
            assert.equal(await scalar('SELECT count(*) FROM notbgg_games'), profiles); assert.equal(await scalar('SELECT count(*) FROM notbgg_game_revisions'), revisions);
            assert.equal(await scalar("SELECT count(*) FROM notbgg_accessory_categories c JOIN notbgg_ids i ON i.seq=c.seq WHERE i.request_key='bad-target'"), 0);
        });
        await t.test('deferred D1 foreign key forbids committing a profile without its initial revision even through direct SQL', async () => {
            const reservation = await db.prepare("INSERT INTO notbgg_ids(request_key,request_hash) VALUES ('no-revision','test') RETURNING seq").first<{ seq: number }>();
            const count = await scalar('SELECT count(*) FROM v2_games');
            await assert.rejects(db.batch([
                db.prepare("INSERT INTO v2_games(primary_name,catalog_source) VALUES ('Incomplete','manual')"),
                db.prepare("INSERT INTO notbgg_games(seq,game_id,name,type) VALUES (?,last_insert_rowid(),'Incomplete','boardgame')").bind(reservation!.seq)
            ])); // This Miniflare version reports deferred commit violations as a generic internal error.
            // Verify rollback and connection health instead of depending on that error string.
            assert.equal(await scalar('SELECT count(*) FROM v2_games'), count);
            assert.equal(await repo.getByNotBggId(formatNotBggId(reservation!.seq)), null);
        });
        await t.test('successful edit stores complete immutable snapshot and V2 mirror; stale revision cannot overwrite', async () => {
            const changed = await repo.update(first.notBggId, { name: 'Edited', minPlayers: 2 }, edit(1));
            assert.equal(changed.revision, 2); assert.equal(changed.createdAt, first.createdAt); assert.equal(changed.gameId, first.gameId);
            assert.equal(changed.notBggId, first.notBggId); assert.equal(changed.minPlayers, 2);
            await assert.rejects(repo.update(first.notBggId, { name: 'Stale' }, edit(1)), conflict('CONFLICT'));
            const history = await repo.getRevisionHistory(first.notBggId);
            assert.deepEqual(history.map(r => r.revision), [1, 2]); assert.equal(history[0].snapshot.name, 'First'); assert.equal(history[1].snapshot.name, 'Edited');
            assert.equal((await db.prepare('SELECT primary_name FROM v2_games WHERE id=?').bind(first.gameId).first<{ primary_name: string }>())!.primary_name, 'Edited');
        });
        await t.test('ACTUAL concurrent expected-revision updates: one winner, one conflict, no fake revision', async () => {
            const outcomes = await Promise.allSettled(['Racer A', 'Racer B'].map(name => repo.update(first.notBggId, { name }, edit(2))));
            assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
            assert.ok(conflict('CONFLICT')((outcomes.find(r => r.status === 'rejected') as PromiseRejectedResult).reason));
            assert.deepEqual((await repo.getRevisionHistory(first.notBggId)).map(r => r.revision), [1, 2, 3]);
        });
        await t.test('accessory joins round trip; duplicates/official source and invalid type changes are rejected', async () => {
            const kit = (await repo.create({ name: 'Kit', type: 'boardgameaccessory', accessoryCategories: ['storage', 'promo'],
                relatedGameIds: [{ source: 'notbgg', notBggId: first.notBggId }] }, ctx('kit'))).game;
            assert.equal(kit.relatedGameIds.length, 1);
            await assert.rejects(db.prepare("INSERT INTO notbgg_accessory_categories(seq,category) VALUES (?, 'promo')").bind(Number(kit.notBggId.slice(7))).run());
            await assert.rejects(db.prepare("INSERT INTO site_game_relations(source_game_id,target_game_id,relation_source,created_by) VALUES (?,?,'bgg','test')").bind(kit.gameId, first.gameId).run());
            await assert.rejects(repo.update(kit.notBggId, { type: 'boardgame' }, edit(1)), NotBggValidationError);
            const next = await repo.update(kit.notBggId, { type: 'boardgame', accessoryCategories: [], relatedGameIds: [], contents: null }, edit(1));
            assert.equal(next.type, 'boardgame'); assert.deepEqual(next.relatedGameIds, []);
            assert.equal(await scalar(`SELECT count(*) FROM site_game_relations WHERE source_game_id=${kit.gameId} AND archived_at IS NOT NULL`), 1);
            assert.equal((await repo.getRevisionHistory(kit.notBggId))[0].snapshot.relatedGameIds.length, 1);
        });
        await t.test('late edit failure rolls back inserted revision, child removals and V2 mirror', async () => {
            const kit = (await repo.create({ name: 'Rollback kit', type: 'boardgameaccessory', accessoryCategories: ['tokens'] }, ctx('rollback-kit'))).game;
            await assert.rejects(repo.update(kit.notBggId, { name: 'Should roll back', accessoryCategories: ['promo'], relatedGameIds: [{ source: 'bgg', bggId: 999999 }] }, edit(1)), conflict('STORAGE'));
            assert.deepEqual(await repo.getByNotBggId(kit.notBggId), kit); assert.equal((await repo.getRevisionHistory(kit.notBggId)).length, 1);
        });
        await t.test('system identity, creation time and linking state cannot be edited, including direct SQL identity changes', async () => {
            for (const key of ['notBggId', 'createdAt', 'source', 'revision', 'linkedBggId', 'linkStatus', 'primarySource']) {
                await assert.rejects(repo.update(second.notBggId, { [key]: 1 }, edit(1)), NotBggValidationError);
            }
            await assert.rejects(db.prepare("UPDATE notbgg_games SET seq=12345,revision=2 WHERE game_id=?").bind(second.gameId).run());
            await assert.rejects(db.prepare('UPDATE v2_games SET bgg_id=123 WHERE id=?').bind(second.gameId).run());
            await assert.rejects(db.prepare('DELETE FROM notbgg_games WHERE game_id=?').bind(second.gameId).run());
            await assert.rejects(db.prepare('DELETE FROM notbgg_game_revisions WHERE seq=?').bind(Number(second.notBggId.slice(7))).run());
        });
        await t.test('archive retains collection/copy references and immutable history; subsequent create never reuses the ID', async () => {
            const item = await db.prepare("INSERT INTO v2_collection_items(game_id,display_name) VALUES (?,'synthetic collection') RETURNING id").bind(second.gameId).first<{ id: number }>();
            await db.prepare("INSERT INTO v2_owned_copies(collection_item_id,language_code) VALUES (?,'zh-TW')").bind(item!.id).run();
            const archived = await repo.archive(second.notBggId, edit(1)); assert.ok(archived.archivedAt); assert.equal(archived.revision, 2);
            assert.equal((await repo.getRevisionHistory(second.notBggId)).length, 2);
            assert.equal((await db.prepare('SELECT game_id FROM v2_collection_items WHERE id=?').bind(item!.id).first<{ game_id: number }>())!.game_id, second.gameId);
            assert.equal(await scalar(`SELECT count(*) FROM v2_owned_copies WHERE collection_item_id=${item!.id}`), 1);
            await assert.rejects(repo.update(second.notBggId, { name: 'No' }, edit(2)), conflict('ARCHIVED'));
            const fresh = await repo.create({ name: 'After archive', type: 'boardgame' }, ctx('after-archive'));
            assert.ok(Number(fresh.game.notBggId.slice(7)) > Number(second.notBggId.slice(7)));
            const page = await repo.list({ limit: 2 }); assert.ok(page.nextCursor); assert.equal(page.items.length, 2);
            const next = await repo.list({ limit: 2, after: page.nextCursor! });
            assert.ok(!next.items.some(game => page.items.some(previous => previous.notBggId === game.notBggId)));
            assert.ok(!(await repo.list({ limit: 100 })).items.some(g => g.notBggId === second.notBggId));
            assert.ok((await repo.list({ limit: 100, includeArchived: true })).items.some(g => g.notBggId === second.notBggId));
        });
        await t.test('archive failure rolls back its revision; replaying an archived creation key does not reactivate or reallocate', async () => {
            const game = (await repo.create({ name: 'Archive failure', type: 'boardgame' }, ctx('archive-fail'))).game;
            await db.prepare("CREATE TRIGGER test_fail_archive BEFORE UPDATE ON notbgg_games WHEN NEW.archived_at IS NOT NULL AND NEW.name='Archive failure' BEGIN SELECT RAISE(ABORT,'INJECTED'); END").run();
            await assert.rejects(repo.archive(game.notBggId, edit(1)), conflict('STORAGE'));
            assert.deepEqual(await repo.getByNotBggId(game.notBggId), game);
            assert.equal((await repo.getRevisionHistory(game.notBggId)).length, 1);
            await db.prepare('DROP TRIGGER test_fail_archive').run();
            await repo.archive(game.notBggId, edit(1));
            const replay = await repo.create({ name: 'Archive failure', type: 'boardgame' }, ctx('archive-fail'));
            assert.ok(replay.replayed); assert.ok(replay.game.archivedAt); assert.equal(replay.game.notBggId, game.notBggId);
        });
        await t.test('mapping candidates do not merge; active mappings are one-to-one, reversible and do not overwrite source', async () => {
            const a = (await repo.create({ name: 'Link A', type: 'boardgame' }, ctx('link-a'))).game;
            const b = (await repo.create({ name: 'Link B', type: 'boardgame' }, ctx('link-b'))).game;
            const target = await db.prepare("INSERT INTO v2_games(bgg_id,primary_name,catalog_source) VALUES (205637,'Synthetic BGG target','bgg') RETURNING id").first<{ id: number }>();
            const seqA = Number(a.notBggId.slice(7)), seqB = Number(b.notBggId.slice(7));
            const link = await db.prepare("INSERT INTO notbgg_bgg_links(seq,candidate_bgg_id,created_by) VALUES (?,205637,'test') RETURNING id").bind(seqA).first<{ id: number }>();
            assert.equal((await repo.getByNotBggId(a.notBggId))!.linkStatus, 'pending'); assert.equal((await repo.getByNotBggId(a.notBggId))!.linkedBggId, null);
            await db.prepare("UPDATE notbgg_bgg_links SET status='linked',bgg_game_id=?,confirmed_by='test',linked_at='2026-11-04T01:00:00Z' WHERE id=?").bind(target!.id, link!.id).run();
            const linked = (await repo.getByNotBggId(a.notBggId))!; assert.equal(linked.primarySource, 'notbgg'); assert.equal(linked.name, a.name); assert.equal(linked.gameId, a.gameId);
            await assert.rejects(db.prepare("INSERT INTO notbgg_bgg_links(seq,candidate_bgg_id,bgg_game_id,status,confirmed_by,linked_at,created_by) VALUES (?,205637,?,'linked','test','now','test')").bind(seqB, target!.id).run());
            await assert.rejects(db.prepare("INSERT INTO notbgg_bgg_links(seq,candidate_bgg_id,created_by) VALUES (?,123,'test')").bind(seqA).run());
            await db.prepare("UPDATE notbgg_bgg_links SET primary_source='bgg' WHERE id=?").bind(link!.id).run();
            assert.equal((await repo.getByNotBggId(a.notBggId))!.primarySource, 'bgg');
            await db.prepare("INSERT INTO notbgg_link_events(link_id,action,actor,state_json) VALUES (?,'confirmed','test','{}')").bind(link!.id).run();
            await db.prepare("UPDATE notbgg_bgg_links SET status='revoked',revoked_by='test',revoked_at='now',revoke_reason='synthetic correction' WHERE id=?").bind(link!.id).run();
            const unlinked = (await repo.getByNotBggId(a.notBggId))!; assert.equal(unlinked.linkStatus, 'unlinked'); assert.equal(unlinked.primarySource, 'notbgg'); assert.equal(unlinked.gameId, a.gameId);
            assert.deepEqual((await repo.getRevisionHistory(a.notBggId))[0].snapshot.name, a.name);
            await assert.rejects(db.prepare('DELETE FROM notbgg_link_events WHERE link_id=?').bind(link!.id).run());
            await assert.rejects(db.prepare("UPDATE notbgg_bgg_links SET status='pending' WHERE id=?").bind(link!.id).run());
        });
        await t.test('committed high historical reservation expands beyond six digits without sequence reset', async () => {
            await db.prepare("INSERT INTO notbgg_ids(seq,request_key,request_hash) VALUES (999999,'historical-reservation','synthetic')").run();
            const game = (await repo.create({ name: 'Seven digits', type: 'boardgame' }, ctx('seven'))).game;
            assert.equal(game.notBggId, 'NotBGG:1000000');
            await assert.rejects(db.prepare("UPDATE notbgg_ids SET seq=1 WHERE seq=999999").run());
        });
        await t.test('local D1 AUTOINCREMENT: rolled-back allocation may be reused; committed row cannot be deleted or reused', async () => {
            const high = await scalar('SELECT seq FROM notbgg_ids ORDER BY seq DESC LIMIT 1');
            await assert.rejects(db.batch([db.prepare("INSERT INTO notbgg_ids(request_key,request_hash) VALUES ('rolled-back','x')"),
                db.prepare("INSERT INTO notbgg_accessory_categories(seq,category) VALUES (888888,'invalid')")]));
            assert.equal(await scalar('SELECT seq FROM notbgg_ids ORDER BY seq DESC LIMIT 1'), high);
            const game = (await repo.create({ name: 'After rollback', type: 'boardgame' }, ctx('after-rollback'))).game;
            assert.equal(Number(game.notBggId.slice(7)), high + 1);
            await assert.rejects(db.prepare('DELETE FROM notbgg_ids WHERE seq=?').bind(high + 1).run());
        });
        await t.test('no half-complete valid identities and no foreign-key damage remain after concurrent/failure tests', async () => {
            assert.equal(await scalar('SELECT count(*) FROM notbgg_games g LEFT JOIN notbgg_game_revisions r ON r.seq=g.seq AND r.revision=1 WHERE r.seq IS NULL'), 0);
            assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
            assert.equal(await hash(), beforeHash); assert.equal(beforeHash, '1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91');
        });
    } finally { await local.dispose(); }
});
