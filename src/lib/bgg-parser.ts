import { XMLParser } from "fast-xml-parser";

import type {
    BggGameData,
    BggLink,
    BggRelationLink,
    BggCategoryRank,
    BggComplexity
} from "./bgg-types.ts";
// 完全不碰網路，也不碰檔案。

// ============================================================
// 將單一 Object / Array 統一轉成 Array
// ============================================================

function toArray<T>(
    value: T | T[] | undefined
): T[] {

    if (value === undefined || value === null) {
        return [];
    }

    return Array.isArray(value)
        ? value
        : [value];
}


// ============================================================
// 安全轉 Number
// ============================================================

function toNumber(
    value: unknown
): number | undefined {

    if (
        value === undefined ||
        value === null ||
        value === ""
    ) {
        return undefined;
    }

    const n = Number(value);

    return Number.isFinite(n)
        ? n
        : undefined;
}


// ============================================================
// 安全轉 Rank
// ============================================================

function parseRankValue(
    value: unknown
): number | undefined {

    if (
        value === undefined ||
        value === null ||
        value === "Not Ranked"
    ) {
        return undefined;
    }

    return toNumber(value);
}


// ============================================================
// Link Parser
// ============================================================

function parseLinks(
    links: any[],
    type: string
): BggLink[] {

    return links
        .filter(link =>
            link.type === type
        )
        .map(link => ({
            id: Number(link.id ?? 0),
            name: String(link.value ?? "")
        }));
}

// ============================================================
// BGG Relation Link Parser
//
// 用於：
// Expansion
// Implementation
// Compilation
//
// BGG 的 inbound 是 XML attribute，fast-xml-parser
// 可能解析成字串 "true" / "false"，因此不要直接 Boolean()。
//
// Boolean("false") 其實會得到 true，這是 JavaScript
// 很容易踩到的陷阱。
// ============================================================

function parseRelationLinks(
    links: any[],
    type: string
): BggRelationLink[] {

    return links
        .filter(
            link =>
                link.type === type
        )
        .map(
            link => {
                let inbound:
                    boolean | undefined;

                if (
                    link.inbound === true ||
                    link.inbound === "true"
                ) {
                    inbound = true;
                }
                else if (
                    link.inbound === false ||
                    link.inbound === "false"
                ) {
                    inbound = false;
                }

                return {
                    id: Number(link.id ?? 0),
                    name: String(link.value ?? ""),
                    inbound
                };
            }
        );
}


// ============================================================
// Average Weight → Complexity
//
// BGG 原始資料仍然保留 averageWeight。
// complexity 只是我們網站方便顯示的分類。
// ============================================================

function getComplexity(
    weight?: number
): BggComplexity {

    if (weight === undefined) {
        return "Unknown";
    }

    if (weight < 1.5) {
        return "Light";
    }

    if (weight < 2.5) {
        return "Medium Light";
    }

    if (weight < 3.5) {
        return "Medium";
    }

    if (weight < 4.5) {
        return "Medium Heavy";
    }

    return "Heavy";
}


// ============================================================
// Best Player Count
//
// 讀取：
// poll name="suggested_numplayers"
//
// 找出 Best 得票最高的玩家數。
// ============================================================

function parseBestPlayerCounts(
    item: any
): number[] {

    const polls =
        toArray<any>(item.poll);

    const playerPoll =
        polls.find(
            poll =>
                poll.name === "suggested_numplayers"
        );

    if (!playerPoll) {
        return [];
    }

    const results =
        toArray<any>(
            playerPoll.results
        );

    let highestVotes = 0;

    const bestPlayers: number[] = [];


    for (const group of results) {

        const playerText =
            String(
                group.numplayers ?? ""
            );

        // 例如 "5+" 不視為精確玩家數
        if (!/^\d+$/.test(playerText)) {
            continue;
        }

        const playerCount =
            Number(playerText);

        const votes =
            toArray<any>(
                group.result
            );

        const best =
            votes.find(
                vote =>
                    vote.value === "Best"
            );

        const bestVotes =
            Number(
                best?.numvotes ?? 0
            );


        if (bestVotes > highestVotes) {

            highestVotes = bestVotes;

            bestPlayers.length = 0;

            bestPlayers.push(
                playerCount
            );

        }
        else if (
            bestVotes > 0 &&
            bestVotes === highestVotes
        ) {

            bestPlayers.push(
                playerCount
            );
        }
    }


    return bestPlayers;
}


// ============================================================
// BGG XML Parser
// ============================================================

