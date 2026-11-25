# #11 UI 階段 5：收藏詳細頁分頁｜規劃（2026-11-25 已採納，DECISION_LOG UI-S5-Q45～Q51）

對應 CURRENT_TASK #11。依據：[V2 UI／UX 設計規範](V2-UI-Design-System.md)（已採納，UI-02）§6「分頁籤」、§10（R04～R06 差異）、§12 D4（整合為五個分頁、舊網址轉址）與 D8（R06 四項決策）、§13 階段 5；設計圖 `霜港桌遊收藏管理系統介面定稿.png`、`霜港桌遊收藏管理介面總覽.png`（收藏詳細頁＋R06，§1 參考分級「延伸」）。前一階段見 [階段 4 規劃](UI-stage4-R02-plan-20261125.md)。

狀態：規劃 **已採納**（2026-11-25，Q45～Q51 全採 A）；§6 工作命令 `UI-S5A-20261125-01`（5a）**已授權**（2026-11-25，DECISION_LOG UI-S5A-AUTH），交 Codex 執行。5b、5c 於前一張部署後再起草。本文件只做靜態閱讀，未執行測試、未讀正式資料。

## 1. 現況盤點（2026-11-25 靜態閱讀）

五個分頁目前是分散的頁面：

| 分頁（D4） | 目前頁面 | 寫入 | 備註 |
| --- | --- | --- | --- |
| 基本資料 | `/admin/collection/[id]`（`CollectionAdmin.astro` mode=edit，R05） | 有：PATCH、封存 | 頁上有 5 個入口按鈕（組合關係、採購、卡套需求、實體組件、副本），分頁上線後由分頁列取代 |
| 副本與品況 | `/admin/collection/[id]/copies`（伺服器端讀 `readCollectionCopies`） | 有：新增副本、語言版本、品況 | 已是收藏底下的路徑 |
| 實體組件 | `/admin/collection/components/manage?collection=N`（R06；#22 收藏選擇器；D1 預覽與更正歷史） | 有：**高敏感區**（`physical-component-management.ts` 等） | 無 `collection` 時顯示收藏選擇器；側欄「實體組件」指向此頁（Q30：過渡期保留，階段 5 後移除） |
| 卡套需求 | `/admin/sleeves/requirements?collection=N`（R09，伺服器端讀 `readSleeveWorkflow`） | 有：新增需求、指派、套用 | 頁上可輸入收藏 ID 切換 |
| 相關採購 | `/admin/purchases?collection=N`（R10 採購管理以收藏篩選） | 有：建立／編輯訂單 | 是全域採購管理頁的篩選結果；新增訂單時可預填收藏 |

舊網址的站內引用：`CollectionAdmin.astro`、`collection-admin-controller.ts`、`copies.astro`、`components/classification.astro`、`sleeves/index.astro`、`sleeves/requirements.astro`、R02「⋯」選單（階段 4）。

設計圖對照：頁首（封面、名稱、來源 ID、收藏狀態、本體／副本數、BGG 評分與排名、「異常 N 項／待確認 N 項」、前往 BGG）、五個分頁（實體組件帶紅／灰計數）、手機版分頁縮為圖示＋短字。設計圖大部分篇幅是 R06 清點細節（批次確認、問題紀錄、草稿、需要複查），屬 R06-P0 系列，不在本階段。

## 2. 本階段範圍與非目標

**範圍**：收藏詳細頁的共用頁首與分頁列；五個分頁換成新外框與階段 2 元件樣式；舊網址轉址；站內連結改指新網址。各分頁**既有功能與寫入行為不變**。

**非目標**：R06 清點新功能（批次確認、問題紀錄、草稿、需要複查、逐副本適用性、清點日期、整盒進度＝R06-P0-A～C）；「異常／待確認」計數（無正式規則，同 Q36／Q38）；#27 卡套庫存不足、#28 贈送卡套、#29 系列花費合計；新增收藏頁（`/new`）改版；任何 Migration。

## 3. 固定規則（不需決策）

