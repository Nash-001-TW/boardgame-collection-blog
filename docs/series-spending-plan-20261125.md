# #29 同一系列遊戲的花費合計｜規劃（2026-11-25，候選）

對應 CURRENT_TASK #29（使用者 2026-11-24 提出：禮包不拆金額、擴充另購時，想知道某套遊戲含擴充與周邊共花多少）。相關：R10 採購成本（DECISION_LOG UI-S3-R10-01～03）、R01 成本口徑（只計採購分攤，不含歷史價格與維修費）、#27 卡套不足、#28 贈送卡套（皆已上線）、UI 階段 5 收藏詳細頁「相關採購」分頁（Q51，已上線）。

狀態：Q64～Q68 **已採納**（全採 A，DECISION_LOG SERIES-Q64～Q68，2026-11-25）；正式 D1 唯讀計數已執行（§7）；工作命令 §8 **已授權**（SERIES-AUTH）。本任務只讀計算，**不需要 Migration**。§1～§6 為靜態閱讀；未執行任何測試。

## 1. 現況盤點（2026-11-25 靜態閱讀）

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| 收藏層級關聯 | `v2_collection_relations`：`requires_base`、`expansion_of`、`standalone_related`、`same_series`、`integrates_with`、`bundle_contains`（禮包包含哪些收藏，來源須為 bundle 類型）、`accessory_for`、`other`；有 `archived_at`。由「管理收藏組合關係」維護 | migrations 0007、0022；`src/lib/relation-admin.ts` |
| 遊戲層級關聯 | `v2_game_relations`（BGG 擴充／需要本體等，`relation_source` bgg／manual／import，有 `admin_confirmed`、`archived_at`）；`bgg_game_relations`（BGG 原始）；`site_game_relations`（NotBGG 配件 `accessory_for`／`compatible_with`） | 0001、0007、0014、0015、0022 |
| 採購成本 | `v2_purchase_allocations` 把訂單金額分攤到**收藏或副本**（擇一）；R01／R10 只計已付款、部分收貨、完成訂單的分攤，依幣別、不換算 | 0008；`purchase-admin.ts` |
| 禮包 | 正式環境有 32 筆類型為「組合」（bundle）的收藏（如大全套、禮包，見 UI 階段 4 驗收）；禮包可以整筆分攤到禮包收藏，也可在採購時拆分攤到各成員收藏 | — |
| 其他費用 | `v2_cost_adjustments`（維修、替換、客製等，掛在副本）；R01 口徑**不計** | 0008 |
| 卡套 | 購買交易有價格欄但不連收藏；套用（USE）連到副本但沒有單價；#28 贈送價格為 0、可連收藏 | 0011、0025 |
| 呈現位置 | 收藏詳細頁「相關採購」分頁：此收藏的已記錄成本、相關訂單、隨貨附贈的卡套 | `CollectionPurchasesPanel.astro` |
| 正式資料（2026-11-25） | 採購訂單 0、分攤 0（R01 驗收）；卡套產品 0；關聯筆數未查 | — |

**結論**：「系列」可以完全由既有關聯組成，「共用禮包」可由 `bundle_contains`＋分攤對象判斷，不需要新增資料表。

## 2. 固定規則（沿用既有口徑，不需決策）

