/** Shared field metadata, not system fields. Text lists use one entry per line. */
export const adminFieldGroups = [
    { key: 'basic', label: ['基本資料', 'Basic information'], fields: [
        { key: 'name', label: ['名稱 *', 'Name *'], kind: 'text', max: 300, required: true },
        { key: 'alternateNames', label: ['其他名稱（每行一筆）', 'Alternate names (one per line)'], kind: 'list', max: 30100 },
        { key: 'description', label: ['描述', 'Description'], kind: 'textarea', max: 50000 },
        { key: 'yearPublished', label: ['出版年份', 'Publication year'], kind: 'number', min: 1, max: 9999 },
        { key: 'minAge', label: ['建議年齡', 'Minimum age'], kind: 'number', min: 0, max: 200 }
    ] },
    { key: 'play', label: ['玩家與時間', 'Players and playing time'], fields: [
        { key: 'minPlayers', label: ['最少玩家數', 'Minimum players'], kind: 'number', min: 1, max: 1000 },
        { key: 'maxPlayers', label: ['最多玩家數', 'Maximum players'], kind: 'number', min: 1, max: 1000 },
        { key: 'minPlaytime', label: ['最短時間（分鐘）', 'Minimum time (minutes)'], kind: 'number', min: 1, max: 100000 },
        { key: 'maxPlaytime', label: ['最長時間（分鐘）', 'Maximum time (minutes)'], kind: 'number', min: 1, max: 100000 },
        { key: 'recommendedPlayers', label: ['推薦人數（以逗號或空白分隔）', 'Recommended players (comma or space separated)'], kind: 'counts', max: 1000 }
    ] },
    { key: 'publication', label: ['出版資料', 'Publication'], fields: [
        { key: 'designers', label: ['設計師（每行一筆）', 'Designers (one per line)'], kind: 'list', max: 30100 },
        { key: 'artists', label: ['美術設計（每行一筆）', 'Artists (one per line)'], kind: 'list', max: 30100 },
        { key: 'publishers', label: ['出版商／製造商（每行一筆）', 'Publishers / manufacturers (one per line)'], kind: 'list', max: 30100 }
    ] },
    { key: 'taxonomy', label: ['分類資料', 'Classification'], fields: [
        { key: 'categories', label: ['分類（每行一筆）', 'Categories (one per line)'], kind: 'list', max: 30100 },
        { key: 'mechanics', label: ['遊戲機制（每行一筆）', 'Mechanics (one per line)'], kind: 'list', max: 30100 },
        { key: 'families', label: ['遊戲系列（每行一筆）', 'Families (one per line)'], kind: 'list', max: 30100 }
    ] },
    { key: 'sources', label: ['圖片與來源', 'Images and sources'], fields: [
        { key: 'imageUrl', label: ['圖片 URL', 'Image URL'], kind: 'url', max: 2048 },
        { key: 'thumbnailUrl', label: ['縮圖 URL', 'Thumbnail URL'], kind: 'url', max: 2048 },
        { key: 'referenceUrls', label: ['參考網址（每行一筆）', 'Reference URLs (one per line)'], kind: 'list', max: 102450 },
        { key: 'editorNotes', label: ['管理員備註（不公開）', 'Editor notes (private)'], kind: 'textarea', max: 10000 }
    ] },
    { key: 'accessory', label: ['配件資料', 'Accessory information'], fields: [
        { key: 'relatedGameIds', label: ['適用遊戲（每行 BGG:205637 或 NotBGG:000001）', 'Related games (one BGG:205637 or NotBGG:000001 per line)'], kind: 'refs', max: 5000 },
        { key: 'contents', label: ['內容物說明', 'Contents'], kind: 'textarea', max: 20000 }
    ] }
] as const;
export const accessoryLabels = {
    upgrade: ['升級包／豪華配件', 'Upgrade'], playmat: ['遊戲墊', 'Playmat'], storage: ['收納', 'Storage'],
    promo: ['贈品／特典', 'Promo'], sleeves: ['卡牌保護', 'Sleeves'], miniatures: ['模型', 'Miniatures'], tokens: ['骰子／指示物', 'Tokens'], other: ['其他', 'Other']
} as const;
