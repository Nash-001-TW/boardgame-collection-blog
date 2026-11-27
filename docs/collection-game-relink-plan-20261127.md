# 收藏「更換對應遊戲」功能規劃（#39）

- 日期：2026-11-27（Asia/Taipei）
- 狀態：Q143～Q149 **已採納**（2026-11-27，使用者「全部採建議」，DECISION_LOG RELINK-Q143～Q149）；**已授權實作**（2026-11-27，DECISION_LOG RELINK-AUTH）。
- 起因：使用者發現收藏 #262「小小史詩克蘇魯豪華版」實際是簡體中文**普通版**（少了豪華版的 5 個迷你擴充），但收藏對應的是 BGG 408253「Tiny Epic Cthulhu: Deluxe Edition」。後台目前無法更換收藏對應的遊戲。先前 Q105 已表達「指向遊戲身分後續要可以調整修改」。

## 1. 現況（唯讀核對，2026-11-27）

- 收藏 #262：`game_id` 227 → BGG 408253（Deluxe Edition）；副本 #1（二手、2024、簡體中文版）；21 個組件、21 張照片、1 筆採購分攤、卡套需求；關聯：#263 混亂教團擴充 `expansion_of`、#264／#265 配件 `accessory_for`。這些都是接在**收藏**上，不是接在 BGG 遊戲上，所以換遊戲後不受影響。
- 後台編輯（`collection-v2-management.ts` 的 `patchFields`）只能改 `displayName`、`acquisitionStatus`、`wishlist`、`notes`，不能改 `game_id`。
- 新增收藏時，可以選 BGG（靜態資料或已同步）或 NotBGG 遊戲（`search` 與 `create`），`item_type` 會依遊戲類型自動決定。
- 收藏事件表 `v2_collection_events` 的 `operation` 只允許 `create`／`update`／`archive`，也沒有欄位記錄「從哪個遊戲換到哪個遊戲」。
- 會讀取 `game_id` 的地方：公開遊戲頁與收藏清單（`public-game-collection.ts`、`public-site-data.ts`、`public-live-relations.ts`）、公開卡套 API（`/api/sleeves/game/[id]`、`/api/sleeves/games`）、系列花費（`series-spending.ts`）、關係管理（`relation-admin.ts`）、照片公開資格（`component-photo-api.ts`）、後台清單分組。換遊戲之後，這些地方都會改用新遊戲的資料。是否有建置時產生的靜態快取需要更新，要在實作前確認。

## 2. 建議流程

1. 收藏的「基本資料」分頁新增收合的「更換對應遊戲」區塊。
2. 搜尋沿用新增收藏的搜尋（BGG 靜態資料、已同步的 BGG、NotBGG）。找不到時，提示先到 `/admin/bgg` 同步。
3. 選定後先顯示預覽：目前遊戲 → 新遊戲、類型變化（例如「基礎遊戲 → 基礎遊戲」）、會跟著改變的地方（公開遊戲頁、系列花費歸屬、公開卡套頁），以及不受影響的資料（副本、組件、照片、清點、卡套需求、採購、收藏關聯）。
4. 確認後一次寫入：更新 `game_id`（以及依 Q144 決定是否更新 `item_type`）、寫入收藏事件、寫入更換紀錄。沿用 revision 守衛、冪等、Access、同源與限流。
5. 完成後就地更新基本資料，並在頁面上顯示更換紀錄。

## 3. 待決問題

| 編號 | 問題 | 選項 | 建議（2026-11-27 已採納） |
| --- | --- | --- | --- |
| Q143 | 可以選哪些遊戲 | A：和新增收藏相同（BGG 靜態、已同步 BGG、NotBGG）。B：只限已同步的 BGG | A |
| Q144 | 收藏類型（基礎／擴充／配件…） | A：依新遊戲類型自動更新，類型有變化時在預覽中標出，並需要確認。B：一律保留原本的類型 | A |
| Q145 | 收藏名稱 | A：不自動改，提供「同時改成新遊戲的名稱」勾選（預設不勾）。B：自動改成新遊戲名稱 | A |
| Q146 | 更換紀錄 | A：新增 Migration 0028，加一張「遊戲更換紀錄」表（收藏、revision、舊遊戲、新遊戲、操作者、時間），在基本資料頁顯示。B：只寫一般的 `update` 事件，不知道換了什麼 | A |
| Q147 | 限制 | A：已封存的收藏不能換；新舊相同會拒絕；同一遊戲已經有其他收藏時只提示、不阻擋（同一款遊戲可以有多筆收藏）。B：同一遊戲只能有一筆收藏 | A |
| Q148 | 確認前的影響預覽 | A：列出會改變和不受影響的項目，再按確認。B：直接換，不預覽 | A |
| Q149 | 入口位置 | A：收藏「基本資料」分頁內的收合區塊。B：獨立頁面 | A |