1. 金額只計採購分攤；訂單狀態只計已付款、部分收貨、完成（與 R01／R10 相同）；依幣別分列，不換算、不把不同幣別相加。
2. 分攤到副本的金額，歸到該副本所屬收藏。
3. 只計 production 範圍；封存的收藏與封存的關聯不納入系列。
4. 沒有記錄成本的成員要列出（「尚未記錄成本」），不能當作 0 元默默加進合計。
5. 同一筆分攤只計一次：若某收藏同時以多種關聯出現在系列中，只算一次。
6. 唯讀功能，不改任何採購或關聯資料；讀取失敗只影響此一節（「無法取得」）。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q64 | 系列包含哪些收藏 | 先找「本體」：若目前收藏是擴充或配件（收藏關聯 `expansion_of`／`requires_base`／`accessory_for`，或遊戲關聯為 BGG 擴充／NotBGG 配件），往上找到已收藏的本體；再納入本體的**直接**關聯：收藏關聯（除 `bundle_contains`、`other` 外的所有類型）與遊戲關聯（已收藏的擴充、需要本體、配件、同系列）。不再往下一層遞迴 | 從目前收藏出發，沿所有關聯遞迴展開整個連通群組 | **A**：「某套遊戲含擴充與周邊」通常就是本體加一層；遞迴容易把「相容配件」「同系列」連到不相干的遊戲 |
| Q65 | 共用禮包怎麼處理 | 不拆：禮包收藏（`bundle_contains` 包含系列中任一成員）的分攤另列為「共用禮包」：顯示禮包名稱、金額、共包含幾款（其中幾款在此系列），**不併入合計**；若採購時已把禮包拆分攤到各成員，則直接計入各成員 | 依禮包內含款數平均分攤，估算後併入合計並標示「估算」 | **A**：不替使用者發明拆分比例；要精確可在採購時拆分攤 |
| Q66 | 卡套花費 | 第一版不計金額，只列資訊：此系列成員的已套用卡套張數、附贈卡套張數 | 以購買交易的單價估算已套用卡套的成本並併入 | **A**：卡套購買不連收藏、套用沒有單價，估算口徑需另訂規則 |
| Q67 | 維修、替換等其他費用 | 不計，並在說明中寫明（與 R01 口徑一致） | 另列一行「其他費用」，不併入採購合計 | **A**：維持全站同一口徑；需要時再另案 |
| Q68 | 呈現位置與形式 | 收藏詳細頁「相關採購」分頁新增唯讀一節「系列花費合計」：本體與成員清單（關聯類型、各自依幣別的已記錄成本或「尚未記錄」）、依幣別的合計、共用禮包另列、卡套資訊、口徑說明；成員可點到各自的相關採購分頁 | 另開一個系列專頁 | **A**：放在使用者已經會看的位置，不新增導覽 |

## 4. 非目標

修改採購分攤或關聯的寫入；自動建立或推測關聯（關聯缺漏時，請使用者到「管理收藏組合關係」補上）；匯率換算；卡套成本估算；R02 列表或 R01 顯示系列金額；任何 Migration。

## 5. 可選授權：正式 D1 唯讀彙總

為了知道上線後畫面會長怎樣（例如有多少收藏已有擴充或配件關聯、禮包關聯是否已建立），可授權 Claude 對正式 D1 執行一次**唯讀**計數查詢：收藏關聯與遊戲關聯依類型與來源的筆數（含封存）、bundle 類型收藏數與其 `bundle_contains` 筆數、有已收藏擴充的本體數。寫入 0，只記數字。不授權也不影響設計（正式目前沒有任何採購分攤，合計一開始都會是「尚未記錄」）。

## 6. 決策後的步驟

1. 依決策起草工作命令，交使用者批准。
2. Codex 本機實作：共用唯讀計算（找本體、組成員、去重、依幣別加總、共用禮包、未記錄成員）＋單元測試（擴充上溯本體、配件、同系列、禮包整筆與已拆分、封存排除、多幣別、去重、讀取失敗隔離）、「相關採購」分頁新一節；瀏覽器驗收三種寬度。
3. Claude 審查 → 使用者看截圖 → 依 DEPLOY-01 授權推送 → 唯讀確認 → 登入後檢查。

## 7. 正式 D1 唯讀計數結果（2026-11-25，SERIES-D1-AUTH）

執行者 Claude；`wrangler d1 execute --remote --json --command` 單一 SELECT（含 CTE 與純量子查詢，無複合查詢）**執行一次**；`changes 0`、`changed_db false`、`rows_written 0`、`rows_read 6638`。只記數字。

