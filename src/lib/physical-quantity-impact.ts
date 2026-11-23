import { validApplicabilityGeneration, type Applicability } from './component-applicability';

type InventoryStatus = 'unknown' | 'sold' | 'gifted_away' | 'lost' | 'in_collection' | 'loaned';
type EvidenceSource = { kind: 'reference' | 'frozen'; id: string; version: 1 } | { kind: 'unavailable' };

export type QuantityImpactRow = {
    applicability: Applicability;
    inventory: InventoryStatus;
    inspection: 'unchecked' | 'checked' | 'needs_review';
    actual: number | null;
    evidence: EvidenceSource;
    beforeExpected: number | null;
    afterExpected: number | null;
};

type Judgement =
    | { status: 'readable'; items: 0 | 1; units: number }
    | { status: 'unreadable'; reason: 'EXPECTED_UNKNOWN' | 'UNCHECKED' | 'NEEDS_REVIEW' | 'EVIDENCE_UNAVAILABLE' | 'ACTUAL_UNKNOWN' };

type ImpactSummary = { missingItems: number; missingUnits: number; unreadable: number };
type Detail = {
    row: QuantityImpactRow;
    loaned: boolean;
    before: Judgement;
    after: Judgement;
    group: 'changed' | 'unchanged' | 'at_least_one_side_unreadable';
};

type Projection =
    | { status: 'unavailable' }
    | {
        // A candidate projection asserts no authoritative source or confirmation capability.
        status: 'candidate';
        collectionId: number;
        generation: string;
        copyIds: readonly number[];
        definitionIds: readonly number[];
        rows: readonly QuantityImpactRow[];
    };

const inventoryStatuses: readonly InventoryStatus[] = ['unknown', 'sold', 'gifted_away', 'lost', 'in_collection', 'loaned'];

function classify(row: QuantityImpactRow) {
    if (row.inventory === 'unknown') return 'unknown';
    if (row.inventory === 'sold' || row.inventory === 'gifted_away' || row.inventory === 'lost') return 'excluded';
    if (row.applicability.status === 'not_applicable') return 'not_applicable';
    return 'included';
}

