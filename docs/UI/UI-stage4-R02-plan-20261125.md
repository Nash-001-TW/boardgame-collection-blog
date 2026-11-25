# #11 UI 階段 4：R02 收藏清單｜規劃（2026-11-25 已採納，DECISION_LOG UI-S4-Q37～Q44）

對應 CURRENT_TASK #11。依據：[V2 UI／UX 設計規範](V2-UI-Design-System.md)（已採納，UI-02）§6、§8、§13 階段 4；設計圖 `冒險貓桌遊收藏管理介面.png`（R02 布局參考，§1 參考分級「延伸」）。共用元件沿用階段 2（[規劃 §8](UI-stage1-2-plan-20261124.md)）。

狀態：規劃 **已採納**（2026-11-25，Q37～Q44 全採 A）；§6 工作命令 `UI-S4-20261125-01` **已授權**（2026-11-25，DECISION_LOG UI-S4-AUTH），交 Codex 執行。本文件只做靜態閱讀，未執行測試、未讀正式資料。

## 1. 現況盤點（2026-11-25 靜態閱讀）

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| 頁面 | `/admin/collection` 由 `CollectionAdmin.astro`（mode=list）產生；已套階段 1 外框與 token，內容區仍是舊表單直排 | `src/pages/admin/collection/index.astro`、`src/components/CollectionAdmin.astro` |
| 前端 | `initializeCollectionList`：篩選寫入網址（`scope`、`q`、`view`、`source`、`status`、`archive`、`wishlist`），載入 `/api/admin/collection` | `src/lib/collection-admin-controller.ts` |
| API | `GET /api/admin/collection?view=…` → `listPage`；`limit` 1～100（預設 20）；以「群組最小收藏 ID」為游標，只有上一頁／下一頁；排序固定依 ID；**沒有總筆數** | `src/lib/collection-admin-api.ts`、`src/lib/collection-v2-management.ts` `listPage` |
| 回傳欄位 | 群組：遊戲名稱、來源身份（BGG／NotBGG／缺少）、來源封存、BGG 連結狀態；每筆：ID、名稱、類型、取得狀態、願望清單旗標、封存時間 | 同上 |
| 顯示方式 | 預設「依遊戲分組」（同遊戲多筆收藏合為一組），可切「逐筆收藏」 | 同上 |
| 其他呼叫端 | #22 R06 收藏選擇器以 `view=records` 呼叫同一 API | `src/lib/collection-picker.ts` |
| 側欄子項 | 已收藏 `status=owned`、願望清單 `wishlist=1`、預購中 `status=preordered` | `src/lib/admin-shell-controller.ts` |
| 共用樣式 | 階段 2 已有分頁籤、膠囊、篩選列、表格（手機改卡片）、分頁器 | `src/styles/admin-theme.css`、`/dev/ui-kit` |

**資料來源可用性**

| 設計圖欄位 | 資料 | 備註 |
| --- | --- | --- |
| 封面、玩家人數 | 有：BGG 為 `bgg_games.cache_json`（成功同步時）否則靜態基線；NotBGG 為 `notbgg_games` 欄位 | 公開目錄已用同一套來源（`src/lib/public-site-data.ts`），Admin 列表需共用該取法，不另寫口徑 |
| 分類標籤（策略／合作…） | BGG categories／mechanics 在快取 JSON 內 | 設計圖小字；見 Q41 |
| 副本數 | `v2_owned_copies`（`inventory_status`：in_collection／loaned／sold／gifted_away／lost／unknown） | 計哪些狀態見 Q42 |
| 最後異動 | `v2_collection_items.updated_at`（收藏本身編輯時更新；不含副本、採購、清點） | 見 Q42 |
| 待處理狀態（缺件、卡套不足、尚未清點） | **無正式規則可算**：卡套不足待 #27；清點進度待 R06-P0-C | 見 Q38 |

**口徑落差（需決定）**：R01「已收藏 254」以 `notes.owned` 覆寫優先、否則 `acquisition_status='owned'`；側欄與 R02 的 `status=owned` 只看 `acquisition_status`。兩者數字可能不同（見 Q40）。

## 2. 與設計圖的差距

