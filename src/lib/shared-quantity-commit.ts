import { maxEvidenceRows } from './component-classifier-adapter';
import { HttpError } from './notbgg-admin-api';

export type QuantityEdit = {
    definitionId: number; beforeRevision: number;
    beforeQuantity: number | null; afterQuantity: number | null;
    name: string; type: string; unit: string; reason: string;
};
export type QuantityBaseline = {
    databaseEpoch: string; collectionId: number; recordScope: 'production' | 'test';
    generation: string; evidenceVersion: 1; evidenceDigest: string; sourceSignature: string;
};
type Receipt = {
    actor: string; digest: string; definitionId: number; revision: number;
    beforeQuantity: number | null; afterQuantity: number | null; recordedAt: number;
};
type Observation = {
    receipt: Receipt | null; advanced: number; archived: number;
};

const idPattern = /^q1\.[0-9a-f]{32}\.[0-9a-f]{64}$/;
const hexDigest = /^[0-9a-f]{64}$/;

export async function quantitySha256(value: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function quantityFingerprint(actor: string, edit: QuantityEdit, baseline: QuantityBaseline) {
    if (typeof baseline.generation !== 'string' || !/^[1-9][0-9]{0,18}$/.test(baseline.generation)
        || BigInt(baseline.generation) > 9223372036854775807n
        || !Number.isSafeInteger(baseline.collectionId) || baseline.collectionId < 1
        || !['production', 'test'].includes(baseline.recordScope)
        || !baseline.databaseEpoch || baseline.evidenceVersion !== 1
        || !hexDigest.test(baseline.evidenceDigest) || !hexDigest.test(baseline.sourceSignature)) {
        throw new HttpError(400, 'D1_INVALID_QUANTITY_BASELINE');
    }
    if (!Number.isSafeInteger(edit.definitionId) || edit.definitionId < 1
        || !Number.isSafeInteger(edit.beforeRevision) || edit.beforeRevision < 1
        || edit.beforeRevision >= Number.MAX_SAFE_INTEGER
        || ![edit.beforeQuantity, edit.afterQuantity].every(value =>
            value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 100000))
        || edit.beforeQuantity === edit.afterQuantity
        || ![edit.name, edit.type, edit.unit, edit.reason].every(value => typeof value === 'string' && value.trim().length > 0)) {
        throw new HttpError(400, 'D1_INVALID_QUANTITY_EDIT');
    }
    // Fixed UTF-8 JSON tuple. Missing fields are invalid; null and zero remain distinct.
    return quantitySha256(JSON.stringify(['d1:r06:quantity:q1', actor, baseline.databaseEpoch,
        baseline.recordScope, baseline.collectionId, edit.definitionId, edit.beforeRevision,
        baseline.generation, baseline.evidenceVersion, baseline.evidenceDigest, baseline.sourceSignature,
        edit.beforeQuantity, edit.afterQuantity, edit.name, edit.type, edit.unit, edit.reason]));
}

export async function createQuantityOperationId(actor: string, edit: QuantityEdit, baseline: QuantityBaseline) {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    return 'q1.' + nonce + '.' + await quantityFingerprint(actor, edit, baseline);
}

export const quantityEvidenceEnvelope = `CASE WHEN p.evidence_items IS NOT NULL THEN
    json_object('version', 1, 'rule', 'expected-minus-checked-v1',
        'oldExpected', CAST(? AS INTEGER), 'newExpected', CAST(? AS INTEGER), 'items', json(p.evidence_items))
END`;

export function logQuantityError(stage: string, operationId: string | undefined, error: unknown) {
    const kind = error instanceof HttpError ? 'HttpError'
        : error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : typeof error;
    console.error('D1 quantity operation failed', { stage, operationId: operationId && idPattern.test(operationId)
        ? operationId : undefined, kind });
}

export function logQuantitySuccess(operationId: string, replayed: boolean) {
    console.info('D1 quantity operation succeeded', { stage: 'commit', operationId, outcome: 'COMMITTED', replayed });
}

function rejected(operationId: string, code: string) {
    return { operationId, outcome: 'NOT_COMMITTED' as const, code };
}

const receiptColumns = 'h.actor, h.digest, h.definition_id AS definitionId, h.after_revision AS revision, '
    + 'h.before_quantity AS beforeQuantity, h.after_quantity AS afterQuantity, h.committed_at AS recordedAt';

function committed(operationId: string, row: Receipt, actor: string, digest: string, replayed: boolean) {
    if (row.actor !== actor || row.digest !== digest) return rejected(operationId, 'IDEMPOTENCY_CONFLICT');
    return { operationId, outcome: 'COMMITTED' as const, id: row.definitionId, revision: row.revision,
        beforeQuantity: row.beforeQuantity, afterQuantity: row.afterQuantity, recordedAt: row.recordedAt, replayed };
}

