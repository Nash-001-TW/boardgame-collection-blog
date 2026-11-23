# BoardGame Dashboard V2｜Claude 專案知識與開發紀錄

整理日期為 2026-11-19（台北）。這份文件可獨立上傳到 Claude Project Knowledge。檔案路徑指向本機 repo，供取得工作區的執行者查閱。文件彙整已知里程碑與重要證據，完整歷史仍保存在原始 repo 與設計對話。

## 專案指示（貼到 Set project instructions）

> 你是 BoardGame Dashboard V2 的架構審查與開發協作者，用繁體中文回覆。先讀專案知識的最新狀態，再按任務查閱原始紀錄。區分已採納規格、候選、已實作、已驗證與已授權，引用日期及檔案位置。接本機 repo 時先讀 AGENTS.md、docs/current-progress.md 和對應審核文件，保留既有工作樹。先以唯讀方式對齊狀態，取得當前工作單授權才修改或執行。Admin UI 須逐頁確認後才改動或部署。各次 P3 執行、正式資料操作與 Migration 須依明確授權。任何認證由使用者親自完成，聊天與報告只保存去敏證據。

## 開發歷程

| 時間 | 里程碑及證據 |
| --- | --- |
| 2026-09-23～10-01 | Astro 專案起始，建立桌遊收藏網站及 Cloudflare Workers 設定。Git：`7f25a2b`、`696f681`、`731a75d`、`4c03650`。 |
| 10-20～10-21 | 收藏與卡套管理 V2，公開／收藏頁切換至 Cloudflare D1 V2。Git：`fc3771c`、`469866d`。早期 D1 V1.1 的需求、Schema、遷移與驗收以 `docs/D1_V1_1_*.md` 為準。 |
| 11-05 | 修正早期 Migration BOM，完成 NotBGG V1.2 runtime、Schema、身份路由及回歸／發布準備。Git：`2e544f8`、`27a1b57`、`bf6b8e4`。NotBGG 契約、儲存、Admin、公開頁、收藏與身份階段見 `docs/notbgg-d1-contract.md` 至 `docs/notbgg-d6-identity.md`，準備、穩定性與發布紀錄見 `docs/notbgg-d7*.md`。 |
| 11-11～11-12 | Release-01 完成隔離建置、Migration 串接與 Worker 產物檢查。Release-02 唯讀核對 version 18，當時 0017～0022 尚待套用，並記錄上線阻礙。Release-03 正式發布 Worker version 19，正式 D1 Migration 0001～0022 已套用。公開 HTTP、正式備份還原驗證與使用者親自執行的管理員登入／指定唯讀頁面驗收通過。正式寫入流程、非管理員真實登入及部分公開故障情境仍未實測。 |
| 11-12 起 | V2-UI-Review-01 盤點 16 個 Admin 路由、23 組桌面／手機狀態、57 張本機合成預覽。頁面布局、欄位與工作流程仍待使用者逐頁確認。沿用已完成的 Release-03 登入驗收。 |
| 11-17 | R01～R07 核對與 R06 盤點完成。報告記錄 256 收藏、178 遷移定義，分類為 149 歷史商品、29 未知、0 實體，66 個隔離測試通過。R10 獨立核對的正式採購訂單／明細／分攤均為 0，11 個隔離測試通過。這些是歷史證據，不代表後續版本全部驗收。R08～R16 推進設計與驗收範圍，局部規格已採納，整頁 UI 與實作仍有獨立狀態。 |
| 11-18 | 清點日期、完成雙時間、歷史、UNKNOWN、TC23／P1 及副本適用性 S1～S7 收斂。完成守衛、三個副本建立入口、V1／V2／混合與冪等方案唯讀核對。另做正式 V1/V2 唯讀對帳，收藏 256、組件 178、尺寸 116、需求 786 相符，尺寸 label 有 1 筆格式差異。分類、清點和套用仍依賴 V1 來源證據。V1 退役與 V2 表名正規化延後。 |
| 11-18～11-19 | P3 Stage1 全 16 案例受阻。完成 D1 診斷、D2～D5 評估、L1 設計與 L2/R1 三檔靜態交付。11/19 唯讀審查找到 R1 阻礙。L3 暫緩，R2 仍待使用者批准。 |

## 現有架構與發布界線

