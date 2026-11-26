# 新增組件時順便清點｜規劃（2026-11-26，候選）

對應 CURRENT_TASK #36（2026-11-26 新增）。**緣起**：使用者在正式環境操作 R06 實體組件管理時反映不順：每新增一個組件，頁面就整頁重新載入，新組件才出現在清點清單；接著還要捲回清單輸入實點、再儲存一次。一盒有十幾種組件時，同樣的步驟要重複十幾次。使用者希望新增時就能順便清點。

狀態：Q136～Q139 **已採納**（全採 A，DECISION_LOG R06-CC-Q136～Q139，2026-11-26）；§5 工作命令**已授權**（2026-11-26，R06-CC-AUTH）。本文件只做靜態閱讀。預期**不需要 Migration**；依建議方案，也**不修改高敏感區的伺服器寫入程式**。

## 1. 現況盤點（2026-11-26 靜態閱讀）

| 項目 | 現況 |
| --- | --- |
| 新增組件（`create`） | `physical-component-management.ts` 第 69 行起。一定要勾「我已確認此組件屬於本收藏」，而且帶冪等鍵；伺服器建立組件定義與已簽章的實體來源，回傳 `{ id }`。同一個鍵重送時，回傳原本的 `id`（`replayed: true`） |
| 清點（`count`） | 同一支 API 的另一個動作：需要 `definitionId`、`definitionRevision`、`copyId`、`revision`（新組件是 0）、`actual`、`countedOn`（P0-B），以條件式寫入處理並行；不適用的副本會被擋下（P0-A） |
| 前端 | `physical-component-admin-controller.ts`：新增（以及編輯、指派）成功後，呼叫 `saved()` → **整頁重新載入**（第 186～189 行）；清點列是另一套原地儲存的邏輯（#12） |
| 頁面狀態 | 清點副本選單與「清點日期」（P0-B）都在頁面上；沒有可清點的副本時，清點清單不顯示 |
| 新組件能不能馬上清點 | 可以：新組件建立時就是「已確認實體組件」，`physical_revision` 是 1，第一次清點的 `revision` 是 0 |

**結論**：只要在前端把「新增」和「清點」依序串起來，就能做到新增時順便清點，不必修改伺服器。

## 2. 固定規則（不需決策）

1. 新增和清點仍是兩個獨立的伺服器動作，各自的驗證與守衛照舊（確認勾選、冪等、簽章、revision、適用性、清點日期）。
2. 順便清點時，使用頁面上**目前選中的副本**與**頁首的清點日期**，和清點列的行為一致。
3. 新增成功、但清點失敗時，組件**保留**（它本身就是合法狀態），畫面明確提示「組件已建立，但這份副本的清點未儲存」，並讓使用者可以在清點清單補存；不會自動刪除組件。
4. 新增重送時，如果伺服器回傳 `replayed: true`，而清點回 409（已經清點過），提示「這筆組件已建立並清點過」，不重複寫入。
5. 沒填實際數量時，行為和現在一樣，只建立組件。
6. 中英雙語；鍵盤可以完整操作；375／768／1280 寬度都沒有整頁橫向捲動；觸控目標至少 44px。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q136 | 「新增時順便清點」怎麼實作 | 新增表單加一個選填的「這份副本的實際數量」；前端先送出新增，拿到組件 ID 後，再送出一次清點。伺服器不改 | 伺服器新增一個「建立並清點」的合併動作，在同一個 batch 完成 | **A**：不必修改高敏感區的寫入程式；兩個動作各自已有完整的守衛與測試；就算第二步失敗，組件仍然是合法狀態，可以補存。B 要修改 `create` 和 `count` 的寫入路徑，需要重新審查整個守衛 |
| Q137 | 存檔之後，畫面怎麼更新 | 不整頁重新載入：在背景重新讀取頁面，只替換「清點清單」和「實體組件清單」兩個區塊；新增表單清空、保持展開，游標回到「名稱」，可以馬上輸入下一筆 | 照舊整頁重新載入，但重新載入後自動展開新增表單、游標放在名稱欄 | **A**：連續新增時最順；伺服器 HTML 仍是唯一的畫面來源，不必在前端重做一份清單。B 比較簡單，但每次仍要等整頁載入、畫面也會跳動 |
| Q138 | 實際數量要不要幫忙帶入預期數量 | 不自動帶入；旁邊放一個「與預期相同」按鈕，按下才填入 | 自動帶入預期數量，可以修改 | **A**：清點的意義是「真的數過」；自動帶入很容易在沒數的情況下就存成已清點。按鈕仍然能省下打字 |
| Q139 | 沒有可清點的副本時（沒有副本、副本已封膜，或這份副本不適用） | 隱藏「實際數量」欄位，並顯示一行說明原因（例如「沒有可清點的在藏未封膜副本」），只建立組件 | 顯示欄位，但設為停用 | **A**：不讓人誤以為填了也會存 |

