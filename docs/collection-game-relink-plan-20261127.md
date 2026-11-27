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
