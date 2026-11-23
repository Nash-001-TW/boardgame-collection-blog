# Claude 接續工作交接｜2026-11-19（台北）

工作區為 `D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog`。先讀 [AGENTS.md](../AGENTS.md) 和 [目前進度](current-progress.md)。本頁補上 11/19 工作區核對結果，歷史報告保留當時的狀態。

## 可直接貼給 Claude

> 請在同一個 repo 接續，先讀 `docs/Claude-handoff-current-20261119.md`。先做唯讀交接核對，確認 P3 本機診斷三檔的實際內容、既有 L2 審查紀錄及 L3 授權有無可追溯證據。回報已驗證事項、仍缺的證據與下一個可審查決策。保留既有工作樹與執行證據，先不要啟動診斷、重跑 Stage1、改 UI、操作正式資料或部署。規格已定稿的部分沿用既有決策。

## 先接 P3 本機診斷

| 階段 | 目前可確認的狀態 | 紀錄 |
| --- | --- | --- |
| Stage1 | `P3S1-20261118-001` 建立隔離目錄，22 份 Schema 拷貝雜湊相符。取得 Miniflare D1 binding 時發生 `fetch failed`，SQL 呼叫 0，16 個子案例全部 BLOCKED，程序已停止。 | [執行報告](P3-stage1-execution-result-20261118.md)、[隔離執行單](P3-stage1-isolation-execution-plan-20261118.md) |
| D1 根因診斷 | `P3D1-20261118-001` 的 runtime ready 成功，取得 binding 時 loopback 連線回傳 `EACCES`，作業系統拒絕的最終原因未知。另觀察到 Request.cf 對外 DNS 嘗試。兩項證據應分開判讀，D1 的 cause 只適用於這次執行。 | [診斷結果](P3-stage1-runtime-diagnostic-result-20261118.md)、[隔離與 loopback 分析](P3-D2-isolation-and-loopback-readonly-review-20261118.md)、[EACCES 可行性分析](P3-D3-isolation-feasibility-and-eacces-readonly-review-20261118.md) |
| 嚴格隔離 | D4／D5 比較及盤點已完成，尚無已選定且已驗證的隔離環境。 | [環境比較](P3-D4-isolated-environment-feasibility-comparison-20261118.md)、[虛擬化盤點](P3-D5-local-virtualization-readonly-inventory-20261118.md) |
| L1／L2 本機候選路徑 | L1 有設計文件。11/19 核對時，三個 L2 候選檔實際存在且未追蹤。僅憑檔案存在，L2 正式審查結論及 L3 執行授權仍待從原對話或交付紀錄確認。 | [L1 設計及驗收界線](P3-L1-windows-miniflare-local-test-design-20261118.md) |
| L3 | 11/19 檢查時，固定候選目錄 `.wrangler/p3-local/diagnostics/P3L3-20261118-001` 不存在。本次交接未執行 runtime。 | [啟動器](../tests/p3-local/launch-local-diagnostic.ps1)、[診斷程式](../tests/p3-local/diagnose-local-runtime.mjs)、[證據工具](../tests/p3-local/diagnostic-evidence.mjs) |

本次以唯讀方式取得三檔的 SHA-256，可供 Claude 確認接手版本。

| 檔案（`tests/p3-local/`） | SHA-256 |
| --- | --- |
| `diagnose-local-runtime.mjs` | `C13C91C14D31AFF8953B157AB8E92D64C41BBC6E8148E0FFFE06FC07CFD5C14A` |
| `diagnostic-evidence.mjs` | `6D01DA97FE126E3A8CFB2FF67C76E51ADEFD7653AE94BCDC637F4D1CF88424E0` |
| `launch-local-diagnostic.ps1` | `9B8D5D4BF20F62E21FCB79D61802C1A32427F248AF2FDB7A66A6270C113EB30A` |

第一步對照 L1 第 4～11 節與現有三檔，核對實際參數、`cf: false` 設定傳遞、父子監督、停止條件、零 SQL 及證據檢查，並找出可引用的 L2 審查與 L3 授權。若缺授權，可先提交靜態核對結果及待批准的單次 L3 範圍。後續即使 L3 取得 binding，也要分別記錄 binding 功能、本機政策、嚴格隔離與程序停止；Stage1 的 16 案例、Stage2 與正式執行各有獨立驗收與授權。

