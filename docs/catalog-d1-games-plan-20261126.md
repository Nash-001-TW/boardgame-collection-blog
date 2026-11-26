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

**2026-11-26（Asia/Taipei）｜已實作、專項本機驗證通過。** 既有回歸有失敗與未能啟動的腳本，詳見下表。

**檔案**

- 新增 `src/lib/bgg-d1-catalog.ts`。共用 D1 快取查詢驗證名稱、類型、身份與同步狀態。D1 目錄查詢例外交由既有 Admin API 回傳 503。
- 修改 `src/lib/collection-v2-management.ts`。BGG 搜尋支援快取名稱、`BGG:ID` 和 `#ID`，合併結果最多 20 筆。相同 ID 同時命中時顯示帶「已同步」的 D1 結果，建立仍依 §5.1 先找靜態登錄，再讀 D1。
- 修改 `src/lib/notbgg-link-repository.ts`。比對 `comparison`、`execute` 的提案，以及確認／切換為 BGG 主來源，均等候非同步 `target`。這三處是全部呼叫點。
- 修改 `src/lib/collection-admin-controller.ts`、`src/components/CollectionAdmin.astro`。新增中英標籤及空結果提示，連結保留介面語言。
- 新增 `tests/catalog-d1-games.test.ts`、下列六張合成資料截圖，並更新本文 §5.4。無刪除。**既有測試斷言修改 0 條。** 新增的測試涵蓋全 Migration、D1 及靜態去重、無效快取拒絕、503、建立與重送、NotBGG 連結及公開目錄資格。

**測試與結束碼**

`$preload` 指 repo 外暫存預載，針對 Windows `os.userInfo()` 的 ENOMEM 提供測試使用者名稱，Edge 運行使用獨立暫存 profile 及 loopback 代理。每次 Edge 腳本執行都建立全新的空 `$out`。Node 最終回歸及建置關閉 Cloudflare CF 資料抓取，建置另關閉遙測和 Wrangler metrics。

| 指令 | 通過／失敗 | 結束碼與結果 |
| --- | --- | --- |
| `node --import $fallback --import tsx --test tests/catalog-d1-games.test.ts` | 0／1 → 7／0 | 1 → 0。首次 ENOMEM 回退條件未匹配，修正後專項全通過。 |
| `node --import $fallback --import tsx --test --test-concurrency=2 @files`（下列清單除專項檔） | 143／6 | 1。含最終仍出現的 4 項，以及兩項本機 D1 併發 `ECONNRESET`。 |
| `node --import $preload --import tsx --test --test-concurrency=2 @files`（下列 19 檔） | 152／4 | 1。兩項本機 D1 併發案例重跑通過。仍有三項失敗斷言及一項父測試失敗。 |
| `node --import $preload --import tsx --test --test-concurrency=1 tests/notbgg-link.test.ts tests/notbgg-public.test.ts tests/notbgg-repository.test.ts`（暫存副本還原 HEAD 來源） | 45／4 | 1。原版本重現相同三項失敗斷言及一項父測試失敗。 |
| `node --import $fallback --import tsx $scratch/catalog-browser.mjs $out`，其後改用 `$preload` | 0／1 → 5／0 → 5／0 → 5／0 | 1 → 0 → 0 → 0。初次等待完整頁面載入超時，改等實際表單後通過。最後一次驗證最終版本並保存截圖。 |
| `node --import $preload --import tsx tests/admin-collection-list-browser.mjs $out` | 12／0 | 0。 |
| `node --import $preload --import tsx tests/admin-collection-detail-browser.mjs $out` | 72／0 | 0。 |
| `node --import $preload --import tsx tests/collection-picker-browser.mjs $out` | 0／1 | 1。舊 `/admin/collection/components/manage` 已回 302，腳本等待該網址的舊選擇器畫面超時。 |
| `node --import $preload --import tsx tests/public-site-browser.mjs $out` | 3／0 | 0。以腳本輸出的三組驗收計。 |
| `node --import $preload --import tsx tests/<Playwright 腳本> playwright $edge $out` | 各 0／1 | 各 1。以下七支均於載入模組時失敗，Edge 案例尚未執行。 |
| `node --import $preload --import tsx tests/b3c-browser.cjs $out` | 0／1 | 1。`BROWSER_ACCEPTANCE_FAILED`。 |
| `node --import $preload --import tsx tests/b3d-browser.cjs $out` | 0／1 | 1。`BROWSER_ACCEPTANCE_FAILED`。 |
| `node --import $preload --import tsx tests/b41-browser.cjs $out` | 0／1 | 1。`BROWSER_ACCEPTANCE_FAILED`。 |
| `node --import $preload --import tsx tests/b42-browser.cjs $out` | 0／1 | 1。`BROWSER_ACCEPTANCE_FAILED`。 |
| `node --import $preload --import tsx tests/b43c-browser.cjs $out` | 3／1 | 1。舊詳細頁關聯 DOM 驗收失敗。 |
| `npm run astro -- check` | 6 個基準錯誤，新增 0 | 1。最終完整檢查 374 檔、0 warnings、25 hints。 |
| `npm run build` | 0／1 → 0／1 → 0／1 → 1／0 | 1 → 1 → 1 → 0。前兩次在預渲染遇到 loopback 代理拒絕，第三次遇到 Wrangler 使用者目錄寫入限制。以程序限定的本機 fetch 守衛和暫存 `XDG_CONFIG_HOME` 重跑後，四條靜態路由全部生成，Worker 建置完成。 |
| `git diff --check` | 1／0 | 0。 |

