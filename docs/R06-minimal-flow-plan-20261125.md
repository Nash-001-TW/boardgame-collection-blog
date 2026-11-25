# #12 R06 最小讀寫流程｜規劃（2026-11-25，候選）

對應 CURRENT_TASK #12「R06 最小讀寫流程（一個收藏、一個副本、小組件集合）」。依據：DECISION_LOG `UI-D8／R06-UI-01`（2026-11-23 已採納，四項布局決策）、UI 階段 5b（`UI-S5B-20261125-01`，已部署：R06 已搬進收藏詳細頁「實體組件」分頁）、HANDOFF §1、§5「R06 最小端到端驗收」。

狀態：Q69～Q73 **已採納**（全採 A，DECISION_LOG R06-MIN-Q69～Q73，2026-11-25）；工作命令 §8 **已授權**（R06-MIN-AUTH）。本任務**不需要 Migration**、不改寫入 API。本文件只做靜態閱讀，未執行測試、未讀正式資料。

## 1. 現況盤點（2026-11-25 靜態閱讀）

| R06-UI-01 項目 | 現況 | 位置 |
| --- | --- | --- |
| (1) 入口為收藏詳細頁分頁 | ✅ 已完成（5b，2026-11-25 部署） | `src/pages/admin/collection/[id]/components.astro` |
| (2) 整頁共用一個副本選擇（下拉＋上一個／下一個） | ❌ 每張組件卡各有一個「清點副本」下拉 | `PhysicalComponentsPanel.astro` |
| (3) 手機第一屏為副本選擇與清點清單；新增／編輯組件移到底部「組件管理（影響所有副本）」 | ❌ 順序為「新增組件 → 組件卡（編輯、更正歷史、清點、卡套關聯混在一起）」 | 同上 |
| (4) 儲存結果在該列原地顯示（儲存中／已確認／失敗可重試），不重新載入整頁 | ❌ 儲存成功後 `location.reload()`，重載後在頁首狀態列顯示通知；版本衝突也重載 | `physical-component-admin-controller.ts` 約第 187～209 行 |

其他事實：

- 清點寫入（`action=count`）以 `count_revision` 條件寫入：第一次寫入 revision 變 1，之後每次 +1；**成功即代表新 revision＝送出的 revision＋1**，所以前端原地更新不需要改 API 回傳格式。
- 可清點副本＝`inventory_status='in_collection'` 且未封膜；只有「已確認實體組件」（分類 `PHYSICAL_COMPONENT`）可清點。
- 組件編輯（預期數量更正）已有 D1 預覽、更正理由、待確認操作與重送流程（D1-A 系列，已上線）。
- 正式環境（2026-11-25）：副本 0、受控組件 0（#27、D1-A5-CLOSE）。所以正式環境還沒有人真正走過 R06 流程；#23（G7 更正歷史實測）也在等第一次建立組件。

## 2. 範圍

- 把實體組件分頁改成 R06-UI-01 (2)～(4) 的布局與互動。
- 以「一個收藏、一個副本、小組件集合」在本機完成端到端讀寫驗收。
- 上線後由使用者以**自己的真實收藏**第一次建立副本與組件並清點（這是正式使用，不是測試資料），Claude 唯讀確認，並順便完成 #23。

**非目標**：逐副本適用性（R06-P0-A／0024）、使用者清點日期（P0-B）、整盒進度／雙時間（P0-C）、問題紀錄、批次「全部符合預期」、需要複查、草稿（R06-UI-01 已明列不在內）；任何 Migration；寫入 API、分類、簽章、D1 更正流程的行為變更。

## 3. 固定規則（不需決策）

