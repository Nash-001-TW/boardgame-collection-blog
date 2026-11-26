import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { handleComponentPhotoRead, handleComponentPhotoWrite, type PhotoBindings } from '../src/lib/component-photo-api.ts';
import { accessFixture } from './helpers/notbgg-access-fixture.ts';
import { dashboardPreview } from './helpers/admin-dashboard-preview.ts';
import { sleeveWorkflowFixture } from './helpers/sleeve-workflow-fixture.ts';
import { memoryPhotoStore } from './helpers/component-photo-store.ts';

const origin = 'https://example.test';
const path = '/api/admin/collection/component-photos';
// One-pixel WebP with a complete VP8 frame.
const pixel = Buffer.from('UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoBAAEAAUAmJZAABdUAANmv/xv+a/0J+4AAAA==', 'base64');
const jpeg = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwC4Aor/2Q==', 'base64');

async function setup(t: TestContext) {
    const fixture = await sleeveWorkflowFixture();
    t.after(() => fixture.sqlite.close());
    const access = await accessFixture();
    t.after(access.restore);
    const token = await access.token();
    const store = memoryPhotoStore();
    const bindings: PhotoBindings = { ...access.bindings, DB: fixture.db, COMPONENT_PHOTOS: store,
        PHYSICAL_COMPONENT_SIGNING_KEY: fixture.secret, NOTBGG_WRITE_LIMITER: { limit: async () => ({ success: true }) } };
    function request(options: { id?: number; revision?: number; operation?: string; visibility?: number;
        image?: Blob; thumb?: Blob; remove?: boolean; headers?: Record<string, string>; auth?: boolean } = {}) {
        const form = new FormData();
        form.set('action', options.remove ? 'remove' : 'upload');
        form.set('definitionId', String(fixture.cardId));
        form.set('photoId', String(options.id ?? 0));
        form.set('revision', String(options.revision ?? 0));
        if (!options.remove) {
            form.set('isPublic', String(options.visibility ?? 1));
            form.set('photo', options.image ?? new Blob([pixel], { type: 'image/webp' }), 'a.webp');
            form.set('thumb', options.thumb ?? new Blob([pixel], { type: 'image/webp' }), 'b.webp');
        }
        return new Request(origin + path, { method: 'POST', body: form, headers: {
            Origin: origin, 'X-NotBGG-Request': '1', 'Idempotency-Key': options.operation ?? crypto.randomUUID(),
            ...(options.auth === false ? {} : { 'Cf-Access-Jwt-Assertion': token }), ...options.headers,
        } });
    }
    const write = (options?: Parameters<typeof request>[0]) => handleComponentPhotoWrite(request(options), bindings);
    const read = (key: string, options: { admin?: boolean; auth?: boolean; tag?: string; method?: string } = {}) =>
        handleComponentPhotoRead(new Request(origin + (options.admin ? path : '/media/components') + '/' + key, {
            method: options.method, headers: {
                ...(options.auth ? { 'Cf-Access-Jwt-Assertion': token } : {}),
                ...(options.tag ? { 'If-None-Match': options.tag } : {}),
            },
        }), bindings, key, options.admin ?? false);
    const current = () => fixture.sqlite.prepare('SELECT * FROM v2_component_photos WHERE definition_id=?').get(fixture.cardId) as
        { id: number; revision: number; object_key: string; thumb_key: string; is_public: number } | undefined;
    const queued = () => fixture.sqlite.prepare('SELECT object_key FROM v2_component_photo_orphans').all().map(row => row.object_key);
    return { ...fixture, bindings, store, write, read, current, queued, token };
}

test('0027 enforces constraints and queues the replacement and cascading deletion', async t => {
    const { sqlite, queued } = await setup(t);
    // Existing physical provenance protects managed rows from deletion. Use a deletable definition to exercise CASCADE.
    sqlite.exec("INSERT INTO v2_component_definitions(id,collection_item_id,component_name) VALUES (99,1,'Disposable')");
    const insert = sqlite.prepare(`INSERT INTO v2_component_photos
        (definition_id, language_code, object_key, thumb_key, content_type, width, height, byte_size)
        VALUES (?,?,?,?,?,?,1,1)`);
    assert.throws(() => insert.run(99, 'en', 'a', 'b', 'image/webp', 1), /CHECK/);
    assert.throws(() => insert.run(99, null, 'a', 'b', 'image/png', 1), /CHECK/);
    assert.throws(() => insert.run(99, null, 'a', 'b', 'image/webp', 1601), /CHECK/);
    assert.throws(() => insert.run(99, null, 'a', 'b', 'image/webp', 1.5), /CHECK/);
    assert.throws(() => insert.run(999, null, 'a', 'b', 'image/webp', 1), /FOREIGN KEY/);
    insert.run(99, null, 'a', 'b', 'image/webp', 1);
    assert.throws(() => insert.run(99, null, 'c', 'd', 'image/jpeg', 1), /UNIQUE/);
    assert.equal(sqlite.prepare('SELECT revision FROM v2_component_photos').get()?.revision, 1);
    sqlite.exec("UPDATE v2_component_photos SET object_key='c', thumb_key='d'");
    assert.deepEqual(queued().sort(), ['a', 'b']);
    sqlite.exec('DELETE FROM v2_component_definitions WHERE id=99');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v2_component_photos').get()?.n, 0);
    assert.deepEqual(queued().sort(), ['a', 'b', 'c', 'd']);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});

