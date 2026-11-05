# D-7A：NotBGG V1.2 上線前審查與部署預演

最新 R4：[0003 編碼修正與隔離驗證](./notbgg-d7a-r3-stability.md#d-7a-r4-更新0003-bom-編碼相容修正2026-11-04)。僅移除 0003 的 EF BB BF，494→491 bytes，新內容嚴格等於原內容去掉前三 bytes，換行／SQL 不變；其他 0001～0016 檔案皆未改。使用專案 migrations 目錄（非臨時 SQL 副本），真實 Wrangler 的空庫 0001→0016 與已登記 0013→0016 均 PASS，再套用不重跑，Trigger／索引／FK／0015 封存與 D-6 流程 PASS。**F4 本機重播阻擋已解除**；下方原 F4 FAIL 及 R3 文字保留作歷史。正式狀態／備份還原與高 BODY CLS 仍未驗證，整體 NO-GO。

R3 歷史補充（F4 結論已由上方 R4 更新）：[D-7A-R3 穩定性與空庫重播調查](./notbgg-d7a-r3-stability.md)。已修復結果數量補字造成的小 CLS（10 次後測為 0），但早期 BODY 高位移仍 NOT VERIFIED；0003 的 BOM／Wrangler 分段根因已確認，歷史原檔未改，原檔 CLI 空庫重播仍 FAIL。0013→0016 升級獨立 PASS；全套回歸更新為 305／305，整體仍 NO-GO。

## D-7A-R：F1 Worker-first 別名修補（2026-11-04）

**F1 在本機 production-compatible 驗證範圍已解除；正式部署尚未執行／驗證。整體仍 NO-GO，其他阻擋事項不變。** 本輪未修改 0014／0015／0016，特別保留上輪 0015 的修補。

根本原因有兩層：原 gateway 的 regex 僅匹配 `/[en/]games/<slug>`，因此 `.html` 不會匹配已知 slug，`/index.html` 則連路徑都不匹配；handler 繼續從真實 ASSETS 送出舊 BGG HTML。此外 ASSETS 會正規化 percent-encoding／斜線，而既有 Worker-first 選擇路徑不涵蓋編碼前綴，例如 `/%67ames/...`、`/games%2F...`。實際修補前 loopback HTTP 已觀察前者直接 200 舊 BGG HTML，後者進 ASSETS 正規化 307 時 Worker 根本未執行。

最小修補：

- `src/lib/bgg-identity-gateway.ts`：GET／HEAD 路徑解碼一次並收斂重複斜線；只解析白名單中真實 BGG slug，支援 `.html`／`index.html` 及尾斜線；優先比對真正的原始 slug（避免吞掉真的 `.html` slug）。NotBGG primary 直接 307 到該語言主要頁；其他實體／編碼別名 307 到原 BGG 標準網址。query 保留、no-store、無永久 301，之後原有靜態供應與 canonical rewrite 維持不變。
- 本機候選 `wrangler.json` 保留 `/games/*`、`/en/games/*`，新增 `/*%*`、`//*`、`/en//*`，讓編碼／重複斜線也先進 Worker。這是尚未部署的 repo 設定修改，沒有修改正式 Cloudflare 設定。一般 CSS／JS／圖片仍 asset-first；有 percent-encoding 的資產會進 Worker 再原樣交給 handler／ASSETS，0 D1，沒有改為所有 BGG 頁 SSR。
- `tests/helpers/d7a-built-preview.ts` 增加真實 loopback HTTP 入口；`tests/bgg-static-alias.test.ts` 使用 production entry/chunks、實際 dist/client ASSETS、與候選設定相同的 Worker-first 規則及全新隔離 D1，沒有 mock handler／HTML。
- `tests/d7a-preflight.ts` 保留 F1 與上次 Migration 修補證據；更新本文件與 `d7a-local-evidence.json`。臨時編碼探測 runner 已移除，不保留完整封包或圖片。

實際 HTTP 前後（zh／en 皆測；Location 同源且保留 query）：

| 狀態／路徑 | 修補前 | 修補後 |
| --- | --- | --- |
| NotBGG primary：`/games/santorini.html` | 200 舊 BGG，無 primary canonical | 307 → `/games/notbgg/000001` → 200，唯一正確 canonical |
| NotBGG primary：`/games/santorini/index.html` | 200 舊 BGG，無 primary canonical | 同上 |
| NotBGG primary：`/en/games/santorini/index.html` | 同一 matcher 缺口 | 307 → `/en/games/notbgg/000001` → 200 |
| `%73antorini%2Ehtml`／`santorini%2Findex.html` | 實測 200 舊 BGG | Worker 先解析，307 到主要來源 |
| 編碼路由前綴 | 實測先由 ASSETS 307 正規化，Worker 未執行 | 每一步都先進 Worker，直接指向主要來源 |
| 未對應／候選／BGG primary／解除／NotBGG 封存 | 實體別名可能跳過 gateway | 別名 307 → BGG 標準頁 200，原靜態內容與單一 canonical 保留；標準頁／尾斜線正常 |
| NotBGG 封存頁 | 原標準路徑規則 | 中英文 404，不作為 BGG alias 導向目標，不輸出備註 |
| 一般 CSS／JS／favicon | ASSETS | 200，bytes 與 dist/client 相同，Worker 未執行、0 D1 |
| 編碼 CSS／JS／favicon | 既有資產處理 | 200，bytes 相同，Worker 執行但 0 D1 |

回歸涵蓋兩語言、尾斜線、`.html/`、`index.html/`、編碼 slug／副檔名／前綴／分隔符、重複斜線、HEAD、query、候選／確認／兩個 primary／解除／封存、無效與雙重編碼路徑、無 Schema 時安全 503，以及 CSS／JS／圖片位元組與查詢次數。完整 HTTP 驗證為 **210 個狀態／方法／路徑情境**，證據只保留代表性 headers／canonical，不存完整 HTML。

本輪全套 **300／300 PASS**（28 個測試檔，含新 F1 父測試＋9 子測試）；TypeScript strict PASS，Astro check 0 errors／0 warnings／13 hints；直接 Astro production build PASS，未執行 npm 的資料初始化 prebuild。D-6 桌面／手機 PASS；C-1／C-2／C-3 分別 11／4／5 項 PASS；D-7A 36 個請求檢查與桌面／手機功能 PASS，CLS 0.00954、LCP 3628 ms（本機合成圖片條件，早期高 shift 仍保留待釐清）。最新結果見驗收表／JSON；C runner 第一次因漏載 tsx 在 setup 失敗，使用 `node --import tsx` 正確命令重跑，不視為產品失敗。

正式尚待確認：實際 Worker version、發佈時是否包含相同 ASSETS／新增選擇規則、正式 CDN Cache Rules／hostname／Access；本機通過不代表已修正線上資源。這是可部署候選的本機 F1 修復驗證，不是部署授權。

## D-7A-R 修訂：直接修補未發布的 0015（2026-11-04）

使用者明確確認 0014～0016 尚未部署／套用任何遠端 D1，並授權直接修改 0015，取代初審提出的另開 Migration 方案。檢查本機 `.wrangler/state/v3/d1` 的 SQLite 僅讀 Schema，沒有 NotBGG／site_game_relations 物件；已知 D 階段測試使用 mkdtemp 隨機身份與目錄，測後清理，未發現其他共用持久化環境設定。這是「使用者環境確認＋可見本機檢查」，不是聲稱已盤點所有外部環境；沒有連線遠端。本輪只在新隔離資料庫重播，既有任何已套用的本地庫都不會因修改 SQL 檔自動變更。

直接在 `migrations/0015_notbgg_collection.sql` 重建表與索引後補回 `site_game_relations_no_delete BEFORE DELETE ON site_game_relations`，以 RAISE(ABORT) 要求使用封存。只保護該關聯表的硬刪除，不攔截 INSERT／UPDATE；0014、0016 與其他 Migration 未變動，沒有建立 0017。

**F2 已修復並經隔離回歸驗證，不再是上線阻擋項。** 新增 `tests/notbgg-relation-retention.test.ts` 驗證 pre-0015 無 audit FK 舊關聯、修補後新關聯、合法封存、一般編輯、外鍵、修訂／稽核保留與 batch 失敗回滾。詳細結果及最新 D-7A 證據見下方與 `d7a-local-evidence.json`。其他 F1／F3／F4／F5 與正式基線／版本／備份阻擋並未因此解除。

本次驗證：27 個測試檔共 **290／290 PASS**；其中 D-5／D-6／新增 retention 的 focused suite **34／34 PASS**（retention 父測試＋6 子測試）。TypeScript strict PASS。D-5 與 D-6 桌面／手機瀏覽器 PASS；D-7A 真實建置 Worker 的 36 個請求檢查完成，舊關聯 DELETE guard 由 FAIL 改為 PASS，24→48→818、Grid/List、mobile CLS 0.00954／LCP 3620 ms，使用原 150 ms latency／200000 bytes/s／合成圖片條件，非正式 Edge 效能。此次未改前端或 bundle，使用 D-7A 既有 production 產物；沒有把原 Astro check／build 記錄宣稱為本次重新建置。

實際 Wrangler 在新建合成 0013 native baseline 後，0014／修補 0015／0016 皆套用成功並有 d1_migrations 記錄（含 CLI 啟動約 5.6／6.2／6.4 秒）；帶舊關聯的升級、資料保留、FK 與原子性則另由 retention 測試直接驗證。新程式碼檔只有該測試；變更檔案為 0015 SQL、D-5／本文件與更新的本機 JSON 證據。

審查日期：2026-11-04。**結論：NO-GO，正式上線 BLOCKED。** 本文件完成審查交付，不代表正式環境驗收通過。沒有執行遠端查詢、備份、Migration、寫入、部署或 Cloudflare 設定變更；不開始 D-7B。

本機證據：[d7a-local-evidence.json](./d7a-local-evidence.json)。該檔包含完整未提交清單、Schema 差異、逐次請求與合成測試結果；沒有購買明細、Token 或 Secret 值。初審只新增本報告、該 JSON 與 `tests/d7a-*`、`tests/helpers/d7a-built-preview.ts`，未修正應用程式或 Migration；D-7A-R 的授權修補及新增檔案另見首節。

## 1. Git 與版本基線

| 項目 | 結果 |
| --- | --- |
| Branch | `main` |
| HEAD | `469866d6f7e3aed947f9f1c2e0d59b9cc16961a2` |
| HEAD 說明 | `2026-10-21 feat: migrate collection pages to Cloudflare D1 V2 by ChatGPT` |
| 可部署的 D-6 Commit | **BLOCKED**：D 階段主要檔案仍未提交，HEAD 不能代表此次測試的程式 |
| 正式 Worker／回滾 Commit | **NOT VERIFIED**：沒有取得正式部署版本與來源對照 |
| 工作目錄 | 大量既有 modified／added／untracked；完整路徑列於 JSON `inventory.git.status`；沒有自動提交或推送 |
| lockfile | v3；package.json 的根依賴規格與 lockfile 相符，已安裝頂層版本一致；未重新安裝套件 |

D-0～D-6 的工作目錄內容包含：身份與驗證契約／共用顯示模型、0014 儲存與修訂、Access 管理 API／表單、公開 SSR／目錄合併、0015 收藏與站內關聯、0016 身份對應及可逆別名。相關文件為 `docs/notbgg-d1-contract.md` 至 `docs/notbgg-d6-identity.md`；由於沒有各階段獨立提交，無法從 Git 精確證明每階段的歷史邊界。

主要版本：Node 24.21.0、Astro 7.3.4、Cloudflare Adapter 14.3.4、Vite Plugin 1.63.1、Wrangler 4.149.0、Miniflare 5.20261006.1-alpha、TypeScript 6.0.3、jose 6.2.12。Miniflare 是 alpha 版本，正式 runtime 行為仍須部署後唯讀 Smoke Test。

`inventory.workingTreeSourceSha256` 是來源樹快照指紋，不能取代 release Commit。`src/data/bgg-collection-cache.json` 是存在但未追蹤的建置輸入，正式產物重現方案須納入其來源與受保護的輸入清單，不得把私人資料或 `.dev.vars` 一併提交。

驗證結果：

| 檢查 | 結果與界線 |
| --- | --- |
| 全部自動化測試 | **PASS**：原 D-7A 26 檔 283／283；0015 修補 27 檔 290／290；F1 修補 28 檔 300／300，含 D-1～D-6、A-2／A-3 與 C 階段相關單元／整合回歸 |
| TypeScript strict | **PASS**：`tsc --noEmit`；沿用 strict 設定 |
| Astro check | **PASS**：0 errors、0 warnings、13 hints（既有未使用／deprecated 提示） |
| Production build | **PASS**：直接執行 Astro production build，保留 BGG 靜態產物與動態路由；沒有部署 |
| npm prebuild | **NOT VERIFIED**：為避免自動 `wrangler types`／資料初始化，本輪沒有執行 npm lifecycle prebuild；不將直接 Astro build 宣稱為整條 npm 發布流程已通過 |
| C-1／C-2／C-3 瀏覽器 | **PASS**：本輪分別 11／4／5 項；24→48→815、815 個唯一項目、ID 搜尋、返回與焦點等 |
| D-7A 真實建置瀏覽器 | 功能 **PASS**：24→48→818、Grid/List、桌面與手機無水平溢出／pageerror；視覺效能見第 7 節 |

本輪沒有重做正式站點的管理登入或正式寫入驗收。所有授權成功案例沿用本機合成 JWT 測試，未加入正式驗證繞過機制。

## 2. Cloudflare 設定盤點

來源：`wrangler.json`、`astro.config.mjs`、`src/worker.ts`、`src/middleware.ts`、產生的 `dist/server/entry.mjs` 與 ASSETS。

| 設定名稱 | 本機候選設定 | 正式資源狀態 |
| --- | --- | --- |
| Worker | `boardgame-collection-blog`；entry `./src/worker.ts` | NOT VERIFIED |
| compatibility | `2026-10-01`、`nodejs_compat` | NOT VERIFIED |
| ASSETS | `dist/client`；binding `ASSETS` | NOT VERIFIED |
| Worker-first | `/games/*`、`/en/games/*` | NOT VERIFIED；本機測試見第 3 節 |
| D1 | binding `DB`；名稱 `boardgame-collection-db` | 設定值存在，尚未與遠端核對 |
| D1 ID | `59e9a17a-ff0f-494e-aab9-dd903a14e395` | 只代表檔案中的目標，不代表已確認的正式身份 |
| KV | `SESSION` 存在 | NOT VERIFIED |
| Images | `IMAGES` 存在 | NOT VERIFIED |
| R2 | 未設定 | NOT VERIFIED |
| Rate Limiter | `NOTBGG_WRITE_LIMITER` 在程式中為 optional，設定檔未配置 | NOT VERIFIED；不可宣稱具備正式限流 |
| env／Preview DB | 未定義獨立 env 或 preview_database_id | Preview／Production 分離 NOT VERIFIED |
| Route／custom domain | 設定檔未列出 | NOT VERIFIED |
| vars | 設定檔未列出 | NOT VERIFIED |

本地 `.dev.vars` 的名稱只有 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ADMIN_EMAIL`、`BGG_API_TOKEN`、`LOCAL_ADMIN_DEV`；`.env` 含 `BGG_API_TOKEN`。沒有列出值。正式 Secret 名稱與是否存在均 **NOT VERIFIED**，不能以本地檔案替代正式設定。公開 `dist/client` 掃描沒有發現這些本地敏感值；server 建置目錄／`.dev.vars` 不應當成公開資產上傳。

本輪 Miniflare 完全不載入上述 DB/KV 實際資源身份、環境檔或憑證；使用隨機本地 DB/KV、合成 Access 設定及禁止 outbound 的 runtime。Wrangler 預演另建臨時設定、移除 CF 憑證環境變數並改用臨時 XDG_CONFIG_HOME，只允許 `--local`，測後清理。因此本輪本地測試隔離 **PASS**；實際 Preview／Production 資源隔離仍未確認。

## 3. Worker-first 與永久網址

使用真實 production `entry.mjs`、全部實際 server chunks、真實 `dist/client` ASSETS、原設定的 Worker-first 路徑。Miniflare 明確指定有 user Worker，避免測試器把應用程式誤視為純靜態站。測試用攔截層只記錄 D1 次數／耗時，不替換應用程式身份判斷。

| 案例 | 本機結果 |
| --- | --- |
| `/games`、`/en/games` | **PASS**：SSR 200、no-store；新增 NotBGG 不需重建便由 815→818 |
| 中英文 `/games/notbgg/000001` | **PASS**：Worker 動態 200；主要來源改 BGG 後 307 |
| BGG `/games/santorini` | **PASS**：未對應時供應既有靜態內容，經 Worker 加入 canonical；NotBGG primary 時 307 到 NotBGG |
| BGG slashful URL | **PASS**：`/games/santorini/` 經身份解析 |
| 解除對應 | **PASS**：兩邊回復獨立 200；目錄 817→818 |
| 候選 | **PASS**：不去重，仍為 818 |
| 307／循環 | **PASS**：正常中英文來源切換為 307，非 301；追蹤 Location 可到主要 200，無循環 |
| 封存 | **PASS（已測標準路徑）**：NotBGG 詳細頁 404，不輸出管理資料 |
| 物理 HTML 別名 | **PASS（D-7A-R 本機修復）**：真實 Worker／ASSETS HTTP 回歸通過，正式尚未部署 |
| 正式 canonical 網域／hreflang | **NOT VERIFIED**：測試 origin 為 `https://d7a.invalid`，不能代表正式網域 |

**F1：物理 HTML 網址繞過身份判斷。** 已確認 NotBGG primary 時，`/games/santorini/index.html` 與 `/games/santorini.html` 都回傳 200 舊 BGG HTML，沒有主要來源 canonical。Worker 確實執行，但 `src/lib/bgg-identity-gateway.ts` 只辨識單一標準 slug；之後的 ASSETS fallback 仍可送出靜態頁。這使「設定了 run_worker_first」不足以證明所有舊網址均安全解析。

負對照關閉 Worker-first 時，`/games/santorini` 的 307 是 ASSETS 導向 `/games/santorini/`，然後直接 200 靜態頁；不是身份別名導向。不能只驗證 HTTP 307，必須核對 Location 與最終內容。

以上為初審重現，D-7A-R 已依首節方案完成最小修補與實際 HTTP 回歸；沒有改成全站 BGG SSR，也沒有改正式資源。負對照關閉 Worker-first 仍會繞過 gateway，證明正確發佈選擇規則是必要部署條件。

正式 canonical 目前依 request origin 組成，應先核對正式 hostname、workers.dev／Preview 索引策略與入口轉址。已測標準詳細頁 primary canonical 正確指向測試主要網址；目錄頁沒有 canonical，已測頁面沒有 hreflang。不存在互相衝突的標籤不等於中英文 SEO 已完成，須在發佈前明確決定並驗證。不得使用不可逆 301。

Cloudflare 的靜態資產可先於 Worker 回應，必須保留 Worker-first 規則並驗證實際產物路徑：[官方路由說明](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)。

## 4. 正式 D1 唯讀盤點

**NOT VERIFIED。** 現有 Wrangler OAuth 到期時間為 `2026-10-27T01:43:36.851Z`，審查日已過期，且沒有可用的 API Token 環境設定。本輪只讀取憑證「存在與到期」資訊，未輸出／使用 Token，未重新登入或更新授權，沒有呼叫遠端 API。

以下均未知：正式帳號／DB 身份核對、目前已套用 Migration、0014／0015／0016 狀態、實際 V2 Schema、foreign_keys、資料量、collectionId／game_id／bggId 分布、收藏與副本總數、production/test 分布、新表同名衝突。**不得假設 0014～0016 尚未套用。** Repo 中舊 reference 檔只能視為歷史資料，不作本次正式狀態證據。

後續安全方案：由操作者恢復適當授權，先核對 account／database metadata，再透過明確唯讀查詢取得 sqlite_master、存在時的 d1_migrations、PRAGMA foreign_keys／foreign_key_check、各表與 scope 聚合數量、缺失引用計數。只記錄必要的 Schema／聚合與 ID 完整性，不輸出個人購買明細。任何查詢以外操作均另行授權；若 migration tracking 與 Schema 不一致，停止部署，不以刪表或直接補寫狀態處理。

## 5. Migration 預演與資料完整性

正式 Migration 狀態未知，因此本輪是**有條件的合成 0013 基線預演**，不是聲稱已重建正式環境。使用新建本地 D1、合成舊 V2 遊戲／production 收藏／語言副本，再依序套用 0014→0015→0016。

| Migration | Schema 差異與結果 |
| --- | --- |
| 0014_notbgg.sql | 新增 7 表、9 個具名索引及身份／修訂／關聯防護 Trigger；永久流水號、原稿、修訂、子分類、站內關聯、身份對應與操作歷史。原生 D1 batch PASS |
| 0015_notbgg_collection.sql | 新增 `site_relation_events`、`v2_collection_events`、`v2_collection_management`、索引與稽核／revision Trigger；修改 `site_game_relations`；D-7A-R 已直接補回 no-delete Trigger（F2 修復） |
| 0016_notbgg_link_commands.sql | 新增對應操作 gate 與已對應類型 guard 的 2 個 Trigger；原生 D1 batch PASS |

實際 Wrangler Migration manager（4.149.0）也在原生 D1 已建立的合成 0013 基線上逐次成功套用 0014／0015／0016；每次從真實 `d1_migrations` 讀回對應檔名。CLI 呼叫含程序啟動約 8.6／6.8／5.8 秒，不能視為純 SQL 或正式停機時間。該測試基線由 native batch 建立，沒有假稱舊 0001～0013 已經由 Wrangler replay。

**初審空庫完整重播為 FAIL F4（R4 已修復）**：實際 Wrangler 成功 0001／0002 後，舊 0003 的 Trigger 出現 `incomplete input: SQLITE_ERROR`；並未進入 0014。這是目前工具／舊 Migration 重播路徑的相容性問題，不等於 0014～0016 升級失敗，也不能因此假設正式 DB 有問題。處理：在確認正式基線後，只套用已驗證的 pending 升級；另於隔離環境審查 CLI SQL splitter 與舊檔的還原程序，禁止修改舊 Migration 或跳過正式狀態檢查。完整空庫 disaster-recovery 路徑未驗收前，不宣稱可從零安全重建。

**F2：已修復。** 初審確認舊 0015 重建表時遺失 `site_game_relations_no_delete`，導致沒有 event 外鍵的歷史關聯能被硬刪除。依使用者未發布環境確認及本次授權，直接修改 0015 恢復該 Trigger，不新增 0017。全新 0013→0014（建立舊關聯）→0015→0016 後，舊列／新列／已封存列的 DELETE 都被拒絕；合法封存保留身份與事件，批次中先成功的 UPDATE 在後續 DELETE 失敗時回滾。既有修訂／audit 防護與外鍵均通過。本輪沒有修改其他 Migration。

其餘驗證：合成舊 v2_games／collection／owned_copies 的完整物件在升級前後相等，foreign_key_check 無異常；production/test 隔離、同遊戲多收藏、封存保留副本與引用、revision、AUTOINCREMENT／冪等／原子失敗、有效一對一、並行確認等由原 D-7A 283 測試涵蓋，D-7A-R 另加 retention 回歸並重新執行。

AUTOINCREMENT 避免重用已提交的歷史高水位，但不保證連號；回滾的分配可能重用，允許跳號。永久身份與修訂保留仍依 no-delete／immutable Trigger 和原子 Repository；不得宣稱僅靠 AUTOINCREMENT 就保護全部歷史。

## 6. 安全性與快取審查

| 項目 | 本機／程式審查結果 | 正式環境界線 |
| --- | --- | --- |
| Access JWT | **PASS**：jose RS256、JWKS、issuer、audience、exp／iat／sub／email，管理 email 白名單；錯誤不記錄 token／claims | 真實 Access policy、登入與 JWKS 可達性 NOT VERIFIED |
| 頁面與 API 授權 | **PASS**：middleware 與 handler 各自驗證；真實建置匿名請求 401，且 0 D1 查詢 | 正式 Access path coverage NOT VERIFIED |
| CSRF | **PASS**：Origin 必須等於 request origin、`X-NotBGG-Request: 1`、Sec-Fetch-Site 限制 | 正式 hostname／代理入口 NOT VERIFIED |
| 請求驗證 | **PASS**：application/json、串流累計 262144 bytes、32 fields／object、5000 nodes、depth 8、欄位白名單 | 400／401／403／404／409／413／415／429／500 的測試在本地完成 |
| 寫入身份 | **PASS**：actor 取自已驗證伺服器身份；系統欄位由後端維護 | 正式寫入未測且未執行 |
| 冪等／revision | **PASS**：同 key 不同內容衝突、expectedRevision／事件序號保護、失敗原子回滾 | 本地並行 Promise 測試，非跨 Edge 壓測 |
| 公開隱私 | **PASS**：公開白名單、原稿／editorNotes／操作者／修訂不外洩；合成 PRIVATE 標記未出現在 HTML／payload | 正式資料形狀 NOT VERIFIED |
| 管理 API 快取 | **PASS**：no-store、noindex、nosniff；錯誤為安全代碼，無 D1 細節 | 正式 CDN Cache Rules NOT VERIFIED |
| SSR／307 快取 | **PASS（已測標準路徑）**：no-store；不快取身份切換結果 | F1 物理別名繞過；正式 Cache Rules NOT VERIFIED |
| 限流 | **BLOCKED F5，中風險**：候選設定未配置可用 binding；optional 缺失時不具備分散式限流 | 先選定並核准 binding 或 Edge 規則，驗證 429，不可宣稱已有正式限流 |

NotBGG URL 驗證拒絕 javascript／data／含帳密 URL，只允許 http／https；描述安全輸出，沒有伺服器批次下載／代理外部圖片。**HTTP 圖片仍可通過驗證**，在正式 HTTPS 頁可能被升級或阻擋；任意外部 HTTPS 圖片也會向第三方發出使用者請求。這不是已驗證的來源 allowlist。上線前須明確決定 HTTPS-only／來源政策並測試；本輪不擅自變更既有資料契約。圖片 fallback 不代表解決第三方隱私或可用性問題。

## 7. 本地效能預演

以下數值表保留初審樣本作歷史參考；D-7A-R 的最新瀏覽器結果見首節，逐次請求與 Schema 差異以更新後 JSON 為準。本次沒有改前端，不將不同 run 的數值差異宣稱為效能最佳化。

環境：Windows、真實 production Worker／ASSETS、本地 workerd／D1/KV、815 BGG＋3 合成 NotBGG；有效對應時 817 張，解除後 818。非 Astro dev server。數值是本機 instrumented response 含讀取 body，**不是正式 Edge TTFB／延遲 SLA**。逐次紀錄見 JSON `routes`、`performance`；D1 ms 為 statement wall time 合計，平行時不等同 handler 時間。

| 案例 | 代表性本機結果 | D1 次數 |
| --- | --- | --- |
| `/games` 首次／無 NotBGG | 最後一次 82.9 ms，815 筆；D1 合計 11 ms | 2 |
| `/en/games` 首次／無 NotBGG | 最後一次 48.8 ms；D1 合計 8 ms | 2 |
| 已確認對應的目錄，最後三次 warm | zh 45.4／51.0／48.3 ms（D1 7／8／6 ms）；en 51.0／57.5／68.5 ms（D1 9／11／16 ms） | 各 2 |
| BGG 靜態詳細頁 | 約 9～13 ms；加入身份判斷後不再是 0 D1 純靜態回應 | 1 |
| NotBGG 普通詳細頁 | 約 9～13 ms | 2 |
| 配件詳細頁 | 約 13 ms | 3，固定批次，非逐關聯查詢 |
| 307 身份別名 | 約 5～8 ms，body 0 bytes | 1 |
| 目錄 payload | zh 641448 bytes；en 644583 bytes；估算 gzip 約 123071／122575 bytes | 非 wire transfer；HTML 另含首屏卡片 |
| Grid/List | 最後一次 10.8 ms，含自動化操作開銷 | 無新 D1 |
| 載入更多 | 最後一次 101.8 ms，24→48→818 | client 已持有精簡 payload，非逐批 D1 |

沒有觀察到目錄或關聯 N+1；一次目錄 2 查詢，BGG 詳細頁每次身份查詢 1 次是 D-6 的明確新增成本。公開回應 no-store，不使用會讓封存／解除過時的跨請求快取；現行代價是每次 SSR 查詢。更大 NotBGG 資料量／正式 Edge D1 p95 尚未量測。

手機：Edge headless，390×844，cache disabled，150 ms latency、200000 bytes/s（約 1.6 Mbps），Node bridge identity encoding；圖片由合成圖片攔截，沒有本輪真實 BGG 圖片速度驗收。LCP 約 3632 ms、DOMContentLoaded 約 4.6 s；這包含未壓縮 HTML 與本機 bridge，不能推算正式 LCP。

**F3（中風險，視覺穩定性未穩定重現）**：早期 run 的總 shift 0.34796，最大單次 BODY shift 0.33842；因此當次標準 CLS 至少 0.33842。後續使用標準 session-window 記錄得到 CLS 0.00954。不是把早期 lifetime sum 當成標準 CLS，也不是只挑最好一次宣稱通過。BODY 曾從預設 margin 8px 的未套樣式尺寸跳到完整 viewport；首 24 筆 SSR／client key 與 zh-TW collation 完全一致，未證實是排序問題。CSS 實際位於 head、無外部字型；根因仍待確認，最終重測與個別樣本保存在 `mobileHistory`。

建議在相同編碼／節流下固定多次採樣，檢查 CSS delivery／首屏 render，再作最小修正；本輪沒有改 CSS 或應用程式。CLS 以最大 session-window 判斷，良好門檻 0.1：[指標定義](https://web.dev/articles/cls)。正式手機 Core Web Vitals、真實圖片載入、D1 跨區與 CDN 壓縮／快取行為均 **NOT VERIFIED**。

## 8. 備份、上線與回滾計畫（未執行）

1. 人工核對正式 account、DB ID／DB binding、目前 Schema／Migration tracking、scope／收藏／副本聚合與外鍵完整性；保存只含必要聚合的前置 manifest。若狀態衝突，停止。
2. F1 已本機修復、F2 已於未發布 0015 修復；F4 已完成 BOM 修正與專案原目錄重播；釐清 F3，完成限流方案；重新驗證後由操作者建立明確 release Commit 與可重現產物／輸入指紋。記錄正式目前 Worker version ID、對應 Git SHA、ASSETS、bindings、routes、Cache Rules；不匯出 Secret 值。
3. 在受保護位置建立並驗證正式 D1 恢復點／備份。先確認資料庫儲存版本、Time Travel 可用性與保留期，記錄 bookmark／時間；必要時加密匯出並於獲准的受保護環境實際還原驗證，不複製私人資料到一般測試環境或 Git。本輪沒有取得 bookmark 或執行備份。Cloudflare 的 Time Travel 依方案提供有限保留期，不是永久備份：[官方說明](https://developers.cloudflare.com/d1/reference/time-travel/)。
4. 約定寫入維護窗口、停止／恢復寫入責任人、故障通報與中止條件。盤點 D-3～D-6 寫入是否已啟用，不能只關閉前端按鈕。
5. **先資料庫相容升級，再部署依賴新表／gate 的 Worker。** 依使用者確認，D 階段尚未套用遠端；實際執行前仍核對 tracking／Schema，只依序套用確定 pending 的 0014→修補後 0015→0016，不新增 0017。若發現已有環境套用舊版，停止，不能靠重跑 SQL 檔更新既有庫。不得刪表或以測試寫入探查正式狀態。Migration tracking 的實際表名須核對：[官方 Migration 說明](https://developers.cloudflare.com/d1/reference/migrations/)。
6. 另經明確授權才部署 Worker，保留 Worker-first 與 ASSETS 整合；不得只發布 dist/client。先確認 hostname／canonical／Access／limiter／Preview 不指向正式 DB，禁止把測試憑證、資料或本地 `.dev.vars` 帶入。
7. 部署後優先唯讀 Smoke：中英文目錄、BGG 標準／slash／實體 HTML 別名、NotBGG 動態頁、307 Location／最終 canonical、匿名 admin 401、封存安全、敏感欄位排除、Cache-Control、數量／FK／scope。正式寫入 Smoke 需獨立授權及具體資料計畫，不任意建立 production 測試收藏。
8. 異常時立即停止所有管理寫入，保留當時版本／狀態／恢復點與必要稽核證據。將 Worker 回滾到已證明可讀目前 Schema 的版本；通常保留 additive 新表、永久身份與歷史，不移除它們。**Worker 回滾不等於 D1 Schema 回滾。**
9. 舊 Worker 即使 SQL 可讀，仍可能不理解 D-6 有效對應而重複顯示遊戲；因此需要 D-6-aware 的已驗證回滾產物。不能直接把目前 HEAD 或任意 D-5 版本視為語意相容。0014 以後的 Trigger 亦可能拒絕舊寫入方式，回滾前應維持停寫。
10. 若必須還原 D1，只能在另行明確核准、凍結寫入、保護事故後新資料後執行 Time Travel／已驗證備份還原。全庫恢復可能丟失恢復點以後合法的價格／副本／收藏變動，必須受保護地對帳，不得直接覆蓋。**重新執行舊 Migration 不是回滾方案。**
11. 恢復後比對 collectionId／game_id／永久 NotBGG ID、收藏／副本數、scope、缺失引用、FK／稽核與必要的資料摘要；確認價格／語言／備註未被意外清除，才由責任人恢復寫入。

這些是執行計畫，備份實際可還原性與正式回滾版本仍 **NOT VERIFIED／BLOCKED**。

## 9. 上線驗收清單

| 項目 | 狀態 | 原因、風險與處理建議 |
| --- | --- | --- |
| 程式碼版本 | BLOCKED | 高：未提交 D0～D6；建立審核後不可變 release Commit，不自動提交 |
| 自動化測試 | PASS | F1 修補後 300／300；不包含正式環境寫入 |
| TypeScript | PASS | strict noEmit |
| Astro | PASS | 0 error／warning，13 hints |
| Production build | PASS | 直接 Astro build；npm prebuild 另列 NOT VERIFIED |
| Worker-first 完整覆蓋 | PASS | F1 本機修復，實際 HTTP 210 情境、標準／靜態／編碼別名先進 Worker；正式設定尚未驗證 |
| BGG 標準靜態路由 | PASS | 真實 ASSETS，保留 slug；實體別名仍 FAIL |
| NotBGG 動態路由 | PASS | 中英文、動態新增／封存本機通過 |
| 307／解除可逆 | PASS | 標準與靜態／編碼別名 Location、無 301／循環；F1 已本機修復 |
| 正式 canonical／hreflang | NOT VERIFIED | 正式 hostname 未核對；目錄 canonical／hreflang 尚缺，需 SEO 決策 |
| Access 本機驗證 | PASS | JWT／白名單／handler 再授權 |
| 正式 Access 登入與政策 | NOT VERIFIED | 未使用正式身份驗證；不得以合成測試代替 |
| Origin／CSRF | PASS | 同來源＋自訂 header＋fetch-site，本機測試 |
| 正式分散式限流 | BLOCKED | 中 F5：候選設定缺 binding；配置並核准可用方案及 429 驗證 |
| 正式 D1 Binding／狀態 | NOT VERIFIED | 過期 OAuth；沒有遠端唯讀結果 |
| 0014→0015→0016 順序 | PASS | native baseline＋實際 Wrangler pending 升級與 tracking 通過 |
| 永久關聯保護 | PASS | F2 已依明確授權直接修補未發布 0015；舊／新／已封存關聯 DELETE 拒絕，正常寫入／封存與回滾通過 |
| 空庫 CLI 重建 | PASS | R4 僅去除 0003 BOM，直接讀專案 migrations 目錄，0001～0016 與重送驗證通過；正式資料還原未驗收 |
| 收藏／副本完整性 | PASS | 合成舊資料升級前後相等；正式資料 NOT VERIFIED |
| production/test 隔離 | PASS | 本機 Repository／合成測試通過；正式分布 NOT VERIFIED |
| 快取策略 | PASS | 已測標準 SSR／管理／307 no-store；正式 Cache Rules NOT VERIFIED，F1 已本機修復 |
| 手機視覺穩定性 | NOT VERIFIED | 中 F3：出現高 shift 樣本也有低 CLS，須穩定重測與釐清根因 |
| BGG 快取完整性 | PASS | SHA256 與指定基準相符 |
| 正式備份／還原驗證 | BLOCKED | 高：本輪只允許計畫，未建立正式恢復點；後續受保護備份與還原演練需另行授權 |
| 正式 Worker 回滾版本 | BLOCKED | 高：現行正式 version／Commit 未確認；先記錄並證明 Schema／語意相容 |
| 正式部署與資源修改 | BLOCKED | 高：本階段未授權；本機 F1／F2 修復不等於可自行部署 |

## 10. 尚未驗證與上線阻擋事項

立即阻擋：未提交 release、正式基線／回滾／備份未知、正式限流未證實。F1／F2 已於本機修復驗證，尚未部署。F3 需處理高 BODY 位移未重現的限制；F4 本機重播已 PASS，正式備份還原仍待驗證。正式 Access、DNS／Route／Cache Rules、Secrets 名稱、正式圖片來源、canonical／hreflang、Preview 隔離與 Edge 效能都不能宣稱通過。

本輪新增檔案：

- `docs/notbgg-d7a-preflight.md`
- `docs/d7a-local-evidence.json`
- `tests/d7a-inventory.mjs`
- `tests/d7a-preflight.ts`
- `tests/d7a-route-matrix.ts`
- `tests/d7a-cli-migrations.mjs`
- `tests/helpers/d7a-built-preview.ts`

沒有建立新快取備份、批量圖片、Trace、大量截圖或正式資料副本。既有工作目錄的其他修改不是本輪新增的修正。

## 11. D-7B 建議順序與人工確認點

1. F1 已完成最小修補、F2 已完成直接修補 0015；F4 已完成本機修正；另外授權並完成 F3 與正式恢復流程驗證，重跑相關本機驗收；不因本次修補自動開始其他工作。
2. 人工確認正式帳號／DB／hostname／Access／限流方案、Preview 隔離、canonical／圖片來源政策；恢復適當唯讀授權，取得正式真實基線後更新預演。
3. 確認完整 release Commit、產物輸入、可回滾 Worker version／GitSHA、受保護備份與恢復演練證據、寫入凍結及事故責任人。
4. 再就**具體 pending Migration 清單與部署版本**取得獨立明確授權；執行 DB-first、Worker、唯讀 Smoke、完整性比對。未取得授權不得執行。

## 12. 本輪未修改與未執行項目

未修改：`src/data/bgg-cache.json`、BGG Parser、A-2／A-3 官方關聯語意、正式 collection、正式 D1、Access／DNS／Route／KV／R2／變數／Secret／limiter 設定。D-7A 初審未修改 Migration；前一輪 D-7A-R 依明確授權直接修補尚未發布的 0015。本輪 F1 僅修改 gateway 與候選 Worker-first 設定及相關測試／文件，0014／修補後 0015／0016 均未再修改，正式設定未變動。

BGG 快取 SHA256：`1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`。Git 對該檔顯示 M 是相對既有 HEAD 的先前差異，本輪內容與指定基準完全相符。

只有隨機隔離本地 D1 執行合成測試寫入與 Migration。沒有正式資料讀寫、遠端 Migration、正式備份、部署、發布、提交、推送或 D-7B 操作。
