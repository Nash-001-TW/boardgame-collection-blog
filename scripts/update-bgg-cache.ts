// ============================================================
// BGG Cache Updater V2
//
// 功能：
// 1. 讀取 localGames
// 2. 讀取 BGG Collection Cache
// 3. 找出尚未建立 Thing API 詳細資料的 BGG ID
// 4. 分批下載 BGG 遊戲資料
// 5. 使用現有 Parser V2 解析
// 6. 保留舊快取，逐批儲存
// 7. 支援失敗重試及中斷後續傳
//
// 執行：
// npm run update-bgg
// ============================================================

import fs from "node:fs/promises";
import path from "node:path";

import { localGames } from "../src/data/games.ts";

import collectionCacheJson
    from "../src/data/bgg-collection-cache.json" with { type: "json" };

import {
    parseBggGameXml
} from "../src/lib/bgg-parser.ts";

import type {
    BggGameData
} from "../src/lib/bgg-types.ts";

// ============================================================
// 基本設定
// ============================================================

const BGG_API_URL =
    "https://boardgamegeek.com/xmlapi2";

const CACHE_FILE =
    path.resolve("src/data/bgg-cache.json");

const ENV_FILE =
    path.resolve(".env");

// 每批處理 20 款遊戲
const BATCH_SIZE = 20;

// 每次請求間隔 2 秒
const REQUEST_DELAY_MS = 2000;

// 每批完成後等待 5 秒
const BATCH_DELAY_MS = 5000;

// 每款遊戲最多嘗試 5 次
const MAX_RETRIES = 5;

// 每次 HTTP 請求最多等待 30 秒
const REQUEST_TIMEOUT_MS = 30000;

// ============================================================
// 型別
// ============================================================

interface BggCache {
    [bggId: string]: BggGameData;
}

interface CollectionCache {
    username: string;
    totalRecords: number;
    items: Record<string, unknown[]>;
}

// ============================================================
// 工具函式
// ============================================================

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidBggId(id: number): boolean {
    return Number.isSafeInteger(id) && id > 0;
}

// ============================================================
// 讀取環境變數
// ============================================================