| 設計圖 | 目前 | 處理 |
| --- | --- | --- |
| 狀態頁籤＋數量（全部／已收藏／願望清單／預購中） | 「資料範圍」與多個下拉選單 | 新增頁籤與數量（Q40） |
| 一列：搜尋＋玩家人數＋待處理狀態＋更多篩選 | 欄位直排 | 篩選列；次要條件收進「更多篩選」（Q44） |
| 已套用條件膠囊＋清除全部 | 無 | 新增，條件以網址為準 |
| 排序、每頁筆數 | 固定 ID 排序、20 筆 | Q39 |
| 表格：勾選框、封面、名稱＋分類、收藏狀態、人數、副本數、待處理、最後異動、操作 | 文字清單 | Q37、Q41～Q43 |
| 頁碼分頁、「顯示 1–20 筆，共 N 筆」 | 上一頁／下一頁 | Q39 |
| 待處理狀態圖例 | 無 | 隨 Q38 |
| 批次操作（勾選框） | 無 | **不納入**（設計規範 §10 已記：無規格且「移除」為破壞性動作） |

## 3. 固定規則（不需決策，沿用既有規定）

1. 唯讀頁面：本階段不新增任何寫入；封存、編輯仍在 R05 編輯頁。
2. 失敗關閉：列表或頁籤數量讀取失敗時顯示「無法取得」，不以 0 代替；數量失敗不擋列表、列表失敗不擋數量。
3. 網址為唯一狀態來源：所有篩選、排序、頁碼、每頁筆數寫入網址，重新整理或分享網址後還原（設計規範 §13 驗收「篩選網址往返」）。側欄子項現有網址必須繼續有效。
4. API 相容：只新增參數或欄位，不改既有參數語意；#22 收藏選擇器的呼叫結果不變（受影響呼叫端：`collection-admin-controller.ts`、`collection-picker.ts`）。
5. 封面沿用公開目錄的圖片安全檢查（`safeImage`），無封面時顯示占位；圖片延遲載入。
6. 中英雙語、鍵盤可操作、手機（375）表格改卡片、無橫向捲動。
7. 不動高敏感區（授權、分類／清點寫入、Migration、`wrangler.json`）；不需要 Migration。

## 4. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q37 | 列表呈現 | 表格以「逐筆收藏」為預設；保留「依遊戲分組」切換（分組時同遊戲多筆排在一起並標示筆數） | 只留逐筆表格，移除分組 | **A**：設計圖是逐筆；分組是既有功能，同遊戲多版本時仍有用 |
| Q38 | 「待處理狀態」欄與篩選 | 第一版不放此欄、此篩選與圖例；#27、R06-P0-C 規則上線後再加 | 放此欄但只顯示「—」 | **A**：比照 R01 的 Q36／UI-S3-SLV-01，不顯示無規則的狀態 |
| Q39 | 分頁、排序、每頁筆數 | 改為頁碼分頁＋總筆數；排序：最後異動（預設）、名稱、收藏 ID、副本數；每頁 20／50／100 | 保留上一頁／下一頁，只加總筆數，排序固定 | **A**：收藏約 256 筆，頁碼與排序成本低；以新參數實作，選擇器仍用舊游標 |
| Q40 | 頁籤與「已收藏」的口徑 | 頁籤與側欄改用 R01 口徑（已收藏含 `notes.owned` 覆寫；願望清單＝旗標；預購中＝取得狀態），三處數字一致 | 沿用目前 `acquisition_status` 篩選，R01 與 R02 數字可能不同 | **A**：同一系統同名數字應同源 |
| Q41 | 封面、玩家人數、分類小字 | 顯示封面與人數；名稱下方顯示類型（遊戲／擴充／配件），**不顯示** BGG 分類 | 封面、人數、BGG 分類（前 3 個）都顯示 | **A**：分類在 BGG 為英文且很長，中英對照沒有資料；類型已有 |
| Q42 | 「副本數」與「最後異動」 | 副本數只計持有中（in_collection＋loaned）；欄名「最後更新」，取收藏本身的 `updated_at` | 副本數計全部；「最後異動」取收藏、副本、採購的最新時間 | **A**：口徑簡單、無跨表推算；欄名不誤導 |
| Q43 | 操作欄 | 「⋯」選單：編輯、副本、實體組件、卡套需求、採購紀錄（皆為連結，不含封存等寫入）；不放勾選框 | 只放「編輯」按鈕 | **A**：把 R05 頁上的入口集中，待階段 5 分頁上線後改指向分頁 |
| Q44 | 篩選列的配置 | 常駐：搜尋、玩家人數；「更多篩選」內：資料來源、封存狀態、願望清單旗標、取得狀態（含已售出等）、資料範圍（production／test） | 全部常駐 | **A**：符合設計圖，常用條件在外 |

