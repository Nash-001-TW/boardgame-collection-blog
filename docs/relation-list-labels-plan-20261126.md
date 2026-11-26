# 關係管理清單改顯示名稱與中文類型｜規劃（2026-11-26，候選）

對應 CURRENT_TASK #35。**緣起**：使用者在 #23 建立克蘇魯套組的收藏關係時，關係管理頁（`/admin/bgg?view=relations`）的清單只顯示「#3 · accessory_for」「#265 → #262 · manual · 已確認」，要展開「編輯關聯」才看得到收藏名稱，不容易確認關係是否正確。

狀態：Q131～Q133 **已採納**（全採 A，DECISION_LOG REL-LABEL-Q131～Q133，2026-11-26）；Q134 **已採納 A**（DECISION_LOG REL-LABEL-Q134）；§5 工作命令已補上 Q134；入口調整（Q135，§3.2）已採納併入；**已授權**（2026-11-26，REL-LABEL-AUTH）。本文件只做靜態閱讀。**不需要 Migration，也不改伺服器**（理由見 §1）。

## 1. 現況盤點（2026-11-26 靜態閱讀）

| 項目 | 現況 |
| --- | --- |
| 清單 | `src/pages/admin/bgg/index.astro` 第 36 行：標題 `#{id} · {relation_type}`（英文代碼）；內文 `#{來源 ID} → #{目標 ID} · {relation_source} · 已確認／待確認／已封存`（`manual` 也是英文） |
| 資料 | `readRelationAdmin`（`relation-admin.ts` 第 64～71 行）**已經**一併讀取：<br>• `identities`：遊戲（`v2_games`，含名稱、BGG ID、NotBGG 編號）；<br>• `collections`：未封存的收藏（含名稱、類型、範圍）。<br>這兩份本來就提供給「編輯關聯」的下拉選單使用，清單只是沒有拿來對照 |
| 中文類型標籤 | 寫在 `RelationForm.astro` 第 8 行的 `labels` 物件裡，清單沒有共用 |
| 篩選 | 「來源或目標 ID」是數字輸入框，同樣要先知道 ID |
| 下拉選單 | 選項顯示為「#265 小小史詩克蘇魯：玩家桌墊 production」，帶著內部的範圍值 `production` |

**結論**：名稱與標籤都已經在頁面上，只要在**顯示層**把 ID 對照成名稱，並把標籤抽出來共用，不必修改伺服器或資料。

## 2. 固定規則（不需決策）

1. 只改顯示，不改關係的讀取條件、寫入、方向規則與封存。
2. 名稱對照不到時（例如收藏已封存，所以不在 `collections` 清單裡），顯示「#ID（已封存或找不到）」，不得省略或猜測名稱。
3. 中文關係類型標籤只維護一份，清單和編輯表單共用。
4. 中英雙語；375／768／1280 寬度都沒有整頁橫向捲動。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q131 | 每一筆關係怎麼顯示 | 標題：「**玩家桌墊 → 小小史詩克蘇魯豪華版**」；第二行：「配件 → 適用遊戲 · 手動 · 已確認 · 關聯 #3」；遊戲層的關係在名稱後面附 `BGG:ID` 或 `NotBGG:ID`，收藏層附 `#收藏 ID` | 保留現在的格式，只把英文代碼換成中文 | **A**：一眼看出「誰連到誰、什麼關係」，ID 留著做對照 |
| Q132 | 「來源或目標 ID」篩選怎麼改 | 改成下拉選單，選項和編輯表單相同（名稱加 ID），另外保留「全部」 | 維持數字輸入框 | **A**：資料已在頁面上，不用新增搜尋 API；收藏數量多時，瀏覽器原生下拉選單也可以直接打字跳到選項 |
| Q133 | 下拉選單選項裡的 `production` 要不要拿掉 | 收藏層的選項改成「名稱（#ID）」，測試範圍的收藏另外標「測試」，正式範圍不另外標示 | 維持原樣 | **A**：`production` 是內部值，對使用者沒有意義 |

### 3.1 使用者追加需求：目標選定後，後續新增的關聯預設帶入相同目標（Q134，已採納 A）

