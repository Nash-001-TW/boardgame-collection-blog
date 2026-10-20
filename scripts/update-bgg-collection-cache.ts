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

    const outputFile = path.resolve(
        "src",
        "data",
        "bgg-collection-cache.json"
    );

    // 讀取已下載的 BGG Collection XML
    const xml = await fs.readFile(inputFile, "utf8");

    // 使用已完成的 Collection Parser V1
    const collection = parseBggCollection(xml, USERNAME);

    // 防止空資料覆蓋原本的快取
    if (collection.items.length === 0) {
        throw new Error("BGG 收藏資料為空，取消更新快取");
    }

    // 以 BGG ID 作為查詢索引
    const items: Record<string, typeof collection.items> = {};

    for (const item of collection.items) {

        const key = item.bggId.toString();

        if (!items[key]) {
            items[key] = [];
        }

        items[key].push(item);
    }

    const output = {
        username: collection.username,
        totalRecords: collection.items.length,
        items
    };

    // 先寫入暫存檔，避免寫入中斷破壞正式快取
    const tempFile = outputFile + ".tmp";

    await fs.writeFile(
        tempFile,
        JSON.stringify(output, null, 2),
        "utf8"
    );

    await fs.rename(tempFile, outputFile);

    console.log("========== BGG 收藏快取 ==========");
    console.log(`Username：${collection.username}`);
    console.log(`收藏記錄：${collection.items.length}`);
    console.log(`不同 BGG ID：${Object.keys(items).length}`);
    console.log(`輸出位置：${outputFile}`);
    console.log("==================================");
}

main().catch(error => {
    console.error("更新收藏快取失敗：", error);
    process.exitCode = 1;
});