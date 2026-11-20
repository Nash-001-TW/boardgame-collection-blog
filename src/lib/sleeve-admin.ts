import { HttpError } from './notbgg-admin-api';
import { classifyStoredComponents } from './component-classifier-adapter';

export function sleeveInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new HttpError(400, 'INVALID_SLEEVE_INPUT');
    }
    return value;
}

function text(value: unknown, max: number, required = false): string {
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
        throw new HttpError(400, 'INVALID_SLEEVE_INPUT');
    }
    return value.trim();
}

function dimensions(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 2000
        || Math.abs(value * 10 - Math.round(value * 10)) > 0.000001) throw new HttpError(400, 'INVALID_SLEEVE_INPUT');
    return Math.round(value * 10);
}

async function digest(value: string) {
    const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
}

function allowed(body: Record<string, unknown>, keys: string[]) {
    if (Object.keys(body).some(key => !keys.includes(key))) throw new HttpError(400, 'UNKNOWN_FIELD');
}

export const sleeveTransactions = ['OPENING_BALANCE', 'PURCHASE', 'USE', 'RETURN', 'ADJUST', 'DISCARD'] as const;

/** Shared atomic ledger command commit, including replay after a concurrent duplicate. */
export async function commitSleeveCommand(db:D1Database,statements:D1PreparedStatement[],
    replay:()=>Promise<{id:number;replayed:boolean}|null>,conflicts:RegExp,conflictCode:string){
    try{
        const result=await db.batch<{id:number}>(statements);
        return {id:result[result.length-2].results[0].id,replayed:false};
    }catch(error){
        const duplicate=await replay();if(duplicate)return duplicate;
        if(conflicts.test(String(error)))throw new HttpError(409,conflictCode);
        throw error;
    }
}

