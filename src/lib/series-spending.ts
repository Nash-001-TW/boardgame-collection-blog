type Collection = { id: number; game_id: number | null; display_name: string };
type Relation = Collection & { relation_type: string };
type Cost = { currency_code: string; allocated_minor: number };
type CostRow = Cost & { collection_item_id: number };
type Bundle = { id: number; display_name: string; included: number; in_series: number };

const eligible = "c.record_scope = 'production' AND m.archived_at IS NULL";
const collections = `v2_collection_items c LEFT JOIN v2_collection_management m ON m.collection_item_id=c.id`;
const baseTypes = "('requires_base','expansion_of','accessory_for')";
const limit = 100;

async function readBatch(db: D1Database, statements: D1PreparedStatement[]) {
    const results = await db.batch(statements);
    if (results.length !== statements.length || results.some(result => !result.success)) {
        throw new Error('Series spending query failed');
    }
    return results.map(result => result.results);
}

function exact(value: number) {
    if (!Number.isSafeInteger(value)) throw new Error('Series spending amount out of range');
    return value;
}

export async function readSeriesSpending(db: D1Database, collectionId: number) {
    const current = await db.prepare(`SELECT c.id,c.game_id,c.display_name FROM ${collections}
        WHERE c.id=? AND ${eligible}`).bind(collectionId).all<Collection>();
    if (!current.success) throw new Error('Series collection query failed');
    const [item] = current.results;
    if (!item) return { status: 'inapplicable' } as const;

    const edge = (table: string, key: string, identity: number | null, endpoint: string, filter: string, capped = false) => {
        const query = `SELECT DISTINCT c.id,c.game_id,c.display_name,r.relation_type
            FROM ${collections} JOIN ${table} r ON ${key}=${endpoint}
            WHERE ${eligible} AND r.archived_at IS NULL AND ${filter}`;
        // Each source contributes at most 101 distinct IDs, enough to detect truncation even with overlap.
        return db.prepare(capped
            ? `SELECT id,game_id,display_name,relation_type FROM
                (SELECT *,DENSE_RANK() OVER (ORDER BY id) AS member_rank FROM (${query}))
                WHERE member_rank<=101`
            : query).bind(identity);
    };
    const ascending = await readBatch(db, [
        edge('v2_collection_relations', 'c.id', item.id, 'r.target_item_id',
            `r.source_item_id=? AND r.relation_type IN ${baseTypes}`),
        edge('v2_game_relations', 'c.game_id', item.game_id, 'r.target_game_id',
            `r.source_game_id=? AND r.relation_type IN ${baseTypes}`),
        edge('site_game_relations', 'c.game_id', item.game_id, 'r.target_game_id', 'r.source_game_id=?'),
    ]) as Relation[][];
    const candidates = new Map(ascending.flat().filter(row => row.id !== item.id).map(row => [row.id, row]));
    if (candidates.size > 1) {
        return { status: 'ambiguous', candidates: [...candidates.values()].sort((a, b) => a.id - b.id) } as const;
    }

    const base = candidates.values().next().value ?? item;
    const direct = await readBatch(db, [
        edge('v2_collection_relations', 'c.id', base.id,
            'CASE WHEN r.source_item_id=?1 THEN r.target_item_id ELSE r.source_item_id END',
            `?1 IN (r.source_item_id,r.target_item_id) AND r.relation_type NOT IN ('bundle_contains','other')`, true),
        edge('v2_game_relations', 'c.game_id', base.game_id,
            'CASE WHEN r.source_game_id=?1 THEN r.target_game_id ELSE r.source_game_id END',
            `?1 IN (r.source_game_id,r.target_game_id) AND (r.relation_type IN ${baseTypes} OR r.relation_type='same_series')`, true),
        edge('site_game_relations', 'c.game_id', base.game_id, 'r.source_game_id', 'r.target_game_id=?', true),
    ]) as Relation[][];
    const labels = ['expansion_of', 'requires_base', 'accessory_for', 'compatible_with', 'same_series',
        'standalone_related', 'integrates_with'];
    const related = new Map<number, Relation>();
    for (const row of direct.flat().sort((a, b) => labels.indexOf(a.relation_type) - labels.indexOf(b.relation_type))) {
        if (row.id !== base.id && !related.has(row.id)) related.set(row.id, row);
    }
    if (item.id !== base.id && !related.has(item.id)) {
        const relation = ascending.flat().filter(row => row.id === base.id)
            .sort((a, b) => labels.indexOf(a.relation_type) - labels.indexOf(b.relation_type))[0];
        related.set(item.id, { ...item, relation_type: relation.relation_type });
    }
    const sorted = [...related.values()].sort((a, b) => a.id - b.id);
    const truncated = sorted.length >= limit;
    // Keep the requested collection visible even if its ID falls beyond the display limit.
    const visible = sorted.slice(0, limit - 1);
    if (item.id !== base.id && !visible.some(row => row.id === item.id)) visible[limit - 2] = related.get(item.id)!;
    // Both groups share the existing cap, including its reserved slot for the current collection.
    const accessories = visible.filter(isAccessory);
    const members = [{ ...base, relation_type: null }, ...visible.filter(row => !isAccessory(row))];
    const ids = JSON.stringify(members.map(row => row.id));
    const accessoryIds = JSON.stringify(accessories.map(row => row.id));
    const memberIds = '(SELECT value FROM json_each(?1))';
    const sharedBundles = `SELECT c.id,c.display_name,COUNT(*) AS included,
            COUNT(CASE WHEN r.target_item_id IN ${memberIds} THEN 1 END) AS in_series
        FROM ${collections} JOIN v2_collection_relations r ON r.source_item_id=c.id
        JOIN v2_collection_items target ON target.id=r.target_item_id
        LEFT JOIN v2_collection_management tm ON tm.collection_item_id=target.id
        WHERE ${eligible} AND c.item_type='bundle' AND c.id NOT IN ${memberIds}
          AND r.relation_type='bundle_contains' AND r.archived_at IS NULL
          AND target.record_scope='production' AND tm.archived_at IS NULL
        GROUP BY c.id,c.display_name HAVING in_series>0`;
    const [costRows, bundles, bundleCosts, applied, gifts, accessoryCostRows = []] = await readBatch(db, [
        costQuery(db, memberIds, ids),
        db.prepare(sharedBundles + ' ORDER BY c.id').bind(ids),
        costQuery(db, `(SELECT id FROM (${sharedBundles}))`, ids),
        db.prepare(`SELECT COALESCE(SUM(a.quantity_sheets),0) AS sheets
            FROM v2_sleeve_applications a JOIN v2_owned_copies o ON o.id=a.owned_copy_id
            WHERE o.collection_item_id IN ${memberIds}`).bind(ids),
        db.prepare(`SELECT COALESCE(SUM(t.quantity_sheets),0) AS sheets
            FROM v2_sleeve_inventory_transactions t
            LEFT JOIN v2_purchase_order_lines l ON l.id=t.purchase_order_line_id
            WHERE t.transaction_type='GIFT' AND COALESCE(t.collection_item_id,l.collection_item_id) IN ${memberIds}`).bind(ids),
        ...(accessories.length ? [costQuery(db, memberIds, accessoryIds)] : []),
    ]) as [CostRow[], Bundle[], CostRow[], { sheets: number }[], { sheets: number }[], CostRow[]?];

    const costs = groupCosts(costRows);
    const accessoryCosts = groupCosts(accessoryCostRows);
    const sharedCosts = groupCosts(bundleCosts);
    return {
        status: 'ready',
        baseId: base.id,
        members: members.map(row => ({ ...row, costs: costs.get(row.id) ?? [] })),
        totals: sumCosts(costRows),
        missing: members.length - costs.size,
        accessories: accessories.map(row => ({ ...row, costs: accessoryCosts.get(row.id) ?? [] })),
        accessoryTotals: sumCosts(accessoryCostRows),
        accessoryMissing: accessories.length - accessoryCosts.size,
        bundles: bundles.map(row => ({ ...row, costs: sharedCosts.get(row.id) ?? [] })),
        applied: exact(applied[0].sheets),
        gifts: exact(gifts[0].sheets),
        truncated,
    } as const;
}

