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

## 7. 階段 2＋3 規劃（2026-11-24 已採納，DECISION_LOG UI-S23-Q33～Q36）

背景：使用者看過階段 1 上線結果後指出「和當初規劃的畫面很不一樣」。原因是階段 1 只換外框與 token，各頁內容仍為舊樣式；Claude 部署前未說明這點。使用者決定接著做階段 2（共用元件）與階段 3（R01 管理工作台）。目標畫面：[Dashboard-V2-Approved-Concept.png](Dashboard-V2-Approved-Concept.png)。

### 7.1 R01 盤點（2026-11-24 靜態閱讀）

現行 [`src/pages/admin/index.astro`](../../src/pages/admin/index.astro)（190 行）：標題「NOTBGG / ADMINISTRATION 管理首頁」＋三張分區卡（收藏 4 數字、卡套 2 數字、遊戲資料 2 數字）＋按鈕。資料為單一 SELECT；無快捷操作、警示、採購成本、狀況清單卡與待處理項目。

### 7.2 設計圖區塊與資料規則對照

| 設計圖區塊 | 正式規則／資料 | 處理 |
| --- | --- | --- |
| 標題列：圖示＋「管理工作台」＋副標＋更新時間＋重新整理 | 更新時間＝頁面產生時間（Asia/Taipei）；重新整理＝重新載入 | 做 |
| 快捷操作 5 磚 | 新增收藏 `/admin/collection/new`、查詢收藏 `/admin/collection`、新增採購 `/admin/purchases`、卡套管理 `/admin/sleeves`、BGG 同步 `/admin/bgg` | 做（Q35 確認） |
| 警示：卡套庫存不足 | SLV-06／SIZE-03：「N 種尺寸庫存不足」，與尺寸頁同一不足來源；資料不完整時不得當作 0 | 做 |
| 警示：BGG 同步失敗 | D6：計目前狀態仍為失敗的筆數，不用「最近 7 天」 | 做 |
| 收藏 4 統計卡（總數、已收藏、願望清單、預購中＋百分比） | 沿用現行計算；百分比＝佔收藏總數 | 做 |
| 採購成本三卡（設計圖沒有，正式規格必須有，D6） | R10：已記錄採購成本（依幣別分列、不跨幣別加總、未封存／已封存收藏分列）、未分攤金額、待處理／已取消筆數分列；無有效分攤顯示「尚未記錄」 | 做，放第二列 |
| 卡套狀況卡（尺寸數、有需求紀錄、庫存不足） | 前兩者為計數；庫存不足同警示來源 | 做 |
| 組件狀況卡（組件定義數、實體組件紀錄、待確認分類） | 前兩者為計數；「待確認分類」口徑未定 | Q36 |
| 遊戲資料來源卡（BGG、NotBGG、尚未對應） | 前兩者為計數；「尚未對應」口徑未定 | Q36 |
| 近期活動 | D7：第一版不做 | 不做 |
| 待處理項目（組件缺件、卡套庫存不足、尚未清點、尚未設定卡套需求） | §10：只顯示已有正式規則的項目；缺件、尚未清點屬 R06-P0，尚未定義 | 只列有規則者（Q36） |
| 插畫浮水印 | §6：統計卡右下浮水印 ≤ 30% 透明度、`aria-hidden`；可用 UI-ART-01 的 `fn-*` | 做 |

所有數字不可得時顯示「—」並附 `sr-only` 說明，不顯示 0（§2 失敗關閉）。

### 7.3 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q33 | 部署節奏 | 階段 2、3 依序做、各自審查，**兩者都完成後一起部署**（避免再出現半新半舊） | 階段 2 完成就先部署 | **A** |
| Q34 | 階段 2 元件展示頁 | 只在本機（不部署，路由在正式環境回 404） | 部署到正式 Admin | **A**：設計規範 §13 定為僅本機 |
| Q35 | 快捷操作 5 磚 | 照設計圖：新增收藏、查詢收藏、新增採購、卡套管理、BGG 同步 | 你指定其他組合 | **A** |
| Q36 | 沒有正式規則的項目（組件狀況「待確認分類」、遊戲資料來源「尚未對應」、待處理的「組件缺件／尚未清點／尚未設定卡套需求」） | 這次不顯示；待處理只列「卡套庫存不足」「BGG 同步失敗」。之後另訂規則再加 | 先為這些項目訂規則（另開設計，延後階段 3） | **A**：不延誤，也不用示意數字補位 |