Node `@files` 清單（均位於 `tests/`）：`catalog-d1-games.test.ts`、`admin-collection-detail.test.ts`、`admin-collection-list.test.ts`、`collection-field-patch.test.ts`、`collection-gaps.test.ts`、`collection-picker.test.ts`、`game-browser-url.test.ts`、`notbgg.test.ts`、`notbgg-admin-api.test.ts`、`notbgg-collection.test.ts`、`notbgg-link.test.ts`、`notbgg-middleware.test.ts`、`notbgg-public.test.ts`、`notbgg-rate-limiter.test.ts`、`notbgg-relation-retention.test.ts`、`notbgg-repository.test.ts`、`public-game-collection.test.ts`、`public-site-data.test.ts`、`public-site-sqlite-runtime.test.ts`。

- Node 最終失敗是 `notbgg-link.test.ts` 的 Worker gateway 測試期待 503、實際 200，`notbgg-public.test.ts` 仍要求已動態化的路由含 `getStaticPaths`，以及 `notbgg-repository.test.ts` 將套用全部 Migration 的表結構對照 0014 時點，該子測試及其父測試各計一項。修改這些既有斷言超出 §5.1。
- 缺少本機 Playwright 的七支腳本是 `notbgg-admin-browser.cjs`、`notbgg-collection-browser.cjs`、`notbgg-link-browser.cjs`、`notbgg-public-browser.cjs`、`game-browser-navigation.cjs`、`game-detail-v2-browser.cjs`、`catalog-visual-v1-browser.cjs`。
- 初次批跑七支 Edge 腳本時，Windows 的 `--import` 直接使用絕對路徑，七支均啟動失敗，各 0／1、結束碼 1。改用 file URL 重跑。本次另外用同一批指令的 `$out` 參數啟動三支需 Playwright 的公開舊腳本，三支也都在模組載入階段退出；其後以表中的完整參數重試。
- Astro 初輪僅掃描來源副本（231 檔、4 errors、0 warnings、3 hints，結束碼 1）。加上腳本與測試後，完整重跑為 8 errors、0 warnings、25 hints，結束碼 1。修正兩個 DOM `append` 型別衝突後得到表中的 6 個基準錯誤。

**截圖清單**

| 介面 | 同步標籤 | 無搜尋結果 |
| --- | --- | --- |
| 繁中 375 | [搜尋結果](CAT-D1-screenshots/zh-TW-375-results.png) | [同步提示](CAT-D1-screenshots/zh-TW-375-empty.png) |
| 繁中 1280 | [搜尋結果](CAT-D1-screenshots/zh-TW-1280-results.png) | [同步提示](CAT-D1-screenshots/zh-TW-1280-empty.png) |
| 英文 1280 | [搜尋結果](CAT-D1-screenshots/en-1280-results.png) | [同步提示](CAT-D1-screenshots/en-1280-empty.png) |

Edge 另驗證繁中 768 無整頁橫向捲動，並用 UI 建立一筆 test scope 收藏及一份副本。

**未執行或未完成**

- Playwright 腳本的瀏覽器案例、`c4-browser.cjs` 的外部封面網路測量與上線後人工驗收，尚未執行測試驗證。未安裝依賴、操作正式資料庫、部署、commit 或 push。
- 初輪 Node 預載未明確關閉 Miniflare 預設 CF 資料抓取。環境網路已停用，沒有對外連線成功的證據，最終回歸明確關閉該抓取。

**殘留暫存路徑**：`D:\TEMP\CAT-D1-20261126-01-local`。內含隔離建置副本、測試日誌、Edge profile、合成截圖與暫存腳本。已核對該目錄位於系統暫存目錄且為本工作命令所建立。環境自動審查拒絕兩次遞迴清除該路徑，原因顯示為 `blocked by policy`，因此保留。初輪 Wrangler 印出的三個使用者設定目錄日誌路徑已逐一檢查，檔案皆未找到。

### 5.6 Claude 審查（2026-11-26）