1. 寫入行為不變：各分頁沿用既有 API、revision 與守衛；高敏感區（R06 寫入、授權、middleware、migrations）不改邏輯，只允許外框與樣式調整。
2. 每個分頁有自己的網址；重新整理、分享網址與上一頁／下一頁都回到同一分頁；`lang`、`scope` 參數保留。
3. 舊網址以 302 轉到對應分頁並保留 `lang`／`scope`；轉址在讀資料前完成。
4. 頁首與分頁列讀取失敗時顯示「無法取得」，不影響分頁內容；分頁內容失敗不影響頁首。
5. 收藏不存在回 404；`scope` 不合法回 400（沿用既有）。
6. 有未儲存變更時切換分頁要提示（沿用 R05 既有 `beforeunload` 與確認）。
7. 中英雙語、鍵盤可操作、375 寬無橫向捲動、WCAG AA；手機分頁列可橫向捲動或縮為圖示＋短字。

## 4. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q45 | 分頁的實作方式與網址 | 每個分頁是獨立網址、伺服器只產生目前分頁：`/admin/collection/[id]`（基本資料）、`/[id]/copies`、`/[id]/components`、`/[id]/sleeves`、`/[id]/purchases`；分頁列是連結列（`aria-current`），切換＝換頁 | 同一頁載入五個分頁內容，前端切換（`role="tablist"`、方向鍵） | **A**：直接沿用各頁現有的伺服器讀取與 controller，風險小、網址天然可分享；代價是不採設計規範 §6 的 tablist 方向鍵（改記為規範差異） |
| Q46 | 工作命令分段 | 分三張依序做：**5a** 頁首＋分頁列＋基本資料＋副本與品況；**5b** 實體組件（R06 高敏感區）；**5c** 卡套需求＋相關採購。每張審查、看截圖後各自部署 | 一張做完五個分頁 | **A**：R06 與卡套頁的 controller 較大，分開審查好回退 |
| Q47 | 頁首內容 | 封面、名稱、來源 ID（連到公開頁）、收藏狀態膠囊、持有副本數、封存標示；**不顯示** BGG 評分／排名與「異常／待確認」 | 另加 BGG 評分與綜合排名 | **A**：異常／待確認無正式規則；評分排名與管理無關，日後要再加 |
| Q48 | 分頁上的計數徽章 | 第一版不顯示 | 顯示中性筆數（副本 N、卡套需求 N、採購 N） | **A**：設計規範規定徽章紅＝異常、灰＝待確認，中性筆數會混淆語意 |
| Q49 | 實體組件的入口與側欄 | 依 Q30：5b 上線後移除側欄「實體組件」；`/admin/collection/components/manage?collection=N` 轉到 `/[id]/components`，**無** `collection` 時轉到 R02 收藏清單 | 保留側欄項目與收藏選擇器頁，作為不經收藏直接清點的入口 | **A**：照 Q30 已採納的方向，入口統一由收藏進入；#22 選擇器功能由 R02 搜尋取代 |
| Q50 | 「卡套需求」分頁 | 嵌入現有 R09 需求與套用功能（寫入不變，換外框）；`/admin/sleeves/requirements?collection=N` 轉到 `/[id]/sleeves`；無 `collection` 的舊頁轉到卡套管理 | 分頁只放唯讀摘要＋「前往卡套需求頁」連結 | **A**：D4 的目的就是在收藏底下完成操作 |
| Q51 | 「相關採購」分頁 | 唯讀：列出含此收藏的訂單與此收藏的分攤金額（依幣別、不換算），附「新增採購（預填此收藏）」與「在採購管理開啟」連結；建立／編輯仍在採購管理頁；`/admin/purchases?collection=N` **不轉址**（它是全域採購管理的篩選） | 把採購建立／編輯也嵌入分頁 | **A**：採購訂單常跨多個收藏，編輯放全域頁較合理；#29 系列花費合計日後加在此分頁 |

## 5. 決策後的步驟

1. 依決策起草工作命令（Q46 採 A 時先發 5a），交使用者批准。
2. Codex 本機實作；驗收沿用 `admin-dashboard-preview` 拋棄式 SQLite＋Edge：1440／768／375、頁首不可得、分頁內容不可得、舊網址轉址、未儲存提示、各分頁既有功能回歸（R05、副本、R06、卡套、採購既有測試）。
3. Claude 審查 → 使用者看截圖 → 依 DEPLOY-01 授權推送 → Claude 唯讀確認 → 使用者登入後 Claude 檢查。

## 6. 工作命令：5a 頁首＋分頁列＋基本資料＋副本與品況（2026-11-25 已授權，DECISION_LOG UI-S5A-AUTH）

