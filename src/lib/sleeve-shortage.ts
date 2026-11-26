type Size = { id: number; width_tenth_mm: number; height_tenth_mm: number };
type Requirement = { id: number; collection_item_id: number; owned_copy_id: number | null; size_id: number;
    quantity_sheets: number; component_definition_id: number | null };
type Exclusion = { collection_id: number; copy_id: number; definition_id: number };
type Copy = { id: number; collection_item_id: number; inventory_status: string };
type Product = { size_id: number; is_active: number; balance: number | null; unsafe_quantity: number };
type Application = { requirement_id: number | null; owned_copy_id: number; collection_item_id: number; size_id: number | null; quantity_sheets: number };
export type ShortageStatus = 'none' | 'no_product' | 'incomplete' | 'shortage' | 'sufficient';
type Reason = 'unknown_copy' | 'legacy_application' | 'unknown_stock' | 'invalid_quantity' | 'missing_copy';

export interface SleeveShortageRow extends Size {
    activeProducts: number;
    inactiveProducts: number;
    available: number | null;
    inactiveStock: number | null;
    pending: number | null;
    gap: number | null;
    requirementCount: number;
    historicalCount: number;
    status: ShortageStatus;
    reasons: Reason[];
}

function integer(value: number) {
    if (!Number.isSafeInteger(value)) throw new Error('Invalid sleeve shortage integer');
    return value;
}

const production = `JOIN v2_collection_items c ON c.id = item.collection_item_id
    LEFT JOIN v2_collection_management m ON m.collection_item_id = c.id`;
const eligibleCollection = "c.record_scope = 'production' AND m.archived_at IS NULL";
const applicable = (copy: Copy) => copy.inventory_status === 'in_collection' || copy.inventory_status === 'loaned';

async function readSnapshot(db: D1Database) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Sleeve shortage read timed out')), 8000);
    });
    try {
        // One snapshot for requirements, copy status, application history and ledger balances.
        return await Promise.race([db.batch(dbStatements(db)), deadline]);
    } finally {
        clearTimeout(timer);
    }
}

