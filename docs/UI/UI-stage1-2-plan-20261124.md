# #10 UI 階段 0～2｜規劃（2026-11-24 已採納，DECISION_LOG UI-S1-Q30～Q32）

對應 CURRENT_TASK #10、#17。依據：[V2 UI／UX 設計規範](V2-UI-Design-System.md)（已採納，UI-02、UI-D1～UI-D8）§3～§6、§8、§9、§11、§13。

## 1. 現況盤點（2026-11-24 靜態閱讀）

| 項目 | 現況 |
| --- | --- |
| 階段 0（素材） | ✅ 已完成：橫幅 WebP 兩張、37 個內嵌 SVG 圖示（`AdminIcon.astro`，UI-P0-20261123-01）；插畫 13 張已交付（UI-ART-01，尚未接線） |
| Admin 骨架 | [`AdminLayout.astro`](../../src/layouts/AdminLayout.astro)（50 行）：深色頁首＋品牌「N.」＋扁平 8 連結側欄＋跳至內容＋語言切換保留參數 |
| Admin 樣式 | `admin-editor.css`（28 行，`--admin-*` 變數、深綠 `#0f6b5c`、`system-ui`）、`admin-ui.css`（46 行，record／panel／表單／status-badge） |
| Admin 頁面 | 16 個 `.astro`（含 R05 編輯、副本、NotBGG 編輯／連結／關聯、卡套、需求、採購、BGG、組件管理與分類）；部分透過 `CollectionAdmin`、`NotBggAdmin`、`NotBggEditor` 元件套用版面 |
| 收藏清單篩選 | R02 已支援網址參數 `status`、`wishlist`，側欄「已收藏／願望清單／預購中」可直接用篩選網址 |
| 本機預覽 | 路徑空格問題已解決（DEV-01）。既有 `tests/helpers/admin-dashboard-preview.ts` 可用拋棄式 SQLite＋Access 測試身分渲染 Admin 頁，A3／A4／#22 的 Edge 腳本都用它 |
| 部署 | 推送 `main` 即部署（DEPLOY-01）；階段 1 會改變所有 Admin 頁外觀 |

## 2. 階段劃分（依設計規範 §13）

- **階段 1：Design token＋App Shell**。新增 `src/styles/admin-theme.css`（§3 token），`--admin-*` 改指向新 token（一次換膚、最小 diff）；`AdminLayout` 改為 §4／§5 的群組側欄、品牌區、R01 才顯示的頁首橫幅、手機與平板抽屜。各頁內容與功能不改。
- **階段 2：共用元件 CSS**。§6 元件（按鈕、警示橫幅、統計卡、狀況清單卡、徽章、分頁籤、表格、篩選列、分頁器、數量步進器、確認彈窗、批次結果、空狀態、通知）集中於 `admin-theme.css`，並做一個**僅本機**的元件展示頁；既有頁面逐步替換留在階段 3～5。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q30 | 「實體組件」在側欄的位置（D4 分頁要到階段 5 才做） | 過渡期保留，放在「收藏」群組內（#22 選擇器已可用） | 現在就從側欄拿掉，只從收藏頁進入 | **A**：拿掉會讓目前唯一的直接入口消失；階段 5 完成分頁後再移除 |
| Q31 | 階段 1、2 的工作命令 | 分兩張：階段 1 審查並部署後，再發階段 2 | 合併一張 | **A**：階段 1 會改變所有頁面外觀，先單獨審查與上線，風險小、好回退 |
| Q32 | 截圖與驗收方式 | 沿用 `admin-dashboard-preview` 拋棄式 SQLite＋本機 Edge，逐頁截 1440／768／375 | 本機 `astro dev` 加本機管理員旁路 | **A**：已驗證可用、不需讀 `.dev.vars`、不碰正式資料 |

## 4. 工作命令：階段 1（2026-11-24 已授權，DECISION_LOG UI-S1-AUTH）

