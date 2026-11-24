# V2-Release-04 正式預檢與備份

**2026-11-24（Asia/Taipei）**｜工作單 `D1-A5-G01-20261124-01`，依 `D1-A5-G01-AUTH` 已授權。依規劃 §14.6 在認證關卡停止。本機 Wrangler 預設 OAuth 已過有效期，工作程序沒有可用的 API Token。遠端操作尚未開始。

## G0 正式唯讀預檢

| 項目 | 本次結果 |
| --- | --- |
| 1. Account、Worker、D1 | 未驗證。Release-03 比對基準為 Account `0994e9…24d96a`、Worker `boardgame-collection-blog`、D1 `boardgame-collection-db`（`59e9a1…14e395`）。 |
| 2. 流量版本與比例 | 未查詢。預期為 version 19、100%。 |
| 3. Migration ledger 及同名物件 | 未查詢。預期為 0001～0022 共 22 筆，需要核對完整檔名清單及是否存在 `d1_quantity_*` 同名物件。 |
| 4. 分類列數及上限比例 | 未查詢。已在本機核對查詢口徑為 `physical-component-management.ts` 的 `evidenceSize`，上限 10,000，達 8,000 即停止。 |
| 5. 收藏筆數 | 未查詢 `v2_collection_items`。 |
| 6. 作業期間無其他更新 | 依工作單列為待使用者確認，由使用者在 Claude 對話回答。 |

## G1 正式 D1 備份

尚未執行。沒有本次備份檔、檔案大小或 SHA-256。本機還原、`integrity_check`、`foreign_key_check` 及 ledger 比對均未執行。

## 遠端操作次數

| 操作 | 次數 |
| --- | ---: |
| Account／Worker／D1 Metadata GET（各自） | 0 |
| 正式 D1 SELECT | 0 |
| 官方 Export 啟動 | 0 |
| 官方 Export 輪詢 | 0 |
| 官方 Export 下載 GET | 0 |
| 正式寫入 | 0 |

本次未執行登入或重試，未執行 G2～G7、建置、Migration、Worker 上傳或部署、Secret／Access／DNS 變更、DML、Preview D1 操作或 Git 提交。未讀取 `.env` 或 `.dev.vars` 內容。尚未執行測試驗證。

請使用者在 repo 根目錄執行 `npx wrangler login`，親自在瀏覽器授權 Release-03 對應的 Cloudflare 帳號。成功條件為終端顯示 Wrangler 登入成功，且命令以狀態碼 0 結束。


## 2026-11-24（Asia/Taipei）續跑結果

工作單 `D1-A5-G01-20261124-01`（`D1-A5-G01-AUTH`，已授權）於 G0 第一筆 Account Metadata GET 停止。本機 Wrangler OAuth 通過有效期限檢查。GET 回報 `HttpRequestException / ConnectionError`，未收到 HTTP 回應，無法確認請求是否到達 Cloudflare。依 §14.6 停止，未重試或改用其他方法。

| G0 項目 | 續跑結果 |
| --- | --- |
| 1. Account、Worker、D1 | 使用者已透過 Wrangler 確認 Account ID 與 Release-03 相符（`0994e9…24d96a`）。本輪 Account Metadata 未取得。Worker `boardgame-collection-blog` 與 D1 `boardgame-collection-db`（`59e9a1…14e395`）為 Release-03 比對基準，本輪未查詢。 |
| 2. 流量版本與比例 | 未查詢。基準 version 19、100%。 |
| 3. Migration ledger 及同名物件 | 未查詢。基準 0001～0022 共 22 筆，`d1_quantity_*` 同名物件預期 0 個。 |
| 4. 分類列數及上限比例 | 未查詢，比例未取得。上限 10,000，停止門檻 8,000。 |
| 5. 收藏筆數 | 未查詢 `v2_collection_items`。 |
| 6. 作業期間無其他更新 | 已由使用者在 Claude 對話確認，見 HANDOFF.md 2026-11-24 條目。 |

**G1 未執行。** 未產生備份檔案、檔案大小或 SHA-256。未執行本機還原、完整性檢查、外鍵檢查或 ledger 比對。

| 遠端操作 | 本輪嘗試次數 | 已取得成功回應 |
| --- | ---: | ---: |
| Account Metadata GET | 1 | 0 |
| Worker Metadata GET | 0 | 0 |
| D1 Metadata GET | 0 | 0 |
| 正式 D1 SELECT | 0 | 0 |
| 官方 Export 啟動／輪詢／下載（各自） | 0 | 0 |
| 正式寫入 | 0 | 0 |

本輪未執行登入、G2～G7、建置、Migration、Worker 上傳或部署、Secret／Access／DNS 變更、DML、Preview D1 操作或 Git 提交。未讀取 `.env` 或 `.dev.vars` 內容。尚未執行測試驗證。