function unknown(operationId: string) {
    return { operationId, outcome: 'UNKNOWN' as const };
}

async function readReceipt(db: D1Database, id: string) {
    // Use the primary binding directly, without a replica session.
    return db.prepare('SELECT ' + receiptColumns + ' FROM d1_quantity_changes h WHERE h.operation_id = ?')
        .bind(id).first<Receipt>();
}

export async function recoverQuantityResult(db: D1Database, actor: string, id: string, digest: string) {
    try {
        const receipt = await readReceipt(db, id);
        return receipt ? committed(id, receipt, actor, digest, true) : unknown(id);
    } catch (error) {
        logQuantityError('receipt', id, error);
        return unknown(id);
    }
}

export async function quantityOperationStatus(db: D1Database, actor: string, key: string | null) {
    if (!key || !/^[A-Za-z0-9_.-]{8,128}$/.test(key)) throw new HttpError(400, 'D1_OPERATION_ID_REQUIRED');
    // Legacy IDs cannot write here. Absence of migration evidence leaves their result unknown.
    if (!idPattern.test(key)) return unknown(key);
    const row = await readReceipt(db, key).catch(error => {
        logQuantityError('receipt', key, error);
        return null;
    });
    if (row && (row.actor !== actor || row.digest !== key.slice(36))) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
    return row ? committed(key, row, actor, key.slice(36), true) : unknown(key);
}

async function observe(db: D1Database, id: string, baseline: QuantityBaseline): Promise<Observation | null> {
    // Receipt and irreversible invalidation must be observed in the same primary read.
    try {
        const row = await db.prepare(`
        SELECT ${receiptColumns},
               COALESCE(g.generation > CAST(? AS INTEGER), 0) AS advanced,
               m.archived_at IS NOT NULL AS archived
        FROM (SELECT ? AS operation_id, ? AS collection_id) k
        LEFT JOIN d1_quantity_changes h ON h.operation_id = k.operation_id
        LEFT JOIN d1_quantity_collection_generation g ON g.collection_id = k.collection_id
        LEFT JOIN v2_collection_management m ON m.collection_item_id = k.collection_id
        `).bind(baseline.generation, id, baseline.collectionId)
            .first<Receipt & { advanced: number; archived: number }>();
        return row && { receipt: row.actor === null ? null : row, advanced: row.advanced, archived: row.archived };
    } catch (error) {
        logQuantityError('observation', id, error);
        return null;
    }
}

function outcome(id: string, actor: string, digest: string, observation: Observation | null, replayed = true) {
    if (observation?.receipt) return committed(id, observation.receipt, actor, digest, replayed);
    if (observation && (observation.advanced === 1 || observation.archived === 1)) {
        return { operationId: id, fingerprint: digest, outcome: 'PERMANENTLY_REJECTED' as const,
            code: observation.archived ? 'COLLECTION_ARCHIVED' : 'D1_CONFIRMATION_SUPERSEDED',
            ...(observation.archived && { message: '此收藏已封存，無法更正預期數量' }) };
    }
    return unknown(id);
}

type VerifyConfirmation = () => Promise<boolean>;

export async function confirmedQuantityOperationStatus(
    db: D1Database, actor: string, id: string, edit: QuantityEdit, baseline: QuantityBaseline,
    verifyConfirmation: VerifyConfirmation,
) {
    const checked = await checkOperation(db, actor, id, edit, baseline, verifyConfirmation);
    if ('outcome' in checked) return checked;
    const current = await observe(db, id, baseline);
    return current ? outcome(id, actor, checked.digest, current)
        : recoverQuantityResult(db, actor, id, checked.digest);
}

async function checkOperation(db: D1Database, actor: string, id: string, edit: QuantityEdit,
    baseline: QuantityBaseline, verifyConfirmation: VerifyConfirmation) {
    if (!idPattern.test(id)) throw new HttpError(400, 'D1_OPERATION_ID_REQUIRED');
    const digest = await quantityFingerprint(actor, edit, baseline);
    let verified;
    try {
        verified = await verifyConfirmation();
    } catch (error) {
        logQuantityError('confirmation', id, error);
        return recoverQuantityResult(db, actor, id, digest);
    }
    if (digest !== id.slice(36)) {
        // A receipt can identify a same-actor conflict without disclosing it to another actor.
        try {
            const receipt = await readReceipt(db, id);
            return rejected(id, verified || receipt?.actor === actor ? 'IDEMPOTENCY_CONFLICT' : 'D1_PREVIEW_INVALID');
        } catch (error) {
            logQuantityError('receipt', id, error);
            return unknown(id);
        }
    }
    if (!verified) return rejected(id, 'D1_PREVIEW_INVALID');
    return { digest };
}

