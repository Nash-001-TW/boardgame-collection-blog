import type { projectQuantityImpact } from './physical-quantity-impact';

type Impact = Extract<ReturnType<typeof projectQuantityImpact>, { status: 'READY' }>;
type Detail = Impact['details'][number];

export function quantityPreviewView(impact: Impact, copies: ReadonlyMap<number, string>, en: boolean, unit: string) {
    const t = (zh: string, english: string) => en ? english : zh;
    const number = new Intl.NumberFormat(en ? 'en' : 'zh-TW');
    const format = (value: number) => number.format(value);
    // Unreadable sides state why, so a box is never shown as a bare dash without a cause.
    const unreadable: Record<Extract<Detail['before'], { status: 'unreadable' }>['reason'], string> = {
        UNCHECKED: t('尚未清點', 'Not counted'),
        NEEDS_REVIEW: t('需要複查', 'Needs review'),
        EVIDENCE_UNAVAILABLE: t('清點證據不可用', 'Count evidence unavailable'),
        ACTUAL_UNKNOWN: t('實點不明', 'Actual count unknown'),
        EXPECTED_UNKNOWN: t('預期量未設定', 'Expected quantity not set'),
    };
    function judgement(result: Detail['before'], expected: number | null, actual: number | null) {
        if (result.status === 'unreadable') return unreadable[result.reason];
        if (expected === null || actual === null) return '—';
        if (result.units > 0) return t(`缺 ${format(result.units)} ${unit}`, `Short by ${format(result.units)}`);
        if (actual > expected) return t(`不缺（多 ${format(actual - expected)} ${unit}）`, `No shortage (${format(actual - expected)} extra)`);
        return t('不缺', 'No shortage');
    }
    const groups = [
        { key: 'changed', label: t('變動', 'Changed'), open: true },
        { key: 'unchanged', label: t('不變', 'Unchanged'), open: false },
        { key: 'at_least_one_side_unreadable', label: t('無法判讀', 'Unable to assess'), open: false },
    ].map(group => ({
        ...group,
        rows: impact.details.filter(detail => detail.group === group.key).map(({ row, before, after, loaned }) => {
            const id = row.applicability.copyId;
            const name = copies.get(id)?.trim() || t(`副本 #${id}`, `Copy #${id}`);
            return {
                name: loaned ? `${name} ${t('（借出）', '(loaned)')}` : name,
                actual: row.actual === null ? '—' : format(row.actual),
                before: judgement(before, row.beforeExpected, row.actual),
                after: judgement(after, row.afterExpected, row.actual),
            };
        }),
    }));
    return {
        groups,
        affected: impact.affectedCopies,
        missing: `${format(impact.summary.before.missingUnits)} → ${format(impact.summary.after.missingUnits)}`,
        unreadable: groups[2].rows.length,
        excluded: impact.classification.excluded + impact.classification.not_applicable + impact.classification.unknown,
    };
}
