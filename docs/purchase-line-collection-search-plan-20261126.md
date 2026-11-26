# 採購明細用關鍵字選收藏｜規劃（2026-11-26，候選）

對應 CURRENT_TASK #34（2026-11-26 新增）。**緣起**：使用者在 #23 準備記錄克蘇魯套組的採購時指出，採購明細的「收藏 ID」只能輸入數字；每記一張採購，都要先自己查好、記下每筆收藏的 ID，非常不方便。使用者要求：輸入關鍵字就能帶出收藏。

狀態：Q127～Q130 **已採納**（全採 A，DECISION_LOG PUR-PICK-Q127～Q130，2026-11-26）；§5 工作命令**已授權**（2026-11-26，PUR-PICK-AUTH）。本文件只做靜態閱讀。預期**不需要 Migration**。

## 1. 現況盤點（2026-11-26 靜態閱讀）

| 項目 | 現況 |
| --- | --- |
| 採購明細的收藏欄位 | `src/components/admin/PurchaseLine.astro` 第 8 行：`<input name="collectionId" type="number">`，只能輸入數字；畫面上看不到收藏名稱 |
| 編輯既有採購 | `readPurchase`（`purchase-admin.ts` 第 94～108 行）只讀 `v2_purchase_order_lines.*`，**沒有**收藏名稱，所以既有明細也只顯示數字 |
| 預填入口 | 收藏的「相關採購」分頁有「新增採購（預填此收藏）」（`CollectionPurchasesPanel.astro` 第 38 行），只能預填第一行 |
| 明細的資格 | 寫入時要求收藏屬於正式範圍（`record_scope='production'`）而且未封存，否則整張訂單失敗（`purchase-admin.ts` 第 78～81 行） |
| **現成的收藏搜尋** | R06 的收藏選擇器（#22）：`collection-picker.ts` 的純函式負責組請求與合併結果，呼叫既有的 `GET /api/admin/collection?q=…&scope=production&view=records&limit=20`。可以搜名稱、`BGG:ID`、`NotBGG:ID`、收藏 ID；輸入純數字時，會同時用收藏 ID 和 BGG ID 搜尋；結果會帶「已封存」標記 |
| 授權 | 收藏 API 和採購 API 都走同一套 Admin（Access）守衛，採購頁可以直接呼叫收藏搜尋 API |

**結論**：搜尋 API 與組請求的邏輯都已存在，主要工作在採購頁前端：把數字欄位換成可搜尋的收藏欄位，並讓既有明細顯示名稱。

## 2. 固定規則（不需決策）

1. 送到伺服器的仍然是 `collectionId`（數字）。採購的寫入 API、驗證、分攤、計算規則全部不變。
2. 搜尋沿用既有的收藏清單 API 與 `collection-picker.ts` 的請求和合併規則，不新增搜尋 API。
3. 仍然可以直接輸入收藏 ID：輸入純數字時，結果會依收藏 ID 與 BGG ID 列出，和 R06 選擇器相同。
4. 伺服器的資格檢查照舊（正式範圍、未封存）；畫面上的提示只是輔助，最後以伺服器的結果為準。
5. 中英雙語；鍵盤可以完整操作；手機寬度可用；觸控目標至少 44px。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q127 | 選收藏的操作方式 | 明細欄位直接改成「搜尋下拉」：輸入關鍵字後，在欄位下方列出最多 20 筆結果，點一下或按 Enter 選定；選定後欄位顯示「收藏名稱（#ID）」，旁邊有「更換」按鈕 | 每行加一個「選擇收藏」按鈕，打開對話框，裡面放 R06 那個完整的選擇器（可以翻頁） | **A**：記採購時通常已經知道名稱，下拉最快；20 筆不夠時，再多打幾個字就好。B 每一行都要開關對話框，4 行就要開 4 次 |
| Q128 | 選定收藏後，「商品說明」要不要自動帶入 | 「商品說明」是空的時候，自動填入收藏名稱；之後仍然可以修改；已經有內容就不覆蓋 | 不自動帶入 | **A**：商品說明是必填欄位，大多數時候就是收藏名稱，可以少打一次 |
| Q129 | 搜尋結果中，已封存或不能記採購的收藏怎麼顯示 | 照樣列出，但標示「已封存，不能記採購」且無法選取 | 直接不顯示 | **A**：找不到時能知道是因為已封存，不會以為搜尋壞了 |
| Q130 | 編輯既有採購時，明細怎麼顯示 | 顯示「收藏名稱（#ID）」：伺服器讀明細時一併帶出收藏名稱 | 維持只顯示數字 | **A**：不然打開舊採購還是看不懂每一行是哪筆收藏；只需要在讀取時多 JOIN 一次收藏名稱，不改資料 |