**現況**（`RelationForm.astro` 第 12～13 行）：
- 「新增關聯」的**來源**預設是網址上的 `source`，也就是從哪一筆收藏進來的；**目標**沒有預設，下拉選單會停在第一個選項（通常是 #1）；關聯類型預設為「其他」。
- 從主遊戲的「管理收藏組合關係」進來時，主遊戲被放在**來源**。但擴充、配件的關係方向是「擴充／配件 → 主遊戲」，主遊戲應該是**目標**，所以每一筆都要手動改來源、找目標、改類型，一個套組有幾項就要重做幾次。

| 選項 | 內容 |
| --- | --- |
| **A（建議）** | (1) 從收藏頁進入時，如果這筆收藏是本體或獨立遊戲，就預設為**目標**；擴充、配件等其他類型則預設為**來源**（維持現狀）。(2) 儲存一筆關聯後，下一筆「新增關聯」**沿用剛才的目標**，只要選來源。(3) 選了來源後，如果還沒手動改過關聯類型，就依來源的收藏類型自動帶入：擴充 → 「擴充 → 主遊戲」，配件 → 「配件 → 適用遊戲」；仍然可以手動修改。三項都只是表單預設值，送出前會顯示出來，伺服器的方向驗證照舊 |
| B | 只做 (2)：儲存後沿用剛才的目標；進入時的預設與類型不變 |
| C | 只做 (1)：從本體進入時預設為目標 |

### 3.2 入口調整併入 #35（Q135，已採納）

**現況**（2026-11-26 Claude 核對）：「管理收藏組合關係」有 4 個入口：
1. 收藏詳細頁「基本資料」分頁標題旁的按鈕（`CollectionAdmin.astro:30`，帶這筆收藏）；
2. 「相關採購」分頁的系列花費區，只在「還沒有系列關係」（帶本體）或「連到多個本體」（帶目前收藏）時出現（`CollectionPurchasesPanel.astro:88、137`）；
3. 側欄「遊戲資料 → 遊戲關聯」，進入後要再切換到「收藏組合」（側欄沒有直接入口）；
4. BGG 管理頁上方的「收藏組合」按鈕。

英文標籤不一致：入口 1 是「Manage collection combinations」，入口 2 是「Manage collection relationships」。

**調整**：
1. 側欄「**收藏**」群組新增「**收藏組合**」，直接開啟 `/admin/bgg?view=relations&domain=collection`；在該頁時，側欄要標示目前位置是「收藏組合」，不是「遊戲關聯」。
2. 「相關採購」分頁的系列花費區，在正常顯示系列時，**一律**提供「管理收藏組合關係」連結，帶本體 ID（搭配 Q134，本體會預設為目標）；原本的兩處連結保留。
3. 英文標籤統一為「Manage collection relationships」。

側欄位置與文字可以在截圖審查時再調整。

## 4. 非目標

- 修改關係的寫入、方向驗證、封存與 BGG 原始關聯的處理。
- 新增搜尋 API，或把篩選改成像 #34 那樣的搜尋下拉。
- BGG 快取分頁（`view` 未指定時的頁面）的版面。
- R16（NotBGG 配件關係頁）的清單，以及 R16-REV-01 的實作。

## 5. 工作命令 `REL-LABEL-20261126-01`（已授權 2026-11-26，REL-LABEL-AUTH；含 Q131～Q135）

執行者：Codex（本機實作與測試）。