function validQuantity(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(value: unknown): value is number {
    return validQuantity(value) && value > 0;
}

function validRow(value: unknown): value is QuantityImpactRow {
    if (!object(value) || !object(value.applicability) || !object(value.evidence)) return false;
    const a = value.applicability;
    const e = value.evidence;
    if (![a.collectionId, a.copyId, a.definitionId].every(validId)
        || !inventoryStatuses.some(status => status === value.inventory)
        || !['unchecked', 'checked', 'needs_review'].some(status => status === value.inspection)
        || ![value.actual, value.beforeExpected, value.afterExpected].every(v => v === null || validQuantity(v))) return false;
    const validEvidence = e.kind === 'unavailable' || (
        (e.kind === 'reference' || e.kind === 'frozen') && e.version === 1
        && typeof e.id === 'string' && e.id.trim().length > 0
    );
    if (!validEvidence) return false;
    if (a.status === 'unknown') return a.reason === 'SOURCE_UNAVAILABLE' || a.reason === 'TARGET_INVALID';
    // Migration 0024 starts applicable at revision zero and flips on each event.
    if (!validQuantity(a.revision) || !validApplicabilityGeneration(a.generation)) return false;
    return a.status === (a.revision % 2 === 0 ? 'applicable' : 'not_applicable');
}

function judge(row: QuantityImpactRow, expected: number | null): Judgement {
    if (row.inspection === 'unchecked') return { status: 'unreadable', reason: 'UNCHECKED' };
    if (row.inspection === 'needs_review') return { status: 'unreadable', reason: 'NEEDS_REVIEW' };
    if (row.inspection !== 'checked' || row.evidence.kind === 'unavailable' || !row.evidence.id.trim()) {
        return { status: 'unreadable', reason: 'EVIDENCE_UNAVAILABLE' };
    }
    if (!validQuantity(row.actual)) return { status: 'unreadable', reason: 'ACTUAL_UNKNOWN' };
    if (!validQuantity(expected)) return { status: 'unreadable', reason: 'EXPECTED_UNKNOWN' };

    const units = Math.max(0, expected - row.actual);
    return { status: 'readable', items: units > 0 ? 1 : 0, units };
}

function add(summary: ImpactSummary, judgement: Judgement) {
    if (judgement.status === 'unreadable') {
        if (summary.unreadable === Number.MAX_SAFE_INTEGER) return false;
        summary.unreadable++;
    } else {
        if (judgement.items > Number.MAX_SAFE_INTEGER - summary.missingItems
            || judgement.units > Number.MAX_SAFE_INTEGER - summary.missingUnits) return false;
        summary.missingItems += judgement.items;
        summary.missingUnits += judgement.units;
    }
    return true;
}

function emptySummary() {
    return { missingItems: 0, missingUnits: 0, unreadable: 0 };
}

function comparableEvidence(row: QuantityImpactRow) {
    const a = row.applicability;
    return [
        a.collectionId, a.copyId, a.definitionId, a.status,
        a.status === 'unknown' ? a.reason : a.generation,
        a.status === 'unknown' ? null : a.revision,
        row.inventory, row.inspection, row.actual, row.evidence.kind,
        row.evidence.kind === 'unavailable' ? null : row.evidence.id,
        row.evidence.kind === 'unavailable' ? null : row.evidence.version,
        row.beforeExpected, row.afterExpected,
    ];
}

/**
 * Builds the impact for one definition and the collection-wide header.
 * A candidate projection needs one pair for every declared copy × eligible definition.
 * Evidence trust and completeness must be established by the data-access caller.
 */
export function projectQuantityImpact(input: unknown, targetDefinitionId: number) {
    if (!object(input) || !validId(targetDefinitionId)) return { status: 'INVALID_INPUT' } as const;
    if (input.status === 'unavailable') return { status: 'SOURCE_UNAVAILABLE' } as const;
    if (input.status !== 'candidate' || !validId(input.collectionId) || !validApplicabilityGeneration(input.generation)
        || !Array.isArray(input.copyIds) || !Array.isArray(input.definitionIds) || !Array.isArray(input.rows)
        || !Array.from(input.copyIds).every(validId) || !Array.from(input.definitionIds).every(validId)
        || !Array.from(input.rows).every(validRow)) return { status: 'INVALID_INPUT' } as const;
    const projection: Extract<Projection, { status: 'candidate' }> = {
        status: 'candidate', collectionId: input.collectionId, generation: input.generation,
        copyIds: input.copyIds, definitionIds: input.definitionIds, rows: input.rows,
    };

    const copyIds = new Set(projection.copyIds);
    const definitions = new Set(projection.definitionIds);

    // Stable pair order also makes the reported conflict identity independent of input order.
    const orderedRows = [...projection.rows].sort((left, right) =>
        left.applicability.copyId - right.applicability.copyId
        || left.applicability.definitionId - right.applicability.definitionId);
    const pairs = new Map<string, QuantityImpactRow>();
    for (const row of orderedRows) {
        const { collectionId, copyId, definitionId } = row.applicability;
        if (collectionId !== projection.collectionId || !copyIds.has(copyId) || !definitions.has(definitionId)) {
            return { status: 'EVIDENCE_CONFLICT', copyId, definitionId } as const;
        }
        const key = copyId + ':' + definitionId;
        const original = pairs.get(key);
        if (original) {
            const previous = comparableEvidence(original);
            if (comparableEvidence(row).some((value, index) => !Object.is(value, previous[index]))) {
                return { status: 'EVIDENCE_CONFLICT', copyId, definitionId } as const;
            }
            continue;
        }
        pairs.set(key, row);
    }

    const inventoryByCopy = new Map<number, InventoryStatus>();
    const quantitiesByDefinition = new Map<number, string>();
    let sourceUnavailable = !definitions.has(targetDefinitionId) || pairs.size !== copyIds.size * definitions.size;
    for (const row of pairs.values()) {
        const a = row.applicability;
        if (a.status === 'unknown') {
            sourceUnavailable = true;
        } else if (a.generation !== projection.generation) {
            return { status: 'EVIDENCE_CONFLICT', copyId: a.copyId, definitionId: a.definitionId } as const;
        }
        const priorInventory = inventoryByCopy.get(a.copyId);
        const quantities = JSON.stringify([row.beforeExpected, row.afterExpected]);
        const priorQuantities = quantitiesByDefinition.get(a.definitionId);
        if ((priorInventory !== undefined && priorInventory !== row.inventory)
            || (priorQuantities !== undefined && priorQuantities !== quantities)
            || (a.definitionId !== targetDefinitionId && row.beforeExpected !== row.afterExpected)) {
            return { status: 'EVIDENCE_CONFLICT', copyId: a.copyId, definitionId: a.definitionId } as const;
        }
        inventoryByCopy.set(a.copyId, row.inventory);
        quantitiesByDefinition.set(a.definitionId, quantities);
    }
    if (sourceUnavailable) return { status: 'SOURCE_UNAVAILABLE' } as const;

    const classification = { unknown: 0, excluded: 0, not_applicable: 0, included: 0 };
    const header = { before: emptySummary(), after: emptySummary() };
    const summary = { before: emptySummary(), after: emptySummary() };
    const details: Detail[] = [];
    for (const row of pairs.values()) {
        const a = row.applicability;
        const kind = classify(row);
        if (a.definitionId === targetDefinitionId) classification[kind]++;
        if (kind !== 'included') continue;

        const previous = judge(row, row.beforeExpected);
        const next = judge(row, row.afterExpected);
        if (!add(header.before, previous) || !add(header.after, next)) {
            return { status: 'NUMERIC_OVERFLOW' } as const;
        }
        if (a.definitionId === targetDefinitionId) {
            if (!add(summary.before, previous) || !add(summary.after, next)) {
                return { status: 'NUMERIC_OVERFLOW' } as const;
            }
            const group = previous.status === 'unreadable' || next.status === 'unreadable'
                ? 'at_least_one_side_unreadable' : previous.units === next.units ? 'unchanged' : 'changed';
            details.push({ row, loaned: row.inventory === 'loaned', before: previous, after: next, group });
        }
    }
    const groups: Detail['group'][] = ['changed', 'unchanged', 'at_least_one_side_unreadable'];
    details.sort((left, right) => groups.indexOf(left.group) - groups.indexOf(right.group)
        || left.row.applicability.copyId - right.row.applicability.copyId);
    return { status: 'READY', confirmationEligible: false, classification,
        affectedCopies: classification.included, details, summary, header } as const;
}
