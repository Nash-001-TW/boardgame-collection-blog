import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCollectionAdminRequest } from '../src/lib/collection-admin-api.ts';
import { CollectionV2Repository } from '../src/lib/collection-v2-repository.ts';
import { NotBggRepository } from '../src/lib/notbgg-repository.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { isolatedNotBggD1, migrateIsolatedD1 } from './helpers/notbgg-local-d1.ts';

test('Collection field PATCH isolates columns and shares the legacy atomic revision gate', async () => {
 const local = await isolatedNotBggD1(), {db} = local;
 const auth = await accessFixture();
 try {
  await migrateIsolatedD1(db);
  const writer = new CollectionV2Repository(db).management;
  const game = (await new NotBggRepository(db).create({name: 'Patch fixture game', type: 'boardgame'},
   {actor: 'fixture', idempotencyKey: 'patch-game'})).game;
  const fullForm = {displayName: 'Original', acquisitionStatus: 'owned', wishlist: true, language: 'zh-TW',
   edition: 'Original edition', priceMinor: 1200, currency: 'TWD', merchant: 'Fixture shop', purchaseDate: '2026-11-01'};
  const {collectionId: id} = await writer.create({source: 'notbgg', notBggId: game.notBggId}, fullForm,
   {actor: 'fixture', scope: 'test', idempotencyKey: 'patch-collection', createCopy: true});
  const first = (await writer.detail(id, 'test'))!;
  const size = await db.prepare(`INSERT INTO v2_sleeve_sizes(width_tenth_mm,height_tenth_mm) VALUES(617,897)
   ON CONFLICT(width_tenth_mm,height_tenth_mm) DO UPDATE SET label=excluded.label RETURNING id`).first<{id:number}>();
  await db.prepare('INSERT INTO v2_sleeve_requirements(collection_item_id,owned_copy_id,size_id,quantity_sheets) VALUES (?,?,?,?)')
   .bind(id, first.item.managed_copy_id, size!.id, 42).run();
  const childTables = ['v2_owned_copies', 'v2_purchase_orders', 'v2_purchase_order_lines', 'v2_purchase_allocations',
   'v2_acquisitions', 'v2_sleeve_requirements'] as const;
  const children = () => Promise.all(childTables.map(async table => (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results));
  const initialChildren = await children();
  assert.ok(initialChildren.every(table => table.length));
  const management = async () => db.prepare('SELECT * FROM v2_collection_management WHERE collection_item_id=?').bind(id).first();
  const snapshot = async () => ({item: await writer.get(id, 'test'), management: await management(),
   events: (await db.prepare('SELECT * FROM v2_collection_events WHERE collection_item_id=? ORDER BY revision').bind(id).all()).results,
   children: await children()});
  const jwt = await auth.token();
  const patch = (body: unknown, options: {binding?: D1Database; scope?: string; id?: number} = {}) =>
   handleCollectionAdminRequest(new Request(`https://example.test/api/admin/collection/${options.id ?? id}?scope=${options.scope ?? 'test'}`, {
    method: 'PATCH', headers: {'Content-Type': 'application/json', Origin: 'https://example.test',
     'Cf-Access-Jwt-Assertion': jwt, 'X-NotBGG-Request': '1'}, body: JSON.stringify(body),
   }), {...auth.bindings, DB: options.binding ?? db, NOTBGG_WRITE_LIMITER: {limit: async () => ({success: true})}});
  const expectStatus = async (response: Response, status: number) => {
   assert.equal(response.status, status, await response.clone().text());
   return await response.json();
  };
  const stored = async () => {
   const {revision, updated_at: _updatedAt, ...item} = (await writer.get(id, 'test'))!;
   return {revision, item};
  };
  let expected = (await stored()).item;
  const firstManagement = await management();
  const apply = async (revision: number, changes: object, expectedFields: object) => {
   await expectStatus(await patch({revision, changes}), 200);
   expected = {...expected, ...expectedFields};
   assert.deepEqual(await stored(), {revision: revision + 1, item: expected});
  };
  await apply(1, {displayName: '  Renamed  '}, {display_name: 'Renamed'});
  const notes = '{"owned":false,"play_count":0,"personal_comment":"keep exactly"}';
  await apply(2, {notes}, {notes});
  await apply(3, {acquisitionStatus: 'preordered'}, {acquisition_status: 'preordered'});
  await apply(4, {wishlist: false}, {wishlist: 0});
  await apply(5, {wishlist: 1}, {wishlist: 1});
  await apply(6, {wishlist: 0}, {wishlist: 0});
  await apply(7, {notes: ''}, {notes: ''});
  await apply(8, {notes: null}, {notes: null});
  await apply(9, {displayName: 'Multi', acquisitionStatus: 'sold', wishlist: true, notes: '  plain text  '},
   {display_name: 'Multi', acquisition_status: 'sold', wishlist: 1, notes: '  plain text  '});
  assert.deepEqual(await management(), {...firstManagement, revision: 10});
  assert.deepEqual(await children(), initialChildren);

  const beforeReject = await snapshot();
  for (const changes of [null, [], 'text', {}, {unknown: true}, {id: 8}, {gameId: 8}, {scope: 'production'},
   {revision: 1}, {createCopy: true}, {priceMinor: 1}, {displayName: null}, {displayName: '  '},
   {acquisitionStatus: ''}, {acquisitionStatus: null}, {acquisitionStatus: 'invalid'}, {wishlist: '0'},
   {wishlist: null}, {wishlist: 2}, {notes: false}, {notes: {a: 1}}, {notes: '{"d5_create_token":"invalid"}'},
   {displayName: 'Should not save', notes: 0}]) {
   await expectStatus(await patch({revision: 10, changes}), 400);
  }
  for (const body of [{changes: {wishlist: false}}, {revision: 10}, {revision: '10', changes: {wishlist: false}},
   {revision: -1, changes: {wishlist: false}}, {revision: 10, changes: {wishlist: false}, expectedRevision: 10},
   {revision: 10, changes: {wishlist: false}, data: fullForm}]) await expectStatus(await patch(body), 400);
  await expectStatus(await patch({revision: 10, changes: {wishlist: false}}, {scope: 'production'}), 404);
  await expectStatus(await patch({revision: 9, changes: {displayName: 'Stale', notes: 'Should not save'}}), 409);
  assert.deepEqual(await snapshot(), beforeReject);

  // Force a storage failure in the last batch statement, after both audit and revision writes.
  await db.prepare(`CREATE TRIGGER patch_test_abort BEFORE UPDATE OF display_name ON v2_collection_items
   WHEN NEW.display_name='Force batch abort' BEGIN SELECT RAISE(ABORT,'fixture abort'); END;`).run();
  await expectStatus(await patch({revision: 10, changes: {displayName: 'Force batch abort', wishlist: false, notes: 'No'}}), 500);
  assert.deepEqual(await snapshot(), beforeReject);

  // Wait for both preflight reads before either batch executes: the SQL gate must pick one winner.
  let entered = 0;
  let release!: () => void;
  const bothEntered = new Promise<void>(resolve => { release = resolve; });
  const racingDb = {prepare: db.prepare.bind(db), batch: async (statements: D1PreparedStatement[]) => {
   if (++entered === 2) release();
   await Promise.race([bothEntered, new Promise<never>((_, reject) => {
    AbortSignal.timeout(4000).addEventListener('abort', () => reject(new Error('Both requests did not reach the batch')));
   })]);
   return db.batch(statements);
  }} as D1Database;
  const contenders = ['Left', 'Right'];
  const results = await Promise.all(contenders.map(value => patch({revision: 10, changes: {displayName: value, notes: value}}, {binding: racingDb})));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(entered, 2);
  const winner = contenders[results.findIndex(result => result.status === 200)];
  const won = await snapshot();
  assert.equal(won.item?.display_name, winner);
  assert.equal(won.item?.notes, winner);
  assert.equal(won.item?.revision, 11);
  assert.equal(won.events.length, beforeReject.events.length + 1);
  assert.deepEqual(won.events.slice(0, -1), beforeReject.events);
  assert.equal(won.events.at(-1)?.revision, 11);
  assert.equal(won.events.at(-1)?.operation, 'update');
  assert.equal(won.events.at(-1)?.actor, 'verified-admin-subject');
  await expectStatus(await patch({revision: 10, changes: {displayName: 'Replay', notes: 'Replay'}}), 409);
  assert.deepEqual(await snapshot(), won);
  assert.deepEqual(won.children, initialChildren);

  await expectStatus(await patch({expectedRevision: 11, data: {...fullForm, displayName: 'Legacy form', priceMinor: 1300}}), 200);
  const legacy = (await writer.detail(id, 'test'))!;
  assert.equal(legacy.item.display_name, 'Legacy form');
  assert.equal(legacy.item.revision, 12);
  assert.equal(legacy.purchases[0].unit_price_minor, 1300);
  assert.equal(legacy.copies[0].language_code, 'zh-TW');

  const unmanaged = await db.prepare(`INSERT INTO v2_collection_items(display_name,record_scope)
   VALUES('Unmanaged fixture','test') RETURNING id`).first<{id:number}>();
  await expectStatus(await patch({revision: 0, changes: {displayName: 'First managed revision'}}, {id: unmanaged!.id}), 200);
  const managed = (await writer.get(unmanaged!.id, 'test'))!;
  assert.equal(managed.revision, 1);
  assert.equal(managed.display_name, 'First managed revision');
  await writer.update(unmanaged!.id, null, {actor: 'fixture', scope: 'test', expectedRevision: 1}, true);
  await expectStatus(await patch({revision: 2, changes: {displayName: 'Cannot change archived'}}, {id: unmanaged!.id}), 409);
 } finally {
  auth.restore();
  await local.dispose();
 }
});