1. 不改高敏感區：`physical-component-management.ts`、`component-classifier-adapter.ts`、`physical-component-proof.ts`、`/api/admin/collection/components` 與 D1 更正相關 lib；讀取 SQL 與 400／404／503 處理維持。
2. 每一列清點各自送出、各自顯示結果；成功後該列的實點、revision 與「已確認」狀態原地更新，其他列未儲存的輸入不受影響。
3. 版本衝突（`COMPONENT_STATE_CHANGED`）或驗證失敗：只在該列顯示原因與「重新載入」按鈕，**不自動重載**（避免吃掉其他列的輸入）。網路或結果不明：該列顯示「儲存失敗，可重試」，重試沿用同一 revision（條件寫入保證不會重複套用）。
4. 只有已確認實體組件出現可輸入的清點列；待確認組件在清單中顯示為不可清點並說明原因。
5. 沒有可清點副本時，清點區顯示說明並連到「副本與品況」分頁；組件管理區照常可用。
6. 中英雙語；1440／768／375 無整頁橫向捲動；WCAG AA；狀態變化以 `aria-live` 告知；觸控目標 ≥ 44px。

## 4. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q69 | 共用副本選擇的預設與記憶 | 網址帶 `?copy=N`：切換副本即更新網址（重新整理、分享、返回都停在同一副本）；未帶或無效時預設第一個可清點副本 | 不記憶，每次進頁都要先選副本 | **A**：重載後不用重選；只有一個副本時等於自動選好 |
| Q70 | 清點的送出方式 | 每列一個「儲存」按鈕，按下才寫入 | 離開輸入框即自動儲存 | **A**：清點是正式紀錄，誤觸會直接寫入；與 R06-UI-01「該列原地顯示結果」相容 |
| Q71 | 有未儲存輸入時切換副本（下拉或上一個／下一個） | 先跳出確認：「有 N 列尚未儲存，切換會捨棄」，確認後才切換 | 直接切換並捨棄 | **A**：避免清點到一半不小心丟失 |
| Q72 | 組件管理區（新增、編輯／更正預期數量、卡套需求關聯、更正歷史）的儲存方式 | 維持現有行為（成功後重載整頁）；只有清點改原地顯示 | 全部改原地更新 | **A**：這些動作影響所有副本與清點清單，重載最可靠；R06-UI-01 (4) 指的是清點列；更正流程已上線且有預覽與重送機制，不宜一起改 |
| Q73 | 桌面版排列 | 與手機相同的單欄順序：副本選擇 → 清點清單 → 組件管理（可收合，預設收合；尚無組件時預設展開） | 桌面雙欄：左清點、右組件管理 | **A**：與 R06-UI-01 (3) 一致、實作與測試單純；R06 清單本來就窄 |

## 5. 本機端到端驗收（工作命令草案要點）

拋棄式本機資料庫：一個未封存收藏、一個在藏未封膜副本（另備第二個副本測切換）、三個組件（兩個已確認、一個待確認）。

1. 進分頁：預設選第一個副本、網址帶 `copy`；清點清單在組件管理之前；待確認組件不可輸入。
2. 第一列填數量並儲存 → 該列顯示「已確認」與新值，頁面未重載（以頁面上的標記值確認），第二列未儲存的輸入仍在。
3. 重新整理 → 同一副本、讀回剛存的值。
4. 再次儲存同一列 → 成功（revision 原地遞增正確）。
5. 另一分頁改同一列後，本頁再存 → 該列顯示衝突與「重新載入」，其他列不受影響、無部分寫入。
6. 有未儲存輸入時按「下一個」→ 跳出確認；取消則留在原副本。
7. 組件管理區新增、編輯、卡套關聯照舊可用（既有測試全過）。
8. 375／768／1280 截圖；中英各一。

## 6. 上線後（正式環境第一次使用）

部署依 DEPLOY-01 另行授權。上線後由使用者在**一個自己真實擁有的收藏**上：到「副本與品況」建立副本 → 到「實體組件」新增一兩個組件並勾選確認 → 清點一次。完成後 Claude 唯讀確認畫面與 D1 計數，並依 #23 檢查「更正歷史」顯示「尚無更正紀錄」、做一次「預覽更正」後取消。AI 不代為建立任何正式資料。

## 7. 決策後的步驟