## 4. 非目標

- 一次新增多筆組件的批次表單。
- 修改伺服器的 `create`、`count` 寫入或守衛（Q136 選 A 時）。
- 改變清點清單本身的操作（#12、P0-A、P0-B 的行為不變）。
- 編輯組件、D1 預期數量更正的流程。
- 整盒進度（P0C1，暫停中）。

## 5. 工作命令 `R06-CREATE-COUNT-20261126-01`（已授權 2026-11-26，R06-CC-AUTH）

執行者：Codex（本機實作與測試）。依據：DECISION_LOG `R06-CC-Q136～Q139`；本文件 §1～§4。**不需要 Migration，不修改伺服器寫入程式。**

### 5.1 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/components/admin/PhysicalComponentsPanel.astro` | **只限**「新增實體組件」表單：加選填的「這份副本的實際數量」欄位（數字，0～上限，與清點列相同）、「與預期相同」按鈕（Q138）、沒有可清點副本時的說明（Q139）；給「清點清單」與「實體組件清單」兩個區塊加上替換用的標記（例如 `data-*` 屬性）。清點列、編輯、指派、D1 更正、適用性的標記與行為逐字保留 |
| `src/lib/physical-component-admin-controller.ts` | **只限**新增流程：(1) 有填實際數量時，`create` 成功後，用回傳的 `id`、`definitionRevision: 1`、`revision: 0`、目前選中的副本與頁首的清點日期送出 `count`；(2) Q137：兩步完成後，不整頁重新載入，改為重新讀取目前頁面並替換兩個區塊，再重新綁定新區塊內清點列、適用性、編輯等既有事件，清空新增表單並把焦點移到「名稱」；(3) §2 第 3、4 點的錯誤處理與提示。編輯、指派、D1 更正、清點列、適用性的既有邏輯不得改變；沒填實際數量時，新增照舊（但同樣套用 Q137 的區塊替換） |
| 測試 | `tests/physical-component-management.test.ts`（只增：確認新增回傳的 `id` 可以立刻用 `definitionRevision: 1`、`revision: 0` 清點，重送時不重複寫入）；`tests/physical-quantity-browser.mjs` 或新增的 Edge 腳本（只增）；既有斷言若因為不再整頁重新載入而需要調整，只能改成等價斷言並逐條回報 |
| `docs/R06-CC-screenshots/` | 新增截圖 |
| 本文件 §5.4 | 回報 |

不得修改：`src/lib/physical-component-management.ts`、`physical-component-admin-api.ts`、`migrations/`、分類器、D1 更正、`component-applicability.ts`、授權／middleware、`wrangler.json`、`astro.config.mjs`。

### 5.2 測試與驗收