決定後產出階段 2、3 兩張工作命令。

## 8. 工作命令：階段 2 共用元件（2026-11-24 已授權，DECISION_LOG UI-S23-AUTH）

```text
工作命令 ID：UI-S2-20261124-01
工作目標：依設計規範 §6 建立 Admin 共用元件樣式與元件，並做僅本機的元件展示頁；不改任何既有頁面（套用屬階段 3～5）。

已批准規格：docs/UI/V2-UI-Design-System.md §3、§6、§7（插畫用法）、§8、§9；本文件 §7（DECISION_LOG UI-S23-Q33～Q36）。

行為要求：
  1. 在 src/styles/admin-theme.css 新增 §6 元件樣式：頁面標題列、按鈕（primary／secondary／danger／ghost，44px、hover、
     focus-visible、disabled、進行中保留寬度）、快捷操作磚、警示橫幅（danger／warning、資料不可得顯示「無法取得」）、
     統計卡（圖示徽章＋小標＋tabular-nums 大數字＋次要說明＋右下插畫浮水印 ≤30%、aria-hidden；不可得顯示「—」＋sr-only）、
     狀況清單卡（鍵值列＋計數徽章）、計數徽章／狀態膠囊（圖示＋文字＋色）、分頁籤、表格（手機改卡片）、篩選列、分頁器、
     數量步進器、確認彈窗、批次結果、空狀態（插畫＋原因＋一個下一步按鈕）、待處理項目列表、通知訊息。
  2. 需要結構的元件做成 src/components/admin/ 下的 Astro 元件（例如 PageHeader、QuickActionTile、AlertBanner、StatCard、
     StatusListCard、CountBadge、EmptyState、PendingList）；純樣式者只提供 class。插畫使用 public/images/admin/ 既有 fn-*／empty-*。
  3. 新增元件展示頁 src/pages/dev/ui-kit.astro（2026-11-24 修訂，DECISION_LOG UI-S2-Q34-REV；原為 /admin/ui-kit）：
     列出所有元件與各狀態（含不可得、錯誤、空狀態、中英文），可使用 AdminLayout 呈現；比照 src/pages/dev/collection-v2-test.astro，
     非 DEV（!import.meta.env.DEV）時在讀任何資料前回 404 與 Cache-Control: no-store。不讀 D1、不需 Access。保留至階段 5 完成後再決定是否清理。
  4. 對比達 WCAG AA；動畫只用 transform／opacity，尊重 prefers-reduced-motion。

允許修改範圍：src/styles/admin-theme.css；新增 src/components/admin/ 下的元件；新增 src/pages/dev/ui-kit.astro；
  src/components/admin/AdminIcon.astro（只限新增缺少的圖示）；新增 tests/admin-ui-kit.test.ts（含非 DEV 回 404）、
  tests/admin-ui-kit-browser.mjs（本機 Edge 截圖）；tests/helpers/admin-dashboard-preview.ts（只限新增 /dev/ui-kit 的本機預覽路由，
  同屬 UI-S2-Q34-REV 調整）。

禁止事項：不改任何既有頁面、AdminLayout、admin-editor.css、admin-ui.css；不改 API、migrations、wrangler.json、package.json、
  astro.config.mjs、middleware、auth；不新增套件或網路字型；不連遠端、不建置、不部署、不 git commit／push；
  不讀 .env／.dev.vars／備份。超出範圍時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/admin-ui-kit.test.ts tests/admin-shell.test.ts tests/collection-picker.test.ts
  2. node tests/admin-ui-kit-browser.mjs <暫存目錄>；node tests/admin-shell-browser.mjs <暫存目錄>（回歸，截圖只寫暫存目錄）
  3. npm run astro -- check（基準 10 個錯誤，不得新增）
  4. git diff --check

截圖（docs/UI-S2-screenshots/，只用合成資料）：展示頁 1440／768／375；按鈕與焦點狀態特寫；不可得與空狀態特寫。
完成條件與交付：新增檔案與摘要、驗證結果數字、截圖清單、對比檢查結果、astro check 錯誤數、未執行項目；更新 HANDOFF.md。
部署：依 Q33，不單獨部署；待階段 3 完成並審查後一起部署（DEPLOY-01 另行授權）。
```