### 5.1 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/pages/admin/bgg/index.astro` | 只限關係清單（第 36 行附近）依 Q131 顯示、Q132 的篩選下拉，以及依 Q134 計算新增表單的預設來源／目標（讀網址的 `source` 與沿用的目標，並依收藏類型判斷是否為本體或獨立遊戲）傳給 `RelationForm`；BGG 快取分頁不動 |
| `src/components/admin/RelationForm.astro` | 把關係類型的中文標籤抽出來共用；依 Q133 調整選項文字；依 Q134：新增表單的來源／目標預設值改由頁面傳入（本體或獨立遊戲預設為目標，其他維持來源；儲存後沿用的目標），選項帶上收藏類型（例如 `data-item-type`）供自動帶入類型使用；表單送出的欄位與值不變 |
| `src/lib/bgg-admin-controller.ts` | **只限** Q134：(a) 新增表單選了來源，且使用者還沒手動改過類型時，依來源的收藏類型帶入關聯類型；(b) 新增關聯儲存成功後，重新載入頁面時在網址帶上剛才的目標（例如 `relationTarget=`），讓下一筆沿用。封存、編輯、BGG 同步與錯誤處理行為逐字保留 |
| `src/lib/admin-shell-controller.ts` | **只限** Q135-1：「收藏」群組新增「收藏組合」項目（`view=relations&domain=collection`），並讓目前位置判斷能分出「收藏組合」與「遊戲關聯」；其他導覽項目與行為不變 |
| `src/components/admin/CollectionPurchasesPanel.astro` | **只限** Q135-2：系列正常顯示時一律提供「管理收藏組合關係」連結（帶本體 ID）；系列花費的計算與其他區塊不動 |
| `src/components/CollectionAdmin.astro` | **只限** Q135-3：入口按鈕的英文文字改為「Manage collection relationships」 |
| 共用標籤（新增，例如 `src/lib/relation-labels.ts`） | 依語言回傳關係類型標籤與來源（手動、BGG）標籤的純函式 |
| 測試 | 新增或擴充對應的 Node 測試（標籤與 ID 對照）與既有關係頁的 Edge 腳本；既有斷言只增，若因文字改變而失敗，只限改成等價斷言並逐條回報 |
| `docs/REL-LABEL-screenshots/` | 新增截圖 |
| 本文件 §5.4 | 回報 |

不得修改：`src/lib/relation-admin.ts`（讀取與寫入）、`migrations/`、R16 頁面、授權／middleware、`wrangler.json`、`astro.config.mjs`。

### 5.2 測試與驗收

1. **單元**：
   - 每一種收藏層與遊戲層的關係類型都有中英標籤；
   - 對照得到時顯示名稱與 ID；
   - 對照不到時顯示「#ID（已封存或找不到）」；
   - 遊戲層附 `BGG:ID`／`NotBGG:ID`。
2. **瀏覽器**（Edge 暫存 profile、本機拋棄式資料、全新的空輸出資料夾）：
   - 收藏層清單顯示名稱、中文類型、手動、已確認；
   - 遊戲層清單同樣顯示名稱；
   - 已封存的收藏顯示「已封存或找不到」；
   - 篩選下拉選取後只列出相關的關係，選「全部」恢復；
   - 從收藏頁「管理收藏組合關係」進入時，篩選已預先選好；
   - **Q134**：從本體進入時，新增表單的目標預設是該本體、來源未選；從擴充或配件進入時，來源預設是它；
   - **Q134**：選擇擴充當來源，類型自動變成「擴充 → 主遊戲」；選擇配件，類型變成「配件 → 適用遊戲」；手動改過類型後，再換來源不會被覆蓋；
   - **Q134**：連續新增 3 筆關聯（1 個擴充、2 個配件 → 同一本體），每一筆存檔後，目標都沿用本體，只需選來源；伺服器收到的方向正確、3 筆都建立成功；
   - **Q134**：方向選錯時，伺服器照舊拒絕（`RELATION_DIRECTION_UNVERIFIED`），畫面顯示原本的錯誤提示；
   - **Q135**：側欄「收藏」群組有「收藏組合」，點了直接開啟收藏組合關係頁，而且側欄標示目前位置；切到「遊戲關聯」時，標示改為遊戲關聯；
   - **Q135**：已有系列關係的收藏，「相關採購」分頁仍然看得到「管理收藏組合關係」，點了之後本體預設為目標；
   - **Q135**：入口 1、2 的英文標籤一致；
   - 新增與編輯關聯的流程不變；
   - 中英雙語；
   - 375／768／1280 寬度都沒有整頁橫向捲動。
3. **回歸**：關係管理、BGG 同步、系列花費、收藏詳細頁、側欄（`admin-shell.test.ts`、`admin-shell-browser.mjs`）相關的 Node 測試與 Edge 腳本；`npm run astro -- check`（基準 6 errors）；`npm run build`。
4. **截圖**：收藏層清單（中文 375、1280；英文 1280），以及遊戲層清單（1280）。

### 5.3 上線

