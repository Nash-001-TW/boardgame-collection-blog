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

const receiptColumns = 'h.actor, h.digest, h.definition_id AS definitionId, h.after_revision AS revision, '
    + 'h.before_quantity AS beforeQuantity, h.after_quantity AS afterQuantity, h.committed_at AS recordedAt';

function committed(operationId: string, row: Receipt, actor: string, digest: string, replayed: boolean) {
    if (row.actor !== actor || row.digest !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
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

export async function quantityOperationStatus(db: D1Database, actor: string, key: string | null) {
    if (!key || !/^[A-Za-z0-9_.-]{8,128}$/.test(key)) throw new HttpError(400, 'D1_OPERATION_ID_REQUIRED');
    // Legacy IDs cannot write here. Absence of migration evidence leaves their result unknown.
    if (!idPattern.test(key)) return unknown(key);
    const row = await readReceipt(db, key).catch(() => null);
    return row ? committed(key, row, actor, key.slice(36), true) : unknown(key);
}

async function observe(db: D1Database, id: string, baseline: QuantityBaseline): Promise<Observation | null> {
    // Receipt and irreversible invalidation must be observed in the same primary read.
    const row = await db.prepare(`
        SELECT ${receiptColumns},
               COALESCE(g.generation > CAST(? AS INTEGER), 0) AS advanced,
               m.archived_at IS NOT NULL AS archived
        FROM (SELECT ? AS operation_id, ? AS collection_id) k
        LEFT JOIN d1_quantity_changes h ON h.operation_id = k.operation_id
        LEFT JOIN d1_quantity_collection_generation g ON g.collection_id = k.collection_id
        LEFT JOIN v2_collection_management m ON m.collection_item_id = k.collection_id
    `).bind(baseline.generation, id, baseline.collectionId)
        .first<Receipt & { advanced: number; archived: number }>().catch(() => null);
    return row && { receipt: row.actor === null ? null : row, advanced: row.advanced, archived: row.archived };
}

function outcome(id: string, actor: string, digest: string, observation: Observation | null, replayed = true) {
    if (observation?.receipt) return committed(id, observation.receipt, actor, digest, replayed);
    if (observation?.advanced === 1) {
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
    const digest = await boundFingerprint(actor, id, edit, baseline);
    const receipt = await readReceipt(db, id).catch(() => undefined);
    if (receipt === undefined) return unknown(id);
    if (receipt) return committed(id, receipt, actor, digest, true);
    if (!await verifyConfirmation().catch(() => false)) return unknown(id);
    return outcome(id, actor, digest, await observe(db, id, baseline));
}

async function boundFingerprint(actor: string, id: string, edit: QuantityEdit, baseline: QuantityBaseline) {
    const digest = await quantityFingerprint(actor, edit, baseline);
    if (!idPattern.test(id) || id.slice(36) !== digest) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
    return digest;
}

export async function commitSharedQuantity(
    db: D1Database, actor: string, id: string, edit: QuantityEdit, baseline: QuantityBaseline,
    verifyConfirmation: VerifyConfirmation,
) {
    const digest = await boundFingerprint(actor, id, edit, baseline);

    const receipt = await readReceipt(db, id).catch(() => undefined);
    if (receipt === undefined) return unknown(id);
    if (receipt) return committed(id, receipt, actor, digest, true);

    // Internal candidate only. The future R12 caller must authenticate the original preview,
    // including its database epoch and source proof. Stale authentic previews must still verify.
    if (!await verifyConfirmation().catch(() => false)) return unknown(id);
    const before = await observe(db, id, baseline);
    if (!before || before.receipt || before.advanced) return outcome(id, actor, digest, before);

    let replayed = true;
    try {
        const candidate = await db.prepare(`
            SELECT json_object('version', 1, 'rule', 'expected-minus-checked-v1',
                'oldExpected', CAST(? AS INTEGER), 'newExpected', CAST(? AS INTEGER), 'items', json(p.evidence_items)) AS evidence
            FROM d1_quantity_admission p
            JOIN d1_quantity_collection_generation g ON g.collection_id = p.collection_item_id
            WHERE p.id = ? AND p.collection_item_id = ? AND p.record_scope = ?
              AND p.signature = ? AND g.generation = CAST(? AS INTEGER)
              AND p.evidence_items IS NOT NULL
        `).bind(edit.beforeQuantity, edit.afterQuantity, edit.definitionId, baseline.collectionId,
            baseline.recordScope, baseline.sourceSignature, baseline.generation).first<{ evidence: string }>();
        if (candidate && new TextEncoder().encode(candidate.evidence).length <= 262144
            && await quantitySha256(candidate.evidence) === baseline.evidenceDigest) {
            const written = await db.prepare(`
                INSERT INTO d1_quantity_changes(operation_id, actor, digest, definition_id, collection_id,
                    record_scope, source_signature, before_revision, before_quantity, after_quantity,
                    name, component_type, unit, reason, evidence_json, before_generation, after_revision)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS INTEGER), ?)
            `).bind(id, actor, digest, edit.definitionId, baseline.collectionId, baseline.recordScope,
                baseline.sourceSignature, edit.beforeRevision, edit.beforeQuantity, edit.afterQuantity,
                edit.name, edit.type, edit.unit, edit.reason, candidate.evidence, baseline.generation, edit.beforeRevision + 1).run();
            replayed = !written.success;
        }
    } catch {
        // A lost write response can still have a committed receipt.
    }
    return outcome(id, actor, digest, await observe(db, id, baseline), replayed);
}
