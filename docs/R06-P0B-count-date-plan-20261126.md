# R06-P0-B 使用者清點日期｜規劃（2026-11-26，候選）

對應 CURRENT_TASK #14 的 R06-P0-B（後續佇列：「使用者清點日期持久化，需 Schema 變更設計與審查」）。依據是已採納的**日期 C** 與**清點基準**：[清點基準](V2-R05-R06-R09-counting-baseline.md) 第 10～23 行、[11/18 交接](ChatGPT-handoff-current-20261118.md)「已採納：清點、日期與歷史」第 3、6、7 點、[Decision-Ledger](Decision-Ledger-20261119.md) 第 14 列。

狀態：Q80～Q85 **已採納**（全採 A，DECISION_LOG R06-P0B-Q80～Q85，2026-11-26）；§7 工作命令**已授權**（2026-11-26，DECISION_LOG P0B-AUTH）。本文件只做靜態閱讀，沒有執行測試，也沒有讀取正式資料（正式資料數字引用 2026-11-26 0024 套用時的 A1／A4）。這項工作**需要 Migration**（暫定 0026）。

## 1. 現況盤點（2026-11-26 靜態閱讀）

| 項目 | 現況 |
| --- | --- |
| `v2_copy_components`（0007 建立、0017 加 `count_revision`） | 欄位有 `actual_quantity`、`inspection_status`、`notes`、`last_checked_at`、`count_revision`。**沒有使用者清點日期欄位**。`last_checked_at` 由寫入時的 `CURRENT_TIMESTAMP` 填入（UTC，系統儲存時間） |
| 寫入路徑 | 整個 repo **只有一處**寫這張表：`physical-component-management.ts` 的 `count` 動作，用一個條件式 `INSERT … ON CONFLICT DO UPDATE` 寫入，並以 `count_revision` 處理並行；0024 上線後也會擋下不適用的副本 |
| 觸發器 | 0023 在這張表上有身分不可改（`D1_RELATED_IDENTITY`、`D1_COUNT_IDENTITY`）與世代 +1 的觸發器；0020／0025 的卡套套用會參照 `copy_components.id`。加欄位不影響這些觸發器 |
| 0023 證據檢視 `d1_quantity_copy_evidence` | JSON 已預留 `'countDate', NULL`（以及 `completionConfirmedAt`、`boxCompletion` 皆為 `'UNKNOWN'`），`lastSavedAt` 取 `last_checked_at`。D1 更正的預覽憑證與提交都會核對這份證據的摘要 |
| 其他讀取者 | `admin-dashboard-summary.ts`、`purchase-admin.ts`、`sleeve-workflow.ts`、`public-game-collection.ts` 只讀數量或計數，不讀日期；公開投影使用白名單，不會自動帶出新欄位 |
| R06 畫面 | 清點列顯示「目前實點」、數量輸入框和儲存按鈕，每列各自儲存；整頁共用一個副本選擇（UI-D8）。設計圖（霜港實體組件清點介面）**沒有畫出日期欄位** |
| 正式資料（2026-11-26） | 副本 0、清點列 0 → 新欄位不會遇到任何既有資料，也沒有東西需要回填 |
| `migrations/` | 0001～0025 都已套用，目前沒有候選檔 |

## 2. 固定規則（沿用已採納，不需再決策）

1. **日期 C**：一次清點操作共用一個使用者選的日期；預設是台北今天，不能選未來；逐「副本×組件」保存；只更新這次實際送出並成功的項目，沒送出的組件和其他副本保留原日期；失敗或版本衝突時不能留下部分新日期。後端以台北日界驗證。
2. **系統時間不能冒充清點日**：`last_checked_at` 保留原本的意思，也就是系統儲存時間。舊資料沒有清點日期時，**不能**用 `last_checked_at` 回填。
3. **補登 C**：新的成功清點會取代目前數量和日期，日期可以早於目前的日期。不另外提供補登或更正入口。
4. 數量上限、適用性、封膜、在藏等既有清點守衛全部保留，日期只是多加的一個條件。
5. 寫入走既有 Admin API 的同源、Access、限流與 revision 守衛；Migration 只往前加。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q80 | 日期存在哪裡 | 在 `v2_copy_components` 新增 `counted_on`（`YYYY-MM-DD` 文字，可空），和目前數量放在同一列、同一筆寫入 | 另開一張「清點日期」表 | **A**：日期是「目前值」的一部分，同一列才能保證數量和日期一起成功或一起失敗；另開表要多一筆寫入和多一套守衛 |
| Q81 | 這次要不要一起做「每次成功清點的歷史紀錄」（歷史 C） | 不做，留到 P0-C 和整盒完成的轉換事件一起設計 | 這次一起做清點事件表 | **A**：歷史 C 的事件順序機制、冪等（C1／C2）都還沒定，和 P0-C 是同一組問題；正式環境 0 筆清點，延後不會漏掉任何紀錄 |
| Q82 | R06 的日期欄位放哪裡 | 在副本選擇區旁放一個整頁共用的「清點日期」（預設台北今天、不能選未來），每列儲存都用這個日期；每列在「目前實點」下面顯示「清點日期 YYYY-MM-DD」 | 每一列各自有日期欄位 | **A**：符合日期 C「一次操作共用一個日期」，也符合 UI-D8「整頁共用副本選擇」；每列一個日期在手機上太擠 |
| Q83 | 舊資料沒有清點日期時怎麼顯示 | 只顯示「清點日期：未記錄」 | 顯示「未記錄」，旁邊再用小字附上系統儲存時間 | **A**：最不會讓人把系統時間誤認成清點日；正式環境沒有舊資料，這只影響本機 |
| Q84 | D1 更正證據裡預留的 `countDate` 要不要這次填上 | 不填，0023 的檢視和證據格式不動，留到 P0-C 一起處理 | 這次重建 0023 檢視，填入 `counted_on` | **A**：0023 是已審查並在正式環境運作的 D1 證據契約，改它會讓證據摘要格式改變，需要另外審查；D1 預覽目前用不到日期 |
| Q85 | 日期可以選多早 | 只要是有效日期、不晚於台北今天，並且不早於 2000-01-01 | 只限制不能是未來，不設下限 | **A**：擋掉 0001 年這類打錯字；2000 年以前的清點在這個系統不可能發生。這是新增的限制，所以列為決策 |

