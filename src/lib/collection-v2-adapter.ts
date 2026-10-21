
import bggCache from "../data/bgg-cache.json" with { type: "json" };

import type { BggGameData } from "./bgg";
import type { CollectionV2Row } from "./collection-v2-repository";

// ============================================================
// D1 V2 收藏顯示模型
// 不強制要求 BGG ID 或 BGG 詳細資料
// ============================================================

export interface CollectionV2Game {
    collectionId: number;
    gameId: number | null;
    bggId: number | null;

    displayName: string;
    primaryName: string | null;

    itemType: string;
    acquisitionStatus: string;

    owned: boolean;
    wishlist: boolean;
    preordered: boolean;

    // 不將未知的遊玩次數、價格等資訊預設為 0
    factorySealStatus: string | null;

    bgg: BggGameData | null;
    gameUrl: string | null;
}

// ============================================================
// BGG Cache
// ============================================================

const cache = bggCache as Record<string, BggGameData>;

// ============================================================
// notes JSON 安全解析
// ============================================================

function parseNotes(value: string | null): Record<string, unknown> {
    if (!value) return {};

    try {
        const parsed: unknown = JSON.parse(value);

        if (
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // 舊資料若不是有效 JSON，不中斷整個收藏頁。
    }

    return {};
}

function nullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim()
        ? value.trim()
        : null;
}

function parseBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;

    if (value === 1 || value === "1" || value === "true") {
        return true;
    }

    if (value === 0 || value === "0" || value === "false") {
        return false;
    }

    return null;
}

// ============================================================
// 單筆 D1 收藏轉換
// ============================================================

export function adaptCollectionV2Row(
    row: CollectionV2Row,
    lang: "zh-TW" | "en" = "zh-TW"
): CollectionV2Game {
    const notes = parseNotes(row.notes);

    // notes.owned 若有有效值，優先於 acquisition_status。
    const ownedFromNotes = parseBoolean(notes.owned);

    const owned = ownedFromNotes ??
        row.acquisition_status === "owned";

    const bggId =
        typeof row.bgg_id === "number" &&
        Number.isSafeInteger(row.bgg_id) &&
        row.bgg_id > 0
            ? row.bgg_id
            : null;

    const bgg = bggId !== null
        ? cache[String(bggId)] ?? null
        : null;

    // D1 名稱優先，避免使用 BGG 名稱覆蓋收藏品名稱。
    const displayName =
        row.display_name?.trim() ||
        row.primary_name?.trim() ||
        bgg?.name ||
        `Collection #${row.id}`;

    // 只有找到 BGG Cache，才建立目前網站的遊戲詳細頁連結。
    const gameUrl = bgg && bggId !== null
        ? lang === "en"
            ? `/en/games/bgg-${bggId}`
            : `/games/bgg-${bggId}`
        : null;

    return {
        collectionId: row.id,
        gameId: row.game_id,
        bggId,

        displayName,
        primaryName: row.primary_name,

        itemType: row.item_type,
        acquisitionStatus: row.acquisition_status,

        owned,
        wishlist: row.wishlist === 1,
        preordered: row.acquisition_status === "preordered",

        factorySealStatus: nullableString(
            notes.factory_seal_status
        ),

        bgg,
        gameUrl
    };
}

// ============================================================
// 批次轉換
// 不合併相同 BGG ID 的不同收藏紀錄
// ============================================================

export function adaptCollectionV2Rows(
    rows: CollectionV2Row[],
    lang: "zh-TW" | "en" = "zh-TW"
): CollectionV2Game[] {
    return rows.map(row => adaptCollectionV2Row(row, lang));
}

// ============================================================
// 資料完整性統計
// ============================================================

export interface CollectionV2Diagnostics {
    total: number;
    owned: number;
    preordered: number;
    wishlist: number;
    withoutBggId: number;
    withoutBggCache: number;
    duplicateCollectionIds: number;
}

export function diagnoseCollectionV2(
    games: CollectionV2Game[]
): CollectionV2Diagnostics {
    const ids = new Set<number>();

    let duplicateCollectionIds = 0;

    for (const game of games) {
        if (ids.has(game.collectionId)) {
            duplicateCollectionIds++;
        }

        ids.add(game.collectionId);
    }

    return {
        total: games.length,
        owned: games.filter(game => game.owned).length,
        preordered: games.filter(game => game.preordered).length,
        wishlist: games.filter(game => game.wishlist).length,
        withoutBggId: games.filter(game => game.bggId === null).length,
        withoutBggCache: games.filter(
            game => game.bggId !== null && game.bgg === null
        ).length,
        duplicateCollectionIds
    };
}