```text
工作命令 ID：UI-S5A-20261125-01
工作目標：建立收藏詳細頁的共用頁首與分頁列，並把「基本資料」（/admin/collection/[id]，R05）與「副本與品況」
  （/admin/collection/[id]/copies）兩個分頁換成新外框與階段 2 元件樣式。兩頁的讀寫行為不變。

已批准規格：docs/UI/V2-UI-Design-System.md §3、§6、§8、§9；本文件 §2 範圍、§3 固定規則、§4 決策（DECISION_LOG UI-S5-Q45～Q51）。

伺服器端：
  1. 新增唯讀函式讀取頁首資料（例如 readCollectionHeader(db, id, scope)）：顯示名稱、遊戲名稱、來源 ID、類型、
     收藏狀態（含 R01 口徑的 owned，沿用 adminOwnedSql）、願望清單旗標、取得狀態、封存、持有副本數（in_collection＋loaned）、
     封面（與 R02／公開目錄同源的片段＋safeImage）。不得使用超過 4 段的複合 SELECT。
  2. 收藏不存在回 404；scope 不合法回 400；頁首讀取失敗時頁首顯示「無法取得」，分頁內容照常（各自失敗隔離）。

前端：
  1. 新增共用元件（例如 src/components/admin/CollectionDetailHeader.astro、CollectionDetailTabs.astro）：
     - 頁首：「← 全部收藏」（回 R02，保留 scope／lang）、封面、名稱、來源 ID（BGG 連到 /games/bgg-{id}，NotBGG 連到公開頁；
       缺少來源身份時顯示文字）、類型、收藏狀態膠囊（同 R02）、持有副本數、封存標示。不顯示 BGG 評分、排名、異常／待確認（Q47）。
     - 分頁列：基本資料、副本與品況、實體組件、卡套需求、相關採購；連結列＋aria-current="page"（Q45，非 tablist）；
       不顯示計數徽章（Q48）。375 寬可橫向捲動或縮為圖示＋短字，無整頁橫向捲動。
     - 過渡期：實體組件、卡套需求、相關採購三個分頁在 5b／5c 完成前，連到現有頁面
       （/admin/collection/components/manage?collection=N、/admin/sleeves/requirements?collection=N、/admin/purchases?collection=N），
       程式中以註解標示為過渡連結。
  2. 基本資料（CollectionAdmin.astro mode=edit）：套頁首與分頁列；移除頁上「採購紀錄」「卡套需求」「實體組件」「副本」四個入口
     （由分頁列取代），保留「管理收藏組合關係」連結；表單改用階段 2 的欄位、按鈕與區塊樣式。欄位、驗證、revision、封存、
     未儲存提示（beforeunload 與確認）與 API 呼叫不變。mode=new 與 mode=relations 不改。
  3. 副本與品況（[id]/copies.astro）：套頁首與分頁列；表單與副本列表改用階段 2 樣式；移除頁上「← 返回收藏」「實體組件與清點」
     導覽（由頁首與分頁列取代）。新增、編輯、品況、分頁讀取與 API 呼叫不變。
  4. 站內連結：R02「⋯」選單的「編輯」「副本」維持現有網址（已是新分頁網址）；其餘舊網址留待 5b／5c 處理。
  5. 中英雙語；鍵盤可操作；1440／768／375 無橫向捲動；WCAG AA。

允許修改範圍：src/components/CollectionAdmin.astro（只限 mode=edit 的外框與入口區）、src/lib/collection-admin-controller.ts（只限 edit 模式中
  被移除入口的相關程式，讀寫邏輯不變）、src/pages/admin/collection/[id].astro、src/pages/admin/collection/[id]/copies.astro（只限版面與樣式）、
  src/lib/collection-copies-controller.ts（只限配合新版面的選擇器，行為不變）、src/lib/collection-v2-management.ts（只限新增唯讀頁首函式）、
  src/styles/admin-theme.css（只限新增詳細頁樣式）、src/components/admin/（只限新增元件）、src/components/admin/AdminIcon.astro（只限新增缺少的圖示）；
  新增 tests/admin-collection-detail.test.ts、tests/admin-collection-detail-browser.mjs；tests/helpers/admin-dashboard-preview.ts（只限詳細頁合成資料）；
  既有測試只增不刪：tests/notbgg-collection.test.ts、tests/collection-field-patch.test.ts、tests/collection-gaps.test.ts。

禁止事項：不改任何寫入 API、revision 與守衛；不改 R06 頁、卡套頁、採購頁；不改 migrations、wrangler.json、package.json、astro.config.mjs、
  middleware、auth；不新增套件或網路字型；不連遠端、不建置、不部署、不 git commit／push；不讀 .env／.dev.vars／備份。超出範圍時停下回報。

單元測試必須涵蓋：頁首資料（owned 口徑同 R01、副本數只計 in_collection＋loaned、封面 safeImage、缺少來源身份）；收藏不存在 404、scope 400；
  頁首讀取失敗時分頁內容仍渲染；R05 編輯與副本既有測試全數通過；複合運算子守衛。

允許執行的驗證：
  1. node --import tsx --test tests/admin-collection-detail.test.ts tests/notbgg-collection.test.ts tests/collection-field-patch.test.ts
     tests/collection-gaps.test.ts tests/admin-collection-list.test.ts tests/admin-shell.test.ts
  2. node tests/admin-collection-detail-browser.mjs <暫存目錄>；node tests/admin-collection-list-browser.mjs <暫存目錄>；
     node tests/admin-shell-browser.mjs <暫存目錄>（回歸，截圖只寫暫存目錄）
  3. npm run astro -- check（基準 10 個錯誤，不得新增）
  4. git diff --check

瀏覽器驗收（合成資料）：基本資料與副本兩分頁各 1440／768／375；頁首不可得；收藏不存在；封存收藏；缺少來源身份；英文；
  分頁列 aria-current 與鍵盤；未儲存變更時切換分頁的提示；R05 儲存與副本新增各一次（合成資料）；過渡連結指向正確舊頁。
  截圖存 docs/UI-S5A-screenshots/。
完成條件與交付：修改檔案與摘要、驗證數字、瀏覽器逐項結果、截圖清單、astro check 錯誤數、未執行項目；更新 HANDOFF.md。
部署：Claude 審查通過、使用者看過截圖後，依 DEPLOY-01 另行授權推送；部署後 Claude 唯讀抽查，使用者登入後 30 分鐘內 Claude 檢查。
```