## 9. 工作命令：階段 3 R01 管理工作台（2026-11-24 已授權，DECISION_LOG UI-S23-AUTH；在階段 2 審查通過後才交付）

```text
工作命令 ID：UI-S3-20261124-01
工作目標：依設計圖 docs/UI/Dashboard-V2-Approved-Concept.png 與本文件 §7.2 重做 R01（/admin），使用階段 2 元件。

已批准規格：本文件 §7.2、§7.3（Q35、Q36）；設計規範 §4.4、§6、§8、§10；SLV-06、SIZE-03（docs/V2-Admin-decisions-and-test-plan.md）；
  R10 Dashboard 三卡規則（docs/V2-R10-decisions.md 第 57～63 行、docs/V2-R10-scope-and-acceptance.md）；D6、D7。

行為要求：
  1. 版面順序：橫幅（階段 1 已有）→ 標題列（家圖示＋「管理工作台」＋副標「日常管理、資料維護與待處理事項總覽」＋
     更新時間 Asia/Taipei＋重新整理）→ 快捷操作 5 磚（Q35）→ 警示（2026-11-24 修訂 UI-S3-SLV-01：只有 BGG 同步失敗；0 時不顯示，
     不可得時顯示「無法取得」）→「收藏與資料概況」：第一列收藏 4 統計卡（總數、已收藏、願望清單、預購中＋佔總數百分比），
     第二列採購成本三卡，第三列卡套狀況卡、組件狀況卡、遊戲資料來源卡 → 待處理項目（佔滿整列，D7）。
  2. 資料（全部唯讀、伺服器端）：新增 src/lib/admin-dashboard-summary.ts，各區塊獨立查詢、各自失敗隔離（一區失敗只該區顯示「—／無法取得」）。
     - 收藏計數：沿用現行 index.astro 的口徑。
     - 卡套庫存不足：**本次不做**（UI-S3-SLV-01；SLV-06／SIZE-03 未實作，另列 CURRENT_TASK #27）。
     - BGG 同步失敗：目前狀態仍為失敗的筆數（D6）。
     - 採購三卡：依 R10——已記錄採購成本依幣別分列、未封存／已封存收藏分列、不跨幣別加總，無有效分攤顯示「尚未記錄」；
       未分攤只計成本狀態訂單的正數餘額；待處理／已取消筆數分列。卡片連到採購清單對應篩選（若既有篩選支援）。
       分攤警示依 §11（UI-S3-R10-01／02）：只看計入成本訂單；「不一致 N 筆」＝超額分攤、分攤目標異常；
       「待核 M 筆」＝按比例分攤仍有正餘額、依既有規則無法映射的歷史副本分攤；各附訂單連結；不修正已存分攤；其餘不標示。
     - 卡套狀況：尺寸數、有需求紀錄數（不顯示庫存不足列）。組件狀況：組件定義數、實體組件紀錄數（Q36 不顯示待確認分類）。
       遊戲資料來源：BGG 數、NotBGG 數（Q36 不顯示尚未對應）。
     - 待處理：只列 BGG 同步失敗（N 筆），連到對應頁；為 0 時顯示空狀態。
  3. 插畫：統計卡／狀況卡右下浮水印使用 fn-*（≤30%、aria-hidden）；待處理空狀態可用 empty-no-result 或合適的 empty-*。
  4. 數字 tabular-nums、Intl.NumberFormat；金額依幣別 Intl.NumberFormat currency；不可得一律「—」＋sr-only，不顯示 0。
  5. 響應式依 §8：快捷 5／3／2 欄、統計 4／2／2 欄；所有寬度無橫向捲動。中英文齊全。

允許修改範圍：src/pages/admin/index.astro；新增 src/lib/admin-dashboard-summary.ts；src/components/admin/ 下階段 2 元件（只限修正）；
  tests/helpers/admin-dashboard-preview.ts（只限新增 R01 所需合成資料）；新增 tests/admin-dashboard-summary.test.ts、
  tests/admin-dashboard-browser.mjs。

禁止事項：不改其他頁面、API 回應格式、migrations、wrangler.json、package.json、astro.config.mjs、middleware、auth；
  不新增寫入；不用示意數字補位；不連遠端、不建置、不部署、不 git commit／push；不讀 .env／.dev.vars／備份。超出範圍時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/admin-dashboard-summary.test.ts tests/admin-ui-kit.test.ts tests/admin-shell.test.ts（＋若改到卡套檔案，跑既有卡套相關測試）
  2. node tests/admin-dashboard-browser.mjs <暫存目錄>；node tests/admin-shell-browser.mjs、node tests/sleeve-workflow-browser.mjs（若改到卡套）<暫存目錄>
  3. npm run astro -- check（基準 10）
  4. git diff --check

單元測試必須涵蓋：各區塊計數與口徑；R01 不出現卡套庫存不足；BGG 失敗只計目前失敗；採購三卡依 R10
  （多幣別不加總、封存分列、無分攤「尚未記錄」、負餘額不抵銷、取消分列、§11 四種情況各自歸類正確、手動未分完與未計入成本訂單不標示、
  可合法映射的歷史副本分攤不標示）；單一區塊查詢失敗只影響該區。
截圖（docs/UI-S3-screenshots/）：R01 1440／768／375；全部資料正常；有警示；全部 0／空狀態；單區失敗；英文。
完成條件與交付：檔案與摘要、驗證數字、瀏覽器逐項結果、截圖清單、astro check 錯誤數、未執行項目；更新 HANDOFF.md。
部署：階段 2、3 審查後由使用者看截圖，依 DEPLOY-01 另行授權一起推送部署；部署後 Claude 唯讀確認，使用者登入後 30 分鐘內由 Claude 檢查。
```