## 4. 非目標

- 清點事件歷史（Q81 選 A 時）。
- 整盒進度 N／M／U、完成日期與系統確認時間（P0-C）。
- 問題紀錄、批次「全部符合預期」、需要複查。
- R05 手動檢查狀態退役。
- 修改 0023 證據（Q84 選 A 時）。
- 公開網站顯示清點日期。
- 回填任何舊資料。

## 5. 決策後的步驟（全採 A 時）

1. **Migration 0026 候選檔**（Codex，本機）：
   - `ALTER TABLE v2_copy_components ADD COLUMN counted_on TEXT CHECK (counted_on IS NULL OR (length(counted_on) = 10 AND date(counted_on) = counted_on AND counted_on >= '2000-01-01'))`。
   - 加 `BEFORE INSERT`／`BEFORE UPDATE` 觸發器做後端備援：
     - 只要這次寫入讓 `count_revision` 增加，`counted_on` 就不能是 NULL，也不能晚於 `date('now', '+8 hours')`（台北沒有夏令時間，所以固定 +8 可行）。
     - 錯誤碼 `COUNT_DATE_INVALID`。
   - 在 0001～0025 全部套用後的資料庫上驗證：0023 世代、0024 適用性、0025 卡套觸發器仍然有效。
2. **程式與畫面**（Codex，本機）：
   - `count` 動作新增必填欄位 `countedOn`。伺服器以台北日界驗證，錯誤回 400 `INVALID_COUNT_DATE`，然後在同一筆條件式寫入中寫入 `counted_on`。
   - R06 加整頁日期欄位，每列顯示清點日期。
   - 測試：成功、未來日期、格式錯誤、早於下限、版本衝突時日期不變、只更新送出的那一列、恢復適用後原日期保留。
   - 三種寬度截圖，中英各一組。
   - 程式依賴 0026，套用前不得推送。
3. Claude 審查，使用者看截圖。
4. **正式套用 0026**：流程比照 0024 §8（A1 唯讀預檢 → A2 備份與本機預演 → A3 套用 → A4 對帳），每步另行授權。`migrations/` 目前沒有其他未套用的檔案，這次可以考慮改用 `wrangler d1 migrations apply`，屆時另外決定。
5. 推送部署與登入後正式驗收。因為正式環境 0 副本，實際存一筆清點的驗證併入 #23。

## 6. 風險

- `ALTER TABLE ADD COLUMN` 加 CHECK：SQLite 會用新欄位的預設值 NULL 檢查既有資料列；NULL 通過，所以不需要重建資料表。這要在本機預演時確認。
- 觸發器用 `date('now', '+8 hours')` 判斷「今天」，在台北午夜前後和伺服器驗證可能差幾秒；兩邊都採「不晚於台北今天」，最壞情況是午夜前後幾秒內被拒，重試即可。
- 一次清點只送一列，所以「同一操作共用日期」由畫面的整頁日期保證，伺服器只驗證每一筆。多列一次原子提交屬於 R06-UI-01 的非目標（批次確認），之後才需要。

## 7. 工作命令 `P0B-20261126-01`：Migration 0026 候選檔＋程式與畫面（已授權 2026-11-26，P0B-AUTH）

執行者：Codex（本機實作與測試）。依據：DECISION_LOG `R06-P0B-Q80～Q85`；本文件 §1～§6。

**與 P0A 不同，這次 Migration 和程式合成一張工作命令。** 原因是有多個測試 helper 會讀取 `migrations/` 裡的全部檔案（例如 `physical-component-management.test.ts`、`collection-gaps.test.ts`、`admin-dashboard.test.ts`）。只要 0026 一出現，現有的清點寫入就會被新的日期觸發器擋下，如果只先做 Migration，既有測試會壞掉。程式改動只有一個欄位，範圍很小。

**程式依賴 0026：0026 正式套用前不得推送。**

### 7.1 補充盤點（Claude，2026-11-26）

- 直接 `INSERT INTO v2_copy_components` 的測試 fixture 有：`component-applicability`、`d1-0023-review`、`d1-quantity-api`、`helpers/admin-dashboard-preview`、`migration-0025`、`shared-quantity-commit`、`release-migration-chain`、`p3-stage1`、`major03-d1/fixture.sql`。其中只有 1 處明確寫入 `count_revision`；其他都使用預設值 0，不會觸發新的守衛。
- 有些測試用正則只套用到特定編號，例如 `component-applicability`（0001～0025）、`d1-quantity-api`（0001～0024）、`migration-0025`（0001～0023），所以不受 0026 影響。
- `release-migration-chain.test.ts` 第 11 行要求編號連續，0026 必須是 `0026_` 開頭。
- 正式環境 0 個副本：0026 套用後到新程式部署前，舊程式的清點寫入會被觸發器擋下，但正式環境沒有副本可清點，實際影響是零。部署仍應緊接在套用之後。