### 6.1 審查（2026-11-25）：通過

- **範圍**：修改 `CollectionAdmin.astro`（mode=edit 外框與入口區；mode=new 的隱藏入口保留）、`[id].astro`、`[id]/copies.astro`、`collection-v2-management.ts`（新增唯讀 `readCollectionHeader`）、`admin-theme.css`、預覽 helper；新增 `CollectionDetailHeader.astro`、`CollectionDetailTabs.astro`、兩支測試、10 張截圖。均在 §6 允許範圍內；`collection-admin-controller.ts`、寫入 API、R06／卡套／採購頁、migrations、auth 未動。
- **程式核對**：頁首 owned 沿用 `adminOwnedSql`、封面沿用公開目錄片段＋`safeImage`、副本只計 in_collection＋loaned；無複合 SELECT；讀取失敗回 undefined（頁首顯示「無法取得」、分頁照常，記錄 `Admin collection section unavailable header`），查無資料回 null（404），scope 不合法 400；分頁列為連結列＋`aria-current`，三個過渡連結帶 `collection`、`scope`、`lang` 並有註解。
- **Claude 重跑**：Node 6 檔 **30／30**；詳細頁 Edge **17／17**（Claude 本機直接執行，含 R05 儲存、新增副本、未儲存提示、上一頁／下一頁、404／400、封存、英文）；`astro check` **10 個基準錯誤**、0 警告；`git diff --check` 通過。R02 12／12、Shell 9／9 引用 Codex 回報。Claude 已看 details-1440、copies-375、header-unavailable 三張截圖。
- **小觀察（不擋）**：
  1. 類型顯示不一致：頁首依 `item_type` 顯示「本體／擴充／未知類型…」，R02 列表把非擴充、非配件一律顯示「遊戲」，同一筆在兩處文字不同（R02 的對照較粗）。
  2. 頁首不可得時，頁面出現兩個「編輯收藏」標題（頁首備用標題與表單區標題）。
  3. 基本資料原地儲存或封存後，伺服器產生的頁首要重新整理才更新（Codex 回報）。

### 6.2 小觀察修正（2026-11-25，使用者指示「先修小問題」，Claude 實作）

