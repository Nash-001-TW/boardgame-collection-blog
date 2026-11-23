import assert from 'node:assert/strict';
import test from 'node:test';
import { projectQuantityImpact, type QuantityImpactRow } from '../src/lib/physical-quantity-impact.ts';

function row(copyId: number, definitionId: number, fields: Partial<QuantityImpactRow> = {}): QuantityImpactRow {
    return {
        applicability: { collectionId: 1, copyId, definitionId, status: 'applicable', revision: 0, generation: '7' },
        inventory: 'in_collection', inspection: 'checked', actual: 0,
        evidence: { kind: 'frozen', id: 'count:' + copyId + ':' + definitionId, version: 1 },
        beforeExpected: 3, afterExpected: 3, ...fields,
    };
}

function project(rows: QuantityImpactRow[], copyIds = [1], definitionIds = [1]) {
    return projectQuantityImpact({ status: 'candidate', collectionId: 1, generation: '7', copyIds, definitionIds, rows }, 1);
}

function ready(rows: QuantityImpactRow[], copyIds?: number[], definitionIds?: number[]) {
    const result = project(rows, copyIds, definitionIds);
    if (result.status !== 'READY') assert.fail(result.status);
    return result;
}

test('SUP-003/006: NULL to 3 and 3 to NULL preserve each readable side with actual zero', () => {
    for (const unknownSide of ['before', 'after'] as const) {
        const readableSide = unknownSide === 'before' ? 'after' : 'before';
        const input = row(1, 1, unknownSide === 'before' ? { beforeExpected: null } : { afterExpected: null });
        const result = ready([input]);
        assert.equal(result.details[0].group, 'at_least_one_side_unreadable');
        assert.deepEqual(result.details[0][unknownSide], { status: 'unreadable', reason: 'EXPECTED_UNKNOWN' });
        assert.deepEqual(result.details[0][readableSide], { status: 'readable', items: 1, units: 3 });
        assert.deepEqual(result.header[unknownSide], { missingItems: 0, missingUnits: 0, unreadable: 1 });
        assert.deepEqual(result.header[readableSide], { missingItems: 1, missingUnits: 3, unreadable: 0 });
        assert.deepEqual(result.summary, result.header);
        assert.equal(result.details[0].row.actual, 0);
    }
});

test('missing actual, unchecked, needs review and unavailable evidence produce no numeric judgement', () => {
    for (const [input, reason] of [
        [row(1, 1, { actual: null }), 'ACTUAL_UNKNOWN'],
        [row(1, 1, { inspection: 'unchecked' }), 'UNCHECKED'],
        [row(1, 1, { inspection: 'needs_review' }), 'NEEDS_REVIEW'],
        [row(1, 1, { evidence: { kind: 'unavailable' } }), 'EVIDENCE_UNAVAILABLE'],
    ] as const) {
        const result = ready([input]);
        for (const side of ['before', 'after'] as const) {
            assert.deepEqual(result.details[0][side], { status: 'unreadable', reason });
            assert.deepEqual(result.header[side], { missingItems: 0, missingUnits: 0, unreadable: 1 });
        }
    }
});

test('SUP-005: deduplicates identical join rows while counting distinct copy/definition pairs', () => {
    const r = row(1, 1);
    const result = ready([r, { ...r }, row(1, 2), row(2, 1), row(2, 2, { actual: 3 })], [1, 2], [1, 2]);
    assert.equal(result.details.length, 2);
    assert.deepEqual(result.header.before, { missingItems: 3, missingUnits: 9, unreadable: 0 });
    assert.deepEqual(result.header.after, result.header.before);
    assert.deepEqual(result.summary.before, { missingItems: 2, missingUnits: 6, unreadable: 0 });
});

test('disagreeing join rows on actual, inspection, evidence or identity reject the projection', () => {
    const r = row(1, 1);
    for (const other of [
        row(1, 1, { actual: 1 }),
        row(1, 1, { inspection: 'needs_review' }),
        row(1, 1, { evidence: { kind: 'reference', id: 'other', version: 1 } }),
        row(1, 1, { applicability: { ...r.applicability, collectionId: 2 } }),
    ]) {
        assert.deepEqual(project([r, other]), { status: 'EVIDENCE_CONFLICT', copyId: 1, definitionId: 1 });
    }
});

test('classification is exclusive and includes borrowed copies with a distinct marker', () => {
    const excluded = row(2, 1, { inventory: 'sold' });
    const unknown = row(1, 1, { inventory: 'unknown' });
    const na = (r: QuantityImpactRow): QuantityImpactRow => ({
        ...r, applicability: { ...r.applicability, status: 'not_applicable', revision: 1, generation: '7' },
    });
    const result = ready([na(unknown), na(excluded), na(row(3, 1)), row(4, 1, { inventory: 'loaned' })], [1, 2, 3, 4]);
    assert.deepEqual(result.classification, { unknown: 1, excluded: 1, not_applicable: 1, included: 1 });
    assert.equal(result.details[0].loaned, true);
    assert.equal(result.details[0].row.applicability.copyId, 4);
    assert.equal(result.header.before.missingItems, 1);
});

