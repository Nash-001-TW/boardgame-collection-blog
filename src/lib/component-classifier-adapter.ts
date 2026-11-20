import { isPhysicalDigest, physicalSigningKey, physicalSourceMessage, verifyPhysicalValue } from "./physical-component-proof";
import {
    classifyComponentDefinitions,
    type ComponentClassificationResult,
    type ComponentClassificationSnapshot,
} from "./component-classifier";

type CompleteSnapshot = Extract<ComponentClassificationSnapshot, { status: "complete" }>;

// Same prepare().all() interface as the collection repositories. The caller
// supplies the server binding; this module does not obtain it from a request.
interface EvidenceDatabase {
    prepare(sql: string): {
        all(): Promise<{ success: boolean; results: readonly unknown[] }>;
    };
}

export const maxEvidenceRows = 10_000;
const unavailable: ComponentClassificationSnapshot = { status: "unavailable" };

// Use one statement so the forward and reverse checks see the same snapshot.
// Read every definition's raw Notes, including definitions outside the request.
const legacyProjection = `'id', id, 'collection_item_id', collection_item_id, 'notes', notes
        ) FROM v2_component_definitions`;
const physicalProjection = `'id', d.id, 'collection_item_id', d.collection_item_id, 'notes', d.notes,
        'physical_token', d.physical_creation_token, 'source_token', p.creation_token,
        'source_collection', p.collection_item_id, 'source_scope', p.record_scope,
        'collection_scope', c.record_scope, 'source_actor', p.actor,
        'source_digest', p.request_digest, 'source_signature', p.signature,
        'component_type', d.component_type, 'quantity_unit', d.quantity_unit,
        'legacy_target', EXISTS(SELECT 1 FROM v2_legacy_id_map m
            WHERE m.target_table = 'v2_component_definitions' AND m.target_id = d.id)
    ) FROM v2_component_definitions d
      LEFT JOIN v2_physical_component_sources p ON p.definition_id = d.id
      LEFT JOIN v2_collection_items c ON c.id = d.collection_item_id`;