```text
工作命令 ID：UI-S1-20261124-01
工作目標：完成設計規範階段 1（Design token＋App Shell），所有 Admin 頁換成新外觀與群組側欄，頁面功能不變。

已批准規格：docs/UI/V2-UI-Design-System.md §3（token）、§4（App Shell）、§5（導覽，含 D2）、§4.4（D1 橫幅範圍）、
  §8（響應式）、§9（無障礙）、§11（延續／替換）；本文件 §3 的使用者決定（Q30～Q32）。

行為要求：
  1. 新增 src/styles/admin-theme.css：§3.1 色彩、§3.2 字體（不引入網路字型）、§3.3 間距／圓角／陰影／焦點環 token。
     admin-editor.css 的 --admin-* 改指向新 token；字族改為 §3.2。不改各頁結構。
  2. AdminLayout.astro：
     - 品牌區：爪印標誌（沿用公開網站既有爪印或 AdminIcon）＋「桌遊收藏…／BOARD GAME…」文字，取代「N.」。
     - 側欄群組（§5，D2）：總覽；收藏（全部收藏、已收藏、願望清單、預購中、實體組件〔Q30 過渡期〕、組件分類查詢）；
       卡套（卡套管理、卡套需求與套用）；採購（採購管理）；遊戲資料（BGG 管理、NotBGG 清單、遊戲關聯）。
       「已收藏／願望清單／預購中」使用 R02 既有篩選網址（status、wishlist）。群組可收合（button aria-expanded），
       目前頁所在群組預設展開；目前項目 aria-current="page"，紫色淺底＋左側強調。每項帶 AdminIcon。
     - 側欄底部：公開網站連結與語言切換（沿用現有保留參數行為）。
     - 頁首橫幅（D1）：只在 /admin（R01）顯示；桌面完整、手機 72px 裁切（object-position: center 62%）；
       使用既有 public/images/admin/banner-1600.webp／banner-800.webp 與 srcset，alt=""、aria-hidden、固定寬高。
     - ≥1100px 側欄固定（1440 以上 260px、1100～1439 240px，sticky、可捲）；768～1099 與 <768 為抽屜：
       App Bar 的 ☰（aria-label、aria-expanded），<dialog> 或 inert 背景，Esc 關閉並把焦點還給 ☰，overscroll-behavior: contain。
     - 保留跳至內容連結、#editor-content、每頁一個 <main>。
  3. 所有寬度不得出現橫向頁面捲動（§8）。動畫只用 transform／opacity，尊重 prefers-reduced-motion。
  4. 文字對比由實作驗證達 WCAG AA（一般 4.5:1、大字與圖形 3:1）；不達標時加深文字色，不改背景。
  5. 中英文字齊全。

允許修改範圍：
  - 新增 src/styles/admin-theme.css
  - src/styles/admin-editor.css、src/styles/admin-ui.css（只限改指向 token 與字族；不重寫元件，元件屬階段 2）
  - src/layouts/AdminLayout.astro
  - 新增 src/lib/admin-shell-controller.ts（抽屜與群組收合；必要時）
  - src/components/admin/AdminIcon.astro（只限新增側欄需要但缺少的圖示）
  - 新增 tests/admin-shell-browser.mjs（以 tests/helpers/admin-dashboard-preview.ts 拋棄式 SQLite＋本機 Edge）
  - 新增 tests/admin-shell.test.ts（導覽資料、目前項目判斷等純函式）
  - tests/collection-picker-browser.mjs（只限把截圖輸出改為使用傳入的暫存目錄參數，不改測試內容；2026-11-24 擴大，DECISION_LOG UI-S1-AUTH-02）
  - tests/helpers/admin-dashboard-preview.ts（只限補上收藏新增／編輯與 NotBGG 新增／編輯／身份對應／配件關聯 6 頁的路由與動態參數，沿用拋棄式 SQLite 與測試身分；同上）

禁止事項：不改各頁內容與業務邏輯、API、migrations、wrangler.json、package.json、astro.config.mjs、middleware、auth；
  不接插畫（屬階段 3～5）；不新增套件或網路字型；不連遠端、不建置、不部署、不 git commit／push；
  不讀 .env／.dev.vars／備份。超出範圍時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/admin-shell.test.ts tests/collection-picker.test.ts tests/d1-quantity-history.test.ts tests/d1-quantity-preview-view.test.ts tests/d1-quantity-api.test.ts tests/physical-component-management.test.ts
  2. node tests/admin-shell-browser.mjs <暫存目錄>
  3. 既有 Edge 回歸：node tests/physical-quantity-browser.mjs <暫存目錄>、node tests/collection-picker-browser.mjs <暫存目錄>
     （截圖寫入暫存目錄，不得覆寫 docs 內既有截圖）
  4. npm run astro -- check（基準 10 個錯誤，不得新增）
  5. git diff --check

瀏覽器腳本必須涵蓋：每個 Admin 頁可載入且目前項目正確；群組收合與預設展開；鍵盤 Tab 走訪側欄、焦點可見；
  768 與 375 抽屜開關、Esc 關閉並還原焦點、背景不可操作；三種寬度皆無橫向捲動；橫幅只在 /admin 出現且手機為 72px 裁切；
  語言切換保留參數；篩選連結帶正確參數。
截圖（docs/UI-S1-screenshots/，只用合成資料）：每個 Admin 頁 1440／768／375 各一張；抽屜開啟（768、375）；
  /admin 桌面與手機橫幅；鍵盤焦點示意。

完成條件與交付：新增／修改檔案與摘要、各驗證結果數字、瀏覽器逐項結果、截圖清單、對比檢查結果、astro check 錯誤數、
  未執行項目；更新 HANDOFF.md（追加條目）。
上線：Claude 審查並由使用者看過截圖後，推送依 DEPLOY-01 另行授權；部署後由 Claude 唯讀確認，使用者登入人工確認（Access 30 分鐘內）。
```

