export type ComponentClassification = "LEGACY_PRODUCT" | "PHYSICAL_COMPONENT" | "UNKNOWN";

type LegacyProductType = "base" | "expansion" | "promo";

interface LegacyMapRow {
    readonly legacy_table: string;
    readonly legacy_id: string;
    readonly target_table: string;
    readonly target_id: number;
}

interface ComponentDefinitionRow {
    readonly id: number;
    readonly collection_item_id: number;
    readonly notes: string | null;
    readonly physicalSource?: {
        readonly signature: string | null;
        readonly hasLegacyTarget: boolean;
        readonly card: boolean;
    };
}

interface LegacyComponentRow {
    readonly id: number;
    readonly collection_item_id: number;
    readonly component_type: string;
}

interface CollectionRow {
    readonly id: number;
}

/**
 * A trusted, consistent server-side snapshot. Include both directions of the
 * relevant mappings and all Notes claims to the relevant legacy component IDs,
 * including claims from definitions outside the requested page. A partial or
 * failed read must be supplied as unavailable.
 */
export type ComponentClassificationSnapshot = {
    readonly status: "complete";
    readonly definitions: readonly ComponentDefinitionRow[];
    readonly legacyComponents: readonly LegacyComponentRow[];
    readonly legacyCollections: readonly CollectionRow[];
    readonly collections: readonly CollectionRow[];
    readonly legacyMaps: readonly LegacyMapRow[];
} | {
    readonly status: "unavailable";
};

type ClassificationReason =
    | "CONFIRMED_PHYSICAL_COMPONENT"
    | "PHYSICAL_SOURCE_INVALID"
    | "PHYSICAL_SOURCE_CONFLICT"
    | "CONFIRMED_LEGACY_PRODUCT"
    | "EVIDENCE_UNAVAILABLE"
    | "DEFINITION_NOT_UNIQUE"
    | "LEGACY_MAP_MISSING"
    | "LEGACY_MAP_AMBIGUOUS"
    | "LEGACY_MAP_ID_INVALID"
    | "MIGRATION_NOTES_MISSING"
    | "MIGRATION_NOTES_INVALID"
    | "MIGRATION_NOTES_MISMATCH"
    | "LEGACY_SOURCE_NOT_UNIQUE"
    | "COMPETING_SOURCE_CLAIM"
    | "COLLECTION_EVIDENCE_MISSING"
    | "COLLECTION_MAP_MISMATCH"
    | "LEGACY_TYPE_UNSUPPORTED"
    | "LEGACY_TYPE_MISMATCH";

interface ClassificationEvidence {
    readonly legacyId: string | null;
    readonly collectionItemId: number | null;
    readonly legacyCollectionId: number | null;
    readonly provenance: "MIGRATION_0012" | "PHYSICAL_CREATION" | null;
    readonly physicalSignature?: string;
    readonly legacyProductType: LegacyProductType | null;
}

export interface ComponentClassificationResult {
    readonly classification: ComponentClassification;
    readonly definitionId: number;
    readonly evidence: ClassificationEvidence;
    readonly reason: ClassificationReason;
    readonly conflicts: readonly ClassificationReason[];
    readonly canUseForInventory: boolean;
    readonly canAssignToSleeves: boolean;
}

const componentSource = "collection_components";
const componentTarget = "v2_component_definitions";
const canonicalId = /^[1-9][0-9]*$/;

const evidenceKeys = new Set(["migration", "legacy_table", "legacy_id", "legacy_component_type"]);

