import { quantityPreviewView } from './d1-quantity-preview-view';
import { projectQuantitySnapshot } from './shared-quantity-preview';

type Receipt = {
    kind: 'receipt';
    id: number;
    actorSuffix: string;
    beforeQuantity: number | null;
    afterQuantity: number | null;
    unit: string;
    reason: string;
    evidence: string;
    generation: string;
    committedAt: number;
};
type Copy = { kind: 'copy'; id: number; copyLabel: string | null };
type Snapshot = Parameters<typeof projectQuantitySnapshot>[0];
type SnapshotItem = Snapshot['items'][number] & { edition?: string | null; language?: string | null };

function restoreImpact(receipt: Receipt, collectionId: number) {
    try {
        const snapshot: {
            version: number; rule: string; oldExpected: number | null; newExpected: number | null;
            items: SnapshotItem[];
        } = JSON.parse(receipt.evidence);
        if (snapshot?.version !== 1 || snapshot.rule !== 'expected-minus-checked-v1'
            || snapshot.oldExpected !== receipt.beforeQuantity || snapshot.newExpected !== receipt.afterQuantity
            || !Array.isArray(snapshot.items) || snapshot.items.length > 200
            || new Set(snapshot.items.map(item => item.copyId)).size !== snapshot.items.length
            || !snapshot.items.every(item =>
                (item.inventory === 'in_collection' || item.inventory === 'loaned')
                && ['UNKNOWN', 'UNCONFIRMED', 'OBSERVED_CURRENT_COUNT'].includes(item.evidenceStatus)
                && (item.evidenceStatus !== 'OBSERVED_CURRENT_COUNT'
                    || (item.inspection === 'checked' && item.actual !== null
                        && typeof item.countId === 'number' && Number.isSafeInteger(item.countId) && item.countId > 0
                        && typeof item.countRevision === 'number' && Number.isSafeInteger(item.countRevision)
                        && item.countRevision >= 0)))) return null;
        const impact = projectQuantitySnapshot(snapshot, { collectionId, generation: receipt.generation },
            { definitionId: receipt.id, beforeQuantity: receipt.beforeQuantity, afterQuantity: receipt.afterQuantity });
        return impact.status === 'READY' ? { impact, items: snapshot.items } : null;
    } catch {
        // A damaged receipt still has a usable summary. Never reconstruct evidence from the current count.
        return null;
    }
}

// Receipts store the unit code; show the same labels as the R06 form (PhysicalComponentFields).
const unitLabels: Record<string, [string, string]> = {
    piece: ['件', 'piece'], card: ['張', 'card'], tile: ['塊', 'tile'], die: ['顆', 'die'], sheet: ['頁', 'sheet'],
    box: ['盒', 'box'], pack: ['包', 'pack'], set: ['組', 'set'], other: ['其他', 'other'],
};

function historyEntry(receipt: Receipt, collectionId: number, copies: ReadonlyMap<number, string | null>, en: boolean,
    clock: Intl.DateTimeFormat, number: Intl.NumberFormat) {
    const t = (zh: string, english: string) => en ? english : zh;
    const unit = unitLabels[receipt.unit]?.[en ? 1 : 0] ?? receipt.unit;
    const date = new Date(receipt.committedAt * 1000);
    const quantity = (value: number | null) => value === null ? '—' : number.format(value);
    const restored = restoreImpact(receipt, collectionId);
    const labels = new Map(restored?.items.map(({ copyId, edition, language }) => {
        const fallback = t(`副本 #${copyId}`, `Copy #${copyId}`);
        const name = copies.has(copyId) ? copies.get(copyId)?.trim() || fallback
            : t(`${fallback}（已移除）`, `${fallback} (removed)`);
        const metadata = (value: unknown) => typeof value === 'string' && value.trim() ? value : '—';
        return [copyId, `${name} · ${metadata(edition)} / ${metadata(language)}`] as const;
    }));
    const view = restored && quantityPreviewView(restored.impact, labels, en, unit);
    return {
        isoTime: date.toISOString(),
        time: clock.format(date),
        change: `${quantity(receipt.beforeQuantity)} → ${quantity(receipt.afterQuantity)} ${unit}`,
        reason: receipt.reason,
        detail: view && {
            actor: t(`管理員（${receipt.actorSuffix}）`, `Administrator (${receipt.actorSuffix})`),
            affected: number.format(view.affected),
            missing: view.missing,
            unit,
            rows: view.groups.flatMap(group => group.rows),
        },
    };
}

export type QuantityHistory = { status: 'unavailable' }
    | { status: 'ready'; byDefinition: ReadonlyMap<number, ReturnType<typeof historyEntry>[]> };

export async function readQuantityHistory(db: D1Database, collectionId: number, en: boolean): Promise<QuantityHistory> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // Include non-operable copies so sealed and loaned copies can still resolve their names.
        // Return each name once and keep all receipts ordered in the same D1 read.
        const query = db.prepare(`
            SELECT 'receipt' AS kind, definition_id AS id, substr(actor, -6) AS actorSuffix,
                   before_quantity AS beforeQuantity, after_quantity AS afterQuantity, unit, reason,
                   evidence_json AS evidence, CAST(before_generation AS TEXT) AS generation,
                   committed_at AS committedAt, after_revision AS revision, NULL AS copyLabel
            FROM d1_quantity_history WHERE collection_id = ?
            UNION ALL
            SELECT 'copy', id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, copy_label
            FROM v2_owned_copies WHERE collection_item_id = ?
            ORDER BY committedAt DESC, revision DESC, id
        `).bind(collectionId, collectionId).all<Receipt | Copy>();
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('D1 history read timed out')), 5_000);
        });
        const result = await Promise.race([query, timeout]);
        if (!result.success) throw new Error('D1 history read failed');
        const copies = new Map<number, string | null>();
        for (const row of result.results) {
            if (row.kind === 'copy') copies.set(row.id, row.copyLabel);
        }
        const byDefinition = new Map<number, ReturnType<typeof historyEntry>[]>();
        const locale = en ? 'en' : 'zh-TW';
        const clock = new Intl.DateTimeFormat(locale, {
            timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        });
        const number = new Intl.NumberFormat(locale);
        for (const row of result.results) {
            if (row.kind !== 'receipt') continue;
            const entries = byDefinition.get(row.id) ?? [];
            entries.push(historyEntry(row, collectionId, copies, en, clock, number));
            byDefinition.set(row.id, entries);
        }
        return { status: 'ready', byDefinition };
    } catch (error) {
        // Error kind only: never log collection data or user input.
        console.error('D1 quantity history unavailable', { kind: error instanceof Error ? error.name : typeof error });
        return { status: 'unavailable' };
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}