### 7.2 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `migrations/0026_count_date.sql`（新增） | 依 7.3 |
| `tests/migration-0026.test.ts`（新增） | 依 7.5 第 1 點 |
| `src/lib/physical-component-management.ts`（**高敏感區**） | **只限** `count` 分支：新增必填欄位 `countedOn`、驗證，並在既有的同一個條件式 `INSERT … ON CONFLICT DO UPDATE` 寫入 `counted_on`。create／edit／assign／applicability／quantity-* 逐字保留；revision、適用性、在藏、封膜等守衛不變 |
| `src/lib/physical-component-values.ts` | 新增台北今天、清點日期驗證這類純函式 |
| `src/lib/physical-component-admin-api.ts` | 只限錯誤碼對應（如果需要） |
| `src/components/admin/PhysicalComponentsPanel.astro`、`src/lib/physical-component-admin-controller.ts` | 依 7.4；#12 清點列、P0A 適用性切換、edit／create／assign 的行為逐字保留 |
| 測試 | `tests/physical-component-management.test.ts`、`tests/physical-quantity-browser.mjs`、`tests/admin-collection-detail-browser.mjs`、`tests/release-migration-chain.test.ts`，以及 7.1 列出的 fixture：只增；只有在既有斷言或 fixture 因 0026 或必填 `countedOn` 失敗時，才可補上 `counted_on`／`countedOn` 或改成等價斷言，並逐條回報 |
| `docs/P0B-screenshots/` | 新增截圖；不得覆寫其他截圖資料夾 |
| 本文件 §7.6 | 回報 |

不得修改：0001～0025、0023 的證據檢視與 `countDate`（Q84）、`shared-quantity-*.ts`、`physical-quantity-impact.ts`、`component-applicability.ts`、`component-classifier*.ts`、`physical-component-proof.ts`、`d1-quantity-history.ts`、公開投影、授權／middleware、`wrangler.json`、`astro.config.mjs`。超出範圍時停下回報。

### 7.3 0026 規格

1. `ALTER TABLE v2_copy_components ADD COLUMN counted_on TEXT CHECK (counted_on IS NULL OR (length(counted_on) = 10 AND date(counted_on) = counted_on AND counted_on >= '2000-01-01'));`
2. 觸發器 `v2_copy_components_count_date_insert`：`BEFORE INSERT`，當 `NEW.count_revision >= 1`，而且 `NEW.counted_on IS NULL` 或 `NEW.counted_on > date('now', '+8 hours')` 時，`RAISE(ABORT, 'COUNT_DATE_INVALID')`。
3. 觸發器 `v2_copy_components_count_date_update`：`BEFORE UPDATE`，在以下任一情況 `RAISE(ABORT, 'COUNT_DATE_INVALID')`：
   - (a) `NEW.count_revision > OLD.count_revision`，而且 `NEW.counted_on IS NULL` 或晚於 `date('now', '+8 hours')`；
   - (b) `NEW.counted_on IS NOT OLD.counted_on AND NEW.count_revision = OLD.count_revision`：日期只能隨著成功的清點改變。
4. 不回填既有資料；不新增 view、index 或事件表；不動 `last_checked_at`。
5. 檔案必須能在已套用 0001～0025 的資料庫上單獨執行（正式順序），也必須能和 0001～0025 依檔名順序一起套用。不得破壞 0023 世代、0024 適用性、0025 卡套觸發器。

### 7.4 行為規格

1. **`count` 動作**：新增必填欄位 `countedOn`（`YYYY-MM-DD`）。伺服器依 Asia/Taipei 判斷今天：必須是有效日期，並且在 2000-01-01 到台北今天之間，否則回 400 `INVALID_COUNT_DATE`（中英訊息：「清點日期須為 2000-01-01 到今天之間的有效日期」）。如果寫入時被觸發器以 `COUNT_DATE_INVALID` 拒絕（例如跨過午夜），也對應到同一個 400。成功時回傳新的 `countedOn`。
2. **R06 頁面**：
   - 副本選擇區加一個整頁共用的日期欄位 `<input type="date">`，標籤「清點日期」，預設是伺服器算出的台北今天，`max` 是今天、`min` 是 2000-01-01。
   - 每列儲存都送出這個日期。換副本時日期不重設。
   - 日期無效時，儲存按鈕停用並顯示提示。
3. **每列顯示**：「目前實點」下面顯示「清點日期 YYYY-MM-DD」；`counted_on` 是 NULL 時顯示「清點日期：未記錄」（Q83）。儲存成功後原地更新，不重新載入；`data-count-values` 增加 `countedOn`，切換副本時依該副本顯示。
4. **不變的部分**：適用性不適用的列仍然隱藏輸入；恢復適用後顯示原本的實點和**原本的日期**（S3-B）。版本衝突或失敗時，畫面和資料庫的日期都不變。
5. 中英雙語；1440／768／375 寬度都沒有整頁橫向捲動；WCAG AA；觸控目標 ≥ 44px；日期欄位有可存取的標籤。

### 7.5 測試與驗收

1. **Migration**（`tests/migration-0026.test.ts`，拋棄式 SQLite）：
   - 正式順序（0001～0025 → 0026）和全部依序套用都要成功；
   - 既有列的 `counted_on` 是 NULL；
   - CHECK 會拒絕格式錯誤、無效日期（例如 2026-02-30）和早於 2000-01-01 的日期；
   - 觸發器規則 2、3a、3b，以及 `count_revision = 0` 的 INSERT 不受影響；
   - 0023 世代 +1、0024 適用性寫入、0025 GIFT 與帳本鎖定仍然有效；
   - `foreign_key_check` 0 筆，`integrity_check` 為 ok。
