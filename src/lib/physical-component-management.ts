import { classifyStoredComponents, maxEvidenceRows } from './component-classifier-adapter';
import { physicalSigningKey, physicalSourceMessage, signPhysicalValue } from './physical-component-proof';
import { HttpError } from './notbgg-admin-api';

import { componentTypes, componentUnits, maxComponentQuantity } from './physical-component-values';

const evidenceSize = `(
    (SELECT COUNT(*) FROM v2_component_definitions) +
    (SELECT COUNT(*) FROM collection_components) +
    (SELECT COUNT(*) FROM collection_items) +
    (SELECT COUNT(*) FROM v2_collection_items) +
    (SELECT COUNT(*) FROM v2_legacy_id_map
        WHERE (legacy_table = 'collection_components' AND target_table = 'v2_component_definitions')
           OR (legacy_table = 'collection_items' AND target_table = 'v2_collection_items'))
)`;

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new HttpError(400, 'INVALID_COMPONENT_INPUT');
    }
    return value;
}

function fields(body: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'UNKNOWN_FIELD');
}

function attributes(body: Record<string, unknown>) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const type = body.type as typeof componentTypes[number];
    const unit = body.unit as typeof componentUnits[number];
    if (!name || name.length > 160 || !componentTypes.includes(type) || !componentUnits.includes(unit)
        || (type === 'card') !== (unit === 'card')) throw new HttpError(400, 'INVALID_COMPONENT_INPUT');
    const expected = body.expected === null ? null : integer(body.expected, 1, maxComponentQuantity);
    return { name, type, unit, expected };
}

async function writeOne(db: D1Database, statement: D1PreparedStatement) {
    const result = await statement.first<{ id: number }>();
    if (result) return result;
    if ((await db.prepare(`SELECT ${evidenceSize} AS total`).first<number>('total') ?? maxEvidenceRows + 1) > maxEvidenceRows) {
        throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    }
    throw new HttpError(409, 'COMPONENT_STATE_CHANGED');
}

async function create(db: D1Database, secret: unknown, actor: string, keyValue: string | null, body: Record<string, unknown>) {
    fields(body, ['action', 'collectionId', 'name', 'type', 'unit', 'expected', 'confirmed']);
    const collectionId = integer(body.collectionId, 1);
    const data = attributes(body);
    if (body.confirmed !== true || !keyValue || !/^[A-Za-z0-9_-]{8,128}$/.test(keyValue)) {
        throw new HttpError(400, 'COMPONENT_CONFIRMATION_REQUIRED');
    }
    const key = await physicalSigningKey(secret);
    if (!key) throw new HttpError(503, 'PHYSICAL_SIGNING_UNAVAILABLE');
    const collection = await db.prepare(`
        SELECT c.record_scope AS scope FROM v2_collection_items c
        LEFT JOIN v2_collection_management m ON m.collection_item_id = c.id
        WHERE c.id = ? AND m.archived_at IS NULL
    `).bind(collectionId).first<{ scope: string }>();
    if (!collection) throw new HttpError(404, 'COLLECTION_UNAVAILABLE');

    const token = await signPhysicalValue(key, JSON.stringify(['physical-create-key', actor, keyValue]));
    const digest = await signPhysicalValue(key, JSON.stringify(['physical-create-request', collectionId, collection.scope, data]));
    const signature = await signPhysicalValue(key, physicalSourceMessage(token, collectionId, collection.scope, actor, digest));
    const replay = async () => {
        const source = await db.prepare(`
            SELECT definition_id AS id, request_digest AS digest, signature FROM v2_physical_component_sources
            WHERE creation_token = ?
        `).bind(token).first<{ id: number; digest: string; signature: string }>();
        if (!source) return null;
        if (source.digest !== digest || source.signature !== signature) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
        return { id: source.id, replayed: true };
    };
    const existing = await replay();
    if (existing) return existing;
    if ((await db.prepare(`SELECT ${evidenceSize} AS total`).first<number>('total') ?? maxEvidenceRows) >= maxEvidenceRows) {
        throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    }

    try {
        const inserted = await db.batch<{ id: number }>([
            db.prepare(`
                INSERT INTO v2_component_definitions
                    (collection_item_id, component_name, component_type, expected_quantity, quantity_unit,
                     physical_creation_token, physical_revision)
                SELECT c.id, ?, ?, ?, ?, ?, 1 FROM v2_collection_items c
                LEFT JOIN v2_collection_management m ON m.collection_item_id = c.id
                WHERE c.id = ? AND c.record_scope = ? AND m.archived_at IS NULL AND ${evidenceSize} < ?
                RETURNING id
            `).bind(data.name, data.type, data.expected, data.unit, token, collectionId, collection.scope, maxEvidenceRows),
            db.prepare(`
                INSERT INTO v2_physical_component_sources
                    (definition_id, collection_item_id, record_scope, creation_token, actor, request_digest, signature)
                VALUES ((SELECT id FROM v2_component_definitions WHERE physical_creation_token = ?), ?, ?, ?, ?, ?, ?)
            `).bind(token, collectionId, collection.scope, token, actor, digest, signature),
        ]);
        return { id: inserted[0].results[0].id, replayed: false };
    } catch (error) {
        const existing = await replay();
        if (existing) return existing;
        if ((await db.prepare(`SELECT ${evidenceSize} AS total`).first<number>('total') ?? maxEvidenceRows) >= maxEvidenceRows) {
            throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
        }
        if (String(error).includes('NOT NULL constraint failed: v2_physical_component_sources.definition_id')) {
            throw new HttpError(409, 'COMPONENT_STATE_CHANGED');
        }
        throw error;
    }
}

