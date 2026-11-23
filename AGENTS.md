# 專案開發與 AI 協作規範 (Project Guidelines)

> **給所有 AI 代理的最高原則**：修改任何檔案前，先理解現有架構、目前工作樹與變更影響範圍，並確認本次工作單的授權範圍。不得為了修補局部問題而擅自重構未授權的核心模組。

本文件只記錄**長期有效的規則**。進度、待決事項與驗收結果請看第 6 節的入口文件，不寫進本檔。

---

## 1. 專案概覽與技術棧

* **專案名稱**：BoardGame Dashboard V2（Repository：`boardgamecollection-blog`；舊文件也稱 NotBGG Admin Dashboard V2）
* **核心目標**：個人桌遊收藏網站。公開端提供中英桌遊目錄、收藏與配件資訊；Admin 管理收藏、副本、實體組件、清點、卡套、採購、NotBGG 及 BGG 資料關聯。
* **語言與框架**：TypeScript、Astro 7（Cloudflare Adapter）。Node.js `>=22.12.0`，使用 npm 與 `package-lock.json`。確切依賴以 `package.json`／`package-lock.json` 為準。
* **資料庫與外部服務**：Cloudflare D1（SQLite）、Cloudflare Access（Admin JWT）、Cloudflare KV（Session）、BoardGameGeek API（僅伺服器端同步）。
* **運行環境**：正式網站部署於 Cloudflare Workers。本機開發環境為 Windows（PowerShell）。
* **部署結構**：`astro.config.mjs` 預設 `output: 'static'`，需要即時資料的路由個別設 `prerender = false`；Adapter 指定 `remoteBindings: false`。`wrangler.json` 為 Worker／bindings 設定。

---

## 2. 目錄結構與模組邊界

| 位置 | 職責 |
| --- | --- |
| `src/pages/`、`src/pages/en/` | 公開路由、canonical／HTTP 狀態與頁面組裝。Admin 路由在 `src/pages/admin/`。 |
| `src/pages/api/`、`src/lib/auth/` | 公開資料與 Admin JSON 入口；Access JWT、管理員授權、同源、輸入與限流契約。 |
| `src/lib/` | 資料存取、分類、業務守衛、公開投影及前端 controller。**高敏感區**（見下）。 |
| `src/components/`、`src/layouts/`、`src/styles/`、`src/i18n/` | 顯示、表單、布局與中英內容。只負責呈現與事件轉發，不放業務運算。 |
| `src/worker.ts`、`src/middleware.ts` | 網址相容性轉送；入口與授權。 |
| `src/data/`、`public/` | BGG 靜態基線資料與公開資產。 |
| `migrations/` | D1 Schema 歷史（只能前向新增）。 |
| `scripts/`、`tests/`、`docs/` | 操作工具、測試與驗收腳本、設計與版本紀錄。 |

**高敏感區（修改前須先說明設計影響並取得同意）**

* 身份與授權：`src/lib/auth/cloudflare-access.ts`、`src/lib/auth/admin-request.ts`、`src/middleware.ts`
* 分類與清點寫入：`src/lib/component-classifier-adapter.ts`、`src/lib/physical-component-management.ts`，及其 rev／同收藏／失敗關閉條件
* 公開投影：公開 DTO 白名單、來源優先順序、canonical／307、404 與 503 的差異、查詢上限
* `migrations/`、`wrangler.json`、`astro.config.mjs`

---

## 3. 建置、執行與驗證指令

在 repo 根目錄執行。**指令本身不等於執行授權**：建置、測試、啟動服務前，先確認屬於本次工作單的授權範圍（見第 5、6 節）。

```powershell
npm ci                               # 安裝依賴（依 lockfile）
npm run astro -- check               # 型別／Astro 檢查（目前沒有獨立 lint script）
npm run build                        # 先執行 prebuild：wrangler types + BGG 收藏快取初始化
npm run preview
npm run astro -- dev --background    # 開發服務一律用背景模式
npm run astro -- dev status | logs | stop
```

* **測試**：npm 沒有通用 `test` script。依受影響範圍選擇入口，例如：
  ```powershell
  node --import tsx --test tests/component-classifier.test.ts tests/component-classifier-adapter.test.ts tests/admin-component-classification.test.ts tests/physical-component-management.test.ts
  node --import tsx --test tests/public-site-data.test.ts tests/public-site-sqlite-runtime.test.ts tests/public-game-collection.test.ts
  ```
* 測試可能建立 SQLite、Auth 或 Astro fixture，瀏覽器腳本（`*-browser.*`）可能啟動服務。執行前先讀入口，確認使用隔離資料及寫入範圍。
* `npm run build` 前先檢查本機 binding 配置與既有未提交資料。
* 若無法或未獲授權執行驗證，回報時必須明確寫「尚未執行測試驗證」，不可假設已通過。

---

## 4. 編碼風格與工程原則

