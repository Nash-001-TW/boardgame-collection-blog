# #28 贈送卡套（隨貨附贈入庫）｜規劃（2026-11-25 已採納，DECISION_LOG SLV-GIFT-Q60～Q63）

對應 CURRENT_TASK #28（使用者 2026-11-24 提出：購買桌遊時店家附贈整包或零散卡套）。依據（已採納）：[V2 Admin 決策與測試計畫](V2-Admin-decisions-and-test-plan.md) §2 的 TX-01～TX-04、PROD-02、SLV-02；#27 卡套不足（[規劃](sleeve-shortage-plan-20261125.md)，已上線）。

狀態：規劃 **已採納**（2026-11-25，Q60～Q63 全採 A）；使用者另要求「把之前與 Migration 有關的變動一併修改」，併入範圍待確認（§6）。本任務**需要 Migration**，依 AGENTS.md 屬高敏感區：Migration 候選檔須另經審查，正式套用另需授權與備份流程。本文件只做靜態閱讀，未執行測試、未讀正式資料。

## 1. 現況盤點（2026-11-25 靜態閱讀）

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| 交易類型 | `transaction_type` 以 CHECK 限定 6 種：PURCHASE、USE、RETURN、ADJUST、DISCARD、OPENING_BALANCE；PURCHASE 必須整包（`quantity_sheets = pack_count × sheets_per_pack_snapshot`） | `migrations/0011_v2_sleeve_management.sql` |
| 既有關聯欄位 | 交易表**已有** `collection_item_id`、`owned_copy_id`、`purchase_order_line_id`（皆可為空的外鍵）與 `unit_pack_price_minor`、`total_price_minor` | 同上 |
| 依附物件 | 0011：3 個驗證觸發器（插入／更新／刪除，含負庫存檢查）、`v2_sleeve_inventory_balance` view、2 個索引；0020：2 個保護觸發器（已連結套用的交易不可改刪），`v2_sleeve_applications.inventory_transaction_id` 外鍵指向交易表 | 0011、0020 |
| 程式 | 類型清單 `sleeveTransactions`、手動登錄的方向規則（PURCHASE 包數換算、USE／DISCARD 為負、其他為正）、「已入庫」統計只算 OPENING_BALANCE＋PURCHASE、交易頁類型標籤 | `src/lib/sleeve-admin.ts`、`src/pages/admin/sleeves/index.astro` |
| 暫行做法 | 整包記「購買」、散裝記「調整 +張數」，備註寫「店家贈送，隨《遊戲名》附」 | CURRENT_TASK #28 |
| 正式資料（2026-11-25 彙總，#27 §7） | 卡套產品 0、交易 **0**、套用 **0** | [卡套不足規劃 §7](sleeve-shortage-plan-20261125.md) |
| Migration 編號 | 已套用 0001～0023；`0024_component_applicability.sql` 為未套用候選（R06-P0-A） | `migrations/` |

**結論**：SQLite 不能修改既有 CHECK，新增交易類型必須**重建交易表**（建新表→複製→刪舊表→改名→重建索引、觸發器、view）。正式環境目前 0 筆交易、0 筆套用，是重建成本與風險最低的時機。

## 2. 固定規則（依使用者需求與已採納規則，不需決策）

1. 新類型「贈送／隨貨附贈」（暫定代碼 `GIFT`）：數量必為正；可記整包（包數 × 當時每包張數快照）或零散張數。
2. 價格固定為 0：單價、總價只能為空或 0；**不進採購成本**（R01／R10 的採購成本本來就只算採購分攤，不讀卡套交易，維持不變）。
3. 「已入庫」統計（產品與尺寸）納入贈送；#27 的可用庫存本來就是交易合計，自動包含贈送，缺口算法不變。
4. 不可修改／刪除（TX-01）、不可負庫存、手動登錄不可產生 USE（TX-02）等既有規則全部沿用；重建後觸發器與 view 必須逐一等價重建。
5. 不轉換既有資料：正式環境沒有交易，沒有暫行紀錄需要轉成贈送。
6. Migration 只能前向新增（AGENTS.md）；正式套用比照 0023：**逐檔執行**並手動寫入 `d1_migrations` ledger，**禁止** `wrangler d1 migrations apply`（`migrations/` 內有未套用候選 0024）；套用前做正式 D1 官方 Export 備份與唯讀預檢，套用後唯讀對帳。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q60 | 實作方式 | 新增交易類型 `GIFT`，以 Migration 重建交易表修改 CHECK（同時重建 0011／0020 的觸發器、view、索引） | 不改資料表：沿用暫行做法，只在 UI 提供「贈送」快捷登錄（實際存成 PURCHASE 價格 0 或 ADJUST），以固定備註前綴辨識 | **A**：類型明確、統計與報表不靠備註字串；正式 0 筆交易，現在重建最安全，日後有資料再重建風險更高 |
| Q61 | 贈送可連到哪裡 | 可選連到收藏（既有 `collection_item_id`）及／或採購訂單明細（既有 `purchase_order_line_id`；介面先選訂單再選明細），兩者皆可留空 | 只能連到收藏 | **A**：符合使用者「連到收藏或採購訂單」的需求，欄位已存在 |
| Q62 | 收藏詳細頁是否顯示 | 「相關採購」分頁加一節「隨貨附贈的卡套」（唯讀：日期、產品、張數、來源訂單），只列連到此收藏的贈送 | 收藏頁不顯示，只在卡套交易頁查詢 | **A**：與 #29 系列花費設計銜接（贈送價格 0，但能看出隨哪套遊戲附贈） |
| Q63 | 工作分段 | 分兩張：**28a** Migration 候選檔＋本機重建驗證（含既有觸發器等價測試），審查通過後依正式流程套用；**28b** 程式與畫面（登錄、統計、收藏分頁），在 0025 正式套用後才部署 | 一張做完，程式與 Migration 一起上線 | **A**：Migration 與程式分開審查與上線，程式不得依賴未套用的 Migration（DEPLOY-01） |