| 項目 | 數字 |
| --- | --- |
| production 未封存收藏 | 256（base 187、bundle 36、expansion 32、promo 1） |
| 收藏關聯（未封存／封存） | 0／0 |
| 遊戲關聯 `v2_game_relations`（未封存／封存） | 0／0 |
| NotBGG 配件關聯（未封存） | 0 |
| bundle 收藏／已建立 `bundle_contains` 的 bundle | 36／0 |
| 兩端都已收藏的遊戲關聯（擴充／需要本體／配件／同系列） | 0 |
| 有已收藏擴充的本體 | 0 |
| 採購分攤 | 0 |

**解讀**：

1. 正式環境目前**完全沒有關聯資料**。上線後每個收藏的系列都只有自己，32 筆擴充收藏也找不到本體；要讓合計有意義，需要先到「管理收藏組合關係」建立關聯（或日後另案把 BGG 擴充關係同步進 `v2_game_relations`，不在本任務範圍）。因此空狀態文字要明確引導去建立關聯，並附連結。
2. bundle 收藏現為 36 筆（UI 階段 4 驗收時記錄的 32 筆是「缺來源身分的組合」，口徑不同），目前都沒有 `bundle_contains`，所以「共用禮包」一開始也不會出現。
3. 沒有分攤，合計一開始都會是「尚未記錄成本」，與 §5 預期一致。
4. 以上不改變 Q64～Q68 的設計；只影響空狀態與驗收方式（驗收全靠本機資料）。

## 8. 工作命令 `SERIES-20261125-01`（已授權 2026-11-25，SERIES-AUTH）

執行者：Codex（本機實作與測試）。依據：DECISION_LOG `SERIES-Q64～Q68`、`SERIES-D1-AUTH`；本文件 §2 固定規則、§3 決策、§7 結果。

### 8.1 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/lib/series-spending.ts` | **新增**：唯讀計算 `readSeriesSpending(db, collectionId)` |
| `src/components/admin/CollectionPurchasesPanel.astro` | 只**新增**「系列花費合計」一節（放在「此收藏的已記錄成本」之後）；既有各節逐字保留 |
| `tests/series-spending.test.ts` | **新增**單元測試 |
| `tests/admin-collection-detail.test.ts`、`tests/admin-collection-detail-browser.mjs` | **只增**：新一節的頁面與瀏覽器斷言；既有斷言不改 |
| `docs/SERIES-screenshots/` | **新增**截圖資料夾；不得覆寫其他截圖資料夾 |
| `src/styles/` 既有 admin 樣式檔 | 只限新增此節所需的少量 class；不改既有規則 |
| 本文件 §8.4 | 回報 |

其他檔案一律不改；若發現必須改動，先停下回報。不得新增 Migration、不得改 `migrations/`、`wrangler.json`、`astro.config.mjs`、授權相關檔案。

### 8.2 計算規格（`series-spending.ts`）

關聯方向以既有規則為準（`relation-admin.ts`）：`requires_base`／`expansion_of`／`accessory_for` 的 **source 是擴充或配件、target 是本體**；`site_game_relations` 的 source 是 NotBGG 配件、target 是遊戲。

「有效收藏」＝`record_scope` 與目前收藏相同為 production、且 `v2_collection_management.archived_at IS NULL`。「有效關聯」＝`archived_at IS NULL`。遊戲對應收藏＝該 `game_id` 的所有有效收藏（可能多筆）。

1. **目前收藏**不是有效收藏或不是 production：本節顯示「不適用（只計正式收藏）」，不查其他資料。
2. **找本體（Q64）**：候選本體＝
   - 收藏關聯：目前收藏為 source、類型 `requires_base`／`expansion_of`／`accessory_for` 的 target 收藏；
   - 遊戲關聯：目前收藏的 `game_id` 為 source、同上三類（`v2_game_relations`，不論 `relation_source`、`admin_confirmed`）的 target 遊戲之有效收藏；
   - NotBGG：目前收藏的 `game_id` 為 `site_game_relations` source 的 target 遊戲之有效收藏。
   
   候選為 0 筆 → 目前收藏即本體。恰 1 筆 → 該收藏為本體。**多於 1 筆 → 失敗關閉**：不計算合計，顯示「此收藏關聯到多個本體」並列出各候選（可點到各自的相關採購分頁），請使用者到「管理收藏組合關係」確認。只上溯一層，不再往上找。
