
import { getGames } from "./games";
import type { Language } from "../i18n/ui";

/**
 * 由現有靜態詳細頁的資料來源建立 BGG ID → slug 對照。
 *
 * 只有 getGames() 中實際存在的桌遊，
 * 才會產生詳細頁連結。
 */
const gameSlugMap = new Map<number, string>();

for (const game of getGames()) {
    if (!gameSlugMap.has(game.bggId)) {
        gameSlugMap.set(game.bggId, game.slug);
    }
}

/**
 * 取得已存在的桌遊詳細頁網址。
 *
 * @returns 找不到對應詳細頁時回傳 null。
 */
export function getCollectionV2GameUrl(
    bggId: number | null,
    lang: Language = "zh-TW"
): string | null {

    if (bggId === null) {
        return null;
    }

    const slug = gameSlugMap.get(bggId);

    if (!slug) {
        return null;
    }

    const prefix = lang === "en"
        ? "/en/games"
        : "/games";

    return `${prefix}/${encodeURIComponent(slug)}`;
}
