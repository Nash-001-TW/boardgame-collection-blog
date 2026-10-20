import {
    getGames,
    getCollectionSyncStatus
} from "../src/lib/games.ts";

const status = getCollectionSyncStatus();

const games = getGames();

console.log("");
console.log("========== BGG 收藏整合 ==========");
console.log(`BGG Username：${status.username}`);
console.log(`收藏記錄總數：${status.totalRecords}`);
console.log(`不同 BGG ID：${status.uniqueGames}`);
console.log(`已有詳細資料：${status.cachedGames}`);
console.log(`缺少詳細資料：${status.missingGames}`);
console.log(`網站目前可使用遊戲：${games.length}`);
console.log("==================================");

console.log("");
console.log("前 20 個缺少詳細資料的 BGG ID：");
console.log(status.missingBggIds.slice(0, 20));

console.log("");
console.log("本地遊戲檢查：");

for (const slug of [
    "santorini",
    "frosthaven",
    "tend",
    "onward"
]) {

    const game = games.find(
        item => item.slug === slug
    );

    if (!game) {
        console.log(`${slug}：找不到遊戲`);
        continue;
    }

    console.log(
        `${slug}：`,
        JSON.stringify(game.collection)
    );
}