## 4. 非目標

- 修改採購的寫入、驗證、分攤或計算規則。
- 新增搜尋 API，或改變收藏清單 API 的回傳格式。
- #31 套組精靈（暫停中）。
- 在採購頁直接新增收藏。
- 採購清單（`/admin/purchases` 的列表）的版面調整。

## 5. 工作命令 `PUR-PICK-20261126-01`（已授權 2026-11-26，PUR-PICK-AUTH）

執行者：Codex（本機實作與測試）。

### 5.1 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/components/admin/PurchaseLine.astro` | 收藏欄位改成 Q127-A 的搜尋下拉；保留名為 `collectionId` 的欄位（可以是隱藏欄位）給送出使用；預填與既有明細顯示「名稱（#ID）」 |
| `src/lib/purchase-admin-controller.ts` | 搜尋（重用 `collection-picker.ts` 的 `collectionPickerRequests`、`mergeCollectionPickerPages`、`collectionPickerOutcome`）、選取、更換、Q128 自動帶入、Q129 停用；「增加明細」新加的行也要有同樣的行為。送出的 `collectionId` 與既有格式相同；寫入、錯誤處理與冪等的行為逐字保留 |
| `src/lib/purchase-admin.ts` | **只限** `readPurchase` 讀明細時多帶出收藏名稱（例如 `LEFT JOIN v2_collection_items` 取 `display_name`），供 Q130 使用；寫入函式一律不動 |
| `src/pages/admin/purchases/index.astro` | 只限把收藏名稱傳給 `PurchaseLine`，以及預填收藏時帶出名稱 |
| `src/lib/collection-picker.ts` | 只在需要讓純函式可以重用時才修改（例如匯出型別）；R06 選擇器的行為不得改變 |
| 測試 | 新增 `tests/purchase-line-picker.test.ts`（純函式與讀取），以及採購頁的 Edge 腳本（新增或擴充既有腳本）；既有採購與 R06 選擇器測試只增 |
| `docs/PUR-PICK-screenshots/` | 新增截圖 |
| 本文件 §5.4 | 回報 |

不得修改：`migrations/`、收藏清單 API 與其伺服器邏輯、採購寫入與分攤、R06 頁面、授權／middleware、`wrangler.json`、`astro.config.mjs`。

### 5.2 測試與驗收

1. **單元**：
   - `readPurchase` 會帶出收藏名稱，收藏不存在時名稱是 null；
   - 原本的金額守衛與 `locked` 判斷不變；
   - 純數字查詢會同時依收藏 ID 與 BGG ID 搜尋，結果去重；
   - 已封存的結果標示為不可選。
2. **瀏覽器**（Edge 暫存 profile、本機拋棄式資料、全新的空輸出資料夾）：
   - 輸入名稱 → 選取 → 欄位顯示「名稱（#ID）」、商品說明自動帶入；
   - 商品說明已有內容時不被覆蓋；
   - 輸入收藏 ID 也能選到；
   - 已封存的收藏無法選取；
   - 「增加明細」新行可以搜尋；
   - 「更換」可以重新選擇；
   - 送出 4 行明細的新採購，伺服器收到的 `collectionId` 正確，採購建立成功；
   - 編輯既有採購時，明細顯示名稱；
   - 搜尋 API 失敗時顯示「暫時無法搜尋」，仍然可以直接輸入 ID；
   - 鍵盤操作（Tab、上下鍵、Enter、Esc）；
   - 375／768／1280 寬度都沒有整頁橫向捲動；
   - 中英雙語。
3. **回歸**：採購、收藏清單、R06 選擇器、收藏詳細頁相關的 Node 測試與 Edge 腳本；`npm run astro -- check`（基準 6 errors）；`npm run build`。
4. **截圖**：搜尋下拉展開、選定後、既有採購的編輯畫面，各 375 與 1280 寬；英文 1280 一組。

### 5.3 上線

不需要 Migration。Claude 審查、使用者看過截圖後，依 DEPLOY-01 另行授權推送部署；上線後使用者用克蘇魯套組的採購實際驗收（併 #23）。

### 5.4 Codex 執行回報

（待填）

### 5.5 禁止事項

- 網路存取、任何遠端或正式操作、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外，結束前清除；刪不掉時回報路徑。