1. **單元**：新增後立即清點成功；新增重送時 `replayed: true`，接著清點回 409，DB 只有 1 筆組件與 1 筆清點。
2. **瀏覽器**（Edge 暫存 profile、`D1_A3_EDGE_LOCAL_TEST_MODE=1`、`node --import tsx`、每次全新的空輸出資料夾）：
   - 連續新增 3 筆並各自填實際數量：每一筆存檔後，**頁面沒有整頁重新載入**，清點清單出現新組件並顯示實點與清點日期；表單清空、保持展開，焦點在「名稱」；
   - 新增時不填實際數量：組件出現在清點清單，狀態是「未清點」；
   - 「與預期相同」按鈕把預期數量填入實際數量；預期數量空白時按鈕停用；
   - 清點日期取自頁首（改成較早的日期後新增，該列顯示這個日期）；副本取自目前選中的副本；
   - 注入清點失敗：組件仍然建立，畫面顯示「組件已建立，但這份副本的清點未儲存」，在清單補存後成功；
   - 沒有可清點的副本時，實際數量欄位隱藏，並顯示原因；
   - 替換區塊後，清點列的儲存、適用性切換、編輯組件仍然可用（各操作一次）；
   - 鍵盤操作；375／768／1280 寬度都沒有整頁橫向捲動；中英雙語；
   - 既有的 `physical-quantity-browser.mjs` 全部通過。
3. **回歸**：R06、P0A、P0B、D1 相關的 Node 測試與 Edge 腳本；`npm run astro -- check`（基準 6 errors）；能在本機安全執行時跑 `npm run build`，不能時說明原因。
4. **截圖**：填了實際數量的新增表單、連續新增後的清單、清點失敗的提示、沒有可清點副本時的表單；中文 375、1280，英文 1280。

### 5.3 上線

不需要 Migration。Claude 審查、使用者看過截圖後，依 DEPLOY-01 另行授權推送部署。上線後搭配 #23 暫緩的組件清點驗收一起確認。

### 5.4 Codex 執行回報

**2026-11-26（Asia/Taipei）｜已授權、已實作、已驗證（本機）**。依 `R06-CC-AUTH` 執行。

**新增與修改**

- 修改 `src/components/admin/PhysicalComponentsPanel.astro`。新增表單的實點、手動帶入預期量、無可清點副本說明與表單內存檔提示。沿用清點清單既有的 `data-count-list`，為實體組件清單新增替換標記。
- 修改 `src/lib/physical-component-admin-controller.ts`。送出時擷取副本與清點日期，依序送出 `create` 和選填的 `count`。清點使用建立回傳的 ID、定義 revision 1、清點 revision 0。保留清點失敗時已建立的組件並提示補存，重送且清點回 409 時提示先前已清點。重新讀取頁面並替換兩份清單，重新初始化列事件和編輯表單，清空表單並聚焦名稱。清單讀取失敗會提示重新載入。
- 修改 `tests/physical-component-management.test.ts`、`tests/physical-quantity-browser.mjs`。增加立即清點與冪等驗證，以及 Edge 新增流程、注入清點失敗、補存、事件重綁、鍵盤和響應式驗證。
- 新增 `docs/R06-CC-screenshots/` 的合成截圖，修改本節。刪除的專案檔案為 0。

**既有斷言**。修改 0 條。原有清點、適用性、編輯、指派與 D1 更正斷言照原方式執行。新增瀏覽器案例使用既有清點列的 `#ID 名稱` 作為定位依據。

**本機驗證指令與結果**

下表的 `$shim` 是專案外暫存的 Node 預載。只有 Windows `os.userInfo()` 回 `uv_os_get_passwd ENOMEM` 時提供合成帳號名稱。每次 Edge 執行都預先建立全新空輸出資料夾，並設定 `D1_A3_EDGE_LOCAL_TEST_MODE=1`。Edge 成功啟動並以合成 SQLite 資料進行驗證。