**結論：有條件通過。** 功能方向正確，測試也通過；但有 1 項必修（F1），另有 1 項建議一併修正（F2），兩項都只需要改幾行。

**本人驗證**

- Node：`catalog-d1-games` 加上收藏、NotBGG、公開網站、R06、卡套、R01 相關共 14 個測試檔合跑（`--test-concurrency=1`），**94 通過、0 失敗**。
- `git diff --check` 通過。
- §5.4 回報的 4 項既有失敗，我在目前工作樹重跑，結果相同（`notbgg-link`、`notbgg-public`、`notbgg-repository`，45 通過、4 失敗）。失敗原因如下，都和這次的改動無關，Codex 也已在原版本重現。我**沒有**自己在原版本重跑，判斷依據是測試內容：
  - `notbgg-link.test.ts` 第 103 行：公開路由 `/games/santorini` 在 D1 不可用時預期 503、實際 200；
  - `notbgg-public` 預期舊的靜態路由；
  - `notbgg-repository` 以 0014 時點的表結構做比對。

  建議之後另開項目整理這些過時的測試。
- 看過的截圖：`zh-TW-1280-results`（D1 遊戲有「已同步」標籤）、`zh-TW-375-empty`（顯示「找不到可用遊戲。先到 BGG 同步輸入 BGG ID」連結），都符合 Q94、Q96。

**逐項核對**

- 共用函式 `bgg-d1-catalog.ts`：用 `CASE WHEN json_valid` 擋下損壞的快取，再驗證 `bggId` 一致、名稱非空白、`gameType` 是 3 種之一；讀取失敗回 503，不當成「找不到」。符合 §2-1 與失敗關閉原則。
- 建立收藏：先找靜態目錄，找不到再讀 D1；名稱和類型取自快取；寫入 `v2_games`、冪等、副本流程都沒變。
- NotBGG：`target` 改成 async，3 個呼叫點（比對、提案、確認／切換主來源）都已加上 `await`，沒有漏掉的地方。
- 沒有修改既有斷言；沒有動到 Migration、公開網站和同步程式。

**必修**

- **F1：搜尋結果截斷會把 NotBGG 擠掉（行為退步）。** `search` 最後用 `[...synced, ...bgg, ...notbgg].slice(0,20)` 把整份清單截成 20 筆。原本是 BGG 最多 20 筆、NotBGG 另外最多 20 筆。現在只要關鍵字命中 20 筆以上的 BGG 遊戲（例如「卡坦」「2」這類常見字），NotBGG 結果就會**完全看不到**。
  - 修正：只把 BGG 的合併結果（D1 加上靜態、去重後）截成 20 筆，再接上 NotBGG。
  - 補一個測試：BGG 命中 20 筆以上時，NotBGG 結果仍然出現。

**建議一併修正**

- **F2：可選條件比規格多了 `sync_status != 'failed'`。** §2-1 規定「定義和公開網站相同」（只看 `last_success_at` 和 `cache_json`）。多了這個條件後，一款遊戲如果以前同步成功、後來重新同步失敗，**公開網站還會顯示它，新增收藏卻選不到**，兩邊會不一致。
  - 修正：拿掉 `sync_status != 'failed'`，讓條件和公開網站一致。
  - 測試改成「曾經成功、之後失敗」的遊戲仍然可選；從來沒成功過的仍然不可選。

**小觀察（不擋上線）**

- O1：靜態目錄裡的遊戲如果也在 D1 同步過，搜尋時同樣會顯示「已同步」。這是事實，可以接受。
- O2：Codex 在 `D:\TEMP\CAT-D1-20261126-01-local` 留下的暫存資料夾，環境政策不允許它刪除，需要使用者手動刪除。

**修正方式**：F1、F2 屬於 §5.1 範圍內的檔案（`collection-v2-management.ts`、`bgg-d1-catalog.ts`、新增的測試檔），不需要擴大範圍，只需要授權再跑一輪（CAT-D1-AUTH-02）。

### 5.7 Codex 執行回報（CAT-D1-AUTH-02）

**2026-11-26（Asia/Taipei）｜F1、F2 已實作，專項已驗證。**

- `src/lib/collection-v2-management.ts`：D1 與靜態 BGG 依 ID 去重後取最多 20 筆，再接上自己的上限同為 20 筆的 NotBGG 結果。
- `src/lib/bgg-d1-catalog.ts`：以最後成功時間與既有快取 JSON 驗證判斷資格。後續同步失敗仍可使用最後成功快取。
- `tests/catalog-d1-games.test.ts`：用 25 筆命中的 BGG 驗證 NotBGG 仍出現。補測成功後失敗仍可依名稱與 ID 搜尋並以快取建立收藏，從未成功即使有 JSON 仍拒絕搜尋與建立。調整原專項測試的總筆數與失敗狀態斷言以反映 F1、F2。其餘測試檔未修改。
- `docs/catalog-d1-games-plan-20261126.md`：補本節。無新增或刪除專案檔案。