3. **組成員（Q64）**：本體＋本體的直接關聯（兩個方向都算）：
   - 收藏關聯：除 `bundle_contains`、`other` 外所有類型；
   - 遊戲關聯（本體 `game_id` 任一端）：`expansion_of`、`requires_base`、`accessory_for`、`same_series`；
   - NotBGG：target 為本體 `game_id` 的配件遊戲之有效收藏。
   
   不遞迴。同一收藏只出現一次（§2-5）；同一成員有多種關聯時，關係標籤依「擴充 → 配件 → 同系列 → 其他類型」取第一個，並以收藏 id 排序（本體第一）。目前收藏一定在成員內（若本體找到了但目前收藏不在本體的直接關聯中——例如只有遊戲層級反向關聯——仍要納入）。
4. **成本**：沿用 R01／R10 口徑（`purchase-admin.ts` 現有 costs 查詢條件：訂單狀態 `paid`／`partially_received`／`completed`，分攤到副本者歸該副本收藏），依幣別加總；成員沒有任何分攤 → 「尚未記錄成本」，不當 0 計入；合計依幣別分列，並附「其中 N 款尚未記錄成本」。
5. **共用禮包（Q65）**：有效 bundle 收藏中，以有效 `bundle_contains` 包含至少一位成員、且本身**不是**成員者 → 另列：名稱（連到其相關採購分頁）、依幣別已記錄成本或「尚未記錄」、共包含幾款、其中幾款在此系列；**不併入合計**。已在採購時直接分攤到成員的金額照第 4 點計入。
6. **卡套（Q66）**：只列兩個張數，不計金額：成員副本的已套用張數（定義沿用 `sleeve-shortage.ts`／卡套分頁現有「已套用」口徑，不自創）；附贈張數＝連到成員收藏的 GIFT（沿用 `readCollectionSleeveGifts` 的歸屬規則：直接連收藏，或只連採購明細時歸該明細收藏），換算為張數。
7. **其他費用（Q67）**：不查 `v2_cost_adjustments`；說明文字寫明不含。
8. **查詢**：不得使用複合 SELECT（UNION／INTERSECT／EXCEPT）；彼此獨立的查詢用 `db.batch()`；任何一筆 `success` 為假或拋例外 → 拋出，由畫面只讓本節顯示「無法取得」，其他節照常、分頁維持 200。成員數上限 100（超過顯示前 100 並註明），避免無界查詢。
9. 不寫入任何資料。

### 8.3 畫面規格（「相關採購」分頁新一節）

- 標題「系列花費合計／Series spending」；說明：只計採購分攤（已付款、部分收貨、完成）、依幣別、不換算、不含維修等其他費用與卡套金額；共用禮包另列不併入。
- 成員表：名稱（連到該收藏 `/admin/collection/[id]/purchases`，目前收藏標「目前」、本體標「本體」）、關係、已記錄成本（每幣別一行，或「尚未記錄成本」）。375 寬改卡片，比照 R02。
- 合計：依幣別各一行＋「其中 N 款尚未記錄成本」。
- 共用禮包小節（有才顯示）、卡套一行。
- 只有自己一位成員時：顯示合計（即自身成本）並提示「尚未建立系列關聯。可到『管理收藏組合關係』新增擴充、配件或同系列關聯。」附連結 `/admin/bgg?view=relations&domain=collection&source=[本體或目前收藏 id]&lang=`。
- 多本體、不適用、無法取得三種狀態用中性或警示樣式（無法取得用既有 AlertBanner），中英雙語。