2. **單元**：
   - 成功清點會寫入日期，並保留 `last_checked_at`；
   - 未來日期、格式錯誤、早於下限都回 400，而且零寫入；
   - 版本衝突時日期不變；
   - 只更新送出的那一對副本×組件，其他列的日期不變；
   - 補登較早的日期會成功並取代原日期；
   - 不適用的列仍是 409 `COMPONENT_NOT_APPLICABLE`；
   - 台北日界：伺服器以 Asia/Taipei 判斷今天，可以注入時鐘測試 UTC 15:59／16:00。
3. **瀏覽器**（Edge 暫存 profile、`D1_A3_EDGE_LOCAL_TEST_MODE=1`、輸出到暫存目錄）：
   - 日期預設是今天；
   - 改成較早的日期後儲存，該列原地顯示新日期、沒有重新載入；
   - 重新整理後日期仍在；
   - 切換副本會顯示各自的日期；
   - 舊資料顯示「未記錄」；
   - 未來日期無法儲存；
   - 既有的 `physical-quantity-browser.mjs` 15 項全部通過。
4. **全部回歸**：P0A §7.5 那 17 個 Node 測試檔和 5 支 Edge 腳本全跑；`npm run astro -- check`（完整、含同步，基準 6 errors）；`npm run build`。
5. **截圖**：375／768／1280 各拍「日期欄位＋清點列含已記錄與未記錄日期」，另拍儲存成功後的畫面；英文版 1280 一組。存到 `docs/P0B-screenshots/`。
6. **回報**寫入 §7.6：
   - 新增或修改的檔案；
   - 0026 的 SHA-256；
   - 每條測試指令與結果；
   - 修改了哪些既有斷言或 fixture，以及理由；
   - 截圖清單；
   - 沒有執行的項目。

### 7.6 Codex 執行回報

**2026-11-26（Asia/Taipei）｜0026、count API 與 R06 日期欄位已實作。完整回歸尚未通過。**

- 新增 `migrations/0026_count_date.sql`、`tests/migration-0026.test.ts`。
- 修改 `src/lib/physical-component-values.ts`、`src/lib/physical-component-management.ts`、`src/components/admin/PhysicalComponentsPanel.astro`、`src/lib/physical-component-admin-controller.ts`，以及下列測試和本節。
- 0026 SHA-256：`e16f8b33f7c5d8f5af03c2844b3eb1cb4409446ca63fcd489df9b8a97a0ac2fe`。CHECK 使用 `date(counted_on, '+0 days') IS counted_on`，以拒絕會正規化成其他日期的輸入及 `date()` 回傳 NULL 的非日期文字。未回填舊列。
- 日期與數量以同一筆條件式寫入提交，保留原本守衛及系統儲存時間。畫面另允許使用者明確改選日期後，儲存原實點與補登日期。

**測試指令與結果**

| 指令 | 實際結果 |
| --- | --- |
| `node --import tsx --test tests/admin-collection-detail.test.ts tests/admin-component-classification.test.ts tests/admin-dashboard.test.ts tests/component-applicability.test.ts tests/component-classifier-adapter.test.ts tests/component-classifier.test.ts tests/d1-0023-review.test.ts tests/d1-quantity-api.test.ts tests/d1-quantity-history.test.ts tests/d1-quantity-preview-view.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts tests/release-migration-chain.test.ts tests/shared-quantity-commit.test.ts tests/sleeve-admin.test.ts tests/sleeve-shortage.test.ts tests/sleeve-workflow.test.ts tests/migration-0026.test.ts` | 首輪 193 通過／8 失敗。補齊測試資料庫的 0026 前置，並將 CHECK 合法性測試與觸發器分開後，重跑 200 通過／1 失敗。唯一失敗是 `sleeve-workflow.test.ts` 的共用 fixture。 |
| `node --import tsx --test tests/migration-0026.test.ts tests/physical-component-management.test.ts` | 12 通過／0 失敗。涵蓋正式歷史順序與檔名順序、日期與 NULL、觸發器、0023／0024／0025、台北日界、錯誤碼、回滾與副本隔離。兩個順序的 `foreign_key_check` 都是 0 筆，`integrity_check` 都是 `ok`。 |
| `node tests/physical-quantity-browser.mjs <暫存輸出>` | 結束碼 1，進入瀏覽器案例前，共用 fixture 回 400 `INVALID_COUNT_DATE`。 |
| `node tests/admin-collection-detail-browser.mjs <暫存輸出>` | 結束碼 1，執行至需初始化清點資料時，共用 fixture 回 400 `INVALID_COUNT_DATE`。 |
| `node tests/admin-dashboard-browser.mjs <暫存輸出>` | 7 項通過，結束碼 0。 |
| `node tests/sleeve-shortage-browser.mjs <暫存輸出>` | 8 項通過，結束碼 0。 |
| `node --import <Edge 本機參數預載> --import tsx tests/sleeve-workflow-browser.mjs <暫存輸出>` | 結束碼 1，共用 fixture 回 400 `INVALID_COUNT_DATE`。 |
| `npm run astro -- check` | 在無機密隔離目錄完整執行（含同步），最終 372 檔、6 個基準錯誤、0 個新增錯誤、0 個警告、25 個提示，結束碼 1。首輪新增測試的三個 JSON 型別診斷已修正。 |
| `npm run build` | 最終結束碼 0，四條靜態路由已預渲染。首輪代理誤攔本機預渲染，第一次重試的 Windows 預載路徑解析失敗，修正路徑並限制 fetch 為 loopback 後通過。 |
| `node <暫存隔離副本>/node_modules/.p0b-count-date.mjs <暫存輸出>` | 獨立合成 SQLite 的日期專項通過，涵蓋台北今天預設、歷史日期原地儲存、重整、切換副本、未記錄日期、未來日期停用與雙語。首次專項重用的前置資料覆寫實點，移除該前置後通過。焦點診斷首次未聚焦 Edge 分頁，啟用分頁焦點模擬後通過。 |
| `git diff --check` | 通過。Git 提示既有 CRLF 轉換設定。 |

