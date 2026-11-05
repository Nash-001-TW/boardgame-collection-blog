# D-5：NotBGG 配件與個人收藏

本輪只在本機開發、隨機臨時路徑的隔離 Miniflare D1 驗證。沒有連線／寫入遠端正式 D1、沒有部署、沒有執行 D-6。

## 盤點與最小設計

原 `CollectionV2Repository` 只有正式資料讀取，`/collection` 只呈現資料；沒有可沿用的完整 V2 新增／編輯／封存 API。因此沿用既有 V2 收藏、實體副本、採購、分攤與卡套資料表，增加 `repository.management` 管理方法與 Access 保護的最小表單，沒有建立平行收藏身份或資料來源。

`collectionId = v2_collection_items.id`，遊戲引用是原 `game_id = v2_games.id`，副本仍是 `v2_owned_copies.id`。同款遊戲可以新增多筆收藏，沒有依名稱或 BGG／NotBGG 身份合併，也不透過配件關聯推定擁有狀態。

BGG 遊戲若尚未登記在 V2，加入收藏時只接受既有 BGG 快取中的真實 ID，於同一原子批次登記來源身份；不呼叫 API、不依輸入名稱建立遊戲。NotBGG 必須已存在且未封存，永久 NotBGG ID 與內部 game_id 均不改動。

## Migration 0015

### D-7A-R 修正（2026-11-04）

初版 0015 重建 `site_game_relations` 時，遺失 0014 的 `site_game_relations_no_delete` Trigger；未建立 audit event 的舊關聯因此可被硬刪除。使用者確認 D 階段未發布、0014～0016 未套用任何遠端 D1，並明確授權直接修補 0015，不新增 0017。本機既有持久化 D1 的唯讀 Schema 檢查未發現 NotBGG 表；已知測試皆為臨時隔離庫，未發現其他需保留舊版的共用設定。外部環境前提來自使用者確認，未操作遠端。

在表重建及索引恢復後，補上 `site_game_relations_no_delete BEFORE DELETE ON site_game_relations`，以 RAISE(ABORT) 要求改用封存。只禁止此表硬刪除，不擴及其他表、不攔截 INSERT／UPDATE；合法封存仍更新 archived_at 並保存事件。0014、0016 與其他 Migration 不變。已套用舊版的任何本地資料庫不能僅因修改檔案自動修正，本輪只重建全新隔離測試庫。

新增 `tests/notbgg-relation-retention.test.ts`：全新 0013→0014 建立舊關聯→修補後 0015→0016，驗證舊／新／已封存關聯硬刪除被拒絕、正常新增／編輯／封存、外鍵、修訂／audit 保留，以及 DELETE／audit 失敗時整個 batch 回滾。相關 D-5／D-6／D-7A 回歸與具體結果見 [更新後的 D-7A 審查](./notbgg-d7a-preflight.md) 和 [本機證據](./d7a-local-evidence.json)。不操作正式資料、不部署、不提交 Git。

修補後測試結果：focused D-5／D-6／retention **34／34 PASS**，全套 **290／290 PASS**（27 檔），TypeScript strict PASS；D-5 與 D-6 桌面／手機瀏覽器 PASS。實際本地 Wrangler 從合成 0013 基線升級 0014→0015→0016 並登記 tracking 成功；D-7A 真實建置預演的 legacy DELETE guard 已為 PASS。BGG SHA256 維持 `1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`。

原 D-5 只新增 `migrations/0015_notbgg_collection.sql`，沒有修改 0001～0014；D-7A-R 只修補未發布的 0015，未建立新 Migration。

- SQLite CHECK 擴充需要重建 `site_game_relations`：保留所有原關聯 ID、來源、備註、建立時間、建立者、封存時間及已提交流水號，再恢復原有身份／類型觸發器。
- 允許 `accessory_for` 與 `compatible_with`。兩種語意分開；相同來源、目標、類型只允許一筆有效關聯。外鍵、禁止自我關聯、來源必須是 NotBGG 配件等限制保留。
- `site_relation_events`：新增／封存關聯操作與操作者，事件不可修改／刪除。
- `v2_collection_management`：以原收藏 ID 為主鍵，補充 revision、封存、冪等 key/hash 及本表單管理的首份副本／單筆採購引用；沒有重複建立購買價格、語言或遊戲身份欄位。
- `v2_collection_events`：修訂、操作類型、操作者、時間；資料庫 revision gate 防止舊版本覆寫。事件不可修改／刪除。
- D5 建立操作的資料庫 guard 防止提交空遊戲引用或封存來源。所有管理／採購建立與修改以 D1 `batch` 原子執行，不使用不受支援的手動 BEGIN／COMMIT。