function readMigrationNotes(notes: string) {
    try {
        const parsed: unknown = JSON.parse(notes);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    } catch {
        return null;
    }

    // JSON.parse validates the grammar. Tokenize the original text to retain
    // duplicate root keys and the exact numeric spelling of legacy_id.
    const fields = new Map<string, string[]>();
    const tokens = notes.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:"]+/g) ?? [];
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === "{" || token === "[") depth++;
        if (token === "}" || token === "]") depth--;
        if (depth !== 1 || !token.startsWith('"') || tokens[i + 1] !== ":") continue;

        const key: string = JSON.parse(token);
        if (!evidenceKeys.has(key)) continue;
        const value = tokens[i + 2];
        const field = fields.get(key) ?? [];
        field.push(value.startsWith('"') ? JSON.parse(value) : value === "{" || value === "[" ? "" : value);
        fields.set(key, field);
        // A string ID must never be accepted as a JSON integer.
        if (key === "legacy_id" && value.startsWith('"')) field[field.length - 1] = "";
    }

    const ids = fields.get("legacy_id") ?? [];
    const isMigration = fields.get("migration")?.includes("0012") === true
        && fields.get("legacy_table")?.includes(componentSource) === true;
    return {
        // A well-formed claim can still compete with another definition even
        // when the claiming definition has duplicate evidence keys.
        claims: isMigration ? ids.filter(id => canonicalId.test(id)) : [],
        legacyId: isMigration && ids.length === 1 && canonicalId.test(ids[0])
            && fields.get("migration")?.length === 1 && fields.get("legacy_table")?.length === 1
            ? ids[0] : null,
        productType: fields.get("legacy_component_type")?.length === 1
            ? fields.get("legacy_component_type")![0] : null,
    };
}

function isId(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0;
}

function addToGroup<Key, Row>(groups: Map<Key, Row[]>, key: Key, row: Row) {
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
}

function groupBy<Key, Row>(rows: readonly Row[], key: (row: Row) => Key): Map<Key, Row[]> {
    const groups = new Map<Key, Row[]>();
    for (const row of rows) addToGroup(groups, key(row), row);
    return groups;
}

function indexEvidence(snapshot: Extract<ComponentClassificationSnapshot, { status: "complete" }>) {
    const legacyComponents = new Map<string, LegacyComponentRow[]>();
    const componentMapsByTarget = new Map<number, LegacyMapRow[]>();
    const componentMapsBySource = new Map<string, LegacyMapRow[]>();
    const collectionMapsBySource = new Map<string, LegacyMapRow[]>();
    const collectionMapsByTarget = new Map<number, LegacyMapRow[]>();
    for (const row of snapshot.legacyComponents) {
        if (isId(row.id)) addToGroup(legacyComponents, String(row.id), row);
    }
    for (const row of snapshot.legacyMaps) {
        if (row.legacy_table === componentSource && row.target_table === componentTarget) {
            addToGroup(componentMapsByTarget, row.target_id, row);
            addToGroup(componentMapsBySource, row.legacy_id, row);
        } else if (row.legacy_table === "collection_items" && row.target_table === "v2_collection_items") {
            addToGroup(collectionMapsBySource, row.legacy_id, row);
            addToGroup(collectionMapsByTarget, row.target_id, row);
        }
    }
    return {
        definitions: groupBy(snapshot.definitions, row => row.id),
        legacyComponents,
        legacyCollections: groupBy(snapshot.legacyCollections, row => row.id),
        collections: groupBy(snapshot.collections, row => row.id),
        componentMapsByTarget, componentMapsBySource, collectionMapsBySource, collectionMapsByTarget,
    };
}

function indexMigrationNotes(definitions: readonly ComponentDefinitionRow[]) {
    const parsedByText = new Map<string, ReturnType<typeof readMigrationNotes>>();
    const claimsBySource = new Map<string, Set<number>>();
    for (const { id, notes } of definitions) {
        if (!notes?.trim()) continue;
        if (!parsedByText.has(notes)) parsedByText.set(notes, readMigrationNotes(notes));
        for (const source of parsedByText.get(notes)?.claims ?? []) {
            const claims = claimsBySource.get(source);
            if (claims) claims.add(id);
            else claimsBySource.set(source, new Set([id]));
        }
    }
    return { parsedByText, claimsBySource };
}

