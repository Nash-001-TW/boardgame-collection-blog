# R06-P0-A 逐副本適用性（含 Migration 0024）｜規劃（2026-11-26，候選）

對應 CURRENT_TASK #13（0024 審查）＋#14 的 R06-P0-A。依據：使用者 2026-11-18 已採納的 S1-A／S2-A／S3-B／S4-A／S5、S6、S7（[Decision-Ledger](Decision-Ledger-20261119.md)、[副本入口核對](V2-copy-create-entry-readonly-review-20261118.md)）；DECISION_LOG `D1-PLAN-Q3`（D1 預覽第一版不依賴 0024）；#27 `SLV-PLAN-Q52`（卡套需求展開「R06-P0-A 上線後再扣除不適用」）；#12 `R06-MIN-*`（清點清單已上線）。

狀態：Q74～Q79 **已採納**（全採 A，DECISION_LOG R06-P0A-Q74～Q79，2026-11-26）；第一張工作命令 §6 **已授權**（P0A-0024-AUTH）。本任務**需要 Migration**（修訂候選 0024 後正式套用，流程比照 0025）。本文件只做靜態閱讀，未執行測試、未讀正式資料。

## 1. 現況盤點（2026-11-26 靜態閱讀）

| 項目 | 現況 |
| --- | --- |
| `migrations/0024_component_applicability.sql`（109 行，`dd133d3` 起即在工作樹，**從未套用**） | 事件表 `v2_component_applicability_events`（每對副本×組件以 revision 遞增、不可改／刪）、目前值檢視 `..._current`、`coverage` 標記表；寫入觸發器檢查目標、收藏世代（0023 `d1_quantity_collection_generation`）與版本，**但最後一行無條件 `RAISE(ABORT,'APPLICABILITY_SOURCE_UNAVAILABLE')`**——也就是任何寫入都會被拒。`origin='initial'`（S6／S7 建立時的初始例外）也被停用。註解寫明「可信來源延到第 2 批」 |
| `src/lib/component-applicability.ts`（71 行） | 讀取**永遠回 `unknown`／`SOURCE_UNAVAILABLE`**；寫入函式存在但會被觸發器擋下；產品程式沒有呼叫（Project-Review F9） |
| `tests/component-applicability.test.ts` | 只驗證骨架行為（寫入被拒等） |
| 已採納規則（S 系列） | 同收藏共用定義，可逐副本明確**不適用**（S1-A）；新副本、新定義預設適用（S2-A）；恢復適用時沿用仍有效的舊清點值與日期，不製造清點事件（S3-B）；逐副本不同預期數量另議（S4-A）；適用性有獨立操作歷史，與清點事件分開（S5）；建立定義或副本時可同時設定初始例外並原子提交（S6、S7）；「不適用」不能拿來排除未知或繞過驗證 |
| 11/19 調和候選（方案 A／E1～E3／D2～D5：證據等級、coverage 標記） | **未採納**（Decision-Ledger 第 16 列）——這正是 0024 裡「coverage／可信來源」設計的來源 |
| 受影響的計算 | R06 清點清單（#12）、#27 卡套不足（`sleeve-shortage.ts` 按副本展開需求）、D1 預期數量更正的影響預覽（`physical-quantity-impact.ts`，目前依 D1-PLAN-Q3 視所有副本為適用） |
| 正式資料（2026-11-25） | 副本 0、受控組件 0 → 套用 0024 不會碰到任何既有資料列 |
| `migrations/` 慣例 | 0024 一直留在目錄內，所以 0025 時必須逐檔執行、禁止 `migrations apply`；0024 套用後這個限制解除 |

**結論**：現有 0024 是「功能停用」的骨架，原樣套用只會得到一張永遠寫不進去的表。要讓 R06-P0-A 能用，必須先決定「誰能證明某副本不適用」（Q75），再修訂 0024。

## 2. 固定規則（沿用已採納，不需決策）