- Astro、Cloudflare Adapter／Workers、D1 SQLite。預設 static，需即時資料的路由個別 opt out。公開頁透過資料白名單，以 BGG 同步快取、靜態索引／slug 與有效 NotBGG 資料組合公開呈現。
- BGG 更新由 Admin 管理，公開頁不直接呼叫 BGG API。BGG 快取替換與關聯匯入各有獨立歷史。NotBGG 與 BGG 身份、候選身份、組合包與收藏層級概念請查決策原件。
- 本機 `main` 的 HEAD 為 `bf6b8e4`，較本機 `origin/main` 參照領先 3 個提交。工作樹包含已修改與未追蹤的程式、Migration、測試與文件，`.wrangler/` 的本機證據受 Git 忽略。只接遠端分支會漏掉重要內容。新改動開始前先確認工作區與授權範圍。
- Admin 頁面設計遵循逐頁審核。需要新的驗證時，由人員使用確切入口完成登入，保留 Release-03 歷史驗收。正式資料、Migration、部署各有自己的操作紀錄與授權。

## 業務決策與候選

- **清點與完成。** 操作共用清點日期，預設台北今天，新確認必填有效日期，逐副本 × 組件只更新成功確認項目。整盒清點完成日取適用組件有效日期最大值；系統確認時間記錄成功達成完成的轉換。仍完成時可重算日期，保留確認時間。失去完成時隱藏當前有效雙時間並保存歷史；再次完成記新確認時間。日期缺失不猜日期、不更動 M、不增加 U，作為另列完成阻礙。更正走新的成功確認。清點事件、完成轉換事件與適用性變更歷史各自保存。
- **TC23／P1。** 分類可用性、整盒判定、提交守衛及提交結果分別具明確語意。N 是唯一、已確認且適用的實體定義數，M 是其中 checked 且實點為有效非負整數的定義數。可歸屬 UNKNOWN 視規則計 U；必要驗證不可用不計 U，也不能用局部統計宣告完成。LEGACY_PRODUCT 不計 N／M／U。完整可信的獨立結構否定有時可省略 HMAC，必要驗證失敗時不能補推資格。提交區分已提交、已知未提交／回滾、結果未知；成功重播依持久原結果，過期不自動更新依據重送。
- **S1-A 至 S5。** 收藏共用實體定義，逐副本可記明確不適用，沒有例外即適用，不設常態適用性待確認。恢復適用沿用仍有效的舊清點值與日期，不製造清點事件。逐副本預期數量差異另議。適用性歷史獨立記目標、前後關係、後端認證操作者與系統時間。不可用「不適用」排除 UNKNOWN 或必要驗證不可用。適用性、歷史與必要完成重判一致提交，範圍外保留凍結判定。
- **S6／S7。** 新增實體定義和初始副本例外、或新增副本和初始定義例外，各為一次確認、原子提交。只記最終有效關係，集合過期拒絕確認。新副本不複製其他副本的清點資料。範圍外初始尚未判定，首次符合完成可記達成，首次不符合不記失去。R03／R04／R05 皆可建立副本，尚無共用 S7 提交責任。
- **11/19 適用性調和候選 A，尚未批准。** 不適用須是可用可信依據支持的實物／版本差異。第一版候選要求原因及可追溯依據，已有缺件須證明先前適用設定有誤才可更正，保留歷史並顯示退出應清集合的提示；未解決損壞仍顯示。副本列顯示不適用項數，恢復適用顯示原清點日期。封膜可用可信版本證據判定，封膜本身不能作理由。原有逐盒暫不清點及逐組件跳過禁則仍適用。
- **其他 Admin 決策。** R10 第一版採購採收藏層成本和單一採購編輯入口，Migration 核准另行處理。R11 身份及 R03 建立、R02/R04 無身份顯示存在同波上線相依。R12～R16 依各驗收清單，含清點需求欄位、BGG 身份／候選標記及第一版範圍。副本計數、卡套不足兩層算法及撤銷套用決策以 Admin 驗收清單為準，撤銷套用屬後續階段。
- **整盒守衛尚未選型。** R06 token／可操作清單不能覆蓋完整全集。V2 可信投影完整比對為優先驗證候選，V1／混合保留。C1／C2、事件排序與併發機制仍待選，冪等無法取代完整提交守衛。

## P3 狀態、授權與下一張工作單

