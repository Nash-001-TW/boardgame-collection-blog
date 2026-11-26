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

**2026-11-26（Asia/Taipei）｜已實作**。新增、既有與預填明細共用逐行收藏搜尋。搜尋重用既有收藏 API 與 R06 純函式，最多顯示 20 筆，封存結果可見且停用。搜尋失敗時可明確選用正整數 ID。選取後補入空白商品說明，手動輸入 ID 時仍由使用者填寫說明。新增四行採購的實際 POST 已驗證為數字 `collectionId`；`readPurchase` 的唯一變更是以 LEFT JOIN 補上收藏名稱。採購寫入、金額守衛、分攤、冪等與 R06 行為維持原契約。

**檔案**

- 修改 `src/components/admin/PurchaseLine.astro`、`src/lib/purchase-admin-controller.ts`，新增中英搜尋、鍵盤操作、封存提示、更換及 ID 備援。
- 修改 `src/lib/purchase-admin.ts`、`src/pages/admin/purchases/index.astro`，補讀既有與預填收藏名稱，名稱缺少時顯示 ID。
- 新增 `tests/purchase-line-picker.test.ts`，驗證雙查詢合併、封存標記、明細名稱及既有讀取守衛。修改 `tests/purchase-admin-browser.mjs`，在隔離 SQLite 與本機收藏 API 驗證選取、四行送出、操作與截圖。
- 新增 `docs/PUR-PICK-screenshots/` 九張截圖，修改本節。刪除 0 個專案檔案。

**測試指令與結果**

Edge 每次執行都傳入全新的空 `$pickOut`，存放個別暫存 profile。Windows 的 tsx 帳號查詢及 Edge GPU 限制以程序限定的暫存 preload 處理。Edge 使用合成資料與 loopback；各次 Edge 數字按腳本輸出的驗收組計算。

| 指令 | 通過／失敗 | 結束碼與結果 |
| --- | --- | --- |
| `node --import tsx --test tests/purchase-line-picker.test.ts tests/purchase-admin.test.ts tests/admin-collection-list.test.ts tests/collection-picker.test.ts tests/admin-collection-detail.test.ts` | 0／5 → 28／1 → 29／0 | 1 → 1 → 0。首輪五個測試檔因 tsx 帳號查詢 ENOMEM 未載入。第二輪的新增金額 fixture 在 SQLite 轉換時先拋錯，改用小數後命中原有 `AMOUNT_OUT_OF_RANGE` 守衛。 |
| `node --import tsx tests/purchase-admin-browser.mjs $pickOut` | 0／1 → 5／0 → 5／0 → 5／0 → 5／0 | 1 → 0 → 0 → 0 → 0。首輪 DevTools 未就緒。後續重跑涵蓋型別修正前後的實際 POST、44px、鍵盤及最終截圖。 |
| `node --import tsx tests/admin-collection-list-browser.mjs $pickOut` | 0／1 → 12／0 | 1 → 0。首輪 DevTools 未就緒。 |
| `node --import tsx tests/admin-collection-detail-browser.mjs $pickOut` | 0／1 → 74／0 | 1 → 0。首輪 DevTools 未就緒。現行 R06 分頁、舊入口轉址及收藏相關採購均通過。 |
| `node --import tsx tests/collection-picker-browser.mjs $pickOut` | 0／1 → 0／1 | 1 → 1。首輪 DevTools 未就緒。重跑在首個導覽等待舊網址逾時，UI 階段 5b 已將該路由改為 302，舊選擇器測項未進入。保留歷史腳本，R06 純函式測試 6／6 通過。 |
| `npm run astro -- check` | 三次各 3、2、6 個型別錯誤 | 三次結束碼皆為 1。前兩次在僅含來源的暫存副本執行，首輪發現的 `append` 型別衝突已改用 `appendChild`。最後納入測試檔，376 檔、6 個基準錯誤、0 警告、25 提示。基準為副本與卡套 controller 的兩個 `root` 重宣告、`shared-quantity-commit.test.ts` 一處 D1 型別轉換、`tests/major03-d1/worker.ts` 三處布林映射。 |
| `npm run build` | 0／1 → 0／1 → 0／1 → 1／0 | 1 → 1 → 1 → 0。前兩輪已編譯，Miniflare 預渲染的本機登錄寫入受限。第三輪改用暫存 XDG 目錄後，預渲染的本機 HTTP 遭離線代理攔截。最終將本機 IPv4／IPv6 位址納入代理例外，離線建置完成。 |
| `git diff --check` | 1／0 | 0。 |