1. 只記「不適用」例外；沒有事件的副本×組件就是適用（S1-A、S2-A）。
2. 歷史只增不改（S5）：每次切換寫一筆事件，revision 每對 +1，不可修改或刪除。
3. 恢復適用時，原本有效的清點值與日期照樣有效，不新增清點紀錄（S3-B）。
4. 適用性只能對「已確認實體組件」設定（未確認者本來就不能清點）；「不適用」不能用來隱藏待確認或來源不可用的組件。
5. 切換適用性會讓該收藏的 D1 更正預覽失效（沿用 0023 收藏世代 +1），避免舊預覽用舊的副本範圍提交。
6. Migration 只前向；0024 尚未套用，可以**就地修訂內容、沿用編號 0024**；正式套用流程比照 0025（唯讀預檢、官方備份、本機預演、逐檔執行＋寫 ledger、套用後對帳），每步另行授權。
7. 不改高敏感區的既有行為（授權、分類、簽章）；寫入走既有 Admin API 的同源／Access／冪等守衛。

## 3. 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q74 | 0024 的處理方式 | 就地修訂候選 0024（沿用編號），保留事件表＋revision＋世代守衛的骨架，移除無條件拒絕與 coverage 表 | 保留原 0024 不動，另寫 0026 疊加修正 | **A**：0024 從未套用，就地修訂最乾淨；疊加會讓正式庫留下一張永遠用不到的 coverage 表 |
| Q75 | 「某副本不適用」需要什麼依據 | 已登入的管理者（Access）在畫面上確認即可，事件記下操作人與時間 | 保留 11/19 候選的「可信來源／coverage」機制，需另外設計證據來源 | **A**：個人收藏網站只有您一位管理者，您親眼確認就是依據；B 需要先設計一套目前不存在的證據來源，等於繼續停用 |
| Q76 | 第一版範圍 | 只做「既有副本×既有組件」的切換（不適用 ↔ 恢復適用）；S6／S7（建立組件或副本時一併設定初始例外）留到下一版 | 一次做完切換＋S6＋S7 | **A**：S6／S7 要改副本建立的三條寫入鏈（R03／R04／R05），範圍大很多；正式環境目前 0 副本 0 組件，先有切換就夠用 |
| Q77 | 「不適用」要排除哪些計算 | R06 清點清單（該列改顯示「此副本不適用」）、#27 卡套不足（不展開到該副本）、D1 更正影響預覽（不列該副本）三處一起 | 只做 R06 清點清單，另兩處下一版 | **A**：三處口徑不一致會出現「清點說不適用、卡套卻說不足、預覽還算它少幾張」；三處都已有按副本展開的程式，改動集中 |
| Q78 | 切換時要不要填原因 | 第一版不設原因欄（S 系列記為「原因欄位未定」） | 可選填一行備註 | **A**：保持最小；需要時再加欄位（又是一次 Migration）——若您希望一開始就能記「此版本沒附」之類，選 B |
| Q79 | 畫面操作位置 | R06 清點清單每列加「此副本不適用」（確認後原地切換、不重載）；不適用的列淡化並顯示「恢復適用」；組件管理區的更正歷史旁附「適用性歷史」唯讀清單 | 在組件管理區做一個「副本×組件」矩陣統一設定 | **A**：與 #12 的清點流程同一處、同一互動方式；矩陣在副本多時手機難操作 |

## 4. 非目標

S6／S7 初始例外（若 Q76 選 A）；逐副本不同預期數量（S4-A 另議）；R06-P0-B 使用者清點日期、P0-C 整盒進度；公開網站顯示適用性；任何既有資料回填。

## 5. 決策後的步驟

1. **0024 修訂工作命令**（Codex，本機）：依決策修訂 `0024_component_applicability.sql` 與 `component-applicability.ts`，改寫 `component-applicability.test.ts`；在拋棄式 SQLite 套用 0001～0025 全部檔案驗證（含「0025 之後才套 0024」的正式順序）。Claude 審查。
2. **程式與畫面工作命令**（Codex，本機）：R06 清點清單切換、適用性歷史、#27 與 D1 預覽排除；測試與三種寬度截圖。Claude 審查、使用者看截圖。
3. **正式套用**（Claude，TEAM-04）：唯讀預檢 → 官方 Export 備份 → 本機預演 → 逐檔執行 0024＋寫 ledger → 對帳；之後才部署程式。每步依使用者授權。
4. 套用後 `migrations/` 不再有未套用檔，恢復可用 `wrangler d1 migrations apply` 的前提（是否改回用它，另行決定）。

