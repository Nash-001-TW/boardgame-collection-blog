import { readSleeveShortage } from './sleeve-shortage';

export const adminOwnedSql = "CASE WHEN json_valid(notes) = 1 THEN CASE WHEN json_type(notes, '$.owned') IS NOT NULL THEN CAST(json_extract(notes, '$.owned') AS INTEGER) ELSE acquisition_status = 'owned' END ELSE acquisition_status = 'owned' END";

type Collection = { total: number; owned: number; wishlist: number; preorder: number };
type Components = { definitions: number; records: number };
type Sources = { bgg: number; notbgg: number };
type PurchaseRow = { kind: string; currency: string; amount: number; order_id: number };
const production = "SELECT id FROM v2_collection_items WHERE record_scope = 'production'";
const sectionTimeoutMs = 8000;

async function readSection<T>(name: string, db: D1Database | undefined, read: (db: D1Database) => Promise<T>) {
    if (!db) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // D1 does not accept an abort signal. Bound how long one read can delay rendering.
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new DOMException('Dashboard read timed out', 'TimeoutError')), sectionTimeoutMs);
        });
        return await Promise.race([read(db), deadline]);
    } catch (error) {
        console.error('Admin dashboard section unavailable', name, error instanceof Error ? error.name : 'Unknown error');
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function counts<T extends Record<string, number>>(db: D1Database, sql: string) {
    const row = await db.prepare(sql).first<T>();
    if (!row || Object.values(row).some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error('Invalid dashboard counts');
    }
    return row;
}

const costOrders = `
        cost_orders AS (
            SELECT o.id, o.currency_code, r.unallocated_minor
            FROM v2_purchase_orders o JOIN v2_purchase_order_reconciliation r ON r.purchase_order_id = o.id
            WHERE o.status IN ('paid','partially_received','completed')
        )`;
const allocations = `
        allocations AS (
            SELECT a.purchase_order_id, a.allocated_minor, a.allocation_method, c.id AS collection_id,
                   m.archived_at, c.record_scope,
                   (a.collection_item_id IS NOT NULL AND c.id IS NULL)
                   OR (a.purchase_order_line_id IS NOT NULL AND (
                       l.id IS NULL OR l.purchase_order_id <> a.purchase_order_id
                       OR (l.collection_item_id IS NOT NULL AND c.id IS NOT NULL AND l.collection_item_id <> c.id)
                   )) AS invalid_target,
                   (a.owned_copy_id IS NOT NULL AND c.id IS NULL) AS unmapped_copy
            FROM v2_purchase_allocations a
            JOIN cost_orders o ON o.id = a.purchase_order_id
            LEFT JOIN v2_owned_copies copy ON copy.id = a.owned_copy_id
            LEFT JOIN v2_collection_items c ON c.id = COALESCE(a.collection_item_id, copy.collection_item_id)
            LEFT JOIN v2_collection_management m ON m.collection_item_id = c.id
            LEFT JOIN v2_purchase_order_lines l ON l.id = a.purchase_order_line_id
        )`;
const allocationChecks = `
        allocation_checks AS (
            SELECT purchase_order_id, MIN(allocation_method = 'weighted') AS all_weighted,
                   MAX(invalid_target) AS invalid_target, MAX(unmapped_copy) AS unmapped_copy
            FROM allocations GROUP BY purchase_order_id
        )`;

async function readPurchases(db: D1Database) {
    // Keep the six reads in one D1 transaction without a compound SELECT.
    const statements = [
        db.prepare(`
            WITH ${costOrders}, ${allocations}
            SELECT CASE WHEN a.archived_at IS NULL THEN 'active' ELSE 'archived' END AS kind,
                   o.currency_code AS currency, SUM(a.allocated_minor) AS amount, 0 AS order_id
            FROM allocations a JOIN cost_orders o ON o.id = a.purchase_order_id
            WHERE a.record_scope = 'production'
            GROUP BY kind, currency
            ORDER BY kind, currency`),
        db.prepare(`
            WITH ${costOrders}
            SELECT 'unallocated' AS kind, currency_code AS currency, SUM(unallocated_minor) AS amount, 0 AS order_id FROM cost_orders
            WHERE unallocated_minor > 0 GROUP BY currency_code
            ORDER BY currency`),
        db.prepare(`
            WITH ${costOrders}
            SELECT 'excess' AS kind, currency_code AS currency, SUM(-unallocated_minor) AS amount, COUNT(*) AS order_id FROM cost_orders
            WHERE unallocated_minor < 0 GROUP BY currency_code
            ORDER BY currency`),
        db.prepare(`
            WITH ${costOrders}, ${allocations}, ${allocationChecks}
            SELECT 'inconsistent' AS kind, '' AS currency, 0 AS amount, o.id AS order_id FROM cost_orders o
            LEFT JOIN allocation_checks a ON a.purchase_order_id = o.id
            WHERE o.unallocated_minor < 0 OR a.invalid_target = 1
            ORDER BY order_id`),
        db.prepare(`
            WITH ${costOrders}, ${allocations}, ${allocationChecks}
            SELECT 'review' AS kind, '' AS currency, 0 AS amount, o.id AS order_id FROM cost_orders o
            JOIN allocation_checks a ON a.purchase_order_id = o.id
            WHERE (o.unallocated_minor > 0 AND a.all_weighted = 1) OR a.unmapped_copy = 1
            ORDER BY order_id`),
        db.prepare(`
            SELECT status AS kind, '' AS currency, COUNT(*) AS amount, 0 AS order_id FROM v2_purchase_orders
            WHERE status IN ('open','cancelled') GROUP BY status
            ORDER BY kind`),
    ];
    const results = await db.batch<PurchaseRow>(statements);
    if (results.length !== statements.length || results.some(result =>
        !result.success || result.results.some(row =>
            !Number.isSafeInteger(row.amount) || !Number.isSafeInteger(row.order_id)))) {
        throw new Error('Invalid purchase totals');
    }
    const purchaseRows = results.flatMap(result => result.results);
    const rows = (kind: string) => purchaseRows.filter(row => row.kind === kind);
    const money = (kind: string) => rows(kind).map(({ currency, amount }) => ({ currency, amount }));
    return {
        active: money('active'),
        archived: money('archived'),
        unallocated: money('unallocated'),
        excess: rows('excess').map(({ currency, amount, order_id: count }) => ({ currency, amount, count })),
        inconsistent: rows('inconsistent').map(row => row.order_id),
        review: rows('review').map(row => row.order_id),
        open: rows('open')[0]?.amount ?? 0,
        cancelled: rows('cancelled')[0]?.amount ?? 0,
    };
}

export async function readAdminDashboardSummary(db: D1Database | undefined) {
    const [collection, sleeves, components, sources, sync, purchases] = await Promise.all([
        readSection('collection', db, db => counts<Collection>(db, `
            WITH imported AS (
                SELECT wishlist, acquisition_status,
                       ${adminOwnedSql} AS owned
                FROM v2_collection_items WHERE record_scope = 'production'
            )
            SELECT COUNT(*) AS total, COUNT(CASE WHEN owned = 1 THEN 1 END) AS owned,
                   COUNT(CASE WHEN wishlist = 1 THEN 1 END) AS wishlist,
                   COUNT(CASE WHEN acquisition_status = 'preordered' THEN 1 END) AS preorder
            FROM imported`)),
        readSection('sleeves', db, async db => {
            const shortage = await readSleeveShortage(db);
            return { sizes: shortage.rows.length, requirements: shortage.requirementCount,
                shortage: shortage.totals.shortage, incomplete: shortage.totals.incomplete };
        }),
        readSection('components', db, db => counts<Components>(db, `
            SELECT (SELECT COUNT(*) FROM v2_component_definitions WHERE collection_item_id IN (${production})) AS definitions,
                   (SELECT COUNT(*) FROM v2_copy_components c JOIN v2_owned_copies copy ON copy.id = c.owned_copy_id
                    WHERE copy.collection_item_id IN (${production})) AS records`)),
        readSection('sources', db, db => counts<Sources>(db, `
            SELECT (SELECT COUNT(*) FROM v2_games g JOIN v2_legacy_id_map m
                    ON m.target_id = g.id AND m.target_table = 'v2_games' AND m.legacy_table = 'bgg_games') AS bgg,
                   (SELECT COUNT(*) FROM notbgg_games) AS notbgg`)),
        // Match the BGG failed filter, which treats an interrupted sync as currently failed.
        readSection('bgg-sync', db, db => counts<{ failed: number }>(db, `
            SELECT COUNT(*) AS failed FROM bgg_games
            WHERE sync_status = 'failed' OR (sync_status = 'syncing' AND NOT EXISTS (
                SELECT 1 FROM v2_bgg_sync_gate WHERE owner = bgg_games.sync_owner AND lease_until >= unixepoch('now') * 1000
            ))`)),
        readSection('purchases', db, readPurchases),
    ]);
    return { collection, sleeves, components, sources, sync, purchases };
}
