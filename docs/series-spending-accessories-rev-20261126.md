# 系列花費：配件改列「相關配件」｜規劃與工作命令（2026-11-26，候選）

對應 CURRENT_TASK #29 的修訂（依 DECISION_LOG **SERIES-Q64-REV-01**，2026-11-26 已採納）。**原則**：系列合計只計入系列內各收藏自己的採購分攤；沿著配件關係帶進來的配件收藏，一律改列在「相關配件」區塊，顯示配件自己的採購成本，**不併入**系列合計。依據還有 ACC-Q112：成本以採購訂單與明細為準，不以配件適用關係決定。

狀態：Q124～Q126 **已採納**（全採 A，DECISION_LOG SERIES-Q124～Q126，2026-11-26），補充邊界見 §5；§4 工作命令已依審查意見補強（§5.3），**已授權**（2026-11-26，SERIES-ACC-AUTH）。本文件只做靜態閱讀。**不需要 Migration**。

## 1. 現況盤點（2026-11-26 靜態閱讀 `src/lib/series-spending.ts`）

- **找本體（上溯）**：從目前的收藏往上找本體，依據是收藏關係與遊戲關係的 `requires_base`、`expansion_of`、`accessory_for`，以及 R16 的 `site_game_relations`（配件 → 遊戲）。所以從**配件收藏**打開時，也會找到本體。
- **成員（直接關係）**：本體的直接關係都算成員，包括：
  - 收藏關係：`bundle_contains`、`other` 以外的全部類型；
  - 遊戲關係：`requires_base`、`expansion_of`、`accessory_for`、`same_series`；
  - R16 關係：配件 → 本體的 `accessory_for`（專用）與 `compatible_with`（相容）。

  每個成員只保留一種關係類型，優先順序是：`expansion_of` → `requires_base` → `accessory_for` → `compatible_with` → `same_series` → `standalone_related` → `integrates_with`（第 65～69 行）。
- **合計**：所有成員（含配件）的分攤列，依幣別加總（第 98～118 行）。「尚未記錄成本」的筆數、卡套的已套用與附贈張數、共用禮包判定，也都以全部成員計算。
- **畫面**：`CollectionPurchasesPanel.astro` 第 84～124 行，有成員表、合計、尚未記錄筆數、共用禮包、卡套一行。
- **測試**：`tests/series-spending.test.ts`、`tests/admin-collection-detail.test.ts`、`tests/admin-collection-detail-browser.mjs`。

**和 Q64-REV-01 的差距**：配件成員目前直接計入合計，必須改成另列。

## 2. 固定規則（依已採納決策，不需再決定）

1. **哪些成員算配件**：成員最後採用的關係類型是 `accessory_for` 或 `compatible_with`。不論是來自收藏關係、遊戲關係還是 R16，都算配件。同時有擴充關係和配件關係的成員，依既有的優先順序視為擴充（不改 Q64 的其他部分）。
2. 配件的成本只來自配件自己的分攤列（ACC-Q112），讀法和成員成本相同：依幣別、只計已付款、部分收貨、完成的訂單。
3. 上溯本體、直接關係、不遞迴、100 款上限、共用禮包（Q65）的規則都不變。
4. R01 和採購頁的全站總額不受影響。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q124 | 「相關配件」區塊要不要顯示小計 | 每個配件列出自己的成本，另外依幣別顯示小計，並明確標示「不併入系列合計」 | 只列每個配件的成本，不加小計 | **A**：方便看這個系列的配件總共花了多少；系列之間本來就不相加，所以就算一個共用配件出現在多個系列的小計裡，也不會造成全站重複計算 |
| Q125 | 配件要和哪些系列層級的統計分開 | 全部分開：配件不計入系列合計、「尚未記錄成本」筆數、卡套的已套用與附贈張數、共用禮包判定；配件區塊另外顯示自己有幾款尚未記錄成本 | 只從系列合計排除，其他統計照舊包含配件 | **A**：「系列」和「相關配件」的口徑一致，比較好解讀；配件通常也沒有卡套 |
| Q126 | 從配件收藏打開系列花費時，要怎麼顯示 | 和現在一樣，找到本體並顯示整個系列；這個配件列在「相關配件」區塊並標示「目前收藏」 | 顯示「配件不屬於任何系列」，不顯示系列 | **A**：保留現有的導覽行為，只改變它被歸類的區塊 |

