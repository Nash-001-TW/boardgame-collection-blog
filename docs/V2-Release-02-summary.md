# V2-Release-02 — 正式 Cloudflare 環境唯讀核對摘要

更新日期：2026-11-12（Asia/Taipei）。本文件續行並取代前次未能遠端查詢的暫存結論，未另開階段。

**唯讀核對完成；目前有上線 BLOCKER，不可直接部署新版。正式 Migration 0001～0016 為 APPLIED，0017～0022 為 PENDING，未發現 ledger／必要 Schema 衝突。正式 Worker 缺少兩項新版必要 Secret，本帳號 Access Application 清單為空。未執行任何遠端寫入。**

## 1. 登入恢復與目標身份

- 前次預設 OAuth 已過期；本次本機登入紀錄已更新，到期時間為 2026-11-12T02:16:58.859Z。本代理未執行 login 或刷新 Token；GET /user 與 /accounts 成功，確認認證可用及一個可見帳號，不保存或輸出個人身份。
- 正式 Account ID（遮蔽）：`0994e9…24d96a`。先取得帳號，再以指定 D1 ID 的 GET Metadata 確認名稱與所屬帳號，最後確認 Worker 設定；沒有任意選擇不明環境。
- Worker：`boardgame-collection-blog`，遠端確認存在。
- D1：`boardgame-collection-db`，ID（遮蔽）`59e9a1…14e395`；Worker 的 DB 綁定與本機設定 ID 完全一致。
- 本機設定檔：`D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/wrangler.json`。本機未固定 account_id、未宣告命名 env，也沒有 D1／KV Preview ID。
- 正式服務 Metadata：default environment 為 `production`，回應中僅列出此環境。此次只存取上述正式 D1，未存取 Preview D1。

## 2. 正式 Worker 綁定與部署版本

| 名稱／設定 | 遠端結果 | 與本機預期比較 |
| --- | --- | --- |
| DB | d1；指向已確認的正式 DB | PASS，一致 |
| SESSION | kv_namespace；ID 僅作記憶體比對 | PASS，一致 |
| ASSETS | assets 綁定存在 | 名稱／類型相符；優先路由設定 UNKNOWN |
| IMAGES | images 綁定存在 | PASS，名稱／類型相符；未呼叫 Images 服務 |
| NOTBGG_WRITE_LIMITER | ratelimit，namespace 12071、30 次／60 秒 | PASS，一致 |
| compatibility_date | 2026-10-01 | PASS，一致 |
| compatibility_flags | nodejs_compat | PASS，一致 |
| 一般環境變數 | settings.bindings 未列出 plain_text 類型 | 本機 Wrangler 亦未宣告 vars；不讀取任何值 |

目前部署為 **version 18**，版本 ID `9cf8a910-8a97-4746-b9b5-5326ae9496f6`，流量 100%；部署 ID `e0328c7c-0f59-4690-80ff-d4c71342d483`，時間 2026-11-09T07:28:10.7367Z，來源 wrangler。版本詳細 Metadata 顯示 fetch handler。

這是現行正式版本證據，不能證明它包含尚未部署的 V2-P1-07 本機程式。未下載 Worker 原始碼、未讀 Secret 值、未重新建置、未部署。settings／active version／script-settings 的已取得回應未提供足夠的 Assets run_worker_first 設定，因此不推定它與本機相同。

## 3. Secrets 存在狀態

先核對實際程式引用：Access 為 src/lib/auth/admin-request.ts 及 src/lib/auth/cloudflare-access.ts；BGG 同步為 src/lib/bgg-admin-api.ts；可信任組件為 src/lib/physical-component-admin-api.ts，卡套與公開組件查詢亦引用同一簽章金鑰。

| 名稱 | 正式結果 | 證據／限制 |
| --- | --- | --- |
| PHYSICAL_COMPONENT_SIGNING_KEY | **MISSING** | Worker settings 與 Secrets 名稱清單均未提供；新版可信任來源功能 BLOCKER |
| BGG_API_TOKEN | **MISSING** | Worker settings 與 Secrets 名稱清單均未提供；新版伺服器端同步 BLOCKER |
| ACCESS_TEAM_DOMAIN | PRESENT | secret_text；只確認名稱，不驗證值 |
| ACCESS_AUD | PRESENT | secret_text；只確認名稱，不能與 Application audience 比對 |
| ADMIN_EMAIL | PRESENT | secret_text；不讀取或輸出身份 |

Secret 名稱存在不代表值有效。未呼叫 BGG API 或使用認證驗證 Admin 登入；缺少 runtime BGG 綁定也不等於已證明舊版所有同步方式失效。LOCAL_ADMIN_DEV 是開發用途，不能代替正式 Access 設定。

## 4. D1 Migration ledger 與 Schema