### 8.4 測試與驗收

1. `tests/series-spending.test.ts`（本機拋棄式 SQLite，套用 `migrations/` 全部檔案）至少涵蓋：本體自身；擴充上溯本體（收藏關聯、遊戲關聯、NotBGG 各一）；多本體失敗關閉；配件與同系列成員；`bundle_contains`、`other` 不納入成員；禮包整筆另列不併入、已拆分攤直接計入；封存收藏與封存關聯排除；test scope 排除；多幣別不相加；分攤到副本歸收藏；未付款／取消訂單不計；同一成員多關聯只計一次；不遞迴（擴充的擴充不納入）；卡套張數；讀取失敗只影響本節；無複合 SELECT 守衛（比照採購三卡測試）。
2. 只增的頁面／瀏覽器斷言：新一節存在、成員連結、空狀態連結、失敗隔離。
3. 執行：新測試、`admin-collection-detail.test.ts`、`purchase-admin.test.ts`、`sleeve-admin.test.ts`、`sleeve-shortage` 相關測試、`npm run astro -- check`（基準 6 errors，不得增加）、`npm run build`。
4. 瀏覽器截圖 375／768／1280：有系列（本體＋擴充＋配件、雙幣別、一款未記錄）、擴充頁上溯、共用禮包、只有自己（空狀態）、多本體；存 `docs/SERIES-screenshots/`。
5. 回報：新增／修改檔案、測試指令與結果、截圖清單、未執行項目。

### 8.5 禁止事項

網路存取、任何遠端／正式操作、commit、push；git worktree 建立或移除、node_modules junction；`git reset --hard`／`checkout -- .`／`clean`／`stash`；覆寫其他截圖資料夾；讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。

### 8.6 實作回報

2026-11-25（Asia/Taipei），`SERIES-20261125-01` 已在本機實作及驗證。`readSeriesSpending` 只上溯一層並讀取本體的直接關聯，使用拋棄式 SQLite 驗證關聯方向、有效收藏、去重、各幣別分攤、共用禮包及卡套張數。有多個本體時列出候選；系列讀取失敗時，收藏頁保留原有採購與卡套資訊並回 HTTP 200。

| 變更 | 檔案與內容 |
| --- | --- |
| 新增 | `src/lib/series-spending.ts`，唯讀計算與查詢 |
| 新增 | `tests/series-spending.test.ts`，套用所有 Migration 的拋棄式 SQLite 測試 |
| 新增 | `docs/SERIES-screenshots/`，15 張 Edge 截圖 |
| 修改 | `src/components/admin/CollectionPurchasesPanel.astro`，新增中英雙語系列區塊 |
| 修改 | `src/styles/admin-theme.css`，新增成員表格、窄版卡片及共用禮包樣式 |
| 修改 | `tests/admin-collection-detail.test.ts`、`tests/admin-collection-detail-browser.mjs`，新增合成資料和斷言 |
| 修改 | `docs/series-spending-plan-20261125.md`，新增本回報 |
| 刪除 | 無 |

| 指令 | 結果 |
| --- | --- |
| `node --import tsx --test tests/series-spending.test.ts` | 7 通過／0 失敗 |
| `node --import tsx --test tests/admin-collection-detail.test.ts` | 6 通過／0 失敗 |
| `node --import tsx --test tests/purchase-admin.test.ts` | 10 通過／0 失敗 |
| `node --import tsx --test tests/sleeve-admin.test.ts` | 7 通過／0 失敗 |
| `node --import tsx --test tests/sleeve-shortage.test.ts` | 14 通過／0 失敗 |
| `node tests/sleeve-shortage-browser.mjs <暫存目錄>` | 8 通過／0 失敗 |
| `node tests/admin-collection-detail-browser.mjs <暫存目錄>` | 63 通過／0 失敗（既有 47、新增 16） |
| `npm run astro -- check` | 6 errors、0 warnings、25 hints，與 6 errors 基準相同 |
| `npm run build` | 通過，退出碼 0，完成 4 條靜態路由預渲染及 Worker 建置 |
| `git diff --check -- src tests` | 通過 |

