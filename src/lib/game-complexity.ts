/** BGG weight is meaningful only for finite numeric ratings in the closed 1–5 range. */
export function validGameComplexity(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}
