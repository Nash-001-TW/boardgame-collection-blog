# D-4：NotBGG 公開目錄整合

本階段只在本機開發及全新隔離 D1 驗證，未部署、未連線／寫入遠端 D1。

## 讀取與身份

- `/games`、`/en/games` 改為個別 SSR；既有 BGG `[slug]` 與 `getStaticPaths` 維持靜態。
- BGG 繼續讀取 `bgg-cache.json`。`PublicNotBggReader` 注入 D1，獨立讀取 NotBGG 公開白名單，不使用完整管理 Repository 原稿。
- 目前契約沒有草稿／發佈欄位：未封存、沒有已確認對應的 NotBGG 原稿視為可公開。若需要審稿或另行發佈，應先確認需求，再於後續階段設計契約及 Migration。
- BGG 數字 ID 與既有 slug 不變；穩定 key 為 `BGG:205637` 或 `NotBGG:000001`。NotBGG 詳細頁為 `/games/notbgg/000001`，英文加 `/en`。
- 不依名稱去重、不改寫身份、對應或官方關聯。候選對應仍顯示；已確認對應的 NotBGG 暫不列入公開目錄、詳細頁及適用遊戲，避免產生錯誤的重複主要項目。完整主要來源、舊網址別名與解除對應解析留待 D-6；這不是完整的轉換實作。

## 白名單、可見性及失敗

SQL 明列欄位，沒有 `SELECT *`。精簡目錄只含卡片、搜尋與篩選必要資料，不含描述、作者或完整原稿。詳細頁經既有共用 VM 投影；管理備註、內部 game_id、操作者、修訂、冪等資訊與稽核記錄均不輸出。描述以 Astro 文字輸出，外部 URL 限 HTTP(S)，拒絕嵌入帳密。

封存項目在 SQL 即排除，詳細頁 404。配件關聯僅提供已存在於 BGG 公開目錄或符合公開條件的 NotBGG 目標；與 BGG 官方擴充關聯完全分離。缺少 Binding／查詢失敗時，目錄保留 BGG 並顯示 NotBGG 暫不可用提示；NotBGG 詳細頁回傳一般化 503，不揭露 SQL 錯誤。

每次目錄請求只用一個 D1 查詢；一般詳細頁一個、配件詳細頁最多兩個，不逐筆查詢關聯。未加入應用程式快取；動態回應 `Cache-Control: no-store`，BFCache 返回時重新載入並恢復 URL／歷史位置。因此建立、更新、封存在下一次請求生效，已開啟分頁不做即時推播。

## 類型與瀏覽

NotBGG 原稿 `boardgame / boardgameexpansion / boardgameaccessory` 經共用 adapter 映射為顯示模型 `base / expansion / accessory`，對齊既有 V2／目錄顯示用類型；不改 BGG XML 類型。八個配件分類維持可多選，以獨立 `accessory` URL 條件篩選。自建機制使用 `notbgg:` key，不製造 BGG 數字分類 ID。

保留六種排序、組合篩選、Grid/List、URL／前進返回、24 筆載入與圖片 lazy/fallback。數值缺值排序最後，兩項都缺值時依名稱、來源 key 穩定排序；不把 null 當零。增加完整 NotBGG ID 精確搜尋，保留 `#205637` 行為。

SSR 與前端共用 `catalog-selection.ts`，讓帶搜尋／篩選／排序／檢視條件的初始 HTML 與 JS 結果一致，避免慢速載入時先呈現預設卡片再跳動。收藏模組維持原選取流程。

## 本機驗證

- 新增 `tests/notbgg-public.test.ts`：隔離 D1、公眾 SQL／DTO 白名單、單次查詢、活躍／封存／候選／確認對應、公開關聯、六種排序、null、搜尋與來源 key、路由及 SHA。
- `tests/notbgg-public-browser.cjs` 使用真實 Astro 元件與控制器、隔離 D1、合成圖片：815→818→817、24→48→818、三種類型、八種子分類、精確 ID、六種排序、Grid/List 圖片重用、中英文、手機、URL／返回、文字安全、封存 404、慢速網路。
- 既有 C-1／C-2／C-3 瀏覽器與 A-2／A-3、自建儲存／管理授權回歸一併執行。

### 量測（單次樣本，非正式環境效能）

| 條件 | 修正前 | 修正後 |
|---|---:|---:|
| 手機、150ms 延遲／1.6Mbps、精確搜尋 URL，CLS | 0.379 | 0.011 |
| 同條件 LCP | 3700ms | 3708ms |
| 同條件 DOMContentLoaded | 4718ms | 4490ms |

同一本機元件預覽：桌面 DCL 545ms、LCP 628ms、CLS 0；24→48 約 139ms（含瀏覽器驅動開銷），搜尋約 334ms（含 debounce）。這些不是 Astro dev 或 production Worker 的端到端量測。正式 Worker／D1 端到端效能：**NOT MEASURED**。

另外以現有 C-4 瀏覽器重驗既有真實圖片：`cf.geekdo-images.com` 代表請求 HTTP 200，約 111／147／147／150ms，2351／6053／3060／8996 bytes，皆非快取；未遇自然網路失敗或 403／429。桌面／手機封面及關聯圖可載入，Grid/List 新增圖片請求 0；人工失敗可使用佔位圖且操作保留。手機真實圖片節流樣本 CLS 0.011、LCP 3928ms。外部服務表現只代表這次測試，沒有繞過來源限制。

Production build 成功；正式部署、正式 D1 Binding／延遲／Cloudflare 快取行為：**NOT TESTED**。沒有新增 Migration，沒有改動正式資料、Parser、A-2／A-3 語意、管理員驗證或 `/collection` 正式讀寫。

自動化回歸 **132/132 PASS**；C-1／C-2／C-3 瀏覽器分別 **11／4／5 checks PASS**；TypeScript strict 通過，Astro check **0 errors、0 warnings、12 個既有 hints**。

BGG 快取 SHA256：`1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`。

## 本輪檔案

新增：`src/lib/notbgg-public.ts`、`src/lib/catalog-selection.ts`、`src/i18n/accessory-categories.ts`、`src/components/NotBggDetail.astro`、兩語系 `games/notbgg/[id].astro`、兩項 `tests/notbgg-public*`、本文件。

修改：`game-view-model.ts`（容許公開白名單來源作 adapter 輸入，VM 與原稿契約不變）、`catalog-payload.ts`、`catalog-browsing.ts`、`catalog-store.ts`、`game-browser-url.ts`、`game-browser-capabilities.ts`、`game-list-controller.ts`、`CatalogBrowserControls.astro`、`CatalogCard.astro`、`GameList.astro`、兩語系 `games.astro`、本機測試預覽 helper `scripts/lib/local-games-preview.ts`。工作區原有其他變更保留。

D-5 前確認：是否另需發佈開關；D-6 才完成已確認對應的主要來源、永久別名與解除對應契約。本階段不整合收藏、不開始下一階段。
