import fs from "node:fs/promises";
import path from "node:path";

import { parseBggCollection } from "../src/lib/bgg-collection-parser.ts";

const USERNAME = "Nash0710";

async function main() {

    const inputFile = path.resolve(
        "data",
        "bgg",
        `collection-${USERNAME}.xml`
    );

    const xml = await fs.readFile(
        inputFile,
        "utf8"
    );

    const collection = parseBggCollection(
        xml,
        USERNAME
    );

    const items = collection.items;

    const ownedCount = items.filter(
        item => item.owned
    ).length;

    const wishlistCount = items.filter(
        item => item.wishlist
    ).length;

    const preorderCount = items.filter(
        item => item.preordered
    ).length;

    const ratedCount = items.filter(
        item => item.myRating !== undefined
    ).length;

    const playedCount = items.filter(
        item => item.playCount > 0
    ).length;

    console.log("");
    console.log("========== BGG Collection Parser ==========");
    console.log(`Username：${collection.username}`);
    console.log(`總記錄數：${items.length}`);
    console.log(`已收藏：${ownedCount}`);
    console.log(`願望清單：${wishlistCount}`);
    console.log(`預購：${preorderCount}`);
    console.log(`已有個人評分：${ratedCount}`);
    console.log(`有遊玩紀錄的遊戲：${playedCount}`);
    console.log("==========================================");

    const sample = items.find(
        item => item.bggId === 463126
    );

    if (sample) {
        console.log("");
        console.log("BGG ID 463126 解析結果：");
        console.log(sample);
    }
}

main().catch(error => {
    console.error("解析失敗：", error);
    process.exitCode = 1;
});