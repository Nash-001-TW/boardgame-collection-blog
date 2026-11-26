import assert from 'node:assert/strict';
import test from 'node:test';
import { collectionPickerOutcome, collectionPickerRequests, mergeCollectionPickerPages } from '../src/lib/collection-picker';
import { readPurchase } from '../src/lib/purchase-admin';
import { sleeveWorkflowFixture } from './helpers/sleeve-workflow-fixture';

test('purchase search merges exact collection and BGG matches and retains archived status', () => {
    const requests = collectionPickerRequests('12', 0);
    assert.deepEqual(requests.map(request => new URL(request.url, 'http://localhost').searchParams.get('q')), ['12', 'bgg:12']);
    const page = collectionPickerOutcome(true, {success: true, data: {nextCursor: null, groups: [{
        source_id: 'BGG:12', items: [{id: 12, display_name: 'Synthetic', archived_at: '2026-11-26'}],
    }] }});
    assert.deepEqual(mergeCollectionPickerPages(requests.map(request => ({request, page}))).rows.map(
        ({id, archived, bases}) => ({id, archived, bases}),
    ), [{id: 12, archived: true, bases: ['collection', 'bgg']}]);
});

test('purchase detail reads the collection name and keeps unmatched lines, lock and amount guards', async () => {
    const fixture = await sleeveWorkflowFixture();
    const {sqlite, db} = fixture;
    try {
        sqlite.exec(`
            INSERT INTO v2_purchase_orders(id) VALUES(41);
            INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id)
            VALUES(41,1,'Linked line',1);
            PRAGMA foreign_keys=OFF;
            INSERT INTO v2_purchase_order_lines(purchase_order_id,line_number,description,collection_item_id)
            VALUES(41,2,'Missing collection',999);
            PRAGMA foreign_keys=ON;
        `);
        const detail = await readPurchase(db, 41);
        assert.deepEqual(detail.lines.map(line => line.collection_name), ['Synthetic collection', null]);
        assert.equal(detail.locked, true);
        sqlite.exec('UPDATE v2_purchase_order_lines SET unit_price_minor=0.5 WHERE purchase_order_id=41 AND line_number=2');
        await assert.rejects(readPurchase(db, 41), {code: 'AMOUNT_OUT_OF_RANGE'});
    } finally {
        sqlite.close();
    }
});
