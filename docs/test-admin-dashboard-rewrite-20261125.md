# 過時測試 `tests/admin-dashboard.test.ts` 處理｜規劃（2026-11-25 已採納，DECISION_LOG TEST-R01-Q59）

## 1. 現況（2026-11-25）

- 檔案自專案基準 `2ba52c5` 起未修改，共 128 行、1 個測試含 8 個子測試；目前 **8／9 失敗**（父測試＋7 個子測試）。
- 失敗原因：子測試斷言的是階段 3（`07d39ff`，2026-11-24）改版前的舊 R01（「九個統計數字」「封存提示」「4 張卡片＋1 個停用按鈕」等）。階段 3 改寫 R01 時此檔未列入驗證清單，因此一直未被發現（#27 審查時發現，見 [卡套不足規劃 §8.1](sleeve-shortage-plan-20261125.md)）。
- 現行 R01 的數字與區塊隔離已由 `tests/admin-dashboard-summary.test.ts`（8 個測試）與 `tests/admin-dashboard-browser.mjs`（7 項）涵蓋。
- 此檔仍有**別處沒有的覆蓋**：
  1. 以真實 Astro 頁面＋Access JWT 驗證 `/admin` 與其管理連結：無 token 401、錯誤金鑰 401、他人帳號 403、過期 401（JWT 拒絕在 `notbgg-*` 測試有涵蓋，但不是針對 R01 頁）。
  2. 以「遷移到一半、真的缺少資料表」的 D1 重現讀取錯誤，確認頁面仍回 200、其餘卡片可用（`admin-dashboard-summary.test.ts` 是以模擬失敗驗證，不是真實缺表）。

## 2. 決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q59 | 怎麼處理此檔 | **改寫**：保留檔案與上述兩項獨有覆蓋，改為針對現行 R01；刪除只驗舊版統計與版面的斷言（數字正確性留給 summary 測試） | **退役**：刪除整個檔案 | **A**：保留真實頁面＋JWT 與真實缺表兩個情境 |

## 3. 工作命令（2026-11-25 已授權，DECISION_LOG TEST-R01-AUTH）

```text
工作命令 ID：TEST-R01-20261125-01
工作目標：改寫 tests/admin-dashboard.test.ts，讓它針對階段 3 之後的現行 R01，並全數通過。只改這一個測試檔，不改任何 src。

必須保留／改寫的情境：
  1. 真實頁面與 Access：帶有效 JWT 時 /admin（中、英）回 200 且含現行 R01 主要區塊（頁首、快捷操作、收藏與資料概況、待處理項目）；
     /admin 無 token 401（或現行實際行為，以 middleware 為準並在註解說明）、錯誤金鑰 401、他人帳號 403、過期 401；
     R01 上的管理連結（例如 /admin/collection、/admin/sleeves、/admin/purchases、/admin/bgg）帶 JWT 可開啟（200 且含 <main>）。
  2. 真實缺表：遷移到 0013 為止（缺少 notbgg_games 等表）時，/admin（中、英）仍回 200，受影響區塊顯示「無法取得」或「—」，
     其他區塊與快捷操作可用；不得以模擬取代真實缺表。
  3. 刪除：只驗舊版「九個統計」「封存提示」「卡片數與停用按鈕數」等已不存在的斷言。現行數字正確性不在此檔重複（由 admin-dashboard-summary.test.ts 負責）。

允許修改：tests/admin-dashboard.test.ts（可整檔改寫）；必要時 tests/helpers/admin-dashboard-preview.ts（只增，不改既有行為）。
禁止：改 src、其他測試、migrations、wrangler.json、package.json；刪除檔案；連網、遠端 Wrangler、建置、部署、git commit／push；
  建立或移除 git worktree、以連結共用 node_modules；讀 .env／.dev.vars／備份。

驗證：
  1. node --import tsx --test tests/admin-dashboard.test.ts tests/admin-dashboard-summary.test.ts tests/admin-shell.test.ts（須全數通過）
  2. npm run astro -- check（基準 10 個錯誤）、git diff --check
完成後在 HANDOFF.md 末尾追加一條 2026-11-25（Asia/Taipei）條目，並回報保留與刪除的子測試清單、驗證數字。
部署：只改測試，不影響正式環境；提交與推送另依使用者指示（推送 main 即觸發部署，依 DEPLOY-01 授權）。
```

## 4. 審查（2026-11-25）：通過

- **範圍**：只改 `tests/admin-dashboard.test.ts`（整檔改寫）與 HANDOFF.md 追加；未改 src、其他測試、preview helper；未刪檔。
- **保留並改寫**：(1) 真實 Astro 頁面＋Access JWT：中英 R01 主區塊與五個快捷連結、NotBGG 頁與管理 API 讀取；(2) 遷移到 0013 的真實缺表：中英 R01 回 200，受影響區塊「無法取得」，收藏、組件與快捷操作可用。**移除**：九項統計、封存提示、固定卡片與停用按鈕數、配合舊版面的預購／BGG 連結／大量封存數值案例（數字正確性由 `admin-dashboard-summary.test.ts` 負責）。
- **觀察（現行行為，未改 src）**：`/admin` 對無 token、錯誤金鑰、他人帳號、過期 token **一律回 403**；管理子路由（如 `/admin/collection`）則區分 401（無 token、錯誤金鑰、過期）與 403（他人帳號）。兩者都拒絕存取，安全上無影響，但狀態碼不一致；`src/middleware.ts` 屬高敏感區，是否統一需另案提出。正式環境由 Cloudflare Access 在前端先攔截（未登入 302 至登入頁），使用者不會看到此差異。
- **Claude 重跑**：Node 3 檔 **17／17**；`astro check` **6 個錯誤**、0 警告；`git diff --check` 通過。
- **型別檢查基準更新**：舊測試檔貢獻 4 個隱含 `any` 錯誤，改寫後消除，`astro check` 基準由 **10 個降為 6 個**（其餘為既有錯誤）。之後工作命令的基準改用 6。
