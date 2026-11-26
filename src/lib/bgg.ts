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
    bggId: number,
    options?: {token?:string;fetcher?:typeof fetch;signal?:AbortSignal}
): Promise<string> {

    const token =
        options?.token ?? import.meta.env?.BGG_API_TOKEN;


    if (!token) {

        throw new Error(
            "找不到 BGG_API_TOKEN"
        );
    }


    if(!Number.isSafeInteger(bggId)||bggId<1)throw new Error('INVALID_BGG_ID');
    const url =
        `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;


    const response =
        await (options?.fetcher??fetch)(
            url,
            {
                // Workers rejects redirect:'error' (TypeError before any request). 'manual' keeps the
                // no-follow intent: a 3xx is not ok, so it fails below as BGG API HTTP 3xx.
                signal:options?.signal,redirect:'manual',
                headers: {
                    Authorization:
                        `Bearer ${token}`
                }
            }
        );


    if (!response.ok || response.status===202) {

        throw new Error(
            `BGG API HTTP ${response.status}`
        );
    }


    const reader=response.body?.getReader();if(!reader)throw new Error('BGG_EMPTY_RESPONSE');
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000)throw new Error('BGG_RESPONSE_TOO_LARGE');chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
    const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(result);
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