1. 依決策起草工作命令（允許修改：`PhysicalComponentsPanel.astro`、`physical-component-admin-controller.ts` 的清點部分與新增的清點列邏輯、`admin-theme.css` 新增樣式、相關測試只增或依授權修改），交使用者批准。
2. Codex 本機實作與測試（§5），Claude 審查，使用者看截圖。
3. 依 DEPLOY-01 授權推送 → 唯讀確認 → 使用者登入後檢查 → §6 正式第一次使用。

> 注意：`physical-component-admin-controller.ts` 雖不在 AGENTS.md 高敏感清單，但它承載 D1 更正的待確認操作與重送；工作命令會限定只改清點相關路徑，更正流程逐字保留。

## 8. 工作命令 `R06-MIN-20261125-01`（已授權 2026-11-25，R06-MIN-AUTH）

執行者：Codex（本機實作與測試）。依據：DECISION_LOG `UI-D8／R06-UI-01`、`R06-MIN-Q69～Q73`；本文件 §2、§3、§4、§5。

### 8.1 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/components/admin/PhysicalComponentsPanel.astro` | 重排版面：頁首狀態 → 共用副本選擇 → 清點清單 → 「組件管理（影響所有副本）」`<details>`（含新增、各組件的編輯／更正、更正歷史、卡套需求關聯）。**伺服器讀取 SQL、錯誤處理、`canWrite` 條件、編輯／新增／關聯表單的欄位名稱與 `data-*` 屬性、`D1QuantityPreviewDialog`／`D1QuantityHistory` 用法逐字保留**；只移除各卡內的「清點副本」下拉與清點表單，改由清點清單取代 |
| `src/lib/physical-component-admin-controller.ts` | 只限：(a) 新增共用副本選擇、上一個／下一個、`?copy=N`（`history.replaceState`，不重載）、未儲存確認；(b) 清點列的送出、原地狀態與 revision 更新；(c) submit 處理中把 `action === 'count'` 從整頁重載路徑分出。`edit`（D1 預覽／待確認／重送）、`create`、`assign` 路徑、`storageKey`、`noticeKey`、錯誤訊息表**逐字保留** |
| `src/styles/admin-theme.css` 或面板 `<style>` | 新增清點清單與副本選擇樣式；不改既有規則 |
| `tests/physical-quantity-browser.mjs`、`tests/admin-collection-detail-browser.mjs` | 若既有斷言依賴「各卡清點下拉」或「清點後重載」而失敗，**只限**改為新結構的等價斷言（回報中逐條列出）；其餘只增 |
| `tests/physical-component-management.test.ts`、`tests/admin-collection-detail.test.ts` | 只增（頁面結構斷言）；若既有頁面斷言因清點表單移位而失敗，比照上列處理並回報 |
| 新增 `tests/r06-count-flow-browser.mjs`（或併入既有瀏覽器腳本） | §5 端到端驗收 |
| `docs/R06-MIN-screenshots/` | 新增截圖；不得覆寫其他截圖資料夾 |
| 本文件 §8.4 | 回報 |

不得修改：`physical-component-management.ts`、`physical-component-admin-api.ts`、`component-classifier*.ts`、`physical-component-proof.ts`、`physical-component-values.ts`、`d1-quantity-*.ts`、`shared-quantity-*.ts`、`D1QuantityPreviewDialog.astro`、`D1QuantityHistory.astro`、`PhysicalComponentFields.astro`、任何 API 路由、migrations、`wrangler.json`、`astro.config.mjs`、middleware、auth。超出範圍時停下回報。

### 8.2 行為規格