階段 2 工作命令待階段 1 審查並上線後起草（Q31）。

## 5. 階段 1 審查（2026-11-24）：通過，使用者已看截圖同意（UI-S1-DEPLOY）

- **範圍**：變更在 §4（含 UI-S1-AUTH-02）允許範圍內：新增 `admin-theme.css`、`admin-shell-controller.ts`、兩支測試；修改 `AdminLayout.astro`、兩支舊 CSS、預覽 helper（補 6 頁）、選擇器腳本（截圖改寫暫存目錄）。各頁內容、API、migrations、套件未動；已提交截圖未被改動（Codex 回報曾覆寫 4 張 A4 截圖並已還原，Claude 確認 docs 內無已追蹤 PNG 變更）。
- **符合**：§5 群組導覽（Q30「實體組件」在收藏群組）、篩選連結（status、wishlist、view=relations）與目前項目判斷；群組收合與預設展開；≥1100px 固定側欄、以下為 `<dialog>` 抽屜（Esc 關閉、焦點還原）；橫幅只在 R01、srcset 與固定寬高；語言切換保留參數；跳至內容。
- **偏離與說明**：為達 WCAG AA，加深部分語意文字色，並在橘色焦點環外加一圈深紫外緣（§3.3 原為單一橘色焦點環）；屬 §3「不達標時加深文字色」的處理方向，焦點外緣為新增，請使用者看截圖確認。R01 統計數字仍為舊的綠色，屬階段 2 元件範圍。
- **Claude 重跑**：六檔 Node 測試 **40／40**；Shell Edge 腳本 **9／9**；選擇器回歸 **11／11**（截圖確認寫入暫存目錄）；`astro check` **10 個錯誤**（無新增）；`git diff --check` 通過。R06 改量回歸腳本引用 Codex 結果 12／12，未由 Claude 重跑。
- **截圖**：`docs/UI-S1-screenshots/` 51 張（16 頁 × 3 寬度＋抽屜 2＋鍵盤焦點 1），Claude 抽看 1440 總覽、375 抽屜、1440 編輯收藏。

## 6. 階段 1 正式環境驗收（2026-11-24）：通過

- 部署：`a5d16c3` 推送後 69 秒自動部署為 `e2d2fb15…`（100%）；Claude 唯讀抽查 15 條路由（含新插畫檔 200、Admin 未登入 302）全部符合。
- 使用者在內建瀏覽器面板登入後，Claude 操作檢查（面板寬 700px，即手機／平板版；只看不寫）：

| 項目 | 結果 |
| --- | --- |
| 工作台 | App Bar＋☰；橫幅為 72px 裁切版；目前項目「總覽」；無橫向捲動 ✅ |
| 抽屜 | ☰ 開啟後焦點在「關閉導覽」、aria-expanded=true；Esc 關閉、焦點回到 ☰ ✅ |
| 側欄群組 | 「收藏」可展開，6 個項目與篩選網址正確（`status=owned`、`wishlist=1`、`status=preordered`）✅ |
| 篩選連結 | 點「已收藏」→ `/admin/collection?status=owned…`，篩選欄位為 owned，目前項目「已收藏」，非 R01 無橫幅 ✅ |
| R06 | 目前項目「實體組件」；`q=91872` 搜尋結果正確 ✅ |
| 語言切換 | 切換連結保留 `q`；英文頁 `lang=en`、群組與項目英文、側欄連結帶 `lang=en`、搜尋結果英文標籤；切回連結帶 `lang=zh-TW` ✅ |

- 未在正式環境驗證 ≥1100px 固定側欄（面板寬度不足）；該寬度由本機 51 張截圖與 Shell Edge 腳本涵蓋。
