# 專案整體檢查報告｜2026-11-23（Asia/Taipei）

- **審查者**：Claude（TECHNICAL_LEAD_AND_ARCHITECT）
- **方式**：只做唯讀的原始碼與設定靜態檢查。**尚未執行測試驗證**，也沒有跑 `astro check`、build 或任何 DB 查詢。
- **範圍**：認證與路由、Worker 設定、候選 Migration 0023／0024、未提交的 R06／D1 變更、新服務檔、機密處理、測試與文件規模。

## 1. 總結

| 面向 | 結論 |
| --- | --- |
| 認證與授權 | 良好。未發現缺陷。 |
| 正式環境設定 | 良好。所有 Admin／API 路由都是 `prerender=false`，都會經過 middleware 驗證。 |
| 機密處理 | 良好。追蹤檔案中沒有 Token、JWT、`.env` 或備份。 |
| 未提交的 D1 改量變更 | **不可提交**：有兩項重大缺陷（見 §3）。 |
| 候選 0023 | 和現有寫入路徑相容，但影響面大，套用前必須單獨審查並取得授權。 |
| 候選 0024 與適用性服務 | 只是骨架：讀取永遠回 `unknown`，沒有產品程式呼叫。 |
| 版本控制 | **風險高**：最後一次提交是 2026-11-20，之後的大量成果都還沒提交。 |
| 測試與文件 | 規模膨脹，沒有一鍵回歸入口。 |

## 2. 已確認健全的部分

1. **Access JWT**（[cloudflare-access.ts](../src/lib/auth/cloudflare-access.ts)）
   - 固定 RS256，檢查 issuer、audience 和必要 claims。
   - 限定 `*.cloudflareaccess.com` 網域，只允許單一 `ADMIN_EMAIL`。
   - 驗證失敗一律拒絕，不記錄 token。
2. **Middleware**（[middleware.ts](../src/middleware.ts)）
   - 本機免登入必須同時符合 `DEV`、loopback 和 `LOCAL_ADMIN_DEV` 三項條件。
   - NotBGG、收藏、卡套、採購、BGG 路由即使在本機也強制驗證 JWT。
   - 路徑會先解碼並合併重複斜線再比對。
3. **路由**：`src/pages/admin/**` 與 `src/pages/api/**` 全部宣告 `prerender=false`，不會有 Admin 頁被輸出成靜態檔而繞過驗證。
4. **機密**：`.gitignore` 涵蓋 `.env*`、`.dev.vars*`、`backups/`、`*.sqlite`、`.wrangler/`。唯一被追蹤的 `.sql` 是唯讀查詢（[notbgg-deployment-integrity.sql](notbgg-deployment-integrity.sql)），沒有寫入語句。repo 內沒有找到 JWT 或 Bearer token 樣式。
5. **0023 與現有寫入路徑相容**：
   - 0023 禁止取消封存，現有程式本來就把封存當終態（`update()` 遇到已封存直接回 `ARCHIVED`）。
   - 0023 規定預期數量只能透過歷史紀錄更新，`src` 內沒有其他程式直接寫 `expected_quantity`。
   - R06 改名或改類型只會遞增 `physical_revision`，不會觸發 0023 的阻擋條件。

## 3. 缺陷與風險