## 5. 決策後的步驟

1. 依決策起草工作命令 `UI-S4-2026112x-01`（範圍、檔案、API 新增參數、驗收清單），交使用者批准。
2. Codex 本機實作；驗收沿用 `admin-dashboard-preview` 拋棄式 SQLite＋Edge：1440／768／375 截圖、資料不可得狀態、篩選網址往返、側欄子項網址、#22 選擇器回歸。
3. Claude 審查 → 使用者看截圖 → 依 DEPLOY-01 授權推送 → Claude 唯讀確認 → 使用者登入後 Claude 檢查。

## 6. 工作命令：階段 4 R02 收藏清單（2026-11-25 已授權，DECISION_LOG UI-S4-AUTH）

```text
工作命令 ID：UI-S4-20261125-01
工作目標：依設計規範與本規劃 §3、§4（Q37～Q44 全採 A）重做 /admin/collection 列表（mode=list），唯讀；
  R05 編輯、新增、配件關聯（mode=edit／new／relations）外觀與行為不變。

已批准規格：docs/UI/V2-UI-Design-System.md §3、§6、§8、§9、§13；本文件 §3 固定規則、§4 決策（DECISION_LOG UI-S4-Q37～Q44）。

伺服器端（GET /api/admin/collection，只新增、不改既有語意）：
  1. 新增列表模式（建議以參數 page 觸發；未帶 page 時維持現行游標行為，#22 選擇器與舊呼叫不變）：
     - page（1 起）、limit 20／50／100、sort = updated（預設，新到舊）／name／id／copies，皆有穩定次序（同值再依 id）。
     - 回傳 total（符合條件的列數；分組時為群組數）、page、limit，不回傳 nextCursor。
  2. 新增頁籤參數 tab = all／owned／wishlist／preordered，口徑與 R01 相同（src/lib/admin-dashboard-summary.ts）：
     owned＝notes 為合法 JSON 且有 $.owned 時取其值，否則 acquisition_status='owned'；wishlist＝wishlist 旗標＝1；
     preordered＝acquisition_status='preordered'。三者不互斥（與 R01 相同）。口徑以共用 SQL 片段或函式提供，R01 與 R02 同源，
     R01 查詢結果不得改變。
  3. 新增頁籤數量：回傳目前 scope 下 all／owned／wishlist／preordered 四個數字，不受其他篩選影響（含封存，與 R01 一致）；
     數量查詢失敗時該欄為 null，不影響列表；列表失敗不影響數量（各自失敗隔離）。
  4. 新增玩家人數篩選 players（1～20 整數）：min_players ≤ players ≤ max_players；人數未知的收藏在有此篩選時不列出。
  5. 每列新增：封面（thumbnail 優先，否則 image，經既有 safeImage 檢查）、min/max 玩家人數、類型（遊戲／擴充／配件）、
     持有副本數（v2_owned_copies.inventory_status IN ('in_collection','loaned')）、updated_at。
     封面與人數取法與 src/lib/public-site-data.ts 相同（BGG：成功同步的 bgg_games.cache_json，否則靜態基線；NotBGG：notbgg_games），
     抽出共用片段，不另寫一套；公開端查詢結果不得改變。
  6. 不得使用超過 4 段的複合 SELECT（UNION／INTERSECT／EXCEPT；D1 上限見 UI 規劃 §13）；多段請用 db.batch() 或改寫。
  7. 既有參數 status、wishlist、source、archive、q、view、scope 語意不變。

前端（CollectionAdmin.astro mode=list、collection-admin-controller.ts 的 initializeCollectionList）：
  1. 頁首（PageHeader）＋「新增收藏」主按鈕；頁籤：全部／已收藏／願望清單／預購中＋數量（不可得顯示「—」與 sr-only 說明）。
  2. 篩選列：搜尋、玩家人數常駐；「更多篩選」內：資料來源、封存狀態、願望清單旗標、取得狀態（全部 7 種，中文標籤）、
     資料範圍 production／test。已套用條件以膠囊顯示，可逐一移除與「清除全部」。
  3. 排序、每頁筆數選單；頁碼分頁器＋「顯示 a–b 筆，共 N 筆」。
  4. 表格欄：封面、遊戲名稱（顯示名稱＋類型小字；來源身份、封存、BGG 連結狀態以小字或膠囊保留）、收藏狀態膠囊、玩家人數、
     副本數、最後更新（Asia/Taipei 日期）、操作。不放勾選框、不放待處理狀態欄與圖例（Q38）。
  5. 操作「⋯」選單（鍵盤可開關、Esc 關閉、焦點回到按鈕）：編輯、副本、實體組件、卡套需求、採購紀錄，皆為既有網址連結。
  6. 顯示方式：逐筆（預設）／依遊戲分組；分組時同遊戲多筆相鄰，群組列標示遊戲名稱與筆數。
  7. 所有狀態寫入網址（tab、q、players、更多篩選各項、sort、limit、page、view、scope），重新整理與上一頁／下一頁可還原；
     篩選或排序改變時回到第 1 頁。舊網址 ?status=owned、?wishlist=1、?status=preordered 繼續有效（以取得狀態／旗標篩選並顯示膠囊）。
  8. 側欄子項改指向 ?tab=owned／?tab=wishlist／?tab=preordered，並正確標示目前項目（含舊網址）。
  9. 狀態：載入中保留版面；列表失敗顯示 AlertBanner「無法取得」＋重試，不顯示空狀態；查無結果用 EmptyState（empty-* 插畫）＋清除條件按鈕。
  10. 手機（375）表格改卡片、無橫向捲動；中英雙語；44px 觸控目標；WCAG AA。

允許修改範圍：src/components/CollectionAdmin.astro（只限 mode=list 區塊）、src/lib/collection-admin-controller.ts（只限列表）、
  src/lib/collection-v2-management.ts（只限新增列表方法／共用片段，listPage 與寫入方法不變）、src/lib/collection-admin-api.ts（只限 GET 列表參數分派）、
  src/lib/admin-dashboard-summary.ts 與 src/lib/public-site-data.ts（只限抽出共用 SQL 片段，結果不變）、src/lib/admin-shell-controller.ts（側欄子項網址與比對）、
  src/styles/admin-theme.css（只限新增 R02 需要的樣式）、src/components/admin/（只限新增元件，例如操作選單、分頁器）、
  src/components/admin/AdminIcon.astro（只限新增缺少的圖示）、src/i18n（如需）；
  tests/notbgg-collection.test.ts、tests/admin-shell.test.ts、tests/admin-dashboard-summary.test.ts（只增不刪）、
  新增 tests/admin-collection-list.test.ts、tests/admin-collection-list-browser.mjs；tests/helpers/admin-dashboard-preview.ts（只限 R02 合成資料）。

禁止事項：不改寫入 API 與 R05 編輯／新增頁行為；不改 migrations、wrangler.json、package.json、astro.config.mjs、middleware、auth、
  分類／清點寫入模組、#22 選擇器行為；不新增套件或網路字型；不連遠端、不建置、不部署、不 git commit／push；
  不讀 .env／.dev.vars／備份。超出範圍時停下回報。

單元測試必須涵蓋：
  - 頁籤口徑與 R01 相同（含 notes.owned 覆寫為 0／1、旗標與取得狀態不互斥），R01 摘要測試結果不變。
  - total、頁碼邊界（最後一頁、超過頁數）、四種排序的穩定次序、limit 只接受 20／50／100。
  - players 篩選（未知人數排除）、副本數只計 in_collection＋loaned、封面 safeImage。
  - 未帶 page 時回傳與現行完全相同（#22 選擇器回歸）；公開目錄查詢結果不變。
  - 數量失敗與列表失敗各自隔離；D1 模擬層沿用 UNION 守衛（複合運算子超過上限即失敗）。

允許執行的驗證：
  1. node --import tsx --test tests/admin-collection-list.test.ts tests/notbgg-collection.test.ts tests/admin-shell.test.ts
     tests/admin-dashboard-summary.test.ts tests/collection-picker.test.ts tests/public-site-data.test.ts
  2. node tests/admin-collection-list-browser.mjs <暫存目錄>；node tests/collection-picker-browser.mjs <暫存目錄>；
     node tests/admin-shell-browser.mjs <暫存目錄>（回歸，截圖只寫暫存目錄）
  3. npm run astro -- check（基準 10 個錯誤，不得新增）
  4. git diff --check

瀏覽器驗收（合成資料）：1440／768／375 列表；頁籤數量不可得；列表不可得；查無結果；更多篩選展開；操作選單鍵盤操作；
  分組顯示；英文；篩選網址往返（設定條件→重新整理→還原；上一頁／下一頁）；舊側欄網址；#22 選擇器回歸。
  截圖存 docs/UI-S4-screenshots/。
完成條件與交付：修改檔案與摘要、驗證數字、瀏覽器逐項結果、截圖清單、astro check 錯誤數、未執行項目；更新 HANDOFF.md。
部署：Claude 審查通過、使用者看過截圖後，依 DEPLOY-01 另行授權推送；部署後 Claude 唯讀抽查，使用者登入後 30 分鐘內 Claude 檢查。
```

