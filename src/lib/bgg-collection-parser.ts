import { XMLParser } from "fast-xml-parser";

import type {
    BggCollectionData,
    BggCollectionItem
} from "./bgg-collection-types.ts";

// ============================================================
// XML Parser 設定
// ============================================================

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true
});

// ============================================================
// XML 基本轉換工具
// ============================================================

function toNumber(value: unknown): number | undefined {

    if (
        value === undefined ||
        value === null ||
        value === "" ||
        value === "N/A"
    ) {
        return undefined;
    }

    const result = Number(value);

    return Number.isFinite(result)
        ? result
        : undefined;
}

function toBoolean(value: unknown): boolean {
    return String(value) === "1";
}

function toText(value: unknown): string | undefined {

    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === "object") {

        const element = value as Record<string, unknown>;

        return toText(element["#text"]);
    }

    return String(value);
}

// ============================================================
// 解析單筆收藏資料
// ============================================================

function parseCollectionItem(raw: any): BggCollectionItem {

    const status = raw.status ?? {};
    const stats = raw.stats ?? {};
    const rating = stats.rating ?? {};

    const bggId = toNumber(raw["@_objectid"]);

    if (bggId === undefined) {
        throw new Error("收藏資料缺少 BGG ID");
    }

    return {
        bggId,

        collectionId: toNumber(
            raw["@_collid"]
        ),

        name: toText(raw.name) ?? "",

        originalName: toText(
            raw.originalname
        ),

        yearPublished: toNumber(
            raw.yearpublished
        ),

        image: toText(raw.image),

        thumbnail: toText(raw.thumbnail),

        owned: toBoolean(
            status["@_own"]
        ),

        previouslyOwned: toBoolean(
            status["@_prevowned"]
        ),

        forTrade: toBoolean(
            status["@_fortrade"]
        ),

        wishlist: toBoolean(
            status["@_wishlist"]
        ),

        preordered: toBoolean(
            status["@_preordered"]
        ),

        wantToPlay: toBoolean(
            status["@_wanttoplay"]
        ),

        wantToBuy: toBoolean(
            status["@_wanttobuy"]
        ),

        want: toBoolean(
            status["@_want"]
        ),

        myRating: toNumber(
            rating["@_value"]
        ),

        playCount: toNumber(
            raw.numplays
        ) ?? 0,

        lastModified: toText(
            status["@_lastmodified"]
        )
    };
}

// ============================================================
// 解析完整收藏 XML
// ============================================================

export function parseBggCollection(
    xml: string,
    username: string
): BggCollectionData {

    const document = parser.parse(xml);

    if (!document?.items) {
        throw new Error(
            "BGG Collection XML 格式錯誤：找不到 items"
        );
    }

    const rawItems = document.items.item;

    const itemsArray = rawItems === undefined
        ? []
        : Array.isArray(rawItems)
            ? rawItems
            : [rawItems];

    const items = itemsArray.map(
        (item: any) => parseCollectionItem(item)
    );

    return {
        username,
        items
    };
}