Edge 使用 `D1_A3_EDGE_LOCAL_TEST_MODE=1`、repo 外暫存 profile、本機 loopback 與拋棄式 SQLite。Astro 關閉遙測、Cloudflare CF 資料抓取與 Wrangler metrics。程式和測試都在本機執行。

**既有測試及 fixture 異動**

- `tests/physical-component-management.test.ts` 的 SQLite fixture 增加 0026，三個既有清點請求補上 `countedOn`。保留原有 revision、數量、適用性和回滾斷言，再加驗無效日期、衝突保留日期、日期回傳、系統儲存時間、較早日期覆寫及副本隔離。
- `tests/d1-0023-review.test.ts` 的兩個比較分支都套用 0026，既有清點請求補上 `countedOn`，讓兩個比較分支可用同一版 count API。
- `tests/shared-quantity-commit.test.ts` 的一筆 revision 1 合成 INSERT 增加 `counted_on`，通過 0026 的 INSERT 守衛。
- `tests/admin-collection-detail-browser.mjs` 的並行修改 fixture 同時寫入 `counted_on` 與遞增 revision，保留原有競態情境。
- `tests/physical-quantity-browser.mjs` 的既有直接 POST 補上 `countedOn`，保留 15 項檢查並追加日期專項情境。
- 上述未刪除既有斷言。共用 `tests/helpers/sleeve-workflow-fixture.ts` 的合成清點請求缺 `countedOn`。該檔未列入 §7.2，維持原樣，待範圍確認。

**截圖與可存取性**

新增五張 1250 px 高的合成資料截圖。中文 [375](P0B-screenshots/zh-count-dates-375.png)、[768](P0B-screenshots/zh-count-dates-768.png)、[1280](P0B-screenshots/zh-count-dates-1280.png)，英文 [1280](P0B-screenshots/en-count-dates-1280.png)，以及 [中文儲存成功 1280](P0B-screenshots/zh-saved-1280.png)。已驗證 375／768／1280／1440 寬度無整頁橫向捲動、日期欄位有標籤、欄高至少 44 px。Edge 測得日期文字、框線、焦點環與欄位底色的對比分別為 10.37:1、5.93:1、7.77:1。

**未執行或未完成**

- 卡套單元流程的後續案例、三支 Edge 腳本被共用 fixture 擋住的後續情境（含既有 15 項 R06 檢查及同一條流程的適用性恢復畫面）。專項驗證使用獨立資料，原共用 fixture 回歸仍待授權。
- 正式 Migration、正式 D1、部署、commit、push 與遠端操作均未執行。

**殘留暫存路徑**

無。已清除本工作單專用的系統暫存目錄。

### 7.7 禁止事項

- 網路存取、任何遠端或正式操作（含 `wrangler d1 … --remote`）、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取或複製 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外的系統暫存目錄，結束前自行清除；刪不掉時回報路徑。

### 7.8 Claude 審查（2026-11-26）

**結論：程式與 0026 通過，有一個條件。** 共用測試 fixture `tests/helpers/sleeve-workflow-fixture.ts` 第 25 行的清點請求缺少 `countedOn`，這個檔案不在 §7.2 允許範圍內（Claude 起草範圍時漏列），所以卡套流程單元測試和 3 支 Edge 腳本的回歸還沒跑完。補上一個欄位，需要使用者授權（P0B-AUTH-02）。

**本人驗證**

- Node：§7.6 同一組 18 個測試檔合跑，**200 通過、1 失敗**（`sleeve-workflow.test.ts`，原因就是上面那個 fixture），和 Codex 回報一致。
- `git diff --check` 通過；0026 SHA-256 `e16f8b33…c2fe` 本人複核相同。Edge、`astro check`、build 沒有重跑，以 §7.6 為準。
- 看過的截圖：`zh-count-dates-375`、`zh-saved-1280`、`en-count-dates-1280`。日期欄位在副本選擇區；已清點的列顯示日期，沒清點的列顯示「未記錄」／「Not recorded」；儲存後原地顯示「已確認」和新日期；375 寬沒有橫向捲動。

**逐項核對**

- **0026**：
  - CHECK 用 `date(counted_on, '+0 days') IS counted_on`，比規格寫的 `date(counted_on) = counted_on` 更嚴格，可以擋掉 SQLite 會自動正規化的不存在日期（例如 2026-02-30）和非日期文字，接受。
  - 兩個觸發器符合 §7.3 第 2、3 點。`count_revision = 0` 的既有 fixture 和舊資料不受影響。
  - 沒有回填，也沒動 `last_checked_at`。
