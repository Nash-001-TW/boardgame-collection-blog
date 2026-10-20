import { localGames } from "../data/games.ts";

import bggCache from "../data/bgg-cache.json" with { type: "json" };

import bggCollectionCache from "../data/bgg-collection-cache.json" with { type: "json" };

import type { BggGameData } from "./bgg.ts";

import type {
    CollectionData,
    LocalGame
} from "../data/games.ts";

import type {
    BggCollectionItem
} from "./bgg-collection-types.ts";

// ============================================================
// 網站真正使用的完整 Game
// ============================================================

export interface Game {
    bggId: number;
    slug: string;
    bgg: BggGameData;
    collection: CollectionData;
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

// ============================================================
// 同一 BGG ID 可能存在多筆收藏記錄
// V1：合併狀態、評分及遊玩次數
// ============================================================

function mergeBggCollectionItems(
    items: BggCollectionItem[]
): CollectionData {

    const ratedItem = items.find(
        item => item.myRating !== undefined
    );

    return {
        owned: items.some(item => item.owned),

        wishlist: items.some(item => item.wishlist),

        willingness:
            items.some(item => item.preordered)
                ? "Preordered"
                : items.some(item => item.wantToPlay)
                    ? "Want To Play"
                    : items.some(item => item.wantToBuy)
                        ? "Want To Buy"
                        : undefined,

        myRating: ratedItem?.myRating,

        // 同一遊戲的多筆收藏記錄可能各自有 numplays。
        // V1 先使用最大值，避免直接相加造成重複計算。
        playCount: Math.max(
            0,
            ...items.map(item => item.playCount)
        )
    };
}

// ============================================================
// 合併本地個人資料
// 本地有設定的欄位優先
// ============================================================

function mergeCollectionData(
    bgg: CollectionData,
    local?: CollectionData
): CollectionData {

    if (!local) {
        return bgg;
    }

    return {
        ...bgg,
        ...local,

        owned: local.owned ?? bgg.owned,

        wishlist: local.wishlist ?? bgg.wishlist,

        willingness:
            local.willingness ?? bgg.willingness,

        myRating:
            local.myRating ?? bgg.myRating,

        playCount:
            local.playCount ?? bgg.playCount
    };
}

// ============================================================
// 自動產生網址 slug
// ============================================================

function makeSlug(
    bggId: number
): string {
    return `bgg-${bggId}`;
}

// ============================================================
// 取得所有完整桌遊資料
// ============================================================

export function getGames(): Game[] {

    const games: Game[] = [];

    const localMap = new Map<number, LocalGame>();

    for (const local of localGames) {
        localMap.set(local.bggId, local);
    }

    const allIds = new Set<number>();

    // 本地遊戲
    for (const local of localGames) {
        if (local.bggId > 0) {
            allIds.add(local.bggId);
        }
    }

    // BGG 個人收藏遊戲
    for (const id of Object.keys(collectionCache.items)) {

        const bggId = Number(id);

        if (Number.isInteger(bggId) && bggId > 0) {
            allIds.add(bggId);
        }
    }

    let missingCacheCount = 0;

    for (const bggId of allIds) {

        const bgg = cache[bggId.toString()];

        // 尚未下載 Thing API 詳細資料
        if (!bgg) {
            missingCacheCount++;
            continue;
        }

        const local = localMap.get(bggId);

        const bggItems =
            collectionCache.items[bggId.toString()] ?? [];

        const bggCollection =
            bggItems.length > 0
                ? mergeBggCollectionItems(bggItems)
                : { owned: false };

        const collection = mergeCollectionData(
            bggCollection,
            local?.collection
        );

        games.push({
            bggId,
            slug: local?.slug ?? makeSlug(bggId),
            bgg,
            collection
        });
    }

    if (missingCacheCount > 0) {
        console.warn(
            `[Game] ${missingCacheCount} 款遊戲尚未建立 BGG 詳細資料快取`
        );
    }

    return games;
}

// ============================================================
// 收藏同步狀態
// ============================================================

export function getCollectionSyncStatus() {

    const collectionIds =
        Object.keys(collectionCache.items);

    const missingIds = collectionIds.filter(
        id => !cache[id]
    );

    return {
        username: collectionCache.username,
        totalRecords: collectionCache.totalRecords,
        uniqueGames: collectionIds.length,
        cachedGames: collectionIds.length - missingIds.length,
        missingGames: missingIds.length,
        missingBggIds: missingIds.map(Number)
    };
}