**既有斷言**。原有結果斷言沒有刪除或削弱。採購 Edge 有三處把直接填寫 `collectionId` 的步驟改為操作可見的搜尋選項，因欄位已隱藏。原採購金額、分攤、狀態、權限及副本斷言繼續執行。R06 與收藏清單測試檔未修改。

**截圖**。皆為隔離合成資料。搜尋展開、選定後、編輯既有採購各保存三張。

| 畫面 | 繁中 375 | 繁中 1280 | 英文 1280 |
| --- | --- | --- | --- |
| 搜尋展開 | [search-zh-375.png](PUR-PICK-screenshots/search-zh-375.png) | [search-zh-1280.png](PUR-PICK-screenshots/search-zh-1280.png) | [search-en-1280.png](PUR-PICK-screenshots/search-en-1280.png) |
| 選定後 | [selected-zh-375.png](PUR-PICK-screenshots/selected-zh-375.png) | [selected-zh-1280.png](PUR-PICK-screenshots/selected-zh-1280.png) | [selected-en-1280.png](PUR-PICK-screenshots/selected-en-1280.png) |
| 編輯既有採購 | [edit-zh-375.png](PUR-PICK-screenshots/edit-zh-375.png) | [edit-zh-1280.png](PUR-PICK-screenshots/edit-zh-1280.png) | [edit-en-1280.png](PUR-PICK-screenshots/edit-en-1280.png) |

**未完成驗證與執行邊界**。舊 R06 選擇器的互動本輪尚未執行測試驗證，原因是舊入口已退役。未執行正式資料與真機驗收、遠端操作、部署、commit 或 push。本單回報依 §5.1 僅寫入本節。