- **伺服器**：
  - `countedOn` 必填，以台北日界驗證範圍和實際存在的日期，錯了就回 400 `INVALID_COUNT_DATE`。
  - 日期在既有的同一筆條件式寫入裡寫入，revision、適用性、在藏、封膜等守衛都沒變。
  - 觸發器的 `COUNT_DATE_INVALID`（例如跨過午夜）也對應到同一個 400。成功時回傳 `countedOn`。
  - 其他動作逐字保留。
- **畫面**：
  - 整頁共用日期，預設台北今天，`min`／`max` 正確；日期無效時所有儲存按鈕停用，並以 `role="status"` 提示。
  - 換副本時日期不重設；切換副本時顯示各副本自己的日期；日期錯誤時可以修正後重送，不會鎖住該列。
  - 實點輸入是 `required`，所以沒清點的列不會因為改了日期就被送出 0。
- **Codex 的額外行為**：使用者**主動改過日期**後，數量沒變的列也可以儲存，等於用新日期重新確認同一個數量。這符合補登 C（新的成功清點取代目前數量和日期），而且只有使用者明確改日期時才會開放，接受。

**小觀察（不擋上線）**

- O1：日期欄位夾在副本下拉選單和「上一個／下一個」之間，把副本選擇和它的切換按鈕隔開了。放到兩個按鈕後面會比較順。
- O2：頁面如果開著跨過午夜，日期欄位的 `max` 還是昨天，要重新整理才能選新的今天。伺服器和觸發器都正確，所以只是不方便。
- O3：日期顯示是 `YYYY-MM-DD`，沒有依語言格式化，和適用性歷史的格式不同。可以接受，以後統一即可。

**待授權（P0B-AUTH-02）**

- 允許修改 `tests/helpers/sleeve-workflow-fixture.ts` 第 25 行：在合成清點請求補上 `countedOn`（固定日期，例如 `'2026-11-01'`），其他內容不變。
- 修好後重跑：`sleeve-workflow.test.ts`、`physical-quantity-browser.mjs`（既有 15 項）、`admin-collection-detail-browser.mjs`、`sleeve-workflow-browser.mjs`。
- 建議由 Claude 直接做，比照 P0A-0024-AUTH-02。

### 7.9 P0B-AUTH-02 執行結果（2026-11-26，Claude）

- 修改 `tests/helpers/sleeve-workflow-fixture.ts` 第 25 行：合成清點請求補上 `countedOn:'2026-11-01'`，其他內容不變。
- Node：§7.6 那 18 個測試檔合跑，**208 通過、0 失敗**。`sleeve-workflow.test.ts` 原本被擋住的子案例現在都通過。
- Edge（`D1_A3_EDGE_LOCAL_TEST_MODE=1`，每次用 scratchpad 裡全新的空輸出資料夾）：
  - `physical-quantity-browser.mjs`：既有 15 項，加上日期專項 1 項，全部通過，結束碼 0。
  - `sleeve-workflow-browser.mjs`（`node --import tsx`）：4 項通過，結束碼 0。
  - `admin-collection-detail-browser.mjs`：**63 項通過後，在第 816 行失敗**（結束碼 1）。
    - 這是「R06 情境 1」的鍵盤順序斷言：預期從副本選單按 Tab 會到「下一個」按鈕，但新的日期欄位放在副本選單和上一個／下一個之間，Tab 先到了日期欄位（`countStep` 是 `undefined`）。
    - 這是版面改動造成的**預期內**變化，不是程式缺陷，也就是 §7.8 的 O1。後面的情境因此沒有執行。
    - 另外兩次重跑因為重複使用同一個輸出資料夾而觸發 `EEXIST`，那是我的執行方式造成的，和程式無關。

**建議修正（P0B-AUTH-03，需要授權）**

1. `PhysicalComponentsPanel.astro`：把「清點日期」移到「上一個／下一個」後面（順便解決 O1），只搬位置，屬性不變。
2. `tests/admin-collection-detail-browser.mjs` 第 816～819 行的鍵盤順序斷言改成新順序：副本選單 → 下一個 → 清點日期 → 實際數量。斷言的意圖不變（鍵盤可以依序到達副本、切換、輸入）。
3. 修完後用全新的資料夾重跑 `admin-collection-detail-browser.mjs` 和 `physical-quantity-browser.mjs`，並重拍 `docs/P0B-screenshots/` 裡受影響的 5 張截圖。

**2026-11-26**：使用者授權 P0B-AUTH-03，交 Codex 執行上面 3 點。Codex 回報請寫入 §7.10。

### 7.10 Codex 執行回報（P0B-AUTH-03）

**2026-11-26（Asia/Taipei）｜P0B-AUTH-03 已實作、已驗證。**

- 修改 `src/components/admin/PhysicalComponentsPanel.astro`，將「清點日期」整組移到「上一個／下一個」之後。欄位內容與屬性保持原樣。
- 修改 `tests/admin-collection-detail-browser.mjs` 的 R06 鍵盤斷言，驗證「副本選單 → 下一個 → 清點日期 → 實際數量」。Edge 可在原生日期欄位內將焦點移過多個分段，測試允許這些內部焦點，並驗證離開日期欄位後的第一個焦點為實際數量。
- 修改本節，並更新下列五張既有截圖。

| 測試指令 | 通過 | 失敗 | 結束碼 |
| --- | ---: | ---: | ---: |
| `node tests/admin-collection-detail-browser.mjs <全新空目錄>` 首次 | 63 | 1 | 1 |
| `node tests/admin-collection-detail-browser.mjs <另一個全新空目錄>` | 72 | 0 | 0 |
| `node tests/physical-quantity-browser.mjs <全新空目錄>` | 16 | 0 | 0 |

