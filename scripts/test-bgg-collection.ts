import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

const USERNAME = "Nash0710";

// 請改成你目前 update-bgg-cache.ts 使用的環境變數名稱
const API_TOKEN = process.env.BGG_API_TOKEN;

if (!API_TOKEN) {
    throw new Error(
        "找不到 BGG_API_TOKEN，請確認 .env 設定"
    );
}

const url = new URL(
    "https://boardgamegeek.com/xmlapi2/collection"
);

url.searchParams.set("username", USERNAME);
url.searchParams.set("stats", "1");

const sleep = (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms));

async function fetchCollection(): Promise<string> {

    for (let attempt = 1; attempt <= 8; attempt++) {

        console.log(`BGG 收藏請求：第 ${attempt} 次`);

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${API_TOKEN}`,
                Accept: "application/xml"
            }
        });

        if (response.status === 202) {
            console.log("BGG 正在準備收藏資料，10 秒後重試...");
            await sleep(10000);
            continue;
        }

        if (!response.ok) {
            throw new Error(
                `BGG HTTP 錯誤：${response.status} ${response.statusText}`
            );
        }

        const xml = await response.text();

        if (!xml.includes("<items")) {
            throw new Error(
                "BGG 回傳內容不是預期的收藏 XML"
            );
        }

        return xml;
    }

    throw new Error("BGG 收藏資料等待逾時");
}

function countMatches(
    xml: string,
    pattern: RegExp
): number {
    return [...xml.matchAll(pattern)].length;
}

async function main() {

    const xml = await fetchCollection();

    // 儲存原始 XML，方便下一步確認欄位
    const outputDir = path.resolve(
        "data",
        "bgg"
    );

    await fs.mkdir(outputDir, {
        recursive: true
    });

    const outputFile = path.join(
        outputDir,
        "collection-Nash0710.xml"
    );

    await fs.writeFile(
        outputFile,
        xml,
        "utf8"
    );

    // 以下是初步統計，不作為正式解析結果
    const itemCount = countMatches(
        xml,
        /<item\b/g
    );

    const ownedCount = countMatches(
        xml,
        /\bown="1"/g
    );

    const wishlistCount = countMatches(
        xml,
        /\bwishlist="1"/g
    );

    const preorderCount = countMatches(
        xml,
        /\bpreordered="1"/g
    );

    console.log("");
    console.log("========== BGG 收藏同步測試 ==========");
    console.log(`Username：${USERNAME}`);
    console.log(`收藏記錄總數：${itemCount}`);
    console.log(`已收藏：${ownedCount}`);
    console.log(`願望清單：${wishlistCount}`);
    console.log(`預購：${preorderCount}`);
    console.log(`原始 XML：${outputFile}`);
    console.log("======================================");
}

main().catch(error => {
    console.error("BGG 收藏測試失敗：", error);
    process.exitCode = 1;
});