## 4. 收藏 #262 的處理順序（功能上線後）

1. 使用者到 BGG 找出普通版「Tiny Epic Cthulhu」的 ID，在 `/admin/bgg` 同步進目錄。
2. 在 #262 的基本資料用「更換對應遊戲」改到普通版；名稱可以一起改成「小小史詩克蘇魯」。
3. 確認公開網站上，這筆收藏已經從豪華版頁面移到普通版頁面。

## 5. 正式套用

如果 Q146 採 A，需要 Migration 0028，流程比照 0027（A1 唯讀預檢 → A2 備份與本機預演 → A3 套用 → A4 對帳），每一步都要另外授權；部署要在 0028 套用之後。

## 6. 定案（2026-11-27）

Q143～Q149 全部採 A：可選遊戲範圍和新增收藏相同；類型依新遊戲自動更新，類型有變化時需要確認；名稱不自動修改，提供勾選（預設不勾）；新增 Migration 0028 的遊戲更換紀錄表；已封存的收藏不能更換，新舊相同會拒絕，同一遊戲已經有其他收藏時只提示；確認前先預覽；入口放在基本資料分頁的收合區塊。

## 7. 工作命令 RELINK-20261127-01（2026-11-27 已授權）

- 執行：Codex；審查：Claude。只在本機進行，不連網、不碰正式 D1、不部署、不提交。
- 允許：新增 `migrations/0028_*.sql`；修改 `collection-v2-management.ts` 與收藏 API 路由；修改收藏基本資料分頁的元件與 controller；新增或更新測試。
- 禁止：`wrangler.json`、`src/middleware.ts`、認證模組、其他既有 Migration；改變收藏建立、封存、編輯的既有行為。
- 完成條件：§2 流程與 §3 定案；Node 測試涵蓋守衛、冪等、revision 衝突、封存、新舊相同、類型變化、紀錄寫入，以及 0028 套用到正式結構的本機驗證；Edge 測試涵蓋搜尋、預覽、確認、就地更新、紀錄顯示，並附中文 1280／375 截圖；既有收藏相關測試不回歸；確認換遊戲後是否有建置時產生的靜態快取需要處理，並回報。

## 8. 審查結果（2026-11-27，Claude）

- Codex 已實作：Migration 0028 新增 `v2_collection_game_changes`（WITHOUT ROWID，主鍵是收藏加 revision，外鍵連到 `v2_collection_events`，CHECK 拒絕新舊遊戲相同，觸發器禁止 UPDATE 和 DELETE，同時兼作冪等收據）。API 在 `/api/admin/collection/{id}`：GET `action=relink-preview&ref=…` 和 `action=relink-history`，PATCH `{action:'relink',ref,revision,renameToGame,confirmTypeChange}`。新的 409 錯誤碼有 `SAME_GAME` 和 `TYPE_CHANGE_CONFIRMATION_REQUIRED`。寫入用一次 D1 batch 完成：update 事件、revision、更換紀錄、`v2_collection_items`（BGG 目標不在 `v2_games` 時會一起建立）。
- Claude 審查：守衛、冪等、revision 競爭、封存（靠 revision 守衛擋下）、新舊相同（API 與 DB CHECK 雙重檢查）都符合 §6，沒有需要修改的地方。
- 靜態快取（Codex 調查）：建置時產生的 BGG 快取只提供目錄資料；公開收藏歸屬、卡套和系列花費都直接查 D1，所以換遊戲後不需要重新建置。
- Claude 自行驗證：Node 44／44（8 個收藏相關測試檔）；Edge 更換流程 4／4（`--relink`）、收藏詳細頁回歸 74／74。astro check 引用 Codex 的結果（6 → 6，使用 `--noSync`），Claude 沒有重跑。截圖在 `docs/RELINK-screenshots/`。
- **部署順序**：程式會查詢新表，所以必須先把 0028 套用到正式環境（A1～A4），再推送；順序反了，基本資料頁讀更換紀錄時會失敗。

## 9. 0028 正式套用

### 9.1 A1 唯讀預檢（2026-11-27，Claude 執行，DECISION_LOG RELINK-COMMIT-A1）

- 本機提交 `907ec0e`（未推送，本機比 `origin/main` 多 1 個提交）。0028 SHA-256 `ae8d0c2b09c42a002d21bd0d0be37812839a666783e98cc615e87b08367487da`。
- 遠端操作：Metadata 1 次、唯讀 SELECT 1 次；寫入 0。

