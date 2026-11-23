# BoardGame Dashboard V2 工程交接

更新日期：2026-11-23（Asia/Taipei）。Repository 名稱為 `boardgamecollection-blog`，舊文件也使用 NotBGG Admin Dashboard V2。正式基準引用已保存的驗收紀錄。本地工作樹另有候選變更，兩者需分開判讀。

## 1. 接手後的第一件事

**優先推進 R06「實體組件與清點」的網站操作流程。** 本地已有逐組件選副本、存實點及重新讀取的路徑。完整規格的主要缺口是逐副本適用性、使用者清點日期、整盒進度及完成狀態。

1. 先讀 [AGENTS.md](AGENTS.md)、[進度與登入交接](docs/current-progress.md)、[Admin UI 審查](docs/V2-UI-Review-01.md) 及下文的 R06 範圍。
2. 請使用者只確認 R06 這一頁的收藏入口、是否整頁共用副本選擇、清點區順序及儲存後回饋位置。使用既有 [桌面](docs/V2-UI-Review-01-screenshots/06-physical-1440.jpg)／[手機](docs/V2-UI-Review-01-screenshots/06-physical-375.jpg) 和 [桌面展開](docs/V2-UI-Review-01-screenshots/06-physical-expanded-1440.jpg)／[手機展開](docs/V2-UI-Review-01-screenshots/06-physical-expanded-375.jpg) 圖。這些是合成唯讀畫面，早於部分目前工作樹的表單變更。
3. 頁面確認及實作獲准後，以一個收藏、一個副本、小組件集合完成最小讀寫流程。Major03 Launcher 排查已暫緩。只有實際驗收環境確實依賴 binding 或該項證據時，才回頭處理對應阻擋。

## 2. 專案目標與架構

網站提供中英公開桌遊目錄、收藏和配件資訊。Admin 維護收藏、副本、實體組件、清點、卡套、採購、NotBGG 及 BGG 資料關聯。

- **技術棧**：Astro 7、TypeScript、Cloudflare Adapter／Workers、D1（SQLite）、Cloudflare Access JWT、Node.js `>=22.12.0`、npm lockfile。BGG 同步使用伺服器端 HTTP／XML；本機部分測試用 Node SQLite、tsx 或 Miniflare。確切依賴以 [package.json](package.json) 和 [package-lock.json](package-lock.json) 為準。
- **部署結構**：[astro.config.mjs](astro.config.mjs) 預設 `output: 'static'`，需要即時資料的路由個別設 `prerender = false`。Cloudflare Adapter 指定 `remoteBindings: false`。[wrangler.json](wrangler.json) 是 Worker／bindings 設定；[worker.ts](src/worker.ts) 處理網址相容性再轉 Astro，[`middleware.ts`](src/middleware.ts) 處理入口及授權。

| 位置 | 職責 |
| --- | --- |
| `src/pages/`、`src/pages/en/` | 公開 Astro 路由、canonical／HTTP 狀態與頁面組裝。Admin 路由在 `src/pages/admin/`，語言沿用查詢參數。 |
| `src/pages/api/`、`src/lib/auth/` | 公開資料及 Admin JSON 入口。Admin 驗證 Access JWT、允許的管理員，寫入 API 另檢查各自的同源、輸入及限流契約。 |
| `src/lib/` | 資料存取、候選分類、業務守衛、公開投影及前端 controller。 |
| `src/components/`、`src/layouts/`、`src/styles/`、`src/i18n/` | Astro 顯示與表單、公共／管理布局及中英內容。 |
| `src/data/`、`public/` | BGG 靜態基線資料與公開資產。 |
| `migrations/`、`scripts/`、`tests/`、`docs/` | D1 Schema 歷史、操作工具、驗收測試、設計與版本紀錄。 |

**主要資料流**