### 6.1 審查（2026-11-25）：有條件通過

- **範圍**：修改 `CollectionAdmin.astro`（列表區）、`collection-admin-controller.ts`、`collection-v2-management.ts`（新增 `listNumbered`，`listPage`／寫入不變）、`collection-admin-api.ts`（只在帶 `page` 時分派）、`admin-dashboard-summary.ts` 與 `public-site-data.ts`（只抽出共用 SQL 常數）、`admin-shell-controller.ts`、`admin-theme.css`、`admin-shell.test.ts`、預覽 helper；新增 `CollectionList.astro`、兩支測試、11 張截圖。均在 §6 允許範圍內；未改 migrations、auth、middleware、寫入 API。
- **程式核對**：頁籤口徑以 `adminOwnedSql` 與 R01 同源（R01 只改為引用常數，SQL 文字相同）；封面與人數沿用公開目錄的靜態基線＋`bgg_games.cache_json` 取法與 NotBGG 欄位，經 `safeImage`；新查詢無複合 SELECT；列表與數量各自 8 秒逾時與失敗隔離並記錄 `Admin collection section unavailable`；超出末頁回到末頁；`updated_at` 兩種格式（SQLite `CURRENT_TIMESTAMP` 與 ISO）皆以 UTC 解析後顯示台北日期；前端未用 innerHTML。
- **Claude 重跑**：Node 6 檔 **43／43**；`astro check` 355 檔 **10 個基準錯誤**、0 警告；`git diff --check` 通過。瀏覽器 R02 12／12、#22 選擇器 11／11 引用 Codex 回報，Claude 未重跑；Claude 已看 1440、375、操作選單、列表不可得四張截圖。
- **條件（未通過項）**：既有 `tests/admin-shell-browser.mjs` 第 274～275 行仍斷言舊側欄網址（`?status=owned` 等），第 8 項失敗、第 9 項未執行。該檔不在 §6 允許範圍，需授權擴大範圍後改為 `?tab=…` 並重跑。
- **小觀察（不擋）**：(1) 列表不可得時，狀態列「無法取得收藏列表。」與下方警示橫幅重複；(2) 375 寬卡片的「封面」以一整列標籤呈現，略佔空間，可改為封面與名稱並排作為卡片標題。可於部署前一併微調或日後處理。
- **正式 D1 風險**：新查詢每次綁定整份靜態基線 JSON（與公開目錄相同做法，公開端已在正式環境運作），正式表現待部署後驗收。