| 項目 | 預期 | 實際 | 結果 |
| --- | --- | --- | --- |
| 流量版本 | `origin/main` 的部署 | `3933178d`（100%） | 符合 |
| `d1_migrations` | 27 筆，最後一筆是 0027，沒有 0028 | 27 筆，最後 `0027_component_photos.sql`，0028 為 0 筆 | 符合 |
| 更換紀錄物件 | 0 | 0 | 符合 |
| 外鍵目標 | `v2_collection_events` 有 (collection_item_id, revision) 唯一鍵 | `sqlite_autoindex_v2_collection_events_1`，欄位齊全 | 符合 |
| `v2_games` 欄位 | id、bgg_id、primary_name、game_type | 都存在 | 符合 |
| 資料 | — | 收藏 260、收藏事件 7、遊戲 229、照片 21；#262 revision 4、game_id 227；事件表觸發器 3 個；schema 物件 291（資料表 57） | 0028 只新增物件 |
| 外鍵檢查 | 0 | 0 | 符合 |

0028 會新增 1 張 WITHOUT ROWID 表（主鍵不另外建索引）、1 個自動索引（`request_key` UNIQUE）和 2 個觸發器，預期 291 → 295，實際數字在 A2 預演確認。

**A1 全數通過。** A2～A4 期間請不要在後台新增或修改資料。

### 9.2 A2 備份與本機預演（2026-11-27，Claude 執行，使用者授權「確認沒有，開始 A2」）

- **官方 Export 1 次**（唯讀）：`D:/CodexHome/private-0028-backup-6c79b02f1d58/boardgame-collection-db-before-0028.sql`，資料夾已停用繼承，只有目前網域使用者有 FullControl，不加入 Git。檔案 2,225,274 bytes，SHA-256 `d9975d6209f8ea0c039ed6e3ed10771fbadf26698cc55a9d06feb9021aa48c49`。下載連結沒有記錄，內容也沒有輸出。
- **組合檔**：0028 原檔（SHA-256 `ae8d0c2b…87da`，和 HEAD 相同）＋ `INSERT INTO d1_migrations(name) VALUES ('0028_collection_game_changes.sql');`，組合檔 SHA-256 `b49b3a8d5d3b462c5fadfdbd66bfe6460080184204b48141683d98ccbc77e2c8`，放在 scratchpad。
- **本機預演**（`node:sqlite`）：
  - **還原後**和 A1 一致：ledger 27、最後一筆 0027、更換紀錄物件 0、事件表觸發器 3、收藏 260、事件 7、遊戲 229、#262 revision 4、game 227、照片 21；schema 290、資料表 56（正式環境是 291／57，差的 1 個是 `_cf_KV`）。外鍵 0。
  - **在交易中套用：成功。** ledger 28；新增 1 張表、1 個索引、2 個觸發器，schema 290 → 294（+4），所以正式環境預期 291 → 295；既有資料不變。外鍵 0，`integrity_check` 回 `ok`。
  - **寫入測試**（在 savepoint 中執行，結束後 rollback，更換紀錄為 0）：10 項全部符合預期。完整的更換批次（事件、紀錄、管理 revision、收藏）可以寫入；同一個 revision 再寫、新舊相同、沒有對應的事件、`to_game_id` 為 NULL、不存在的遊戲、重複的 request_key、UPDATE 紀錄、DELETE 紀錄、跳號的事件 revision，全部被拒。
- 遠端操作：Export 1 次，寫入 0。**A2 全數通過。**

### 9.3 A3 正式套用（2026-11-27，Claude 執行，DECISION_LOG RELINK-0028-A34）

- 執行前複核：0028 SHA-256 `ae8d0c2b…87da`、組合檔 `b49b3a8d…e2c8`，都和 A2 相同。
- 台北 2026-11-27 09:47:42～09:47:51 執行 `wrangler d1 execute boardgame-collection-db --remote --json --yes --file <組合檔>`，**正式寫入只有這 1 次**，沒有使用 `migrations apply`。
- 結果：結束碼 0、`success: true`、`changed_db: true`、執行 4 個查詢、寫入 8 列、`last_row_id` 28、`num_tables` 55 → 56；D1 大小 2.01 MB。

### 9.4 A4 套用後唯讀對帳（2026-11-27）

