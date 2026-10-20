// ============================================================
// 我自己的收藏資料
// 這些資料不由 BGG 提供
// ============================================================
export interface CollectionData {

    // --------------------------------------------------------
    // 收藏關係
    // --------------------------------------------------------

    // 是否已實際擁有
    owned: boolean;

    // 是否加入願望清單
    wishlist?: boolean;

    // 是否為擴充
    isExpansion?: boolean;

    // 收藏 / 購買意願
    willingness?:
        | "Preordered"
        | "Want To Play"
        | "Want To Buy";


    // --------------------------------------------------------
    // 個人評價
    // --------------------------------------------------------

    // 我的評分
    myRating?: number;

    // 個人心得
    review?: string;

    // 遊玩次數
    playCount?: number;

    // --------------------------------------------------------
    // 購買資訊
    // --------------------------------------------------------

    // 購買價格
    purchasePrice?: number;

    // 購買日期 YYYY-MM-DD
    purchaseDate?: string;

    // 購買來源
    purchaseSource?: string;


    // --------------------------------------------------------
    // 實體收藏資訊
    // --------------------------------------------------------

    // 收藏品狀態
    collectionStatus?:
        | "Brand New"
        | "Checked/Verified"
        | "Missing Parts"
        | "Moisture-Damaged"
        | "Previously Owned"
        | "Already Gifted/Sold";

    // 語言版本
    languageVersion?:
        | "English"
        | "Japanese"
        | "Traditional Chinese"
        | "Simplified Chinese";

    // 是否已上牌套
    cardSleeves?: boolean;

    // 額外收納
    extraStorage?: string;

    // 額外配件
    additionalAccessories?: string;

    // 收納位置
    storageLocation?: string;

    // 其他備註
    notes?: string;

}


// ============================================================
// 本地收藏資料
//
// 這裡不保存 BGG 的遊戲資訊。
// ============================================================

export interface LocalGame {

    // BoardGameGeek ID
    bggId: number;

    // 網站網址
    //
    // 例如：
    // /games/frosthaven
    slug: string;

    // 我的收藏資料
    collection: CollectionData;
}


// ============================================================
// 我的桌遊資料
// ============================================================
export const localGames: LocalGame[] = [

    // ========================================================
    // Santorini
    // ========================================================
    {
        bggId: 194655,

        slug: "santorini",

        collection: {
            owned: true,
            wishlist: false,

            myRating: 8.5,

            purchasePrice: 4800,
            purchaseDate: "2026-08-15",
            purchaseSource: "桌遊店",

            collectionStatus: "Checked/Verified",
            languageVersion: "Traditional Chinese",

            cardSleeves: true,

            extraStorage: "原盒收納",

            playCount: 5,

            review: "規則簡單，但具有很好的策略深度。"
        }
    },


    // ========================================================
    // Frosthaven
    // ========================================================
    {
        bggId: 295770,

        slug: "frosthaven",

        collection: {
            owned: true,
            wishlist: false,

            myRating: 9,

            purchasePrice: 4500,
            purchaseDate: "2026-07-20",
            purchaseSource: "桌遊店",

            collectionStatus: "Checked/Verified",
            languageVersion: "Traditional Chinese",

            cardSleeves: true,

            extraStorage: "自製分類收納",

            additionalAccessories: "額外角色配件",

            playCount: 3,

            review: "大型戰役類桌遊，目前持續遊玩中。"
        }
    },


    // ========================================================
    // TEND
    // ========================================================
    {
        // BGG ID 尚未確認
        bggId: 427388,

        slug: "tend",

        collection: {
            owned: false,

            wishlist: true,

            willingness: "Want To Buy",

            myRating: undefined,

            cardSleeves: false,

            playCount: 0
        }
    },


    // ========================================================
    // ONWARD
    // ========================================================
    {
        // BGG ID 尚未確認
        bggId: 431929,

        slug: "onward",

        collection: {
            owned: false,

            wishlist: false,

            willingness: "Preordered",

            purchasePrice: 9180,
            purchaseSource: "Gamefound",

            cardSleeves: false,

            playCount: 0
        }
    }
];