export const languages = {
    "zh-TW": "中文",
    "en": "English"
} as const;

export type Language =
    keyof typeof languages;


/*
 * 網站預設語言
 */
export const defaultLanguage: Language =
    "zh-TW";


/*
 * UI 翻譯表
 */
export const ui = {

    "zh-TW": {

        // Header
        "nav.home": "首頁",
        "nav.games": "遊戲",
        "nav.collection": "收藏",
        "nav.blog": "部落格",
        "nav.about": "關於我",

        // Common
        "common.back": "返回",

        // Game
        "game.backToGames": "返回遊戲列表",

        "game.players": "玩家人數",
        "game.bestPlayers": "最佳人數",
        "game.playTime": "遊戲時間",
        "game.age": "建議年齡",
        "game.complexity": "複雜度",

        "game.description": "遊戲介紹",

        // Collection
        "collection.owned": "已收藏",
        "collection.wishlist": "願望清單",
        "collection.preordered": "已預購",

        // BGG
        "bgg.ratings": "BGG 評分與排名",
        "bgg.averageRating": "平均評分",
        "bgg.bggRating": "BGG 評分",
        "bgg.usersRated": "評分人數",
        "bgg.overallRank": "總排名",
        "bgg.categoryRank": "分類排名",

        // Game information
        "info.title": "遊戲資料",
        "info.designer": "設計師",
        "info.artist": "藝術家",
        "info.publisher": "出版社",
        "info.category": "分類",
        "info.mechanic": "機制"

    },


    "en": {

        // Header
        "nav.home": "Home",
        "nav.games": "Games",
        "nav.collection": "Collection",
        "nav.blog": "Blog",
        "nav.about": "About",

        // Common
        "common.back": "Back",

        // Game
        "game.backToGames": "Back to Games",

        "game.players": "Players",
        "game.bestPlayers": "Best Player Count",
        "game.playTime": "Playing Time",
        "game.age": "Recommended Age",
        "game.complexity": "Complexity",

        "game.description": "Game Description",

        // Collection
        "collection.owned": "Owned",
        "collection.wishlist": "Wishlist",
        "collection.preordered": "Preordered",

        // BGG
        "bgg.ratings": "BGG Ratings & Rankings",
        "bgg.averageRating": "Average Rating",
        "bgg.bggRating": "BGG Rating",
        "bgg.usersRated": "Users Rated",
        "bgg.overallRank": "Overall Rank",
        "bgg.categoryRank": "Category Rank",

        // Game information
        "info.title": "Game Information",
        "info.designer": "Designer",
        "info.artist": "Artist",
        "info.publisher": "Publisher",
        "info.category": "Category",
        "info.mechanic": "Mechanic"

    }

} as const;