- 唯讀 SELECT 1 次：ledger 28，最後一筆是 `0028_collection_game_changes.sql`；更換紀錄物件有 1 張表、1 個索引、2 個觸發器；schema 291 → 295（+4），資料表 57 → 58；事件表觸發器仍是 3 個；收藏 260、事件 7、遊戲 229、照片 21、#262 revision 4 與 game 227，都和 A1 相同；更換紀錄 0；外鍵 0。
- 正式網站唯讀抽查 8 條，全部符合：公開頁 3 條回 200；`/admin`、`/admin/collection/262`、`/api/admin/collection/262` 回 302 轉到 Access；公開照片回 200；`/dev/ui-kit` 回 404。
- **A3＋A4 全數通過，0028 已在正式環境就位。** 正式程式仍是 `3933178d`，不會讀寫新的表。
- 遠端操作合計（A1～A4）：Metadata 1、SELECT 2、Export 1、正式寫入 1、HTTP 抽查 8。
- **還沒做**：推送 `main`（本機提交 `907ec0e` 和這些紀錄）來部署 #39，以及上線後由使用者把 #262 換成普通版。需要另外授權。

### 9.5 部署（2026-11-27，DECISION_LOG RELINK-DEPLOY）

- 推送 `5035300..ec0e711`（包含 `907ec0e` 和 `ec0e711`）。Workers Builds 部署 `ffcbfc27`（100%，台北 09:50:04）。唯讀抽查 8 條都符合：公開頁 200、後台與 API 302 轉到 Access、公開照片 200、`/dev/ui-kit` 404。待使用者登入，把 #262 換成普通版並驗收。

## 10. 版面改進（2026-11-27，Q150～Q155 已採納，DECISION_LOG RELINK-UI-Q150～Q155）

起因：使用者已用功能把 #262 換到 BGG 404893，結果正確（唯讀核對：game 231、名稱「小小史詩克蘇魯」、revision 5、紀錄 1 筆、組件 21、照片 21）。但功能放在頁面下方的大型獨立區塊，換完後搜尋表單和紫色提示也一直留著。參考使用者提供的外部意見（第七點不採用）。

| 編號 | 決定 |
| --- | --- |
| Q150 | 入口放在頁首（`CollectionDetailHeader.astro`）的來源連結（例如「BGG:404893」）旁，用小型「更換」按鈕，每個分頁都看得到。已封存的收藏不顯示入口。 |
| Q151 | 操作改用彈出視窗（沿用 `admin-kit-dialog`）：搜尋（輸入框和按鈕同一列）→ 預覽 → 確認。類型變更確認、「同時改成新遊戲的名稱」以及 API 回傳的預覽與保留數字都保留，不用前端寫死的數值。 |
| Q152 | 有紀錄時，在入口旁顯示「紀錄 N」小按鈕，點開用彈出視窗由新到舊列出。不另外做側邊抽屜。 |
| Q153 | 成功：關閉視窗、清空搜尋和預覽、頁首與基本資料就地更新、紀錄數加 1，頁首下方顯示幾秒後自動消失的成功提示（`role=status`）。失敗：錯誤訊息留在視窗內，已填內容不清空。其他區塊的展開或收合狀態不變。 |
| Q154 | 移除原本的獨立大型區塊。 |
| Q155 | 外部意見第六點的版面原則記入 UI 設計規範，狀態為**候選**。 |

範圍：只改畫面（頁首、彈出視窗、controller、測試）。不改 API 契約、不改 Schema、不需要 Migration、不動正式資料。鍵盤操作（Esc 關閉、焦點回到入口）、375 寬、按鈕至少 44px、中英雙語都要驗證。

### 10.1 版面改進審查（2026-11-27，Claude，工作命令 RELINK-UI-20261127-01）

- Codex 實作：五個分頁共用的頁首加上「更換」與「紀錄 N」入口（新增 `src/lib/collection-relink-controller.ts` 作為共用 controller，基本資料分頁另外接回 revision 和名稱欄位）；改用 `admin-kit-dialog` 彈出視窗；移除 `CollectionAdmin.astro` 下方的大型區塊。API 沒有變更。
- Claude 自行驗證：Node 44／44；Edge `--relink` 9／9（入口、焦點歸還、找不到遊戲、預覽與類型確認、送出中不能關閉、失敗保留輸入、冪等重試與成功提示自動消失、紀錄視窗、四個分頁都能使用、已封存沒有入口）；收藏詳細頁回歸 74／74；Shell 9／9。截圖更新到 `docs/RELINK-screenshots/`（入口、預覽、紀錄，各有 1280／375）。astro check 引用 Codex 的回報（6，沒有新增）。
- 已知限制：在副本、組件等分頁更換後，頁首會立刻更新；但該分頁由伺服器產生的其他資料，要等下次載入才會反映新的遊戲。
