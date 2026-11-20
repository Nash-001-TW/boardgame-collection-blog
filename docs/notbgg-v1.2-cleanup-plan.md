# NotBGG V1.2：暫存清理盤點與部署後封存計畫

日期：2026-11-05（Asia/Taipei）。**僅盤點與計畫；未刪除、搬移、封存任何既有檔案，未Git提交／部署／D1操作。** 本輪新增此文件及一份ignored的衍生盤點清冊，不修改既有候選manifest／Runbook／程式／Migration。

## 1. 結論與掃描邊界

**原專案檔案目前沒有可直接批准的CLEAN_NOW項目：0 B。** 最大空間來自BGG備份與本機持久化，按要求保護；當前dist/與generated types仍被候選、測試及部署引用。即使可重新build，也不能在D-7B前清掉凍結產物。這不是建議保留所有垃圾，而是未找到同時滿足「可重建、無有效引用、無敏感/歷史資料風險」的既有檔案。

掃描時點：2026-11-05T01:34:22.028Z。以lstat盤點2338個檔案／連結，總邏輯長度 **352,378,393 B (336.054 MiB)**。未跟隨符號連結／junction；.git與node_modules不遞迴，分別PROTECT／KEEP，其大小未納入，故此數字**不是整個專案或磁碟實際用量**。空目錄不計檔案長度；SQLite WAL等可能自然變動，這不是資料庫備份或一致性snapshot。

Git：branch main，HEAD 469866d6f7e3aed947f9f1c2e0d59b9cc16961a2，cached diff空，既有修改、untracked與intent-to-add保持原狀。source候選ID仍為：

`41855c8f7ea80de577e5461c1c4eb61b0e030665e948927488685da72b2b211d`

當前candidate manifest SHA256：`d0e220c362ac276671a01a532177b9ffe1bb8c0497f490d12f90771146633669`。本輪新清理計畫尚未納入原凍結的220個待提交路徑；不自行更新Commit／manifest。若要將本文件加入第3組文件Commit，需人工核對該文件及review manifest；runtime source本輪未改。

| 分類 | 原掃描檔案數 | 邏輯大小 | 行動意義 |
| --- | ---: | --- | --- |
| KEEP | 2083 | 52,875,083 B (50.426 MiB) | 程式、測試、必要文件、當前產物或仍被工具讀取 |
| CLEAN_NOW | 0 | 0 B | 沒有原專案檔案符合條件；不執行任何清理 |
| ARCHIVE_AFTER_DEPLOY | 8 | 31,872 B (0.030 MiB) | 成功部署後可提封存副本；不是刪除許可 |
| REVIEW | 35 | 4,523,071 B (4.314 MiB) | 來源／用途／rollback角色未充分確認 |
| PROTECT | 212 | 294,948,367 B (281.285 MiB) | 備份、私人輸入、metadata、持久化；禁止自動清理 |

分類以每個實際檔案為準，以下資料夾群組若有例外已分拆。完整檔案級大小、Git狀態、分類及靜態引用來源暫存在 `.wrangler/cleanup-plan-inventory.json`；只有路徑／大小／時間／分類等衍生資訊，未複製metadata內容、憑證值或正式資料列。程式引用分析含src/scripts/tests、config及.wrangler內驗證程式；也辨認到工具會動態列舉logs，這些logs改列KEEP。靜態查不到引用不代表沒有外部或動態讀者。

## 2. 可立即清理清單（僅提案）

| 路徑 | 分類 | 大小／Git | 原因與條件 |
| --- | --- | --- | --- |
| 原2338個檔案中的CLEAN_NOW | 無 | 0 B | 目前沒有安全可立即移除的既有檔案 |
| .wrangler/tmp/ | CLEAN_NOW（空目錄） | 0檔、0 B、ignored | 目前為空，沒有實際可節省容量；可直接保留，不必為空目錄做清理 |
| .wrangler/cleanup-plan-inventory.json | CLEAN_NOW（本輪衍生診斷） | 832,316 B (0.794 MiB)、ignored | 本輪才產生，完成報告核對後可另行同意移除；能以檔案metadata重掃產生。不計入原專案可節省量。若要長期保留本次完整稽核則改KEEP |

AstroCheck_Err.txt原本是可重建的舊診斷，但內容掃描出疑似個人路徑／聯絡資訊，保守列PROTECT；沒有把原文或值貼進報告。它不是正式PASS證據，也不能僅因ignored就直接刪。workerd程序查核因CIM權限不足，活動程序／檔案鎖 **NOT VERIFIED**；未停止任何程序。未來若核准任何暫存清理，先確認相關build／測試／dev服務已停止及沒有外部讀者，不能假定沒有程序使用它。

## 3. 主要資料夾與產物清單

