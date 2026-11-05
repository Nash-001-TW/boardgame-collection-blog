import type { BggGameData } from "./bgg-types";

/** A catalog entry is not an ownership record. No personal fields belong here. */
export interface Game {
    bggId: number;
    slug: string;
    name: string;
    bgg: BggGameData | null;
}

export interface CatalogRegistration {
    bggId: number;
    slug?: string;
    name?: string;
}

/** Include all imported cache entries, plus registered games awaiting details. */
export function buildGameCatalog(
    cache: Record<string, BggGameData>,
    registrations: CatalogRegistration[]
): Game[] {
    const registered = new Map<number, CatalogRegistration>();
    for (const entry of registrations) {
        if (Number.isSafeInteger(entry.bggId) && entry.bggId > 0) {
            const previous = registered.get(entry.bggId);
            registered.set(entry.bggId, { ...entry, ...previous });
        }
    }
    const ids = new Set([...Object.keys(cache).map(Number), ...registered.keys()]);
    return [...ids].filter(id => Number.isSafeInteger(id) && id > 0)
        .sort((a, b) => a - b).map(bggId => {
            const entry = registered.get(bggId);
            const bgg = cache[String(bggId)] ?? null;
            return { bggId, slug: entry?.slug ?? `bgg-${bggId}`,
                name: bgg?.name ?? entry?.name ?? `BGG #${bggId}`, bgg };
        });
}
