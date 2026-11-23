type ApplicabilityTarget = {
    collectionId: number;
    copyId: number;
    definitionId: number;
};

export type VerifiedApplicability = ApplicabilityTarget & {
    status: 'applicable' | 'not_applicable';
    revision: number;
    generation: string;
};

export type Applicability = VerifiedApplicability | (ApplicabilityTarget & {
    status: 'unknown';
    reason: 'SOURCE_UNAVAILABLE' | 'TARGET_INVALID';
});

const maxGeneration = 9223372036854775807n;

export function validApplicabilityGeneration(value: unknown): value is string {
    return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= maxGeneration;
}

function validTarget({ collectionId, copyId, definitionId }: ApplicabilityTarget) {
    return [collectionId, copyId, definitionId].every(id => Number.isSafeInteger(id) && id > 0);
}

export async function readComponentApplicability(db: D1Database, target: ApplicabilityTarget): Promise<Applicability> {
    if (!validTarget(target)) return { ...target, status: 'unknown', reason: 'TARGET_INVALID' };
    try {
        const row = await db.prepare(`
            SELECT p.id
            FROM v2_owned_copies c
            JOIN v2_physical_component_candidates p ON p.collection_item_id = c.collection_item_id
            WHERE c.collection_item_id = ? AND c.id = ? AND p.id = ?
        `).bind(target.collectionId, target.copyId, target.definitionId).first<{ id: number }>();
        if (!row) return { ...target, status: 'unknown', reason: 'TARGET_INVALID' };
    } catch {
        // Missing schema and read failures must not be mistaken for an empty exception set.
    }
    return { ...target, status: 'unknown', reason: 'SOURCE_UNAVAILABLE' };
}

type ApplicabilityChange = {
    current: VerifiedApplicability;
    next: VerifiedApplicability['status'];
    actor: string;
};

/** Executes exactly one change. The caller must authenticate the actor and authorize the target. */
export async function changeComponentApplicability(db: D1Database, change: ApplicabilityChange) {
    if (!change || typeof change !== 'object' || Array.isArray(change)
        || Object.keys(change).length !== 3) throw new Error('APPLICABILITY_CHANGE_INVALID');
    const { current, next, actor } = change;
    if (!current || typeof current !== 'object' || Array.isArray(current)
        || !validTarget(current) || typeof actor !== 'string' || !actor.trim() || !Number.isSafeInteger(current.revision)
        || current.revision < 0 || current.revision === Number.MAX_SAFE_INTEGER
        || !validApplicabilityGeneration(current.generation)
        || !['applicable', 'not_applicable'].includes(current.status)
        || !['applicable', 'not_applicable'].includes(next) || next === current.status) {
        throw new Error('APPLICABILITY_CHANGE_INVALID');
    }
    const result = await db.prepare(`
        INSERT INTO v2_component_applicability_events
            (collection_id, copy_id, definition_id, revision, before_not_applicable,
             after_not_applicable, actor, origin, before_generation)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'change', CAST(? AS INTEGER))
    `).bind(current.collectionId, current.copyId, current.definitionId, current.revision + 1,
        Number(current.status === 'not_applicable'), Number(next === 'not_applicable'), actor, current.generation).run();
    if (!result.success) throw new Error('APPLICABILITY_WRITE_FAILED');
}
