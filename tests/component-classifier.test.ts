import assert from "node:assert/strict";
import test from "node:test";
import {
    classifyComponentDefinition,
    type ComponentClassificationSnapshot,
} from "../src/lib/component-classifier.ts";

type Snapshot = Extract<ComponentClassificationSnapshot, { status: "complete" }>;

function notes(type = "base", legacyId = 7) {
    return JSON.stringify({
        migration: "0012", legacy_table: "collection_components", legacy_id: legacyId,
        legacy_component_type: type,
    });
}

function fixture(overrides: Partial<Snapshot> = {}): Snapshot {
    return {
        status: "complete",
        definitions: [{ id: 41, collection_item_id: 23, notes: notes() }],
        legacyComponents: [{ id: 7, collection_item_id: 11, component_type: "base" }],
        legacyCollections: [{ id: 11 }],
        collections: [{ id: 23 }],
        legacyMaps: [
            { legacy_table: "collection_components", legacy_id: "7", target_table: "v2_component_definitions", target_id: 41 },
            { legacy_table: "collection_items", legacy_id: "11", target_table: "v2_collection_items", target_id: 23 },
        ],
        ...overrides,
    };
}

test("complete migration evidence classifies a legacy product without granting either capability", () => {
    assert.deepEqual(classifyComponentDefinition(41, fixture()), {
        classification: "LEGACY_PRODUCT", definitionId: 41,
        evidence: { legacyId: "7", collectionItemId: 23, legacyCollectionId: 11, provenance: "MIGRATION_0012", legacyProductType: "base" },
        reason: "CONFIRMED_LEGACY_PRODUCT", conflicts: [],
        canUseForInventory: false, canAssignToSleeves: false,
    });
});

for (const type of ["expansion", "promo"]) {
    test("confirms matching V1 and Notes type: " + type, () => {
        const snapshot = fixture({
            definitions: [{ id: 41, collection_item_id: 23, notes: notes(type) }],
            legacyComponents: [{ id: 7, collection_item_id: 11, component_type: type }],
        });
        const result = classifyComponentDefinition(41, snapshot);
        assert.equal(result.classification, "LEGACY_PRODUCT");
        assert.equal(result.evidence.legacyProductType, type);
    });
}

const original = fixture();
const [map, parent] = original.legacyMaps;
const [definition] = original.definitions;

const failures: Array<{
    name: string;
    snapshot: ComponentClassificationSnapshot;
    reason: ReturnType<typeof classifyComponentDefinition>["reason"];
    conflict?: boolean;
}> = [
    { name: "missing Legacy Map", snapshot: fixture({ legacyMaps: [parent] }), reason: "LEGACY_MAP_MISSING" },
    { name: "Legacy Map conflicts with Notes", snapshot: fixture({ legacyMaps: [{ ...map, legacy_id: "8" }, parent] }), reason: "MIGRATION_NOTES_MISMATCH", conflict: true },
    { name: "ambiguous forward component map", snapshot: fixture({ legacyMaps: [map, { ...map, legacy_id: "8" }, parent] }), reason: "LEGACY_MAP_AMBIGUOUS", conflict: true },
    { name: "reverse map includes a target that is absent", snapshot: fixture({ legacyMaps: [map, { ...map, target_id: 99 }, parent] }), reason: "COMPETING_SOURCE_CLAIM", conflict: true },
    { name: "other definition has a Notes-only claim", snapshot: fixture({ definitions: [definition, { ...definition, id: 42 }] }), reason: "COMPETING_SOURCE_CLAIM", conflict: true },
    { name: "Migration Notes are missing", snapshot: fixture({ definitions: [{ ...definition, notes: null }] }), reason: "MIGRATION_NOTES_MISSING" },
    { name: "collection ownership mismatch", snapshot: fixture({ legacyMaps: [map, { ...parent, target_id: 24 }] }), reason: "COLLECTION_MAP_MISMATCH", conflict: true },
    { name: "collection reverse map is ambiguous", snapshot: fixture({ legacyMaps: [map, parent, { ...parent, legacy_id: "12" }] }), reason: "COLLECTION_MAP_MISMATCH", conflict: true },
    { name: "collection forward map is ambiguous", snapshot: fixture({ legacyMaps: [map, parent, { ...parent, target_id: 24 }] }), reason: "COLLECTION_MAP_MISMATCH", conflict: true },
    { name: "missing collection record", snapshot: fixture({ collections: [] }), reason: "COLLECTION_EVIDENCE_MISSING" },
    { name: "missing V1 source row", snapshot: fixture({ legacyComponents: [] }), reason: "LEGACY_SOURCE_NOT_UNIQUE" },
    { name: "unsupported bundle-part type", snapshot: fixture({
        legacyComponents: [{ id: 7, collection_item_id: 11, component_type: "bundle_part" }],
        definitions: [{ ...definition, notes: notes("bundle_part") }],
    }), reason: "LEGACY_TYPE_UNSUPPORTED" },
    { name: "source type and Notes type conflict", snapshot: fixture({
        definitions: [{ ...definition, notes: notes("promo") }],
    }), reason: "LEGACY_TYPE_MISMATCH", conflict: true },
    { name: "unavailable evidence", snapshot: { status: "unavailable" }, reason: "EVIDENCE_UNAVAILABLE" },
    { name: "missing requested definition", snapshot: fixture({ definitions: [] }), reason: "DEFINITION_NOT_UNIQUE" },
    { name: "invalid canonical Legacy Map ID", snapshot: fixture({ legacyMaps: [{ ...map, legacy_id: "07" }, parent] }), reason: "LEGACY_MAP_ID_INVALID", conflict: true },
];