不需要 Migration。Claude 審查、使用者看過截圖後，依 DEPLOY-01 另行授權推送部署；上線後使用者打開 #262 的「管理收藏組合關係」確認。

### 5.4 Codex 執行回報

**2026-11-26（Asia/Taipei）｜已實作 Q131～Q135。** Node 測試及 Astro 算出的清單、篩選和表單預設已在本機拋棄式 SQLite 驗證。Edge 互動、畫面及截圖驗收仍待完成。

#### 檔案

- 新增 `src/lib/relation-labels.ts`：共用中英關聯類型、來源標籤，以及名稱、識別碼和缺項文字。
- 新增 `tests/relation-labels.test.ts`：驗證標籤、BGG／NotBGG 識別碼、封存端點，以及 Astro 實際產出的篩選和預設欄位。
- 修改 `src/pages/admin/bgg/index.astro`、`src/components/admin/RelationForm.astro`：依已載入資料呈現關係和篩選下拉，根據入口或上次目標預設新增欄位。
- 修改 `src/lib/bgg-admin-controller.ts`：收藏新增表單依來源建議類型，手動更改後保留選擇。新增成功後以網址帶入上次目標。
- 修改 `src/lib/admin-shell-controller.ts`、`src/components/admin/CollectionPurchasesPanel.astro`、`src/components/CollectionAdmin.astro`：側欄收藏組合與目前位置、系列本體入口、統一英文標籤。
- 修改 `tests/admin-shell.test.ts`、`tests/bgg-sync-admin-browser.mjs`：加入側欄、清單、連續儲存、方向拒絕、系列入口及截圖檢查。
- 修改本文件 §5.4。刪除檔案 0。依 §5.1 將交接記錄留在本節。

#### 指令與結果

以下 `$relTemp` 為本次的 repo 外暫存目錄。tsx 在這個 Windows 執行環境呼叫 `os.userInfo()` 遇到 `uv_os_get_passwd ENOMEM`，後續測試使用暫存 preload，僅在這個錯誤出現時提供測試用使用者名稱。

| 指令 | 通過／失敗 | 結束碼 | 結果 |
| --- | ---: | ---: | --- |
| `node --import tsx --test tests/relation-labels.test.ts tests/relation-direction.test.ts tests/bgg-sync-admin.test.ts tests/series-spending.test.ts tests/admin-collection-detail.test.ts tests/admin-shell.test.ts tests/purchase-admin.test.ts` | 0／7 | 1 | 7 個測試檔在載入 tsx 時停止 |
| 同上，加 `--require "$relTemp/user-info.cjs"` | 59／0 | 0 | 新增 Astro 渲染斷言前 |
| 同上，加 `--require "$relTemp/user-info.cjs"` | 59／1 | 1 | 新增的 Astro 渲染斷言首次執行時，選擇器比對未容許 Astro 輸出的 HTML 屬性 |
| `node --require "$relTemp/user-info.cjs" --import tsx --test tests/relation-labels.test.ts` | 3／0 | 0 | 放寬新增斷言的 HTML 屬性匹配後通過 |
| 完整 Node 指令，加 `--require "$relTemp/user-info.cjs"` | 60／0 | 0 | 最終回歸 |
| `node --require "$relTemp/user-info.cjs" --import tsx tests/bgg-sync-admin-browser.mjs "$relTemp/bgg-sync-admin"` | 0／1 | 1 | `Page.enable` 逾時 |
| `node --require "$relTemp/user-info.cjs" --import tsx tests/admin-shell-browser.mjs "$relTemp/admin-shell"` | 0／1 | 1 | `Page.enable` 逾時，Edge 診斷記錄 GPU 子程序無法使用 |
| `node --require "$relTemp/user-info.cjs" --import tsx tests/admin-collection-detail-browser.mjs "$relTemp/admin-collection-detail"` | 0／1 | 1 | `Page.enable` 逾時，Edge 診斷記錄 GPU 子程序無法使用 |
| `node --require "$relTemp/user-info.cjs" --import tsx tests/purchase-admin-browser.mjs "$relTemp/purchase-admin"` | 0／1 | 1 | `Page.enable` 逾時 |
| `node --require "$relTemp/user-info.cjs" --require "$relTemp/edge-gpu.cjs" --import tsx tests/bgg-sync-admin-browser.mjs "$relTemp/bgg-retry"` | 0／1 | 1 | 使用暫存設定嘗試在程序內啟動 GPU，仍在 `Page.enable` 逾時。所有 Edge 執行均各自使用新建的空輸出目錄 |
| `npm run astro -- check`（關閉 telemetry、npm 離線） | 0／1 | 1 | 首次為 12 個 errors，其中 6 個新診斷來自 DOM 型別；修正後重跑兩次，均為基準 6 個 errors、0 warnings、27 hints，結束碼 1 |
| `node --check tests/bgg-sync-admin-browser.mjs` | 1／0 | 0 | 語法通過 |
| `git diff --check` | 1／0 | 0 | 差異檢查通過 |
| `git diff --exit-code -- src/lib/relation-admin.ts src/lib/series-spending.ts` | 1／0 | 0 | 關聯資料層及系列花費計算無差異 |