export async function writeSleeveAdmin(db: D1Database, actor: string, key: string | null, body: Record<string, unknown>) {
    const action = body.action;
    if (!['create','edit','archive','stock'].includes(String(action))) throw new HttpError(400, 'INVALID_SLEEVE_ACTION');
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY');
    const requestKey = await digest(JSON.stringify(['sleeve-admin', actor, key]));
    // Stable key order makes transport formatting irrelevant to a retried command.
    const normalized = Object.fromEntries(Object.entries(body).sort(([a],[b]) => a.localeCompare(b)));
    const hash = await digest(JSON.stringify(normalized));
    const replay = async () => {
        const previous = await db.prepare('SELECT request_hash, result_id FROM v2_sleeve_admin_commands WHERE request_key=?')
            .bind(requestKey).first<{ request_hash: string; result_id: number }>();
        if (!previous) return null;
        if (previous.request_hash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT');
        return { id: previous.result_id, replayed: true };
    };
    const previous = await replay();
    if (previous) return previous;
    const statements: D1PreparedStatement[] = [];
    let explicitResult: number | null = null;

    if (action === 'create' || action === 'edit') {
        allowed(body, ['action','productId','revision','name','brand','width','height','sheetsPerPack','thickness','notes','active']);
        const name = text(body.name, 160, true);
        const brand = text(body.brand, 100);
        const notes = text(body.notes, 1000);
        const width = dimensions(body.width), height = dimensions(body.height);
        const pack = sleeveInteger(body.sheetsPerPack, 1, 10_000);
        const thickness = body.thickness === null ? null : sleeveInteger(body.thickness, 1, 2000);
        if (typeof body.active !== 'boolean') throw new HttpError(400, 'INVALID_SLEEVE_INPUT');
        statements.push(db.prepare('INSERT INTO v2_sleeve_sizes(width_tenth_mm,height_tenth_mm) VALUES (?,?) ON CONFLICT(width_tenth_mm,height_tenth_mm) DO NOTHING').bind(width,height));
        if (action === 'create') {
            statements.push(db.prepare(`INSERT INTO v2_sleeve_products
                (size_id,brand,product_name,sheets_per_pack,thickness_microns,notes,is_active,admin_revision)
                VALUES ((SELECT id FROM v2_sleeve_sizes WHERE width_tenth_mm=? AND height_tenth_mm=?),?,?,?,?,?,?,1)
                RETURNING id`).bind(width,height,brand || null,name,pack,thickness,notes || null,Number(body.active)));
        } else {
            explicitResult = sleeveInteger(body.productId,1);
            const revision = sleeveInteger(body.revision);
            statements.push(db.prepare(`UPDATE v2_sleeve_products SET
                size_id=(SELECT id FROM v2_sleeve_sizes WHERE width_tenth_mm=? AND height_tenth_mm=?),
                brand=?,product_name=?,sheets_per_pack=?,thickness_microns=?,notes=?,is_active=?,
                admin_revision=admin_revision+1,updated_at=CURRENT_TIMESTAMP
                WHERE id=? AND admin_revision=? AND (
                    size_id=(SELECT id FROM v2_sleeve_sizes WHERE width_tenth_mm=? AND height_tenth_mm=?)
                    OR NOT EXISTS (SELECT 1 FROM v2_sleeve_inventory_transactions WHERE product_id=v2_sleeve_products.id))
                RETURNING id`).bind(width,height,brand || null,name,pack,thickness,notes || null,Number(body.active),
                    explicitResult,revision,width,height));
        }
    } else if (action === 'archive') {
        allowed(body,['action','productId','revision']);
        explicitResult = sleeveInteger(body.productId,1);
        statements.push(db.prepare(`UPDATE v2_sleeve_products SET is_active=0,admin_revision=admin_revision+1,
            updated_at=CURRENT_TIMESTAMP WHERE id=? AND admin_revision=? RETURNING id`)
            .bind(explicitResult,sleeveInteger(body.revision)));
    } else {
        allowed(body,['action','productId','revision','lastTransactionId','kind','quantity','date','notes']);
        const productId = sleeveInteger(body.productId,1);
        const revision = sleeveInteger(body.revision);
        const last = sleeveInteger(body.lastTransactionId);
        const kind = body.kind as typeof sleeveTransactions[number];
        if (!sleeveTransactions.includes(kind)) throw new HttpError(400, 'INVALID_SLEEVE_INPUT');
        const quantity = sleeveInteger(body.quantity,kind === 'ADJUST' ? -1_000_000 : 1,1_000_000);
        if (quantity === 0) throw new HttpError(400, 'INVALID_SLEEVE_INPUT');
        const date = text(body.date,10,true);
        const timestamp = Date.parse(date+'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp)
            || new Date(timestamp).toISOString().slice(0,10) !== date) {
            throw new HttpError(400, 'INVALID_SLEEVE_INPUT');
        }
        const notes = text(body.notes,1000);
        statements.push(db.prepare(`INSERT INTO v2_sleeve_inventory_transactions
            (source_key,product_id,transaction_type,transaction_date,pack_count,sheets_per_pack_snapshot,quantity_sheets,notes)
            SELECT ?,p.id,?,?,CASE WHEN ?='PURCHASE' THEN ? END,
                CASE WHEN ?='PURCHASE' THEN p.sheets_per_pack END,
                CASE WHEN ?='PURCHASE' THEN ?*p.sheets_per_pack
                    WHEN ? IN ('USE','DISCARD') THEN -? ELSE ? END,?
            FROM v2_sleeve_products p WHERE p.id=? AND p.admin_revision=? AND p.is_active=1
              AND COALESCE((SELECT MAX(id) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id),0)=?
              AND ((?='OPENING_BALANCE' AND ?=0) OR (?='PURCHASE') OR (? NOT IN ('PURCHASE','OPENING_BALANCE') AND ?>0))
              AND (?<>'PURCHASE' OR ?*p.sheets_per_pack<=1000000)
              AND COALESCE((SELECT SUM(quantity_sheets) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id),0)
                + CASE WHEN ?='PURCHASE' THEN ?*p.sheets_per_pack WHEN ? IN ('USE','DISCARD') THEN -? ELSE ? END >= 0
            RETURNING id`).bind(requestKey,kind,date,kind,quantity,kind,kind,quantity,kind,quantity,quantity,notes || null,
                productId,revision,last,kind,last,kind,kind,last,kind,quantity,kind,quantity,kind,quantity,quantity));
    }

    statements.push(db.prepare(`INSERT INTO v2_sleeve_admin_commands(request_key,request_hash,actor,operation,result_id)
        VALUES (?,?,?,?,CASE WHEN changes()=1 THEN ${explicitResult === null ? 'last_insert_rowid()' : '?'} ELSE NULL END)`)
        .bind(requestKey,hash,actor,String(action),...(explicitResult === null ? [] : [explicitResult])));
    return commitSleeveCommand(db,statements,replay,
        /NOT NULL constraint failed: v2_sleeve_admin_commands.result_id|stock negative/,'SLEEVE_STATE_CHANGED');
}

export async function readSleeveAdmin(db: D1Database, params: URLSearchParams, secret: unknown) {
    const view = params.get('view') ?? 'products';
    const after = Number(params.get('after') ?? 0);
    sleeveInteger(after);
    const q = (params.get('q') ?? '').trim();
    if (q.length > 160 || !['products','sizes','requirements','transactions'].includes(view)) throw new HttpError(400,'INVALID_SLEEVE_QUERY');
    const size = Number(params.get('size') ?? 0), product = Number(params.get('product') ?? 0);
    sleeveInteger(size); sleeveInteger(product);
    const active = params.get('active') ?? 'all';
    if (!['all','active','inactive'].includes(active)) throw new HttpError(400,'INVALID_SLEEVE_QUERY');
    let rows: Record<string, unknown>[];
    if (view === 'products') {
        const result = await db.prepare(`SELECT p.*,s.width_tenth_mm,s.height_tenth_mm,
            (SELECT COUNT(*) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id) AS transaction_count,
            (SELECT COALESCE(MAX(id),0) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id) AS last_transaction_id,
            (SELECT SUM(quantity_sheets) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id) AS balance,
            (SELECT SUM(-quantity_sheets) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id AND transaction_type='USE') AS used,
            (SELECT SUM(quantity_sheets) FROM v2_sleeve_inventory_transactions WHERE product_id=p.id AND transaction_type IN ('OPENING_BALANCE','PURCHASE')) AS received
            FROM v2_sleeve_products p JOIN v2_sleeve_sizes s ON s.id=p.size_id
            WHERE p.id>? AND (?=0 OR p.size_id=?) AND (?=0 OR p.id=?)
              AND (?='all' OR p.is_active=CASE WHEN ?='active' THEN 1 ELSE 0 END)
              AND (?='' OR instr(lower(COALESCE(p.brand,'')||' '||p.product_name),lower(?))>0)
            ORDER BY p.id LIMIT 21`).bind(after,size,size,product,product,active,active,q,q).all<Record<string,unknown>>();
        if (!result.success) throw new HttpError(503,'DATABASE_UNAVAILABLE');
        rows = result.results;
    } else if (view === 'sizes') {
        const result = await db.prepare(`SELECT s.*,
            (SELECT COUNT(*) FROM v2_sleeve_products WHERE size_id=s.id) AS product_count,
            (SELECT COUNT(*) FROM v2_sleeve_requirements WHERE size_id=s.id) AS requirement_count,
            (SELECT SUM(quantity_sheets) FROM v2_sleeve_requirements WHERE size_id=s.id) AS required
            FROM v2_sleeve_sizes s WHERE s.id>? AND (?=0 OR s.id=?) ORDER BY s.id LIMIT 21`)
            .bind(after,size,size).all<Record<string,unknown>>();
        if (!result.success) throw new HttpError(503,'DATABASE_UNAVAILABLE');
        rows = result.results;
    } else if (view === 'transactions') {
        const result = await db.prepare(`SELECT t.*,p.product_name,p.brand FROM v2_sleeve_inventory_transactions t
            JOIN v2_sleeve_products p ON p.id=t.product_id
            WHERE t.id>? AND (?=0 OR t.product_id=?) AND (?=0 OR p.size_id=?)
            AND (?='' OR instr(lower(p.product_name||' '||COALESCE(t.notes,'')),lower(?))>0)
            ORDER BY t.id LIMIT 21`).bind(after,product,product,size,size,q,q).all<Record<string,unknown>>();
        if (!result.success) throw new HttpError(503,'DATABASE_UNAVAILABLE');
        rows = result.results;
    } else {
        const scope = params.get('scope') ?? 'production';
        if (!['production','test'].includes(scope)) throw new HttpError(400,'INVALID_SCOPE');
        const result = await db.prepare(`SELECT r.*,c.display_name,c.record_scope,d.component_name,d.component_type,
                s.width_tenth_mm,s.height_tenth_mm
            FROM v2_sleeve_requirements r JOIN v2_collection_items c ON c.id=r.collection_item_id
            JOIN v2_sleeve_sizes s ON s.id=r.size_id LEFT JOIN v2_component_definitions d ON d.id=r.component_definition_id
            WHERE r.id>? AND c.record_scope=? AND (?=0 OR r.size_id=?)
              AND (?='' OR instr(lower(c.display_name),lower(?))>0)
            ORDER BY r.id LIMIT 21`).bind(after,scope,size,size,q,q).all<Record<string,unknown>>();
        if (!result.success) throw new HttpError(503,'DATABASE_UNAVAILABLE');
        const ids = result.results.slice(0,20).flatMap(row => typeof row.component_definition_id === 'number' ? [row.component_definition_id] : []);
        const classifications = new Map((await classifyStoredComponents(db,ids,{secret})).map(result=>[result.definitionId,result]));
        rows = result.results.map(row => ({...row,classification:row.component_definition_id === null ? null
            : classifications.get(Number(row.component_definition_id))?.classification ?? 'UNKNOWN',
            classification_reason: classifications.get(Number(row.component_definition_id))?.reason ?? null}));
    }
    return { view, rows: rows.slice(0,20), nextCursor: rows.length>20 ? rows[19].id as number : null };
}