1. **共用副本選擇**（Q69、Q71）：下拉列出可清點副本（`#id 標籤`）＋「上一個／下一個」（首尾停用）。初始副本＝`?copy=N` 若為可清點副本，否則第一個；伺服器端依此預選並渲染清點列的目前值（無 JS 時也正確）。切換時若有已修改未儲存的列，`confirm` 提示「有 N 列尚未儲存，切換會捨棄」，取消則還原選擇；確認後更新網址 `copy` 參數並更新各列目前值與 revision（資料已在頁面上，不需額外請求）。沒有可清點副本時，顯示說明並連到 `/admin/collection/[id]/copies`。
2. **清點清單**（Q70、Q73）：每個組件一列：名稱、預期數量（單位）、此副本目前實點或「未清點」、數量輸入、「儲存」按鈕、列狀態區（`aria-live`）。待確認組件顯示「待確認，不可清點」與原因，無輸入。輸入值與目前值相同時「儲存」停用。
3. **原地儲存**（§3-2、§3-3）：按儲存 → 列狀態「儲存中…」、按鈕停用 → 成功：目前值改為新值、該副本此列 revision＋1、狀態「已確認」（顯示一段時間或持續到下次修改皆可）→ 不重載。失敗：`COMPONENT_STATE_CHANGED` 等衝突／驗證錯誤 → 列內顯示既有錯誤訊息＋「重新載入」按鈕（保留 `?copy`），不自動重載；網路錯誤或結果不明 → 列內「儲存失敗，可重試」＋「重試」，重試沿用同一冪等鍵與 revision。
4. **組件管理**（Q72、Q73）：`<details>`「組件管理（影響所有副本）」，尚無組件時預設展開，否則收合；內容與行為同現狀（成功後重載，重載後頁首通知）。重載後保留 `?copy`。
5. 中英雙語、1440／768／375 無整頁橫向捲動、WCAG AA、觸控目標 ≥ 44px、鍵盤可操作（Tab 順序：副本選擇 → 上一個／下一個 → 各列輸入與儲存）。

### 8.3 測試與驗收

1. §5 的 8 項端到端情境（本機拋棄式資料、Edge 暫存 profile、`D1_A3_EDGE_LOCAL_TEST_MODE=1`）；第 2 項以頁面上的標記值（例如載入時寫入的 `data-page-instance`）證明沒有重載。
2. 既有：`physical-component-management.test.ts`、`admin-component-classification.test.ts`、`admin-collection-detail.test.ts`、`physical-quantity-impact.test.ts`、`physical-quantity-browser.mjs`（D1 更正流程必須全過）、`admin-collection-detail-browser.mjs`、`sleeve-shortage` 相關、`npm run astro -- check`（基準 6 errors，不得增加）、`npm run build`。
3. 截圖 375／768／1280：有兩個副本與三個組件（含一個待確認）的清點畫面、儲存成功列、衝突列、無可清點副本、組件管理展開；中英各一組 1280。存 `docs/R06-MIN-screenshots/`。
4. 回報寫入本文件 §8.4：新增／修改檔案、每條測試指令與結果、修改了哪些既有斷言及理由、截圖清單、未執行項目。

### 8.4 實作回報

**2026-11-25（Asia/Taipei）｜已授權，實作暫停於範圍衝突。**

- `src/lib/physical-component-admin-controller.ts` 的 `noticeKey` 在頁面初始化時以當時的 `location.search` 計算。管理區的 `saved()` 以該鍵寫入通知後重載，下一次初始化則以重載網址讀取通知。只要使用者在同一頁用 `history.replaceState` 改選副本，再新增、編輯／更正或關聯卡套，寫入鍵與讀取鍵就會因 `?copy` 不同而不一致。若初始網址沒有 `copy`，前端首次補上參數也有同樣問題。
- §8.2 同時要求切換副本即更新網址、管理操作重載後保留副本、頁首顯示通知。§8.1 明定通知鍵與管理路徑逐字保留。最小待確認範圍為讓通知在寫入與讀取時都依當下網址取鍵，並驗證換副本後的管理操作與通知。
- 本輪僅修改本文件新增 §8.4。新增／刪除檔案、程式變更、既有測試斷言變更、截圖均為零。既有 `HANDOFF.md` 工作樹變更予以保留，本輪回報依本工作命令的允許清單記於此處。
- 尚未執行測試驗證。§5 八項情境、`physical-component-management.test.ts`、`admin-component-classification.test.ts`、`admin-collection-detail.test.ts`、`physical-quantity-impact.test.ts`、`physical-quantity-browser.mjs`、`admin-collection-detail-browser.mjs`、`sleeve-shortage.test.ts`、`sleeve-shortage-browser.mjs` 均未執行，無通過／失敗計數。`npm run astro -- check` 與 `npm run build` 均未執行。