| # | 嚴重度 | 問題 | 位置 |
| --- | --- | --- | --- |
| F1 | **重大** | **改預期數量後，前端會卡住。** 伺服器對所有改量一律回 409 `D1_QUANTITY_PREVIEW_REQUIRED`，沒有寫入任何資料。前端卻把這個回覆當成「結果未知」，把待確認操作存進瀏覽器，之後這張卡連改名都會被擋。「查詢結果」永遠回「未知」，因為前端產生的識別碼是 UUID，不符伺服器要的 `q1.` 格式。「安全封閉」送出的 `quantity-retire` 伺服器不認得，會回 400。只能關掉分頁才能脫困。 | [controller:94](../src/lib/physical-component-admin-controller.ts:94)、[controller:157](../src/lib/physical-component-admin-controller.ts:157)、[management:136](../src/lib/physical-component-management.ts:136) |
| F2 | **重大** | **測試和程式對不上。** 第 140 行預期把數量從 20 改成 21 會回 200、重送會回 `replayed: true`，但程式一律回 409，所以這段應該會失敗。第 166 行原本要驗證「已有清點時不能改類型」，現在因為同時改了數量，請求在檢查類型之前就被數量規則擋下：測試照樣通過，但已經沒在驗證類型鎖定。 | [test:140](../tests/physical-component-management.test.ts:140)、[test:166](../tests/physical-component-management.test.ts:166) |
| F3 | **重大（流程）** | **D1 改量程式找不到實作授權紀錄。** 台帳記錄 D1-17／D1-18 批准時寫明「程式實作未授權」，之後沒有補發的紀錄。 | [Decision-Ledger:33](Decision-Ledger-20261119.md) |
| F4 | **高（流程）** | **大量成果沒有提交。** 包括 0023／0024、三個服務檔、`tests/p3-*`、`tests/major03-d1`、所有 11/17 之後的文件，以及剛建立的角色與流程檔，全部只存在本機。硬碟或誤操作就可能損失，雲端 Codex 也看不到。 | `git status` |
| F5 | 中 | D1 錯誤被 `.catch(() => null/undefined)` 吞掉後直接回「未知」，沒有留下紀錄。結果沒有被誤報成成功，但違反 AGENTS 4.3「錯誤要可追溯」。 | [shared-quantity-commit.ts:81](../src/lib/shared-quantity-commit.ts:81)、[:96](../src/lib/shared-quantity-commit.ts:96)、[:117](../src/lib/shared-quantity-commit.ts:117)、[:136](../src/lib/shared-quantity-commit.ts:136) |
| F6 | 中 | **0023 影響面大。** 它在 v2 的收藏、副本、組件、清點、狀態標籤、舊 ID 對照、管理表上加了約 45 個 trigger，套用後每一次相關寫入都會多做檢查並遞增世代。正式套用前需要用正式資料量的拷貝驗證效能，並把觸發後的錯誤碼對應到各 API。 | [0023](../migrations/0023_shared_quantity_commit.sql) |
| F7 | 低 | 讀取 `cache_json` 時解析失敗被靜默吞掉，資料損壞時看不出原因。 | [relation-admin.ts:12](../src/lib/relation-admin.ts:12) |
| F8 | 低 | `ignoreBOM: false` 本來就是預設值，這行沒有改變任何行為，卻動到所有 Admin API 共用的 JSON 解析。建議撤回。 | [notbgg-admin-api.ts:69](../src/lib/notbgg-admin-api.ts:69) |
| F9 | 低 | `component-applicability.ts`、`physical-quantity-impact.ts` 只有測試在用，產品程式沒有呼叫；前者的讀取永遠回 `unknown`。這和 HANDOFF 的描述一致，但不能把它們算進「已實作功能」。 | [component-applicability.ts:41](../src/lib/component-applicability.ts:41) |

## 4. 規模與維護性

- **程式**：`src` 有 260 個檔案、約 1.6 萬行（ts／astro）。最大的單檔是 [game-list-controller.ts](../src/lib/game-list-controller.ts)（1,216 行）和 [sleeves.astro](../src/pages/sleeves.astro)（849 行），暫時不需要動。
- **測試**：`tests/` 有 82 個項目，混著產品測試、一次性驗收（b3c／b41／d7a）、瀏覽器腳本，以及 P3／Major03 診斷框架（約 730 KB）。npm 沒有 `test` script，沒有可以一次跑完的回歸入口。
- **文件**：`docs/` 有 95 個檔案、6.1 MB，其中 24 個是 d7a 證據 JSON，另有多份 ChatGPT／Claude 交接文件。同一件事分散在好幾處，新的 AI 接手時很難判斷該以哪份為準。
- **工作樹殘留**：根目錄有 `.bgg-b2-test-*` 兩個測試暫存資料夾，沒有被 ignore。依 AGENTS 規定不刪除，建議由使用者決定。

## 5. 建議順序（候選，待使用者批准）

1. **保全成果（F4）**：開分支提交目前的工作樹，候選 Migration 標明「候選、不部署」。需要使用者決定提交範圍。
2. **最小修正（F1、F2、F8）**：交給 Codex 一份小工作命令。
   - 在改量確認機制完成前，前端收起改量功能。
   - 伺服器明確拒絕時，前端直接顯示錯誤，不存成待確認操作。
   - 修正測試。
   - 撤回 `ignoreBOM`。
3. **補授權紀錄（F3）**：你確認 D1 改量程式要保留到哪個階段，記進 DECISION_LOG。
4. **回到主線**：R06-UI-01 的四項頁面決策（見 [CURRENT_TASK.md](../CURRENT_TASK.md)）。
5. **之後再做**：加一個 `npm test` 回歸入口，只放產品測試；整理文件，舊交接移到 `docs/archive/`。後者要動到大量檔案，需另行授權。

## 6. 未涵蓋

- 沒有執行測試、`astro check`、build。F2 是從程式碼推斷的，沒有實際跑過。
- 公開網站的資料投影（`public-site-*`、白名單 DTO）和 BGG 同步只做了路由層級的確認，沒有逐行審查。
- 0023 只審了結構和觸發條件，沒有逐一核對約 45 個 trigger 的語意。