- **類型文字**：新增 `src/lib/collection-item-types.ts`（依 migration 0007 的 `item_type` CHECK 清單），頁首與 R02 列表共用；R02 不再把非擴充、非配件一律寫成「遊戲」，改顯示「本體／獨立遊戲／組合／收納／宣傳品／其他／未知類型」等。
- **重複標題**：頁首不可得但仍顯示編輯表單時，頁首備用標題改為「收藏 #N」，不再與表單區「編輯收藏」重複；404／400 時維持原標題。
- **頁首更新**：基本資料儲存或封存成功後重新載入頁面，伺服器重新讀取頁首；結果訊息以 sessionStorage 跨重新載入顯示（讀寫失敗只會少顯示訊息，不影響儲存）。只有帶頁首的編輯頁會重新載入，mode=new 不變。
- 修改檔案：`collection-admin-controller.ts`（R02 類型文字；edit 模式儲存／封存後重新載入與訊息）、`CollectionDetailHeader.astro`、`CollectionAdmin.astro`、`tests/admin-collection-detail-browser.mjs`（第 14 項加驗儲存後頁首顯示新名稱與訊息）；新增 `collection-item-types.ts`。更新兩個截圖資料夾（R02 類型文字、頁首不可得）。
- **驗證（Claude 本機執行）**：Node 6 檔 **30／30**；詳細頁 Edge **17／17**（第 14 項含頁首更新）；R02 Edge **12／12**；`astro check` **10 個基準錯誤**；`git diff --check` 通過。

### 6.3 部署與正式驗收（2026-11-25）

- 部署：`26b6f85`（5a）＋`a081790`（文件）推送（DECISION_LOG UI-S5A-DEPLOY），自動部署為 `ad8efce3…`（100%，台北 10:19:53）。
- Claude 唯讀抽查 17 條路由全部符合：公開頁 6 條 200、不存在 ID 404；`/admin`、`/admin/collection`、`/admin/collection/1`、`/admin/collection/1/copies`、`/api/admin/collection`、R06、卡套需求、採購共 8 條 302 至 Access；`/dev/ui-kit`、`/dev/collection-v2-test` 404。
- **正式驗收（使用者登入仍有效，Claude 唯讀檢查，面板寬 518px，未儲存任何資料）：通過**。
  - `/admin/collection/102`：頁首「工業革命伯明翰 籌碼版／Brass: Birmingham／BGG:224517／本體／持有副本 0／已收藏」，封面載入；目前分頁「基本資料」；表單載入正確名稱；無橫向捲動；無「無法取得」。
  - `/admin/collection/102/copies`：同一頁首，目前分頁「副本與品況」，「此頁沒有副本資料」。
  - `/admin/collection/73`：「缺少來源身份」以文字顯示，類型「組合」。
  - `/admin/collection/999999`：HTTP 404，顯示「找不到收藏。」。
  - 三個過渡分頁連結帶 `collection`、`scope`、`lang` 指向 R06、卡套需求、採購舊頁。
  - R02 列表類型文字改為依資料顯示（例：「組合 · #73」）。
- **資料觀察（補充 §6.3 of 階段 4）**：32 筆「缺少來源身份」的收藏，抽查前三筆類型皆為「組合」（禮包、大全套），未對應單一 BGG 遊戲屬合理；是否另建對應留待 #29 系列花費設計時一併考慮。
- 遠端操作：`wrangler deployments status` 數次、HTTP 17 次、登入後瀏覽 6 頁；寫入 0。

## 7. 工作命令：5b 實體組件分頁（2026-11-25 已授權，DECISION_LOG UI-S5B-AUTH）

### 7.1 盤點（2026-11-25 靜態閱讀）

- R06 頁 `src/pages/admin/collection/components/manage.astro`（223 行）：伺服器端以 `?collection=N` 讀定義、可清點副本、卡套需求、清點值、分類（`classifyStoredComponents`）與更正歷史（`readQuantityHistory`）；無 `collection` 時顯示 #22 收藏選擇器；頁上另有「收藏 ID」表單與「← 返回收藏」。
- 前端 `physical-component-admin-controller.ts`：寫入走 `/api/admin/collection/components`；sessionStorage 的儲存通知與 D1 待處理操作鍵值含 `location.pathname`（換網址後舊網址下的暫存鍵不再對應；正式環境 0 個受控組件〔D1-A5-CLOSE〕，無實際影響）。
- 舊網址引用：`CollectionDetailTabs.astro`（過渡連結）、`CollectionAdmin.astro`（mode=new 隱藏入口）、`collection-admin-controller.ts`（R02「⋯」選單、新增後入口）、`components/classification.astro`、`sleeves/index.astro`、`sleeves/requirements.astro`、側欄 `admin-shell-controller.ts`；測試 `admin-shell.test.ts`、`admin-shell-browser.mjs`、`physical-quantity-browser.mjs`、`collection-picker-browser.mjs`、預覽 helper。

