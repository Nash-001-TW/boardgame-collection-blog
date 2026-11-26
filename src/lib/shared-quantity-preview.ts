import { maxEvidenceRows } from './component-classifier-adapter';
import { HttpError } from './notbgg-admin-api';
import { isPhysicalDigest, physicalSigningKey, signPhysicalValue, verifyPhysicalValue } from './physical-component-proof';
import { projectQuantityImpact, type QuantityImpactRow } from './physical-quantity-impact';
import { createQuantityOperationId, quantityEvidenceEnvelope, quantitySha256,
    type QuantityBaseline, type QuantityEdit } from './shared-quantity-commit';

const epochPattern = /^[0-9a-f]{32}$/;

export async function currentQuantityEpoch(db: D1Database) {
    const epoch = await db.prepare('SELECT epoch FROM d1_quantity_epoch WHERE id = 1').first<string>('epoch');
    if (!epoch || !epochPattern.test(epoch)) throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    return epoch;
}

export function parseQuantityBaseline(value: unknown): QuantityBaseline {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'D1_INVALID_QUANTITY_BASELINE');
    const data = value as Record<string, unknown>;
    const { databaseEpoch, collectionId, recordScope, generation, evidenceVersion, evidenceDigest, sourceSignature } = data;
    if (Object.keys(data).length !== 7 || typeof databaseEpoch !== 'string' || !epochPattern.test(databaseEpoch)
        || typeof collectionId !== 'number' || !Number.isSafeInteger(collectionId) || collectionId < 1
        || (recordScope !== 'production' && recordScope !== 'test') || typeof generation !== 'string'
        || !/^[1-9][0-9]{0,18}$/.test(generation) || BigInt(generation) > 9223372036854775807n
        || evidenceVersion !== 1 || !isPhysicalDigest(evidenceDigest) || !isPhysicalDigest(sourceSignature)) {
        throw new HttpError(400, 'D1_INVALID_QUANTITY_BASELINE');
    }
    return { databaseEpoch, collectionId, recordScope, generation, evidenceVersion, evidenceDigest, sourceSignature };
}

function previewMessage(actor: string, id: string, edit: QuantityEdit, baseline: QuantityBaseline) {
    return JSON.stringify(['d1-quantity-preview-v1', actor, id,
        [edit.definitionId, edit.beforeRevision, edit.beforeQuantity, edit.afterQuantity, edit.name, edit.type, edit.unit, edit.reason],
        [baseline.databaseEpoch, baseline.collectionId, baseline.recordScope, baseline.generation,
            baseline.evidenceVersion, baseline.evidenceDigest, baseline.sourceSignature]]);
}

export async function verifyQuantityPreview(secret: unknown, actor: string, id: string, edit: QuantityEdit,
    baseline: QuantityBaseline, token: unknown) {
    if (!isPhysicalDigest(token)) return false;
    const key = await physicalSigningKey(secret);
    if (!key) throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    return verifyPhysicalValue(key, previewMessage(actor, id, edit, baseline), token);
}

type SnapshotRow = {
    copyId: number;
    definitionId: number;
    inventory: 'in_collection' | 'loaned';
    actual: number | null;
    inspection: QuantityImpactRow['inspection'] | null;
    countId: number | null;
    countRevision: number | null;
    evidenceStatus: string;
};