## 4. 非目標

修改其他交易類型的規則；交易撤銷或更正流程；#29 系列花費合計；卡套產品或尺寸資料表變更；0024 套用。

## 5. 決策後的步驟（Q63 採 A 時）

1. 起草 28a 工作命令：新增 `migrations/0025_sleeve_gift_transactions.sql`（候選）——`PRAGMA defer_foreign_keys`、建新表（CHECK 加入 GIFT 與其數量／價格規則）、逐欄複製、刪舊表、改名、等價重建 0011 的 3 個觸發器、view、2 個索引與 0020 的 2 個保護觸發器；本機以拋棄式 SQLite 驗證：套用前後結構比對（除 CHECK 外等價）、既有負庫存／不可改刪／套用保護測試全數通過、GIFT 正反例。
2. Claude 審查 0025 → 使用者授權正式套用流程（G0 唯讀預檢、G1 Export 備份、逐檔執行＋ledger、套用後對帳），比照 D1-A5。
3. 起草 28b 工作命令（程式與畫面）→ 審查 → 截圖 → 依 DEPLOY-01 部署（確認 0025 已在正式套用）。

## 6. 併入範圍（2026-11-25 已採納，DECISION_LOG SLV-GIFT-SCOPE）

使用者要求「把之前與 Migration 有關的變動一併修改」，確認併入三項已採納、但資料庫未落實的卡套限制（0024 逐副本適用性不併入）：

| 規則 | 現況（2026-11-25 靜態閱讀） | 本次落實 |
| --- | --- | --- |
| TX-01 交易不可改刪 | 交易表只有「更新／刪除後不可負庫存」（0011）與「已連結套用不可改刪」（0020）觸發器；其他交易仍可直接 UPDATE／DELETE。程式中沒有任何地方更新或刪除交易 | 重建後改為交易**一律**不可 UPDATE／DELETE（RAISE），取代原更新／刪除負庫存觸發器；插入時的負庫存與副本歸屬檢查保留 |
| TX-03 退回必為正 | CHECK 只規定 PURCHASE／OPENING_BALANCE 為正、USE／DISCARD 為負 | 重建的 CHECK 加入 RETURN 與 GIFT 必為正；ADJUST 維持非 0 可正可負 |
| SLV-01 每包張數唯讀 | 產品表沒有任何觸發器；「有交易後尺寸不可改」只在程式中檢查 | 新增產品更新觸發器：產品有任何交易後，`size_id` 與 `sheets_per_pack` 不可改（品牌、名稱、備註、啟停仍可改） |
| SLV-11 需求鎖定 | 0020 `v2_requirement_used_no_update` 在有套用（含同收藏的歷史套用）後凍結**整列所有欄位**，連備註都不能改，比規則更嚴 | 改為除 `notes`、`updated_at` 以外的欄位一律凍結（含核心欄位與 `assignment_status`、`assignment_revision` 等），允許只改 `notes`、`updated_at`；刪除仍禁止；「同收藏有歷史套用即保守凍結」的條件保留 |

**非目標**：SLV-11 的「備註修改紀錄」需要新資料表，本次不做（另案）；需求備註的編輯畫面屬 28b。

## 7. 工作命令 28a：Migration 0025 候選檔與本機驗證（2026-11-25 已授權，DECISION_LOG SLV-GIFT-28A-AUTH）

