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
    const row = await db.prepare(`
        SELECT COALESCE(a.not_applicable, 0) AS notApplicable,
               COALESCE(a.revision, 0) AS revision, CAST(g.generation AS TEXT) AS generation
        FROM v2_owned_copies c
        JOIN v2_physical_component_candidates p ON p.collection_item_id = c.collection_item_id
        LEFT JOIN v2_component_applicability_current a
            ON a.collection_id = c.collection_item_id AND a.copy_id = c.id AND a.definition_id = p.id
        LEFT JOIN d1_quantity_collection_generation g ON g.collection_id = c.collection_item_id
        WHERE c.collection_item_id = ? AND c.id = ? AND p.id = ?
    `).bind(target.collectionId, target.copyId, target.definitionId)
        .first<{ notApplicable: 0 | 1; revision: number; generation: string | null }>();
    if (!row) return { ...target, status: 'unknown', reason: 'TARGET_INVALID' };
    if (!validApplicabilityGeneration(row.generation)) throw new Error('APPLICABILITY_GENERATION_CHANGED');
    return {
        ...target,
        status: row.notApplicable === 1 ? 'not_applicable' : 'applicable',
        revision: row.revision,
        generation: row.generation,
    };
}

export async function readCollectionApplicability(db: D1Database, collectionId: number) {
    if (!Number.isSafeInteger(collectionId) || collectionId <= 0) throw new Error('APPLICABILITY_TARGET_INVALID');
    const result = await db.prepare(`
        SELECT a.copy_id AS copyId, a.definition_id AS definitionId, a.revision
        FROM v2_component_applicability_current a
        JOIN v2_owned_copies c ON c.id = a.copy_id AND c.collection_item_id = a.collection_id
        JOIN v2_physical_component_candidates p ON p.id = a.definition_id AND p.collection_item_id = a.collection_id
        WHERE a.collection_id = ? AND a.not_applicable = 1
        ORDER BY a.copy_id, a.definition_id
    `).bind(collectionId).all<{ copyId: number; definitionId: number; revision: number }>();
    if (!result.success) throw new Error('APPLICABILITY_READ_FAILED');
    return result.results;
}

type ApplicabilityChange = ApplicabilityTarget & {
    revision: number;
    next: VerifiedApplicability['status'];
    actor: string;
};

/** The Admin API must authenticate the actor, authorize the target and verify the component's confirmation. */
export async function changeComponentApplicability(db: D1Database, change: ApplicabilityChange) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
        throw new Error('APPLICABILITY_CHANGE_INVALID');
    }
    const { collectionId, copyId, definitionId, revision, next, actor } = change;
    if (!validTarget(change) || !Number.isSafeInteger(revision) || revision < 0
        || revision === Number.MAX_SAFE_INTEGER || (next !== 'applicable' && next !== 'not_applicable')
        || typeof actor !== 'string' || !actor.trim() || [...actor.trim()].length > 320) {
        throw new Error('APPLICABILITY_CHANGE_INVALID');
    }

    // The trigger checks the expected previous state and revision. The SQL snapshot supplies
    // the collection generation so unrelated writes do not conflict with this pair's revision.
    const after = Number(next === 'not_applicable');
    const result = await db.prepare(`
        INSERT INTO v2_component_applicability_events
            (collection_id, copy_id, definition_id, revision, before_not_applicable,
             after_not_applicable, actor, origin, before_generation)
        SELECT ?, ?, ?, ?, ?, ?, ?, 'change',
            (SELECT generation FROM d1_quantity_collection_generation WHERE collection_id = ?)
    `).bind(collectionId, copyId, definitionId, revision + 1, 1 - after, after, actor, collectionId).run();
    if (!result.success) throw new Error('APPLICABILITY_WRITE_FAILED');
}