function classifyIndexedDefinition(
    definitionId: number,
    index: ReturnType<typeof indexEvidence> | null,
    notesIndex: ReturnType<typeof indexMigrationNotes> | null,
): ComponentClassificationResult {
    let evidence: ClassificationEvidence = {
        legacyId: null, collectionItemId: null, legacyCollectionId: null, provenance: null, legacyProductType: null,
    };
    const result = (reason: ClassificationReason, conflict = false): ComponentClassificationResult => ({
        classification: reason === "CONFIRMED_LEGACY_PRODUCT" ? "LEGACY_PRODUCT" : "UNKNOWN",
        definitionId, evidence, reason, conflicts: conflict ? [reason] : [],
        canUseForInventory: false, canAssignToSleeves: false,
    });

    if (!index || !notesIndex) return result("EVIDENCE_UNAVAILABLE");
    const definitions = index.definitions.get(definitionId) ?? [];
    if (!isId(definitionId) || definitions.length !== 1) {
        return result("DEFINITION_NOT_UNIQUE", definitions.length > 1);
    }
    const [definition] = definitions;
    evidence = { ...evidence, collectionItemId: definition.collection_item_id };

    const targetMaps = index.componentMapsByTarget.get(definitionId) ?? [];
    if (definition.physicalSource) {
        const { signature, hasLegacyTarget, card } = definition.physicalSource;
        if (hasLegacyTarget || targetMaps.length || definition.notes !== null) {
            return result("PHYSICAL_SOURCE_CONFLICT", true);
        }
        if (!signature || index.collections.get(definition.collection_item_id)?.length !== 1) {
            return result("PHYSICAL_SOURCE_INVALID");
        }
        return {
            classification: "PHYSICAL_COMPONENT",
            definitionId,
            evidence: { ...evidence, provenance: "PHYSICAL_CREATION", physicalSignature: signature },
            reason: "CONFIRMED_PHYSICAL_COMPONENT",
            conflicts: [],
            canUseForInventory: true,
            canAssignToSleeves: card,
        };
    }
    if (!targetMaps.length) return result("LEGACY_MAP_MISSING");
    if (targetMaps.length !== 1) return result("LEGACY_MAP_AMBIGUOUS", true);
    const [{ legacy_id: legacyId }] = targetMaps;
    if (!canonicalId.test(legacyId)) return result("LEGACY_MAP_ID_INVALID", true);
    evidence = { ...evidence, legacyId };

    if (!definition.notes?.trim()) return result("MIGRATION_NOTES_MISSING");
    const notes = notesIndex.parsedByText.get(definition.notes);
    if (!notes?.legacyId) return result("MIGRATION_NOTES_INVALID", true);
    if (notes.legacyId !== legacyId) return result("MIGRATION_NOTES_MISMATCH", true);

    const sources = index.legacyComponents.get(legacyId) ?? [];
    if (sources.length !== 1) return result("LEGACY_SOURCE_NOT_UNIQUE", sources.length > 1);
    const [source] = sources;
    const claims = notesIndex.claimsBySource.get(legacyId);
    if (index.componentMapsBySource.get(legacyId)?.some(row => row.target_id !== definitionId)
        || (claims && (claims.size > 1 || !claims.has(definitionId)))) {
        return result("COMPETING_SOURCE_CLAIM", true);
    }

    const legacyCollectionId = source.collection_item_id;
    const collectionId = definition.collection_item_id;
    evidence = { ...evidence, legacyCollectionId };
    if (!isId(legacyCollectionId) || !isId(collectionId)
        || index.legacyCollections.get(legacyCollectionId)?.length !== 1
        || index.collections.get(collectionId)?.length !== 1) {
        return result("COLLECTION_EVIDENCE_MISSING");
    }
    const forward = index.collectionMapsBySource.get(String(legacyCollectionId));
    const reverse = index.collectionMapsByTarget.get(collectionId);
    if (forward?.length !== 1 || reverse?.length !== 1 || forward[0] !== reverse[0]) {
        return result("COLLECTION_MAP_MISMATCH", Boolean(forward || reverse));
    }

    evidence = { ...evidence, provenance: "MIGRATION_0012" };
    if (notes.productType !== source.component_type) return result("LEGACY_TYPE_MISMATCH", true);
    const type = source.component_type;
    if (type !== "base" && type !== "expansion" && type !== "promo") return result("LEGACY_TYPE_UNSUPPORTED");
    evidence = { ...evidence, legacyProductType: type };
    return result("CONFIRMED_LEGACY_PRODUCT");
}

export function classifyComponentDefinitions(
    definitionIds: readonly number[],
    snapshot: ComponentClassificationSnapshot,
): ComponentClassificationResult[] {
    if (!definitionIds.length) return [];
    const index = snapshot.status === "complete" ? indexEvidence(snapshot) : null;
    const notes = snapshot.status === "complete" ? indexMigrationNotes(snapshot.definitions) : null;
    return definitionIds.map(id => classifyIndexedDefinition(id, index, notes));
}

export function classifyComponentDefinition(
    definitionId: number,
    snapshot: ComponentClassificationSnapshot,
): ComponentClassificationResult {
    return classifyComponentDefinitions([definitionId], snapshot)[0];
}