## 6. 工作命令 `P0A-0024-20261126-01`：修訂候選 0024（已授權 2026-11-26，P0A-0024-AUTH）

執行者：Codex（本機）。依據：DECISION_LOG `R06-P0A-Q74～Q79`；本文件 §1～§3、§5 第 1 步。**只改 Migration 候選檔、適用性 lib 與其測試；不改畫面、API、其他 lib；不碰任何遠端。**

### 6.1 補充盤點（Claude，2026-11-26）

- 0023 的收藏世代（`d1_quantity_collection_generation`）在副本、組件定義、清點列等相關表任何寫入後都會 +1。若要求客戶端送出「讀取時的世代」，使用者在同一頁先存一筆清點，再切換適用性就會因世代已變而失敗。所以**並行控制改以「每對副本×組件的 revision」為準**，世代欄由伺服器在同一個 INSERT 內讀取目前值填入（仍保留觸發器檢查，確保同一陳述式內一致），插入後世代 +1 讓 D1 更正預覽失效（§2-5）。
- `src` 內沒有刪除副本、組件定義或收藏的程式路徑；事件表對副本／定義／收藏的 `ON DELETE RESTRICT` 不影響現有功能。
- `physical-quantity-impact.ts` 已支援 `not_applicable` 狀態，並以「revision 偶數＝適用、奇數＝不適用」驗證一致性，與事件表語意相符。

### 6.2 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `migrations/0024_component_applicability.sql` | 依 6.3 修訂（就地，沿用編號） |
| `src/lib/component-applicability.ts` | 依 6.4 改寫讀取與寫入；公開型別名稱可保留或調整，若調整須回報所有呼叫端（目前只有 `physical-quantity-impact.ts` 引用 `validApplicabilityGeneration` 與 `Applicability`，該檔**不得修改**，型別須維持相容） |
| `tests/component-applicability.test.ts` | 改寫為新語意（舊的「寫入一律被拒」案例改為對應新行為） |
| 本文件 §6.6 | 回報 |

### 6.3 0024 修訂規格

1. **移除**：`v2_component_applicability_coverage` 表及其 4 個觸發器；事件寫入觸發器最後的無條件 `RAISE(ABORT,'APPLICABILITY_SOURCE_UNAVAILABLE')`；檔頭關於「第 2 批可信來源」的註解改為說明 Q75（管理者確認即依據）。
2. **保留**：事件表結構（含 `origin`、`before_generation`、各 CHECK）、`origin='initial'` 停用守衛（S6／S7 下一版才開）、`TARGET_INVALID`（副本與定義同屬事件的收藏，且定義在 `v2_physical_component_candidates`）、`GENERATION_CHANGED`、`STATE_CHANGED`（revision 必為目前＋1、before 必等於目前狀態）、不可更新／刪除觸發器、插入後世代 +1、`..._current` 檢視、兩個索引。
3. 新增守衛：事件的副本須屬 `record_scope` 與收藏相同的收藏（由同收藏條件即已涵蓋則免）；`actor` 去空白後長度 ≤ 320。
4. 檔案須能在**已套用 0001～0023、0025**的資料庫上單獨執行（正式順序），也能在 0001～0025 依檔名順序全部套用時執行（本機測試 helper）。不得依賴 0025 的物件，也不得破壞 0025。

### 6.4 `component-applicability.ts` 規格

1. `readComponentApplicability(db, target)`：驗證目標（副本屬收藏、定義為該收藏的實體組件候選）；讀 `..._current` 與收藏世代；無事件 → `applicable`、revision 0；有事件 → 依 `not_applicable` 回 `applicable`／`not_applicable` 與 revision；世代以字串回傳（`validApplicabilityGeneration` 可驗）。讀取失敗**拋出**（不得回成 applicable，也不得以 unknown 掩蓋 D1 故障）；目標無效回 `unknown`／`TARGET_INVALID`。
2. 新增批次讀取 `readCollectionApplicability(db, collectionId)`：回傳該收藏所有「不適用」的副本×定義對與各對 revision（供畫面與 #27、D1 預覽一次取用），單一查詢或 `db.batch()`，不得用複合 SELECT。
3. `changeComponentApplicability(db, change)`：輸入 `{collectionId, copyId, definitionId, revision, next, actor}`（revision 為客戶端看到的目前值）；以單一 `INSERT … SELECT` 寫入，`before_generation` 由同一陳述式讀目前世代；觸發器錯誤碼原樣對應（`APPLICABILITY_STATE_CHANGED` 等）供 API 轉 409。不負責驗證操作人身份與組件確認狀態（由下一張工作命令的 API 層負責，註解寫明）。
4. 不新增依賴；不讀寫其他表。