## 10. 階段 2 審查（2026-11-24）：通過

- **範圍**：新增 8 個元件（PageHeader、QuickActionTile、AlertBanner、StatCard、StatusListCard、CountBadge、EmptyState、PendingList）、`src/pages/dev/ui-kit.astro`、兩支測試；修改 `admin-theme.css`（`admin-kit-*` 類別）與預覽 helper（只加 `/dev/ui-kit`）。既有頁面、AdminLayout、舊 CSS、middleware 未動；已提交截圖未被改動。
- **符合**：§6 元件皆有展示（按鈕各狀態與進行中、快捷磚、警示含「無法取得」、統計卡含浮水印與「—」、狀況清單卡、分頁籤與膠囊、篩選列、表格、分頁器、數量步進器、通知、批次結果、空狀態與載入錯誤）；展示頁非 DEV 回 404＋no-store、不讀 D1。
- **Claude 重跑**：三檔 Node 測試 **12／12**；展示頁 Edge **6／6**；`astro check` **10 個錯誤**（無新增）。抽看 `ui-kit-1440.png`，樣式與 Dashboard 設計圖方向一致。Shell 回歸 9／9 引用 Codex 結果。
- 依 Q33 不單獨部署；交付階段 3。

## 11. 採購三卡的分攤警示（2026-11-24，已採納 UI-S3-R10-01、UI-S3-R10-02）

使用者決定：警示涵蓋四種情況，分「不一致」與「待核」兩類顯示，各附訂單連結；只看計入成本（已付款、部分到貨、已完成）的訂單；不修正已存分攤；清單以外不標示，擴充須先提案。