| 指令 | 通過／失敗 | 結束碼與說明 |
| --- | --- | --- |
| `node --import tsx --test tests/physical-component-management.test.ts tests/component-applicability.test.ts tests/physical-quantity-impact.test.ts tests/d1-quantity-api.test.ts tests/d1-quantity-history.test.ts tests/d1-quantity-preview-view.test.ts tests/shared-quantity-commit.test.ts` | 0／7 | 1。七個測試檔在載入 tsx 時被 Windows 帳號查詢錯誤中止。 |
| 同一 Node 指令並加 `--require $shim`，另加 `tests/admin-component-classification.test.ts tests/admin-collection-detail.test.ts tests/sleeve-shortage.test.ts` | 120／2 | 1。新增案例的外層 savepoint 與測試 D1 批次交易衝突，計入案例與父測試各一筆。 |
| `node --require $shim --import tsx --test tests/admin-collection-detail.test.ts tests/admin-component-classification.test.ts tests/admin-dashboard.test.ts tests/component-applicability.test.ts tests/component-classifier-adapter.test.ts tests/component-classifier.test.ts tests/d1-0023-review.test.ts tests/d1-quantity-api.test.ts tests/d1-quantity-history.test.ts tests/d1-quantity-preview-view.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts tests/release-migration-chain.test.ts tests/shared-quantity-commit.test.ts tests/sleeve-admin.test.ts tests/sleeve-shortage.test.ts tests/sleeve-workflow.test.ts tests/migration-0026.test.ts` | 209／0 | 0。將新增案例移至 fixture 的既有斷言之後並清除先前測試插入的溢位資料，避免包裹 D1 批次交易。 |
| `node --require $shim --import tsx tests/physical-quantity-browser.mjs $out` | 16／1 → 0／1 → 16／1 → 16／1 → 20／0 → 20／0 → 20／0 | 1 → 1 → 1 → 1 → 0 → 0 → 0。前四輪依序遇到新案例的列選擇器漏寫編號前綴、DevTools 導航逾時、再現列選擇器問題、DevTools Enter 事件未啟動按鈕。修正後以 Space 驗證鍵盤操作，最後一輪 16 項既有檢查及 4 項新增檢查全過，含 44 px 觸控目標、375／768／1280 px 無整頁橫向捲動。 |
| `node --require $shim --import tsx tests/admin-collection-detail-browser.mjs $out` | 74／0 | 0。包含 R06 清點重試、編輯前置與指派、響應式版面。 |
| `node --require $shim --import tsx tests/admin-dashboard-browser.mjs $out` | 7／0 | 0。 |
| `node --require $shim --import tsx tests/sleeve-shortage-browser.mjs $out` | 8／0 | 0。 |
| `node --require $shim --import tsx tests/sleeve-workflow-browser.mjs $out` | 0／1 | 1。Edge 啟動，但 `Page.enable` 逾時。 |
| `node --require $shim --require $edgeTab --import tsx tests/sleeve-workflow-browser.mjs $out` | 4／0 | 0。獨立暫存預載讓舊腳本接入新建的本機 DevTools 分頁並採相同的 Edge 本機模式。 |
| `npm run astro -- check` | 0／1 → 0／1 → 0／1 | 1 → 1 → 1。三輪各 6、9、6 個錯誤。第二輪的 3 個 DOM 型別診斷已修正。最後一輪 378 檔，6 個基準錯誤、0 個新增錯誤、0 個警告、25 個提示。 |
| `npm run build` | 0／1 → 1／0 → 1／0 → 1／0 | 1 → 0 → 0 → 0。首輪代理攔截本機預渲染，重跑以程序限定的 loopback fetch 守衛完成四條靜態路由預渲染與 Worker 建置。 |
| `git diff --check` | 1／0 | 0。Git 顯示工作樹的 CRLF 轉換提示。 |

Astro 檢查及建置在無機密的專案外暫存副本執行，npm 採離線模式，停用 Astro 遙測、Wrangler metrics 與 Cloudflare CF 資料擷取。6 個基準錯誤位於副本及卡套 controller（各 1）、`tests/shared-quantity-commit.test.ts`（1）、`tests/major03-d1/worker.ts`（3）。

**截圖清單**（`docs/R06-CC-screenshots/`）

- 已填實點的表單：`zh-filled-375.png`、`zh-filled-768.png`、`zh-filled-1280.png`、`en-filled-1280.png`。
- 連續新增後的清點列與名稱焦點：`zh-continuous-375.png`、`zh-continuous-1280.png`。
- 清點失敗與補存提示：`zh-partial-375.png`、`zh-partial-1280.png`。
- 無可清點副本的表單：`zh-no-copy-375.png`、`zh-no-copy-1280.png`、`en-no-copy-1280.png`。