## 4. 工作命令 `SERIES-ACC-20261126-01`（已授權 2026-11-26，SERIES-ACC-AUTH）

執行者：Codex（本機實作與測試）。

### 4.1 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/lib/series-spending.ts` | 依 §2-1 把成員分成「系列成員」與「相關配件」。系列合計、尚未記錄筆數、卡套統計、共用禮包判定只用系列成員；配件另外查成本，回傳 `accessories`（含各自的成本）、`accessoryTotals`、`accessoryMissing`。上溯、直接關係、100 款上限與既有欄位語意都不變，**不得使用複合 SELECT** |
| `src/components/admin/CollectionPurchasesPanel.astro` | 在系列成員表之後，加上「相關配件」區塊：列出配件名稱、關係類型（專用或相容）、成本；顯示小計並標示「不併入系列合計」；顯示尚未記錄成本的筆數；目前收藏是配件時加上「目前收藏」標記；沒有配件時不顯示這個區塊。中英雙語 |
| 測試 | `tests/series-spending.test.ts`、`tests/admin-collection-detail.test.ts`、`tests/admin-collection-detail-browser.mjs`：只增；既有斷言因為配件不再計入合計而失敗時，只能改成等價斷言，並逐條回報 |
| `docs/SERIES-ACC-screenshots/` | 新增截圖 |
| 本文件 §4.4 | 回報 |

不得修改：`migrations/`、`purchase-admin.ts`、`relation-admin.ts`、`site-game-relations.ts`、R01、公開網站、授權／middleware、`wrangler.json`、`astro.config.mjs`。

### 4.2 測試與驗收

1. **單元**（拋棄式 SQLite，套用全部 Migration）：
   - 收藏層 `accessory_for`、遊戲層 `accessory_for`、R16 專用與相容各自帶進來的配件，都歸入「相關配件」，不計入系列合計；
   - 擴充、同系列照舊計入；
   - 同時有擴充和配件關係的成員，視為擴充；
   - 配件的成本依幣別分組，只計三種有效的訂單狀態；
   - 配件的尚未記錄筆數；
   - 配件不計入卡套統計與共用禮包判定；
   - 從配件收藏打開時，找得到本體，並標示「目前收藏」；
   - 多幣別；
   - 100 款上限的截斷行為不變；
   - 讀取失敗時拋出錯誤。
2. **瀏覽器**（Edge 暫存 profile、全新的空輸出資料夾）：
   - 相關配件區塊顯示正確；
   - 小計和標示文字正確；
   - 沒有配件時不顯示區塊；
   - 375／768／1280 寬度都沒有整頁橫向捲動；
   - 中英雙語；
   - 既有的收藏詳細頁 Edge 驗收全部通過。
3. **回歸**：系列花費、收藏詳細頁、採購、R01 相關的 Node 測試；`npm run astro -- check`（基準 6 errors）；`npm run build`。
4. **截圖**：有配件的系列（中文 375、1280；英文 1280），以及從配件收藏打開的畫面（1280）。

### 4.3 上線

不需要 Migration。Claude 審查通過後，依 DEPLOY-01 另行授權推送部署。依 §5.2 的唯讀核對，正式環境目前三種配件關係都是 0 筆，上線後畫面和現在相同；等使用者第一次建立配件收藏並設定關係時，再實際驗收。

### 4.2.1 補強的驗收案例（依 §5.3，必須全部涵蓋）

| 編號 | 情境 | 預期結果 |
| --- | --- | --- |
| TC01 | 同一配件同時存在三種關係來源 | 只顯示一次，不重複計費 |
| TC02 | 同一配件適用兩個不同系列 | 兩個系列各自顯示參考成本；全站總額不變 |
| TC03 | 同時有擴充與配件關係 | 歸為擴充，不在配件區重複出現 |
| TC04 | 配件有效採購成本為 0 | 顯示 0 元，不算「尚未記錄」 |
| TC05 | 配件沒有有效採購成本 | 計入配件「尚未記錄」筆數 |
| TC06 | 配件的分攤來自不符合資格的訂單狀態 | 不計入配件小計 |
| TC07 | 同一張訂單同時有遊戲與配件 | 依既有分攤分開計入系列合計與配件小計 |
| TC08 | 配件有卡套紀錄 | 不計入系列卡套張數 |
| TC09 | 從適用多個系列的配件打開 | 沿用既有的本體選擇規則（多個本體時顯示候選） |
| TC10 | 系列成員加配件超過 100 款 | 維持原有上限與截斷契約（見 §5.1） |
| TC11 | 完全沒有相關配件的系列 | 回傳與畫面和改版前一致 |
| TC12 | 配件關係封存 | 不再列入相關配件；採購成本不變 |
| TC13 | 改版前後全站採購成本比較 | 各幣別總額完全一致 |
| TC14 | 配件成本資料讀取失敗 | 拋出錯誤，不得用 0 元掩蓋 |