test('write requires Access, same origin, request marker, limiter and idempotency', async t => {
    const { write, bindings, store } = await setup(t);
    assert.equal((await write({ auth: false })).status, 401);
    assert.equal((await write({ headers: { Origin: 'https://other.test' } })).status, 403);
    assert.equal((await write({ headers: { 'X-NotBGG-Request': '' } })).status, 403);
    assert.equal((await write({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await write({ operation: 'short' })).status, 400);
    bindings.NOTBGG_WRITE_LIMITER = { limit: async () => ({ success: false }) };
    assert.equal((await write()).status, 429);
    delete bindings.NOTBGG_WRITE_LIMITER;
    assert.equal((await write()).status, 503);
    assert.equal(store.objects.size, 0);
});

test('write rejects spoofed MIME, magic bytes, oversize files and over-dimension thumbnails', async t => {
    const { write, store } = await setup(t);
    assert.equal((await write({ image: new Blob([pixel], { type: 'image/jpeg' }) })).status, 415);
    assert.equal((await write({ image: new Blob(['bad'], { type: 'image/webp' }) })).status, 415);
    assert.equal((await write({ image: new Blob([new Uint8Array(1048577)], { type: 'image/webp' }) })).status, 413);
    assert.equal((await write({ thumb: new Blob([new Uint8Array(102401)], { type: 'image/webp' }) })).status, 413);
    const large = Buffer.from(pixel);
    large.writeUInt16LE(225, 26);
    assert.equal((await write({ thumb: new Blob([large], { type: 'image/webp' }) })).status, 400);
    assert.equal(store.objects.size, 0);
});

test('JPEG fallback is accepted and EXIF is rejected', async t => {
    const { write, read, current } = await setup(t);
    const image = new Blob([jpeg], { type: 'image/jpeg' });
    const exif = new Blob([jpeg.subarray(0, 2), Buffer.from([255, 225, 0, 8, 69, 120, 105, 102, 0, 0]),
        jpeg.subarray(2)], { type: 'image/jpeg' });
    assert.equal((await write({ image: exif, thumb: image })).status, 415);
    assert.equal((await write({ image, thumb: image })).status, 200);
    const response = await read(current()!.thumb_key);
    assert.equal(response.headers.get('Content-Type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
});

test('write supports concurrent replay, replacement, conflict, removal and replay after removal', async t => {
    const { write, current, store, queued } = await setup(t);
    const operation = crypto.randomUUID();
    const replies = await Promise.all([write({ operation }), write({ operation })]);
    assert.deepEqual(replies.map(result => result.status), [200, 200]);
    const results = await Promise.all(replies.map(async result => await result.json() as { data: { replayed: boolean } }));
    assert.deepEqual(results.map(reply => reply.data.replayed).sort(), [false, true]);
    assert.equal(store.objects.size, 2);
    assert.equal((await write({ operation, visibility: 0 })).status, 409);
    assert.equal((await write()).status, 409);
    const first = current()!;
    assert.equal((await write({ id: first.id, revision: first.revision, visibility: 0 })).status, 200);
    const second = current()!;
    assert.equal(second.revision, 2);
    assert.equal(second.is_public, 0);
    assert.deepEqual(queued().sort(), [first.object_key, first.thumb_key].sort());
    assert.equal((await write({ id: first.id, revision: first.revision, remove: true })).status, 409);
    assert.equal((await write({ id: second.id, revision: second.revision, remove: true })).status, 200);
    assert.equal(current(), undefined);
    assert.equal(queued().length, 4);
    assert.equal((await write({ operation })).status, 200);
    assert.equal(current(), undefined);
    assert.equal((await write()).status, 200);
    assert.notEqual(current()!.id, first.id);
    assert.equal((await write({ id: first.id, revision: first.revision, remove: true })).status, 409);
});

test('failed D1 transaction deletes both new R2 objects', async t => {
    const { write, current, store, db } = await setup(t);
    db.batch = async () => { throw new Error('D1 test failure'); };
    assert.equal((await write()).status, 503);
    assert.equal(current(), undefined);
    assert.equal(store.objects.size, 0);
    assert.equal(store.deleted.length, 2);
});

test('lost D1 acknowledgement preserves the successfully committed photo', async t => {
    const { write, current, store, db } = await setup(t);
    const batch = db.batch.bind(db);
    db.batch = async statements => { await batch(statements); throw new Error('Lost acknowledgement'); };
    assert.equal((await write()).status, 200);
    assert.ok(current());
    assert.equal(store.objects.size, 2);
    assert.equal(store.deleted.length, 0);
});

test('partial R2 put is compensated and failed deletion enters cleanup queue', async t => {
    const { write, current, store, queued } = await setup(t);
    const put = store.put.bind(store);
    store.put = async (key, bytes) => {
        if (store.objects.size) throw new Error('R2 test failure');
        return put(key, bytes);
    };
    store.delete = async key => {
        if (store.objects.has(key)) throw new Error('R2 delete failure');
    };
    assert.equal((await write()).status, 503);
    assert.equal(current(), undefined);
    assert.deepEqual(queued(), [...store.objects.keys()]);
});

test('public read checks visibility before 304, serves only image data, and Admin can see private photos', async t => {
    const { write, read, current, sqlite, store } = await setup(t);
    assert.equal((await read(crypto.randomUUID())).status, 404);
    assert.equal((await write()).status, 200);
    const first = current()!;
    const response = await read(first.object_key);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=300, must-revalidate');
    assert.equal(response.headers.get('Content-Type'), 'image/webp');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), pixel);
    const tag = response.headers.get('ETag')!;
    const conditional = await read(first.object_key, { tag: '"other", W/' + tag });
    assert.equal(conditional.status, 304);
    assert.equal(conditional.body, null);
    assert.equal((await read(first.object_key, { method: 'HEAD' })).body, null);
    assert.equal((await read(first.thumb_key, { admin: true })).status, 401);
    sqlite.exec("BEGIN; INSERT INTO v2_collection_management(collection_item_id,archived_at) VALUES (1,'2026-11-26')");
    assert.equal((await read(first.object_key, { tag })).status, 404);
    sqlite.exec('ROLLBACK');
    sqlite.exec("UPDATE v2_collection_items SET record_scope='test' WHERE id=1");
    assert.equal((await read(first.object_key, { tag })).status, 404);
    sqlite.exec("UPDATE v2_collection_items SET record_scope='production' WHERE id=1");
    assert.equal((await write({ id: first.id, revision: 1, visibility: 0 })).status, 200);
    const second = current()!;
    assert.equal((await read(first.object_key, { tag })).status, 404);
    assert.equal((await read(second.object_key, { tag: '*' })).status, 404);
    const admin = await read(second.thumb_key, { admin: true, auth: true });
    assert.equal(admin.status, 200);
    assert.match(admin.headers.get('Cache-Control') ?? '', /no-store/);
    assert.deepEqual(Buffer.from(await admin.arrayBuffer()), pixel);
    sqlite.exec('UPDATE v2_component_photos SET is_public=1');
    await store.delete(second.object_key);
    assert.equal((await read(second.object_key, { tag: '*' })).status, 503);
});

test('public read closes on D1 and R2 failure', async t => {
    const { write, read, current, db, store, bindings } = await setup(t);
    assert.equal((await write()).status, 200);
    const key = current()!.object_key;
    const get = store.get.bind(store);
    store.get = async () => { throw new Error('R2 test failure'); };
    assert.equal((await read(key)).status, 503);
    store.get = get;
    db.prepare = () => { throw new Error('D1 test failure'); };
    assert.equal((await read(key)).status, 503);
    delete bindings.DB;
    assert.equal((await read(key)).status, 503);
});

test('R06 renders both Admin photo entry points and bilingual dialog', async t => {
    const { write, current, bindings, token, cardId } = await setup(t);
    assert.equal((await write({ visibility: 0 })).status, 200);
    const row = current()!;
    const render = await dashboardPreview(bindings);
    for (const [suffix, label] of [['', '照片會套用到所有副本'], ['?lang=en', 'This photo applies to all copies']]) {
        const result = await render(new Request(origin + '/admin/collection/1/components' + suffix, {
            headers: { 'Cf-Access-Jwt-Assertion': token },
        }));
        assert.equal(result.status, 200);
        const html = await result.text();
        assert.ok(html.includes(label));
        assert.equal(html.split('data-component-photo-open="' + cardId + '"').length - 1, 2);
        assert.equal(html.split('src="' + path + '/' + row.thumb_key + '"').length - 1, 2);
        assert.match(html, /capture="environment"/);
        assert.ok(!html.includes('/media/components/'));
    }
});