保留兩次歷史執行的本機證據目錄：

- `.wrangler/p3-stage1/runs/P3S1-20261118-001/evidence`
- `.wrangler/p3-stage1/diagnostics/P3D1-20261118-001/evidence`

## 接續設計時沿用的決策

- **R05／R06／R09 清點。** 每次操作共用清點日期，預設台北今天，日期必填，逐副本 × 組件只更新成功確認項目。整盒完成日期是適用組件日期最大值，系統確認時間取成功從未完成轉為完成的時間。完成後重清且仍完成只重算日期；失去完成時隱藏當前有效雙時間並保留歷史；再次完成記新確認時間。補登、UNKNOWN、退出／重返及事件摘要等細節見 [11/18 完整設計交接](ChatGPT-handoff-current-20261118.md) 和 [清點基準](V2-R05-R06-R09-counting-baseline.md)。
- **副本適用性。** TC23、P1、S1～S7 已採納。收藏共用實體組件定義，逐副本記錄不適用例外，相關新增與初始例外須原子提交。現有 R03／R04／R05 三處建立入口的重播／衝突保護各異，共用責任尚未實作。見 [建立入口核對](V2-copy-create-entry-readonly-review-20261118.md)。
- **整盒提交守衛。** 現有 R06 token／可操作清單無法覆蓋整盒全集。V2 可信投影完整比對是先驗證的候選，V1／混合方案保留。C1／C2、完整 guard、事件排序與併發機制仍待選型，冪等機制和完整守衛各有驗收責任。見 [五項唯讀核對](V2-counting-guard-readonly-review-20261118.md)、[守衛與冪等方案比較](V2-P3-guard-idempotency-readonly-comparison-20261118.md)。
- **其他頁面。** 先看 [Admin 規格與驗收清單](V2-Admin-decisions-and-test-plan.md) 及 [R08～R16 歷史交接](Claude-handoff-R08-R16-decisions-20261117.md)。再按工作範圍查 [R01～R07 核對結果](V2-R01-R07-preflight-results.md)、[R10](V2-R10-scope-and-acceptance.md)、[R11](V2-R11-scope-and-acceptance.md)、[R12～R15](V2-R12-R15-scope-and-acceptance.md) 或 [R16](V2-R16-scope-and-acceptance.md)。較早的交接狀態以 11/18 已記錄的使用者決策更新。

## 正式環境與工作樹

- Release-03 在 11/12 部署 Worker version 19，正式 D1 已套用 Migration 0001～0022。使用者的管理員登入與指定唯讀頁面驗收已通過，沿用該紀錄。後續若因新工作確實需要登入，提供確切網址或命令、操作與成功條件，由使用者親自完成。見 [Release-03](V2-Release-03-summary.md)。
- Admin 頁面仍待使用者逐頁確認布局、欄位及操作流程。設計確認前等候 UI 修改與下一次部署。審核圖庫是本機合成資料。見 [UI 審核與圖庫](V2-UI-Review-01.md)。
- V1 退役與 V2 表名正規化延後到未來另有資料庫變更需求時一併評估。已完成正式唯讀對帳，分類、清點與套用仍依賴 V1 來源證據。重新提案前需核對依賴、對帳與備份。見 [退役評估](V1-retirement-and-table-normalization-assessment-20261118.md)、[公開網站架構](public-site-architecture.md)。
- 本機 `main` 在 HEAD `bf6b8e4`，相對本機的 `origin/main` 參照領先 3 個提交。已有大量已修改或未追蹤的產品程式、Migration、測試及文件，`.wrangler/` 另受 Git 忽略。優先讓 Claude 接同一工作區。若改用新 clone 或只上傳此檔，需另提供工作所需的引用文件與已審查的程式檔，避免把遠端分支當作完整交付。既有改動與證據留在本機，避免以 reset、clean 或 restore 取代。

本次交接核對限本機文件、檔案存在、雜湊與 Git 狀態，新增本頁作為接手入口。正式資料、程式及測試狀態沿用既有紀錄。