function isAccessory(row: Relation) {
    return row.relation_type === 'accessory_for' || row.relation_type === 'compatible_with';
}

function sumCosts(costRows: CostRow[]) {
    const totals = new Map<string, bigint>();
    for (const row of costRows) {
        const prior = totals.get(row.currency_code) ?? 0n;
        totals.set(row.currency_code, prior + BigInt(row.allocated_minor));
    }
    return [...totals].sort(([a], [b]) => a.localeCompare(b))
        .map(([currency_code, amount]) => ({ currency_code, allocated_minor: exact(Number(amount)) }));
}

function costQuery(db: D1Database, idsSql: string, ids: string) {
    // Keep the allocation and order-status rules aligned with readPurchases.
    const collection = 'COALESCE(a.collection_item_id,o.collection_item_id)';
    return db.prepare(`SELECT ${collection} AS collection_item_id,p.currency_code,SUM(a.allocated_minor) AS allocated_minor
        FROM v2_purchase_allocations a JOIN v2_purchase_orders p ON p.id=a.purchase_order_id
        LEFT JOIN v2_owned_copies o ON o.id=a.owned_copy_id
        WHERE p.status IN ('paid','partially_received','completed') AND ${collection} IN ${idsSql}
        GROUP BY ${collection},p.currency_code ORDER BY p.currency_code`).bind(ids);
}

function groupCosts(rows: CostRow[]) {
    const costs = new Map<number, Cost[]>();
    for (const row of rows) {
        const entries = costs.get(row.collection_item_id) ?? [];
        entries.push({ currency_code: row.currency_code, allocated_minor: exact(row.allocated_minor) });
        costs.set(row.collection_item_id, entries);
    }
    return costs;
}