| 路徑／範圍 | 檔數 | 大小 | Git狀態 | 分類 | 用途／清理判斷 | 風險 |
| --- | ---: | --- | --- | --- | --- | --- |
| `.astro/` | 6 | 7,897 B (0.008 MiB) | ignored | KEEP | generated Astro types與內容資訊；tsconfig/工具仍引用 | 中：目前不可刪，會影響check |
| `dist/client/` | 1658 | 39,509,909 B (37.680 MiB) | ignored | KEEP | 當前ASSETS與候選manifest／HTTP測試輸入 | 高：不得在部署前清除／覆寫 |
| `dist/server/（排除環境檔）` | 74 | 4,777,730 B (4.556 MiB) | ignored | KEEP | 編譯Worker及部署config，與ASSETS成套 | 高：仍由部署與測試讀取 |
| `dist/server/.dev.vars` | 1 | 250 B (0.000 MiB) | ignored | PROTECT | build產生的本機環境副本 | 高：不得進Git／一般release封存 |
| `.wrangler/state/` | 27 | 78,692,896 B (75.047 MiB) | ignored | PROTECT | D1/KV/cache/observability持久化及SQLite sidecars | 最高：本輪與清理計畫均禁止清除 |
| `d1-fk-immediate-test-v2/` | 9 | 1,816,368 B (1.732 MiB) | ignored | PROTECT | 本機持久化測試／還原資料，來源不以名稱猜測 | 最高：不得清除或SQLite去重 |
| `d1-production-test-v2/` | 9 | 1,824,608 B (1.740 MiB) | ignored | PROTECT | 本機持久化測試／還原資料，來源不以名稱猜測 | 最高：不得清除或SQLite去重 |
| `d1-remote-sorted-test-v2/` | 9 | 1,816,368 B (1.732 MiB) | ignored | PROTECT | 本機持久化測試／還原資料，來源不以名稱猜測 | 最高：不得清除或SQLite去重 |
| `d1-remote-test-v2/` | 9 | 1,816,368 B (1.732 MiB) | ignored | PROTECT | 本機持久化測試／還原資料，來源不以名稱猜測 | 最高：不得清除或SQLite去重 |
| `d1-restore-test/` | 9 | 131,288 B (0.125 MiB) | ignored | PROTECT | 本機持久化測試／還原資料，來源不以名稱猜測 | 最高：不得清除或SQLite去重 |
| `d1-restore-test-v2/` | 9 | 1,923,488 B (1.834 MiB) | ignored | PROTECT | 本機持久化測試／還原資料，來源不以名稱猜測 | 最高：不得清除或SQLite去重 |
| `.wrangler/deploy/config.json` | 1 | 152 B (0.000 MiB) | ignored | KEEP | Wrangler產物探索pointer | 中：避免破壞部署指向 |
| `.wrangler-dry-run/` | 34 | 4,520,652 B (4.311 MiB) | ignored | REVIEW | README指出2026-10-21舊build，非現行候選 | 高／未知：可能舊rollback證據或內嵌私人輸入 |
| `backups/` | 41 | 3,895,091 B (3.715 MiB) | ignored | PROTECT | SQL備份、拆分資料及還原輔助程式 | 最高：保護來源與一致性，不按日期刪 |
| `src/data/bgg-cache.json*.bak（55檔，附表列全名）` | 55 | 195,425,680 B (186.372 MiB) | ignored | PROTECT | 歷次BGG安全替換前備份 | 高：含歷史唯一版本，全部PROTECT |
| `src/其他*.bak（附表列全名）` | 3 | 7,913 B (0.008 MiB) | ignored | PROTECT | middleware／sleeves程式歷史備份 | 高：未證明已被可重建版本取代 |
| `src/data/bgg-cache.json` | 1 | 3,638,060 B (3.470 MiB) | tracked，未stage修改 | PROTECT | 正式BGG快取，指定SHA256基準 | 最高：明確禁止清除 |
| `src/data/bgg-collection-cache.json` | 1 | 645,861 B (0.616 MiB) | ignored | PROTECT | 私人收藏輸入，getGames/build仍import | 最高：ignored不是可刪或備份保障 |
| `src/其餘程式與data` | 126 | 537,635 B (0.513 MiB) | tracked clean／untracked／tracked，未stage修改 | KEEP | 正式程式／路由／樣式／必要公開資料 | 高：不清除 |
| `migrations/` | 16 | 76,761 B (0.073 MiB) | tracked clean／tracked，未stage修改／untracked | KEEP | 0001～0016全部Migration | 最高：永久保留，不重編號或刪歷史 |
| `tests/` | 57 | 509,151 B (0.486 MiB) | untracked／intent-to-add，未stage內容／tracked，未stage修改 | KEEP | 測試程式／helpers／fixture頁，不是測試輸出 | 高：不得按HTML/JSON或test命名清掉 |
| `scripts/` | 20 | 133,522 B (0.127 MiB) | tracked clean／untracked／tracked，未stage修改 | KEEP | 部署前工具／解析／安全匯入與驗證程式 | 高：保留現有引用鏈 |
| `public/` | 3 | 2,986,576 B (2.848 MiB) | tracked clean | KEEP | 正式favicon及banner素材 | 高：PNG不是測試截圖 |
| `imports/` | 3 | 1,301,094 B (1.241 MiB) | ignored | PROTECT | 原始CSV與已產生SQL；可能含私人收藏/購買資訊 | 最高：來源/再生能力未證明，不清 |
| `data/` | 1 | 1,027,804 B (0.980 MiB) | ignored | PROTECT | BGG私人collection XML來源 | 最高：不清除、不入Git |
| `.vscode/` | 2 | 294 B (0.000 MiB) | tracked clean | KEEP | 既有tracked編輯器設定 | 中：不是新暫存，ignore不等於未追蹤 |
| .git/ | 未遞迴 | 未計 | Git內部 | PROTECT | refs／objects／Index不可當作清理對象 | 不執行gc/prune或清除內部快照 |
| node_modules/ | 未遞迴 | 未計 | ignored | KEEP | 目前build／strict／測試仍import已鎖定版本與native binaries | 不為節省容量破壞部署前工具環境 |

**HTML與圖片不是靠副檔名判斷：** 盤點的1636個HTML全在dist，為真實靜態頁；2個PNG為public/images/cat-adventure-banner.png與dist/client內副本，不是測試截圖。沒有找到可獨立批准清除的測試HTML或截圖。JSON含正式cache、私人輸入、候選manifest與metadata；LOG也有被hash／重跑工具讀取的證據，不能批次依副檔名刪除。

## 4. 其他逐檔清冊

此表補齊未由上一節群組覆蓋的檔案，包括.wrangler各個驗證檔、每個歷史報告、16個metadata及根目錄檔案。codeRefs只列具體例子；動態logs讀者亦已保留。所有ARCHIVE_AFTER_DEPLOY項目目前仍保留，遇到引用不得移除原路徑。

