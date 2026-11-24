import assert from 'node:assert/strict';
import test from 'node:test';
import { quantityPreviewView } from '../src/lib/d1-quantity-preview-view.ts';
import { projectQuantityImpact, type QuantityImpactRow } from '../src/lib/physical-quantity-impact.ts';

function impact() {
    const generation = '1';
    const row = (copyId: number, actual: number | null, inventory: QuantityImpactRow['inventory']): QuantityImpactRow => ({
        applicability: { status: 'applicable', copyId, definitionId: 1, collectionId: 1, generation, revision: 0 },
        inventory, actual, inspection: actual === null ? 'unchecked' : 'checked',
        evidence: { kind: 'reference', id: 'synthetic', version: 1 },
        beforeExpected: 103, afterExpected: 100,
    });
    const projected = projectQuantityImpact({
        status: 'candidate', collectionId: 1, generation, copyIds: [1, 2, 3, 4], definitionIds: [1],
        rows: [row(1, 102, 'in_collection'), row(2, 110, 'loaned'), row(3, null, 'in_collection'), row(4, 99, 'sold')],
    }, 1);
    assert.equal(projected.status, 'READY');
    return projected;
}

test('preview groups and summaries keep unreadable and excluded copies distinct', () => {
    const view = quantityPreviewView(impact(), new Map([[1, '基本版']]), false, '張');
    assert.deepEqual([view.affected, view.missing, view.unreadable, view.excluded], [3, '1 → 0', 1, 1]);
    assert.deepEqual(view.groups.map(({ label, open }) => [label, open]), [
        ['變動', true], ['不變', false], ['無法判讀', false],
    ]);
    assert.deepEqual(view.groups.map(group => group.rows[0]), [
        { name: '基本版', actual: '102', before: '缺 1 張', after: '不缺（多 2 張）' },
        { name: '副本 #2 （借出）', actual: '110', before: '不缺（多 7 張）', after: '不缺（多 10 張）' },
        { name: '副本 #3', actual: '—', before: '尚未清點', after: '尚未清點' },
    ]);
});

test('preview localizes fallback and qualitative labels in English', () => {
    const view = quantityPreviewView(impact(), new Map([[2, ' ']]), true, 'card');
    assert.equal(view.groups[1].rows[0].name, 'Copy #2 (loaned)');
    assert.equal(view.groups[0].rows[0].after, 'No shortage (2 extra)');
    assert.equal(view.groups[2].rows[0].actual, '—');
    assert.equal(view.groups[2].rows[0].before, 'Not counted');
});