### 7.2 工作命令

```text
工作命令 ID：UI-S5B-20261125-01
工作目標：把 R06 實體組件搬進收藏詳細頁分頁 /admin/collection/[id]/components（共用頁首＋分頁列），舊網址轉址，
  移除側欄「實體組件」（Q49）。R06 的讀取、寫入、分類、D1 預覽與更正歷史行為完全不變。

已批准規格：本文件 §2、§3、§4（Q45、Q46、Q49）；5a 的頁首與分頁列元件（§6）。

行為要求：
  1. 新增路由 src/pages/admin/collection/[id]/components.astro：驗證 id 與 scope（同 5a：400／404），渲染
     CollectionDetailHeader＋CollectionDetailTabs（active="components"）＋R06 內容。收藏不在該 scope 時回 404。
  2. 把 manage.astro 的伺服器讀取與內容區抽成元件（例如 src/components/admin/PhysicalComponentsPanel.astro，以 collectionId 為參數），
     SQL、讀取順序、錯誤處理（400／404／503 訊息）、canWrite 條件、所有 data-* 屬性、表單欄位名稱、按鈕與
     D1QuantityPreviewDialog／D1QuantityHistory 的用法逐字保留；只移除「← 返回收藏」導覽、「收藏 ID」表單與 CollectionPicker
     （由頁首、分頁列與 R02 取代），保留「組件分類」連結。外框可改用階段 2 的面板與標題樣式，不得改動 controller 依賴的結構。
  3. manage.astro 改為只做 302 轉址、不讀 D1：?collection=N（正整數）→ /admin/collection/N/components，保留 scope（未帶時為 production）
     與 lang；未帶或無效 collection → /admin/collection（保留 lang）。
  4. 側欄移除「實體組件」項目；/admin/collection/[id]/components 在側欄標示「全部收藏」。
  5. 站內連結改指新網址：CollectionDetailTabs（移除 components 的過渡註解）、CollectionAdmin mode=new 隱藏入口、
     collection-admin-controller.ts（R02「⋯」選單的實體組件、新增後入口）、classification.astro、sleeves/index.astro、sleeves/requirements.astro。
  6. #22 收藏選擇器不再使用：不刪除 CollectionPicker.astro、collection-picker.ts、collection-picker-controller.ts 與其測試（刪除與否併入 #18 由使用者決定）；
     tests/collection-picker-browser.mjs 因入口已轉址而停用，不執行（回報中註明）。
  7. 中英雙語、1440／768／375 無整頁橫向捲動、WCAG AA；R06 表格寬時只允許表格區內橫向捲動。

允許修改範圍：新增 src/pages/admin/collection/[id]/components.astro、src/components/admin/PhysicalComponentsPanel.astro；
  src/pages/admin/collection/components/manage.astro（改為轉址）；src/components/admin/CollectionDetailTabs.astro；
  src/components/CollectionAdmin.astro（只限 mode=new 隱藏入口網址）；src/lib/collection-admin-controller.ts（只限實體組件網址）；
  src/lib/admin-shell-controller.ts（只限移除項目與目前項目比對）；src/pages/admin/collection/components/classification.astro、
  src/pages/admin/sleeves/index.astro、src/pages/admin/sleeves/requirements.astro（只限實體組件網址）；src/styles/admin-theme.css（只限新增 R06 外框樣式）；
  tests/admin-shell.test.ts、tests/admin-shell-browser.mjs、tests/physical-quantity-browser.mjs、tests/helpers/admin-dashboard-preview.ts（只限路由與網址）；
  tests/admin-collection-detail.test.ts、tests/admin-collection-detail-browser.mjs（只增）。

禁止事項：不改 src/lib/physical-component-management.ts、src/lib/component-classifier-adapter.ts、src/lib/physical-component-admin-controller.ts、
  src/lib/d1-quantity-history.ts、D1QuantityPreviewDialog.astro、D1QuantityHistory.astro、PhysicalComponentFields.astro、
  /api/admin/collection/components 與任何寫入 API；不改 migrations、wrangler.json、package.json、astro.config.mjs、middleware、auth；
  不刪除檔案；不新增套件或網路字型；不連遠端、不建置、不部署、不 git commit／push；不讀 .env／.dev.vars／備份。超出範圍時停下回報。

單元測試必須涵蓋：轉址三種情況（有效 collection＋scope、只有 collection、無或無效 collection）且不讀 D1；新路由 400／404；
  側欄不再有「實體組件」且新路由標示「全部收藏」；既有 R06／D1 測試全數通過。

允許執行的驗證：
  1. node --import tsx --test tests/physical-component-management.test.ts tests/admin-component-classification.test.ts
     tests/component-classifier.test.ts tests/component-classifier-adapter.test.ts tests/d1-quantity-api.test.ts tests/d1-quantity-history.test.ts
     tests/d1-quantity-preview-view.test.ts tests/physical-quantity-impact.test.ts tests/admin-shell.test.ts tests/admin-collection-detail.test.ts
     tests/admin-collection-list.test.ts
  2. node tests/physical-quantity-browser.mjs <暫存目錄>（D1 A3 Edge，改用新網址，結果須與先前相同）；
     node tests/admin-collection-detail-browser.mjs <暫存目錄>；node tests/admin-shell-browser.mjs <暫存目錄>；
     node tests/admin-collection-list-browser.mjs <暫存目錄>
  3. npm run astro -- check（基準 10 個錯誤，不得新增）
  4. git diff --check

瀏覽器驗收（合成資料）：實體組件分頁 1440／768／375；頁首＋分頁列；R06 新增組件、清點儲存、D1 預覽開啟後取消、更正歷史顯示
  （沿用 physical-quantity-browser 的情境）；封存收藏唯讀；舊網址三種轉址；側欄無「實體組件」；英文。
  截圖存 docs/UI-S5B-screenshots/。
完成條件與交付：修改檔案與摘要、驗證數字、瀏覽器逐項結果、截圖清單、astro check 錯誤數、未執行項目（含停用的 collection-picker-browser）；
  更新 HANDOFF.md。
部署：Claude 審查通過、使用者看過截圖後，依 DEPLOY-01 另行授權推送；部署後 Claude 唯讀抽查，使用者登入後 30 分鐘內 Claude 檢查
  （正式環境 0 個受控組件，D1 預覽與歷史仍依 #23 待首次建立組件時確認）。
```

