// ============================================================
// BGG Traditional Chinese Localization
// BoardGameGeek 共用資料繁體中文翻譯
//
// 設計原則：
// 1. 使用 BGG ID 作為主要 Key，避免英文名稱變更造成查詢失敗。
// 2. 保留英文名稱 en，方便除錯、比對與未來維護。
// 3. zhTW 為網站繁體中文顯示名稱。
// 4. BGG API 原始資料不修改，只在 UI 顯示時進行本地化。
// ============================================================


// ============================================================
// Category
// ============================================================

export interface BggCategoryTranslation {
    en: string;
    zhTW: string;
}

export const bggCategoryZhTW:
    Record<number, BggCategoryTranslation> = {

    1001: {
        en: "Political",
        zhTW: "政治"
    },

    1002: {
        en: "Card Game",
        zhTW: "紙牌遊戲"
    },

    1008: {
        en: "Nautical",
        zhTW: "航海"
    },

    1009: {
        en: "Abstract Strategy",
        zhTW: "抽象策略"
    },

    1010: {
        en: "Fantasy",
        zhTW: "奇幻"
    },

    1011: {
        en: "Transportation",
        zhTW: "運輸"
    },

    1013: {
        en: "Farming",
        zhTW: "農業"
    },

    1015: {
        en: "Civilization",
        zhTW: "文明"
    },

    1016: {
        en: "Science Fiction",
        zhTW: "科幻"
    },

    1017: {
        en: "Dice",
        zhTW: "骰子"
    },

    1019: {
        en: "Wargame",
        zhTW: "戰爭遊戲"
    },

    1020: {
        en: "Exploration",
        zhTW: "探索"
    },

    1021: {
        en: "Economic",
        zhTW: "經濟"
    },

    1022: {
        en: "Adventure",
        zhTW: "冒險"
    },

    1023: {
        en: "Bluffing",
        zhTW: "虛張聲勢"
    },

    1024: {
        en: "Horror",
        zhTW: "恐怖"
    },

    1025: {
        en: "Word Game",
        zhTW: "文字遊戲"
    },

    1026: {
        en: "Negotiation",
        zhTW: "談判"
    },

    1027: {
        en: "Trivia",
        zhTW: "問答"
    },

    1028: {
        en: "Puzzle",
        zhTW: "益智"
    },

    1029: {
        en: "City Building",
        zhTW: "城市建設"
    },

    1030: {
        en: "Party Game",
        zhTW: "派對遊戲"
    },

    1031: {
        en: "Racing",
        zhTW: "競速"
    },

    1032: {
        en: "Action / Dexterity",
        zhTW: "動作/靈巧"
    },

    1033: {
        en: "Mafia",
        zhTW: "黑手黨"
    },

    1034: {
        en: "Trains",
        zhTW: "火車"
    },

    1035: {
        en: "Medieval",
        zhTW: "中世紀"
    },

    1036: {
        en: "Prehistoric",
        zhTW: "史前"
    },

    1037: {
        en: "Real-time",
        zhTW: "即時"
    },

    1038: {
        en: "Sports",
        zhTW: "運動"
    },

    1039: {
        en: "Deduction",
        zhTW: "推理"
    },

    1040: {
        en: "Murder/Mystery",
        zhTW: "謀殺/懸疑"
    },

    1041: {
        en: "Children's Game",
        zhTW: "兒童遊戲"
    },

    1042: {
        en: "Expansion for Base-game",
        zhTW: "基礎遊戲擴充"
    },

    1044: {
        en: "Collectible Components",
        zhTW: "收藏型組件"
    },

    1045: {
        en: "Memory",
        zhTW: "記憶"
    },

    1046: {
        en: "Fighting",
        zhTW: "格鬥"
    },

    1047: {
        en: "Miniatures",
        zhTW: "微縮模型"
    },

    1048: {
        en: "American Civil War",
        zhTW: "美國南北戰爭"
    },

    1049: {
        en: "World War II",
        zhTW: "二戰"
    },

    1050: {
        en: "Ancient",
        zhTW: "古代"
    },

    1051: {
        en: "Napoleonic",
        zhTW: "拿破崙戰爭"
    },

    1052: {
        en: "Arabian",
        zhTW: "阿拉伯"
    },

    1054: {
        en: "Music",
        zhTW: "音樂"
    },

    1055: {
        en: "American West",
        zhTW: "美國西部"
    },

    1059: {
        en: "Maze",
        zhTW: "迷宮"
    },

    1064: {
        en: "Movies / TV / Radio theme",
        zhTW: "電影/電視/廣播主題"
    },

    1065: {
        en: "World War I",
        zhTW: "一戰"
    },

    1069: {
        en: "Modern Warfare",
        zhTW: "現代戰爭"
    },

    1070: {
        en: "Renaissance",
        zhTW: "文藝復興"
    },

    1072: {
        en: "Electronic",
        zhTW: "電子"
    },

    1075: {
        en: "American Revolutionary War",
        zhTW: "美國獨立戰爭"
    },

    1079: {
        en: "Humor",
        zhTW: "幽默"
    },

    1081: {
        en: "Spies/Secret Agents",
        zhTW: "間諜/特務"
    },

    1082: {
        en: "Mythology",
        zhTW: "神話"
    },

    1084: {
        en: "Environmental",
        zhTW: "環境"
    },

    1086: {
        en: "Territory Building",
        zhTW: "領土建設"
    },

    1088: {
        en: "Industry / Manufacturing",
        zhTW: "工業/製造"
    },

    1089: {
        en: "Animals",
        zhTW: "動物"
    },

    1090: {
        en: "Pirates",
        zhTW: "海盜"
    },

    1091: {
        en: "Korean War",
        zhTW: "韓戰"
    },

    1093: {
        en: "Novel-based",
        zhTW: "小說改編"
    },

    1094: {
        en: "Educational",
        zhTW: "教育"
    },

    1097: {
        en: "Travel",
        zhTW: "旅行"
    },

    1098: {
        en: "Number",
        zhTW: "數字"
    },

    1101: {
        en: "Video Game Theme",
        zhTW: "電玩主題"
    },

    1102: {
        en: "Civil War",
        zhTW: "內戰"
    },

    1104: {
        en: "Math",
        zhTW: "數學"
    },

    1108: {
        en: "American Indian Wars",
        zhTW: "美洲原住民戰爭"
    },

    1109: {
        en: "Vietnam War",
        zhTW: "越戰"
    },

    1113: {
        en: "Space Exploration",
        zhTW: "太空探索"
    },

    1115: {
        en: "Religious",
        zhTW: "宗教"
    },

    1116: {
        en: "Comic Book / Strip",
        zhTW: "漫畫"
    },

    1117: {
        en: "Book",
        zhTW: "書籍"
    },

    1118: {
        en: "Mature / Adult",
        zhTW: "成人"
    },

    1119: {
        en: "Game System",
        zhTW: "遊戲系統"
    },

    1120: {
        en: "Print & Play",
        zhTW: "列印自製"
    },

    2145: {
        en: "Medical",
        zhTW: "醫療"
    },

    2481: {
        en: "Zombies",
        zhTW: "殭屍"
    },

    2650: {
        en: "Aviation / Flight",
        zhTW: "航空/飛行"
    },

    2687: {
        en: "Fan Expansion",
        zhTW: "玩家自製擴充"
    },

    2710: {
        en: "Post-Napoleonic",
        zhTW: "後拿破崙時期"
    },

    2725: {
        en: "Pike and Shot",
        zhTW: "長槍與火槍"
    },

    2726: {
        en: "Age of Reason",
        zhTW: "理性時代"
    },

    3129: {
        en: "Third-party Expansion",
        zhTW: "第三方擴充"
    }
};