- **公開頁**：Admin BGG 同步 → D1 `bgg_games` 最後成功快取 → 公開資格及身份解析 → 白名單公開投影 → 首頁／清單／詳細頁。D1 查詢成功但沒有可用新快取時可用既有公開靜態資料。卡套及關聯用各自的公開服務。入口見 [public-site-data.ts](src/lib/public-site-data.ts)、[identity-resolution.ts](src/lib/identity-resolution.ts)、[public-game-collection.ts](src/lib/public-game-collection.ts)、[public-live-relations.ts](src/lib/public-live-relations.ts) 及 [公開架構](docs/public-site-architecture.md)。
- **Admin**：Astro 頁面／controller → 管理 API → 授權與業務守衛 → D1 寫入 → 重新讀取並回饋。收藏與副本見 [collection-v2-management.ts](src/lib/collection-v2-management.ts)、[collection-copies.ts](src/lib/collection-copies.ts)；卡套、採購、身份與關聯見 [sleeve-workflow.ts](src/lib/sleeve-workflow.ts)、[purchase-admin.ts](src/lib/purchase-admin.ts)、[notbgg-link-repository.ts](src/lib/notbgg-link-repository.ts) 及 [relation-admin.ts](src/lib/relation-admin.ts)。
- **R06**：[manage.astro](src/pages/admin/collection/components/manage.astro) 讀收藏、組件定義、在藏未封膜副本及舊實點；[前端 controller](src/lib/physical-component-admin-controller.ts) 送同源 JSON → [組件 API](src/pages/api/admin/collection/components.ts) → [授權與輸入處理](src/lib/physical-component-admin-api.ts) → [清點及組件服務](src/lib/physical-component-management.ts) 條件式 upsert → 頁面重載從 D1 查回。實體來源分類由 [component-classifier-adapter.ts](src/lib/component-classifier-adapter.ts) 和分類器負責。

## 3. 已完成進度與證據