```text
工作命令 ID：SLV-GIFT-28A-20261125-01
工作目標：撰寫 migrations/0025_sleeve_gift_and_ledger_locks.sql（候選），在本機拋棄式 SQLite／Miniflare D1 驗證；不套用到任何遠端、不改任何 src。

已批准規格：本文件 §2 固定規則、§3（Q60～Q63 全採 A）、§6 併入範圍；V2-Admin-decisions-and-test-plan.md 的 TX-01、TX-03、SLV-01、SLV-11、REV-09。

Migration 內容：
  1. 交易表重建，依 SQLite 官方「其他類型的資料表結構變更」程序：PRAGMA defer_foreign_keys = true；建 v2_sleeve_inventory_transactions_new
     （欄位、預設值、外鍵與原表逐一相同）；INSERT … SELECT 逐欄複製；先 DROP 所有引用交易表的 view 與觸發器（含建在其他表上、
     本體引用交易表者，例如 0011 的 v2_sleeve_application_validate_insert、0020 的 v2_application_requirement_validate）；DROP 舊表；
     RENAME 新表為原名；重建索引、view 與觸發器。sqlite_sequence 的 AUTOINCREMENT 值不得倒退。
  2. 新 CHECK：transaction_type 增加 'GIFT'；PURCHASE／OPENING_BALANCE／RETURN／GIFT 數量 > 0；USE／DISCARD < 0；ADJUST ≠ 0；
     PURCHASE 維持整包規則；GIFT 若有 pack_count 則 quantity_sheets = pack_count × sheets_per_pack_snapshot（且兩者同時有或同時無）；
     GIFT 的 unit_pack_price_minor、total_price_minor 只能為 NULL 或 0。
  3. TX-01：交易 BEFORE UPDATE／BEFORE DELETE 一律 RAISE(ABORT,'SLEEVE_TRANSACTION_IMMUTABLE')，取代 0011 的更新／刪除負庫存觸發器；
     0020 的「已連結套用不可改刪」可併入或保留（結果須等價或更嚴）。插入時的副本歸屬與負庫存檢查原樣重建。
  4. SLV-01：新增 v2_sleeve_products BEFORE UPDATE 觸發器：該產品有任何交易時，size_id 或 sheets_per_pack 改變即 RAISE。
  5. SLV-11：以新觸發器取代 0020 的 v2_requirement_used_no_update（DROP 後重建）：鎖定條件不變；**除 notes 與 updated_at 以外**的任何欄位
     （含 collection_item_id、owned_copy_id、component_definition_id、size_id、quantity_sheets、assignment_status、assignment_revision、source_key、
     source_fragment 等，以 0023 時的實際欄位清單為準）改變即 RAISE；只改 notes／updated_at 允許。v2_requirement_used_no_delete 不變。
  6. 檔頭註解說明目的、對應規則、正式資料前提（2026-11-25 正式 0 筆交易、0 筆套用）、以及正式套用須逐檔執行＋ledger、禁止 migrations apply。

本機驗證（新增 tests/migration-0025.test.ts）：
  - 從 0001 依序套用至 0023（不含 0024），先放入涵蓋各類型的合成交易、套用、需求與產品，再套用 0025：資料逐列相同、id 與 AUTOINCREMENT 延續、
    PRAGMA foreign_key_check 無誤、PRAGMA integrity_check ok。
  - 結構比對：除 CHECK 與 §6 指定的觸發器外，交易表欄位、索引、view 定義與 0023 時等價（以 sqlite_master 比對並列出差異）。
  - 正例／反例：GIFT 整包與散裝、價格 0 與 NULL 可、價格 > 0 拒絕、GIFT／RETURN 負數拒絕、ADJUST 0 拒絕；任何交易 UPDATE／DELETE 拒絕；
    插入造成負庫存仍拒絕；有交易產品改 size_id／sheets_per_pack 拒絕、改名稱與停用允許；有套用需求改核心欄位拒絕、只改 notes 允許、刪除拒絕；
    無套用需求可自由改。
  - 既有測試回歸：tests/sleeve-admin.test.ts、tests/sleeve-workflow.test.ts、tests/sleeve-shortage.test.ts、tests/physical-component-management.test.ts
    （其測試資料庫須包含 0025；若現有 helper 只套到 0023，僅限在 helper 中加入 0025，不改其他行為）。若既有程式因 TX-01／SLV-11 而失敗，
    停下回報，不得改 src 迴避。
  - 執行 0025 兩次須失敗於第二次或為冪等（擇一並說明），不得造成半套用。

允許修改範圍：新增 migrations/0025_sleeve_gift_and_ledger_locks.sql、tests/migration-0025.test.ts；測試 helper 只限讓隔離資料庫套用到 0025。
禁止：改 src、其他 migration（含 0024）、wrangler.json、package.json；刪除檔案；連網、遠端 Wrangler、任何 --remote 操作、建置、部署、git commit／push；
  建立或移除 git worktree、以連結共用 node_modules；讀 .env／.dev.vars／備份。超出範圍時停下回報。

驗證：
  1. node --import tsx --test tests/migration-0025.test.ts tests/sleeve-admin.test.ts tests/sleeve-workflow.test.ts tests/sleeve-shortage.test.ts
     tests/physical-component-management.test.ts
  2. npm run astro -- check（基準 6 個錯誤）、git diff --check
完成條件與交付：0025 全文摘要、結構比對結果、各驗證數字、未執行項目；更新 HANDOFF.md。
後續：Claude 審查 0025 → 另行起草正式套用工作命令（G0 唯讀預檢、G1 Export 備份、逐檔執行＋ledger、套用後對帳），使用者授權後執行 → 28b。
```

### 7.1 28a 審查（2026-11-25）：有條件通過