**未執行項目**。正式站人工驗收與登入、遠端 D1／Cloudflare、Migration 部署、commit、push。截圖及測試使用本機合成資料。正式驗收依 §5.3 另單處理。

**殘留暫存路徑**。`D:\temp\r06-cc-fe59f89b-6ffb-43da-bef6-6e6f9a475a9f`。執行環境的工具政策拒絕遞迴刪除已核對的暫存資料夾。內含無機密的隔離專案副本、建置產物、Edge 暫存 profile、合成截圖與本機驗證紀錄。

### 5.6 Claude 審查（2026-11-26）

**結論：功能正確，但回歸還沒全數通過，要先處理 F1。**

**本人驗證**

- Node：`physical-component-management`、`component-applicability`、`d1-quantity-api`、`migration-0026`、`admin-collection-detail`、`sleeve-shortage` 共 6 個測試檔，**64 通過、0 失敗**。`git diff --check` 通過。
- Edge（`D1_A3_EDGE_LOCAL_TEST_MODE=1`、`node --import tsx`、全新的空資料夾）：
  - `physical-quantity-browser.mjs`：**20 項全部通過**，結束碼 0。包含新增的連續新增並順便清點、補存、沒有可清點副本等案例，以及原有的 R06 回歸。
  - `admin-collection-detail-browser.mjs`：**17 項通過後逾時**，結束碼 1，見 F1。§5.4 回報這支腳本 74／0（用 `--require $shim` 執行），Claude 重現不出來。
- 看過的截圖：
  - `zh-continuous-1280`：連續新增後，清單直接出現「#7 Create token 3」並顯示實點與清點日期；表單內顯示「組件已建立並清點。」，焦點回到「名稱」。
  - `zh-partial-375`：清點失敗時，表單內顯示「組件已建立，但這份副本的清點未儲存。可在清點清單補存。」。

**程式核對**

- 伺服器沒有修改（`physical-component-management.ts`、API 都不在 diff 內）。
- `create` 成功後，以回傳的 `id`、`definitionRevision: 1`、`revision: 0`、送出當下選中的副本與頁首日期送出 `count`。新增重送（`replayed`）而清點回 409 時，視為「已建立並清點過」。
- 不整頁重新載入：重新讀取頁面，只替換 `[data-count-list]` 與 `[data-physical-component-list]`；替換後重新綁定清點列（`bindCountRows`）並還原 D1 更正的待處理狀態；目前選中的副本在新頁面消失時，視為失敗並提示重新載入。
- 「與預期相同」按鈕：預期數量是空白或無效時停用，按下才填入。沒有可清點的副本時，不顯示實際數量欄位。
- 新增的提示改放在表單內的 `[data-create-status]`，不再使用全頁的 `[data-physical-status]`。

**F1（必修）：`tests/admin-collection-detail-browser.mjs` 第 407～409 行的斷言過時**

這段測試新增一個組件後，等待「全頁狀態列 `[data-physical-status]` 變成成功」。#36 刻意把新增的提示改到表單內的 `[data-create-status]`，而且不再整頁重新載入，所以永遠等不到，逾時後後面約 57 個案例都沒有執行。修正方式是改成等價的斷言：等待 `[data-create-status]` 的 tone 變成 `success`，組件出現在清單並分類為實體組件的條件不變。這支腳本不在 §5.1 的測試清單裡，需要授權；修好後必須重跑，確認原本的 74 項全部通過，#36 才算完成。

**小觀察（不擋上線）**

- O1：1280 寬時，新增成功或失敗的提示放在表單網格的第一格，和「名稱」欄並排。看得到，但位置有點擠；可以讓它獨佔一列。
- O2：Codex 的暫存資料夾 `D:\temp\r06-cc-fe59f89b-6ffb-43da-bef6-6e6f9a475a9f`，需要使用者手動刪除。

### 5.7 F1 修正（2026-11-26，Claude 執行，DECISION_LOG R06-CC-AUTH-02）