export async function readSleeveShortage(db: D1Database) {
    const results = await readSnapshot(db);
    if (results.length !== 6 || results.some(result => !result.success || !Array.isArray(result.results))) {
        throw new Error('Sleeve shortage read failed');
    }
    const [sizes, requirements, copies, products, applications, exclusions] = results.map(result => result.results) as
        [Size[], Requirement[], Copy[], Product[], Application[], Exclusion[]];
    const excluded = new Set(exclusions.map(a => `${a.collection_id}:${a.copy_id}:${a.definition_id}`));
    const rows = new Map<number, SleeveShortageRow>();
    for (const size of sizes) {
        integer(size.width_tenth_mm);
        integer(size.height_tenth_mm);
        rows.set(integer(size.id), { ...size, activeProducts: 0, inactiveProducts: 0, available: 0,
            inactiveStock: 0, pending: 0, gap: null, requirementCount: 0, historicalCount: 0, status: 'none', reasons: [] });
    }
    const sizeRow = (id: number) => {
        const row = rows.get(integer(id));
        if (!row) throw new Error('Missing sleeve size');
        return row;
    };
    const addReason = (row: SleeveShortageRow, reason: Reason) => {
        if (!row.reasons.includes(reason)) row.reasons.push(reason);
    };
    for (const product of products) {
        const row = sizeRow(product.size_id);
        const balance = product.balance === null ? null : integer(product.balance);
        if (integer(product.unsafe_quantity)) throw new Error('Invalid sleeve ledger quantity');
        if (balance !== null && balance < 0) addReason(row, 'invalid_quantity');
        if (integer(product.is_active) === 1) {
            row.activeProducts++;
            if (balance === null) addReason(row, 'unknown_stock');
            else row.available = integer((row.available ?? 0) + balance);
        } else {
            row.inactiveProducts++;
            row.inactiveStock = balance === null || balance < 0 || row.inactiveStock === null
                ? null : integer(row.inactiveStock + balance);
        }
    }

    const copiesByCollection = new Map<number, Copy[]>();
    for (const copy of copies) {
        integer(copy.id);
        const id = integer(copy.collection_item_id);
        const group = copiesByCollection.get(id) ?? [];
        group.push(copy);
        copiesByCollection.set(id, group);
    }
    const legacyScopes = new Set<string>();
    const applied = new Map<string, { total: number; negative: boolean }>();
    let unlocatedHistoricalCount = 0;
    for (const application of applications) {
        const quantity = integer(application.quantity_sheets);
        const copyId = integer(application.owned_copy_id);
        if (application.requirement_id === null) {
            if (application.size_id === null || !rows.has(integer(application.size_id))) unlocatedHistoricalCount++;
            else {
                sizeRow(application.size_id).historicalCount++;
                legacyScopes.add(`${integer(application.collection_item_id)}:${application.size_id}`);
            }
        } else {
            const key = `${integer(application.requirement_id)}:${copyId}`;
            const prior = applied.get(key);
            applied.set(key, { total: integer((prior?.total ?? 0) + quantity), negative: !!prior?.negative || quantity < 0 });
        }
    }

    const uncertainDemandSizes = new Set<number>();
    const demandSizes = new Set<number>();
    for (const requirement of requirements) {
        const id = integer(requirement.id);
        const quantity = integer(requirement.quantity_sheets);
        const row = sizeRow(requirement.size_id);
        row.requirementCount++;
        const allCopies = copiesByCollection.get(integer(requirement.collection_item_id)) ?? [];
        const isExcluded = (copyId: number) => requirement.component_definition_id !== null
            && excluded.has(`${requirement.collection_item_id}:${copyId}:${requirement.component_definition_id}`);
        if (requirement.owned_copy_id !== null && isExcluded(requirement.owned_copy_id)) continue;
        if (requirement.owned_copy_id === null && allCopies.some(applicable)
            && allCopies.every(copy => (!applicable(copy) && copy.inventory_status !== 'unknown') || isExcluded(copy.id))) continue;
        const collectionCopies = allCopies.filter(copy => !isExcluded(copy.id));
        const eligible = collectionCopies.filter(applicable);
        const unknownCopy = collectionCopies.some(copy => copy.inventory_status === 'unknown');
        const legacy = legacyScopes.has(`${requirement.collection_item_id}:${row.id}`);
        if (unknownCopy) addReason(row, 'unknown_copy');
        if (legacy) addReason(row, 'legacy_application');
        if (eligible.length === 0) addReason(row, 'missing_copy');
        if (quantity < 0) addReason(row, 'invalid_quantity');
        if (requirement.owned_copy_id !== null) integer(requirement.owned_copy_id);
        // A positive requirement with uncertain copy coverage still participates in status and filtering.
        if (quantity < 0 || (quantity > 0 && (eligible.length === 0 || unknownCopy || legacy))) {
            uncertainDemandSizes.add(row.id);
            demandSizes.add(row.id);
        }
        for (const copy of eligible) {
            if (requirement.owned_copy_id !== null && requirement.owned_copy_id !== copy.id) continue;
            const used = applied.get(`${id}:${copy.id}`);
            const remaining = integer(quantity - (used?.total ?? 0));
            if (remaining < 0 || used?.negative) {
                addReason(row, 'invalid_quantity');
                uncertainDemandSizes.add(row.id);
                demandSizes.add(row.id);
                continue;
            }
            if (remaining > 0) demandSizes.add(row.id);
            row.pending = integer((row.pending ?? 0) + remaining);
        }
    }

    const totals = { shortage: 0, incomplete: 0, no_product: 0 };
    for (const row of rows.values()) {
        if (uncertainDemandSizes.has(row.id)) row.pending = null;
        if (!demandSizes.has(row.id)) {
            if (row.reasons.includes('unknown_stock') || row.reasons.includes('invalid_quantity')) row.available = null;
            continue;
        }
        if (row.activeProducts + row.inactiveProducts === 0) row.status = 'no_product';
        else if (row.reasons.length) row.status = 'incomplete';
        else {
            row.gap = Math.max(0, integer((row.pending ?? 0) - (row.available ?? 0)));
            row.status = row.gap > 0 ? 'shortage' : 'sufficient';
        }
        if (row.status === 'no_product' || row.status === 'incomplete') {
            row.available = null;
            totals[row.status]++;
        } else if (row.status === 'shortage') totals.shortage++;
    }

    const rank = (status: ShortageStatus) => status === 'shortage' ? 0 : status === 'incomplete' ? 1 : 2;
    return {
        rows: [...rows.values()].sort((a, b) => rank(a.status) - rank(b.status) ||
            a.width_tenth_mm - b.width_tenth_mm || a.height_tenth_mm - b.height_tenth_mm),
        totals, unlocatedHistoricalCount, requirementCount: requirements.length,
    };
}

function dbStatements(db: D1Database) {
    return [
        db.prepare('SELECT id, width_tenth_mm, height_tenth_mm FROM v2_sleeve_sizes'),
        db.prepare(`SELECT item.id, item.collection_item_id, item.owned_copy_id, item.size_id, item.quantity_sheets,
                item.component_definition_id
            FROM v2_sleeve_requirements item ${production} WHERE ${eligibleCollection}`),
        db.prepare(`SELECT item.id, item.collection_item_id, item.inventory_status
            FROM v2_owned_copies item ${production} WHERE ${eligibleCollection}`),
        db.prepare(`SELECT p.size_id, p.is_active, SUM(t.quantity_sheets) AS balance,
                COUNT(CASE WHEN (typeof(t.quantity_sheets) <> 'integer' AND t.id IS NOT NULL)
                    OR t.quantity_sheets NOT BETWEEN -9007199254740991 AND 9007199254740991 THEN 1 END) AS unsafe_quantity
            FROM v2_sleeve_products p LEFT JOIN v2_sleeve_inventory_transactions t ON t.product_id = p.id
            GROUP BY p.id`),
        db.prepare(`SELECT a.requirement_id, a.owned_copy_id, item.collection_item_id, p.size_id, a.quantity_sheets
            FROM v2_sleeve_applications a JOIN v2_owned_copies item ON item.id = a.owned_copy_id ${production}
            LEFT JOIN v2_sleeve_inventory_transactions t ON t.id = a.inventory_transaction_id
            LEFT JOIN v2_sleeve_products p ON p.id = t.product_id
            WHERE ${eligibleCollection}`),
        db.prepare(`SELECT collection_id, copy_id, definition_id
            FROM v2_component_applicability_current WHERE not_applicable = 1`),
    ];
}