export function parseBggGameXml(
    xml: string
): BggGameData {

    const parser =
        new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: ""
        });


    const data =
        parser.parse(xml);


    const item =
        data.items?.item;


    if (!item) {

        throw new Error(
            "BGG XML 中找不到遊戲資料"
        );
    }


    // ========================================================
    // Name
    // ========================================================

    const names =
        toArray<any>(
            item.name
        );

    const primaryName =
        names.find(
            name =>
                name.type === "primary"
        );


    // ========================================================
    // Links
    // ========================================================

    const links =
        toArray<any>(
            item.link
        );


    // ========================================================
    // Statistics
    // ========================================================

    const ratings =
        item.statistics?.ratings;


    const averageWeight =
        toNumber(
            ratings
                ?.averageweight
                ?.value
        );


    const averageRating =
        toNumber(
            ratings
                ?.average
                ?.value
        );


    // ========================================================
    // BGG Rating
    //
    // 這裡先使用 Bayes Average。
    //
    // 原因：
    // Average Rating = 使用者直接評分平均
    // Bayes Average   = BGG 排名系統使用的調整值
    // ========================================================

    const bggRating =
        toNumber(
            ratings
                ?.bayesaverage
                ?.value
        );


    // ========================================================
    // Ranks
    // ========================================================

    const ranks =
        toArray<any>(
            ratings
                ?.ranks
                ?.rank
        );


    // Overall
    const overallRankData =
        ranks.find(
            rank =>
                rank.name === "boardgame"
        );


    const overallRank =
        parseRankValue(
            overallRankData?.value
        );


    // Category Ranks
    const categoryRanks:
        BggCategoryRank[] =
        ranks
            .filter(
                rank =>
                    rank.name !== "boardgame"
            )
            .map(
                rank => ({

                    id:
                        Number(
                            rank.id ?? 0
                        ),

                    name:
                        String(
                            rank.name ?? ""
                        ),

                    friendlyName:
                        String(
                            rank.friendlyname ??
                            rank.name ??
                            ""
                        ),

                    rank:
                        parseRankValue(
                            rank.value
                        ),

                    bayesAverage:
                        toNumber(
                            rank.bayesaverage
                        )
                })
            );


    // ========================================================
    // Game Type
    // ========================================================

    const gameType =
        String(
            item.type ?? ""
        );


    const isExpansion =
        gameType ===
        "boardgameexpansion";


    // ========================================================
    // Result
    // ========================================================

    return {

        // ----------------------------------------------------
        // 基本
        // ----------------------------------------------------

        bggId:
            Number(
                item.id ?? 0
            ),

        gameType,

        name:
            String(
                primaryName?.value ??
                "Unknown"
            ),

        description:
            String(
                item.description ?? ""
            ),

        year:
            Number(
                item.yearpublished?.value ??
                0
            ),

        image:
            item.image
                ? String(item.image)
                : undefined,

        thumbnail:
            item.thumbnail
                ? String(item.thumbnail)
                : undefined,

        minPlayers:
            Number(
                item.minplayers?.value ??
                0
            ),

        maxPlayers:
            Number(
                item.maxplayers?.value ??
                0
            ),

        bestPlayerCounts:
            parseBestPlayerCounts(
                item
            ),

        minPlayTime:
            Number(
                item.minplaytime?.value ??
                0
            ),

        maxPlayTime:
            Number(
                item.maxplaytime?.value ??
                0
            ),

        averageWeight,

        complexity:
            getComplexity(
                averageWeight
            ),

        minAge:
            toNumber(
                item.minage?.value
            ),


        // ----------------------------------------------------
        // 人員
        // ----------------------------------------------------

        designers:
            parseLinks(
                links,
                "boardgamedesigner"
            ),

        artists:
            parseLinks(
                links,
                "boardgameartist"
            ),

        publishers:
            parseLinks(
                links,
                "boardgamepublisher"
            ),


        // ----------------------------------------------------
        // 分類
        // ----------------------------------------------------

        categories:
            parseLinks(
                links,
                "boardgamecategory"
            ),

        mechanics:
            parseLinks(
                links,
                "boardgamemechanic"
            ),

        families:
            parseLinks(
                links,
                "boardgamefamily"
            ),


        // ----------------------------------------------------
        // 關聯
        // ----------------------------------------------------

        expansions:
            parseRelationLinks(
                links,
                "boardgameexpansion"
            ),

        implementations:
            parseRelationLinks(
                links,
                "boardgameimplementation"
            ),

        compilations:
            parseRelationLinks(
                links,
                "boardgamecompilation"
            ),

        isExpansion,

        // ----------------------------------------------------
        // Statistics
        // ----------------------------------------------------

        averageRating,

        usersRated:
            toNumber(
                ratings
                    ?.usersrated
                    ?.value
            ),

        bggRating,

        overallRank,

        categoryRanks
    };
}