#### 既有斷言、截圖與未驗收項目

- 既有斷言修改 0 條。新增的 HTML 斷言容許 Astro 附加屬性，仍檢查預設選項和內容。
- 截圖清單為空。未產出預定的 `collection-zh-375.png`、`collection-zh-1280.png`、`collection-en-1280.png`、`game-zh-1280.png`。
- Edge 腳本未進入頁面，尚未執行瀏覽器測試驗證。連續儲存三筆、前端錯誤回饋、側欄和採購入口互動、中英及 375／768／1280 寬度仍待瀏覽器驗收。Node 已通過既有的伺服器方向驗證回歸。
- `npm run build` 尚未執行。現有的 `prebuild` 會呼叫 `wrangler types`，而已安裝版本有載入本機秘密檔的路徑。本工作命令禁止讀取該類檔案。
- 殘留暫存路徑：`D:/temp/REL-LABEL-20261126-325de1fd-6dae-4157-8ae5-00942a7ce7c7`。執行環境政策拒絕清除該 repo 外目錄，其中包含隔離 Edge profile、測試輸出和兩個暫存 preload。

### 5.6 Claude 審查（2026-11-26）

**結論：程式通過，有兩個收尾項目**（F1 必修，F2 是交付缺口），需要授權後由 Claude 處理（REL-LABEL-AUTH-02）。

**本人驗證**

- Node：`relation-labels`、`admin-shell`、`bgg-sync-admin`、`series-spending`、`admin-collection-detail`、`purchase-line-picker` 共 6 個測試檔，**34 通過、0 失敗**。`git diff --check` 通過。
- **Edge**：Codex 的環境裡 4 支腳本都在載入頁面前逾時，但在 Claude 的環境可以正常執行（`D1_A3_EDGE_LOCAL_TEST_MODE=1`、`node --import tsx`、全新的空資料夾）：
  - `bgg-sync-admin-browser.mjs`：**5 項全部通過**。其中「bilingual relation labels, archived fallback, filters, collection entry defaults, three saves, direction rejection and series link」一項涵蓋了：中英標籤、已封存的端點、篩選下拉、從本體進入時預設為目標而且來源空白、依來源帶入類型、手動改過類型就不覆蓋、連續存 3 筆都沿用目標並在 DB 確認方向、方向錯誤被拒、系列區連結與基本資料頁連結一致、側欄「收藏組合」與「遊戲關聯」的目前位置標示；
  - `admin-collection-detail-browser.mjs`：**74 項通過**；
  - `admin-shell-browser.mjs`：7 項通過後，**1 項斷言失敗**（見 F1）。
- 看過的截圖（Claude 執行 Edge 時產生在暫存資料夾）：`collection-zh-1280`、`collection-zh-375`。
  - 清單標題是「Expansion copy（#402）→ Base copy（#401）」，第二行是「擴充 → 主遊戲 · 手動 · 已確認 · 關聯 #2」；
  - 對照不到的端點顯示「#403（已封存或找不到）」；
  - 側欄「收藏」群組有「收藏組合」並標示目前位置；
  - 375 寬沒有橫向捲動。