- 修改 `tests/admin-collection-detail-browser.mjs` 第 407～410 行：新增組件後改為等待表單內 `[data-create-status]` 的 tone 變成 `success`（加註 #36），「組件出現在清單並分類為實體組件」的條件不變。
- 檢查同一支腳本的其他地方：第 984～987 行（卡套需求指派）仍然整頁重新載入並使用全頁狀態列，行為沒有改變，所以不用修改；其他 `reload` 都是清點列本身的按鈕或測試主動觸發的重新載入，和 #36 無關。
- 驗證（`D1_A3_EDGE_LOCAL_TEST_MODE=1`、`node --import tsx`、全新的空資料夾）：
  - `admin-collection-detail-browser.mjs`：**74／74**，結束碼 0；
  - `physical-quantity-browser.mjs`：**20／20**，結束碼 0；
  - `git diff --check` 通過。
- **結論：#36（R06-CREATE-COUNT-20261126-01）通過，本機驗證完成。** O1（提示位置）不擋上線，可之後再調整。build 以 §5.4 為準（Codex 回報本機建置成功）。

### 5.8 部署（2026-11-26，Claude 執行，DECISION_LOG R06-CC-DEPLOY）

- 提交 `0585a75`，台北 22:00:53 推送 `f2820cc..0585a75`，共 2 個提交：`152e31c`、`0585a75`。
- Workers Builds 自動部署為 `be49b3b1`（100%，台北 22:02:19）。
- 唯讀抽查 8 條路由全部符合：公開頁 3 條 200；`/admin`、`/admin/collection/262/components`、`/api/admin/collection/components`、`/admin/bgg?view=relations&domain=collection` 回 302 轉到 Access；`/dev/ui-kit` 404。
- 實際驗收：搭配 #23 暫緩的組件清點驗收，由使用者在 #262 操作。

### 5.5 禁止事項

- 網路存取、任何遠端或正式操作、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外，結束前清除；刪不掉時回報路徑。

## 6. 後續：清點清單精簡版面（2026-11-26，Claude 實作，DECISION_LOG R06-COMPACT-B）

**緣起**：#36 上線後，使用者在正式環境截圖指出，每個組件卡片把「預期數量」「目前實點」「清點日期」各放一行，太浪費空間，單位也顯示英文代碼 `(piece)`。使用者選方案 B，交由 Claude 實作。

**修改**（只改 `src/components/admin/PhysicalComponentsPanel.astro`）：
- 資訊合成一行：「預期 30 張 · 實點 30 · 清點日期 2026-11-01」；未清點時顯示「實點 未清點 · 清點日期 未記錄」。設為不適用時，實點與日期會隱藏（用 CSS `:has` 判斷，`[data-applicable-count]` 被隱藏時一起隱藏）。待確認或沒有選副本的組件只顯示「預期 N 單位」。
- 操作合成一行：「實際數量 [ ] 儲存 此副本不適用」。手機寬度時，「此副本不適用」自動換到下一行。
- 單位依語言顯示（件、張、塊、顆、頁、盒、包、組、其他），英文維持英文，用字和 `PhysicalComponentFields.astro` 一致。
- `data-count-current`、`data-counted-on`、`data-applicable-count`、`data-applicability-excluded` 等前端與測試依賴的標記都保留，controller 沒有修改。
- 樣式陷阱：全域的 `.admin-app input`（寬度 100%）與 `.admin-page label`（上下外距）優先權相同而且較晚載入；清點表單在 DOM 裡包在 `[data-applicable-count]`（`display: contents`）裡面，所以必須用較具體的後代選擇器才能生效。

**驗證**：
- Node：`physical-component-management`、`admin-collection-detail`，**17／17**；`git diff --check` 通過。
- Edge（全新的空資料夾）：`admin-collection-detail-browser.mjs` **74／74**、`physical-quantity-browser.mjs` **20／20**。
- 截圖放在 [`docs/R06-COMPACT-screenshots/`](R06-COMPACT-screenshots/)（中文 1280、768、375，英文 1280，儲存成功 1280）。1280 寬時，每個組件卡片高度由約 336px 降到約 158px。

**狀態**：本機驗證完成，等使用者看過截圖後再授權部署；不需要 Migration。