export async function writePhysicalComponent(
    db: D1Database, secret: unknown, actor: string, key: string | null, body: Record<string, unknown>,
) {
    if (body.action === 'create') return create(db, secret, actor, key, body);
    const action = body.action;
    if (action !== 'edit' && action !== 'count' && action !== 'assign') throw new HttpError(400, 'INVALID_COMPONENT_ACTION');
    const common = ['action', 'definitionId', 'definitionRevision'];
    fields(body, [...common, ...(action === 'edit' ? ['name', 'type', 'unit', 'expected']
        : action === 'count' ? ['copyId', 'revision', 'actual'] : ['requirementId', 'revision'])]);
    const definitionId = integer(body.definitionId, 1);
    const definitionRevision = integer(body.definitionRevision, 1);
    const [classification] = await classifyStoredComponents(db, [definitionId], { secret });
    if (classification.reason === 'EVIDENCE_UNAVAILABLE') throw new HttpError(503, 'EVIDENCE_UNAVAILABLE');
    const signature = classification.evidence.physicalSignature;
    if (!signature || !classification.canUseForInventory || (action === 'assign' && !classification.canAssignToSleeves)) {
        throw new HttpError(409, 'COMPONENT_INELIGIBLE');
    }

    // Pin the verified proof and definition revision, and recheck structural eligibility and the global
    // evidence limit inside the mutation. Source and token are immutable; concurrent archive or map wins.
    const candidate = `SELECT p.* FROM v2_physical_component_candidates p
        WHERE p.id = ? AND p.physical_revision = ? AND p.signature = ? AND ${evidenceSize} <= ?`;
    const proof = [definitionId, definitionRevision, signature, maxEvidenceRows];
    if (action === 'edit') {
        const data = attributes(body);
        return writeOne(db, db.prepare(`
            UPDATE v2_component_definitions
            SET component_name = ?, component_type = ?, expected_quantity = ?, quantity_unit = ?,
                physical_revision = physical_revision + 1, updated_at = CURRENT_TIMESTAMP
            WHERE id IN (SELECT id FROM (${candidate}))
            RETURNING id
        `).bind(data.name, data.type, data.expected, data.unit, ...proof));
    }

    const revision = integer(body.revision, 0);
    if (action === 'count') {
        const copyId = integer(body.copyId, 1);
        const actual = integer(body.actual, 0, maxComponentQuantity);
        return writeOne(db, db.prepare(`
            INSERT INTO v2_copy_components
                (owned_copy_id, component_definition_id, actual_quantity, inspection_status, last_checked_at, count_revision)
            SELECT c.id, p.id, ?, 'checked', CURRENT_TIMESTAMP, 1 FROM (${candidate}) p
            JOIN v2_owned_copies c ON c.id = ? AND c.collection_item_id = p.collection_item_id
            WHERE c.inventory_status = 'in_collection' AND c.seal_status <> 'sealed'
              AND COALESCE((SELECT count_revision FROM v2_copy_components
                WHERE owned_copy_id = c.id AND component_definition_id = p.id), 0) = ?
            ON CONFLICT(owned_copy_id, component_definition_id) DO UPDATE SET
                actual_quantity = excluded.actual_quantity, inspection_status = excluded.inspection_status,
                last_checked_at = excluded.last_checked_at, count_revision = v2_copy_components.count_revision + 1
            RETURNING id
        `).bind(actual, ...proof, copyId, revision));
    }

    const requirementId = integer(body.requirementId, 1);
    return writeOne(db, db.prepare(`
        UPDATE v2_sleeve_requirements
        SET component_definition_id = ?, assignment_status = 'confirmed', updated_at = CURRENT_TIMESTAMP,
            assignment_revision = assignment_revision + 1
        WHERE id = ? AND assignment_revision = ? AND component_definition_id IS NULL
          AND EXISTS (SELECT 1 FROM (${candidate}) p
              WHERE p.collection_item_id = v2_sleeve_requirements.collection_item_id
                AND p.component_type = 'card' AND p.quantity_unit = 'card'
                AND (v2_sleeve_requirements.owned_copy_id IS NULL OR EXISTS (
                    SELECT 1 FROM v2_owned_copies c WHERE c.id = v2_sleeve_requirements.owned_copy_id
                    AND c.collection_item_id = p.collection_item_id)))
        RETURNING id
    `).bind(definitionId, requirementId, revision, ...proof));
}
