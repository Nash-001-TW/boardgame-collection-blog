import { classifyStoredComponents } from "./component-classifier-adapter";

const pageSize = 50;

interface ComponentRow {
    id: number;
    collection_item_id: number;
    collection_name: string | null;
    component_name: string;
    component_type: string;
}

export async function loadAdminComponentClassification(db: D1Database, after: number, secret?: unknown) {
    const list = await db.prepare(`
        SELECT d.id, d.collection_item_id, c.display_name AS collection_name,
               d.component_name, d.component_type
        FROM v2_component_definitions d
        LEFT JOIN v2_collection_items c ON c.id = d.collection_item_id
        WHERE d.id > ?
        ORDER BY d.id
        LIMIT ?
    `).bind(after, pageSize + 1).all<ComponentRow>();
    if (list.success !== true || !Array.isArray(list.results)) {
        throw new Error("Component definitions could not be read");
    }

    const rows = list.results.slice(0, pageSize);
    // The cursor limits display rows only. The adapter still reads global evidence.
    const results = await classifyStoredComponents(db, rows.map(row => row.id),
        secret === undefined ? undefined : { secret });
    const rowsWithClassification = rows.map((row, index) => {
        const result = results[index];
        // A collection reassignment between reads makes the display row stale.
        if (result.definitionId !== row.id || (result.evidence.collectionItemId !== null
            && result.evidence.collectionItemId !== row.collection_item_id)) {
            return { ...row, result: null };
        }
        return { ...row, result };
    });

    return {
        rows: rowsWithClassification,
        evidenceUnavailable: rowsWithClassification.some(({ result }) =>
            !result || result.reason === "EVIDENCE_UNAVAILABLE"),
        nextCursor: list.results.length > pageSize ? rows[pageSize - 1].id : null,
    };
}