### 4.4 Codex 執行回報

**2026-11-26（Asia/Taipei）** — `SERIES-ACC-20261126-01`（`SERIES-ACC-AUTH`）已授權、已實作。TC01～TC14 的本機驗證與整組回歸結果如下。

#### 檔案

- 修改 `src/lib/series-spending.ts`。沿用原始關係搜尋、優先序、去重與截斷，在保留目前收藏的 100 款清單內拆分。系列及配件各自查採購分攤，同一批次讀取。系列的卡套、缺成本及共用禮包統計只使用系列成員。任一查詢失敗會讓整次系列讀取失敗。
- 修改 `src/components/admin/CollectionPurchasesPanel.astro`。新增中英相關配件、關係類型、各自成本、分幣別小計及缺成本筆數。配件詳細頁標示目前收藏。
- 修改 `tests/series-spending.test.ts`、`tests/admin-collection-detail-browser.mjs`。增加 SQLite 與 Edge 驗證。`tests/admin-collection-detail.test.ts` 原樣執行。
- 修改本節。新增下列四張合成截圖。刪除 0 個專案檔案。

#### 執行指令與結果

Node 的 `$fallback` 是程序限定的 data URL preload。只在 Windows `os.userInfo()` 回傳 `uv_os_get_passwd ENOMEM` 時提供合成帳號名稱，其他錯誤照常拋出。Edge 每次以新的空白 `$edgeOut` 執行，使用暫存 Edge profile，設定 `D1_A3_EDGE_LOCAL_TEST_MODE=1`、`LOCALAPPDATA=$edgeOut`，並沿用腳本的本機代理限制。

| 指令 | 通過／失敗、結束碼及結果 |
| --- | --- |
| `node --import tsx --test tests/series-spending.test.ts tests/admin-collection-detail.test.ts tests/purchase-admin.test.ts tests/admin-dashboard.test.ts tests/admin-dashboard-summary.test.ts` | 首次 0／5，結束碼 1。5 檔均在載入 tsx 時遇到 Windows ENOMEM，未進入測試案例。 |
| `node --import $fallback --import tsx --test tests/series-spending.test.ts tests/admin-collection-detail.test.ts tests/purchase-admin.test.ts tests/admin-dashboard.test.ts tests/admin-dashboard-summary.test.ts` | 兩次開發中執行各 34／4，結束碼均為 1。各有 3 項既有 R01 摘要失敗，另有 1 項新 fixture 問題，依序為未登記的 R16 目標識別及 R01 查詢誤套系列 SELECT 守衛。最終版 **35／3**，結束碼 1。系列 9／0、收藏詳細 6／0、採購 10／0、R01 頁面 5／0、R01 摘要 5／3。 |
| `node --import $fallback --import tsx --test tests/series-spending.test.ts` | 開發中執行 8／1，結束碼 1。修正合成訂單的淨額後，最終整組中的系列測試 9／0。 |
| `node --import $fallback --import tsx --test tests/admin-dashboard-summary.test.ts` | 單獨重現 **5／3**，結束碼 1。測試預期批次長度 `[5, 6]`，現行卡套與採購各有 6 條語句，實際為 `[6, 6]`。另兩項故障注入按長度匹配，連帶命中卡套批次。此測試的執行路徑不載入本單程式，修正超出 §4.1。 |
| `node tests/admin-collection-detail-browser.mjs $edgeOut` | 第一次 47／1，結束碼 1，fixture 把 `compatible_with` 放到不支援該類型的收藏關係表，後續案例未執行。以合法 R16 關係重跑，**74／0**，結束碼 0。包含既有驗收、375／768／1280 無整頁橫捲、英文、目前收藏及錯誤隔離。 |
| `npm run astro -- check` | 隔離副本執行兩次，各掃描 375 檔，結束碼均為 1。兩次各 6 個基準錯誤、0 個新增錯誤、0 警告、25 提示。診斷為兩支 controller 的 `root` 重複宣告、`shared-quantity-commit.test.ts` 的 D1 型別轉換及 `tests/major03-d1/worker.ts` 三處型別不相容。Astro 未提供測試案例通過／失敗數。 |
| `npm run build` | 前兩次各 0／1，結束碼 1。封閉代理也攔到 Astro 的 loopback 預渲染。第三次用只接受 loopback 的暫存代理，0／1、結束碼 1，Miniflare 寫入使用者層 Wrangler registry 遭 EPERM。第四次沿用該代理，將 Wrangler registry 與日誌導向隔離副本，**1／0、結束碼 0**。本機 prebuild、server bundle 與 4 條靜態路由均完成。最後兩次以 `node loopback-build.mjs $npmPath` 在隔離副本內呼叫同一個 npm build 指令。 |
| `git diff --check` | **1／0，結束碼 0**。 |