// ============================================================
// Mechanic
// ============================================================

export interface BggMechanicTranslation {
    en: string;
    zhTW: string;
}

export const bggMechanicZhTW:
    Record<number, BggMechanicTranslation> = {

    2073: { en: "Acting", zhTW: "表演" },
    2840: { en: "Action / Event", zhTW: "行動／事件" },
    2838: { en: "Action Drafting", zhTW: "行動選取" },
    2001: { en: "Action Points", zhTW: "行動點數" },
    2689: { en: "Action Queue", zhTW: "行動佇列" },
    2839: { en: "Action Retrieval", zhTW: "行動回收" },
    2834: { en: "Action Timer", zhTW: "行動計時" },
    2847: { en: "Advantage Token", zhTW: "優勢標記" },
    3140: { en: "Algorithmic Resolution", zhTW: "演算法結算" },
    2916: { en: "Alliances", zhTW: "結盟" },

    2080: { en: "Area Majority / Influence", zhTW: "區域多數／影響力" },
    2046: { en: "Area Movement", zhTW: "區域移動" },
    2021: { en: "Area-Impulse", zhTW: "區域脈衝" },

    2012: { en: "Auction / Bidding", zhTW: "拍賣／競標" },
    3098: { en: "Auction Compensation", zhTW: "競標補償" },
    2930: { en: "Auction: Dexterity", zhTW: "拍賣：技巧" },
    2924: { en: "Auction: Dutch", zhTW: "拍賣：荷蘭式" },
    2932: { en: "Auction: Dutch Priority", zhTW: "拍賣：荷蘭式優先權" },
    2918: { en: "Auction: English", zhTW: "拍賣：英式" },
    2931: { en: "Auction: Fixed Placement", zhTW: "拍賣：固定出價位置" },
    2927: { en: "Auction: Multiple Lot", zhTW: "拍賣：多標的" },
    2923: { en: "Auction: Once Around", zhTW: "拍賣：單輪競標" },
    2920: { en: "Auction: Sealed Bid", zhTW: "拍賣：秘密出價" },
    2919: { en: "Auction: Turn Order Until Pass", zhTW: "拍賣：依序出價直到放棄" },

    2903: { en: "Automatic Resource Growth", zhTW: "資源自動增長" },
    2014: { en: "Betting and Bluffing", zhTW: "下注與唬騙" },
    2957: { en: "Bias", zhTW: "偏向" },
    3097: { en: "Bids As Wagers", zhTW: "以出價作為賭注" },
    2999: { en: "Bingo", zhTW: "賓果" },
    2913: { en: "Bribery", zhTW: "賄賂" },

    2018: { en: "Campaign / Battle Card Driven", zhTW: "戰役／戰鬥卡牌驅動" },
    2857: { en: "Card Play Conflict Resolution", zhTW: "卡牌衝突結算" },
    2887: { en: "Catch the Leader", zhTW: "追趕領先者" },
    2956: { en: "Chaining", zhTW: "連鎖" },
    2057: { en: "Chit-Pull System", zhTW: "抽取標記系統" },
    2984: { en: "Closed Drafting", zhTW: "封閉輪抽" },
    2928: { en: "Closed Economy Auction", zhTW: "封閉經濟拍賣" },
    2841: { en: "Command Cards", zhTW: "指令卡" },
    2013: { en: "Commodity Speculation", zhTW: "商品投機" },
    2893: { en: "Communication Limits", zhTW: "溝通限制" },
    2883: { en: "Connections", zhTW: "連線" },
    2922: { en: "Constrained Bidding", zhTW: "限制競標" },
    2912: { en: "Contracts", zhTW: "合約" },
    2023: { en: "Cooperative Game", zhTW: "合作遊戲" },
    2010: { en: "Crayon Rail System", zhTW: "蠟筆鐵路系統" },
    2854: { en: "Critical Hits and Failures", zhTW: "致命成功與失敗" },
    2990: { en: "Cube Tower", zhTW: "方塊塔" },

    3004: { en: "Deck Construction", zhTW: "牌庫構築" },
    2664: { en: "Deck, Bag, and Pool Building", zhTW: "牌庫／袋子／資源池構築" },
    3002: { en: "Deduction", zhTW: "推理" },
    2901: { en: "Delayed Purchase", zhTW: "延遲購買" },
    2072: { en: "Dice Rolling", zhTW: "擲骰" },
    2856: { en: "Die Icon Resolution", zhTW: "骰面圖示結算" },
    2950: { en: "Different Dice Movement", zhTW: "不同骰子移動" },
    3096: { en: "Drawing", zhTW: "繪畫" },

    2882: { en: "Elapsed Real Time Ending", zhTW: "即時時間結束" },
    2043: { en: "Enclosure", zhTW: "圍地" },
    2875: { en: "End Game Bonuses", zhTW: "終局獎勵" },
    2850: { en: "Events", zhTW: "事件" },
    3139: { en: "Expiring Actions", zhTW: "限時行動" },

    3143: { en: "Facing", zhTW: "朝向" },
    2885: { en: "Finale Ending", zhTW: "終章結束" },
    2860: { en: "Flicking", zhTW: "彈射" },
    2843: { en: "Follow", zhTW: "跟隨行動" },
    2864: { en: "Force Commitment", zhTW: "兵力投入" },

    2978: { en: "Grid Coverage", zhTW: "網格覆蓋" },
    2676: { en: "Grid Movement", zhTW: "網格移動" },

    2040: { en: "Hand Management", zhTW: "手牌管理" },
    3137: { en: "Handicaps", zhTW: "讓分／讓子" },
    2026: { en: "Hexagon Grid", zhTW: "六角格" },
    2967: { en: "Hidden Movement", zhTW: "隱藏移動" },
    2891: { en: "Hidden Roles", zhTW: "隱藏身分" },
    2987: { en: "Hidden Victory Points", zhTW: "隱藏勝利點數" },
    2889: { en: "Highest-Lowest Scoring", zhTW: "最高／最低分計分" },
    3000: { en: "Hot Potato", zhTW: "燙手山芋" },

    2906: { en: "I Cut, You Choose", zhTW: "我分你選" },
    2952: { en: "Impulse Movement", zhTW: "脈衝移動" },
    2902: { en: "Income", zhTW: "收入" },
    2914: { en: "Increase Value of Unchosen Resources", zhTW: "未選資源增值" },
    3003: { en: "Induction", zhTW: "歸納" },
    2837: { en: "Interrupts", zhTW: "中斷行動" },
    2910: { en: "Investment", zhTW: "投資" },

    2871: { en: "Kill Steal", zhTW: "搶尾刀" },
    2886: { en: "King of the Hill", zhTW: "山丘之王" },

    2980: { en: "Ladder Climbing", zhTW: "爬梯式出牌" },
    3144: { en: "Lane Battler", zhTW: "路線對戰" },
    3001: { en: "Layering", zhTW: "堆疊分層" },
    2824: { en: "Legacy Game", zhTW: "傳承遊戲" },
    2039: { en: "Line Drawing", zhTW: "畫線" },
    2975: { en: "Line of Sight", zhTW: "視線" },
    2904: { en: "Loans", zhTW: "貸款" },
    2836: { en: "Lose a Turn", zhTW: "失去回合" },

    2955: { en: "Mancala", zhTW: "播棋" },
    2959: { en: "Map Addition", zhTW: "地圖擴增" },
    2961: { en: "Map Deformation", zhTW: "地圖變形" },
    2960: { en: "Map Reduction", zhTW: "地圖縮減" },
    2900: { en: "Market", zhTW: "市場" },
    3007: { en: "Matching", zhTW: "配對" },
    2949: { en: "Measurement Movement", zhTW: "測距移動" },
    2981: { en: "Melding and Splaying", zhTW: "牌組融合與展開" },
    2047: { en: "Memory", zhTW: "記憶" },
    2863: { en: "Minimap Resolution", zhTW: "小地圖結算" },
    2011: { en: "Modular Board", zhTW: "模組化版圖" },
    2962: { en: "Move Through Deck", zhTW: "牌庫推進" },
    2947: { en: "Movement Points", zhTW: "移動點數" },
    2963: { en: "Movement Template", zhTW: "移動模板" },
    2958: { en: "Moving Multiple Units", zhTW: "多單位移動" },
    3099: { en: "Multi-Use Cards", zhTW: "多用途卡牌" },
    2965: { en: "Multiple Maps", zhTW: "多重地圖" },

    2851: { en: "Narrative Choice / Paragraph", zhTW: "敘事選擇／段落" },
    2915: { en: "Negotiation", zhTW: "談判" },
    3104: { en: "Neighbor Scope", zhTW: "相鄰玩家作用範圍" },
    2081: { en: "Network and Route Building", zhTW: "網路與路線建設" },

    2846: { en: "Once-Per-Game Abilities", zhTW: "每局一次能力" },
    2041: { en: "Open Drafting", zhTW: "公開輪抽" },
    2844: { en: "Order Counters", zhTW: "命令標記" },
    3101: { en: "Ordering", zhTW: "排序" },
    2911: { en: "Ownership", zhTW: "所有權" },

    2055: { en: "Paper-and-Pencil", zhTW: "紙筆遊戲" },
    2835: { en: "Passed Action Token", zhTW: "傳遞行動標記" },
    2048: { en: "Pattern Building", zhTW: "圖樣建構" },
    2946: { en: "Pattern Movement", zhTW: "圖樣移動" },
    2060: { en: "Pattern Recognition", zhTW: "圖樣辨識" },
    2989: { en: "Physical Removal", zhTW: "實體移除" },
    2007: { en: "Pick-up and Deliver", zhTW: "取貨與運送" },
    2964: { en: "Pieces as Map", zhTW: "棋子構成地圖" },
    2685: { en: "Player Elimination", zhTW: "玩家淘汰" },
    2865: { en: "Player Judge", zhTW: "玩家裁判" },
    2078: { en: "Point to Point Movement", zhTW: "點對點移動" },
    3006: { en: "Predictive Bid", zhTW: "預測競標" },
    2858: { en: "Prisoner's Dilemma", zhTW: "囚徒困境" },
    2953: { en: "Programmed Movement", zhTW: "程式化移動" },
    2661: { en: "Push Your Luck", zhTW: "風險試探" },

    3102: { en: "Questions and Answers", zhTW: "問答" },

    2876: { en: "Race", zhTW: "競速" },
    2909: { en: "Random Production", zhTW: "隨機生產" },
    2855: { en: "Ratio / Combat Results Table", zhTW: "戰力比／戰鬥結果表" },
    2870: { en: "Re-rolling and Locking", zhTW: "重擲與鎖定" },
    2831: { en: "Real-Time", zhTW: "即時制" },
    2954: { en: "Relative Movement", zhTW: "相對移動" },
    3103: { en: "Resource Queue", zhTW: "資源佇列" },
    2948: { en: "Resource to Move", zhTW: "消耗資源移動" },
    3141: { en: "Retirement", zhTW: "退休" },
    2003: { en: "Rock-Paper-Scissors", zhTW: "剪刀石頭布" },
    2028: { en: "Role Playing", zhTW: "角色扮演" },
    2892: { en: "Roles with Asymmetric Information", zhTW: "非對稱資訊角色" },
    2035: { en: "Roll / Spin and Move", zhTW: "擲骰／轉盤移動" },
    2813: { en: "Rondel", zhTW: "輪盤行動" },

    2822: { en: "Scenario / Mission / Campaign Game", zhTW: "劇本／任務／戰役遊戲" },
    2823: { en: "Score-and-Reset Game", zhTW: "計分後重置" },
    2016: { en: "Secret Unit Deployment", zhTW: "秘密部署單位" },
    2926: { en: "Selection Order Bid", zhTW: "選擇順位競標" },
    2820: { en: "Semi-Cooperative Game", zhTW: "半合作遊戲" },
    2004: { en: "Set Collection", zhTW: "套組收集" },
    2070: { en: "Simulation", zhTW: "模擬" },
    2020: { en: "Simultaneous Action Selection", zhTW: "同時行動選擇" },
    2038: { en: "Singing", zhTW: "唱歌" },
    2821: { en: "Single Loser Game", zhTW: "單一敗家遊戲" },
    3138: { en: "Single Play", zhTW: "單次遊玩" },
    3005: { en: "Slide / Push", zhTW: "滑動／推動" },
    2819: { en: "Solo / Solitaire Game", zhTW: "單人遊戲" },
    2991: { en: "Speed Matching", zhTW: "快速配對" },
    3113: { en: "Spelling", zhTW: "拼字" },
    2940: { en: "Square Grid", zhTW: "方格網格" },
    2988: { en: "Stacking and Balancing", zhTW: "堆疊與平衡" },
    2853: { en: "Stat Check Resolution", zhTW: "能力值檢定" },
    2861: { en: "Static Capture", zhTW: "靜態吃子" },
    2005: { en: "Stock Holding", zhTW: "股票持有" },
    2027: { en: "Storytelling", zhTW: "說故事" },
    2884: { en: "Sudden Death Ending", zhTW: "驟死結束" },

    3100: { en: "Tags", zhTW: "標籤" },
    2686: { en: "Take That", zhTW: "直接攻擊" },
    2866: { en: "Targeted Clues", zhTW: "指定目標提示" },
    2019: { en: "Team-Based Game", zhTW: "團隊遊戲" },
    2849: { en: "Tech Trees / Tech Tracks", zhTW: "科技樹／科技軌" },
    2944: { en: "Three Dimensional Movement", zhTW: "三維移動" },
    2002: { en: "Tile Placement", zhTW: "板塊放置" },
    2939: { en: "Track Movement", zhTW: "軌道移動" },
    2008: { en: "Trading", zhTW: "交易" },
    2814: { en: "Traitor Game", zhTW: "叛徒遊戲" },
    2009: { en: "Trick-taking", zhTW: "吃墩" },
    2888: { en: "Tug of War", zhTW: "拉鋸" },

    2827: { en: "Turn Order: Auction", zhTW: "回合順位：拍賣" },
    2829: { en: "Turn Order: Claim Action", zhTW: "回合順位：宣告行動" },
    2830: { en: "Turn Order: Pass Order", zhTW: "回合順位：依放棄順序" },
    2828: { en: "Turn Order: Progressive", zhTW: "回合順位：漸進式" },
    2985: { en: "Turn Order: Random", zhTW: "回合順位：隨機" },
    2833: { en: "Turn Order: Role Order", zhTW: "回合順位：角色順序" },
    2826: { en: "Turn Order: Stat-Based", zhTW: "回合順位：能力值決定" },
    2663: { en: "Turn Order: Time Track", zhTW: "回合順位：時間軌" },

    2079: { en: "Variable Phase Order", zhTW: "可變階段順序" },
    2015: { en: "Variable Player Powers", zhTW: "玩家特殊能力" },
    2897: { en: "Variable Set-up", zhTW: "可變設置" },
    2874: { en: "Victory Points as a Resource", zhTW: "勝利點作為資源" },
    3142: { en: "Visual Restriction", zhTW: "視覺限制" },
    2017: { en: "Voting", zhTW: "投票" },

    2082: { en: "Worker Placement", zhTW: "工人放置" },
    2935: { en: "Worker Placement with Dice Workers", zhTW: "骰子工人放置" },
    2933: { en: "Worker Placement, Different Worker Types", zhTW: "工人放置：不同工人類型" },

    2974: { en: "Zone of Control", zhTW: "控制區域" }
};