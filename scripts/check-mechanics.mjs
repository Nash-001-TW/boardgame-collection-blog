import fs from "node:fs";
import path from "node:path";

// ============================================================
// BGG Mechanics 檢查工具
//
// 功能：
// 1. 讀取 bgg-cache.json
// 2. 整理所有核心機制
// 3. 統計各機制出現次數
// 4. 顯示 Mechanic ID、英文名稱及使用次數
// 5. 輸出 CSV，方便建立中英文對照表
// ============================================================

const cachePath = path.resolve(
    process.cwd(),
    "src/data/bgg-cache.json"
);

const outputPath = path.resolve(
    process.cwd(),
    "scripts/bgg-mechanics-list.csv"
);

if (!fs.existsSync(cachePath)) {
    console.error("找不到 BGG 快取檔案：");
    console.error(cachePath);
    process.exit(1);
}

const raw = fs.readFileSync(cachePath, "utf8");
const cache = JSON.parse(raw);

// 相容陣列與以 BGG ID 為 Key 的物件格式
const games = Array.isArray(cache)
    ? cache
    : Array.isArray(cache.games)
        ? cache.games
        : Object.values(cache);

const mechanics = new Map();

for (const game of games) {
    if (!game || !Array.isArray(game.mechanics)) {
        continue;
    }

    for (const mechanic of game.mechanics) {
        if (!mechanic || mechanic.id == null) {
            continue;
        }

        const id = String(mechanic.id);
        const name = String(mechanic.name ?? "");

        if (!mechanics.has(id)) {
            mechanics.set(id, {
                id,
                name,
                count: 0
            });
        }

        mechanics.get(id).count++;
    }
}

const result = [...mechanics.values()].sort(
    (a, b) => a.name.localeCompare(b.name, "en")
);

console.log("\n========================================");
console.log("BGG Mechanics 統計");
console.log("========================================");
console.log(`遊戲資料數量：${games.length}`);
console.log(`核心機制種類：${result.length}`);
console.log("========================================\n");

console.table(result);

function csvEscape(value) {
    return `"${String(value).replaceAll('"', '""')}"`;
}

const csvLines = [
    "Mechanic ID,English Name,Traditional Chinese,Game Count",
    ...result.map(item =>
        [
            csvEscape(item.id),
            csvEscape(item.name),
            csvEscape(""),
            item.count
        ].join(",")
    )
];

// UTF-8 BOM，方便 Excel 2013 正確顯示中文
fs.writeFileSync(
    outputPath,
    "\uFEFF" + csvLines.join("\r\n"),
    "utf8"
);

console.log(`\nCSV 已產生：${outputPath}`);