### 6.2 補充修正複審（2026-11-25，UI-S4-AUTH-02）：通過

- **範圍**：`tests/admin-shell-browser.mjs` 只改兩行斷言（側欄改 `?tab=…`，仍以舊網址 `?status=owned` 進入並標示「已收藏」）；`CollectionList.astro`、`collection-admin-controller.ts`、`admin-theme.css`（新增選擇器皆限 `.admin-r02*`）、`admin-collection-list-browser.mjs`；更新截圖 `r02-375.png`、`r02-list-unavailable.png`。未動伺服器查詢與其他頁面。
- **結果**：列表不可得只剩警示橫幅＋重試（即時區域通知）；空的狀態列不再佔位；手機卡片以封面縮圖＋名稱、類型、ID 為標題。
- **Claude 重跑**：Node 6 檔 **43／43**；`git diff --check` 通過；已看兩張更新截圖。Shell 瀏覽器 **9／9**、R02 瀏覽器 **12／12**、Node 3 檔 15／15、`astro check` 10 個基準錯誤引用 Codex 回報（使用程序限定的 Edge Crashpad 與 tsx 帳號名稱回退）。即時區域尚未以實際螢幕閱讀器驗證。
- **結論**：§6.1 條件解除，`UI-S4-20261125-01` 審查通過。尚未提交；待使用者看截圖後依 DEPLOY-01 授權推送部署。