| # | 情況 | Claude 建議分類 | 判斷依據 |
| --- | --- | --- | --- |
| 1 | **超額分攤**：對帳餘額 < 0（分出去比實付多） | **不一致** | R10 明確定義為異常，需列筆數與金額，不與其他訂單的正餘額互抵 |
| 2 | **按比例分攤卻仍有正餘額**：weighted 訂單理應全額分完 | **待核** | 可能來自退款後未重存、歷史匯入等；R10 未定義為錯誤 |
| 3 | **分攤目標異常**：分攤指向的明細或收藏不存在、或不屬於該訂單 | **不一致** | 資料結構上無法成立，屬確定錯誤 |
| 4 | **歷史副本分攤無法對應到收藏成本**：只限依既有規則**無法**映射者；可合法映射者不標示 | **待核** | Codex 指出歷史副本分攤多數可合法映射，不能全部標示 |

不屬於上述任一者（包含手動分攤未分完、未計入成本的訂單）不標示。

**待查證**：使用者提及正式採購表目前為空；Claude 尚未查證（需 1 次正式 D1 唯讀查詢，須使用者同意）。不論是否為空，本規則都按規格實作與測試。

**補充規則（2026-11-24，DECISION_LOG UI-S3-R10-03）**：
- 情況 3「分攤目標異常」：分攤未填明細（`purchase_order_line_id` 為空）、直接指向存在的收藏，屬合法整單分攤，不標示。有填明細時才檢查：明細存在、明細屬於該訂單、明細已指定的收藏與分攤目標一致；任一不符才算不一致。
- 情況 2「按比例卻仍有正餘額」：只在該訂單至少有一筆分攤、且全部為 `weighted` 時套用；混用 `manual` 的訂單不標示。

## 12. 階段 3 審查（2026-11-24）：通過，使用者已看截圖同意（UI-S23-DEPLOY）

- **範圍**：修改 `src/pages/admin/index.astro`、`StatCard`／`StatusListCard`（多幣別與浮水印）、預覽 helper（R01 合成資料）；新增 `admin-dashboard-summary.ts` 與兩支測試。卡套檔案、其他頁面、API、migrations、middleware 未動；已提交截圖未被改動。
- **資料規則核對**：全部唯讀、各區獨立失敗。採購：成本只計 paid／partially_received／completed；已記錄成本依幣別、未封存／已封存分列，只計 production 收藏；未分攤只加正餘額；超額另列筆數與金額不互抵；「不一致」＝負餘額或有填明細但明細不存在／不屬於該訂單／收藏不符（整單分攤不標示）；「待核」＝全部 weighted 且正餘額，或副本分攤無法對應收藏；open／cancelled 分列。BGG 失敗與 BGG 管理頁同口徑（中斷的同步視為失敗）。卡套只顯示尺寸數與有需求紀錄數。
- **Claude 重跑**：三檔 Node 測試 **11／11**；R01 Edge **7／7**；`astro check` **10 個錯誤**（無新增）；`git diff --check` 通過。Shell 回歸 9／9 引用 Codex 結果。
- **小觀察（不擋）**：待處理為空時的空狀態按鈕是「查看 BGG 管理」，語意略牽強；無警示時快捷操作與概況之間留白較大；採購三卡高度不一致時下方留白較多。可於日後微調。

## 13. 階段 2＋3 正式驗收（2026-11-24）：採購三卡失敗，其餘通過

- 部署：`07d39ff` 推送後自動部署為 `df35fa2e…`（100%）；Claude 唯讀抽查 14 條路由全部符合（`/dev/ui-kit` 404＋no-store）。
- 使用者登入後 Claude 檢查（面板寬 700px）：標題列、快捷 5 磚與連結、收藏統計（256／254／0／2，與 G0 一致）、BGG 警示（0，與 BGG 頁篩選一致）、三張狀況卡、待處理空狀態、英文模式、無橫向捲動皆通過。
- **採購三卡全部顯示「無法取得」**。診斷（使用者同意）：
  1. 本機以 G1 正式備份重跑同一查詢：成功、0 列（正式採購訂單與分攤皆 0 筆）。
  2. `wrangler tail`：每次載入記錄 `Admin dashboard section unavailable purchases Error`（非逾時）。
  3. 對正式 D1 執行同一唯讀查詢：**`too many terms in compound SELECT: SQLITE_ERROR [code: 7500]`**。
