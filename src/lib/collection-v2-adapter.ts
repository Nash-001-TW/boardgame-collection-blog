import {translateGameName} from "../i18n/utils";
import { formatNotBggId } from "./game-identity";
import { getCollectionV2GameUrl } from "./collection-v2-links";
import { safeImage } from "./notbgg-public";

import bggCache from "../data/bgg-cache.json" with { type: "json" };

import type { BggGameData } from "./bgg-types";
import type { CollectionV2Row } from "./collection-v2-repository";

// ============================================================
// D1 V2 收藏顯示模型
// 不強制要求 BGG ID 或 BGG 詳細資料
// ============================================================

/** One personal collection record, not one unique game. Never deduplicate by bggId. */
export interface CollectionRecord {
    resolvedGameName?:string|null;
    resolvedIdentityKey?:string|null;
    notBggId?: string|null;
    imageUrl?: string|null;
    sourceStatus?: "active"|"archived"|"missing"|"unavailable";
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

// Compatibility for existing components; the record identity remains collectionId.
export type CollectionV2Game = CollectionRecord;

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

    let bgg = bggId !== null
        ? cache[String(bggId)] ?? null
        : null;

    // D1 名稱優先，避免使用 BGG 名稱覆蓋收藏品名稱。
    const displayName =
        row.display_name?.trim() ||
        row.primary_name?.trim() ||
        bgg?.name ||
        `Collection #${row.id}`;

    // 只有找到 BGG Cache，才建立目前網站的遊戲詳細頁連結。
    const notBggId=row.notbgg_seq?formatNotBggId(row.notbgg_seq):null;
    const sourceStatus=notBggId?(row.notbgg_archived_at?'archived':'active'):bgg?'active':'missing';
    let gameUrl=notBggId?(sourceStatus==='active'?`${lang==='en'?'/en':''}/games/notbgg/${notBggId.slice(7)}`:null):getCollectionV2GameUrl(bggId,lang);

    let resolvedGameName:string|null=null,resolvedIdentityKey:string|null=null;
    let imageUrl=notBggId?(sourceStatus==='active'?safeImage(row.notbgg_image):null):safeImage(bgg?.thumbnail||bgg?.image);
    const target=row.identity_bgg_id?cache[String(row.identity_bgg_id)]:null;
    if(row.identity_seq&&target&&sourceStatus!=='archived'){
        const identity=formatNotBggId(row.identity_seq);
        resolvedIdentityKey=row.identity_primary==='bgg'?`BGG:${row.identity_bgg_id}`:identity;
        resolvedGameName=row.identity_primary==='bgg'?translateGameName(row.identity_bgg_id!,target.name,lang):row.identity_name??identity;
        gameUrl=row.identity_primary==='bgg'?getCollectionV2GameUrl(row.identity_bgg_id!,lang):`${lang==='en'?'/en':''}/games/notbgg/${identity.slice(7)}`;
        imageUrl=row.identity_primary==='bgg'?safeImage(target.thumbnail||target.image):safeImage(row.identity_image);
        bgg=row.identity_primary==='bgg'?target:null;
    }
    return {
        resolvedGameName,resolvedIdentityKey,notBggId,sourceStatus,imageUrl,
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