| 路徑 | 大小 | Git | 分類 | 用途／原因 | 引用或風險 |
| --- | --- | --- | --- | --- | --- |
| `.bgg-b2-test-1JZTMi/cache.json` | 5,217 B (0.005 MiB) | untracked | ARCHIVE_AFTER_DEPLOY | 已確認的合成失敗殘留；目前excluded manifest／驗證工具仍參照，不可部署前移除 | 中；需先保存證據與確認動態／外部讀者 |
| `.bgg-b2-test-1JZTMi/cache.json.6cce4567-0494-46d7-ac54-522f6045eea7.bak` | 5,217 B (0.005 MiB) | ignored | PROTECT | 備份／原始匯入／私人收藏輸入；未證明可再生或過期 | 高；不輸出內容、不自動處理 |
| `.bgg-b2-test-FSA5Oi/cache.json` | 5,217 B (0.005 MiB) | untracked | ARCHIVE_AFTER_DEPLOY | 已確認的合成失敗殘留；目前excluded manifest／驗證工具仍參照，不可部署前移除 | 中；需先保存證據與確認動態／外部讀者 |
| `.bgg-b2-test-FSA5Oi/cache.json.a300b156-d486-4a0d-b6ad-f2be030b5348.bak` | 5,217 B (0.005 MiB) | ignored | PROTECT | 備份／原始匯入／私人收藏輸入；未證明可再生或過期 | 高；不輸出內容、不自動處理 |
| `.dev.vars` | 356 B (0.000 MiB) | ignored | PROTECT | 本機敏感設定或私人且必要的build input，不能入Git | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/runbook.mjs`等 |
| `.env` | 50 B (0.000 MiB) | ignored | PROTECT | 本機敏感設定或私人且必要的build input，不能入Git | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/runbook.mjs`等 |
| `.gitignore` | 1,127 B (0.001 MiB) | tracked clean | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs`、`.wrangler/r6-verification/report.mjs` |
| `.wrangler/deployment-prep/astro-check.log` | 5,443 B (0.005 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/automated.log` | 28,168 B (0.027 MiB) | ignored | KEEP | 仍有程式讀取／引用，清理前不得破壞工具輸入 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/c1.log` | 280 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/c2-focused.log` | 168 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/c3.log` | 160 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/d5.log` | 218 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/d6.log` | 271 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/freeze.mjs` | 6,081 B (0.006 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/deployment-prep/identity.json` | 61,972 B (0.059 MiB) | ignored | KEEP | 仍有程式讀取／引用，清理前不得破壞工具輸入 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/identity.mjs`等 |
| `.wrangler/deployment-prep/identity.mjs` | 2,563 B (0.002 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/deployment-prep/production-build.log` | 95,074 B (0.091 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/production-code-inspection.txt` | 864 B (0.001 MiB) | ignored | KEEP | 仍有程式讀取／引用，清理前不得破壞工具輸入 | 程式引用：`.wrangler/deployment-prep/safety.mjs`、`.wrangler/deployment-prep/verifier.mjs` |
| `.wrangler/deployment-prep/runbook-command-blocks.json` | 8,652 B (0.008 MiB) | ignored | ARCHIVE_AFTER_DEPLOY | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 | 中；需先保存證據與確認動態／外部讀者 |
| `.wrangler/deployment-prep/runbook.mjs` | 29,634 B (0.028 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/deployment-prep/safety.mjs` | 5,590 B (0.005 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/deployment-prep/strict.log` | 0 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/deployment-prep/identity.mjs` |
| `.wrangler/deployment-prep/verifier.mjs` | 2,479 B (0.002 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/deployment-prep/verify.cjs` | 1,960 B (0.002 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r5-verification/astro-check.log` | 5,443 B (0.005 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/audit.cjs` | 5,824 B (0.006 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r5-verification/automated-result.json` | 21 B (0.000 MiB) | ignored | KEEP | 仍有程式讀取／引用，清理前不得破壞工具輸入 | 程式引用：`.wrangler/r5-verification/tests.cjs` |
| `.wrangler/r5-verification/automated.log` | 28,182 B (0.027 MiB) | ignored | KEEP | 仍有程式讀取／引用，清理前不得破壞工具輸入 | 程式引用：`.wrangler/r5-verification/tests.cjs` |
| `.wrangler/r5-verification/browsers.cjs` | 1,050 B (0.001 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r5-verification/build-retry.log` | 96,734 B (0.092 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/build.log` | 2,345 B (0.002 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/c1.log` | 280 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/c1/failure.json` | 151 B (0.000 MiB) | ignored | ARCHIVE_AFTER_DEPLOY | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 | 中；需先保存證據與確認動態／外部讀者 |
| `.wrangler/r5-verification/c2-focused.log` | 168 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/c2-focused/failure.json` | 151 B (0.000 MiB) | ignored | ARCHIVE_AFTER_DEPLOY | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 | 中；需先保存證據與確認動態／外部讀者 |
| `.wrangler/r5-verification/c3.log` | 160 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/c3/failure.json` | 151 B (0.000 MiB) | ignored | ARCHIVE_AFTER_DEPLOY | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 | 中；需先保存證據與確認動態／外部讀者 |
| `.wrangler/r5-verification/checks.cjs` | 729 B (0.001 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r5-verification/d5.log` | 218 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/d6.log` | 271 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/migrations-retry.log` | 302 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/migrations.log` | 3,293 B (0.003 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/replay.mjs` | 8,505 B (0.008 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r5-verification/report.mjs` | 36,793 B (0.035 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r5-verification/restore-controlled.log` | 1,931 B (0.002 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/restore-retry.log` | 841 B (0.001 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/restore.log` | 973 B (0.001 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/restore.mjs` | 8,571 B (0.008 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/strict.log` | 0 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `.wrangler/r5-verification/tests.cjs` | 520 B (0.000 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r6-verification/api-metadata.json` | 808 B (0.001 MiB) | ignored | PROTECT | 操作metadata／恢復dump；需受保護保留，禁止按JSON/SQL副檔名清除 | 程式引用：`.wrangler/r6-verification/remote-details.mjs`、`.wrangler/r6-verification/remote.mjs` |
| `.wrangler/r6-verification/canonical-verify.mjs` | 1,249 B (0.001 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r6-verification/canonical.mjs` | 2,653 B (0.003 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r6-verification/normalized.mjs` | 1,686 B (0.002 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r6-verification/remote-details.mjs` | 6,093 B (0.006 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r6-verification/remote.mjs` | 3,817 B (0.004 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r6-verification/report.mjs` | 27,789 B (0.027 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/r6-verification/restore.log` | 2,462 B (0.002 MiB) | ignored | ARCHIVE_AFTER_DEPLOY | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 | 中；需先保存證據與確認動態／外部讀者 |
| `.wrangler/r6-verification/restore.mjs` | 10,235 B (0.010 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 程式引用：`.wrangler/r6-verification/report.mjs` |
| `.wrangler/r6-verification/synthetic.sql` | 71,437 B (0.068 MiB) | ignored | PROTECT | 操作metadata／恢復dump；需受保護保留，禁止按JSON/SQL副檔名清除 | 程式引用：`.wrangler/r6-verification/restore.mjs` |
| `.wrangler/r6-verification/target.json` | 48 B (0.000 MiB) | ignored | PROTECT | 操作metadata／恢復dump；需受保護保留，禁止按JSON/SQL副檔名清除 | 程式引用：`.wrangler/deployment-prep/safety.mjs`、`.wrangler/r6-verification/remote-details.mjs`等 |
| `.wrangler/rate-limiter-fix/astro-check.log` | 5,443 B (0.005 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/focused.log` | 991 B (0.001 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/freeze.mjs` | 5,266 B (0.005 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/rate-limiter-fix/identity.json` | 502,696 B (0.479 MiB) | ignored | KEEP | 仍有程式讀取／引用，清理前不得破壞工具輸入 | 程式引用：`.wrangler/rate-limiter-fix/freeze.mjs`、`.wrangler/rate-limiter-fix/identity.mjs`等 |
| `.wrangler/rate-limiter-fix/identity.mjs` | 4,735 B (0.005 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/rate-limiter-fix/namespace.mjs` | 2,454 B (0.002 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/rate-limiter-fix/notbgg-admin-browser.log` | 315 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/notbgg-collection-browser.log` | 218 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/notbgg-link-browser.log` | 271 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/production-build.log` | 95,076 B (0.091 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/runbook-blocks.json` | 9,871 B (0.009 MiB) | ignored | ARCHIVE_AFTER_DEPLOY | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 | 中；需先保存證據與確認動態／外部讀者 |
| `.wrangler/rate-limiter-fix/runbook-config-gate.cjs` | 285 B (0.000 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/rate-limiter-fix/strict-initial.log` | 2,186 B (0.002 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/strict.log` | 0 B (0.000 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/targeted-security-d5-d6.log` | 5,489 B (0.005 MiB) | ignored | KEEP | 仍有程式讀取／引用，清理前不得破壞工具輸入 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `.wrangler/rate-limiter-fix/update-runbook.mjs` | 10,821 B (0.010 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/rate-limiter-fix/verify.cjs` | 1,780 B (0.002 MiB) | ignored | KEEP | 隔離驗證／候選工具程式，不是純測試輸出；保留可重跑來源 | 保留，不當成垃圾 |
| `.wrangler/rate-limiter-fix/wrangler-types.log` | 1,322 B (0.001 MiB) | ignored | KEEP | 仍由候選／報告工具動態列舉並雜湊logs，部署前及工具未退役前不可刪 | 程式引用：`.wrangler/rate-limiter-fix/identity.mjs` |
| `AGENTS.md` | 874 B (0.001 MiB) | tracked clean | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `astro.config.mjs` | 454 B (0.000 MiB) | tracked，未stage修改 | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `AstroCheck_Err.txt` | 15,237 B (0.015 MiB) | ignored | PROTECT | 舊診斷輸出含疑似個人路徑／聯絡資訊；未公開原文，需人員確認後安全處置 | 高；不輸出內容、不自動處理 |
| `backup_before_migration_fix.sql` | 694,596 B (0.662 MiB) | ignored | PROTECT | 備份／原始匯入／私人收藏輸入；未證明可再生或過期 | 高；不輸出內容、不自動處理 |
| `CLAUDE.md` | 9 B (0.000 MiB) | tracked clean | KEEP | 版本控制中的符號連結；未跟隨，不改指向 | 保留，不當成垃圾 |
| `docs/bgg-cache-replacement-b43f.md` | 7,264 B (0.007 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/bgg-relations-import.md` | 8,671 B (0.008 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/D1_V1_1_MIGRATION.md` | 6,536 B (0.006 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/D1_V1_1_REQUIREMENTS.md` | 7,473 B (0.007 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/D1_V1_1_SCHEMA.md` | 10,849 B (0.010 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/D1_V1_1_TASKS.md` | 5,682 B (0.005 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/d7a-local-evidence.json` | 119,650 B (0.114 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/verify.cjs`、`tests/bgg-static-alias.test.ts`等 |
| `docs/d7a-r3-cls-after-list.json` | 57,148 B (0.055 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/d7a-r3-cls-after.json` | 291,047 B (0.278 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/d7a-r3-cls-baseline.json` | 343,807 B (0.328 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/d7a-r3-invalid-instrumentation.json` | 1,708 B (0.002 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/d7a-r3-migration-evidence.json` | 5,246 B (0.005 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`tests/d7a-r3-migrations.mjs` |
| `docs/d7a-r4-migration-evidence.json` | 8,745 B (0.008 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/r5-verification/replay.mjs`等 |
| `docs/d7a-r5-0003-bytes.json` | 1,396 B (0.001 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-auth-status.json` | 165 B (0.000 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-browser-results.json` | 315 B (0.000 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/browsers.cjs`、`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-candidate-manifest.json` | 328,936 B (0.314 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/identity.mjs`、`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-check-results.json` | 97 B (0.000 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/checks.cjs`、`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-final-verification.json` | 5,824 B (0.006 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-git-inventory.json` | 28,701 B (0.027 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/audit.cjs`、`.wrangler/r5-verification/report.mjs`等 |
| `docs/d7a-r5-migration-evidence.json` | 9,292 B (0.009 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/replay.mjs`、`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-restore-evidence.json` | 11,730 B (0.011 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs`、`.wrangler/r5-verification/restore.mjs` |
| `docs/d7a-r5-sensitive-audit.json` | 106,525 B (0.102 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/audit.cjs`、`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r5-smoke-matrix.json` | 110,741 B (0.106 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `docs/d7a-r6-0003-verification.json` | 2,410 B (0.002 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r6-verification/normalized.mjs`、`.wrangler/r6-verification/report.mjs` |
| `docs/d7a-r6-auth-status.json` | 350 B (0.000 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r6-verification/canonical.mjs`、`.wrangler/r6-verification/report.mjs` |
| `docs/d7a-r6-cloudflare-readonly.json` | 37,114 B (0.035 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/safety.mjs`、`.wrangler/r6-verification/canonical-verify.mjs`等 |
| `docs/d7a-r6-git-candidate.json` | 83,491 B (0.080 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/identity.mjs`等 |
| `docs/d7a-r6-metadata-review.json` | 35,000 B (0.033 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r6-verification/report.mjs` |
| `docs/d7a-r6-restore-evidence.json` | 14,621 B (0.014 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r6-verification/report.mjs`、`.wrangler/r6-verification/restore.mjs` |
| `docs/notbgg-d1-contract.md` | 9,028 B (0.009 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d2-storage.md` | 8,383 B (0.008 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d3-admin.md` | 7,934 B (0.008 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d4-public.md` | 6,083 B (0.006 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d5-collection.md` | 12,657 B (0.012 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d6-identity.md` | 14,087 B (0.013 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d7a-preflight.md` | 35,680 B (0.034 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d7a-r3-stability.md` | 19,981 B (0.019 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `docs/notbgg-d7a-r5-release-readiness.md` | 38,546 B (0.037 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs` |
| `docs/notbgg-d7a-r6-release-preparation.md` | 37,852 B (0.036 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r6-verification/report.mjs` |
| `docs/notbgg-d7b-deployment-runbook.md` | 45,350 B (0.043 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/identity.mjs`、`.wrangler/deployment-prep/runbook.mjs`等 |
| `docs/notbgg-deployment-candidate.json` | 424,436 B (0.405 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/identity.mjs`等 |
| `docs/notbgg-deployment-integrity.sql` | 1,515 B (0.001 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/identity.mjs`、`.wrangler/deployment-prep/runbook.mjs` |
| `docs/notbgg-deployment-safety.json` | 7,997 B (0.008 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/identity.mjs`等 |
| `docs/notbgg-deployment-verification.json` | 37,019 B (0.035 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/identity.mjs`等 |
| `docs/notbgg-rate-limiter-verification.json` | 5,444 B (0.005 MiB) | untracked | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/rate-limiter-fix/freeze.mjs`、`.wrangler/rate-limiter-fix/identity.mjs`等 |
| `docs/reference/d1_collection_status.json` | 1,490 B (0.001 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/d1_v2_counts.json` | 1,606 B (0.002 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/d1_v2_schema.json` | 37,280 B (0.036 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_acquisitions_columns.json` | 4,054 B (0.004 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_acquisitions_fk.json` | 1,982 B (0.002 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_acquisitions_indexes.json` | 1,604 B (0.002 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_acquisitions_unique_columns.json` | 1,926 B (0.002 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_copies_columns.json` | 5,404 B (0.005 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_copies_fk.json` | 1,482 B (0.001 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_copies_index_columns.json` | 1,602 B (0.002 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_copies_indexes.json` | 1,266 B (0.001 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_fk_check.json` | 978 B (0.001 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_master.json` | 118,872 B (0.113 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_migrations.json` | 4,434 B (0.004 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1_quick_check.json` | 1,088 B (0.001 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `docs/reference/phase-c1/d1_C1D_20261027_R03_run_summary.ndjson` | 7,196 B (0.007 MiB) | untracked | PROTECT | 16個歷史正式metadata；保持原位、不追蹤、不搬移 | 高；不輸出內容、不自動處理 |
| `package-lock.json` | 204,664 B (0.195 MiB) | tracked，未stage修改 | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/audit.cjs`、`tests/d7a-inventory.mjs` |
| `package.json` | 875 B (0.001 MiB) | tracked，未stage修改 | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/r5-verification/report.mjs`、`.wrangler/rate-limiter-fix/identity.mjs`等 |
| `README.md` | 1,604 B (0.002 MiB) | tracked clean | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `test_0011_sleeves.sql` | 2,419 B (0.002 MiB) | ignored | REVIEW | 歷史SQL測試fixture，未確認所有外部流程與來源；不執行、不清除 | 用途待確認，不清理 |
| `tsconfig.json` | 525 B (0.001 MiB) | tracked clean | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 保留，不當成垃圾 |
| `worker-configuration.d.ts` | 624,853 B (0.596 MiB) | ignored | KEEP | 目前strict／Astro環境的generated types，雖可再生仍被引用 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/runbook.mjs`等 |
| `wrangler.json` | 996 B (0.001 MiB) | tracked，未stage修改 | KEEP | 候選檔案、必要文件或部署config pointer；保留引用鏈 | 程式引用：`.wrangler/deployment-prep/freeze.mjs`、`.wrangler/deployment-prep/runbook.mjs`等 |

### 備份逐檔補充（同一資料不重複加總）

55個BGG備份全部PROTECT；另外保護程式.bak及backups的SQL／拆分資料。此附表列全名，以免用glob誤刪；**glob只描述分類，不是執行清理的allowlist**。

| 路徑 | 大小 | Git | 分類 |
| --- | --- | --- | --- |
| `.bgg-b2-test-1JZTMi/cache.json.6cce4567-0494-46d7-ac54-522f6045eea7.bak` | 5,217 B (0.005 MiB) | ignored | PROTECT |
| `.bgg-b2-test-FSA5Oi/cache.json.a300b156-d486-4a0d-b6ad-f2be030b5348.bak` | 5,217 B (0.005 MiB) | ignored | PROTECT |
| `backups/backup_before_0012.sql` | 830,340 B (0.792 MiB) | ignored | PROTECT |
| `backups/before-sleeve-size-fix.sql` | 694,363 B (0.662 MiB) | ignored | PROTECT |
| `backups/boardgame-collection-db_20261015.sql` | 788,054 B (0.752 MiB) | ignored | PROTECT |
| `backups/d1_import/01_schema.sql` | 5,732 B (0.005 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_001.sql` | 16,036 B (0.015 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_002.sql` | 17,834 B (0.017 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_003.sql` | 18,183 B (0.017 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_004.sql` | 18,257 B (0.017 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_005.sql` | 17,945 B (0.017 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_006.sql` | 17,585 B (0.017 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_007.sql` | 17,228 B (0.016 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_008.sql` | 17,838 B (0.017 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_009.sql` | 11,078 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_010.sql` | 11,706 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_011.sql` | 11,812 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_012.sql` | 11,804 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_013.sql` | 11,816 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_014.sql` | 11,820 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_015.sql` | 11,820 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_016.sql` | 11,820 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_017.sql` | 11,813 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_018.sql` | 11,832 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_019.sql` | 11,802 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_020.sql` | 11,844 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_021.sql` | 11,830 B (0.011 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_022.sql` | 35,615 B (0.034 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_023.sql` | 48,339 B (0.046 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_024.sql` | 46,756 B (0.045 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_025.sql` | 23,353 B (0.022 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_026.sql` | 27,548 B (0.026 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_027.sql` | 41,247 B (0.039 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_028.sql` | 41,748 B (0.040 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_029.sql` | 41,319 B (0.039 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_030.sql` | 40,724 B (0.039 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_031.sql` | 40,271 B (0.038 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_032.sql` | 39,918 B (0.038 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_033.sql` | 40,848 B (0.039 MiB) | ignored | PROTECT |
| `backups/d1_import/02_data_034.sql` | 22,573 B (0.022 MiB) | ignored | PROTECT |
| `backups/d1_import/03_indexes_views.sql` | 1,858 B (0.002 MiB) | ignored | PROTECT |
| `backups/d1-backup-before-0006.sql` | 788,199 B (0.752 MiB) | ignored | PROTECT |
| `backups/split_d1_backup.py` | 2,583 B (0.002 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.06a79433-53fa-4518-bbb5-97d961048332.bak` | 3,447,236 B (3.288 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.0ac056f7-3d3e-43bf-bbd9-edda571a2d96.bak` | 3,528,748 B (3.365 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.0c09e68a-a9d1-49bf-880b-2f6bb80cf7ce.bak` | 3,627,635 B (3.460 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.17adfbe6-03cd-4a4f-9ba9-417182f19db9.bak` | 3,596,089 B (3.429 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.1cae3417-3766-4f77-a285-e8db458adb59.bak` | 3,425,666 B (3.267 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.1f6518f9-a0c0-42e0-88a8-50bbb2c48deb.bak` | 3,575,806 B (3.410 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.1f678d15-0cc8-43a7-ba41-1afee6b16569.bak` | 3,588,443 B (3.422 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.2b8f7160-a75d-4d3a-af06-65db88a9776b.bak` | 3,511,410 B (3.349 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.2d3bdf72-3539-42c7-96e8-faaed004173e.bak` | 3,532,112 B (3.368 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.2da787e7-99a6-4f8e-954e-f386acd8ab39.bak` | 3,507,887 B (3.345 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.3042cbeb-a9d0-493f-a8f4-f16dfe6233bc.bak` | 3,561,501 B (3.397 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.31f6d7de-4ab2-4795-ae28-1deccc6e5df8.bak` | 3,453,157 B (3.293 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.39fa13fb-cc9f-4ba8-8396-5f382807ab32.bak` | 3,504,020 B (3.342 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.3d3f099e-df12-4077-868f-fdaf78f12376.bak` | 3,623,991 B (3.456 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.41d3e0fb-ff87-47b9-8897-ed2a91bb21dd.bak` | 3,497,125 B (3.335 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.49d6cceb-080d-4529-86f5-d5d4979eb15b.bak` | 3,620,691 B (3.453 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.49ee6472-54fc-42c0-a8ac-af39108a8c54.bak` | 3,572,735 B (3.407 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.5a8cd79d-a29a-4b7c-ad36-d3917675bc6a.bak` | 3,564,461 B (3.399 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.63a45f97-9cfd-4f79-aebf-6018d59dd85a.bak` | 3,511,410 B (3.349 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.703421ee-8692-4e62-b6e1-f14e60298f07.bak` | 3,610,748 B (3.443 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.73bd9550-5343-451a-a720-315c7e7d0957.bak` | 3,450,062 B (3.290 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.777c35ae-bbf7-40e7-a697-73811e839d2c.bak` | 3,614,725 B (3.447 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.79e8f830-a97e-4eb7-b934-67bf4dceb19f.bak` | 3,459,502 B (3.299 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.7ea901e6-e487-4894-bf33-05ae1edf7079.bak` | 3,568,601 B (3.403 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.83808dbd-ed03-45e6-837f-5c2d04b72111.bak` | 3,456,330 B (3.296 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.87d5a73a-49e3-45f7-9247-c66f504ecaf4.bak` | 3,493,946 B (3.332 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.9458c9f5-50ad-448f-8a10-51bda8a2743d.bak` | 3,536,260 B (3.372 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.9979578c-6810-40a1-a3c3-d24347358028.bak` | 3,439,832 B (3.280 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.a5919efd-7c6c-413d-b470-1f6d25a91430.bak` | 3,470,196 B (3.309 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.a72f2705-43a8-4e22-8652-d8c5ceaceb7c.bak` | 3,525,332 B (3.362 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.a7814e2d-6206-42f2-8cd4-28d7bc7c36df.bak` | 3,437,034 B (3.278 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.abfa0d62-dd6f-4097-9af5-e1b7337c40fb.bak` | 3,519,859 B (3.357 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.adbac66d-fd72-4632-80fc-3c260f80fe1a.bak` | 3,483,522 B (3.322 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.b2229f6c-1ad0-4f0a-baea-bfb9c1a29f7e.bak` | 3,444,261 B (3.285 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.b6c5b925-9c70-423c-9f17-a970406f62f3.bak` | 3,474,269 B (3.313 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.b7e91dc7-8634-4518-a81c-ae3f016a759a.bak` | 3,490,060 B (3.328 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.b88f52b5-d893-454c-ba75-02af82d59d25.bak` | 3,432,960 B (3.274 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.b8c7ba41-6701-4b85-b623-29cede7dbf8c.bak` | 3,635,505 B (3.467 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.b8f81f5e-cd2f-40a4-a74b-6f7ce2686ad3.bak` | 3,466,653 B (3.306 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.b9d3ecf3-2e55-46c7-ab3b-f3c8fba40159.bak` | 3,500,920 B (3.339 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.bak` | 4,191,577 B (3.997 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.bf77fa9f-6938-4747-9f1e-7d9cbea9301b.bak` | 3,584,146 B (3.418 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.c27cbc90-d3ee-4742-b149-7f2b67dd10dc.bak` | 3,599,128 B (3.432 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.c5c3af5e-4694-4d23-a3cc-c35c733dfa44.bak` | 3,478,463 B (3.317 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.d03a6a41-8404-4173-aea2-aeab2d4bec58.bak` | 3,605,525 B (3.438 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.d39b09bb-638c-4552-baaf-e7dd96ec799f.bak` | 3,632,486 B (3.464 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.de8c1a05-15c0-472d-8469-a7f7d612d0e3.bak` | 3,540,256 B (3.376 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.dfda20bc-1830-4cd1-a2c3-9d2f9dd99b39.bak` | 3,429,851 B (3.271 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.e6ad2215-8dc6-473d-a350-208ecbe0fc1f.bak` | 3,601,919 B (3.435 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.e96e7abe-b258-4ff6-82bd-e59b263d823b.bak` | 3,486,313 B (3.325 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.e98b082b-916a-48e7-b6e2-4c1177552428.bak` | 4,209,987 B (4.015 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.ea7c3925-90c4-44ee-9a43-fd135c021fbd.bak` | 3,617,563 B (3.450 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.f34bc938-74da-4741-9711-0636a1b2e2a5.bak` | 3,514,524 B (3.352 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.fba92f64-cff9-4ddc-9253-127780d2745c.bak` | 3,593,357 B (3.427 MiB) | ignored | PROTECT |
| `src/data/bgg-cache.json.ffff46f0-b2a4-4bce-af97-df69a74eec92.bak` | 3,579,885 B (3.414 MiB) | ignored | PROTECT |
| `src/middleware.ts.bak` | 1,447 B (0.001 MiB) | ignored | PROTECT |
| `src/pages/api/sleeves/game/[id].ts.bak` | 3,421 B (0.003 MiB) | ignored | PROTECT |
| `src/pages/api/sleeves/games.ts.bak` | 3,045 B (0.003 MiB) | ignored | PROTECT |

### 完全相同的備份（只辨識，不授權去重）

只對備份檔做內容SHA256比對；沒有開啟／查詢SQLite，也沒有對持久化DB做去重。檔案大小相同不當成內容相同。確認以下2組：

- SHA256 `cf22bbd517175870e58bd30bd5f11a311d272a854909949107987f51549d50a0`；每份 5,217 B (0.005 MiB)，重複副本量 5,217 B (0.005 MiB)；**PROTECT**：
  - `.bgg-b2-test-1JZTMi/cache.json.6cce4567-0494-46d7-ac54-522f6045eea7.bak`
  - `.bgg-b2-test-FSA5Oi/cache.json.a300b156-d486-4a0d-b6ad-f2be030b5348.bak`
- SHA256 `7f8b5d2fbc7b196a0419236cc9dd461c014b534a568922d1236fff8777a54268`；每份 3,511,410 B (3.349 MiB)，重複副本量 3,511,410 B (3.349 MiB)；**PROTECT**：
  - `src/data/bgg-cache.json.2b8f7160-a75d-4d3a-af06-65db88a9776b.bak`
  - `src/data/bgg-cache.json.63a45f97-9cfd-4f79-aebf-6018d59dd85a.bak`

合計重複副本量 3,516,627 B (3.354 MiB)，**不是核准可釋放量**；一組是歷史BGG版本，另一組是合成失敗fixture備份。所有55份BGG備份共 195,425,680 B (186.372 MiB)，不能推定因較舊就不再使用。沒有把不同大小的SQL拆分檔當成重複資料。

## 5. 部署後封存清單與前置條件

**ARCHIVE_AFTER_DEPLOY表示可提出「保存副本」的計畫，不表示成功部署後可直接刪原檔。** 程式／測試／部署腳本仍讀取原路徑時，原件仍保留；未退役引用前即使已複製，也不計磁碟空間回收。D-7B尚未正式部署，不能現在執行任何封存。

原分類的8個封存候選（全部目前保留）：

| 路徑 | 大小 | Git | 封存理由／限制 |
| --- | --- | --- | --- |
| `.bgg-b2-test-1JZTMi/cache.json` | 5,217 B (0.005 MiB) | untracked | 已確認的合成失敗殘留；目前excluded manifest／驗證工具仍參照，不可部署前移除 |
| `.bgg-b2-test-FSA5Oi/cache.json` | 5,217 B (0.005 MiB) | untracked | 已確認的合成失敗殘留；目前excluded manifest／驗證工具仍參照，不可部署前移除 |
| `.wrangler/deployment-prep/runbook-command-blocks.json` | 8,652 B (0.008 MiB) | ignored | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 |
| `.wrangler/r5-verification/c1/failure.json` | 151 B (0.000 MiB) | ignored | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 |
| `.wrangler/r5-verification/c2-focused/failure.json` | 151 B (0.000 MiB) | ignored | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 |
| `.wrangler/r5-verification/c3/failure.json` | 151 B (0.000 MiB) | ignored | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 |
| `.wrangler/r6-verification/restore.log` | 2,462 B (0.002 MiB) | ignored | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 |
| `.wrangler/rate-limiter-fix/runbook-blocks.json` | 9,871 B (0.009 MiB) | ignored | 歷史驗證原始輸出，先封存可查證副本；動態引用未退役前保留原檔 |

另外可在部署成功後建立**受保護的Release證據副本**，但以下原件仍按KEEP／PROTECT保留：

- D-7A～R6的28份報告／證據，共1,736,118 B (1.656 MiB)：已列入凍結候選或工具引用，不從Git樹抽走；特別保留高BODY CLS原始樣本、無效instrumentation說明、raw dump FAIL及受控restore PASS，不能只留下成功結果。
- .wrangler/deployment-prep/、r5-verification/、r6-verification/、rate-limiter-fix/中經確認的raw logs與重跑程式／輸入，按**逐檔allowlist**保存其相對目錄結構；多個logs仍由工具動態列舉／雜湊，原件不得移除。不要複製整個.wrangler，尤其不能混入state。
- 現行1732個編譯產物（candidate.artifactFiles）：保留Worker entry/chunks與ASSETS相對路徑、generated config及hash；排除.env／.dev.vars。本機dist/server/.dev.vars屬PROTECT，不進一般Release封存。
- 16個歷史正式metadata共192,264 B (0.183 MiB)：**PROTECT**，只在資料擁有人另行核准後，才可規劃非Git、ACL受限／加密的位置保存副本；本輪不搬移／封存、不將原文寫入新報告或Git。不得把docs/archive或另一個Git專案當作敏感資料封存地。

封存的必要順序：

1. 人工確認正式部署及既定Smoke／D1完整性／Access與Limiter驗證完成，觀察窗口與責任人已同意；觀察多久尚未核准，不自行填天數。
2. 先保存第8節的不可變Release基準；選定外部、非Git且受保護的目的地，核對權限／加密／保留政策；目的地未定就不行動。
3. 對核准逐檔清單建立來源路徑、bytes、SHA256、用途、敏感等級、候選ID、實際Commit／Worker版本與相對引用索引。不重新執行舊generator以「重建」歷史結果。
4. 保存副本後逐檔比對hash並抽查可讀性／重跑recipe所需檔案是否齊全；包含失敗證據，不把不同時間的資料拼成一個PASS。
5. 僅當原路徑讀者已退役／經核准更新、Release基準仍可驗證，才另提**移除原件的獨立人工清單**。本計畫不提供批次刪除命令，也不因封存完成自動同意刪除。

## 6. 必須永久保留／保護的資料

- 全部正式程式、測試、部署腳本與必要文件，尤其仍未提交的新增檔；不能以HEAD恢復涵蓋目前未追蹤內容。
- migrations/0001～0016原檔、順序與hash；0003工作檔／預期LF Blob差異及驗收證據亦保留。禁止刪Migration、重編號或用舊Schema檔當降版。
- src/data/bgg-cache.json：SHA256 `1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`；所有BGG備份在本清理政策下也保護。
- 私人collection cache、collection XML、CSV原始輸入／已產SQL、全部SQL備份與拆分片段；ignored不是備份，更不代表來源可重新取得。
- .wrangler/state與六個d1-*持久化樹，共88,021,384 B (83.944 MiB)。SQLite、WAL、SHM必須視為一致性整體；不清cache／trace子目錄，不做VACUUM/checkpoint等操作，不以test字樣推定可刪。
- .env／.dev.vars及敏感metadata依安全政策保護，不能入Git；本輪不建立或移動憑證副本。
- 正式收藏、永久NotBGG身份／關聯／副本／購買／事件歷史及正式D1/KV/R2/Images等遠端資源全部PROTECT（本機容量不適用）。本輪沒有接觸任何遠端服務。

「永久保留」是不可透過本清理工作丟棄的權威來源／Release紀錄；備份保留期與未來安全去重需要資料擁有人另定政策，不在這裡猜測過期時間。

## 7. 磁碟空間估算

| 情境 | 可釋放量 | 說明 |
| --- | --- | --- |
| 原專案現在可批准清理 | **0 B** | 無合格CLEAN_NOW原檔；.wrangler/tmp為空 |
| 本輪新建衍生清冊 | 約832,316 B (0.794 MiB) | 若人員同意不保留完整盤點，可移除此ignored診斷；不是原專案垃圾節省 |
| 部署後8個封存副本 | 0 B立即回收 | 原件總31,872 B (0.030 MiB)；複製會增加目的地用量，不會釋放來源 |
| 全部REVIEW | 最多4,523,071 B (4.314 MiB)的評估範圍，**未核准可回收** | 主要舊dry-run，不可假定可再生或無rollback用途 |
| 備份重複副本 | 3,516,627 B (3.354 MiB)，**不計回收** | 仍PROTECT；hash相同不是刪除授權 |
| .git／node_modules | 未統計、0 B列入回收 | 不掃描或清除，不以估值膨脹收益 |

以上是檔案Length加總，非NTFS配置大小／壓縮／hardlink／可用空間精確變化。不得把dist約42MiB、BGG備份約186MiB或持久化約84MiB報成「可立即節省」。

## 8. 最終V1.2 Release基準保存清單

D-7B成功後，以下基準必須完整、可核對且有受保護副本；未知值現在標未取得，不假造：

1. 三個實際Git Commit SHA與最後release SHA、完整納入／排除清單及清理前Git狀態。**目前尚無實際V1.2 Commit，HEAD仍是舊基線，不能拿它代替。**
2. source候選ID `41855c8f7ea80de577e5461c1c4eb61b0e030665e948927488685da72b2b211d`、candidate manifest原檔／自身hash、每個clean Blob／Migration hash、package-lock與Node/Astro/Wrangler/Miniflare版本。
3. 最終Worker／ASSETS整套artifact及artifactManifestSha256，source/built config、Worker-first、Limiter12071/30/60、DB/KV/Images binding名稱與必要識別；排除Secret值與本機環境檔。
4. 私人build input的核准hash及受保護來源；若要重建同產物，不可把空example當成相同輸入，也不把私人內容放進公開Release包。
5. 305/F1 210的已驗收基線、本輪限流46項與D5/D6、strict／Astro／build證據，以及必要raw logs、fixture／recipe與工具版本；保持來源到結論的鏈。
6. D-7A～R6歷史更正、0003、0015 retention、SQL dump raw失敗／受控恢復成功、CLS高BODY未解風險及原量測；不得只留最近PASS或CLS=0。
7. 實際D-7B新Worker version ID、部署時間／比例、核准M/W紀錄、回滾版本及相容性判斷、正式Smoke／Binding／安全／監測結果。**V1.2尚未部署，此項未取得。**
8. 受保護的當次D1恢復點、停寫時點、Schema／tracking／核心聚合／FK前後快照、恢復責任／RTO/RPO決策與存放位置索引。書籤值／私人資料不入Git；本輪不建立備份或恢復點。

## 9. 清理後驗證與回復方式（未執行）

任何未來清理先取得**精確路徑與分類的人工核准**，再重驗實際絕對路徑仍在核准範圍，拒絕symlink/junction逃出root。不要用git clean、git reset、整個.wrangler遞迴刪除或副檔名wildcard掃除；目前沒有核准清除既有檔案。

清理前後應核對：

- Git HEAD／Index沒有變，tracked、未追蹤程式及必要文件未消失；不要以ignored清單作刪除allowlist。
- candidate.reviewFiles每個SHA256／clean Blob仍匹配，canonical BGG及16個Migration hash不變；16 metadata與2暫存的既有排除角色仍一致。
- artifactFiles及dist相對引用仍完整，generated deploy config／types與必要runner輸入不缺；本計畫目前全部保留。
- .wrangler/state及所有d1-*樹未觸及、沒有SQL執行；對活躍DB不能拿mtime或hash變動當作一致性驗證，先確認生命週期及責任人。
- 目的地封存index／hash／存取權限可讀，不把敏感SQL、metadata或環境檔納入Git；觀察與回滾材料未遺失。

回復原則：

- 只有本輪衍生盤點清冊被核准清理時，可重新盤點產生；新時間點數字不保證與舊snapshot逐byte相同，重要摘要已保存在本文件。
- 可再生的types／build若誤刪，先確認原候選artifact已保護，再用鎖定依賴、正確私人輸入與既定Wrangler types／Astro流程重建、驗證hash；重建不保證替代已凍結原件，不在此次盤點中執行。
- 程式或必要文件只能從相符的核准Commit／完整候選受保護快照回復；目前大量untracked內容不在HEAD，不能盲目git restore/reset。
- 持久化／私人輸入／SQL備份若受損，停止寫入並交資料責任人，使用已驗證的一致性備份；不能混搭不同時點SQLite/WAL/SHM，不能假定Migration重播能還原資料。無已驗證回復來源時不動PROTECT項。

## 10. 本輪交付狀態

所有2338個掃描檔案均已分類；新建清冊為ignored衍生診斷、本文件為KEEP未追蹤計畫。原有程式、資料、metadata、候選與artifact均保持原位。沒有刪除、搬移、封存、Git操作、build／測試重跑、正式部署、D1查詢或修改。完成後停止，等待人工確認；本文件不授權清理或改變D-7B核准門檻。

盤點後唯讀保全核對：280個候選review項（manifest自身明確不自我雜湊）、1732個編譯產物、18個排除原件均符合既有hash；Git HEAD未變、cached diff仍空。新增清理計畫為未追蹤文件，未更新候選manifest，原候選source ID保持不變。
