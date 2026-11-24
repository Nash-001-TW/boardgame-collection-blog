# #22 R06 收藏選擇器｜設計（2026-11-24 已採納，DECISION_LOG R06-PICK-Q27～Q29）

對應 CURRENT_TASK #22。比較頁：[docs/UI/R06-collection-picker-options.html](UI/R06-collection-picker-options.html)（合成資料）。

## 1. 問題

使用者 2026-11-24 正式驗收時，直接打開 `/admin/collection/components/manage` 只看到「收藏 ID」輸入框。收藏 ID 是內部編號（`v2_collection_items.id`），輸入 BGG ID 會顯示「找不到收藏」。目前只能從收藏編輯頁的「實體組件」連結、組件分類頁或副本頁進入。UI-D8 已決定長期入口為收藏詳細頁分頁，但那依賴 #10、#11。

## 2. 盤點（2026-11-24 靜態閱讀）

- 收藏管理清單已有搜尋 API：`GET /api/admin/collection?q=…&scope=…&after=…&limit=…`（[collection-admin-api.ts](../src/lib/collection-admin-api.ts)、[collection-v2-management.ts](../src/lib/collection-v2-management.ts)），每頁預設 20、上限 100，游標分頁，受 Admin 授權保護。
- `q` 比對：名稱（LIKE）、來源 ID 完全相符（例如 `bgg:12345`，不分大小寫）、收藏 ID 完全相符。**純數字只會比對收藏 ID**，所以輸入 BGG ID 找不到。
- R06 頁的 `collection` 參數與現有讀取流程不需改動。

## 3. 固定規則（不需選）

1. 只在網址沒有 `collection` 參數、或參數找不到收藏時顯示搜尋；帶參數進入的行為不變。
2. 只搜尋正式範圍（production），測試範圍不在此頁切換。
3. 每頁 20 筆，沿用既有游標分頁；搜尋條件寫入網址。
4. 每列顯示名稱、收藏 ID、BGG／NotBGG 來源、狀態；整列可點，鍵盤可操作。
5. 原「收藏 ID」輸入框併入搜尋框，不留兩個輸入框。
6. 查詢失敗顯示「暫時無法搜尋」，不顯示成「找不到」。
7. 不新增 API、不改資料庫、不改收藏管理 API 與 R02 行為。

## 4. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q27 | 解法方向 | 在 R06 頁加收藏搜尋（沿用既有 API） | 入口改到收藏管理清單，每列加「實體組件」按鈕 | **A**：工作量小、不碰即將改版的 R02；日後做詳細頁分頁時仍可當直接入口 |
| Q28 | 純數字怎麼解讀 | 同時找收藏 ID 與 BGG ID，結果標示依據（前端送兩次既有搜尋再合併） | 維持現狀，只提示輸入 `BGG:12345` | **A**：避免再遇到這次的情況，且不改共用 API |
| Q29 | 列出哪些收藏 | 全部列出，以狀態膠囊標示 | 只列「已收藏」 | **A**：預購、願望清單也可能需要先建組件 |

決定後產出工作命令（Codex 實作本機與截圖；正式環境驗收依 TEAM-04 由 Claude 執行唯讀檢查、使用者登入人工確認；推送依 DEPLOY-01 另行授權）。

## 5. 工作命令（2026-11-24 已授權，DECISION_LOG R06-PICK-AUTH）