#### TC01～TC14 對照

下表的「配件統計測試」指 `tests/series-spending.test.ts` 中的 `TC01–TC09 and TC12–TC14: accessory allocations, relationships and series statistics remain separate`。

| 案例 | 已通過的驗證 |
| --- | --- |
| TC01 | 配件統計測試，同一配件經收藏、遊戲及 R16 三種來源只出一列，TWD 320 與 USD 50 各計一次。另驗證四種獨立來源的配件可被帶入。 |
| TC02 | 配件統計測試，兩個系列分別顯示共用配件成本，採購總額逐列比對一致。 |
| TC03 | 配件統計測試與原採購分攤測試，擴充關係優先，同一收藏不出現在配件清單。 |
| TC04 | 配件統計測試保留有效零元成本，Edge 第 48、53、58、63 項顯示 `TWD · 0`。 |
| TC05 | 配件統計測試分別核對系列與配件缺成本筆數，Edge 第 48、53、58、63 項核對畫面。 |
| TC06 | 配件統計測試核對三種有效狀態的分幣別成本，未付款和取消分攤均未入小計。 |
| TC07 | 配件統計測試，同一訂單的系列與配件分攤各自計入。 |
| TC08 | 配件統計測試驗證配件的套用及附贈均未計入系列，並驗證僅含配件的禮包不出現、混合禮包的系列款數只計系列成員。 |
| TC09 | 配件統計測試驗證多本體候選按 ID 排序。Edge 第 64 項驗證單一本體及「目前收藏」標記。 |
| TC10 | `TC10: mixed relationships share the original cap and reserve the current accessory slot`，驗證兩組 ID 共 100 款、以目前配件取代原末位、排除截掉的分攤。原純成員上限測試也通過。 |
| TC11 | `an isolated collection has itself as base and no recorded amounts` 保留原欄位期望並確認三個配件欄位為空或零。Edge 第 51、56、61 項確認無配件區塊，並保留原提示與管理連結。 |
| TC12 | 配件統計測試封存有 TWD 10 分攤的關係，確認配件消失、小計扣除該額，採購讀取資料逐列相同。 |
| TC13 | 配件統計測試從同一 SQLite 比較系列讀取及關係封存前後的採購全站總額與 R01 採購摘要，並核對 R01 有效成本 TWD 630、USD 50。 |
| TC14 | 配件統計測試讓第六條、即配件分攤查詢回傳失敗，整次讀取拋出錯誤。Edge 第 65 項驗證失敗提示及訂單／卡套附贈隔離。 |

#### 修改的既有斷言

- `one-hop collection, game and NotBGG ascent with direct membership and deterministic labels`。從系列成員期望移出 `[4,'compatible_with']`，在 `accessories` 保留對應的 ID 與類型斷言。
- `eligible allocations roll up by currency while shared bundle costs are separate`。系列成員期望由 `[1,2,8]` 改為 `[1,2]`、系列缺成本由 1 改為 0。增加配件 ID `[8]` 及缺成本 1 的等價斷言，保留原幣別合計、擴充優先、禮包與封存斷言。
- Edge 既有 `series` 的文字樣式改核對相同系列合計、系列缺成本 0，以及配件區塊的缺成本文字。新增精確斷言，核對配件的個別成本、零元、缺成本筆數、小計及分組。原系列讀取失敗斷言不變，故障注入增加匹配有配件時的第六條查詢所屬批次。