- **範圍**：新增 `migrations/0025_sleeve_gift_and_ledger_locks.sql`（192 行）、`tests/migration-0025.test.ts`；未改 src、0024 或其他 migration；未刪檔。
- **逐項核對**：
  - 新交易表 16 欄、型別、預設值、外鍵與 0011 相同；CHECK 新增 GIFT（整包或散裝、價格只能 NULL／0）、RETURN 與 GIFT 必為正。
  - 重建的 `v2_sleeve_inventory_validate_insert`、`v2_sleeve_application_validate_insert`、`v2_application_requirement_validate` 與 `v2_sleeve_inventory_balance` view，經 Claude 以空白正規化逐字比對，與 0011／0020 原定義**完全相同**。
  - TX-01：原更新／刪除負庫存觸發器與 0020 兩個套用保護觸發器改為 `v2_sleeve_inventory_immutable_update`／`_delete` 一律拒絕（等價或更嚴）。
  - SLV-01：`v2_sleeve_product_pack_locked`。SLV-11：`v2_requirement_used_no_update` 重建，比對欄位涵蓋需求表全部 13 欄中除 `notes`、`updated_at` 外的 11 欄（含 0017 新增的 `assignment_revision`），鎖定條件與 0020 相同。
  - AUTOINCREMENT：複製 `sqlite_sequence` 高水位（0015 已在正式環境使用過讀取與 UPDATE `sqlite_sequence`，此類語法 D1 可接受；本檔另有 INSERT）。
  - 外鍵：`PRAGMA defer_foreign_keys = true` 後重建；結尾以 `pragma_foreign_key_check` 實際檢查（有違規即 `INSERT OR ROLLBACK` 整筆回滾），再以 `PRAGMA defer_foreign_keys = false` 清除 DROP 舊表留下的延遲計數。SQLite 中此做法成立。
  - 重複執行：第一個 `DROP TRIGGER` 即失敗，不會半套用。
- **Claude 重跑**：`tests/migration-0025.test.ts` **6／6**。
- **條件一（28a 內補做）**：工作命令要求的 **Miniflare D1 驗證未執行**。`pragma_foreign_key_check` 表值函式、`INSERT OR ROLLBACK`、`INSERT INTO sqlite_sequence`、交易內切換 `defer_foreign_keys` 在 D1 執行器是否被接受尚未證實。須以 `tests/helpers/notbgg-local-d1.ts` 的 Miniflare 隔離 D1 套到 0023（不含 0024）並放入含套用的合成資料，再整檔執行 0025，確認成功、資料與外鍵完整，且第二次執行失敗不留半套用。已交回 Codex 補做（同一工作命令範圍）。
- **條件二（屬 28b，已知且預期）**：新限制使既有回歸 5 項失敗：
  1. `tests/sleeve-admin.test.ts`：卡套管理仍允許修改已有交易產品的每包張數，資料庫依 SLV-01 拒絕，現行 API 回 **503**（應為使用者可理解的 4xx 並在畫面鎖定欄位）；連帶後續停用測試 409。即規則原註「每包張數仍可改，須補齊」。
  2. `tests/sleeve-shortage.test.ts` 2 項：測試資料以直接 UPDATE／DELETE 交易建構，被 TX-01 拒絕；需改為以新增交易建構。
  兩者都在 28b 修正；**28b 必須在 0025 正式套用後立即部署**，避免卡套管理出現 503（正式目前 0 個產品，實際影響為零）。

- **條件一已解除（2026-11-25）**：Codex 以 Miniflare 隔離 D1（`isolatedNotBggD1`）套到 0023（不含 0024）並放入合成資料後，以單一 `db.batch()` 整檔執行 0025：成功，7 筆交易、2 筆套用、2 筆產品、3 筆需求逐列相同，序號 99→100 延續，`foreign_key_check` 0 筆；`pragma_foreign_key_check`、`INSERT OR ROLLBACK`、`INSERT INTO sqlite_sequence`、交易內 `defer_foreign_keys` 切換皆被 D1 接受（`PRAGMA integrity_check` 在 D1 為 SQLITE_AUTH，但 0025 未使用）；重跑失敗且無半套用；真實外鍵違規整筆回滾。Claude 重跑 `tests/migration-0025.test.ts` **8／8**、`git diff --check` 通過。0025 未改寫，SHA-256 `ae6ae0f3c357ed64e739906bfd25dc78aefbe1e2c8659b32564e95b090fea5dc`（正式套用時須比對）。
- **結論**：28a 0025 候選**審查通過**（條件二屬 28b）。注意：正式以 `wrangler d1 execute --remote --file` 執行，與本機 `db.batch()` 執行器不同，正式套用前的唯讀預檢與備份流程仍須照做。

## 8. 工作命令 28b：程式與畫面（2026-11-25 已授權，DECISION_LOG SLV-GIFT-28B-AUTH）

### 8.1 盤點（2026-11-25 靜態閱讀）