```text
工作命令 ID：R06-PICK-20261124-01
工作目標：在 R06（/admin/collection/components/manage）沒有可用收藏時提供收藏搜尋與選取。

已批准規格：docs/R06-collection-picker-20261124.md §3、§4（DECISION_LOG R06-PICK-Q27～Q29）；
  比較頁 docs/UI/R06-collection-picker-options.html 的 A 案。

行為要求：
  1. 網址沒有 collection 參數，或參數格式錯誤／找不到收藏時，在頁首顯示搜尋區；帶有效參數時頁面行為與現在完全相同
     （找不到收藏時仍保留「找不到收藏」訊息，並在下方顯示搜尋）。
  2. 搜尋框（type="search"，autocomplete="off"）取代原「收藏 ID」輸入框；提示「名稱、BGG ID、NotBGG:ID 或收藏 ID」。
  3. 呼叫既有 GET /api/admin/collection（scope=production、view=records、limit=20、游標分頁）。
     輸入為純數字 N 時，前端各送一次 q=N 與 q=bgg:N，合併去重（依收藏 ID），每筆標示「依收藏 ID」或「依 BGG ID」；
     其他輸入照原樣送 q。
  4. 結果每列：名稱、收藏 ID、BGG／NotBGG 來源、狀態膠囊（全部狀態皆列出）；整列為連結，
     導向 ?collection=<id>&lang=<目前語言>。鍵盤可操作，焦點可見。
  5. 搜尋條件寫入網址（例如 ?q=…），重新整理後保留並自動重查。
  6. 0 筆顯示「找不到符合的收藏」；API 失敗或逾時（10 秒）顯示「暫時無法搜尋，請稍後再試」，不得顯示成找不到。
  7. 中英文字齊全（沿用頁面 t() 模式）。

允許修改範圍：
  - src/pages/admin/collection/components/manage.astro（只限無收藏時的區塊與掛載元件）
  - 新增 src/components/admin/CollectionPicker.astro（標記與元件內 <style>，色值依設計規範 §3）
  - 新增 src/lib/collection-picker.ts（純函式：判斷純數字、組查詢、合併去重、標示依據、狀態標籤）
  - 新增 src/lib/collection-picker-controller.ts（瀏覽器端：讀寫網址、呼叫 API、逾時、渲染）
  - 新增 tests/collection-picker.test.ts；新增 tests/collection-picker-browser.mjs（可參考 tests/physical-quantity-browser.mjs
    的拋棄式 SQLite＋本機 Edge 作法）

禁止事項：不改收藏管理 API（collection-admin-api.ts、collection-v2-management.ts）與 R02 頁；不改 D1 更正流程、
  migrations、wrangler.json、package.json、astro.config.mjs、middleware、auth；不連遠端、不建置、不部署；
  不讀機密與備份；不 git commit。超出範圍時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/collection-picker.test.ts tests/d1-quantity-history.test.ts tests/d1-quantity-preview-view.test.ts tests/d1-quantity-api.test.ts tests/physical-component-management.test.ts
  2. node tests/collection-picker-browser.mjs <暫存目錄>（本機 Edge＋拋棄式 SQLite；可沿用 D1_A3_EDGE_LOCAL_TEST_MODE=1）
  3. node tests/physical-quantity-browser.mjs <暫存目錄>（回歸：帶 collection 參數的 R06 行為不變）
  4. npm run astro -- check（基準 10 個錯誤，不得新增）
  5. git diff --check

單元測試必須涵蓋：純數字送兩次查詢並合併去重、同一收藏同時命中兩種依據時只列一次並標示兩者、名稱與 BGG:ID 照原樣送、
  狀態標籤中英文、API 錯誤與 0 筆分開。
瀏覽器腳本必須涵蓋：無參數顯示搜尋；名稱搜尋點選後進入正確收藏；輸入 BGG ID 純數字找得到；找不到收藏的參數顯示訊息＋搜尋；
  API 失敗顯示「暫時無法搜尋」；重新整理保留條件；鍵盤操作。
截圖（桌面 1440、手機 375，docs/R06-picker-screenshots/，只用合成資料）：無參數初始、搜尋結果、純數字雙依據結果、
  0 筆、暫時無法搜尋。

完成條件與交付：新增／修改檔案與摘要、各驗證結果數字、瀏覽器逐項結果、截圖清單、astro check 錯誤數、未執行項目；
  更新 HANDOFF.md（追加條目）。
正式環境：推送依 DEPLOY-01 另行授權；部署後由 Claude 唯讀確認版本與路由（TEAM-04），使用者登入人工確認搜尋可用。
```

## 6. 審查（2026-11-24）：通過，附一項修正

- **範圍**：變更皆在 §5 允許範圍內（`manage.astro` 只在無可用收藏時掛載選擇器並隱藏原 ID 輸入框；新增 `CollectionPicker.astro`、`collection-picker.ts`、`collection-picker-controller.ts` 與兩支測試）。收藏管理 API、R02、D1 流程、migrations、`wrangler.json` 未動。
- **符合**：只在缺少／無效／找不到收藏時顯示搜尋；D1 讀取失敗（503）時維持原 ID 輸入框；固定 `scope=production`、`view=records`、每頁 20；純數字雙查，只把「收藏 ID 完全相同」「BGG 來源完全相同」標為依據，名稱子字串命中不誤標；合併去重後依 ID 排序，分頁游標取兩個查詢中較保守者以免漏資料；條件寫入網址並於重新整理後重查；10 秒逾時與 API 錯誤顯示「暫時無法搜尋」。
- **Claude 修正**：controller 的 `catch` 原本不留任何紀錄，補上只記錯誤類型的 `console.warn`（AGENTS.md 禁止空 catch 吞例外）。
- **驗證（Claude 親自重跑）**：五檔 Node 測試 **36／36**；選擇器 Edge 腳本 **11／11**（修正後再跑一次）；R06 回歸 Edge 腳本 **12／12**；`astro check` **10 個錯誤**（無新增）；`git diff --check` 通過。抽看桌面「純數字雙依據」與手機「名稱搜尋結果」截圖，符合比較頁 A 案。重跑回歸腳本時覆寫的 2 張既有 A4 截圖已還原。
- **已知取捨**：純數字查詢不再比對名稱（例如名稱含「7」的收藏，輸入 `7` 不會出現）；要找名稱請輸入文字。

未執行：正式環境驗收（需推送部署，依 DEPLOY-01 另行授權）。