隔離測試同時驗證空白資料庫與帶有 0014 關聯資料的升級，舊關聯內容保持相同，歷史流水號 500 後的新關聯為 501，`foreign_key_check` 通過。正式環境套用仍未執行。

## 配件關聯

`SiteGameRelations` 負責列出、新增與封存；目標使用 GameRef 驗證並解析為既有 `v2_games.id`，無法解析會拒絕，不偷偷建立目標。不可新增自我／重複／官方擴充類型的手動關聯。

D3 原表單 `relatedGameIds` 明確只管理 `manual + accessory_for`；變更這組欄位不封存 `compatible_with`，也不碰 `v2_game_relations` 或 BGG 快取中的官方關聯。新關聯介面逐筆封存，原紀錄與稽核保留。公開詳細頁顯示兩種語意，但不輸出關聯管理備註／操作者。

## 收藏欄位映射

| 概念 | 既有 V2 儲存／顯示方式 |
|---|---|
| 收藏身份、遊戲身份 | `v2_collection_items.id / game_id` |
| 擁有／收藏狀態、願望清單 | `acquisition_status / wishlist`；舊 notes.owned 只有明確改變狀態時才解除覆寫 |
| 個人評分、遊玩次數、評論 | 原 `notes` JSON 的私人欄位；未知使用 null，0 只表示明確輸入的真實零值 |
| 購買價格、來源、日期、幣別 | 原 `v2_purchase_orders`、`v2_purchase_order_lines`、`v2_purchase_allocations`，金額為整數最小貨幣單位 |
| 未知價格時的購買提示 | 私人 notes 提示；不建立假零元採購。補上價格後建立原有採購資料圖 |
| 語言、版本 | 原 `v2_owned_copies.language_code / edition` |
| 實際取得日期 | 保留副本與 acquisition 原值；購買日期不假裝是取得日期 |
| 卡套 | 原 `v2_sleeve_requirements` 管理員唯讀查看；卡套備註為私人文字，不取代結構化尺寸／庫存／配發 |
| 額外收納、附加配件 | 私人收藏備註；既有 component、copy component 與收藏關聯原樣保留，不以備註重建零件表 |
| 收藏封存 | management.archived_at；不刪除收藏、遊戲、實體副本或採購 |

表單可建立首份實體副本，也可先記願望清單、日後明確勾選補建首份副本。已有副本不因重送或編輯重建。其他既有副本與非此表單建立的採購圖唯讀保留；這不是多副本、卡套庫存或完整採購後台重構。

## 管理頁與 API

管理頁：`/admin/collection`、`/admin/collection/new`、`/admin/collection/[id]`、`/admin/notbgg/[id]/relations`。`?lang=en` 使用英文，預設繁體中文；支援手機、鍵盤、儲存中、避免連點、未儲存離開提示、衝突後保留輸入並手動重新載入。

NotBGG 公開詳細頁提供管理員加入收藏連結，進入受保護表單後搜尋並明確選擇既有來源。收藏管理以 `scope=production|test` 明確選擇，導覽保留 scope。配件關聯是目錄身份關係，本身沒有收藏 record_scope，介面不顯示假的 scope 選擇。

| 方法 | 路由 | 用途 |
|---|---|---|
| GET / POST | `/api/admin/collection` | 分頁列出／冪等建立收藏 |
| GET | `/api/admin/collection/search` | 有界 BGG／NotBGG 身份搜尋 |
| GET / PATCH | `/api/admin/collection/[id]` | 管理員完整讀取／expectedRevision 更新 |
| POST | `/api/admin/collection/[id]/archive` | expectedRevision 封存 |
| GET / POST | `/api/admin/notbgg/[id]/relations` | 管理關聯列表／新增 |
| POST | `/api/admin/notbgg/[id]/relations/[relationId]` | 封存指定手動關聯 |

列表預設 20、最多 100，使用 after 游標。每一收藏讀寫都以 collectionId + record_scope 限定；不可用另一 scope 查讀／更新相同 ID。API 不接受前端指定 game_id、collectionId、actor 或新的系統 revision（修改只接受 expectedRevision 前置條件）；建立與修改不更換遊戲引用。

## 安全與公開顯示

新增路由由 middleware 的嚴格 Access 分支保護，即使 LOCAL_ADMIN_DEV 啟用也不可繞過。各管理 API 再獨立驗證 D3 的 JWT 簽章、issuer、audience、有效期限與允許身份。操作者取自已驗證的 subject，沒有測試身份注入正式程式。