#### 截圖

- [中文 375 px](SERIES-ACC-screenshots/series-375.png)
- [中文 1280 px](SERIES-ACC-screenshots/series-1280.png)
- [英文 1280 px](SERIES-ACC-screenshots/accessories-en-1280.png)
- [從配件收藏開啟，中文 1280 px](SERIES-ACC-screenshots/current-accessory-zh-1280.png)

#### 未執行與暫存

- 正式環境驗收、正式寫入、Migration 部署、外網、遠端操作及 Git commit／push 未執行。最終建置過程有一筆非 loopback CONNECT 被本機代理在轉送前拒絕，未建立外部連線。交接僅記在本節，`HANDOFF.md` 不在 §4.1。
- 執行環境的政策拒絕本工作暫存目錄的遞迴清理命令。經唯讀確認，仍有以下三個路徑。
  - `D:\temp\series-acc-edge-caae6d7b-b750-4831-8cea-01de2da6a251`（第一次 Edge）
  - `D:\temp\series-acc-edge-c0d5b57b-e36e-4609-8729-27a4a2fe665a`（第二次 Edge）
  - `D:\temp\series-acc-astro-284866f7-4742-4715-aaf8-b2d5f3364382`（隔離副本、日誌及本機建置產物）

### 4.6 Claude 審查（2026-11-26）

**結論：`SERIES-ACC-20261126-01` 通過。** 不需要修改。

**本人驗證**

- Node：`series-spending`、`admin-collection-detail`、`purchase-admin`、`admin-dashboard`、`sleeve-shortage`、`physical-component-management`、`catalog-d1-games` 共 7 個測試檔，**63 通過、0 失敗**。
- Edge：`admin-collection-detail-browser.mjs`，使用全新的空輸出資料夾，**74 通過**，結束碼 0。
- `git diff --check` 通過。`astro check` 和 build 沒有重跑，以 §4.4 為準（6 個基準錯誤、build 通過）。
- 看過的截圖：`series-1280`、`current-accessory-zh-1280`。系列合計只含本體與擴充；「相關配件」列出專用、相容、零元、尚未記錄的配件；小計標示「不併入系列合計」；從配件打開時，該配件標示「目前收藏」。

**程式核對**

- 拆分位置正確：先依既有邏輯排序並截成 100 款（含保留目前收藏的位置），**之後**才用 `isAccessory` 分成系列成員與配件，兩者共用同一個上限（符合 §5.1）。
- 分開計算在資料層完成：系列合計、尚未記錄筆數、卡套張數、共用禮包判定，都只用系列成員的 ID；配件成本用同一個 `costQuery`（同樣的訂單狀態與幣別規則）另外查詢，放在同一個 batch 裡，任何一條失敗整次就失敗（TC14）。沒有配件時，不送出配件查詢。
- 判定規則：最後歸類的關係類型是 `accessory_for` 或 `compatible_with` 才算配件；同時有擴充關係的成員，依既有優先順序仍歸為擴充（TC03）。
- 沒有使用複合 SELECT；沒有修改 Migration 和其他禁止修改的檔案。
- 畫面上原本的關係標籤「配件／相容配件」改成「專用／相容」，因為現在只出現在「相關配件」表裡，意思更清楚，可以接受。

**R01 摘要測試的 3 項失敗（和本工作命令無關，是 P0A 造成的回歸）**

- `tests/admin-dashboard-summary.test.ts` 第 32 行預期 R01 的兩個批次長度是 `[5, 6]`，實際是 `[6, 6]`；另外兩項故障注入是依批次長度配對，所以也跟著失敗。
- 這支測試沒有引用 `series-spending.ts`，`admin-dashboard-summary.ts` 也沒有被修改。原因是 **P0A-APP（`8a0a9f7`）在 `sleeve-shortage.ts` 的批次讀取裡加了第 6 條適用性查詢**，但這支測試的預期值沒有一起更新。
- Claude 審查 P0A 時跑的測試清單**沒有包含這個檔案**，所以當時沒有發現，這是審查的疏漏。正式環境的 R01 功能正常（P0A 驗收時 R01 卡套狀況顯示正常），只是測試的預期值過時。
- 修正方式：把預期值改成 `[6, 6]`，並調整故障注入的批次配對方式。這只改測試，不在本工作命令的允許範圍內，需要另外授權。

**小觀察（不擋上線）**