- 原 Stage1 `P3S1-20261118-001` 的 22 份 Schema 拷貝雜湊比對通過，Miniflare 取得 D1 binding 時 `fetch failed`，SQL 0，16 個子案例全 BLOCKED。已保留證據。
- 另次 D1 診斷 `P3D1-20261118-001` 先 ready，再於 `127.0.0.1:6655` 連線收到 `EACCES`。同次另觀察到 Request.cf 對外 DNS。兩者因果未證實，作業系統層根因未知。已以含 `protocol=tcp` 的 `netsh` 查保留埠，子命令不可用。Security／Defender 查詢受限，事件有無未知。
- 11/18 台北 17:20 使用者批准 L2 三檔準備，21:18–21:19 靜態審查需修正，22:48 使用者批准 L2-R1 三檔限縮靜態修正。來源是「查看目前專案進度」與「接收進度移交資料」聊天。R1 最終審查通過與 L3 授權均無可追溯紀錄。
- R1 三檔在 `tests/p3-local/`。現版以 `cf:false` 關閉已知 Request.cf 抓取。PowerShell 7.6.9 的 JSON 日期自動轉型會使第一個 READY 時間欄位被字串驗證拒絕。啟動器固定 `STOP_NOT_CONFIRMED`，因此整體 PASS 不可達。子程序 fatal 通知早於另存 error.json，有提前終止導致證據缺失的風險。
- **R2 候選，尚待使用者批准。** 限原三檔，處理 UTC 字串與 PowerShell 版本門檻、可信程序樹納管與停止證據、fatal 與落盤先後、去識別執行環境摘要。可評估 Windows Job Object；若無完整證據，停止仍標 UNKNOWN。假子程序乾跑須明列授權，覆蓋握手、孫程序、故障與落盤失敗。現有工作可先審核規格與三檔。
- L3 候選限固定版本、全新 runRoot、單次合成 binding、零 SQL，須另取授權。原嚴格隔離尚未證實。L3、Stage1、Stage2、正式執行的結果各自記錄。

## 原始紀錄索引

| 主題 | repo 內的原件 |
| --- | --- |
| 入口與最新狀態 | `AGENTS.md`、`README.md`、`docs/current-progress.md`、`docs/Claude-handoff-current-20261119.md`、`docs/ChatGPT-handoff-current-20261118.md` |
| 正式發布及公開架構 | `docs/V2-Release-01-summary.md`、`docs/V2-Release-02-summary.md`、`docs/V2-Release-03-summary.md`、`docs/public-site-architecture.md` |
| BGG 與 NotBGG 歷史 | `docs/bgg-cache-replacement-b43f.md`、`docs/bgg-relations-import.md`、`docs/notbgg-*.md`、`docs/V2-NotBGG-decisions.md` |
| UI 與產品決策 | `docs/V2-UI-Review-01.md`、`docs/V2-Admin-decisions-and-test-plan.md`、`docs/Claude-handoff-R08-R16-decisions-20261117.md`、`docs/V2-R*-scope-and-acceptance.md`、`docs/V2-R*-preflight-results.md` |
| 清點、守衛、副本 | `docs/V2-R05-R06-R09-counting-baseline.md`、`docs/V2-counting-guard-readonly-review-20261118.md`、`docs/V2-copy-create-entry-readonly-review-20261118.md`、`docs/V2-P3-guard-idempotency-readonly-comparison-20261118.md` |
| P3 計畫及診斷 | `docs/P3-stage1-*.md`、`docs/P3-D*.md`、`docs/P3-L1-windows-miniflare-local-test-design-20261118.md`、`tests/p3-stage1/`、`tests/p3-local/` |
| 歷史退役提案 | `docs/V1-retirement-and-table-normalization-assessment-20261118.md`、`scripts/v1-v2-retirement-audit-readonly.sql` |

## 第一則 Claude 訊息

> 請閱讀專案知識，先回報四項：正式版基線、已採納的清點／副本規則、P3 目前的阻礙與授權、待使用者決策。以此文件最新日期為準。下一步是審查 P3-L2-R2 工作單與副本適用性 A 的缺件界線，先列出有證據支持的結論及仍待批准事項，保持唯讀。

匯入 Claude Project 建議先只上傳本文件，再依要審查的議題補上所需原件。原始 repo、完整聊天、正式備份、認證資料與 runtime 原始狀態不包含在這份上傳用文件中。
