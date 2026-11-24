import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    collectionPickerNumeric, collectionPickerOutcome, collectionPickerRequests, collectionPickerStatus, mergeCollectionPickerPages,
} from '../src/lib/collection-picker';
import type { CollectionListPage } from '../src/lib/collection-v2-management';

function page(rows: [number, string | null][], nextCursor: number | null = null): CollectionListPage {
    return {
        groups: rows.map(([id, source_id]) => ({
            key: 'collection:' + id, game_name: 'Synthetic game', source: source_id ? 'bgg' : 'missing',
            source_id, source_archived: null, link_status: null, linked_source_id: null, primary_source: null,
            items: [{ id, display_name: 'Synthetic ' + id, item_type: 'base', acquisition_status: 'wishlist', archived_at: null }],
        })),
        nextCursor,
    };
}

test('numeric input sends both searches with the existing records cursor contract', () => {
    assert.equal(collectionPickerNumeric('123'), true);
    assert.equal(collectionPickerNumeric('12.3'), false);
    const requests = collectionPickerRequests('123', 20);
    assert.deepEqual(requests.map(request => Object.fromEntries(new URL(request.url, 'http://localhost').searchParams)), [
        { q: '123', scope: 'production', view: 'records', limit: '20', after: '20' },
        { q: 'bgg:123', scope: 'production', view: 'records', limit: '20', after: '20' },
    ]);
    const merged = mergeCollectionPickerPages([
        { request: requests[0], page: page([[100, null], [123, null], [123, null]]) },
        { request: requests[1], page: page([[124, 'BGG:123']]) },
    ]);
    assert.deepEqual(merged.rows.map(({ id, bases }) => [id, bases]), [[123, ['collection']], [124, ['bgg']]]);
});

test('one record matched by both IDs is listed once with both bases', () => {
    const requests = collectionPickerRequests('123', 0);
    const result = mergeCollectionPickerPages(requests.map(request => ({ request, page: page([[123, 'BGG:123']]) })));
    assert.deepEqual(result.rows.map(({ id, bases }) => [id, bases]), [[123, ['collection', 'bgg']]]);
});

test('non-numeric search preserves name, BGG and NotBGG queries', () => {
    for (const query of ['  百戰 天蟲  ', 'BGG:123', 'NotBGG:000123']) {
        const [request, second] = collectionPickerRequests(query, 0);
        assert.equal(second, undefined);
        assert.equal(new URL(request.url, 'http://localhost').searchParams.get('q'), query);
    }
});

test('a shared cursor never skips a match in a stream with more results', () => {
    const [collection, bgg] = collectionPickerRequests('123', 0);
    const result = mergeCollectionPickerPages([
        { request: collection, page: page([[50, null]], 50) },
        { request: bgg, page: page([[40, 'BGG:123'], [123, 'BGG:123']]) },
    ]);
    assert.deepEqual(result.rows.map(row => row.id), [40]);
    assert.equal(result.nextCursor, 50);
});

test('all status badges have Chinese and English labels', () => {
    const expected = {
        owned: ['已收藏', 'Owned'], preordered: ['預購', 'Preordered'], wishlist: ['願望清單', 'Wishlist'],
        not_owned: ['未收藏', 'Not owned'], sold: ['已售出', 'Sold'], gifted_away: ['已送出', 'Gifted away'],
        unknown: ['未知', 'Unknown'], archived: ['已封存', 'Archived'],
    };
    for (const [status, labels] of Object.entries(expected)) {
        assert.deepEqual([collectionPickerStatus(status, false), collectionPickerStatus(status, true)], labels);
    }
});

test('empty success is distinct from HTTP, API and invalid response failures', () => {
    assert.deepEqual(collectionPickerOutcome(true, { success: true, data: page([]) }), page([]));
    assert.throws(() => collectionPickerOutcome(false, null));
    assert.throws(() => collectionPickerOutcome(true, { success: false }));
    assert.throws(() => collectionPickerOutcome(true, { success: true, data: {} }));
});