第一個 D1 SQL 是單一 SELECT，僅列出 sqlite_schema 的 type、name、tbl_name、sql。從實際 Schema 發現 Migration 表 `d1_migrations`，先用 PRAGMA table_info 確認 id／name／applied_at，再 SELECT name、applied_at 取得紀錄；沒有事先假設表名或查任何業務資料。

| Migration | 狀態 | 正式 applied_at（原值） | 結構證據 |
| --- | --- | --- | --- |
| 0001_sleeve_management.sql | APPLIED | 2026-10-13 07:03:23 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0002_normalize_sleeve_sizes.sql | APPLIED | 2026-10-14 02:56:00 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0003_sleeve_size_validation.sql | APPLIED | 2026-10-14 02:56:00 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0004_collection_management_upgrade.sql | APPLIED | 2026-10-14 03:29:53 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0005_collection_item_metadata.sql | APPLIED | 2026-10-14 03:34:23 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0006_collection_component_quantity.sql | APPLIED | 2026-10-16 01:37:56 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0007_v2_core_schema.sql | APPLIED | 2026-10-19 03:12:16 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0008_v2_purchase_costs.sql | APPLIED | 2026-10-19 03:26:51 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0009_v2_purchase_integrity.sql | APPLIED | 2026-10-19 05:42:41 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0010_v2_copy_conditions.sql | APPLIED | 2026-10-19 06:02:34 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0011_v2_sleeve_management.sql | APPLIED | 2026-10-19 06:34:13 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0012_v1_to_v2_migration.sql | APPLIED | 2026-10-19 07:26:49 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0013_v2_record_scope.sql | APPLIED | 2026-10-19 08:34:18 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0014_notbgg.sql | APPLIED | 2026-11-05 03:18:40 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0015_notbgg_collection.sql | APPLIED | 2026-11-05 03:18:40 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0016_notbgg_link_commands.sql | APPLIED | 2026-11-05 03:18:40 | 最終必要 Schema 相符；資料轉換結果未讀取 |
| 0017_physical_components.sql | PENDING | — | 無 ledger 紀錄；新增物件／欄位無同名衝突 |
| 0018_sleeve_admin.sql | PENDING | — | 無 ledger 紀錄；新增物件／欄位無同名衝突 |
| 0019_collection_copy_commands.sql | PENDING | — | 無 ledger 紀錄；新增物件／欄位無同名衝突 |
| 0020_sleeve_requirement_applications.sql | PENDING | — | 無 ledger 紀錄；新增物件／欄位無同名衝突 |
| 0021_purchase_and_copy_admin.sql | PENDING | — | 無 ledger 紀錄；新增物件／欄位無同名衝突 |
| 0022_bgg_sync_and_relations.sql | PENDING | — | 無 ledger 紀錄；新增物件／欄位無同名衝突 |

- Ledger 共 16 筆，0001～0016 檔名與本機完全相符，無重複、無中間版本缺口，無額外不明版本。
- 依本機 SQL 做**純文字結構分析**，追蹤 CREATE／ALTER／DROP／RENAME 及 0004、0015 的表重建，不執行 Migration 或串接測試。與正式 sqlite_schema 比對的 **148 個最終必要物件全部相符**，包含表、顯式索引、View、Trigger；表欄位宣告、預設值、CHECK、UNIQUE、FK 等亦納入比對，忽略空白、註解及識別字引號等格式差異。
- 另讀取 39 個業務資料表的 table_info／foreign_key_list／index_list Metadata；沒有 SELECT 任何業務列，也沒有執行 foreign_key_check、資料內容檢查或完整匯出。額外物件僅見 _cf_KV 與 d1_migrations，非與新 Migration 同名的業務物件。
- APPLIED 表示 ledger 存在且必要結構相符；**不證明過去資料轉換的結果完整、原 SQL 內容與當年完全一致或既有業務資料沒有問題**。0002、0012 等含資料操作的 Migration 尤其僅核對 ledger 與相關結構，不讀取其資料結果。
- CONFLICT：未發現。UNKNOWN：本次 22 個版本的 ledger／必要 Schema 分類無 UNKNOWN；歷史資料轉換效果仍未驗證，不能擴大解讀。

## 5. 0017～0022 實際待執行清單

下列皆為 PENDING；新建物件、ADD COLUMN 目標均未存在，未發現同名結構衝突。數量來自逐一核對本機 SQL，不僅依檔名推定。

| 檔案（建議順序） | 新物件數 | 新欄位數 | 同名衝突 |
| --- | ---: | ---: | --- |
| 0017_physical_components.sql | 11 | 4 | 無 |
| 0018_sleeve_admin.sql | 3 | 1 | 無 |
| 0019_collection_copy_commands.sql | 3 | 0 | 無 |
| 0020_sleeve_requirement_applications.sql | 7 | 1 | 無 |
| 0021_purchase_and_copy_admin.sql | 3 | 5 | 無 |
| 0022_bgg_sync_and_relations.sql | 9 | 11 | 無 |