- `astro check` 以 §5.4 為準（6 個基準錯誤）。**build 沒有執行**：Codex 以「prebuild 可能載入本機秘密檔」為由沒跑，Claude 也沒有重跑。這次只改了顯示層的 `.astro`、`.ts`，沒有改建置設定。

**程式核對**

- 伺服器的 `relation-admin.ts` **沒有修改**，名稱對照只用 `readRelationAdmin` 原本就讀取的 `identities` 與 `collections`；中文標籤抽到 `relation-labels.ts`，清單與表單共用。
- Q134：
  - 頁面依網址的 `source`（是本體或獨立遊戲時當作目標）與 `relationTarget`（沿用的目標）計算預設值；
  - 新增收藏關係的表單加了空白的「請選擇」選項，而且是 `required`，沒選來源不能送出；
  - 類型帶入只在使用者沒改過類型時才作用；
  - 新增成功後，網址帶上 `relationTarget` 再重新載入；封存、編輯、BGG 同步的流程不變。
- Q135：側欄新增 `collection-relations` 項目，並依 `domain` 區分目前位置；系列區在「有成員或有配件」時一律提供入口（帶本體 ID）；英文標籤已統一。

**F1（必修）：`tests/admin-shell-browser.mjs` 的側欄項目預期值過時**

這支腳本斷言「收藏」群組的連結是 `['', '?tab=owned', '?tab=wishlist', '?tab=preordered', '']`，但 Q135 刻意新增了 `?view=relations&domain=collection`，所以失敗。這是預期中的行為改變，只要把新項目加進預期值即可。Codex 的環境跑不了 Edge，所以沒發現。這支腳本不在 §5.1 的測試清單裡，需要授權。

**F2（交付缺口）：截圖沒有放進 `docs/REL-LABEL-screenshots/`**

Codex 沒有產生截圖。Claude 執行 Edge 時，截圖已經產生在暫存資料夾，可以複製進 `docs/REL-LABEL-screenshots/`：`collection-zh-1280`、`collection-zh-375`、`collection-en-1280`、`game-zh-1280`、`admin-mobile`。

**小觀察（不擋上線）**

- O1：篩選已經改成下拉選單，但標籤仍是「來源或目標 ID」，可以改成「來源或目標」。
- O2：1280 寬時，「篩選」按鈕被排成和下拉選單一樣寬的大方塊。功能正常，只是外觀不協調。
- O3：Codex 的暫存資料夾見 §5.4，需要使用者手動刪除。

### 5.7 收尾（2026-11-26，Claude 執行，DECISION_LOG REL-LABEL-AUTH-02）

- **F1**：`tests/admin-shell-browser.mjs` 第 275 行，「收藏」群組的預期連結加上 `?view=relations&domain=collection`（加註 Q135），其他斷言不變。
- **O1**：`src/pages/admin/bgg/index.astro` 的篩選標籤由「來源或目標 ID／Source or target ID」改為「來源或目標／Source or target」。
- **O2**：同一個檔案的篩選表單加上 `relation-filter` class，按鈕靠左、底部對齊、寬度自動，不再被拉成大方塊。
- **F2**：Edge 產生的 5 張截圖放進 [`docs/REL-LABEL-screenshots/`](REL-LABEL-screenshots/)：`collection-zh-1280.png`、`collection-zh-375.png`、`collection-en-1280.png`、`game-zh-1280.png`、`admin-mobile.png`（都是修正 O1、O2 之後重新產生的）。
- **驗證**：
  - Node：`relation-labels`、`admin-shell`、`bgg-sync-admin`，**17 通過、0 失敗**；`git diff --check` 通過。
  - Edge（全新的空資料夾，`node --import tsx`）：`bgg-sync-admin-browser` **5／5**、`admin-shell-browser` **9／9**，結束碼都是 0。
- **結論：#35（REL-LABEL-20261126-01）本機驗證完成。** build 沒有執行，原因見 §5.6。

### 5.5 禁止事項

同 #34 §5.5：
- 網路存取、任何遠端或正式操作、commit、push；
- git worktree、node_modules junction、在 repo 內建立整份專案副本；
- `git reset --hard`／`checkout -- .`／`clean`／`stash`；
- 覆寫其他截圖資料夾；
- 讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

暫存資料放在 repo 外，結束前清除；刪不掉時回報路徑。