- `src/lib/sleeve-admin.ts` `writeSleeveAdmin`：產品編輯只在「有交易」時擋尺寸變更，**每包張數仍可改**（0025 後資料庫拒絕，API 回 503）；庫存登錄 `stock` 以 `kind` 與 `quantity` 寫入，PURCHASE 以包數換算，其他類型只記張數，不寫 `collection_item_id`、`purchase_order_line_id`、價格。`sleeveTransactions` 清單仍含 USE（畫面已過濾）。
- `readSleeveAdmin`：「已入庫」只算 OPENING_BALANCE＋PURCHASE；交易頁以 `kinds` 對照顯示類型。
- `src/pages/admin/sleeves/index.astro`：產品編輯表單、庫存登錄表單（類型下拉）、交易清單。
- 收藏「相關採購」分頁：`CollectionPurchasesPanel.astro`（只用 `readPurchases`）。
- 測試輔助（`admin-dashboard-preview.ts`、`sleeve-workflow-fixture.ts`、`notbgg-local-d1.ts`）會套用 `migrations/` 內**全部**檔案，因此 0025 已自動納入本機測試。
- 0025 後失敗的既有測試：`sleeve-admin.test.ts`（改有交易產品每包張數預期 201）、`sleeve-shortage.test.ts` 2 項（以 UPDATE／DELETE 交易建構資料）。

### 8.2 工作命令

```text
工作命令 ID：SLV-GIFT-28B-20261125-01
工作目標：在 0025 之上實作贈送卡套的登錄、統計與顯示，並讓卡套管理正確處理 SLV-01 鎖定；修正因 TX-01 失效的測試資料建構。
  本工作的程式依賴 0025，**不得在 0025 正式套用前部署**。

已批准規格：本文件 §2、§3（Q60～Q63）、§6；V2-Admin-decisions-and-test-plan.md 的 SLV-01、TX-01～TX-04、PROD-02。

伺服器端（src/lib/sleeve-admin.ts）：
  1. sleeveTransactions 加入 'GIFT'；庫存登錄 stock 支援 GIFT：
     - 數量單位二選一：整包（unit='pack'，quantity 為包數，寫入 pack_count 與當時 sheets_per_pack 快照、quantity_sheets＝包數×每包張數）
       或散裝（unit='sheet'，quantity 為張數，pack_count 與快照為 NULL）；數量必為正，上限沿用現行。
     - 可選 collectionId（存在的收藏）與 purchaseOrderLineId（存在的採購明細）；兩者皆可留空；若兩者都填，明細的收藏若非空須與 collectionId 相同。
       寫入 collection_item_id、purchase_order_line_id；單價、總價一律 NULL。
     - **GIFT 可作為產品的第一筆交易**（與 PURCHASE 相同）：現行 SQL 條件只允許新產品的第一筆是 OPENING_BALANCE 或 PURCHASE，須把 GIFT 加入；
       使用者情境：收到從未登錄過的尺寸或產品時，先「新增產品」（新尺寸會自動建立），再直接登錄贈送入庫，不必先記期初 0。
     - 其餘既有守衛（產品啟用、revision、lastTransactionId、冪等、負庫存）沿用。其他類型行為不變（不新增手動 USE）。
  2. 產品編輯：產品有任何交易時，若尺寸或每包張數與現值不同，回 409（例如 SLEEVE_PRODUCT_PACK_LOCKED），不寫入；
     資料庫觸發器錯誤 SLEEVE_PRODUCT_PACK_LOCKED、SLEEVE_TRANSACTION_IMMUTABLE 對應為 409 而非 503。名稱、品牌、厚度、備註、啟停仍可改。
  3. readSleeveAdmin：「已入庫」（received）納入 GIFT；交易清單回傳 GIFT 的收藏與採購明細關聯（收藏名稱、訂單 ID）。
  4. 新增唯讀函式讀取「連到某收藏的贈送卡套」（日期、產品品牌名稱、尺寸、張數、包數、來源訂單 ID），不改 readPurchases。

畫面：
  5. 卡套管理庫存登錄：類型選單新增「贈送／隨貨附贈」（尚無交易的新產品也要出現此選項，與期初、購買並列）；選此類型時顯示單位切換（整包／張）、收藏（輸入收藏 ID，顯示名稱確認）與採購訂單
     （輸入訂單 ID 後列出該訂單明細供選擇，可留空）；送出前顯示「價格固定為 0，不計入採購成本」與新餘額。
  6. 交易清單：GIFT 顯示「贈送」，並附收藏與訂單連結。
  7. 產品編輯：產品已有交易時，尺寸與每包張數欄位唯讀，旁註「已有交易，尺寸與每包張數不可修改；請停用並新增產品」。
  8. 收藏「相關採購」分頁（CollectionPurchasesPanel.astro）新增唯讀一節「隨貨附贈的卡套」（Q62）：只列連到此收藏的 GIFT；無資料時一行說明；
     讀取失敗只影響本節（「無法取得」），其他節與頁首照常。
  9. 中英雙語；1440／768／375 無整頁橫向捲動；WCAG AA。

測試：
  10. tests/sleeve-admin.test.ts：把「改有交易產品每包張數」的預期由 201 改為 409 並確認未寫入、後續停用正常；新增 GIFT 正反例
      （整包、散裝、連收藏、連明細、明細與收藏不符、負數、停用產品、冪等重送），以及「全新尺寸：新增產品後第一筆即登錄 GIFT」的完整流程。
  11. tests/sleeve-shortage.test.ts：2 個以 UPDATE／DELETE 建構資料的測試改為以 INSERT 建構等價情境，斷言不變；新增「GIFT 計入可用庫存」。
  12. 收藏分頁與卡套管理的瀏覽器驗收（可擴充 tests/admin-collection-detail-browser.mjs、tests/sleeve-shortage-browser.mjs 或新增腳本）。

允許修改範圍：src/lib/sleeve-admin.ts（write／read 與錯誤對應）；src/pages/admin/sleeves/index.astro（登錄表單、交易清單、產品編輯）；
  src/lib/sleeve-admin-controller.ts（只限上述表單行為）；src/components/admin/CollectionPurchasesPanel.astro（只增第 8 項一節）；
  新增 src/lib/ 下的唯讀函式檔（如需）；src/styles/admin-theme.css（只增）；tests/sleeve-admin.test.ts、tests/sleeve-shortage.test.ts（依第 10、11 項）；
  tests/admin-collection-detail-browser.mjs、tests/sleeve-shortage-browser.mjs（只增）；新增測試檔；tests/helpers/（只增合成資料）。

禁止事項：不改任何 migration（含 0024、0025）、sleeve-workflow.ts、sleeve-workflow-controller.ts、purchase-admin.ts、採購管理頁與任何其他寫入 API；
  不改 wrangler.json、package.json、astro.config.mjs、middleware、auth；不刪除檔案；不新增套件；不建立或移除 git worktree、不以連結共用 node_modules；
  不連遠端、不建置、不部署、不 git commit／push；不讀 .env／.dev.vars／備份；截圖只寫暫存目錄或 docs/SLV-GIFT-screenshots/。超出範圍時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/sleeve-admin.test.ts tests/sleeve-shortage.test.ts tests/sleeve-workflow.test.ts tests/migration-0025.test.ts
     tests/physical-component-management.test.ts tests/admin-collection-detail.test.ts tests/purchase-admin.test.ts（全數通過）
  2. 瀏覽器：node tests/sleeve-shortage-browser.mjs、node tests/admin-collection-detail-browser.mjs、node --import tsx tests/sleeve-workflow-browser.mjs、
     node --import tsx tests/purchase-admin-browser.mjs（皆 <暫存目錄>）
  3. npm run astro -- check（基準 6 個錯誤）、git diff --check
瀏覽器驗收（合成資料）：全新尺寸「新增產品→第一筆登錄贈送」流程；庫存登錄贈送（整包、散裝、連收藏與明細）三種寬度；交易清單贈送標示；產品編輯鎖定；收藏「隨貨附贈的卡套」有資料、無資料、
  讀取失敗；英文。截圖存 docs/SLV-GIFT-screenshots/。
完成條件與交付：修改檔案與摘要、驗證數字、瀏覽器逐項結果、截圖清單、astro check 錯誤數、未執行項目、git status 是否有範圍外變動；更新 HANDOFF.md。
上線順序：Claude 審查 → 使用者看截圖 → 正式套用 0025（另一張工作命令，經授權）→ 依 DEPLOY-01 授權推送 28b（緊接 0025 之後）。
```