1. **明確優先於簡潔**：命名精準表達意圖；關鍵狀態轉換、守衛條件與資料契約要註解「為什麼這樣寫」。
2. **失敗關閉**：驗證、授權、證據不可用時拒絕操作，不得以靜態資料或局部統計補推結果。D1 故障要明示，不能用靜態回退掩蓋。
3. **錯誤處理**：禁止空 `catch` 吞例外；外部 I/O（D1、BGG HTTP、KV）需有逾時、例外處理與可追溯的錯誤回報。
4. **一致提交與併發**：多筆相關寫入須原子提交（D1 batch／條件式寫入），以 revision 或既定守衛處理併發；冪等不能取代完整提交守衛。
5. **最小變更**：只改必要範圍，不順手重排無關檔案，避免污染 Git diff。
6. **Schema 只走前向 Migration**：保留已部署的 0001–0022 歷史；候選 Migration（如 0023、0024）各自審查，存在於工作樹不代表已部署或已驗收。

---

## 5. 禁忌事項與安全紅線（絕對禁止）

* **機密**：不得讀取、輸出或提交 `.env`、`.dev.vars`、`backups/`、資料庫匯出 `*.sql` 備份等檔案的內容。不得把 Token、密碼、Cookie、JWT、完整 AUD、Secret 寫進程式碼、文件、Git 或聊天。文件中只記變數名稱（如 `ACCESS_AUD`、`BGG_API_TOKEN`、`PHYSICAL_COMPONENT_SIGNING_KEY`）。
* **認證**：任何登入／OAuth／MFA 由使用者親自完成。AI 只提供確切 URL 或命令、步驟與成功條件；不得要求使用者在聊天中貼上認證值。
* **正式環境**：未取得明確授權，不得執行正式 D1 寫入、Migration、Cloudflare 設定變更、部署，或 P3／Stage 系列執行。每次授權只涵蓋該次工作單，不可延伸。
* **UI**：Admin 頁面須經使用者逐頁確認布局、欄位與流程後，才可修改 UI 或部署。Release-03 的功能／登入通過不代表設計已核准。
* **依賴與設定**：未經指示不得升級框架、更換套件，或修改建置腳本、`wrangler.json`、CI/CD。
* **介面契約**：修改公開函式簽章、API 回傳格式或資料庫 Schema 前，先列出受影響的呼叫端並取得確認。
* **工作樹**：工作樹含使用者未提交的變更與歷史證據。禁止 `git reset --hard`、`git checkout -- .`、`git clean`、`git stash` 或覆寫他人變更；不得刪除 `.wrangler/` 證據、REV04、FIX_003、Gate L1 ZIP／收據及歷史探針。
* **不補造資料**：不得為測試在正式環境新增收藏或資料，不得只為重複確認而重跑歷史驗收或要求使用者重新登入。

---

## 6. AI 交接與工作流程

### 6.1 接手時（先唯讀）

依序閱讀：

1. 本檔 `AGENTS.md`
2. `HANDOFF.md`（根目錄，最新工程交接）
3. `docs/current-progress.md`（進度、登入驗收與保留限制）
4. 任務對應的審核文件，例如 `docs/V2-UI-Review-01.md`（Admin UI）、`docs/public-site-architecture.md`（公開資料架構）、`docs/Decision-Ledger-*.md`（決策台帳）
5. `git status --short` 與目標檔差異

動手前先簡述：理解的現況、預計修改的檔案、實作策略、需要的授權。取得當前工作單授權後才修改或執行。

### 6.2 狀態用語

回報與文件須區分以下狀態，並附日期（Asia/Taipei）與檔案位置：

| 狀態 | 意義 |
| --- | --- |
| 已採納 | 使用者正式確認的規格或決策 |
| 候選 | 已提出、尚待使用者批准 |
| 已實作 | 程式已寫入工作樹或提交 |
| 已驗證 | 有實際測試或驗收證據 |
| 已授權 | 使用者已批准執行的具體動作與範圍 |

不得把候選寫成已採納，或把已實作寫成已驗證。歷史證據只在其原始範圍內引用。

### 6.3 完成時

* 列出「新增／修改／刪除」檔案與變更摘要。
* 說明已執行的測試與驗證結果；未執行的明確標示。
* 更新 `HANDOFF.md`（及必要時 `docs/current-progress.md`）：新增帶日期的條目，不改寫既有歷史紀錄。
* 條列遺留技術債、未決事項與需人工注意的邊界條件。
* 報告只保存去敏證據。

---

## 7. Astro 開發參考

開發服務使用背景模式：`astro dev --background`，以 `astro dev stop`、`astro dev status`、`astro dev logs` 管理。

完整文件：https://docs.astro.build 。處理相關任務前先查閱：

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

公開網站資料架構、路由、隱私邊界與發布規劃見 [docs/public-site-architecture.md](docs/public-site-architecture.md)；修改架構時同步更新該文件，使其與已驗證程式碼一致。