每次執行都使用 `D1_A3_EDGE_LOCAL_TEST_MODE=1`、獨立空輸出目錄、暫存 Edge profile 及本機 loopback。首次收藏詳情測試在退出日期欄位的斷言失敗，因為單次 Tab 仍停在日期欄位的內部分段。修正斷言後重跑通過。數量測試涵蓋既有 15 項與日期專項 1 項。`git diff --check` 通過。

**重拍截圖（由實際數量回歸腳本輸出，1250 px 高）**

- [中文 375](P0B-screenshots/zh-count-dates-375.png)
- [中文 768](P0B-screenshots/zh-count-dates-768.png)
- [中文 1280](P0B-screenshots/zh-count-dates-1280.png)
- [英文 1280](P0B-screenshots/en-count-dates-1280.png)
- [中文儲存成功 1280](P0B-screenshots/zh-saved-1280.png)

本輪未重跑 Node 單元測試、其他 Edge 腳本、Astro check 或 build。未執行正式 Migration、部署、commit、push 或遠端操作。

### 7.11 Claude 結案審查（2026-11-26）

**結論：`P0B-20261126-01`（含 AUTH-02、AUTH-03）通過，本機驗證完成。**

**本人驗證**
- Node：18 個測試檔合跑，**208 通過、0 失敗**。
- Edge：每支都用全新的空輸出資料夾，並設 `D1_A3_EDGE_LOCAL_TEST_MODE=1`，**共 107 項全部通過、結束碼都是 0**：

  | 腳本 | 通過 |
  | --- | --- |
  | `physical-quantity-browser` | 16 |
  | `admin-collection-detail-browser` | 72 |
  | `admin-dashboard-browser` | 7 |
  | `sleeve-shortage-browser` | 8 |
  | `sleeve-workflow-browser` | 4 |

- `git diff --check` 通過；0026 SHA-256 `e16f8b33…c2fe`，和 §7.6 相同。
- `astro check` 和 build 沒有重跑，以 §7.6 第一輪為準（6 個基準錯誤、build 通過）。AUTH-03 只搬了一段標記的位置，不影響型別。

**AUTH-03 核對**
- 日期欄位已經移到「上一個／下一個」後面，屬性沒變，O1 已解決。
- 鍵盤斷言改成「副本選單 → 下一個 → 清點日期 → 實際數量」。Edge 的原生日期欄位內部有年／月／日分段會各吃一次 Tab，所以斷言允許最多 5 次分段跳轉，再確認離開日期欄位後的焦點在「實際數量」。這是合理的等價斷言。
- 看過重拍的 `zh-count-dates-375`、`zh-count-dates-1280`：桌面版是「副本、上一個、下一個、清點日期」一列排開。

**剩下的小觀察（不擋上線）**
- O2：頁面開著跨過午夜時，日期欄位的 `max` 停在前一天。
- O3：日期顯示是 `YYYY-MM-DD`，沒有依語言格式化。
- O4（新）：375 寬時按鈕換行，「上一個」和副本選單在同一行，「下一個」和日期欄位在下一行，兩個切換按鈕被拆開。可以考慮讓兩個按鈕成組不換行。

**上線前提**
- 程式依賴 0026。**0026 正式套用前不得推送 `main`**；一推送就會自動部署，清點會被舊資料庫拒絕（不認得 `counted_on`），回 503 或 500。
- 正式套用流程比照 0024 §8：A1 唯讀預檢 → A2 Export 備份與本機預演 → A3 套用（唯一一次正式寫入）→ A4 對帳 → 推送部署 → 登入驗收。每一步都要另外授權。

## 8. 正式套用 0026（P0B-APPLY，比照 0024 §8，每步另行授權）

### 8.1 A0 本機提交

`c554082`（0026、P0B 程式、測試、截圖與文件），未推送（2026-11-26）。本機 `main` 比 `origin/main` 多 3 個提交：`974cf11`、`e3ef386`、`c554082`。

### 8.2 A1 唯讀預檢（2026-11-26，Claude 執行，使用者授權「提交並做 A1」）

遠端操作：Metadata 1 次（`wrangler deployments status`）、唯讀 SELECT 3 次。前 2 次因為查詢裡用了 D1 不允許的 `sqlite_version()`，在解析階段就被拒絕（錯誤 7500），沒有讀到資料；拿掉這一項後第 3 次成功。寫入 0。查詢檔放在 scratchpad。

| 項目 | 預期 | 實際 | 結果 |
| --- | --- | --- | --- |
| 流量版本 | `origin/main`（`dee0033`）的部署 | `8bd8b196`（100%，台北 08:21:38） | 符合 |
| `d1_migrations` | 25 筆，最後一筆是 0024，沒有 0026 | 25 筆，最後 `0024_component_applicability.sql`，0026 為 0 筆 | 符合 |
| `v2_copy_components` 欄位 | 8 個，沒有 `counted_on` | 8 個，`counted_on` 0 個 | 符合 |
| 0026 觸發器 | 2 個都不存在 | 0；這張表目前的觸發器是 5 個（0023 的） | 符合 |
| 資料筆數 | — | 清點列 0、副本 0、定義 178、適用性事件 0、世代列 256（總和 256）、卡套需求 786；schema 物件 279 | 清點列 0，所以 CHECK 和觸發器不會遇到任何既有資料 |
| D1 日期函式探測 | `date('2026-02-30', '+0 days')` 會正規化成另一個日期 | `2026-03-02` | 證實 0026 的 CHECK 在 D1 上能擋下不存在的日期 |
| 台北今天 `date('now', '+8 hours')` | 2026-11-26 | `2026-11-26` | 和伺服器的台北日界一致 |
| 使用者確認期間沒有其他更新 | 使用者在對話中回答 | 使用者回答「確認沒有」（2026-11-26） | 符合 |