### 8.3 28b 審查（2026-11-25）：通過

- **範圍**：修改 `sleeve-admin.ts`、`sleeves/index.astro`、`sleeve-admin-controller.ts`、`admin-theme.css`、`CollectionPurchasesPanel.astro` 與指定測試、preview helper；新增 10 張截圖。皆在 §8.2 範圍內；未改任何 migration（0025 SHA-256 仍為 `ae6ae0f3…`）、卡套套用流程、採購模組；未刪檔；其他截圖資料夾未被覆寫。
- **程式核對**：GIFT 以單一 INSERT…SELECT 寫入，13 個綁定參數與佔位符逐一對應；整包寫包數與每包張數快照、散裝兩欄為 NULL；價格寫 NULL；收藏與明細存在性及一致性在同一指令內檢查；GIFT 可作為第一筆交易；「已入庫」納入 GIFT；觸發器錯誤 SLEEVE_PRODUCT_PACK_LOCKED／SLEEVE_TRANSACTION_IMMUTABLE 對應 409；收藏附贈查詢獨立失敗隔離。
- **Claude 重跑**：Node 7 檔 **62／62**；詳細頁 Edge **47／47**（含贈送 12 項）；`astro check` **6 個基準錯誤**；`git diff --check` 通過。卡套不足 Edge 8／8、卡套套用 Edge 4／4、採購 Edge 4／4 引用 Codex 回報。Claude 已看 linked-gift-1440、collection-linked-375 截圖。
- **小觀察（不擋）**：
  1. 只連「採購明細」而未填收藏時，`collection_item_id` 維持空值，該贈送**不會出現在**明細所屬收藏的「隨貨附贈的卡套」中；可改為未填收藏時自動帶入明細的收藏。
  2. 產品編輯移除了程式層的「有交易不可改尺寸」檢查，改完全依賴 0025 觸發器；因 28b 本來就必須在 0025 之後部署，行為正確，但 0025 未套用時不可部署（已列為上線前提）。
- **結論**：`SLV-GIFT-28B-20261125-01` 審查通過。尚未提交；上線順序：使用者看截圖 → 正式套用 0025（另起工作命令並授權）→ 依 DEPLOY-01 推送 28b。

