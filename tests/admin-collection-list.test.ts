import assert from 'node:assert/strict';
import test from 'node:test';
import { readAdminDashboardSummary } from '../src/lib/admin-dashboard-summary';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api';
import { CollectionV2Writer, type CollectionListPage, type NumberedCollectionList } from '../src/lib/collection-v2-management';
import { getGames } from '../src/lib/games';
import { safeImage } from '../src/lib/notbgg-public';
import { r02Fixture } from './helpers/admin-dashboard-preview';
import { accessFixture } from './helpers/notbgg-access-fixture';

const defaults = {view:'records', query:'', source:null, status:null, archive:null, page:1, limit:20, sort:'updated', tab:'all', players:null};
const ids = (list: Awaited<ReturnType<CollectionV2Writer['listNumbered']>>['list']) => list?.groups.flatMap(group => group.items.map(item => item.id));

test('numbered tabs match R01, overlap, and count archived records', async () => {
 const {db, sqlite} = r02Fixture();
 try {
  const repo = new CollectionV2Writer(db);
  const r01 = (await readAdminDashboardSummary(db)).collection!;
  const owned = await repo.listNumbered('production', {...defaults, tab:'owned'});
  assert.deepEqual(owned.counts, {all:r01.total, owned:r01.owned, wishlist:r01.wishlist, preordered:r01.preorder});
  assert.deepEqual(ids(owned.list), [1, 3, 5]);
  assert.deepEqual(ids((await repo.listNumbered('production', {...defaults, tab:'wishlist'})).list), [2, 3]);
  assert.deepEqual(ids((await repo.listNumbered('production', {...defaults, tab:'preordered'})).list), [3]);
  assert.deepEqual(ids((await repo.listNumbered('production', {...defaults, status:'owned'})).list), [1, 2, 5]);
  assert.deepEqual((await repo.listNumbered('test', {...defaults, query:'nonexistent'})).counts, {all:1, owned:1, wishlist:1, preordered:0});
 } finally { sqlite.close(); }
});

test('numbered pages clamp, group and sort with a stable ID tie break', async () => {
 const {db, sqlite} = r02Fixture();
 try {
  const repo = new CollectionV2Writer(db);
  sqlite.exec(`UPDATE v2_collection_items SET updated_at='2026-11-26' WHERE id=4;
   UPDATE v2_collection_items SET display_name='Aardvark' WHERE id=5;
   INSERT INTO v2_owned_copies(collection_item_id,copy_label) VALUES (3,'A'),(3,'B'),(3,'C');`);
  const orderings = {id:[1,2,3,4], updated:[4,1,2,3], name:[5,1,2,3], copies:[3,1,2,4]};
  for (const [sort, expected] of Object.entries(orderings)) {
   const first = await repo.listNumbered('production', {...defaults, sort});
   const second = await repo.listNumbered('production', {...defaults, sort, page:2});
   assert.deepEqual(ids(first.list)?.slice(0, 4), expected);
   assert.equal(first.list?.total, 48);
   assert.equal(ids(first.list)?.length, 20);
   assert.ok(!ids(second.list)?.some(id => ids(first.list)?.includes(id)));
   assert.deepEqual(ids((await repo.listNumbered('production', {...defaults, sort, page:3})).list),
    ids((await repo.listNumbered('production', {...defaults, sort, page:999})).list));
  }
  for (const limit of [20, 50, 100]) assert.equal((await repo.listNumbered('production', {...defaults, limit, page:999})).list?.page, limit === 20 ? 3 : 1);
  for (const limit of [0, 10, 21, 101]) await assert.rejects(repo.listNumbered('production', {...defaults, limit}), /VALIDATION/);
  await assert.rejects(repo.listNumbered('production', {...defaults, page:0}), /VALIDATION/);
  const grouped = await repo.listNumbered('production', {...defaults, view:'grouped', sort:'id'});
  assert.equal(grouped.list?.total, 4);
  assert.deepEqual(grouped.list?.groups[0].items.map(item => item.id), [1, 2]);
 } finally { sqlite.close(); }
});

