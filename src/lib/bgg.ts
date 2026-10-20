import {
    parseBggGameXml
} from "./bgg-parser.ts";

import type {
    BggGameData
} from "./bgg-types.ts";


// ============================================================
// Memory Cache
// ============================================================

const gameCache =
    new Map<number, BggGameData>();


// ============================================================
// Fetch BGG XML
// ============================================================

export async function fetchBggGameXml(
    bggId: number
): Promise<string> {

    const token =
        import.meta.env.BGG_API_TOKEN;


    if (!token) {

        throw new Error(
            "找不到 BGG_API_TOKEN"
        );
    }


    const url =
        `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;


    const response =
        await fetch(
            url,
            {
                headers: {
                    Authorization:
                        `Bearer ${token}`
                }
            }
        );


    if (!response.ok) {

        throw new Error(
            `BGG API HTTP ${response.status}`
        );
    }


    return await response.text();
}


// ============================================================
// Fetch + Parse
// ============================================================

export async function fetchBggGame(
    bggId: number
): Promise<BggGameData> {

    const cached =
        gameCache.get(bggId);


    if (cached) {

        console.log(
            `[BGG Cache] HIT ${bggId}`
        );

        return cached;
    }


    console.log(
        `[BGG Cache] MISS ${bggId}`
    );


    const xml =
        await fetchBggGameXml(
            bggId
        );


    const game =
        parseBggGameXml(
            xml
        );


    gameCache.set(
        bggId,
        game
    );


    return game;
}


// ============================================================
// Type Re-export
//
// 這個很重要。
// 舊程式如果：
//
// import type { BggGameData } from "./bgg";
//
// 暫時不需要全部修改。
// ============================================================

export type {
    BggGameData,
    BggLink,
    BggRelationLink,
    BggCategoryRank,
    BggComplexity
} from "./bgg-types.ts";