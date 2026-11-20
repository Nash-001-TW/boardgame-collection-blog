import assert from "node:assert/strict";
import test from "node:test";
import { classifyStoredComponents } from "../src/lib/component-classifier-adapter.ts";

type MockRow = { kind: string; payload: string; total_rows: number };
type AssertTrue<T extends true> = T;
export type AdapterAcceptsExistingD1Binding = AssertTrue<
    D1Database extends Parameters<typeof classifyStoredComponents>[0] ? true : false
>;

function row(kind: string, payload: Record<string, unknown>): MockRow {
    return { kind, payload: JSON.stringify(payload), total_rows: 0 };
}

function notes(legacyId = 7, type = "base") {
    return JSON.stringify({
        migration: "0012", legacy_table: "collection_components",
        legacy_id: legacyId, legacy_component_type: type,
    });
}

function fixture() {
    return [
        row("definition", { id: 41, collection_item_id: 23, notes: notes() }),
        row("legacy_component", { id: 7, collection_item_id: 11, component_type: "base" }),
        row("legacy_collection", { id: 11 }),
        row("collection", { id: 23 }),
        row("map", { legacy_table: "collection_components", legacy_id: "7", target_table: "v2_component_definitions", target_id: 41 }),
        row("map", { legacy_table: "collection_items", legacy_id: "11", target_table: "v2_collection_items", target_id: 23 }),
    ];
}

function envelope(rows: MockRow[], total = rows.length) {
    return rows.map(record => ({ ...record, total_rows: total }));
}

function mock(results: readonly unknown[], success = true) {
    const calls: string[] = [];
    let executions = 0;
    return {
        calls,
        get executions() { return executions; },
        prepare(sql: string) {
            calls.push(sql);
            return { async all() { executions++; return { success, results }; } };
        },
    };
}

test("one read statement loads the five real projections without limiting reverse evidence by requested IDs", async () => {
    const db = mock(envelope(fixture()));
    const [result] = await classifyStoredComponents(db, [41]);
    assert.equal(db.calls.length, 1);
    assert.equal(db.executions, 1);
    const [sql] = db.calls;
    assert.match(sql.trim(), /^WITH evidence\(kind, payload\) AS \(/);
    for (const name of ["v2_component_definitions", "collection_components", "collection_items", "v2_collection_items", "v2_legacy_id_map"]) {
        assert.match(sql, new RegExp("\\bFROM " + name + "\\b"));
    }
    assert.equal((sql.match(/\bUNION ALL\b/g) ?? []).length, 4);
    assert.match(sql, /COUNT\(\*\) OVER \(\) AS total_rows\s+FROM evidence\s+LIMIT 10001\s*$/);
    assert.doesNotMatch(sql, /;|\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|ATTACH)\b/i);
    assert.match(sql, /FROM v2_component_definitions\s+UNION ALL/);
    assert.match(sql, /legacy_table = 'collection_components' AND target_table = 'v2_component_definitions'/);
    assert.match(sql, /legacy_table = 'collection_items' AND target_table = 'v2_collection_items'/);
    assert.equal(result.classification, "LEGACY_PRODUCT");
    assert.equal(result.evidence.legacyProductType, "base");
    assert.equal(result.canUseForInventory, false);
    assert.equal(result.canAssignToSleeves, false);
});

type Reason = Awaited<ReturnType<typeof classifyStoredComponents>>[number]["reason"];
const scenarios: Array<{
    name: string;
    change: (rows: MockRow[]) => MockRow[];
    reason: Reason;
    missingRows?: boolean;
}> = [
    { name: "missing forward component map", change: rows => rows.filter((_, i) => i !== 4), reason: "LEGACY_MAP_MISSING" },
    {
        name: "omitted reverse component map invalidates the declared full snapshot",
        change: rows => [...rows, row("map", { legacy_table: "collection_components", legacy_id: "7", target_table: "v2_component_definitions", target_id: 42 })],
        reason: "EVIDENCE_UNAVAILABLE", missingRows: true,
    },
    {
        name: "conflicting reverse component map with dangling V2 target",
        change: rows => [...rows, row("map", { legacy_table: "collection_components", legacy_id: "7", target_table: "v2_component_definitions", target_id: 42 })],
        reason: "COMPETING_SOURCE_CLAIM",
    },
    {
        name: "conflicting forward component maps",
        change: rows => [...rows, row("map", { legacy_table: "collection_components", legacy_id: "8", target_table: "v2_component_definitions", target_id: 41 })],
        reason: "LEGACY_MAP_AMBIGUOUS",
    },
    { name: "missing V1 source row", change: rows => rows.filter((_, i) => i !== 1), reason: "LEGACY_SOURCE_NOT_UNIQUE" },
    { name: "missing collection mapping", change: rows => rows.slice(0, -1), reason: "COLLECTION_MAP_MISMATCH" },
    {
        name: "collection ownership mismatch",
        change: rows => [...rows.slice(0, -1), row("map", { legacy_table: "collection_items", legacy_id: "11", target_table: "v2_collection_items", target_id: 24 })],
        reason: "COLLECTION_MAP_MISMATCH",
    },
    {
        name: "migration Notes ID mismatch",
        change: rows => [row("definition", { id: 41, collection_item_id: 23, notes: notes(8) }), ...rows.slice(1)],
        reason: "MIGRATION_NOTES_MISMATCH",
    },
    {
        name: "V1 type and Notes type mismatch",
        change: rows => [row("definition", { id: 41, collection_item_id: 23, notes: notes(7, "promo") }), ...rows.slice(1)],
        reason: "LEGACY_TYPE_MISMATCH",
    },
    {
        name: "NULL Notes remain NULL rather than being invented",
        change: rows => [row("definition", { id: 41, collection_item_id: 23, notes: null }), ...rows.slice(1)],
        reason: "MIGRATION_NOTES_MISSING",
    },
    {
        name: "absent Notes column makes the snapshot unavailable",
        change: rows => [row("definition", { id: 41, collection_item_id: 23 }), ...rows.slice(1)],
        reason: "EVIDENCE_UNAVAILABLE",
    },
    {
        name: "NULL required V1 type makes the snapshot unavailable",
        change: rows => rows.map((r, i) => i === 1 ? row("legacy_component", { id: 7, collection_item_id: 11, component_type: null }) : r),
        reason: "EVIDENCE_UNAVAILABLE",
    },
    {
        name: "integer IDs outside the safe range are rejected rather than rounded",
        change: rows => rows.map((r, i) => i === 1 ? { ...r, payload: '{"id":9007199254740993,"collection_item_id":11,"component_type":"base"}' } : r),
        reason: "EVIDENCE_UNAVAILABLE",
    },
    {
        name: "off-page Notes-only claims cannot be filtered out",
        change: rows => [...rows, row("definition", { id: 99, collection_item_id: 23, notes: notes() })],
        reason: "COMPETING_SOURCE_CLAIM",
    },
    {
        name: "no physical classification from a marker, title, type or number",
        change: () => [row("definition", {
            id: 41, collection_item_id: 23, notes: '{"_componentUsageV1":{"usage":"PHYSICAL_COMPONENT"}}',
            component_type: "card", component_name: "Cards", expected_quantity: 52,
        })],
        reason: "LEGACY_MAP_MISSING",
    },
];

