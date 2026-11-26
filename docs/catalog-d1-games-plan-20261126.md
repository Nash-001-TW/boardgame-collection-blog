# 同步過的 BGG 遊戲可直接新增收藏｜規劃（2026-11-26，候選）

對應 CURRENT_TASK #30（2026-11-26 新增）。**緣起**：使用者在正式後台準備新增收藏時發現，「新增收藏」只能選建置時打包的靜態 BGG 目錄（`src/data/bgg-cache.json`，815 款）。目錄外的遊戲，即使已在 `/admin/bgg` 同步成功也選不到；每次都要由 Claude 改資料檔再部署，不能長期這樣運作。使用者要求：要有介面讓自己新增。

狀態：Q94～Q96 **已採納**（全採 A，DECISION_LOG CAT-D1-Q94～Q96，2026-11-26）；§5 工作命令**已授權**（2026-11-26，DECISION_LOG CAT-D1-AUTH）。本文件只做靜態閱讀，未執行測試，未讀正式資料。**不需要 Migration**。

## 1. 現況盤點（2026-11-26 靜態閱讀）

| 位置 | 是否支援「只存在 D1、同步成功」的 BGG 遊戲 |
| --- | --- |
| `/admin/bgg` 同步（`bgg-sync-admin.ts`） | ✅ 可以同步任何 BGG ID 進 `bgg_games`（`cache_json`、`last_success_at`），一次最多 3 筆；清單合併 D1 與靜態目錄 |
| 公開網站（`public-site-data.ts`） | ✅ 已設計好：D1 遊戲只要同步成功，**而且**有未封存的收藏（或已連結的 NotBGG），就會出現在公開目錄；詳細資料優先用 D1 快取 |
| 公開收藏（`public-game-collection.ts`） | ✅ 不在靜態目錄時改讀 D1（`readPublicBgg`） |
| 關係管理（`relation-admin.ts`） | ✅ 優先用 `cache_json`，靜態目錄只當後備 |
| **新增收藏：搜尋**（`collection-v2-management.ts` 第 399 行 `search`） | ❌ 只搜靜態目錄 |
| **新增收藏：建立**（同檔第 412 行 `create`） | ❌ 只認靜態目錄，其他一律 `INVALID_REFERENCE` |
| **NotBGG 連結到 BGG**（`notbgg-link-repository.ts` 第 14 行 `target`） | ❌ 只認靜態目錄，不在目錄裡就回 `TARGET_NOT_FOUND` |
| 舊版收藏卡片連結（`collection-v2-links.ts`） | 只對靜態目錄產生 slug 連結；D1 遊戲沒有連結，但不會出錯（屬舊頁面，不在本次範圍） |

**結論**：缺口只在 3 個地方（搜尋、建立、NotBGG 連結），公開端已經準備好了。

## 2. 固定規則（不需決策）

1. 「可選的 D1 遊戲」定義和公開網站相同：`bgg_games.last_success_at IS NOT NULL AND cache_json IS NOT NULL`，而且 `cache_json` 能解析出名稱與 `gameType`。同步失敗、從沒成功過或資料損壞的，一律不可選（失敗關閉）。
2. 同一個 BGG ID 同時在靜態目錄和 D1 時，只列一次。
3. 建立收藏時，名稱和類型從 D1 快取取得，寫入 `v2_games` 的方式和靜態目錄相同（`ON CONFLICT(bgg_id) DO NOTHING`）。
4. 既有的冪等、驗證、副本、採購流程完全不變。
5. 公開網站不改：新增收藏後，這款遊戲會依現有規則自動出現在公開目錄。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q94 | 新增流程怎麼走 | 兩步：先在 `/admin/bgg` 同步，再到新增收藏搜尋。新增收藏搜不到時，搜尋結果下方提示「找不到？先到 BGG 同步輸入 BGG ID」並附連結 | 一步：在新增收藏直接輸入 BGG ID，頁面自動呼叫同步，成功後立即可選 | **A**：只改讀取與驗證，不在新增收藏裡呼叫外部網路；BGG 同步已經有限流、重試與失敗紀錄。B 比較方便，但新增收藏會多一段外部呼叫與錯誤處理，可以等 A 用一陣子再評估 |
| Q95 | NotBGG 連結到 BGG 的目標是否一起支援 D1 遊戲 | 一起做 | 之後再做 | **A**：如果今天先用 NotBGG 建立收藏，之後要連到正確的 BGG 遊戲，就需要這一項；兩處的判斷規則相同 |
| Q96 | 搜尋結果怎麼標示來源 | 同一份清單，D1 遊戲旁加小標籤「已同步」 | 不標示 | **A**：出問題時容易分辨資料來自哪裡；不影響操作 |