| 範圍 | 已知結果與來源 |
| --- | --- |
| 正式部署 | 2026-11-12 Release-03 部署正式 Worker **version 19，流量 100%**。正式 D1 依該紀錄已套用 **0001–0022**。完整建置、限定公開 HTTP 及管理員人工登入／唯讀驗收已通過。見 [Release-03 第 10 節](docs/V2-Release-03-summary.md)。 |
| 公開網站 | 已有中英首頁、目錄、收藏、歷史 slug、數字 BGG 與 NotBGG 路由、公開資格與身份去重、伺服器端篩選分頁、sitemap。正式 HTTP 驗收涵蓋限定頁面及相容轉址。尚無正式 NotBGG 詳細頁 200 樣本，沒有為測試新增正式收藏。見 [公開實作入口](docs/public-site-architecture.md#8-主要實作入口) 及 [Release-03 限制](docs/V2-Release-03-summary.md#107-已知驗收限制)。 |
| Admin | 既有收藏、組件、卡套、採購與 BGG 等入口可依歷史紀錄讀取。Access 與單一管理員 JWT 守衛已有實作及限定驗收。逐筆儲存、實體清點、扣庫存、採購分攤及管理端同步未於 Release-03 執行正式寫入驗收。設計核准另見 [逐頁 UI 審查](docs/V2-UI-Review-01.md)。 |
| R06 舊基準 | 已有組件卡片內逐項選副本、輸入實點、寫入 `checked`／系統時間／revision、重載查回數量。歷史 **66 項測試通過**，涵蓋分類、實點 0、revision、回滾及 Astro 畫面。現有工作樹的網站儲存後重讀尚未動態驗收。見 [歷史驗證](docs/V2-R01-R07-preflight-results.md#執行證據) 及 [清點測試碼](tests/physical-component-management.test.ts)。 |

## 4. 未完成、已知問題與工作樹

### R06 產品缺口

| 優先級 | 缺口及接手範圍 |
| --- | --- |
| P0 | **逐副本適用性**。R06 以受控建立 token、實體分類及可操作副本縮小清單，沒有讀取不適用例外，寫入也沒有以此擋下不適用組件。候選 [0024](migrations/0024_component_applicability.sql) 有事件／目前值 view，但 [適用性服務](src/lib/component-applicability.ts) 找到有效目標後仍回 `unknown / SOURCE_UNAVAILABLE`。先在既有副本完成正確讀寫，S6／S7 新建定義或副本與初始例外的原子操作另分工作。 |
| P0 | **使用者清點日期與重讀**。現有 `last_checked_at` 是系統儲存時間。頁面及 count API 缺使用者日期，現 Schema 也缺獨立欄位。需要已審查的持久化變更，保留舊資料缺日期的語意。 |
| P0 | **整盒進度、雙時間及事件**。R06 沒有完整 N／M／U 與整盒完成狀態；R05 仍有舊的手動檢查狀態。完整候選集合、可信輸入守衛、事件持久化及冪等機制仍有待決項。不得以目前卡片數或舊手動狀態替代。 |
| P1 | R06 直接入口需知道收藏 ID；每張組件卡各選副本；重載後須回卡片查看保存值；手機第一屏主要是新增組件。先取得使用者的單頁決定，再定全頁副本選擇、清點區順序和就地回饋。 |

**目前工作樹含使用者既有未提交變更。** R06 頁面、表單、controller、組件服務、共用 JSON API 與測試有變更。候選 0023／0024、`shared-quantity-commit.ts`、`physical-quantity-impact.ts` 及 `component-applicability.ts` 也在工作樹。0023 主要處理**共用預期量更正**；影響投影的 `confirmationEligible: false` 是明確的授權邊界。這些檔案的存在不足以證明已部署或動態驗收。先看 `git status --short` 與目標差異，保存既有成果。

**已知固定條件與歷史限制**

- R06 目前以收藏數字 ID 進入，可從 R05 帶入。副本 SQL 只讓在藏且非 `sealed` 的副本進入操作清單；已採納的整盒判定範圍另含借出副本，封膜是操作限制，不能拿上述清單當整盒全集。清點數量上限目前為 100,000。見 [R06 頁面](src/pages/admin/collection/components/manage.astro)、[數值契約](src/lib/physical-component-values.ts) 及 [清點設計交接](docs/ChatGPT-handoff-current-20261118.md)。
- P3 本機動態驗收曾在取得 Miniflare D1 binding 時以 `fetch failed` 停止，未跑到業務 SQL。Major03 只保存 FIX_003 候選環境的 Gate L1／Preflight 證據，Gate L2 暫緩，FIX_004 停止，Bootstrap 根因 Unknown，正式 D0 尚未驗收。Launcher REV04 明文釘選 Windows x64、PowerShell 7.6.9／.NET 10.0.14；FIX_003 的候選本機診斷規則與此為兩份契約。見 [P3 結果](docs/P3-stage1-execution-result-20261118.md) 及 [REV04](tests/major03-d1/launch-d0-smoke.ps1)。
- V1 來源表尚被分類、清點或卡套證據使用。V1 退役與 V2 表名正規化已評估，暫緩執行。見 [退役評估](docs/V1-retirement-and-table-normalization-assessment-20261118.md)。

## 5. 開發、設定與驗證

在 repo 根目錄依需要使用下列指令。這份交接只記錄指令，未執行建置、測試或服務。

```powershell
npm ci
npm run astro -- dev --background
npm run astro -- dev status
npm run astro -- dev logs
npm run astro -- dev stop
npm run astro -- check
npm run build
npm run preview
```

`npm run build` 會先執行 `wrangler types` 及 BGG 收藏快取初始化。初始化只在快取不存在時從範本建立，既有快取保留。建置前檢查本機 binding 配置與既有未提交資料。開發服務一律使用背景模式。涉及 Astro 頁面、路由、元件、樣式或語言時，先讀 [AGENTS.md](AGENTS.md) 指定的官方指南。

| 設定／依賴 | 用途 |
| --- | --- |
| `DB` | D1 binding；正式資源和 migrations 目錄見 [wrangler.json](wrangler.json)。本機測試使用經批准的隔離資料。 |
| `ASSETS`、`IMAGES`、`SESSION`、`NOTBGG_WRITE_LIMITER` | Worker 資產、影像、Session KV、Admin 寫入限流。沿用現有 binding 名稱。 |
| `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ADMIN_EMAIL` | Access JWT team、audience 及既定的單一管理員。依執行環境透過本機 `.dev.vars` 或受管 Secrets 配置。 |
| `PHYSICAL_COMPONENT_SIGNING_KEY` | 來源簽章，程式需要至少 32 個 UTF-8 位元組。現存簽章資料依賴原金鑰；隔離資料和正式環境各自管理。 |
| `BGG_API_TOKEN` | 伺服器端 BGG 同步或經批准的 CLI 匯入。CLI 快取更新使用本機 `.env`；Worker 使用其 Secret。公開頁正常讀取走 D1 快取／靜態基線。 |

只記變數名稱，勿把值、備份或認證資料加入交接、Git 或聊天。若新工作確實需要登入，告知使用者確切 URL 或命令、操作方式與成功條件，讓使用者自行完成認證。既有 Release-03 登入與唯讀驗收沿用。

**產品測試入口**。有執行授權後選受影響的一組。npm 目前沒有通用 `test` script。

```powershell
node --import tsx --test tests/component-classifier.test.ts tests/component-classifier-adapter.test.ts tests/admin-component-classification.test.ts tests/physical-component-management.test.ts
node --import tsx --test tests/public-site-data.test.ts tests/public-site-sqlite-runtime.test.ts tests/public-game-collection.test.ts
```

前一組是歷史 R06 66 項基準所列入口，當前未提交版需按實際環境及依賴判讀。測試可建立 SQLite、Auth 或 Astro fixture，瀏覽器腳本亦可能啟動服務。執行前先讀入口並確認隔離來源及寫入範圍。若本輪只改 R06 畫面或單項清點，不重跑不相干的 Launcher 或歷史登入。

**R06 最小端到端驗收**。用已授權的隔離 Admin 與可寫測試 DB，準備一個未封存收藏、一個在藏未封膜副本、兩項適用實體及一項不適用組件。從 R05 進 R06，確認初始進度 1/2，為第二項填 0 和合法歷史日期，儲存並重載。核對原項不變、排除項無寫入、新項讀回 0、checked、日期和獨立系統時間。證據完整時，確認進度 2/2 及雙時間。針對同一入口另驗失敗或衝突沒有留下部分資料。現有 binding 阻擋適用於受影響的驗收環境，UI 和靜態設計可先推進。

## 6. 決策與變更邊界

- **公開資料與身份**。保留公開 DTO 白名單、來源優先順序、canonical／307、404 與 503 差異，以及查詢上限。D1 故障應明示，不能用靜態回退掩蓋。遊戲身份、收藏紀錄與副本是不同層級；只有已確認的身份連結能依主來源去重。採購價格、私人備註、庫存、操作人及 Secrets 不得外洩。見 [公開架構](docs/public-site-architecture.md)。
- **清點規格沿用已採納決策**。組件定義由收藏共用，副本可有明確不適用例外。恢復適用沿用仍有效的舊實點及日期。0 有效、NULL 無效；台北當天預設，允許歷史日期，拒絕未來日期。使用者日期、系統儲存時間、整盒確認時間各有獨立語意，舊缺日期不可回填。整盒完成需適用且已確認的實體組件全部有效清點，歷史商品排除，未知資格與判定來源不可用分開。按已採納設計一致保存目前值及必要事件。見 [清點基準](docs/V2-R05-R06-R09-counting-baseline.md)、[S1～S7／TC23](docs/V2-copy-create-entry-readonly-review-20261118.md)、[最新決策接續](docs/ChatGPT-handoff-current-20261118.md)。
- **安全及一致性核心**。維護 [Access 驗證](src/lib/auth/cloudflare-access.ts)、[管理授權](src/lib/auth/admin-request.ts)、[來源分類](src/lib/component-classifier-adapter.ts)、[清點寫入](src/lib/physical-component-management.ts) 的身份、證據、rev／同收藏和失敗關閉條件。完整分類依賴全域舊來源證據及有界讀取，不能為縮小查詢而任意改成只看當前畫面。Schema 必須走前向 Migration，保留已部署的 0001–0022 歷史。0023／0024 候選變更需各自審查。
- **UI、正式環境與歷史產物**。Admin 頁面逐頁確認後才修改 UI 或部署。保留未提交變更、REV04、FIX_003、Gate L1 ZIP／收據及歷史探針。此次產品主線暫緩 Gate L2、Launcher 及 D0；不開 FIX_005。D1 正式寫入、Migration、Cloudflare、部署與測試安全限制照各自授權。歷史登入與背景工具結果只在既有證據範圍內引用。

## 7. 更新紀錄

- **2026-11-23（Asia/Taipei）**：使用者採納雙 AI 協作（Claude 技術主管、Codex 工程師與 QA，ChatGPT 不參與）。新增根目錄 [AI_TEAM_CHARTER.md](AI_TEAM_CHARTER.md)、[CLAUDE_ROLE.md](CLAUDE_ROLE.md)、[WORKFLOW.md](WORKFLOW.md)、[CURRENT_TASK.md](CURRENT_TASK.md)、[PROJECT_STATUS.md](PROJECT_STATUS.md)、[DECISION_LOG.md](DECISION_LOG.md)，均為精簡摘要，詳細證據仍以本檔與 `docs/` 原件為準。目前工作為 R06-UI-01 四項頁面決策，等待使用者回覆。本次只新增文件，未改程式、未執行測試。
- **2026-11-23（Asia/Taipei）**：Claude 完成專案整體靜態檢查，見 [docs/Project-Review-20261123.md](docs/Project-Review-20261123.md)。重大：D1 改量 UI 會卡住（F1）、測試與程式不一致（F2）、D1 改量實作未見授權紀錄（F3）、11/20 後成果未提交（F4）。未執行測試。