| 指令 | 通過／失敗 | 結束碼 |
| --- | --- | --- |
| `node --import $preload --import tsx --test tests/catalog-d1-games.test.ts` | 6／2 → 8／0 | 1 → 0。首輪兩個合成名稱命中同一搜尋詞，修正合成名稱後重跑通過。兩個失敗計數含父測試。 |
| `node --import $preload --import tsx --test --test-concurrency=1 @files` | 153／4 | 1。§5.4 已在原版本重現的三個既有斷言及一個父測試失敗，本輪結果相同。 |
| `node --import $preload --import tsx $scratch/catalog-browser.mjs $out` | 5／0 | 0。驗證中英標籤、空結果連結、375／768／1280 寬度，以及建立收藏與一份副本。 |
| `git diff --check` | 1／0 | 0。 |

`@files` 沿用 §5.4 的 19 個 Node 測試檔。Node 與 Edge 關閉 CF 資料抓取，使用本機 loopback 及 repo 外暫存預載。Edge 每次使用全新的空輸出目錄，本輪既有截圖未覆寫。

**未執行**：Astro check、build、其他 Edge 回歸、正式驗收、遠端／網路操作、部署、commit、push。

**殘留暫存路徑**：Edge 輸出與 profile 位於 `D:\TEMP\CAT-D1-20261126-01-local\auth02-edge-10d9ef78-3b63-474a-892f-1e0d64578da4`。環境自動審查拒絕遞迴清除，原因顯示為 `blocked by policy`。本輪 Node 暫存日誌已清除，前一輪的暫存目錄仍保留。

### 5.8 Claude 結案審查（2026-11-26）

**結論：`CAT-D1-20261126-01`（含 AUTH-02）通過，本機驗證完成。**

- **F1 已修正**：`search` 只把 BGG 合併結果（D1 加靜態、去重）截成 20 筆，再接上 NotBGG（自身上限仍是 20 筆）。新測試用 25 筆命中的 BGG 證明 NotBGG 仍會出現。
- **F2 已修正**：`bgg-d1-catalog.ts` 已沒有 `sync_status` 條件，可選條件只看 `last_success_at`、`cache_json` 與既有的 JSON 驗證，和公開網站一致。新測試涵蓋「成功後再失敗仍可選」與「從沒成功過，即使有 JSON 也不可選」。
- **專項測試的斷言調整**：只配合 F1、F2 調整總筆數和失敗狀態的預期，其他測試檔沒有修改。
- **本人驗證**：
  - Node：14 個測試檔合跑，**95 通過、0 失敗**。
  - `git diff --check` 通過。
  - 完整 `npm run astro -- check`：375 檔、**6 個基準錯誤，新增 0 個**。這輪 Codex 沒跑，由我補跑。
  - build 沒有重跑，以 §5.4 第一輪的結果為準；這輪只改了兩個函式的內容，沒有改匯入結構。
- **4 項既有 NotBGG 測試失敗**：和 §5.6 的判斷相同，與這次改動無關，維持不變。建議另開項目整理。
- **殘留暫存**：`D:\TEMP\CAT-D1-20261126-01-local`（含 `auth02-edge-…` 子資料夾），需要使用者手動刪除。

**上線**：不需要 Migration。依 DEPLOY-01，需要另外授權才能推送部署；部署後由使用者實際操作驗收：在 `/admin/bgg` 同步一款目錄外的遊戲，再到新增收藏搜尋並建立。

### 5.9 部署（2026-11-26，Claude 執行，使用者授權「提交並推送」，DECISION_LOG CAT-D1-DEPLOY）

- 提交 `1ec49da`，台北 10:49:36 推送 `8ac5c29..1ec49da`，共 3 個提交：`ce0c644`、`7812a19`、`1ec49da`。
- Workers Builds 自動部署為 `157a866c`（100%，台北 10:50:20）。
- 唯讀抽查 14 條路由，全部符合：
  - 公開頁 6 條回 200；`/games/bgg/451166` 回 307。
  - `/admin`、`/admin/collection`、`/admin/collection/new`、`/admin/bgg`、`/admin/notbgg`、`/api/admin/auth-check` 回 302 轉到 Access。
  - `/dev/ui-kit` 回 404。
- 遠端操作：推送 1 次、Metadata 輪詢 3 次、HTTP 14 次；D1 查詢與寫入 0。
- **待做**：由使用者實際操作驗收。先在 `/admin/bgg` 同步一款目錄外的遊戲，再到 `/admin/collection/new` 搜尋並建立收藏。

### 5.5 禁止事項

同 P0B §7.7：
- 網路存取、任何遠端或正式操作、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外，結束前清除。