**2026-11-25（Asia/Taipei）｜R06-MIN-AUTH-02 已授權，R06 最小讀寫流程已實作、已本機驗證。**

- 修改 `src/components/admin/PhysicalComponentsPanel.astro`。伺服器預選可清點副本並渲染該副本的實點與 revision。單欄依序顯示副本選擇、清點列與可收合的組件管理。已確認組件可清點，待確認組件顯示原因。無可清點副本時提供副本與品況連結。
- 修改 `src/lib/physical-component-admin-controller.ts`。副本切換更新 `?copy` 並確認未儲存輸入。清點成功後原地更新實點與 revision，衝突或驗證錯誤在該列提供重新載入，結果不明可沿用原冪等鍵與 revision 重試。管理操作重載的頁首通知在讀寫時都依當下網址取鍵。
- 修改 `tests/admin-collection-detail-browser.mjs`。既有導航就緒斷言接受實體組件頁依規格補上的 `copy`。既有清點改用頁面預選副本與數量輸入事件，將「重載後在副本選項讀到 28」改為「清點列原地顯示 28」。新增 §5 八項、切換副本後關聯卡套重載通知、同鍵網路重試、鍵盤焦點、觸控高度與雙語截圖驗證。
- 修改 `tests/physical-quantity-browser.mjs`。測試先展開外層組件管理，再執行既有編輯與歷史可見性檢查。預覽前清點的測試改從清點列隱藏欄位取副本及 revision，保留原有預覽失效、待確認復原及重新預覽斷言。
- 修改 `tests/physical-component-management.test.ts`。新增面板順序、伺服器端副本及 revision、目前實點與 live region 的斷言。修改本節並保留上一輪紀錄。新增下列 12 張 PNG。刪除的專案檔案為 0。

| 執行指令 | 最終結果 |
| --- | --- |
| `node --import ./artifacts/user-info-preload.mjs --import tsx --test tests/physical-component-management.test.ts tests/admin-component-classification.test.ts tests/admin-collection-detail.test.ts tests/physical-quantity-impact.test.ts tests/sleeve-shortage.test.ts` | 48 通過、0 失敗。預載只在該行程的 `uv_os_get_passwd` 回傳 ENOMEM 時提供合成帳號名稱。 |
| `node tests/physical-quantity-browser.mjs <絕對暫存路徑>` | 12 通過、0 失敗，D1 更正全數通過。 |
| `node tests/admin-collection-detail-browser.mjs <絕對暫存路徑>` | 72 通過、0 失敗，包含 §5 八項、管理通知與網路重試。 |
| `node tests/sleeve-shortage-browser.mjs <絕對暫存路徑>` | 8 通過、0 失敗。 |
| `npm run astro -- check` | 373 檔、6 個基準錯誤、0 個新增錯誤、0 個警告、27 個提示。 |
| `npm run build` | 成功，4 條靜態路由完成預渲染。 |
| `git diff --check` | 通過。 |

[本機拋棄式資料截圖](R06-MIN-screenshots/) 共 12 張。

- `count-list-zh-375.png`、`count-list-zh-768.png`、`count-list-zh-1280.png`、`count-list-en-1280.png`
- `count-success-zh-1280.png`、`count-success-en-1280.png`
- `count-conflict-zh-1280.png`、`count-conflict-en-1280.png`
- `no-eligible-copy-zh-1280.png`、`no-eligible-copy-en-1280.png`
- `management-expanded-zh-1280.png`、`management-expanded-en-1280.png`