test('a complete synthetic zero projection has no details or confirmation authority', () => {
    assert.equal(ready([], []).affectedCopies, 0);
    assert.deepEqual(ready([], []).details, []);
    assert.equal(ready([], []).confirmationEligible, false);
    const r = row(1, 1);
    const noCopiesIncluded = ready([{ ...r, inventory: 'lost' }]);
    assert.equal(noCopiesIncluded.affectedCopies, 0);
    assert.deepEqual(noCopiesIncluded.details, []);
    assert.deepEqual(projectQuantityImpact({ status: 'unavailable' }, 1), { status: 'SOURCE_UNAVAILABLE' });
    assert.deepEqual(project([], [1]), { status: 'SOURCE_UNAVAILABLE' });
    assert.deepEqual(project([{ ...r, applicability: { ...r.applicability, status: 'unknown', reason: 'SOURCE_UNAVAILABLE' } }]),
        { status: 'SOURCE_UNAVAILABLE' });
});

test('a verifiable reference keeps its identity in the detail and unrelated tags do not enter the totals', () => {
    const reference = { kind: 'reference', id: 'immutable-count:7', version: 1 } as const;
    const input = { ...row(1, 1, { actual: 3, evidence: reference }), conditionTags: ['missing_parts'] };
    const result = ready([input]);
    assert.deepEqual(result.details[0].row.evidence, reference);
    assert.deepEqual(result.header.before, { missingItems: 0, missingUnits: 0, unreadable: 0 });
    assert.deepEqual(result.header.after, result.header.before);
});

test('runtime validation rejects malformed values even when a valid duplicate precedes them', () => {
    const valid = row(1, 1);
    const a = valid.applicability;
    for (const invalid of [
        { ...valid, applicability: { ...a, status: 'unsupported' } },
        { ...valid, applicability: { ...a, revision: -1 } },
        { ...valid, applicability: { ...a, status: 'not_applicable', revision: 0 } },
        { ...valid, applicability: { ...a, generation: 7 } },
        { ...valid, applicability: { ...a, generation: '9223372036854775808' } },
        { ...valid, applicability: { ...a, copyId: 0 } },
        { ...valid, applicability: { ...a, definitionId: 1.5 } },
        { ...valid, applicability: { ...a, collectionId: '1' } },
        { ...valid, inventory: 'borrowed' },
        { ...valid, inspection: 'confirmed' },
        { ...valid, evidence: { kind: 'invented', id: 'count', version: 1 } },
        { ...valid, evidence: { kind: 'frozen', id: 'count', version: 2 } },
        { ...valid, actual: Number.MAX_SAFE_INTEGER + 1 },
        { ...valid, beforeExpected: -1 },
        { ...valid, afterExpected: 0.5 },
    ]) {
        assert.deepEqual(project([valid, invalid as QuantityImpactRow]), { status: 'INVALID_INPUT' });
    }
    assert.deepEqual(projectQuantityImpact({
        status: 'verified', collectionId: 1, generation: '7', copyIds: [], definitionIds: [1], rows: [],
    }, 1), { status: 'INVALID_INPUT' });
    assert.deepEqual(projectQuantityImpact({
        status: 'candidate', collectionId: 1, generation: '07', copyIds: [], definitionIds: [1], rows: [],
    }, 1), { status: 'INVALID_INPUT' });
});

test('otherwise legal generation or revision disagreements are evidence conflicts', () => {
    const valid = row(1, 1);
    for (const conflict of [
        { ...valid, applicability: { ...valid.applicability, generation: '8' } },
        { ...valid, applicability: { ...valid.applicability, revision: 2 } },
    ]) {
        assert.deepEqual(project([valid, conflict]), { status: 'EVIDENCE_CONFLICT', copyId: 1, definitionId: 1 });
    }
});

test('both expected quantities may be NULL without losing a valid actual zero', () => {
    const result = ready([row(1, 1, { beforeExpected: null, afterExpected: null })]);
    const unreadable = { status: 'unreadable', reason: 'EXPECTED_UNKNOWN' };
    assert.equal(result.details[0].group, 'at_least_one_side_unreadable');
    assert.equal(result.details[0].row.actual, 0);
    assert.deepEqual(result.details[0].before, unreadable);
    assert.deepEqual(result.details[0].after, unreadable);
    assert.deepEqual(result.header.before, { missingItems: 0, missingUnits: 0, unreadable: 1 });
    assert.deepEqual(result.header.after, result.header.before);
});