test('players exclude unknown ranges and presentation uses safe metadata and held copies', async () => {
 const {db, sqlite} = r02Fixture();
 try {
  const repo = new CollectionV2Writer(db);
  const result = await repo.listNumbered('production', {...defaults, players:4, limit:50});
  assert.equal(result.list?.total, 47);
  assert.ok(!ids(result.list)?.includes(5));
  const [alpha, , bravo, charlie] = result.list!.groups.map(group => group.items[0]);
  assert.equal(alpha.copies, 2);
  assert.equal(alpha.image, 'https://example.invalid/cover.webp');
  assert.deepEqual([alpha.min_players, alpha.max_players], [1, 4]);
  assert.deepEqual([bravo.min_players, bravo.max_players], [2, 5]);
  assert.equal(charlie.image, null);
  for (const players of [0, 2.5, 21]) await assert.rejects(repo.listNumbered('production', {...defaults, players}), /VALIDATION/);
  const game = getGames().find(entry => entry.bgg && entry.bgg.minPlayers > 0 && entry.bgg.maxPlayers > 0
    && ![900001,900002].includes(entry.bggId))!;
  sqlite.prepare(`INSERT INTO bgg_games(bgg_id,name,cache_json) VALUES (?,?,'{"minPlayers":99,"maxPlayers":99}')`).run(game.bggId, game.name);
  sqlite.prepare('INSERT INTO v2_games(id,bgg_id,primary_name) VALUES (4,?,?)').run(game.bggId, game.name);
  sqlite.exec("INSERT INTO v2_collection_items(id,game_id,display_name) VALUES (100,4,'Static fallback')");
  const fallback = (await repo.listNumbered('production', {...defaults, query:'Static fallback'})).list!.groups[0].items[0];
  assert.equal(fallback.image, safeImage(game.bgg!.thumbnail || game.bgg!.image));
  assert.deepEqual([fallback.min_players,fallback.max_players], [game.bgg!.minPlayers,game.bgg!.maxPlayers]);
 } finally { sqlite.close(); }
});

test('list and counts fail independently under the D1 compound-query guard', async () => {
 for (const section of ['counts', 'list'] as const) {
  const {db, sqlite} = r02Fixture(section);
  try {
   assert.throws(() => db.prepare('SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5'), /term limit/);
   const data = await new CollectionV2Writer(db).listNumbered('production', defaults);
   assert.equal(data[section], null);
   assert.ok(data[section === 'counts' ? 'list' : 'counts']);
  } finally { sqlite.close(); }
 }
});

test('GET without page returns unchanged picker and bare cursor contracts', async () => {
 const {db, sqlite} = r02Fixture();
 const auth = await accessFixture();
 try {
  const repo = new CollectionV2Writer(db);
  const headers = {'Cf-Access-Jwt-Assertion': await auth.token()};
  const request = (query: string) => handleCollectionAdminRequest(new Request('https://boardgames.test/api/admin/collection?' + query, {headers}), {...auth.bindings, DB: db});
  const picker = await request('view=records&after=1&limit=2&status=owned&tab=wishlist&players=19');
  assert.equal(picker.status, 200);
  const legacy = await picker.json() as {data: CollectionListPage};
  assert.deepEqual(legacy.data, await repo.listPage('production', {...defaults, status:'owned', after:1, limit:2}));
  const bare = await (await request('after=1&limit=2')).json() as {data: unknown};
  assert.deepEqual(bare.data, (await repo.list('production', 1, 2)).map(row => ({...row})));
  const numbered = await request('page=1&tab=wishlist');
  assert.equal(numbered.status, 200);
  const result = await numbered.json() as {data: NumberedCollectionList};
  assert.deepEqual(ids(result.data.list), [2, 3]);
 } finally { auth.restore(); sqlite.close(); }
});