### 7.3 審查（2026-11-25）：有條件通過

- **範圍**：新增 `[id]/components.astro`、`PhysicalComponentsPanel.astro`、11 張截圖；`manage.astro` 改為純 302 轉址（不讀 D1）；修改分頁列、側欄、R02 選單與新增後入口、`classification.astro`、`sleeves/index.astro`、`sleeves/requirements.astro` 的網址；測試依 §7.2 與 UI-S5B-AUTH-02 更新。禁止修改清單中的檔案皆未動；未刪除檔案。
- **程式核對**：面板與舊 R06 頁逐行比對，差異只有 §7.2 指定移除的「← 返回收藏」、收藏 ID 表單、CollectionPicker，外框由 `<main>` 改為 `<div>`、`h1` 改 `h2`、controller 匯入路徑與外框樣式；另新增「收藏不在該 scope 時回 404」（符合 §3 固定規則）。controller 只以 `[data-physical-manager]` 取得根節點，不依賴 `<main>` 焦點。
- **Claude 重跑**：Node 11 檔 **112／116**（失敗見下）；D1 A3 Edge **12／12**；詳細頁 Edge **25／25**（含 R06 新增組件、清點儲存並重載、三種寬度、封存唯讀、英文、舊網址轉址）；`astro check` **10 個基準錯誤**；`git diff --check` 通過。側欄 9／9、R02 12／12 引用 Codex 回報。Claude 已看 components-1440、components-375 截圖。
- **條件（未通過項，兩檔皆不在 §7.2 允許範圍）**：
  1. `tests/physical-component-management.test.ts` 約第 200 行仍以舊網址 `manage?collection=` 預期 200 並檢查 R06 畫面內容；舊網址已依 Q49 改為 302，應改為請求 `/admin/collection/[id]/components` 以保留 R06 真實畫面的測試覆蓋。
  2. `tests/admin-component-classification.test.ts` 約第 105 行對整頁 HTML 斷言不得出現 `<button|form>`；階段 1（`a5d16c3`）起 Admin 外框即含按鈕（HEAD 的 `AdminLayout.astro` 有 3 個 `<button`），此為**既有失敗**、非 5b 造成，應把斷言限縮到分類內容區。