## 第三輪（2026-11-24，Claude 直接執行，DECISION_LOG TEAM-04）：G0 第 2 項不符，停止

| G0 項目 | 結果 |
| --- | --- |
| 1. Account | `wrangler whoami`：1 個帳號，`0994e9…24d96a`，與 Release-03 相符 |
| 2. 流量版本 | **不符**。100% 流量為 version `eff80d59…7008`，建立於 2026-11-24T02:39:19Z（台北 10:39:19），Source 顯示 `Unknown (deployment)`；預期為 Release-03 的 version 19（`f4617e7b…`） |
| 3～5 | 未查詢（已停止） |
| 6 | 使用者確認期間無其他人或自動流程更新 |

**時間比對（本機 Git，未連遠端）**：A4 提交 `c341096` 於台北 10:38:30 推送到 `origin/main`，49 秒後出現上述部署。推測 Cloudflare 對此 repo 設有推送後自動建置部署（例如 Workers Builds 的 Git 連動）；repo 內沒有 CI workflow，所以先前「推送不觸發部署」的判斷不成立。**尚未證實**，需使用者在 Cloudflare Dashboard 確認。

若推測成立：2026-11-23 起的每次推送（`dd133d3`、`31f5757`、`a5e3ce3`、`5e4eeb3`、`7a460fd`、`4251b2b`、`c341096`）都可能已部署到正式環境；目前正式環境應是 A4 程式碼、但 D1 尚未套 0023，D1 預覽與歷史會顯示「暫時無法使用／無法取得」，一般編輯與清點不依賴 0023。

**本輪遠端操作**：`wrangler whoami` 1 次、`wrangler deployments status` 1 次（皆唯讀）。D1 SELECT 0、Export 0、正式寫入 0。依 §14.6 停止，未查詢 ledger、分類列數與收藏數，未備份。

### 使用者確認（2026-11-24，Cloudflare Dashboard，只讀）

使用者確認 Worker 的 Build 設定連結 GitHub repo、分支 `main`。Deployments 頁顯示三筆由 `main` 建置的部署：`8bc5124c`（A2）、`fd57e8dc`（A3）、`eff80d59`（A4，active、100%、錯誤率 0%）。**推送 `main` 即自動建置部署到正式環境，已證實。** 更早的推送（2026-11-23）是否也已部署，畫面未列出，待 rollout history 確認。

## 第四輪（2026-11-24，Claude 執行，DECISION_LOG D1-A5-REV-01）：G0 通過、G1 通過

### G0 唯讀預檢（基準改為 `eff80d59`）

| 項目 | 結果 |
| --- | --- |
| 1. Account | 1 個，`0994e9…24d96a`，相符 |
| 2. 流量版本 | `eff80d59`（A4）100%，符合新基準 |
| 3. Migration ledger | 22 筆，0001～0022，檔名與 repo 完全一致；`d1_quantity_*` 同名物件 0 |
| 4. 分類列數 | **1,302**（evidenceSize 同口徑），上限 10,000 的 13%，低於 8,000 停止門檻 |
| 5. `v2_collection_items` | **256**（0023 將建立 256 筆世代列） |
| 6. 期間無其他更新 | 使用者確認 |

**正式網站唯讀抽查**（Release-03 §10.5 清單）：`/`、`/collection`、`/games`、`/en/games`、`/sitemap.xml`、`/robots.txt`、`/about/`、兩個公開 catalog API、`/games/bgg-451166` 皆 200；`/games/bgg/451166`、`/en/games/bgg/451166` 307 → canonical 後 200；`/games/bgg/2147483647` 404；`/admin`、`/api/admin/auth-check`、`/admin/bgg`、`/api/admin/bgg`、`/admin/collection/components/manage` 皆 302 至 Access 登入；`/dev/collection-v2-test` 404。第一次抽查時轉址路由因 Claude 的解析腳本錯誤顯示 ERR，改用不跟隨轉址的方式重查後如上。R06 頁面需使用者登入後人工確認（一般清點可用、歷史顯示「暫時無法取得」），尚未確認。

### G1 正式 D1 備份

| 項目 | 結果 |
| --- | --- |
| 方法 | `wrangler d1 export --remote`（官方 Export，1 次） |
| 遠端匯出 | 2026-11-24T03:21:24Z 啟動，遠端完成；**本機寫檔失敗（EPERM）**：Claude 建立私人目錄時把 ACL 授予本機帳號，實際執行者為網域帳號。修正 ACL 後，經使用者同意以同一次匯出產生的下載連結（1 小時有效）下載 1 次，未重新匯出；連結未輸出至對話或報告 |
| 下載完成 | 2026-11-24T03:23:40Z |
| 檔案大小 | 2,092,163 bytes |
| SHA-256 | `f879fda6d3d40db24c14040ee9d4a5e1f838e2c18c3484aaa9a703aeade0114d` |
| 本機記憶體還原 | PASS（載入時關閉外鍵、載入後開啟） |
| `PRAGMA integrity_check` | ok |
| `foreign_key_check` | 0 個違反 |
| ledger | 22 筆，與 0001～0022 相符；`d1_quantity_*` 0；`v2_collection_items` 256；schema 物件 212 |
| 位置 | 專案外 `D:/CodexHome/private-release04-backup-<uuid>/boardgame-collection-db-before-0023.sql`，ACL 僅目前使用者 FullControl、停用繼承；未加入 Git |