for (const { name, change, reason, missingRows } of scenarios) {
    test(name, async () => {
        const rows = envelope(change(fixture()));
        const result = await classifyStoredComponents(mock(missingRows ? rows.slice(0, -1) : rows), [41]);
        assert.equal(result[0].classification, "UNKNOWN");
        assert.equal(result[0].reason, reason);
        assert.equal(result[0].canUseForInventory, false);
        assert.equal(result[0].canAssignToSleeves, false);
    });
}

test("multiple definitions use one shared snapshot and retain independent results in request order", async () => {
    const other = [
        row("definition", { id: 52, collection_item_id: 24, notes: notes(8, "promo") }),
        row("legacy_component", { id: 8, collection_item_id: 12, component_type: "promo" }),
        row("legacy_collection", { id: 12 }),
        row("collection", { id: 24 }),
        row("map", { legacy_table: "collection_components", legacy_id: "8", target_table: "v2_component_definitions", target_id: 52 }),
        row("map", { legacy_table: "collection_items", legacy_id: "12", target_table: "v2_collection_items", target_id: 24 }),
        row("definition", { id: 53, collection_item_id: 24, notes: null }),
    ];
    const db = mock(envelope([...fixture(), ...other]));
    const results = await classifyStoredComponents(db, [52, 53, 41, 52]);
    assert.equal(db.executions, 1);
    assert.deepEqual(results.map(r => [r.definitionId, r.classification, r.evidence.legacyProductType]), [
        [52, "LEGACY_PRODUCT", "promo"], [53, "UNKNOWN", null], [41, "LEGACY_PRODUCT", "base"],
        [52, "LEGACY_PRODUCT", "promo"],
    ]);
});

test("raw duplicate Notes keys reach the classifier unchanged", async () => {
    const rows = fixture();
    rows[0] = row("definition", {
        id: 41, collection_item_id: 23, notes: notes().slice(0, -1) + ',"legacy_id":7}',
    });
    const [result] = await classifyStoredComponents(mock(envelope(rows)), [41]);
    assert.equal(result.reason, "MIGRATION_NOTES_INVALID");
});

test("failed or malformed adapter reads make every requested definition unavailable", async () => {
    for (const db of [
        mock(envelope(fixture()), false),
        mock([{ kind: "definition", payload: "{", total_rows: 1 }]),
        { prepare() { throw new Error("Unavailable"); } },
        { prepare() { return { async all() { throw new Error("Unavailable"); } }; } },
    ]) {
        const results = await classifyStoredComponents(db, [41, 52]);
        assert.deepEqual(results.map(r => r.reason), ["EVIDENCE_UNAVAILABLE", "EVIDENCE_UNAVAILABLE"]);
        assert.ok(results.every(r => r.classification === "UNKNOWN" && !r.canUseForInventory && !r.canAssignToSleeves));
    }
});

test("over-limit evidence cannot produce a partial positive result", async () => {
    const [definition] = fixture();
    const evidence = Array.from({ length: 10001 }, () => definition);
    const [result] = await classifyStoredComponents(mock(envelope(evidence)), [41]);
    assert.equal(result.reason, "EVIDENCE_UNAVAILABLE");
});

test("empty request skips reads; successful empty snapshot proves no definition", async () => {
    const db = mock([]);
    assert.deepEqual(await classifyStoredComponents(db, []), []);
    assert.equal(db.executions, 0);
    const [result] = await classifyStoredComponents(db, [41]);
    assert.equal(result.reason, "DEFINITION_NOT_UNIQUE");
});