- O1：區塊開頭的說明文字「合計排除維修等其他費用、卡套金額與另列的共用禮包」沒有提到相關配件。不過配件小計的標題已經寫了「不併入系列合計」，意思足夠清楚；之後可以順手補上。
- O2：Codex 留下的 3 個暫存資料夾（`D:\temp\series-acc-*`），環境政策不允許它刪除，需要使用者手動刪除。

**上線**：不需要 Migration。依 §5.2，正式環境目前沒有任何配件關係，上線後畫面不會改變。推送部署需要依 DEPLOY-01 另外授權。

### 4.7 R01 摘要測試修正（2026-11-26，Claude 執行，DECISION_LOG TEST-R01-SLV-02）

- 只改 `tests/admin-dashboard-summary.test.ts`，沒有修改程式，也沒有改共用的 `tests/helpers/admin-dashboard-preview.ts`（其他 4 支測試也會用到它）：
  - 批次長度預期由 `[5, 6]` 改為 `[6, 6]`，並加註原因：P0A-APP 讓卡套不足批次也變成 6 條。
  - 新增測試內的輔助函式 `onPurchaseBatch`：以「SQL 含 `v2_purchase`」辨識 R10 採購批次，取代原本「批次長度 = 6」的配對方式（卡套不足的 SQL 不含 `v2_purchase`）。「任一位置失敗」與「拒絕不成功或不安全的結果」兩項測試都改用它，只對採購批次注入故障；原本要驗證的意思不變：採購區塊失敗時是 `null`，其他區塊完整。
- 驗證：`admin-dashboard-summary`、`admin-dashboard`、`sleeve-shortage`、`series-spending`、`purchase-admin` 共 5 個檔案，**47 通過、0 失敗**（R01 摘要由 5／3 變成 8／0）。`git diff --check` 通過。

### 4.5 禁止事項

- 網路存取、任何遠端或正式操作、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外，結束前清除；刪不掉時回報路徑。

## 5. 審查意見與補充邊界（2026-11-26，DECISION_LOG SERIES-Q124～Q126）

使用者貼上的設計審查：採 Q124-A、Q125-A、Q126-A；工作命令要補強驗收條件後才批准。

### 5.1 100 款上限的套用時機（Claude 已核對）

現有程式依序是：合併三種關係 → 去重 → 依關係類型排序 → 依 ID 排序 → **截成 100 款**（含目前收藏） → 再查成本（`series-spending.ts` 第 70～80 行；成本查詢在第 98 行之後）。

所以拆分「系列成員」與「相關配件」，必須在**截斷之後**做：兩者**共用**原本的 100 款上限，不能各自擁有 100 款，否則等於改變原本的搜尋契約。不得為了顯示目前收藏而突破上限，沿用既有的「目前收藏保留在可見範圍內」寫法（第 77 行）。

### 5.2 「上線後畫面不變」的假設（Claude 已核對）

審查意見指出：配件判定依據的是「最終關係類型」，不是收藏類型，所以不能只看「配件收藏 0 筆」。Claude 在 2026-11-26 對正式 D1 做一次唯讀查詢（寫入 0）：

| 項目 | 筆數 |
| --- | --- |
| 收藏關係 `accessory_for`（未封存） | 0 |
| 遊戲關係 `accessory_for`（未封存） | 0 |
| R16 `site_game_relations`（未封存） | 0（其中相容 0） |
| 配件類型收藏 | 0 |

結論：正式環境目前**沒有**任何會被歸為配件的成員，改版前後的系列花費畫面與數字完全一致。§4.3 的敘述已依此修正。

### 5.3 補充規則

- **Q124**：不換匯；有效的零元分攤要和「尚未記錄」區分；同一配件經多種關係被找到時，同一筆分攤只計一次；不同系列的配件小計不得相加；不新增成本分攤機制，也不因關係變更而修改採購資料。
- **Q125**：分離必須在**資料計算層**完成，不能只在畫面上搬區塊。共用禮包判定「分開」只限於系列花費的統計範圍，不修改 Q65 共用禮包本身的資料、分攤或歷史。
- **Q126**：多個本體、找不到本體都沿用既有處理方式；不新增系列選擇器，也不重新設計本體搜尋。
- **本次不處理**：採購分攤、R16 資料、R01、Q65、#32、#33 全域標記與配置、Migration、正式寫入；正式部署另行授權。