還原限制同 Release-03 §2：本機 SQLite 成功不等於已驗證 Cloudflare D1 遠端還原；匯出不含 Worker、KV、Secrets、Access 設定。

**注意**：下載連結記錄在使用者本機 Wrangler 紀錄檔（`AppData/Roaming/xdg.config/.wrangler/logs/`），約 2026-11-24T04:21Z 後失效。

### 本輪遠端操作次數

| 操作 | 次數 |
| --- | ---: |
| `wrangler whoami`／`deployments status`（Metadata 讀取） | 1／1 |
| 正式 D1 唯讀 SELECT（`wrangler d1 execute --remote`） | 2 |
| 正式網站唯讀 GET | 28（19＋重查轉址 7＋跟隨 canonical 2） |
| 官方 Export（含 Wrangler 內部啟動／輪詢） | 1 |
| 匯出檔下載 GET | 1 |
| 正式寫入（Migration、DML、部署、Secret、Access、DNS） | 0 |

**結論：G0、G1 通過。** 可進入 G5（套用 0023），需使用者另行授權。

## G5／G6：正式套用 0023 與對帳（2026-11-24，Claude 執行，DECISION_LOG D1-A5-G56-AUTH）

### G5-R 本機預演（以 G1 備份還原）

0023 原檔（SHA-256 `8f2c8daa…b892d3`）＋ledger INSERT 執行無錯誤，7 ms。結果：ledger 23（最後 0023）、`d1_` 開頭 table 4／view 3／trigger 52、新欄位存在、epoch 1、世代列 256 = 收藏 256、回執 0、分類列數前後皆 1,302、integrity ok、外鍵 0 違反。

**對帳口徑更正**：§15 寫「`d1_` 開頭 table 3」，但 `d1_migrations` 本身也以 `d1_` 開頭，實際應為 4（0023 新增 3 張＋既有 ledger 表）。預演確認後以 4 為準。

### G5-0 套用前唯讀複查

流量版本仍為 `eff80d59` 100%；ledger 22 筆、最後 0022；`d1_` 開頭物件（不含 `d1_migrations`）0。

### G5 正式套用（唯一一次正式寫入）

| 項目 | 結果 |
| --- | --- |
| 指令 | `wrangler d1 execute boardgame-collection-db --remote --yes --file <組合檔>`（組合檔在 Claude scratchpad，未入 repo） |
| 時間 | 2026-11-24T03:40:11Z 開始、03:40:18Z 結束（台北 11:40） |
| 結果 | exit 0；`changes` 258（世代列 256＋epoch 1＋ledger 1）；`rows_written` 326；`last_row_id` 23；`total_attempts` 1；`sql_duration_ms` 約 12 |
| 未使用 | `wrangler d1 migrations apply`（0024 未套用） |

### G6 套用後唯讀對帳

| 項目 | 預期 | 結果 |
| --- | --- | --- |
| ledger | 23，最後 0023 | 23，`0023_shared_quantity_commit.sql` ✅ |
| `d1_` table／view／trigger | 4／3／52 | 4／3／52 ✅ |
| `last_quantity_operation_id` 欄位 | 存在 | 存在 ✅ |
| `d1_quantity_epoch` | 1 | 1 ✅ |
| 世代列 = 收藏數 | 256 = 256 | 256 = 256 ✅ |
| 更正回執 | 0 | 0 ✅ |
| 分類列數 | 1,302 | 1,302 ✅ |

正式網站抽查（同 G0 清單）19 條全部符合預期，另 2 條 canonical 200；`/dev/collection-v2-test` 404。

**待使用者人工確認（需登入）**：R06 組件卡「更正歷史」改顯示「尚無更正紀錄」。

### 遠端操作次數（G5／G6）

| 操作 | 次數 |
| --- | ---: |
| Metadata 讀取（`deployments status`） | 1 |
| 正式 D1 唯讀 SELECT | 2（G5-0、G6） |
| **正式 D1 寫入** | **1**（G5） |
| 正式網站唯讀 GET | 21 |
| 部署、Secret、Access、DNS、DML 修資料 | 0 |

**結論：0023 已正式套用並對帳通過。** 正式環境 D1 預覽、確認、歷史已可用。剩 G6a（推送 A5-PRE＝部署，需授權）與 G7（使用者預覽後取消）。