async function loadEnv(): Promise<void> {

    const content = await fs.readFile(
        ENV_FILE,
        "utf8"
    );

    const lines = content.split(/\r?\n/);

    for (const line of lines) {

        const trimmed = line.trim();

        if (
            !trimmed ||
            trimmed.startsWith("#")
        ) {
            continue;
        }

        const index = trimmed.indexOf("=");

        if (index < 0) {
            continue;
        }

        const key = trimmed
            .substring(0, index)
            .trim();

        let value = trimmed
            .substring(index + 1)
            .trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        // 保留外部環境已設定的值
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

// ============================================================
// 讀取現有 BGG Cache
// ============================================================

async function loadCache(): Promise<BggCache> {

    try {

        const json = await fs.readFile(
            CACHE_FILE,
            "utf8"
        );

        const data = JSON.parse(json);

        if (
            data === null ||
            typeof data !== "object" ||
            Array.isArray(data)
        ) {
            throw new Error("BGG Cache 格式錯誤");
        }

        return data as BggCache;

    }
    catch (error) {

        // 只有檔案不存在時才允許建立新快取
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            console.log("尚無 BGG Cache，建立新快取");
            return {};
        }

        // JSON 損壞時停止，避免覆蓋既有資料
        throw error;
    }
}

// ============================================================
// 安全儲存 Cache
// ============================================================

async function saveCache(
    cache: BggCache
): Promise<void> {

    const tempFile = CACHE_FILE + ".tmp";
    const backupFile = CACHE_FILE + ".bak";

    const json = JSON.stringify(
        cache,
        null,
        4
    );

    // 先寫入暫存檔
    await fs.writeFile(
        tempFile,
        json,
        "utf8"
    );

    // 寫入後再次驗證 JSON
    JSON.parse(
        await fs.readFile(tempFile, "utf8")
    );

    // 保留上一份正式快取的備份
    try {
        await fs.copyFile(
            CACHE_FILE,
            backupFile
        );
    }
    catch (error) {
        if (
            !(
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            )
        ) {
            throw error;
        }
    }

    // 在相同磁碟上以 rename 更新正式檔案
    await fs.rename(
        tempFile,
        CACHE_FILE
    );
}

// ============================================================
// 收集全部 BGG ID
// ============================================================

function collectAllBggIds(): number[] {

    const ids = new Set<number>();

    // 本地遊戲
    for (const game of localGames) {

        if (isValidBggId(game.bggId)) {
            ids.add(game.bggId);
        }
    }

    // BGG 收藏遊戲
    const collectionCache =
        collectionCacheJson as CollectionCache;

    for (const id of Object.keys(collectionCache.items)) {

        const bggId = Number(id);

        if (isValidBggId(bggId)) {
            ids.add(bggId);
        }
    }

    return [...ids].sort((a, b) => a - b);
}

// ============================================================
// HTTP 重試等待時間
// ============================================================

function getRetryDelay(
    response: Response,
    attempt: number
): number {

    const retryAfter =
        response.headers.get("retry-after");

    if (retryAfter) {

        const seconds = Number(retryAfter);

        if (Number.isFinite(seconds) && seconds >= 0) {
            return Math.min(
                seconds * 1000,
                120000
            );
        }

        const date = Date.parse(retryAfter);

        if (Number.isFinite(date)) {
            return Math.min(
                Math.max(0, date - Date.now()),
                120000
            );
        }
    }

    // 5、10、20、40、80 秒，上限 120 秒
    return Math.min(
        5000 * Math.pow(2, attempt - 1),
        120000
    );
}

// ============================================================
// 呼叫 BGG Thing API
// ============================================================

async function fetchBggGame(
    bggId: number,
    token: string
): Promise<BggGameData> {

    const url =
        `${BGG_API_URL}/thing?id=${bggId}&stats=1`;

    for (
        let attempt = 1;
        attempt <= MAX_RETRIES;
        attempt++
    ) {

        try {

            const response = await fetch(
                url,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "application/xml"
                    },
                    signal: AbortSignal.timeout(
                        REQUEST_TIMEOUT_MS
                    )
                }
            );

            // BGG 正在準備資料或暫時限制請求
            if (
                response.status === 202 ||
                response.status === 429 ||
                response.status >= 500
            ) {

                if (attempt === MAX_RETRIES) {
                    throw new Error(
                        `HTTP ${response.status}，已達重試上限`
                    );
                }

                const delay = getRetryDelay(
                    response,
                    attempt
                );

                console.log(
                    `  HTTP ${response.status}，` +
                    `${Math.round(delay / 1000)} 秒後重試`
                );

                await sleep(delay);
                continue;
            }

            // 401 / 403 / 404 等不進行重試
            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status} ${response.statusText}`
                );
            }

            const xml = await response.text();

            if (!xml.includes("<items")) {
                throw new Error(
                    "BGG 回傳內容不是預期的 XML"
                );
            }

            const data = parseBggGameXml(xml);

            if (!data || !data.name) {
                throw new Error(
                    `BGG ${bggId} 解析結果不完整`
                );
            }

            // 如果 Parser 有提供 bggId，驗證其一致性
            if (
                data.bggId !== undefined &&
                data.bggId !== bggId
            ) {
                throw new Error(
                    `BGG ID 不一致：預期 ${bggId}，取得 ${data.bggId}`
                );
            }

            return data;

        }
        catch (error) {

            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            // HTTP 401、403、404、解析格式問題等，
            // 不應一律重試
            const permanentError =
                /^HTTP (400|401|403|404)\b/.test(message) ||
                message.includes("BGG ID 不一致") ||
                message.includes("解析結果不完整") ||
                message.includes("不是預期的 XML");

            if (
                permanentError ||
                attempt === MAX_RETRIES
            ) {
                throw error;
            }

            const delay = Math.min(
                5000 * Math.pow(2, attempt - 1),
                120000
            );

            console.log(
                `  請求失敗：${message}`
            );

            console.log(
                `  ${Math.round(delay / 1000)} 秒後重試 ` +
                `(${attempt}/${MAX_RETRIES})`
            );

            await sleep(delay);
        }
    }

    throw new Error(
        `BGG ${bggId} 超過重試次數`
    );
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {

    console.log("");
    console.log("======================================");
    console.log("BGG Cache Updater V2");
    console.log("======================================");

    await loadEnv();

    const token = process.env.BGG_API_TOKEN;

    if (!token) {
        throw new Error("找不到 BGG_API_TOKEN");
    }

    // 讀取舊快取
    const cache = await loadCache();

    const originalCount =
        Object.keys(cache).length;

    /// 收集 BGG ID，支援命令列指定
    const idsArg = process.argv.slice(2).find(arg => arg.startsWith("--ids="));

    let allIds: number[];

    if (idsArg !== undefined) {
        const rawIds = idsArg.substring("--ids=".length).split(",");

        const parsedIds = rawIds.map(value => {
            const trimmed = value.trim();
            const id = Number(trimmed);

            if (!/^\d+$/.test(trimmed) || !isValidBggId(id)) {
                throw new Error(`無效的 BGG ID：${trimmed}`);
            }

            return id;
        });

        allIds = [...new Set(parsedIds)].sort((a, b) => a - b);

        console.log("更新模式：指定 BGG ID");
    } else {
        allIds = collectAllBggIds();

        console.log("更新模式：原有收藏清單");
    }

    // 僅處理沒有詳細資料的遊戲
    const missingIds = allIds.filter(
        id => !cache[id.toString()]
    );


    console.log(`全部不同 BGG ID：${allIds.length}`);
    console.log(`原有快取數量：${originalCount}`);
    console.log(`需要補齊數量：${missingIds.length}`);
    console.log(`每批處理：${BATCH_SIZE} 款`);
    console.log("");

    if (missingIds.length === 0) {
        console.log("所有遊戲都已經有快取，不需要更新");
        return;
    }

    const batchCount = Math.ceil(
        missingIds.length / BATCH_SIZE
    );

    let successCount = 0;
    let failedCount = 0;

    const failedIds: number[] = [];

    for (
        let batchIndex = 0;
        batchIndex < batchCount;
        batchIndex++
    ) {

        const start =
            batchIndex * BATCH_SIZE;

        const batch = missingIds.slice(
            start,
            start + BATCH_SIZE
        );

        console.log("");
        console.log(
            `========== 第 ${batchIndex + 1}/${batchCount} 批 ==========`
        );

        for (
            let i = 0;
            i < batch.length;
            i++
        ) {

            const bggId = batch[i];

            const progress = start + i + 1;

            console.log(
                `[${progress}/${missingIds.length}] BGG ${bggId}`
            );

            try {

                const game = await fetchBggGame(
                    bggId,
                    token
                );

                cache[bggId.toString()] = game;

                successCount++;

                console.log(
                    `  ✓ ${game.name}`
                );

            }
            catch (error) {

                failedCount++;
                failedIds.push(bggId);

                console.error(
                    `  ✗ BGG ${bggId}`,
                    error instanceof Error
                        ? error.message
                        : error
                );
            }

            // 最後一筆不需要額外等待
            if (i < batch.length - 1) {
                await sleep(REQUEST_DELAY_MS);
            }
        }

        // 每批儲存成功的資料
        await saveCache(cache);

        console.log(
            `第 ${batchIndex + 1} 批完成，` +
            `已成功 ${successCount} 款，` +
            `失敗 ${failedCount} 款`
        );

        if (batchIndex < batchCount - 1) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    console.log("");
    console.log("======================================");
    console.log("BGG Cache 更新結果");
    console.log("======================================");

    console.log(`原有快取：${originalCount}`);
    console.log(`本次成功：${successCount}`);
    console.log(`本次失敗：${failedCount}`);
    console.log(
        `目前快取總數：${Object.keys(cache).length}`
    );

    if (failedIds.length > 0) {

        console.log("");
        console.log("失敗的 BGG ID：");
        console.log(failedIds.join(", "));
        console.log("下次執行會自動重試缺少的 ID");
    }

    console.log("");
    console.log("更新完成");
}

// ============================================================
// 執行
// ============================================================

main().catch(error => {

    console.error(
        "BGG Cache 更新失敗：",
        error
    );

    process.exitCode = 1;
});