const evidenceSql = (physical: boolean) => /* sql */ `
    WITH evidence(kind, payload) AS (
        SELECT 'definition', json_object(
            ${physical ? physicalProjection : legacyProjection}
        UNION ALL
        SELECT 'legacy_component', json_object(
            'id', id, 'collection_item_id', collection_item_id, 'component_type', component_type
        ) FROM collection_components
        UNION ALL
        SELECT 'legacy_collection', json_object('id', id) FROM collection_items
        UNION ALL
        SELECT 'collection', json_object('id', id) FROM v2_collection_items
        UNION ALL
        SELECT 'map', json_object(
            'legacy_table', legacy_table, 'legacy_id', legacy_id,
            'target_table', target_table, 'target_id', target_id
        ) FROM v2_legacy_id_map
        WHERE (legacy_table = 'collection_components' AND target_table = 'v2_component_definitions')
           OR (legacy_table = 'collection_items' AND target_table = 'v2_collection_items')
    )
    SELECT kind, payload, COUNT(*) OVER () AS total_rows
    FROM evidence
    LIMIT ${maxEvidenceRows + 1}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

type PendingProof = { source: { signature: string | null }; message: string; signature: string };

function toSnapshot(rows: readonly unknown[], proofs: Map<number, PendingProof>): ComponentClassificationSnapshot {
    if (rows.length > maxEvidenceRows) return unavailable;

    const definitions: CompleteSnapshot["definitions"][number][] = [];
    const legacyComponents: CompleteSnapshot["legacyComponents"][number][] = [];
    const legacyCollections: CompleteSnapshot["legacyCollections"][number][] = [];
    const collections: CompleteSnapshot["collections"][number][] = [];
    const legacyMaps: CompleteSnapshot["legacyMaps"][number][] = [];

    for (const row of rows) {
        if (!isRecord(row) || row.total_rows !== rows.length || typeof row.payload !== "string") {
            return unavailable;
        }
        const payload: unknown = JSON.parse(row.payload);
        if (!isRecord(payload)) return unavailable;

        if (row.kind === "map") {
            const { legacy_table, legacy_id, target_table, target_id } = payload;
            if (typeof legacy_table !== "string" || typeof legacy_id !== "string"
                || typeof target_table !== "string" || !isId(target_id)) return unavailable;
            legacyMaps.push({ legacy_table, legacy_id, target_table, target_id });
            continue;
        }

        const { id } = payload;
        if (!isId(id)) return unavailable;
        switch (row.kind) {
            case "definition": {
                const { collection_item_id, notes } = payload;
                if (!isId(collection_item_id) || (notes !== null && typeof notes !== "string")) return unavailable;
                if (!Object.hasOwn(payload, "physical_token")) {
                    definitions.push({ id, collection_item_id, notes });
                    break;
                }
                const { physical_token, source_token, source_collection, source_scope, collection_scope,
                    source_actor, source_digest, source_signature, legacy_target, component_type, quantity_unit } = payload;
                if (physical_token === null && source_token === null) {
                    definitions.push({ id, collection_item_id, notes });
                    break;
                }
                if (legacy_target !== 0 && legacy_target !== 1) return unavailable;
                const source = {
                    signature: null as string | null,
                    hasLegacyTarget: legacy_target === 1,
                    card: component_type === "card" && quantity_unit === "card",
                };
                if (isPhysicalDigest(physical_token) && source_token === physical_token
                    && source_collection === collection_item_id && source_scope === collection_scope
                    && (source_scope === "production" || source_scope === "test")
                    && typeof source_actor === "string" && source_actor.trim()
                    && isPhysicalDigest(source_digest) && isPhysicalDigest(source_signature)) {
                    const message = physicalSourceMessage(physical_token, collection_item_id, source_scope, source_actor, source_digest);
                    proofs.set(id, { source, message, signature: source_signature });
                }
                definitions.push({ id, collection_item_id, notes, physicalSource: source });
                break;
            }
            case "legacy_component": {
                const { collection_item_id, component_type } = payload;
                if (!isId(collection_item_id) || typeof component_type !== "string") return unavailable;
                legacyComponents.push({ id, collection_item_id, component_type });
                break;
            }
            case "legacy_collection":
                legacyCollections.push({ id });
                break;
            case "collection":
                collections.push({ id });
                break;
            default:
                return unavailable;
        }
    }
    return { status: "complete", definitions, legacyComponents, legacyCollections, collections, legacyMaps };
}

/**
 * Internal server-only read. IDs select results, not the evidence needed to
 * detect competing claims. Do not expose this as a public query or accept a
 * browser-supplied binding or snapshot.
 */
export async function classifyStoredComponents(
    db: EvidenceDatabase,
    definitionIds: readonly number[],
    physical?: { secret: unknown },
): Promise<ComponentClassificationResult[]> {
    if (definitionIds.length === 0) return [];

    let snapshot = unavailable;
    try {
        const key = physical ? await physicalSigningKey(physical.secret) : null;
        const result = await db.prepare(evidenceSql(physical !== undefined)).all();
        if (result.success === true && Array.isArray(result.results)) {
            const proofs = new Map<number, PendingProof>();
            const candidate = toSnapshot(result.results, proofs);
            if (candidate.status === "complete" && key && proofs.size) {
                await Promise.all(Array.from(new Set(definitionIds), async id => {
                    const proof = proofs.get(id);
                    if (proof && await verifyPhysicalValue(key, proof.message, proof.signature)) {
                        proof.source.signature = proof.signature;
                    }
                }));
            }
            snapshot = candidate;
        }
    } catch {
        // An unavailable or malformed read cannot prove provenance.
    }
    return classifyComponentDefinitions(definitionIds, snapshot);
}