### 6.5 測試與驗收

`tests/component-applicability.test.ts`（拋棄式 SQLite）至少涵蓋：無事件為適用；切換不適用 → 恢復 → 再不適用（revision 1、2、3）；舊 revision 重送被拒且無部分寫入；目標不屬同收藏被拒；非實體組件候選被拒；`origin='initial'` 被拒；`INSERT OR REPLACE`／`OR IGNORE`／多列 `INSERT … SELECT` 不能留下部分歷史；UPDATE／DELETE 事件被拒；插入後世代 +1（D1 預覽失效）；先存清點（世代已變）後切換仍成功（§6.1）；恢復適用後既有清點值不變（S3-B）；讀取失敗拋出；批次讀取；**正式順序套用**：0001～0023 → 0025 → 0024 成功，且 0025 的觸發器與 GIFT 規則仍有效。另執行 `physical-quantity-impact.test.ts`、`shared-quantity-commit` 相關測試、`physical-component-management.test.ts`、`sleeve-admin.test.ts`（確認 0024 修訂不破壞）、`npm run astro -- check`（基準 6 errors）。不需 build、不需瀏覽器截圖。

回報寫入 §6.6：修訂後 0024 全文的 SHA-256、與原檔的差異摘要、測試指令與結果、未執行項目。

### 6.6 Codex 執行回報（2026-11-26，Asia/Taipei）

`P0A-0024-20261126-01` **已實作**。§6.5 的適用性情境及兩種 Migration 順序**已本機驗證**。全數回歸仍有兩項待處理，見下表。

修訂後 0024 SHA-256 為 `1684b36a845a6d414c5ac8e01ca2608eb6e99492bca90a8e5a25a1188ef4f540`。原檔 SHA-256 為 `defd53614a87505ac2a014ac4d728a080f3a4f27159c3d4ccbc2ff1c3898f4db`。

本輪修改四個檔案，沒有新增或刪除檔案。

- [`migrations/0024_component_applicability.sql`](../migrations/0024_component_applicability.sql) 移除 coverage 表、四個觸發器與無條件 `APPLICABILITY_SOURCE_UNAVAILABLE`。保留事件表、目前值檢視、兩個索引、初始例外停用、目標／世代／狀態守衛、不可改刪及收藏世代加一。同收藏連接已涵蓋 scope。actor 去空白後限 1～320 字元。寫入觸發器以 `RAISE(ABORT)` 拒絕無效事件欄位，避免 `OR IGNORE` 略過後列而留下部分歷史。
- [`src/lib/component-applicability.ts`](../src/lib/component-applicability.ts) 讀取目前狀態、revision 與字串世代，並提供單次查詢取得收藏的目前例外。寫入由單一陳述式選取世代、由觸發器檢查每對 revision，保留觸發器錯誤向上傳遞。既有 `Applicability` 與 `validApplicabilityGeneration` 呼叫端維持相容。管理者身分與組件確認由下一張工作命令的 API 負責。
- [`tests/component-applicability.test.ts`](../tests/component-applicability.test.ts) 以記憶體 SQLite 覆蓋 §6.5。正式順序後比對既有 schema 物件，並實際測試 0025 的 GIFT 驗證、帳本不可改刪及產品包裝鎖定。
- 本文件 §6.6 記錄本輪實作與驗證。

下列 Node 指令在此 Windows 環境以 `node --import $fallback --import tsx --test …` 執行。首次直接啟動 tsx 遇到 `uv_os_get_passwd ENOMEM`，`$fallback` 是行程範圍的 inline preload，僅針對該錯誤提供合成 username。