- **根因**：採購查詢以 6 段 `UNION ALL` 組成一個複合 SELECT；Cloudflare D1 的複合 SELECT 項數上限低於本機 SQLite（預設 500），本機測試因此未能發現。專案中其他複合查詢最多 5 段（`component-classifier-adapter.ts`，正式環境運作正常）。
- 失敗隔離如設計運作（只有採購區顯示「無法取得」，未顯示 0）。
- 遠端操作：wrangler tail 1 次（約 30 秒）、正式 D1 唯讀查詢 1 次、正式網站登入後瀏覽數頁；寫入 0。

## 14. 工作命令：採購三卡修正（2026-11-25 已授權，DECISION_LOG UI-S3-FIX-AUTH）

### 14.1 修正方式

- **觀察到的限制**：正式 D1 上 5 段複合 SELECT 正常（`component-classifier-adapter.ts`），6 段失敗（§13）。官方上限數字未查證，只記實測範圍。
- **做法（建議）**：把 `readPurchases` 的 6 段 `UNION ALL` 拆成 6 條獨立查詢，用一次 `db.batch()` 送出。D1 的 batch 在同一交易內執行，6 條讀到同一時間點的資料，與原本單一查詢等效；仍只有一次往返。各查詢的 CTE 以共用常數組成，不重寫口徑。回傳結構與 R01 顯示完全不變。
- **不採用**：縮到 5 段以下（剛好卡在實測上限，日後加一段又會壞）。
- **防再犯**：R01 單元測試的 D1 模擬層加守衛：儀表板查詢出現 `UNION`／`INTERSECT`／`EXCEPT` 即失敗，讓本機測試能抓到這類問題。
- **範圍外（只記風險）**：`component-classifier-adapter.ts` 的 5 段查詢正好在實測上限上，屬高敏感區，本次不動；日後修改該查詢時須注意不可再加段。

### 14.2 工作命令

```text
工作命令 ID：UI-S3-FIX-20261125-01
工作目標：修正 R01 採購三卡在正式 D1 回「too many terms in compound SELECT」而顯示「無法取得」（§13）。

已批准規格：§9 採購三卡與 §11 分攤警示規則（UI-S3-R10-01～03）全部沿用，口徑不得改變。

行為要求：
  1. src/lib/admin-dashboard-summary.ts 的 readPurchases 改為 6 條不含複合運算子的 SELECT
     （active／archived 金額、unallocated、excess、inconsistent、review、open／cancelled 筆數），
     以一次 db.batch([...]) 執行；cost_orders／allocations／allocation_checks 三段 CTE 抽成共用常數供需要的查詢引用。
  2. 任何一條失敗或回傳非安全整數 → 整個採購區拋錯，由既有 readSection 隔離為「無法取得」；不得部分顯示。
  3. 回傳物件（active、archived、unallocated、excess、inconsistent、review、open、cancelled）的鍵、型別、排序不變；
     src/pages/admin/index.astro 不需修改。
  4. 錯誤紀錄沿用 readSection（只記區塊名與錯誤類型）。

允許修改範圍：src/lib/admin-dashboard-summary.ts；tests/admin-dashboard-summary.test.ts；
  tests/helpers/admin-dashboard-preview.ts（只限加入複合運算子守衛與 batch 失敗注入）。

禁止事項：不改 index.astro、其他頁面、API、migrations、wrangler.json、package.json、astro.config.mjs、middleware、auth、
  component-classifier-adapter.ts；不改採購口徑；不新增寫入；不連遠端、不建置、不部署、不 git commit／push；
  不讀 .env／.dev.vars／備份。超出範圍時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/admin-dashboard-summary.test.ts tests/admin-ui-kit.test.ts tests/admin-shell.test.ts
  2. node tests/admin-dashboard-browser.mjs <暫存目錄>（D1_A3_EDGE_LOCAL_TEST_MODE=1，截圖只放暫存目錄，不覆寫 docs/UI-S3-screenshots/）
  3. npm run astro -- check（基準 10）
  4. git diff --check

單元測試必須涵蓋：
  - 守衛：fixture 的 D1 模擬層對含 UNION／INTERSECT／EXCEPT 的 SQL 拋錯；修正後 R01 全部區塊在守衛下仍成功。
  - 既有採購測試（多幣別、封存分列、尚未記錄、負餘額、取消分列、§11 四種情況、不標示的情況）結果與修正前逐項相同。
  - batch 中任一條失敗 → 採購區為 null（無法取得），其他區塊不受影響。
  - 正式現況：採購訂單與分攤皆 0 筆時，三卡顯示「尚未記錄」／0 筆，不是「無法取得」。

完成條件與交付：檔案與摘要、驗證數字、瀏覽器逐項結果、astro check 錯誤數、未執行項目；更新 HANDOFF.md。
部署：Claude 審查通過後，依 DEPLOY-01 另行取得推送授權。推送後 Claude 唯讀抽查路由；使用者登入後 30 分鐘內 Claude 確認
  採購三卡正常顯示，並以 wrangler tail 確認不再出現「Admin dashboard section unavailable purchases」（需使用者同意）。
```