- **小觀察 1 已修正（2026-11-25，使用者指示「先修小問題」，Claude 實作）**：`sleeve-admin.ts` 的 GIFT 寫入改為 `collection_item_id = COALESCE(填入的收藏, 採購明細所屬的收藏)`；只連明細的贈送會出現在該明細收藏的「隨貨附贈的卡套」，明確填寫的收藏優先。`tests/sleeve-admin.test.ts` 更新預期並新增收藏 2 的檢查。Claude 驗證：Node 7 檔 **62／62**、詳細頁 Edge **47／47**、`astro check` 6、`git diff --check` 通過。小觀察 2（尺寸鎖定依賴 0025）維持為上線前提。

## 9. 工作命令 28-APPLY：正式套用 0025 與緊接部署 28b（2026-11-25 已授權，DECISION_LOG SLV-GIFT-APPLY-AUTH、SLV-GIFT-DEPLOY）

執行者：Claude（TEAM-04：連網與正式環境操作由 Claude 執行）。流程比照 0023（[D1 完成規劃 §14.6、§15](D1-completion-plan-20261123.md)）。每個關卡不通過即停止；**正式寫入只有 A3 一次**；部署（D）另依 DEPLOY-01 授權，可與本命令一併批准但分開記錄。

### 9.1 0025 盤點（2026-11-25）

- `migrations/0025_sleeve_gift_and_ledger_locks.sql`，192 行，SHA-256 `ae6ae0f3c357ed64e739906bfd25dc78aefbe1e2c8659b32564e95b090fea5dc`（套用前須重新計算並相同）。
- 會刪除：觸發器 `v2_sleeve_inventory_validate_update`、`v2_sleeve_inventory_validate_insert`、`v2_sleeve_inventory_validate_delete`、`v2_sleeve_application_protect_transaction_update`、`v2_sleeve_application_protect_transaction_delete`、`v2_sleeve_application_validate_insert`、`v2_application_requirement_validate`、`v2_requirement_used_no_update`；view `v2_sleeve_inventory_balance`；表 `v2_sleeve_inventory_transactions`（重建後改回原名）。
- 會建立：新交易表（CHECK 含 GIFT）、2 個索引、view、觸發器 `v2_sleeve_inventory_validate_insert`、`v2_sleeve_application_validate_insert`、`v2_application_requirement_validate`、`v2_sleeve_inventory_immutable_update`、`v2_sleeve_inventory_immutable_delete`、`v2_sleeve_product_pack_locked`、`v2_requirement_used_no_update`（新定義）；暫存表 `sleeve_migration_0025_fk_guard` 建立後即刪除。
- 正式前提（2026-11-25 #27 彙總）：交易 0、套用 0、產品 0、需求 786。