## 4. 非目標

- 新增收藏頁直接呼叫 BGG（Q94 選 A 時）。
- 改公開網站、`collection-v2-links.ts` 舊頁面。
- 修改 BGG 同步本身：一次 3 筆的上限、限流。
- 從 BGG 帳號匯入整份收藏。
- 桌遊套組：BGG 沒有收錄或自組的套組，沿用 `/admin/notbgg/new`；多個收藏之間的組合關係，沿用 `/admin/bgg?view=relations&domain=collection`（已存在）。

## 5. 工作命令 `CAT-D1-20261126-01`（已授權 2026-11-26，CAT-D1-AUTH）

執行者：Codex（本機實作與測試）。

### 5.1 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/lib/collection-v2-management.ts` | **只限** `search` 和 `create` 的 BGG 分支：<br>• 搜尋：再加一個 D1 查詢（名稱或 `BGG:ID`、`#ID`，`LIMIT 20`，條件依 §2-1）；和靜態結果合併、依 BGG ID 去重，總數仍最多 20 筆。D1 結果帶 `synced: true`。<br>• 建立：靜態目錄找不到時，改讀 D1 的 `cache_json`（條件依 §2-1），取得名稱與類型。<br>其他方法逐字保留 |
| `src/lib/notbgg-link-repository.ts` | **只限** `target`：靜態目錄找不到時，用同一條件查 D1；`target` 要改成 async 的話，呼叫端一起調整，並回報受影響的呼叫端 |
| 共用判斷（新增，例如 `src/lib/bgg-d1-catalog.ts`） | 依 §2-1 讀取單筆或搜尋 D1 遊戲的純讀取函式，給上面兩處共用；讀取失敗就拋出，不得當成「找不到」 |
| `src/lib/collection-admin-controller.ts`、`src/components/CollectionAdmin.astro` | 搜尋結果顯示「已同步」標籤；沒有結果時顯示 Q94-A 的提示與 `/admin/bgg` 連結（中英雙語） |
| 測試 | 新增 `tests/catalog-d1-games.test.ts`；既有的收藏與 NotBGG 測試只增 |
| `docs/CAT-D1-screenshots/` | 新增截圖 |
| 本文件 §5.4 | 回報 |

不得修改：`migrations/`、公開網站程式、`bgg-sync-admin.ts`、`games.ts`、`game-catalog.ts`、`src/data/`、授權／middleware、`wrangler.json`、`astro.config.mjs`。

### 5.2 測試與驗收

1. **單元**（拋棄式 SQLite，套用全部 Migration）：
   - 同步成功的 D1 遊戲搜得到（用名稱或 `BGG:ID`），而且可以建立收藏；名稱與類型取自 `cache_json`。
   - 同步失敗、從沒成功過、`cache_json` 損壞或缺 `gameType` 的遊戲，搜不到也不能建立（`INVALID_REFERENCE`）。
   - 和靜態目錄重複的 ID 只出現一次。
   - D1 讀取失敗時回 503，不是「找不到」。
   - 冪等重送結果不變。
   - NotBGG 可以連結到 D1 遊戲；連結到無效的 D1 遊戲時回 `TARGET_NOT_FOUND`。
   - 建立收藏後，公開目錄讀取會包含這款遊戲（驗證既有規則）。
2. **瀏覽器**（Edge 暫存 profile、本機拋棄式資料、全新的空輸出資料夾）：
   - 搜尋顯示「已同步」標籤；
   - 選取 D1 遊戲並建立收藏與副本；
   - 搜不到時顯示提示和連結；
   - 中英雙語；375／768／1280 寬度都沒有整頁橫向捲動。
3. **回歸**：收藏、NotBGG、公開網站相關的 Node 測試與 Edge 腳本全跑；`npm run astro -- check`（基準 6 errors）；`npm run build`。
4. **截圖**：搜尋結果（含標籤）、搜不到時的提示，各 375 與 1280 寬；英文 1280 一組。

### 5.3 上線

不需要 Migration，Claude 審查通過後，依 DEPLOY-01 另行授權推送部署。部署後由使用者實際操作驗收：在 `/admin/bgg` 同步一款不在目錄裡的遊戲，再新增收藏。

### 5.4 Codex 執行回報

（待填）

### 5.5 禁止事項

同 P0B §7.7：
- 網路存取、任何遠端或正式操作、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外，結束前清除。