核對重點：0017 來源表／證據 View／不可變保護與版本欄位；0018 卡套版本／command receipts；0019 副本 receipts；0020 套用 requirement_id／關聯驗證與需求凍結；0021 採購受控狀態／副本狀況欄位；0022 BGG 快取／同步控制與遊戲關聯防護。既有必要基礎表已存在且相符。

這是待執行範圍，**不是執行授權**。ADD COLUMN 不可任意重跑，0022 也有新控制表初始化 INSERT。未執行 SQL 腳本、DDL、DML、交易或 Migration。後續若實際 ledger／Schema 已變更，必須重新核對；若發現差異即停止，不補寫 ledger 或直接重跑。

## 6. Cloudflare Access

- GET 帳號層級 Access Application 清單成功，結果為 **0 個**，非權限不足或未查詢。可見 zone 清單亦為空；沒有可核對的 zone 路由或 zone Application。
- 此帳號沒有查得可覆蓋正式 workers.dev Admin 的 Application；沒有 Application ID 可進一步查 Policy，因此 Policy／Audience／受保護路徑對應不存在可驗證的 Application，不能列為 PASS。
- **BLOCKER：缺少已確認的 Access Application 保護**。Worker 有 ACCESS_* 與 ADMIN_EMAIL Secret 名稱，仍不能代替雲端 Application／Policy。
- 本機程式會驗證 JWT，但本次沒有對現行正式 Admin 頁面送請求或登入，不能斷言現行 Worker 可被未授權讀寫，也不能聲稱現行 JWT 防護已通過。後續必須分別核對 /admin、/admin/*、/api/admin、/api/admin/* 與所有可存取的網域入口。
- 因 ACCESS_AUD 為 Secret，本次未讀其值，audience 是否正確仍為 UNKNOWN；未列出任何管理員個人資料。

## 7. 網域、路由與動態頁面

| 項目 | 遠端結果 |
| --- | --- |
| workers.dev | enabled=true |
| Preview URL | previews_enabled=true；未開啟 Preview 網址或存取 Preview D1 |
| 正式可用 Worker URL | https://boardgame-collection-blog.nash0710-001.workers.dev |
| 對應 Admin URL | 上述網域的 /admin（只是 Metadata 推導 URL，未操作驗證） |
| Custom Domains | 完整清單未查得指向此 Worker 的項目 |
| Zones／Worker Routes | 帳號 zone 清單為空，無可查得的 zone route；不推定帳號外代理或 DNS 狀態 |
| /games/bgg/ 與 /en/games/bgg/ | URL 層級可屬同一 Worker，但 Metadata 無法證明現行版本有此路由或可用；狀態 UNKNOWN |

沒有查得同帳號 zone Route 覆蓋或自訂網域指向衝突，但不能據此宣告所有站外代理與入口均已排除。Preview URL 是需一併確認 Access 保護的額外入口。ASSETS 綁定存在，但 run_worker_first 的正式值未取得；新版動態路由的實際驗收留待獲准部署後執行。

## 8. BLOCKER／WARNING／PASS

### BLOCKER — 新版上線前必須解決

1. PHYSICAL_COMPONENT_SIGNING_KEY 為 MISSING。另行授權設定前須確認是否存在需保留的歷史金鑰／可信任來源，不得任意輪替；本次未讀來源資料。
2. BGG_API_TOKEN 為 MISSING，新版 runtime 同步所需設定不足。
3. 帳號 Access Application 清單為空，無法提供可核對的 Admin 網域／路徑／Policy 保護；workers.dev 與 Preview 入口均需納入。
4. 新版所需 Migration 0017～0022 尚未套用；不得先部署依賴這些欄位／物件的功能。

### WARNING — 後續須明確確認

- 正式 version 18 與本機 V2 基線沒有可證明的程式版本對應，不能視為新版已部署。
- ACCESS_* 名稱存在但值／Audience 正確性 UNKNOWN；未進行真實登入與授權驗收。
- Assets run_worker_first 及新版 BGG 中英文路由實際運作 UNKNOWN。
- 未設定此 Worker 自訂網域；若既定方案使用 workers.dev，並非單獨的部署阻礙。
- 歷史資料轉換結果、資料層外鍵一致性與金鑰連續性未查詢，不能以 Schema 比對推定通過。

### PASS — 有遠端唯讀證據

- 登入可用，實際 Account／Worker／正式 D1 目標確認。
- DB／SESSION 與本機資源一致，ASSETS／IMAGES／限流綁定存在，限流及相容設定一致。
- 正式部署版本、production 環境、workers.dev／Preview 開關已取得 Metadata。
- 0001～0016 ledger 與必要 Schema 相符；0017～0022 未記錄且無新增物件／欄位同名衝突。

## 9. 建議後續順序（Release-03 需另授權）

1. 先處理本報告 BLOCKER 的具體方案，審核 Access 的正式與 Preview 網域覆蓋；不以本次唯讀授權修改資源。
2. 另獲正式 D1 備份／Export 及私人保存授權後，備份並確認可用。
3. 另授權建立必要 Secrets 與設定 Access／Policy；核對 Audience，保留可能既有簽章金鑰的連續性；如不需 Preview 應另審核是否停用，不能自行修改。
4. 臨執行前再核對 ledger／Schema，另授權僅套用 0017 → 0018 → 0019 → 0020 → 0021 → 0022；有任何差異則停止，不重跑已套用版本。
5. 使用正確正式綁定重新建置，檢查 Secrets 未進入產物與 Assets 優先路由，再另獲部署 Worker／Assets 授權。不得部署 Release-01 合成綁定產物。
6. 另授權正式公開路由與 Access 驗收，包含新 BGG 中英文頁、舊 slug、未登入／非管理員／管理員、workers.dev 與 Preview 入口。
7. 真實 BGG API／快取寫入及主要 Admin 寫入驗收，各依明確測試資料與範圍另外授權；本次不執行。

## 10. 命令、API 與操作次數

本次使用本機 Node HTTPS fetch，認證只在記憶體讀取並用於 Authorization header；不使用會自動刷新認證、建立 Session、初始化 ledger 或部署的 CLI／SDK。GET 與唯一例外 D1 query POST 均固定 API 路徑；D1 每次只送一個經審閱的 SELECT 或白名單唯讀 PRAGMA，無參數設定、子查詢繞過或多語句。

| 實際 Cloudflare API 路徑（識別碼遮蔽） | 成功次數 |
| --- | ---: |
| `GET /user` | 1 |
| `GET /accounts` | 2 |
| `GET /accounts/{account}/d1/database/{database}` | 1 |
| `GET /accounts/{account}/workers/scripts/boardgame-collection-blog/settings` | 1 |
| `GET /accounts/{account}/workers/scripts/boardgame-collection-blog/secrets` | 1 |
| `GET /accounts/{account}/workers/scripts/boardgame-collection-blog/deployments` | 1 |
| `GET /accounts/{account}/workers/scripts/boardgame-collection-blog/versions` | 1 |
| `GET /accounts/{account}/workers/services/boardgame-collection-blog` | 1 |
| `GET /accounts/{account}/workers/subdomain` | 1 |
| `GET /accounts/{account}/workers/scripts/boardgame-collection-blog/subdomain` | 1 |
| `GET /accounts/{account}/workers/domains` | 1 |
| `GET /zones` | 1 |
| `GET /accounts/{account}/access/apps` | 1 |
| `POST /accounts/{account}/d1/database/{database}/query` | 120 |
| `GET /accounts/{account}/workers/scripts/boardgame-collection-blog/versions/9cf8a910-8a97-4746-b9b5-5326ae9496f6` | 1 |
| `GET /accounts/{account}/workers/scripts/boardgame-collection-blog/script-settings` | 1 |

成功 GET 共 **16 次**；D1 唯讀 POST 共 **120 次**：SELECT 2 次（Schema、Migration ledger），table_info 40 次（39 表加 ledger），foreign_key_list 39 次，index_list 39 次。所有成功 API 回應為 HTTP 200。另有最初 GET /user 的 **1 次本機網路失敗嘗試**，無 HTTP 回應；取得已授權連線能力後重試成功。合計 137 次網路嘗試、136 次取得成功回應。

| 操作 | 本次及本階段累計 |
| --- | ---: |
| Wrangler CLI（login、whoami、d1 execute、migrations list 等） | 0 |
| 已成功 Cloudflare GET | 16 |
| D1 唯讀 SQL POST | 120 |
| 其他 Cloudflare POST／所有 PUT、PATCH、DELETE | 0 |
| Preview D1 存取 | 0 |
| 遠端資料／設定寫入、Secrets／Access／綁定修改 | 0 |
| 備份／Export、Migration、部署／發布 | 0 |
| 真實 BGG API、Build、Migration 串接測試、UI 驗證 | 0 |

前次停止時遠端操作為 0，故累計與本次相同。只更新既有 docs/V2-Release-02-summary.md；查詢與靜態比對輔助檔放在專案外工作區，不變更應用程式、Schema、Migration 或認證。保留的證據只含必要 Metadata 摘要、SQL 類型／目標與計數，不保存 Token、Secret 值、個人資料或完整回應。

本次核對完成後停止，交由 ChatGPT 驗收。沒有備份、套用 Migration、設定 Secrets、修改 Access、部署或進入 Release-03。