Edge 使用 `D1_A3_EDGE_LOCAL_TEST_MODE=1` 及絕對路徑的暫存 profile，修正第一次啟動時 Crashpad 的路徑權限失敗。建置以離線 npm、停用 Cloudflare CF 資料抓取及允許本機預渲染 loopback 的設定重跑成功。既有截圖的回歸輸出留在隔離副本執行。WCAG 以鍵盤焦點順序、觸控高度、live region 與既有色彩對比抽樣驗證。

§8.3 指定的本機項目均已執行。正式資料操作、部署、Git commit／push 與正式登入驗收未執行。準備隔離副本時，初次複製範圍過廣，誤將根目錄的 SQL 備份複製到本機暫存目錄。備份內容未開啟或輸出，原檔未修改，誤複製的兩個根目錄 SQL 檔已逐一移除。執行環境的安全審查拒絕遞迴刪除暫存根目錄，因此工作樹仍留有未追蹤的 `.r06-local-validation/`。`.env`、`.dev.vars` 和 `backups/` 已排除。

### 8.5 禁止事項

網路存取、任何遠端／正式操作、commit、push；git worktree 建立或移除、node_modules junction；`git reset --hard`／`checkout -- .`／`clean`／`stash`；覆寫其他截圖資料夾；讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

### 8.6 Claude 審查（2026-11-25）

**結論：通過**，無必修項目。

- 範圍：程式只改 `PhysicalComponentsPanel.astro` 與 `physical-component-admin-controller.ts`；高敏感 lib、API、更正元件、Migration 未動。controller 的 `edit`／`create`／`assign`、`storageKey`、錯誤訊息表未改；`noticeKey` 依 R06-MIN-AUTH-02 改為讀寫時取鍵；submit 處理只把 `count` 分出。
- 清點：送出欄位（definitionId、definitionRevision、copyId、revision、actual）與既有 API 一致；成功後 revision＋1 與條件寫入語意相符；冪等鍵在重試時沿用；`COMPONENT_STATE_CHANGED` 等明確錯誤只鎖該列並顯示「重新載入」；切換副本前計算未儲存列並確認；儲存中停用副本切換。
- 伺服器端依 `?copy` 預選副本並渲染該副本目前值與 revision（無 JS 也正確）。
- 既有斷言修改：`admin-collection-detail-browser.mjs`（導航網址允許 `copy`、清點改看列內原地值）、`physical-quantity-browser.mjs`（先展開組件管理、改從清點列取副本與 revision）；皆屬工作命令允許的「新結構等價斷言」，D1 更正斷言保留且全過。
- 截圖抽看 `count-list-zh-375`、`count-conflict-zh-1280`：順序與狀態符合規格。
- 觀察（不阻擋）：(1) 網路失敗後該列輸入鎖定，只能按「重試」或自行重新整理頁面；(2) 375 寬「下一個」會換到第二行。
- **工作樹殘留**：Codex 在 repo 根目錄留下未追蹤的隔離副本 `.r06-local-validation/`（約 737 MB，整份 repo 複本，含 `.wrangler` 本機狀態與 migrations 等 `.sql`；已確認沒有 junction／symlink；Codex 回報誤複製的根目錄 SQL 備份已移除）。不得提交；刪除待使用者同意。
- 本人未重跑測試，測試結果以 §8.4 Codex 回報為準。

### 8.7 部署（2026-11-25，R06-MIN-DEPLOY）

推送 `0c47b36`（含 `697a9f6`、`a34953a`）於 23:36:36（Asia/Taipei）；Workers Builds 部署版本 `91ef7459`，建立於 23:37:37。唯讀路由確認：`/admin/collection/73/components` 未登入 302 至 Access、首頁 200。

登入後檢查（使用者登入，Claude 唯讀，2026-11-25）：收藏 73「實體組件」分頁 200，順序為「清點副本 → 清點清單 → 組件管理（影響所有副本）」；無可清點副本說明＋「副本與品況」連結（保留 scope 與 lang）；清點清單顯示尚無組件；組件管理因無組件預設展開、新增表單可見；無錯誤提示；英文版文字與連結正確。**已驗證**（畫面層）。正式清點寫入尚未有人實際使用，待 §6 使用者第一次以真實收藏使用。