**A1 全數通過。**

### 8.3 A2 備份與本機預演（2026-11-26，Claude 執行，使用者授權「開始 A2」）

- **官方 Export 1 次**（唯讀）：`wrangler d1 export boardgame-collection-db --remote` → `D:/CodexHome/private-0026-backup-1e4bc7250a36/boardgame-collection-db-before-0026.sql`。
  - 資料夾在專案外，已停用繼承，只有目前網域使用者有 FullControl；沒有加入 Git。
  - 檔案 2,149,446 bytes，SHA-256 `077a5c13962f923734f2e60652bfa697efb068ce5563b3b22707ffe07294ce32`。
  - 一小時有效的下載連結沒有記錄，備份內容也沒有輸出。
- **組合檔**：0026 原檔（SHA-256 `e16f8b33…c2fe`，`migrations/` 和 HEAD 沒有差異）＋ `INSERT INTO d1_migrations(name) VALUES ('0026_count_date.sql');`，組合檔 SHA-256 `33563609f7996596c45d96477dd3e1b097f451667046192d94021ad94e7bebd7`。放在 scratchpad，不加入 repo。
- **本機預演**（`node:sqlite` 記憶體資料庫，scratchpad 腳本只輸出計數和通過／失敗）：
  - **還原後**和 A1 一致：ledger 25、最後一筆 0024、清點表 8 欄、沒有 `counted_on`、這張表有 5 個觸發器、清點 0、副本 0、定義 178、世代總和 256、卡套需求 786。schema 物件 278，正式環境是 279，差的 1 個是 D1 內部表 `_cf_KV`，和 0024 時相同。
  - **在交易中套用組合檔：成功。**
    - ledger 26，最後一筆是 `0026_count_date.sql`。
    - 清點表 9 欄，多了 `counted_on`。
    - 0026 觸發器 2／2，這張表的觸發器變成 7 個。
    - schema 物件 278 → 280（正好多 2 個）。
    - 所有資料筆數不變，世代總和也不變。
  - `PRAGMA foreign_key_check` 0 筆違規；`integrity_check` 回 `ok`。
  - **寫入測試**：建立一個合成副本，只存在記憶體資料庫，結束就丟棄。10 項全部符合預期：

    | 測試 | 結果 |
    | --- | --- |
    | 沒有日期 | 被拒 |
    | 未來日期 | 被拒 |
    | `2026-02-30` | 被 CHECK 拒絕 |
    | `1999-12-31` | 被 CHECK 拒絕 |
    | `count_revision = 0` 的舊式資料列 | 可寫入 |
    | 有效日期 | 可寫入 |
    | 只改日期 | 被拒 |
    | 重新清點並補登較早日期 | 可寫入 |
    | 重新清點但沒有日期 | 被拒 |
    | 台北今天 | 可寫入 |

- 遠端操作：Export 1 次，寫入 0。**A2 全數通過。**

### 8.4 A3 正式套用（2026-11-26，Claude 執行，使用者授權「只做 A3＋A4」）

- 執行前複核：0026 SHA-256 `e16f8b33…c2fe`、組合檔 SHA-256 `33563609…bbd7`，都和預演時相同；`migrations/` 和 HEAD 沒有差異。
- 台北 2026-11-26 09:39:52～09:40:01 執行 `wrangler d1 execute boardgame-collection-db --remote --json --yes --file <組合檔>`，**正式寫入只有這 1 次**，沒有使用 `migrations apply`。
- 結果：結束碼 0、`success: true`、`changed_db: true`、執行 4 個查詢、寫入 6 列、`last_row_id` 26；資料表仍是 52 張；D1 大小 1.94 MB。

### 8.5 A4 套用後唯讀對帳（2026-11-26）

- 唯讀 SELECT 1 次：
  - ledger 26 筆，最後一筆是 `0026_count_date.sql`，比 A1 多 1 筆。
  - 清點表 9 欄，有 `counted_on`。
  - 0026 觸發器 2／2，這張表的觸發器 5 → 7。
  - schema 物件 279 → 281，正好多 2 個。
  - 清點 0、副本 0、定義 178、適用性事件 0、世代列 256（總和 256）、卡套需求 786，都和 A1 相同。
  - `pragma_foreign_key_check` 0 筆違規。
- 正式網站唯讀抽查 9 條，全部符合：
  - 公開頁 `/`、`/collection`、`/games`、`/about/` 回 200；
  - `/admin`、`/admin/collection/102/components`、`/admin/sleeves?view=sizes`、`/api/admin/sleeves` 回 302 轉到 Access；
  - `/dev/ui-kit` 回 404。
- **A3＋A4 全數通過，0026 已在正式環境就位。**
- 正式環境的程式仍是 `8bd8b196`，存清點時不會帶日期，會被新觸發器擋下；不過正式環境 0 個副本，所以實際影響是零。部署應緊接在後。
- 遠端操作合計（A1～A4）：Metadata 1、SELECT 4（A1 有 2 次因 `sqlite_version` 被拒、沒讀到資料）、Export 1、正式寫入 1、HTTP 抽查 9。
- **還沒做**：推送 `main` 部署 P0B（本機 3 個提交加上這次的紀錄文件）、登入後正式驗收。需要另外授權。