export async function commitSharedQuantity(
    db: D1Database, actor: string, id: string, edit: QuantityEdit, baseline: QuantityBaseline,
    verifyConfirmation: VerifyConfirmation,
) {
    const checked = await checkOperation(db, actor, id, edit, baseline, verifyConfirmation);
    if ('outcome' in checked) return checked;
    const { digest } = checked;
    const before = await observe(db, id, baseline);
    if (!before) return recoverQuantityResult(db, actor, id, digest);
    if (before.receipt || before.advanced || before.archived) return outcome(id, actor, digest, before);

    let candidate;
    try {
        candidate = await db.prepare(`
            SELECT p.classification_rows AS classificationRows, ${quantityEvidenceEnvelope} AS evidence
            FROM d1_quantity_admission p
            JOIN d1_quantity_collection_generation g ON g.collection_id = p.collection_item_id
            JOIN v2_component_definitions d ON d.id = p.id
            WHERE p.id = ? AND p.collection_item_id = ? AND p.record_scope = ?
              AND p.signature = ? AND g.generation = CAST(? AS INTEGER)
              AND p.physical_revision = ? AND d.expected_quantity IS ?
        `).bind(edit.beforeQuantity, edit.afterQuantity, edit.definitionId, baseline.collectionId,
            baseline.recordScope, baseline.sourceSignature, baseline.generation, edit.beforeRevision, edit.beforeQuantity)
            .first<{ classificationRows: number; evidence: string | null }>();
        if (!candidate) {
            const current = await observe(db, id, baseline);
            if (!current) return recoverQuantityResult(db, actor, id, digest);
            if (current.receipt || current.advanced || current.archived) return outcome(id, actor, digest, current);
            return rejected(id, 'D1_CONFIRMATION_SUPERSEDED');
        }
        if (candidate.classificationRows > maxEvidenceRows) return rejected(id, 'EVIDENCE_UNAVAILABLE');
        if (!candidate.evidence || new TextEncoder().encode(candidate.evidence).length > 262144
            || await quantitySha256(candidate.evidence) !== baseline.evidenceDigest) {
            return rejected(id, 'D1_CONFIRMATION_SUPERSEDED');
        }
    } catch (error) {
        logQuantityError('admission', id, error);
        return recoverQuantityResult(db, actor, id, digest);
    }

    let replayed = true;
    let typeInUse = false;
    let admissionRejected = false;
    try {
        const written = await db.prepare(`
            INSERT INTO d1_quantity_changes(operation_id, actor, digest, definition_id, collection_id,
                record_scope, source_signature, before_revision, before_quantity, after_quantity,
                name, component_type, unit, reason, evidence_json, before_generation, after_revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS INTEGER), ?)
        `).bind(id, actor, digest, edit.definitionId, baseline.collectionId,
            baseline.recordScope, baseline.sourceSignature, edit.beforeRevision, edit.beforeQuantity,
            edit.afterQuantity, edit.name, edit.type, edit.unit, edit.reason, candidate.evidence,
            baseline.generation, edit.beforeRevision + 1).run();
        replayed = !written.success;
        if (!written.success) logQuantityError('write', id, undefined);
    } catch (error) {
        // The primary read resolves a lost response or a competing commit before classifying SQL rejection.
        logQuantityError('write', id, error);
        typeInUse = error instanceof Error && error.message.includes('PHYSICAL_TYPE_IN_USE');
        admissionRejected = error instanceof Error && error.message.includes('D1_QUANTITY_STATE_CHANGED');
    }
    const current = await observe(db, id, baseline);
    if (!current) return recoverQuantityResult(db, actor, id, digest);
    if (!current.receipt && !current.advanced && !current.archived) {
        if (typeInUse) return rejected(id, 'COMPONENT_INELIGIBLE');
        if (admissionRejected) {
            try {
                const rows = await db.prepare('SELECT classification_rows FROM d1_quantity_admission WHERE id = ?')
                    .bind(edit.definitionId).first<number>('classification_rows');
                if (rows !== null && rows > maxEvidenceRows) return rejected(id, 'EVIDENCE_UNAVAILABLE');
            } catch (error) {
                logQuantityError('admission after write', id, error);
                return recoverQuantityResult(db, actor, id, digest);
            }
        }
    }
    return outcome(id, actor, digest, current, replayed);
}