export function projectQuantitySnapshot(snapshot: { items: SnapshotRow[] },
    baseline: Pick<QuantityBaseline, 'collectionId' | 'generation'>,
    edit: Pick<QuantityEdit, 'definitionId' | 'beforeQuantity' | 'afterQuantity'>,
    applicability = new Map<number, { notApplicable: 0 | 1; revision: number }>()) {
    const rows: QuantityImpactRow[] = snapshot.items.map(item => ({
        applicability: { status: applicability.get(item.copyId)?.notApplicable === 1 ? 'not_applicable' : 'applicable',
            revision: applicability.get(item.copyId)?.revision ?? 0, generation: baseline.generation,
            collectionId: baseline.collectionId, copyId: item.copyId, definitionId: item.definitionId },
        inventory: item.inventory, inspection: item.inspection ?? 'unchecked', actual: item.actual,
        evidence: item.evidenceStatus === 'OBSERVED_CURRENT_COUNT'
            ? { kind: 'frozen', version: 1, id: `${item.countId}:${item.countRevision}` }
            : { kind: 'unavailable' },
        beforeExpected: edit.beforeQuantity, afterExpected: edit.afterQuantity,
    }));
    return projectQuantityImpact({ status: 'candidate', collectionId: baseline.collectionId,
        generation: baseline.generation, copyIds: snapshot.items.map(item => item.copyId),
        definitionIds: [edit.definitionId], rows }, edit.definitionId);
}

export async function previewSharedQuantity(db: D1Database, secret: unknown, actor: string,
    edit: QuantityEdit, sourceSignature: string) {
    const key = await physicalSigningKey(secret);
    if (!key) throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    // Read revision, scope, generation, epoch and evidence in one snapshot after proving the immutable source.
    const row = await db.prepare(`
        SELECT e.epoch AS databaseEpoch, p.collection_item_id AS collectionId, p.record_scope AS recordScope,
               CAST(g.generation AS TEXT) AS generation, p.physical_revision AS revision,
               d.expected_quantity AS expected, p.classification_rows AS classificationRows,
               ${quantityEvidenceEnvelope} AS evidence,
               (SELECT json_group_array(json_object('copyId', a.copy_id,
                   'notApplicable', a.not_applicable, 'revision', a.revision))
                FROM v2_component_applicability_current a
                WHERE a.collection_id = p.collection_item_id AND a.definition_id = p.id) AS applicability
        FROM d1_quantity_admission p
        JOIN v2_component_definitions d ON d.id = p.id
        LEFT JOIN d1_quantity_collection_generation g ON g.collection_id = p.collection_item_id
        LEFT JOIN d1_quantity_epoch e ON e.id = 1
        WHERE p.id = ? AND p.signature = ?
    `).bind(edit.beforeQuantity, edit.afterQuantity, edit.definitionId, sourceSignature).first<{
        databaseEpoch: string | null; collectionId: number; recordScope: QuantityBaseline['recordScope'];
        generation: string | null; revision: number; expected: number | null;
        classificationRows: number; evidence: string | null; applicability: string;
    }>();
    if (!row) throw new HttpError(409, 'COMPONENT_INELIGIBLE');
    if (!row.databaseEpoch || !epochPattern.test(row.databaseEpoch) || !row.generation
        || row.classificationRows > maxEvidenceRows) throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    if (row.revision !== edit.beforeRevision || row.expected !== edit.beforeQuantity) {
        throw new HttpError(409, 'COMPONENT_STATE_CHANGED');
    }
    if (!row.evidence || new TextEncoder().encode(row.evidence).length > 262144) {
        throw new HttpError(409, 'D1_EVIDENCE_TOO_LARGE');
    }

    const baseline: QuantityBaseline = {
        databaseEpoch: row.databaseEpoch, collectionId: row.collectionId, recordScope: row.recordScope,
        generation: row.generation, evidenceVersion: 1, evidenceDigest: await quantitySha256(row.evidence), sourceSignature,
    };
    const snapshot: { items: SnapshotRow[] } = JSON.parse(row.evidence);
    // The generation pins applicability without changing the commit evidence envelope.
    const pairs: { copyId: number; notApplicable: 0 | 1; revision: number }[] = JSON.parse(row.applicability);
    const impact = projectQuantitySnapshot(snapshot, baseline, edit, new Map(pairs.map(pair => [pair.copyId, pair])));
    if (impact.status !== 'READY') throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    const operationId = await createQuantityOperationId(actor, edit, baseline);
    const previewToken = await signPhysicalValue(key, previewMessage(actor, operationId, edit, baseline));
    return { operationId, baseline, previewToken, impact };
}