- **小觀察（不擋）**：(1) 合成資料截圖的頁首封面顯示破圖示（合成圖片網址無法載入；頁首的隱藏腳本在此頁未及時生效，正式環境 5a 驗收封面正常，部署後再確認）；(2) R06 面板內「管理實體組件」與「收藏名稱 (#N, scope)」兩個標題與頁首重複；(3) 分類清單的連結固定帶 `production`，test 收藏會 404（分類清單本身沒有 scope 欄位，Codex 回報）。
- **過程事件**：Claude 為確認第 2 項是否既有，曾在暫存區建立 HEAD 工作樹並以目錄連結共用 `node_modules`；以 `git worktree remove --force` 移除時連同專案 `node_modules` 內容一併刪除。經使用者同意以 `npm ci` 依 lockfile 重裝（242 套件；`workerd` postinstall 依專案 `allowScripts` 未執行，執行檔已由 `@cloudflare/workerd-windows-64` 提供；`package.json`／lockfile 無變動）。之後不再以連結共用 `node_modules`。

### 7.4 測試修正複審（2026-11-25，UI-S5B-AUTH-03）：通過

- `physical-component-management.test.ts`：R06 畫面測試改請求 `/admin/collection/N/components?lang=en`，未帶 token 401、授權後畫面內容與寫入控制斷言全數保留；分類頁請求改寫為完整路徑，斷言不變。
- `admin-component-classification.test.ts`：先擷取 `<main id="editor-content">` 內容並斷言存在，再於內容區檢查無「已確認實體組件」與按鈕、表單；意圖不變。
- **Claude 重跑**：Node 11 檔 **116／116**；`git diff --check` 通過。只改這兩檔，未動 src。
- **結論**：§7.3 條件解除，`UI-S5B-20261125-01` 審查通過。尚未提交；待使用者看截圖後依 DEPLOY-01 授權推送部署。

### 7.5 部署與唯讀抽查（2026-11-25）

- 部署：`4192b69`（5b）＋`dbcc48b`（文件）推送（DECISION_LOG UI-S5B-DEPLOY），自動部署為 `14d31a92…`（100%，台北 10:52:44）。
- Claude 唯讀抽查 14 條路由全部符合：公開頁 4 條 200；`/admin`、`/admin/collection`、`/admin/collection/102`、`/102/copies`、`/102/components`、舊 `manage?collection=102`、舊 `manage`、`classification`、`sleeves/requirements` 皆 302 至 Access；`/dev/ui-kit` 404。D1 查詢與寫入 0。
- **正式驗收（使用者重新登入後，Claude 唯讀檢查，面板寬 518px，未新增或儲存任何資料）：通過**。
  - 舊網址 `manage?collection=102` → `/admin/collection/102/components?scope=production`；頁首「工業革命伯明翰 籌碼版／BGG:224517／本體／持有副本 0／已收藏」，封面載入正常（合成截圖的破圖示未在正式環境出現）；目前分頁「實體組件」；R06 面板顯示新增表單與「尚無由受控流程建立的組件」；無警示、無橫向捲動。
  - 側欄已無「實體組件」，目前項目為「全部收藏」。
  - 舊網址 `manage`（無 collection）→ `/admin/collection`。
  - R02「⋯」選單的實體組件連結為 `/admin/collection/73/components?scope=production&lang=zh-TW`。
  - 組件分類頁的收藏連結改為 `/admin/collection/123/components`；「管理實體組件」連到 R02。
  - 正式環境 0 個受控組件，D1 預覽與更正歷史仍依 #23 待首次建立組件時確認。
- 遠端操作：登入後瀏覽 4 頁；寫入 0。
- 另：本機 `docs/D1-A4-screenshots/` 4 張更正歷史截圖被 `physical-quantity-browser.mjs` 重跑覆寫為新版面，未提交，待使用者決定保留或還原。
