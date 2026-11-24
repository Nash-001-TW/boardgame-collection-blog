import type { CollectionListPage } from './collection-v2-management';

const pageSize = 20;
export const collectionPickerNumeric = (query: string) => /^[0-9]+$/.test(query);

type SearchBasis = 'collection' | 'bgg';
interface PickerRequest {
    url: string;
    basis?: SearchBasis;
    exact?: string;
}

export function collectionPickerRequests(query: string, after: number): PickerRequest[] {
    const request = (q: string, basis?: SearchBasis, exact?: string): PickerRequest => ({
        url: '/api/admin/collection?' + new URLSearchParams({
            q, scope: 'production', view: 'records', limit: String(pageSize), after: String(after),
        }),
        basis,
        exact,
    });
    if (!collectionPickerNumeric(query)) return [request(query)];
    return [request(query, 'collection', query), request('bgg:' + query, 'bgg', query)];
}

export interface PickerRow {
    id: number;
    name: string;
    source: string | null;
    status: string;
    archived: boolean;
    bases: SearchBasis[];
}

export function mergeCollectionPickerPages(pages: { request: PickerRequest; page: CollectionListPage }[]) {
    const rows = new Map<number, PickerRow>();
    // A stream with more results only guarantees matches up to its returned cursor.
    // The shared cursor cannot pass that point without potentially losing a match or its second basis.
    const scannedThrough = Math.min(...pages.map(({ page }) => page.nextCursor ?? Infinity));
    for (const { request, page } of pages) {
        for (const group of page.groups) {
            for (const item of group.items) {
                if (item.id > scannedThrough) continue;
                // The shared API also matches name substrings. Only label exact ID matches as IDs.
                if (request.basis === 'collection' && String(item.id) !== request.exact) continue;
                if (request.basis === 'bgg' && group.source_id?.toLowerCase() !== 'bgg:' + request.exact) continue;
                const existing = rows.get(item.id);
                if (existing) {
                    if (request.basis && !existing.bases.includes(request.basis)) existing.bases.push(request.basis);
                    continue;
                }
                rows.set(item.id, {
                    id: item.id, name: item.display_name, source: group.source_id, status: item.acquisition_status,
                    archived: item.archived_at !== null, bases: request.basis ? [request.basis] : [],
                });
            }
        }
    }
    const sorted = [...rows.values()].sort((a, b) => a.id - b.id);
    const visible = sorted.slice(0, pageSize);
    return {
        rows: visible,
        nextCursor: sorted.length > pageSize ? visible[pageSize - 1].id : Number.isFinite(scannedThrough) ? scannedThrough : null,
    };
}

export function collectionPickerOutcome(httpOk: boolean, body: unknown): CollectionListPage {
    if (httpOk && body && typeof body === 'object' && 'success' in body && body.success === true && 'data' in body) {
        const page = body.data as CollectionListPage | null;
        if (page && Array.isArray(page.groups) && (page.nextCursor === null ||
            (Number.isSafeInteger(page.nextCursor) && page.nextCursor > 0))) return page;
    }
    throw new Error('Collection search failed');
}

const statuses: Record<string, readonly [string, string]> = {
    owned: ['已收藏', 'Owned'],
    preordered: ['預購', 'Preordered'],
    wishlist: ['願望清單', 'Wishlist'],
    not_owned: ['未收藏', 'Not owned'],
    sold: ['已售出', 'Sold'],
    gifted_away: ['已送出', 'Gifted away'],
    unknown: ['未知', 'Unknown'],
    archived: ['已封存', 'Archived'],
};

export function collectionPickerStatus(status: string, en: boolean): string {
    const labels = Object.hasOwn(statuses, status) ? statuses[status] : statuses.unknown;
    return labels[en ? 1 : 0];
}
