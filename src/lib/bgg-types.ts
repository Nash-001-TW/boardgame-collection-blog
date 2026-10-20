// ============================================================
// BGG 共用 Link 資料
//
// Designer / Artist / Publisher / Category / Mechanic...
// 都使用相同結構。
// ============================================================

export interface BggLink {
    id: number;
    name: string;
}

// ============================================================
// BGG 遊戲關聯
//
// Expansion / Implementation / Compilation
// 除了 ID、名稱之外，還需要保存 BGG 的 inbound 屬性。
//
// inbound = true
//     代表關聯指向目前這款遊戲
//
// inbound = false
//     代表目前這款遊戲指向該關聯遊戲
//
// 注意：
// inbound 是 BGG 原始關聯資訊，因此直接保存，
// 不在 Parser 階段猜測「Parent / Child」。
// ============================================================

export interface BggRelationLink
    extends BggLink {

    inbound?: boolean;
}

// ============================================================
// BGG Rank
// ============================================================

export interface BggCategoryRank {
    id: number;
    name: string;
    friendlyName: string;

    rank?: number;
    bayesAverage?: number;
}

// ============================================================
// Complexity
//
// 這不是 BGG API 原始欄位。
// 是我們依據 Average Weight 產生的網站顯示分類。
// ============================================================

export type BggComplexity =
    | "Unknown"
    | "Light"
    | "Medium Light"
    | "Medium"
    | "Medium Heavy"
    | "Heavy";


// ============================================================
// BGG Game Data
// ============================================================

export interface BggGameData {

    // ========================================================
    // 1. 基本資訊
    // ========================================================

    bggId: number;

    gameType: string;

    name: string;

    description: string;

    year: number;

    image?: string;

    thumbnail?: string;

    minPlayers: number;

    maxPlayers: number;

    bestPlayerCounts: number[];

    minPlayTime: number;

    maxPlayTime: number;

    averageWeight?: number;

    complexity: BggComplexity;

    minAge?: number;


    // ========================================================
    // 2. 出版 / 分類 / 機制
    // ========================================================

    designers: BggLink[];

    artists: BggLink[];

    publishers: BggLink[];

    categories: BggLink[];

    mechanics: BggLink[];

    families: BggLink[];

    expansions: BggRelationLink[];

    implementations: BggRelationLink[];

    compilations: BggRelationLink[];

    isExpansion: boolean;


    // ========================================================
    // 3. 統計
    // ========================================================

    averageRating?: number;

    usersRated?: number;

    bggRating?: number;

    overallRank?: number;

    categoryRanks: BggCategoryRank[];
}