**殘留暫存路徑**。已移除程序 preload。執行環境政策拒絕 PowerShell 遞迴清理，即使用已核對的完整個別路徑也被攔截。以下目錄仍在 `D:\TEMP\`，內容為隔離副本、合成驗收輸出與 Edge 暫存 profile。

- `PUR-PICK-admin-collection-detail-7ad5b4f13e33459c986a4aa916722006`
- `PUR-PICK-admin-collection-detail-a462670a221e42e5a1bd18c4080404bd`
- `PUR-PICK-admin-collection-list-896e334db1854987ad544fdc983cd34c`
- `PUR-PICK-admin-collection-list-c837454ad9824feda4819fa3656eb0cc`
- `PUR-PICK-astro-785ee4b2346e41f8a4279170ceeca540`
- `PUR-PICK-collection-picker-723fb547c42a44e1815db31e5c44a562`
- `PUR-PICK-collection-picker-d14bf57ce9434116bec22b0e98bf4b84`
- `PUR-PICK-purchase-admin-245c00768e164c488a48172c3fd4e00f`
- `PUR-PICK-purchase-admin-4002eb41d26c4e728eeb35706edc5eec`
- `PUR-PICK-purchase-admin-c9ba729700e142cd9ebdbe0d5b73fc59`
- `PUR-PICK-purchase-admin-cf4f2d0885234d9b9bb6ab92177a32b9`
- `PUR-PICK-purchase-admin-f1990a4d2a244ee0a632ab20e68c9277`

### 5.6 Claude 審查（2026-11-26）

**結論：`PUR-PICK-20261126-01` 通過。** 沒有必修項目。

**本人驗證**

- Node：`purchase-line-picker`、`purchase-admin`、`collection-picker`、`admin-collection-detail`、`series-spending`、`admin-dashboard-summary` 共 6 個測試檔，**41 通過、0 失敗**。
- Edge（`D1_A3_EDGE_LOCAL_TEST_MODE=1`，每次都用全新的空資料夾）：
  - `purchase-admin-browser.mjs`：**5 項全部通過**。這支腳本要用 `node --import tsx` 執行，和 §5.4 相同；直接用 `node` 執行會在載入 TS 模組時失敗，這和程式無關。
  - `admin-collection-detail-browser.mjs`：74 項通過。
- `git diff --check` 通過。`astro check` 和 build 沒有重跑，以 §5.4 為準（6 個基準錯誤、離線建置通過）。
- 看過的截圖：
  - `search-zh-375`：輸入關鍵字後，下拉列出「名稱（#ID）」，已封存的項目顯示為灰色並標示「已封存，不能記採購」；
  - `edit-zh-1280`：每一行都顯示「名稱（#ID）」與「更換」，商品說明已自動帶入，手動填寫的「Fallback fixture line」沒有被覆蓋。

**程式核對**

- **伺服器只改讀取**：`readPurchase` 用 `LEFT JOIN v2_collection_items` 多帶出 `collection_name`；收藏不存在時是 NULL，畫面只顯示 `#ID`。金額守衛與 `locked` 判斷不變。採購頁在「預填此收藏」時，多查一次收藏名稱。寫入、驗證、分攤都沒有修改。
- **送出格式不變**：隱藏欄位 `collectionId` 照舊送出數字。還沒選取收藏時，搜尋框設有自訂驗證訊息「請先選擇收藏」，表單無法送出；選取後搜尋框改為停用，就不再阻擋。所以不會送出空的收藏 ID。
- **搜尋重用既有邏輯**：直接呼叫 `collectionPickerRequests`、`collectionPickerOutcome`、`mergeCollectionPickerPages` 與既有的 `GET /api/admin/collection`，R06 選擇器的檔案沒有修改。輸入停頓 200ms 後才送出搜尋，新的輸入會取消前一個請求，8 秒逾時。
- **決策對照**：
  - Q127：下拉選單與「更換」；
  - Q128：商品說明空白時才帶入；
  - Q129：已封存的收藏設為 `aria-disabled`，點了沒有作用；
  - Q130：編輯時顯示名稱；
  - 搜尋失敗時，輸入純數字可以按「直接使用此收藏 ID」。
- **無障礙**：使用 `combobox`、`listbox`、`option`、`aria-activedescendant`；支援上下鍵、Enter、Esc；用 `isComposing` 避免中文輸入法選字時誤觸 Enter；觸控目標 44px。

**小觀察（不擋上線）**

- O1：選定收藏之後，原本的「搜尋收藏」標籤會跟著隱藏，那一格只剩「名稱（#ID）＋更換」，沒有欄位名稱。看得懂，但可以補一個「收藏」小標。
- O2：`collection-picker-browser.mjs`（R06 舊選擇器的 Edge 腳本）會逾時。原因是舊入口 `/admin/collection/components/manage` 自 UI 階段 5（Q49）起改為轉址，腳本卻還在等舊畫面。這是早就過時的腳本，不是這次造成的；共用的搜尋函式與現行 R06 分頁的回歸都已通過。建議和其他過時測試一起整理。
- O3：Codex 留下的暫存資料夾（見 §5.4），需要使用者手動刪除。

**上線**：不需要 Migration。依 DEPLOY-01 另行授權推送部署；上線後使用者用克蘇魯套組的採購實際驗收（併 #23）。

### 5.5 禁止事項

- 網路存取、任何遠端或正式操作、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外，結束前清除；刪不掉時回報路徑。