for (const value of [
    '{"migration":"0012",',
    '{"migration":"0012","legacy_table":"collection_components","legacy_id":7,"legacy_\\u0069d":7,"legacy_component_type":"base"}',
    '{"migration":"0012","legacy_table":"collection_components","legacy_id":"7","legacy_component_type":"base"}',
    '{"migration":"0012","legacy_table":"collection_components","legacy_id":7.0000000000000001,"legacy_component_type":"base"}',
    '{"migration":"0012","legacy_table":"collection_components","legacy_id":7e0,"legacy_component_type":"base"}',
    JSON.stringify([{ migration: "0012", legacy_table: "collection_components", legacy_id: 7 }]),
    JSON.stringify({ nested: JSON.parse(notes()) }),
]) {
    failures.push({
        name: "rejects invalid or noncanonical Notes: " + value,
        snapshot: fixture({ definitions: [{ ...definition, notes: value }] }),
        reason: "MIGRATION_NOTES_INVALID", conflict: true,
    });
}
failures.push({
    name: "duplicate product type key does not prove a legacy subtype",
    snapshot: fixture({ definitions: [{ ...definition, notes: notes().slice(0, -1) + ',"legacy_component_type":"base"}' }] }),
    reason: "LEGACY_TYPE_MISMATCH", conflict: true,
});

for (const { name, snapshot, reason, conflict } of failures) {
    test(name, () => {
        const result = classifyComponentDefinition(41, snapshot);
        assert.equal(result.classification, "UNKNOWN");
        assert.equal(result.definitionId, 41);
        assert.equal(result.reason, reason);
        assert.deepEqual(result.conflicts, conflict ? [reason] : []);
        assert.equal(result.canUseForInventory, false);
        assert.equal(result.canAssignToSleeves, false);
    });
}

for (const hint of [
    { component_type: "other" },
    { component_name: "Official expansion", bgg_id: 123 },
    { component_type: "card", expected_quantity: 100 },
    { notes: '{"_componentUsageV1":{"usage":"PHYSICAL_COMPONENT","collectionItemId":23}}' },
]) {
    test("display hints and arbitrary markers grant no physical capability: " + JSON.stringify(hint), () => {
        const hinted = { id: 41, collection_item_id: 23, notes: null, ...hint };
        const result = classifyComponentDefinition(41, fixture({ definitions: [hinted], legacyMaps: [] }));
        assert.equal(result.classification, "UNKNOWN");
        assert.equal(result.canUseForInventory, false);
        assert.equal(result.canAssignToSleeves, false);
    });
}

test("root provenance remains valid with unrelated nested lookalike keys", () => {
    const withNestedNotes = { ...JSON.parse(notes()), legacy_notes: { legacy_id: 999, migration: "other" } };
    const snapshot = fixture({ definitions: [{ ...definition, notes: JSON.stringify(withNestedNotes) }] });
    const before = structuredClone(snapshot);
    assert.equal(classifyComponentDefinition(41, snapshot).classification, "LEGACY_PRODUCT");
    assert.deepEqual(snapshot, before);
});
