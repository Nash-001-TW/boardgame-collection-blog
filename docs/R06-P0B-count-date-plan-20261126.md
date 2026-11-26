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

（待填）

### 7.7 禁止事項

- 網路存取、任何遠端或正式操作（含 `wrangler d1 … --remote`）、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取或複製 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外的系統暫存目錄，結束前自行清除；刪不掉時回報路徑。