寫入沿用同源 Origin、Sec-Fetch-Site 及 `X-NotBGG-Request: 1`，重用 D3 的 JSON／Content-Type／大小／欄位與深度限制。錯誤使用一般化代碼，沒有輸出 SQL、token 或密鑰。可沿用選配 `NOTBGG_WRITE_LIMITER`；未配置時**不能宣稱具備正式分散式限流**。

公開 `/collection` 維持僅 production 讀取，以 adapter 白名單輸出名稱、狀態、來源身份、圖片與既有 slug／NotBGG 詳細頁連結；個人購買、評論、管理備註、操作者、修訂、冪等 key 不輸出。公開卡片原本的私人資訊佔位仍維持，不因 D5 改為公開真值。兩語系動態頁 `no-store`，Binding／查詢失敗安全回傳一般化 503。

來源遊戲封存時，收藏與所有副本／購買資料保留，管理員可辨識來源已封存並繼續管理收藏。公開收藏保留收藏名稱與安全的不可用標示，不連到錯誤來源；公開 `/games` 沿用 D4 隱藏來源與詳細頁 404。缺失引用保留 collectionId，不依名稱轉向其他 BGG；已確認對應仍沿用 D4 的暫不可用規則，留待 D6 完整解析。

## 驗證結果

- 相關自動化 **143/143 PASS**：三種類型、多筆同款、真正並行不同／相同冪等 key、修訂衝突、後段失敗原子回滾、採購／語言／日期、封存保留、scope、公開白名單、來源與關聯隔離、D1～D4 及 A-2／A-3。
- D5 真實元件／控制器瀏覽器：桌面／390px 手機通過，包含已簽章測試 Access、從來源加入、雙重提交、採購、CAS／手動 reload、來源與收藏封存、公開隱私與連結、兩種配件關聯、scope 隔離。
- C1／C2／C3：**11／4／5 checks PASS**，815 筆及 24→48→815 保留。
- D3 管理瀏覽器與 D4 混合目錄／詳細頁／手機節流瀏覽器通過，無 pageerror。
- TypeScript strict、Astro check、production build 通過；Astro **0 errors、0 warnings、13 hints**。
- 真實外部圖片本輪沒有另行量測；瀏覽器用合成圖片，外部網路與正式 D1 效能 **NOT MEASURED**。
- 正式 Cloudflare Access、遠端 D1 Migration／Binding、分散式限流與部署後快取 **NOT TESTED**。

BGG SHA256：`1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`。

## 檔案

新增：

- `migrations/0015_notbgg_collection.sql`
- `src/lib/collection-v2-management.ts`、`collection-admin-api.ts`、`collection-admin-controller.ts`、`site-game-relations.ts`
- `src/components/CollectionAdmin.astro`
- `src/pages/admin/collection/{index,new,[id]}.astro`
- `src/pages/admin/notbgg/[id]/relations.astro`
- `src/pages/api/admin/collection/{index,search,[id]}.ts`、`[id]/archive.ts`
- `src/pages/api/admin/notbgg/[id]/relations/{index,[relationId]}.ts`
- `tests/notbgg-collection.test.ts`、`tests/notbgg-collection-browser.cjs`、本文件

修改：

- `src/lib/collection-v2-repository.ts`、`collection-v2-adapter.ts`、`game-browser-capabilities.ts`
- `src/lib/notbgg-contract.ts`、`notbgg-repository.ts`、`notbgg-public.ts`、`notbgg-admin-api.ts`、`auth/admin-request.ts`
- `src/components/CollectionCard.astro`、`NotBggDetail.astro`、`NotBggAdmin.astro`
- `src/pages/collection.astro`、`src/pages/en/collection.astro`、`src/pages/admin/index.astro`
- `scripts/lib/local-games-preview.ts`、`tests/helpers/notbgg-admin-preview.ts`、`notbgg-local-d1.ts`
- `tests/notbgg-repository.test.ts`（只比較升級前已存在的 V2 表定義，仍驗證舊表沒有變更）、`tests/notbgg-middleware.test.ts`（加入新路由防繞過案例）

工作區其他原有未提交變更保留；本輪未修改 BGG 快取、Parser、A-2／A-3 官方語意或舊 Migration。

## D6 前事項

需確認主要來源切換、永久別名、解除錯誤對應與收藏顯示解析的完整契約。D5 不搬移 collectionId、game_id、實體副本或採購記錄，也不依配件、名稱或語言自動合併。D4 原有「活躍原稿直接公開」政策不變；若需草稿／發佈開關另行設計。完整多副本／採購與結構化卡套編輯超出本輪最小管理介面範圍。

本輪完成後停止，不開始 D6。
