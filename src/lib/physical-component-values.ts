export const componentTypes = ['card', 'token', 'miniature', 'tile', 'board', 'die', 'other'] as const;
export const componentUnits = ['piece', 'card', 'tile', 'die', 'sheet', 'box', 'pack', 'set', 'other'] as const;
export const maxComponentQuantity = 100_000;
export const earliestCountDate = '2000-01-01';

const taipeiDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric',
    month: '2-digit', day: '2-digit',
    calendar: 'gregory', numberingSystem: 'latn' });

export function todayInTaipei(now = new Date()): string {
    const parts = taipeiDate.formatToParts(now);
    const part = (type: 'year' | 'month' | 'day') => parts.find(value => value.type === type)!.value;
    return `${part('year')}-${part('month').padStart(2, '0')}-${part('day').padStart(2, '0')}`;
}

export function isCountDate(value: unknown, today = todayInTaipei()): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
        || value < earliestCountDate || value > today) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    // Parsing alone can normalize an impossible day into the next month.
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
