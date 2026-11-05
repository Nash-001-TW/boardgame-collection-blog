/** Source identities are separate from the existing numeric BGG ID and v2_games.id. */
declare const notBggIdBrand: unique symbol;
export type NotBggId = string & { readonly [notBggIdBrand]: true };
export type GameRef =
    | Readonly<{ source: 'bgg'; bggId: number }>
    | Readonly<{ source: 'notbgg'; notBggId: NotBggId }>;

export function isBggId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Formatting only, NOT allocation. D2 must allocate on the backend in D1. */
export function formatNotBggId(sequence: number): NotBggId {
    if (!isBggId(sequence)) throw new Error('Invalid NotBGG sequence');
    return `NotBGG:${String(sequence).padStart(6, '0')}` as NotBggId;
}

export function isNotBggId(value: unknown): value is NotBggId {
    if (typeof value !== 'string' || !/^NotBGG:\d{6,}$/.test(value)) return false;
    const sequence = Number(value.slice(7));
    return isBggId(sequence) && formatNotBggId(sequence) === value;
}

export function parseGameRef(value: unknown): GameRef {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
        || Reflect.ownKeys(value).some(key => typeof key !== 'string')) throw new Error('Invalid game reference');
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row).sort().join(',');
    if (keys === 'bggId,source' && row.source === 'bgg' && isBggId(row.bggId)) {
        return { source: 'bgg', bggId: row.bggId };
    }
    if (keys === 'notBggId,source' && row.source === 'notbgg' && isNotBggId(row.notBggId)) {
        return { source: 'notbgg', notBggId: row.notBggId };
    }
    throw new Error('Invalid game reference');
}

export function serializeGameRef(value: GameRef): string {
    const ref = parseGameRef(value);
    return ref.source === 'bgg' ? `BGG:${ref.bggId}` : ref.notBggId;
}

export function deserializeGameRef(value: unknown): GameRef {
    if (isNotBggId(value)) return { source: 'notbgg', notBggId: value };
    if (typeof value === 'string' && /^BGG:[1-9]\d*$/.test(value)) {
        const id = Number(value.slice(4));
        if (`BGG:${id}` === value) return parseGameRef({ source: 'bgg', bggId: id });
    }
    throw new Error('Invalid serialized game reference');
}

/** Opaque stable key; callers must never compare only the numeric suffix. */
export function gameCatalogKey(ref: GameRef): string {
    return serializeGameRef(ref);
}

export function notBggRouteSegment(id: NotBggId): string {
    if (!isNotBggId(id)) throw new Error('Invalid NotBGG ID');
    return id.slice(7);
}