### 14.3 審查（2026-11-25）：通過

- **範圍**：只改 `src/lib/admin-dashboard-summary.ts`、`tests/admin-dashboard-summary.test.ts`、`tests/helpers/admin-dashboard-preview.ts`，符合 §14.2。
- **程式**：三段 CTE 抽成共用常數，6 條查詢各自只引用需要的 CTE，條件、分組與原查詢逐段相同；以一次 `db.batch()` 執行。結果筆數不符、任一條 `success` 為假或出現非安全整數即整區拋錯；回傳結構不變。
- **測試**：fixture 的 D1 模擬層對含 `UNION`／`INTERSECT`／`EXCEPT` 的 SQL 拋錯（原查詢在此守衛下會失敗）；新增「恰好一次 6 條 batch」、「batch 6 個位置各自失敗只影響採購區」、「失敗結果與不安全數字被拒」。
- **Claude 重跑**：Node 3 檔 **14／14**；`astro check` 352 檔 **10 個基準錯誤**（皆在未修改檔案）、0 警告；`git diff --check` 通過。Edge R01 7 項引用 Codex 中途回報，Claude 未重跑。
- 尚未提交；推送部署依 DEPLOY-01 另需授權。

### 14.4 部署與唯讀抽查（2026-11-25）

- 部署：`763cb81` 於台北 02:03 推送（DECISION_LOG UI-S3-FIX-DEPLOY），約 1 分鐘後自動部署為 `eacc4ecc…`（100%，台北 02:04:35）。
- Claude 唯讀抽查 19 條路由全部符合：公開頁 `/`、`/collection`、`/games`、`/en/games`、`/sitemap.xml`、`/robots.txt`、`/about/`、`/games/bgg-451166` 200；`/games/bgg/451166`、`/en/games/bgg/451166` 307；`/games/bgg/2147483647` 404；`/admin`、`/api/admin/auth-check`、`/admin/bgg`、`/api/admin/bgg`、`/admin/collection/components/manage` 302 至 Access 登入；插畫 `empty-no-count.webp` 200；`/dev/collection-v2-test`、`/dev/ui-kit` 404＋no-store。
- 遠端操作：`wrangler deployments status` 1 次、HTTP HEAD/GET 19 次；D1 查詢 0、寫入 0。
- **正式驗收（2026-11-25 台北 08:17，使用者登入後 Claude 檢查，面板寬 518px）：通過**。採購三卡：已記錄採購成本「未封存／已封存皆尚未記錄」、未分攤金額「無正數餘額」、採購訂單狀態「待處理 0／已取消 0」，符合正式現況（採購訂單與分攤皆 0 筆）；整頁無「無法取得」；其他區塊數字與 §13 一致（收藏 256／254／0／2）；無橫向捲動。
- `wrangler tail` 未執行（頁面已無失敗區塊，屬可選確認）。