```text
工作命令 ID：SLV-GIFT-APPLY-20261125-01
工作目標：在正式 D1 套用 0025 並完成套用後對帳；通過後依 DEPLOY-01 推送 28b，使程式與資料庫同時到位。

A0 提交（本機，不推送）：
  提交 0025、tests/migration-0025.test.ts、28b 程式與測試、相關文件到本機 main（推送留到 D）。
A1 唯讀預檢（正式 D1 唯讀 SELECT 1 次＋Metadata 讀取 1 次）：
  1. 流量版本仍為 9bcb2222（100%）
  2. d1_migrations 24 筆以下且最後一筆為 0023_shared_quantity_commit.sql（預期 23 筆）
  3. 9.1 列出「會刪除」的 8 個觸發器、1 個 view、交易表皆存在；「會建立」的新觸發器名稱（immutable_*、product_pack_locked）
     與 v2_sleeve_inventory_transactions_new、sleeve_migration_0025_fk_guard 皆不存在
  4. 交易筆數、套用筆數、產品筆數、需求筆數（預期 0／0／0／786）；RETURN 為負數的交易 0 筆；sqlite_sequence 中交易表的值（可能不存在）
  5. 使用者確認期間沒有其他人或自動流程更新此 Worker／D1（由使用者在對話中回答）
A2 備份與本機預演：
  1. 正式 D1 官方 Export 1 次 → 專案外、僅目前使用者可存取的私人目錄；回報大小與 SHA-256；不輸出內容。
  2. 以該備份還原到本機記憶體 SQLite，執行「0025 原檔＋ledger INSERT」組合檔：須無錯誤，並跑 A4 對帳查詢得到預期值；
     PRAGMA foreign_key_check 0、integrity_check ok。不通過即停止。
A3 正式套用（正式寫入，僅此 1 次）：
  npx wrangler d1 execute boardgame-collection-db --remote --file <組合檔>
  組合檔 = 0025 原檔（SHA-256 同上）＋ INSERT INTO d1_migrations(name) VALUES ('0025_sleeve_gift_and_ledger_locks.sql');
  組合檔放 Claude scratchpad，不加入 repo。**禁止** wrangler d1 migrations apply（migrations/ 內含未套用候選 0024）。
A4 套用後唯讀對帳（正式 D1 唯讀 SELECT，最多 2 次）：
  1. d1_migrations 比 A1 多 1 筆，最後一筆為 0025_sleeve_gift_and_ledger_locks.sql
  2. 交易表定義含 'GIFT'；9.1「會建立」的 7 個觸發器與 view、2 個索引存在；「會刪除」中未重建的 4 個
     （validate_update、validate_delete、protect_transaction_update、protect_transaction_delete）不存在；sleeve_migration_0025_fk_guard、
     v2_sleeve_inventory_transactions_new 不存在
  3. 交易／套用／產品／需求筆數與 A1 相同
  4. PRAGMA foreign_key_check 無違規
  5. 正式網站唯讀抽查（同 #27 清單）：公開頁 200、Admin 302、/dev/ui-kit 404
D 部署 28b（依 DEPLOY-01，與本命令一併授權時才執行）：
  A4 全數通過後立即推送 main（含 A0 提交），等待新版本 100%，唯讀抽查路由；使用者登入後 Claude 唯讀檢查：
  卡套管理有「贈送／隨貨附贈」選項、收藏「相關採購」分頁有「隨貨附贈的卡套」一節、R01 與尺寸頁與 #27 驗收時相同。
  不在正式環境新增產品或交易（AGENTS.md：不補造資料）。

停止條件：A1 任一項不符；A2 Export、還原或預演失敗；A3 指令非 0 結束或回報錯誤；A4 任一項不符。
  停止後：不重試、不補 ledger、不手動補建物件、不執行任何修復 SQL、不推送 28b；回報實際狀態。
  懷疑部分套用（物件與 ledger 不一致）時立即停止回報；修復需另行授權（可用 A2 備份，但正式還原屬高風險，須另擬計畫）。

風險與已知限制：
  - 0025 套用後不可撤銷（Migration 只能前向）；TX-01 生效後任何交易都不能改刪。
  - 本機已在 SQLite 與 Miniflare D1 驗證整檔原子性；正式 wrangler --remote --file 的回滾行為無法事先證實，以 A2 預演與 A4 對帳降低風險。
  - A3 與 D 之間的空窗：卡套管理修改有交易產品的每包張數會回 503（正式 0 個產品，實際影響為零）；D 應緊接 A4。

禁止事項：除 A3 那 1 次外的任何正式寫入；DML 修資料；Secret、Access、DNS、Worker 設定變更；Preview D1；
  讀取 .env／.dev.vars；在正式環境建立測試資料。

交付：A1 數值、A2 備份證據與預演結果、A3 指令結果與時間、A4 對帳數值、D 的版本與抽查結果、遠端操作次數（Metadata／SELECT／Export／寫入／推送分列）；
  寫入本文件 §9 之後的結果小節，並在 HANDOFF.md 追加條目。
```

### 9.2 執行結果（2026-11-25，Claude 執行）

- **A0**：本機提交 `ac3ef61`（0025＋測試）、`f8435cc`（28b）、`eb64adb`（文件），未推送。
- **A1 唯讀預檢**（Metadata 1、SELECT 1；寫入 0）：流量版本 `9bcb2222` 100%；ledger 23 筆、最後 `0023_shared_quantity_commit.sql`；待刪除觸發器 8／8、view 1、交易表 1 存在；新名稱占用 0；交易 0、套用 0、產品 0、需求 786；負數 RETURN 0；`sqlite_sequence` 無交易表列。使用者確認期間無其他更新（對話選項「確認沒有」）。
- **A2 備份與預演**：官方 Export 1 次 → `D:/CodexHome/private-0025-backup-05752ee314b0/boardgame-collection-db-before-0025.sql`（專案外，ACL 僅目前網域使用者 FullControl、停用繼承；未加入 Git），2,145,230 bytes，SHA-256 `56910856044ad9966b8fe64a5026f928ba856ea2e4787d601d7fe39c47de6902`。以此備份還原到本機記憶體 SQLite 執行組合檔：成功；ledger 23→24、最後 0025；建立觸發器 7、view 1、索引 2；應移除物件殘留 0；資料筆數不變；`foreign_key_check` 0；`integrity_check` ok。
- **A3 正式套用**（寫入 1 次，台北 17:03:48）：`wrangler d1 execute boardgame-collection-db --remote --file <組合檔>`；0025 SHA-256 `ae6ae0f3…` 與審查一致；組合檔 SHA-256 `d5cb6a30…`（scratchpad，未入 repo）；結束碼 0，`changed_db: true`，`last_row_id` 24。
- **A4 套用後對帳**（SELECT 1；寫入 0）：ledger 24 筆、最後 `0025_sleeve_gift_and_ledger_locks.sql`；交易表定義含 GIFT；建立觸發器 7／7（需求鎖定為新定義）；view 1；索引 2；應移除物件殘留 0；交易 0、套用 0、產品 0、需求 786（與 A1 相同）；`pragma_foreign_key_check` 0。網站抽查 8 條：公開 4 條 200、Admin 3 條 302、`/dev/ui-kit` 404。**A1～A4 全數通過。**
- 遠端操作合計（至 A4）：Metadata 1、SELECT 2、Export 1、正式寫入 1。
