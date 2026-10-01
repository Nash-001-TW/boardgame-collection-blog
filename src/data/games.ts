// ============================================================
// BGG 提供的桌遊資料
// 未來這一區會改由 BGG XML API 自動取得
// ============================================================
export interface BggGameData {
    name: string;
    year: number;

    minPlayers: number;
    maxPlayers: number;

    minPlayTime: number;
    maxPlayTime: number;

    image?: string;

    rating?: number;
    rank?: number;
}


// ============================================================
// 我自己的收藏資料
// 這些資料不由 BGG 提供
// ============================================================
export interface CollectionData {
    myRating?: number;

    purchasePrice?: number;
    purchaseDate?: string;

    playCount?: number;

    review?: string;
}


// ============================================================
// 網站使用的完整桌遊資料
// ============================================================
export interface Game {
    // BoardGameGeek ID
    bggId: number;

    // 網址名稱，例如 frosthaven
    slug: string;

    // BGG 資料
    bgg: BggGameData;

    // 我的收藏資料
    collection: CollectionData;
}


// ============================================================
// 我的桌遊
// ============================================================
export const games: Game[] = [
    {
        bggId: 194655,
        slug: "santorini",

        bgg: {
            name: "Santorini",
            year: 2016,

            minPlayers: 2,
            maxPlayers: 4,

            minPlayTime: 20,
            maxPlayTime: 20
        },

        collection: {
            myRating: 8.5,
            purchasePrice: 4800,
            playCount: 0
        }
    },

    {
        bggId: 295770,
        slug: "frosthaven",

        bgg: {
            name: "Frosthaven",
            year: 2022,

            minPlayers: 1,
            maxPlayers: 4,

            minPlayTime: 30,
            maxPlayTime: 120
        },

        collection: {
            myRating: 9,
            playCount: 0
        }
    }
];