Node 測試使用行程範圍的 tsx 帳號備援。Edge 使用暫存 profile 與 `D1_A3_EDGE_LOCAL_TEST_MODE=1`。Astro 檢查和建置使用排除機密檔的暫存副本，建置重跑時將 Wrangler registry／log 導向暫存目錄，關閉 Cloudflare `Request.cf` 抓取並保留本機預渲染的 loopback 連線。Astro 檢查的 6 筆既有錯誤分布於兩個 Admin controller、`tests/shared-quantity-commit.test.ts` 和 `tests/major03-d1/worker.ts`。

截圖存於 [SERIES-screenshots](SERIES-screenshots/)，每列依序為 375、768、1280 px。已核對所有檔案的實際寬度。

| 情境 | 375 px | 768 px | 1280 px |
| --- | --- | --- | --- |
| 本體＋擴充＋配件、雙幣別、1 款未記錄 | [375](SERIES-screenshots/series-375.png) | [768](SERIES-screenshots/series-768.png) | [1280](SERIES-screenshots/series-1280.png) |
| 擴充上溯 | [375](SERIES-screenshots/expansion-375.png) | [768](SERIES-screenshots/expansion-768.png) | [1280](SERIES-screenshots/expansion-1280.png) |
| 共用禮包 | [375](SERIES-screenshots/shared-bundle-375.png) | [768](SERIES-screenshots/shared-bundle-768.png) | [1280](SERIES-screenshots/shared-bundle-1280.png) |
| 只有自己 | [375](SERIES-screenshots/standalone-375.png) | [768](SERIES-screenshots/standalone-768.png) | [1280](SERIES-screenshots/standalone-1280.png) |
| 多個本體 | [375](SERIES-screenshots/multiple-bases-375.png) | [768](SERIES-screenshots/multiple-bases-768.png) | [1280](SERIES-screenshots/multiple-bases-1280.png) |

100 款上限以畫面成員為計算範圍。若目前收藏依 ID 排在上限之外，保留本體與目前收藏，以目前收藏替換最後一位一般成員。

§8.4 的本機驗證已全數執行。正式 D1、部署、登入驗收及 commit／push 均未執行。`HANDOFF.md` 位於 §8.1 允許清單之外，交接結果記於本節。

### 8.7 Claude 審查（2026-11-25）

**結論：通過**，無必修項目。

- 範圍：改動檔案都在 §8.1 允許清單內；未動 migrations、設定、授權檔與其他截圖資料夾。
- 計算：上溯方向（source＝擴充／配件、target＝本體）與 `relation-admin.ts` 一致；多本體在讀成本前就失敗關閉；成員只一層（測試驗證「擴充的擴充」不納入、`other` 不納入）；成本條件與 `readPurchases` costs 相同（狀態三種、副本歸收藏）；共用禮包排除本身是成員者、不併入合計；卡套已套用以 `v2_sleeve_applications` 加總（與 `sleeve-shortage.ts` 同表同口徑），附贈沿用 GIFT 歸屬規則；查詢全用 `db.batch()`、無複合 SELECT、不查 `v2_cost_adjustments`（測試守衛）；任一查詢失敗即拋出，畫面只此節顯示「無法取得」。
- 畫面：此節插在「此收藏的已記錄成本」與「相關訂單」之間，既有各節內容未改；375 寬改卡片。截圖 15 張已抽看 `series-1280`、`series-375`。
- 觀察（不阻擋）：金額沿用全站「最小貨幣單位整數」顯示（如 USD 1275 代表 12.75），與既有「此收藏的已記錄成本」一致；若要改成一般金額格式屬全站另案。
- 本人未重跑測試，測試結果以 §8.6 Codex 回報為準。