| 指令 | 通過 | 失敗 |
| --- | ---: | ---: |
| `node --import tsx --test tests/component-applicability.test.ts` | 11 | 0 |
| `node --import tsx --test tests/physical-quantity-impact.test.ts` | 14 | 0 |
| `node --import tsx --test tests/shared-quantity-commit.test.ts` | 32 | 0 |
| `node --import tsx --test tests/d1-0023-review.test.ts` | 6 | 0 |
| `node --import tsx --test tests/d1-quantity-api.test.ts` | 14 | 0 |
| `node --import tsx --test tests/release-migration-chain.test.ts` | 3 | 2 |
| `node --import tsx --test tests/physical-component-management.test.ts` | 8 | 0 |
| `node --import tsx --test tests/sleeve-admin.test.ts` | 7 | 0 |

- 額外以同一指令合跑 shared quantity commit、0023 審查、quantity API 與 release migration chain 四檔，結果為 **55 通過、2 失敗**。兩項失敗均來自 [`release-migration-chain.test.ts`](../tests/release-migration-chain.test.ts) 第 59、138 行仍查詢依規格移除的 coverage 表。更新該檔需另行授權。
- `npm run astro -- check --noSync` 檢查 372 檔，**6 errors、0 warnings、27 hints**，錯誤數符合工作單基準，修改檔案沒有診斷錯誤。使用 `--noSync` 以跳過可能載入本機環境檔的 Astro 同步，並停用遙測及使用 npm 離線模式。完整含同步的 `npm run astro -- check` 未執行。
- `git diff --check` 通過。未執行 build、瀏覽器截圖、遠端／正式操作、部署、commit 或 push。測試資料庫存於記憶體，無本輪暫存檔需清除。

### 6.7 禁止事項

網路存取、任何遠端／正式操作（含 `wrangler d1 … --remote`）、commit、push；修改 0024 以外的 migrations、`wrangler.json`、`astro.config.mjs`、畫面、API、`physical-quantity-impact.ts` 與其他 lib；git worktree、node_modules junction、在 repo 內建立整份副本；`git reset --hard`／`checkout -- .`／`clean`／`stash`；讀取 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。暫存資料一律放在 repo 外的系統暫存目錄，結束前自行清除。

### 6.8 Claude 審查（2026-11-26）

**結論：0024 修訂與 lib 通過**；剩一個範圍外測試需授權修正。

- 0024（SHA-256 `1684b36a…f540`，本人以 `sha256sum` 複核相同）：coverage 表與其觸發器、無條件拒絕已移除；事件表、檢視、索引、`initial` 停用、目標／世代／狀態守衛、不可改刪、插入後世代 +1 皆保留；新增 `APPLICABILITY_CHANGE_INVALID` 守衛（actor 1～320 字、before≠after、只允許 `change`）——與既有 CHECK 有部分重複，但以 `RAISE(ABORT)` 確保 `INSERT OR IGNORE` 也不會留下部分歷史，可接受。不依賴 0025 物件。
- lib：讀取回真實狀態、revision 與字串世代，讀取失敗拋出（不掩蓋 D1 故障）；`readCollectionApplicability` 單一查詢、無複合 SELECT；寫入以單一 `INSERT … SELECT` 由伺服器讀世代，並行以每對 revision 為準（符合 §6.1）；`physical-quantity-impact.ts` 未改、型別相容。
- **範圍外失敗**：`tests/release-migration-chain.test.ts` 第 59、138 行仍斷言已移除的 `v2_component_applicability_coverage` 表（2 項失敗）。修正只需刪除這兩行 coverage 斷言、保留 events／current 斷言，屬預期中的連帶修改，但不在 §6.2 允許清單內，**待使用者授權**。
- 本人未重跑測試，結果以 §6.6 Codex 回報為準；完整含同步的 `astro check` 未執行（Codex 用 `--noSync`），屬可接受差異，下一張程式工作命令會跑完整檢查與 build。
- **補充（2026-11-26，P0A-0024-AUTH-02）**：Claude 刪除 `release-migration-chain.test.ts` 兩行 coverage 斷言後，本人執行 `node --import tsx --test tests/release-migration-chain.test.ts tests/component-applicability.test.ts`：**16 通過、0 失敗**（含 0001～0023→0025→0024 正式順序案例）。`P0A-0024-20261126-01` 本機驗證完成。