### 6.3 部署與唯讀抽查（2026-11-25）

- 部署：`40b8abc`（R02）＋`906911c`（文件）於台北 09:33 推送（DECISION_LOG UI-S4-DEPLOY），自動部署為 `468b7e3b…`（100%，台北 09:34:40）。
- Claude 唯讀抽查 20 條路由全部符合：公開頁 8 條 200；BGG 舊格式 2 條 307；不存在 ID 404；`/admin`、`/admin/collection`、`/admin/collection?tab=owned`、`/api/admin/collection`、`/api/admin/auth-check`、`/admin/bgg`、`/admin/collection/components/manage` 皆 302 至 Access 登入；`/dev/collection-v2-test`、`/dev/ui-kit` 404。
- 遠端操作：`wrangler deployments status` 數次（Metadata 讀取）、HTTP 20 次；D1 查詢 0、寫入 0。
- **正式驗收（2026-11-25 台北 09:4x，使用者登入後 Claude 檢查，面板寬 518px）：通過**。
  - 頁籤：全部 256／已收藏 254／願望清單 0／預購中 2，與 R01（256／254／0／2）一致。
  - 列表：預設 20 筆、「顯示 1–20 筆，共 256 筆」、13 頁；封面來自 `cf.geekdo-images.com`，第 1 頁 9 張全部載入、0 張失敗，第 2 頁（每頁 50）抽查 1 張載入正常；人數與 API 一致。
  - 篩選與網址：`?tab=preordered` 2 筆；`?tab=owned&players=4&sort=name&limit=50&page=2` 重新開啟後頁籤、人數、排序、每頁 50、第 2 頁皆還原（51–100／194 筆），條件膠囊顯示「玩家人數 · 4」；語言切換連結保留參數。
  - 側欄：子項連結為 `?tab=owned／wishlist／preordered`；`?tab=owned` 與舊網址 `?status=owned` 皆標示「已收藏」，舊網址以「取得狀態 · 已收藏」膠囊篩選出 254 筆。
  - 窄寬度（518px）為卡片版面、無橫向捲動；整頁無「無法取得」；R01 數字不變。
- **小觀察（不擋）**：封面格內的「無封面」備用文字在有圖片時仍存在於 DOM（視覺被圖片蓋住），螢幕閱讀器可能讀出；可於日後改為無圖時才輸出。
- **已修正（2026-11-25，使用者指示「先修改小問題後再提交」，Claude 實作）**：`collection-admin-controller.ts` 改為只在沒有封面或圖片載入失敗時才輸出「無封面」。Claude 驗證：Node 3 檔 15／15、R02 瀏覽器 **12／12**（Claude 本機直接執行）、`astro check` 10 個基準錯誤、`git diff --check` 通過。尚未部署（推送依 DEPLOY-01 另行授權）。
- **資料觀察**：正式環境 32 筆收藏「缺少來源身份」（未連到 BGG／NotBGG 遊戲），因此無封面、無人數；依「最後更新」排序時排在第一頁。屬既有資料狀態，非本次程式問題。
- 遠端操作：使用者登入後瀏覽 R02／R01 數頁、唯讀 API 讀取數次；寫入 0。
