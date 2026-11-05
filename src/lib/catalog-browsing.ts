import type { Game } from "./game-catalog";

/** Explicit #ID searches are exact; ordinary name/ID substring behavior stays unchanged. */
export function matchesCatalogSearch(data: Record<string,string|undefined>, query: string): boolean {
    const keyword=query.trim().toLocaleLowerCase();
    if(/^notbgg:/i.test(keyword))return data.notBggId?.toLowerCase()===keyword;
    if(/^(?:#|bgg:)\d+$/.test(keyword))return data.bggId===keyword.replace(/^(?:#|bgg:)/,'');
    return [data.name,data.originalName,data.searchNames,data.bggId].filter(Boolean).join(' ').toLocaleLowerCase().includes(keyword);
}
export function validCatalogStatistic(value: number | null | undefined, field: 'year'|'rating'): number | null {
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return null;
    return field==='rating'&&(value<1||value>10)?null:value;
}
export function catalogRange(min: number | undefined, max: number | undefined): string {
    if(min===undefined||max===undefined||!Number.isFinite(min)||!Number.isFinite(max)||min<=0||max<min)return '—';
    return min===max?String(min):`${min}–${max}`;
}

/** Buckets use BGG's maximum playing time, not an assumed duration or interval overlap. */
export function matchesPlayingTime(max: number | null, selection: string): boolean {
    if (!selection) return true;
    if (max === null || !Number.isFinite(max) || max <= 0) return false;
    if (selection === "31-60") return max > 30 && max <= 60;
    if (selection === "61-120") return max > 60 && max <= 120;
    if (selection === "over120") return max > 120;
    // Preserve previously shared cumulative time filters.
    return ["30", "60", "90", "120"].includes(selection) && max <= Number(selection);
}

/** Count unique expansion IDs only where a direction is actually evidenced. */
export function getKnownExpansionCounts(catalog: Game[]): Map<number, number> {
    const ids = new Map(catalog.map(game => [game.bggId, game]));
    const sets = new Map<number, Set<number>>();
    const add = (parent: number, child: number) => {
        if (!Number.isSafeInteger(parent) || parent <= 0 || !Number.isSafeInteger(child) || child <= 0 || parent === child) return;
        const known = ids.get(child)?.bgg;
        if (known && known.gameType !== "boardgameexpansion") return;
        if (!sets.has(parent)) sets.set(parent, new Set());
        sets.get(parent)!.add(child);
    };
    for (const game of catalog) {
        for (const link of game.bgg?.expansions ?? []) {
            if (link.inbound === false) add(game.bggId, link.id);
            if (link.inbound === true && game.bgg?.gameType === "boardgameexpansion") add(link.id, game.bggId);
        }
    }
    return new Map([...sets].map(([id, children]) => [id, children.size]));
}
