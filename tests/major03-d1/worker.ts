import {
    commitSharedQuantity, createQuantityOperationId, quantitySha256, type QuantityBaseline,
} from '../../src/lib/shared-quantity-commit';

const actor = 'major03-synthetic';
const signature = '0'.repeat(63) + '2';
const origin = 'http://127.0.0.1:18743';

async function state(db: D1Database, id: number) {
    const row = await db.prepare(`
        SELECT d.expected_quantity AS quantity, d.physical_revision AS revision,
          CAST(g.generation AS TEXT) AS generation,
          (SELECT COUNT(*) FROM d1_quantity_history WHERE definition_id = d.id) AS receipts
        FROM v2_component_definitions d JOIN d1_quantity_collection_generation g
          ON g.collection_id = d.collection_item_id
        WHERE d.id = ? AND EXISTS (
          SELECT 1 FROM v2_collection_items c WHERE c.id = d.collection_item_id
            AND c.record_scope = 'test' AND c.display_name LIKE 'MAJOR03 synthetic %'
        )`).bind(id).first<{quantity: number | null; revision: number; generation: string; receipts: number}>();
    if (!row) throw new Error('Fixture missing');
    return row;
}

async function quantityCase(db: D1Database, id: number, after: number | null) {
    const before = await state(db, id);
    if (before.revision !== 1 || before.receipts !== 0 || before.quantity !== (id === 304 ? null : 103)) {
        throw new Error('Fresh fixture required');
    }

    const edit = { definitionId: id, beforeRevision: 1, beforeQuantity: before.quantity,
        afterQuantity: after, name: 'Cards', type: 'card', unit: 'card', reason: 'Synthetic correction' };
    const source = await db.prepare(`
        SELECT json_object('version', 1, 'rule', 'expected-minus-checked-v1',
          'oldExpected', CAST(? AS INTEGER), 'newExpected', CAST(? AS INTEGER),
          'items', json(evidence_items)) AS evidence
        FROM d1_quantity_admission WHERE id = ? AND evidence_items IS NOT NULL
    `).bind(before.quantity, after, id).first<{evidence: string}>();
    if (!source) throw new Error('Admission missing');

    const baseline: QuantityBaseline = {
        databaseEpoch: 'major03-synthetic-local', collectionId: id, recordScope: 'test',
        generation: before.generation, evidenceVersion: 1, sourceSignature: signature,
        evidenceDigest: await quantitySha256(source.evidence),
    };
    const operationId = await createQuantityOperationId(actor, edit, baseline);
    const commit = () => commitSharedQuantity(db, actor, operationId, edit, baseline, async () => true);

    if (id === 302) {
        await db.prepare("UPDATE v2_owned_copies SET edition = 'Synthetic changed' WHERE id = 302").run();
        await db.prepare("UPDATE v2_owned_copies SET edition = 'Synthetic A' WHERE id = 302").run();
        const outcome = await commit();
        const current = await state(db, id);
        return {
            stale: outcome.outcome === 'PERMANENTLY_REJECTED' && outcome.code === 'D1_CONFIRMATION_SUPERSEDED',
            unchanged: current.quantity === 103 && current.revision === 1 && current.receipts === 0,
            generationAdvanced: BigInt(current.generation) > BigInt(before.generation),
        };
    }

    const outcomes = id === 301 ? await Promise.all([commit(), commit()]) : [await commit()];
    const replay = await commit();
    const current = await state(db, id);
    const evidence = await db.prepare('SELECT evidence_json FROM d1_quantity_history WHERE operation_id = ?')
        .bind(operationId).first<string>('evidence_json');
    const items = JSON.parse(evidence ?? '{}').items;
    return {
        committed: outcomes.every(result => result.outcome === 'COMMITTED' && result.revision === 2
            && result.beforeQuantity === before.quantity && result.afterQuantity === after),
        replayed: replay.outcome === 'COMMITTED' && replay.replayed,
        updatedOnce: current.quantity === after && current.revision === 2 && current.receipts === 1,
        evidence: evidence === source.evidence && (id === 301
            ? items?.length === 2 && items[0].copyId === 301 && items[0].actual === 99
                && items[0].countDate === null && items[1].copyId === 305 && items[1].evidenceStatus === 'UNKNOWN'
            : items?.length === 1 && items[0].actual === null),
    };
}

async function rollbackCase(db: D1Database) {
    const before = await state(db, 303);
    let rejected = false;
    try {
        await db.batch([
            db.prepare("UPDATE v2_owned_copies SET edition = 'Synthetic rollback' WHERE id = 303"),
            db.prepare('UPDATE v2_component_definitions SET expected_quantity = 100 WHERE id = 303'),
        ]);
    } catch (error) {
        rejected = String(error).includes('D1_CURRENT_OPERATION_REQUIRED');
    }
    const current = await state(db, 303);
    const edition = await db.prepare('SELECT edition FROM v2_owned_copies WHERE id = 303').first('edition');
    return { rejected, rolledBack: edition === 'Synthetic A' && current.generation === before.generation
        && current.quantity === 103 && current.revision === 1 && current.receipts === 0 };
}

export default {
    async fetch(request: Request, env: { MAJOR03_DB: D1Database }) {
        const url = new URL(request.url);
        const peer = request.headers.get('CF-Connecting-IP');
        if (url.origin !== origin || (peer !== null && peer !== '127.0.0.1')
            || request.headers.has('Origin') || request.headers.has('Forwarded')
            || request.headers.has('X-Forwarded-For')) return new Response(null, { status: 403 });
        if (request.method !== 'POST' || request.body !== null || url.search
            || request.headers.get('X-Major03-Local') !== 'fixed-cases') return new Response(null, { status: 400 });

        try {
            const db = env.MAJOR03_DB;
            let checks: Record<string, boolean>;
            switch (url.pathname) {
                case '/replay': checks = await quantityCase(db, 301, 100); break;
                case '/stale': checks = await quantityCase(db, 302, 100); break;
                case '/rollback': checks = await rollbackCase(db); break;
                case '/null': checks = await quantityCase(db, 304, 0); break;
                default: return new Response(null, { status: 404 });
            }
            return Response.json({ checks });
        } catch {
            return Response.json({ code: 'CASE_ERROR' }, { status: 500 });
        }
    },
};
