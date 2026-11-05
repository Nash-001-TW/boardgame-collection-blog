import { localGames } from "../data/games.ts";

import bggCache from "../data/bgg-cache.json" with { type: "json" };

import bggCollectionCache from "../data/bgg-collection-cache.json" with { type: "json" };

import type { BggGameData } from "./bgg-types.ts";


import type {
    BggCollectionItem
} from "./bgg-collection-types.ts";

// ============================================================
// 網站真正使用的完整 Game
// ============================================================

export type { Game } from './game-catalog';
import { buildGameCatalog } from './game-catalog';
import type { Game } from './game-catalog';

/** Only catalog entries with available basic metadata have static detail pages. */
export interface GameDetailModel extends Omit<Game, 'bgg'> {
    bgg: BggGameData;
}

// ============================================================
// Cache 型別
// ============================================================

interface BggCache {
    [bggId: string]: BggGameData;
}

interface BggCollectionCache {
    username: string;
    totalRecords: number;
    items: Record<string, BggCollectionItem[]>;
}

const cache = bggCache as BggCache;

const collectionCache =
    bggCollectionCache as BggCollectionCache;

export function getGames(): Game[] {
    return buildGameCatalog(cache, [
        ...localGames.map(game => ({ bggId: game.bggId, slug: game.slug })),
        ...Object.entries(collectionCache.items).map(([id, items]) => ({
            bggId: Number(id), name: items[0]?.name
        }))
    ]);
}

export function getGameDetails(): GameDetailModel[] {
    return getGames().flatMap(game => game.bgg ? [{ ...game, bgg: game.bgg }] : []);
}

// Keep the existing offline collection-cache maintenance API; it does not filter the catalog.
export function getCollectionSyncStatus() {
    const collectionIds = Object.keys(collectionCache.items);
    const missingIds = collectionIds.filter(id => !cache[id]);
    return {
        username: collectionCache.username,
        totalRecords: collectionCache.totalRecords,
        uniqueGames: collectionIds.length,
        cachedGames: collectionIds.length - missingIds.length,
        missingGames: missingIds.length,
        missingBggIds: missingIds.map(Number)
    };
}