test('aggregation is exact at the safe limit and rejects overflow on either side', () => {
    const limit = Number.MAX_SAFE_INTEGER;
    const large = row(1, 1, { beforeExpected: limit, afterExpected: limit });
    const boundary = ready([large, { ...large }]);
    assert.equal(boundary.summary.before.missingUnits, limit);
    assert.equal(boundary.header.after.missingUnits, limit);

    for (const [beforeExpected, afterExpected] of [[limit, 0], [0, limit]]) {
        const first = row(1, 1, { beforeExpected, afterExpected });
        assert.deepEqual(project([first, row(2, 1, { beforeExpected, afterExpected })], [1, 2]),
            { status: 'NUMERIC_OVERFLOW' });
        // The target alone fits; a different definition overflows the collection header.
        assert.deepEqual(project([first, row(1, 2, { beforeExpected: 2, afterExpected: 2 })], [1], [1, 2]),
            { status: 'NUMERIC_OVERFLOW' });
    }
});

test('0024 applicability status must agree with the parity of the event revision', () => {
    const valid = row(1, 1);
    for (const revision of [0, 1, 2, 3]) {
        const status = revision % 2 === 0 ? 'applicable' : 'not_applicable';
        const result = ready([{ ...valid, applicability: { ...valid.applicability, revision, status, generation: '7' } }]);
        assert.equal(result.classification.included, revision % 2 === 0 ? 1 : 0);
        assert.equal(result.classification.not_applicable, revision % 2 === 0 ? 0 : 1);
        const wrongStatus = status === 'applicable' ? 'not_applicable' : 'applicable';
        assert.deepEqual(project([{ ...valid, applicability: { ...valid.applicability, revision, status: wrongStatus, generation: '7' } }]),
            { status: 'INVALID_INPUT' });
    }
    for (const revision of ['0', null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
        const malformed = { ...valid, applicability: { ...valid.applicability, revision } };
        assert.deepEqual(project([malformed as QuantityImpactRow]), { status: 'INVALID_INPUT' });
    }
});

function* permutations<T>(values: readonly T[]): Generator<T[]> {
    if (values.length === 0) yield [];
    for (const [index, value] of values.entries()) {
        const remainder = [...values.slice(0, index), ...values.slice(index + 1)];
        for (const tail of permutations(remainder)) yield [value, ...tail];
    }
}

test('valid permutations including duplicate joins preserve the full SUP-005/006 result', () => {
    const first = row(1, 1, { beforeExpected: null });
    const second = row(2, 1, { beforeExpected: null, inventory: 'loaned', actual: 1 });
    const another = row(1, 2, { actual: 1 });
    const last = row(2, 2, { actual: 3, inventory: 'loaned' });
    const expected = ready([first, second, another, last], [1, 2], [1, 2]);
    assert.deepEqual(expected.summary, {
        before: { missingItems: 0, missingUnits: 0, unreadable: 2 },
        after: { missingItems: 2, missingUnits: 5, unreadable: 0 },
    });
    assert.deepEqual(expected.header, {
        before: { missingItems: 1, missingUnits: 2, unreadable: 2 },
        after: { missingItems: 3, missingUnits: 7, unreadable: 0 },
    });
    for (const order of permutations([first, second, another, last, { ...first }])) {
        assert.deepEqual(project(order, [1, 2], [1, 2]), expected);
    }
});

test('format, evidence and source errors take precedence over overflow in every row order', () => {
    const limit = Number.MAX_SAFE_INTEGER;
    const large = (id: number) => row(id, 1, { beforeExpected: limit, afterExpected: limit });
    const first = large(1);
    const second = large(2);
    const third = large(3);
    const stale: QuantityImpactRow = {
        ...third, applicability: { ...third.applicability, status: 'applicable', revision: 0, generation: '8' },
    };
    const unknown: QuantityImpactRow = {
        ...third, applicability: { collectionId: 1, copyId: 3, definitionId: 1, status: 'unknown', reason: 'SOURCE_UNAVAILABLE' },
    };
    const duplicateConflict = { ...first, actual: 1 };
    const invalid = { ...second, actual: -1 };
    const cases = [
        { rows: [first, second, stale], copies: [1, 2, 3],
            expected: { status: 'EVIDENCE_CONFLICT', copyId: 3, definitionId: 1 } },
        { rows: [first, second, duplicateConflict], copies: [1, 2],
            expected: { status: 'EVIDENCE_CONFLICT', copyId: 1, definitionId: 1 } },
        { rows: [first, second, unknown], copies: [1, 2, 3], expected: { status: 'SOURCE_UNAVAILABLE' } },
        { rows: [first, second, stale, unknown, invalid], copies: [1, 2, 3], expected: { status: 'INVALID_INPUT' } },
        { rows: [first, second, duplicateConflict, unknown], copies: [1, 2, 3],
            expected: { status: 'EVIDENCE_CONFLICT', copyId: 1, definitionId: 1 } },
    ];
    for (const { rows, copies, expected } of cases) {
        for (const order of permutations(rows)) assert.deepEqual(project(order, copies), expected);
    }
});
