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

## 7. 工作命令 `P0A-APP-20261126-01`：程式與畫面（已授權 2026-11-26，P0A-APP-AUTH）

執行者：Codex（本機實作與測試）。依據：DECISION_LOG `R06-P0A-Q74～Q79`、`R06-MIN-Q69～Q73`；本文件 §2、§3、§6（已修訂的 0024 與 lib，提交 `83cc6bf`）。**程式依賴 0024；0024 正式套用前不得部署。**

### 7.1 補充盤點（Claude，2026-11-26）

| 位置 | 現況 | 需要的改動 |
| --- | --- | --- |
| `writePhysicalComponent`（`physical-component-management.ts`，**高敏感區**） | 動作 create／edit／count／assign 與 D1 quantity-*；`count` 以 `count_revision` 條件寫入，不知道適用性 | (a) 新增動作 `applicability`；(b) `count` 寫入加條件：該副本×組件目前不得為不適用（失敗關閉，伺服器端保證，不只靠畫面隱藏） |
| `physical-component-admin-api.ts` | 統一處理授權、同源、限流、錯誤對應 | 只需把適用性觸發器錯誤對應到 409（若 `writePhysicalComponent` 已轉成 `HttpError` 則不必改） |
| `shared-quantity-preview.ts` `projectQuantitySnapshot` | 依 D1-PLAN-Q3 把所有副本視為 `applicable`、revision 0 | 依 Q77 讀真實適用性（與快照同一次讀取），不適用的副本歸入影響預覽的 `not_applicable` 分類（`physical-quantity-impact.ts` 已支援，不改） |
| `sleeve-shortage.ts` | 未指定副本的需求展開到在藏＋借出副本 | 需求已關聯組件（`component_definition_id`）時，跳過對該組件不適用的副本；指定副本且該副本不適用 → 該需求在此副本的缺口為 0。未關聯組件的需求無法判斷適用性，照舊展開 |
| R06 畫面（#12 版） | 清點清單每列：目前實點、輸入、儲存 | 加適用性切換與唯讀歷史 |

D1 更正提交不需另改：切換適用性會讓收藏世代 +1，舊預覽在提交時即失效（0023 既有守衛）。

### 7.2 允許修改

| 檔案 | 範圍 |
| --- | --- |
| `src/lib/physical-component-management.ts` | **只限** 7.3 第 1、2 項：新增 `applicability` 動作分支、`count` 寫入加不適用條件。create／edit／assign／quantity-* 的行為、簽章與證據流程逐字保留 |
| `src/lib/physical-component-admin-api.ts` | 只限錯誤碼對應（如需要） |
| `src/lib/shared-quantity-preview.ts` | 只限 `projectQuantitySnapshot` 與其快照讀取加入適用性；簽章、預覽憑證、`q1.` 操作識別與 baseline 結構不變 |
| `src/lib/sleeve-shortage.ts` | 只限 7.3 第 4 項 |
| `src/components/admin/PhysicalComponentsPanel.astro`、`src/lib/physical-component-admin-controller.ts` | 7.3 第 5、6 項；#12 的清點列行為、`edit`／`create`／`assign` 路徑逐字保留 |
| `src/lib/component-applicability.ts` | 只限新增唯讀的歷史查詢函式（若畫面需要） |
| 相關測試 | `tests/physical-component-management.test.ts`、`tests/shared-quantity-*.test.ts`、`tests/sleeve-shortage*.test.ts`／`.mjs`、`tests/admin-collection-detail-browser.mjs`、`tests/physical-quantity-browser.mjs`、`tests/component-applicability.test.ts`：只增；既有斷言若因預期中的行為改變而失敗，只限改為等價斷言並逐條回報 |
| `docs/P0A-screenshots/` | 新增截圖；不得覆寫其他截圖資料夾 |
| 本文件 §7.5 | 回報 |

不得修改：`migrations/`（含 0024）、`physical-quantity-impact.ts`、`component-classifier*.ts`、`physical-component-proof.ts`、`shared-quantity-commit.ts`、`d1-quantity-history.ts`、`D1QuantityPreviewDialog.astro`、`D1QuantityHistory.astro`、`PhysicalComponentFields.astro`、授權／middleware、`wrangler.json`、`astro.config.mjs`。超出範圍時停下回報。

### 7.3 行為規格

1. **`applicability` 動作**：欄位 `definitionId`、`definitionRevision`、`copyId`、`revision`、`next`（`applicable`／`not_applicable`）。驗證：組件為已確認實體組件（沿用 `verifiedPhysicalProof`，與 count 相同）、收藏未封存、副本屬該收藏且為可清點副本（在藏、未封膜，與 R06 清點清單一致）；呼叫 `changeComponentApplicability`，actor＝Access 管理者 subject。觸發器錯誤：`APPLICABILITY_STATE_CHANGED`、`APPLICABILITY_GENERATION_CHANGED` → 409 `COMPONENT_STATE_CHANGED`（沿用既有訊息）；`APPLICABILITY_TARGET_INVALID` → 409；`APPLICABILITY_CHANGE_INVALID` → 400。回傳新狀態與新 revision。
2. **清點守衛**：`count` 的條件寫入加上「該對目前不為不適用」；違反時 409（新錯誤碼 `COMPONENT_NOT_APPLICABLE`，中英訊息「此副本已設為不適用，無法清點」）。
3. **D1 預覽**（Q77）：快照讀取同時取得每列副本×組件的適用性與 revision（`v2_component_applicability_current`），不適用者以 `not_applicable` 進入影響預覽；預覽對話框的「排除」計數已包含 `not_applicable`，畫面不需改。
4. **卡套不足**（Q77）：如 7.1 表；`readSleeveShortage` 以 `db.batch()` 多讀一次適用性，不得用複合 SELECT；R01 與尺寸頁數字隨之變化，無需改畫面。
5. **R06 清點清單**（Q79）：每列（已確認組件、已選副本）加按鈕「此副本不適用」；按下先 `confirm`（「#副本 標籤 不適用『組件名』？之後可恢復」），成功後原地切換、不重載：該列淡化、隱藏數量輸入與儲存、顯示「此副本不適用」與「恢復適用」按鈕；恢復後回到原輸入狀態，**原有實點照舊顯示**（S3-B）。切換副本時各列依該副本狀態渲染（資料已在頁面上，與 #12 的 `data-count-values` 同方式，伺服器端也依 `?copy` 預先渲染）。錯誤處理同 #12 清點列（衝突只在該列顯示並給「重新載入」；結果不明可重試，重試前先以 revision 判斷是否其實已成功）。有未儲存的數量輸入時切換適用性，先提示會捨棄。
6. **適用性歷史**（Q79）：組件管理區每個組件的更正歷史旁，加唯讀「適用性歷史」：時間（Asia/Taipei）、副本、由「適用」→「不適用」或反向、操作人；沒有紀錄時顯示「尚無適用性紀錄」。
7. 中英雙語；1440／768／375 無整頁橫向捲動；WCAG AA；觸控 ≥ 44px；`aria-live` 告知切換結果。

### 7.4 測試與驗收

1. 單元：`applicability` 動作的成功、版本衝突、未確認組件、封存收藏、非可清點副本、錯誤碼對應；`count` 對不適用對被拒且無部分寫入；恢復適用後可再清點且舊實點不變；D1 預覽將不適用副本列為 `not_applicable`、切換後舊預覽提交失效；卡套不足（已關聯組件的需求跳過不適用副本、指定副本不適用、未關聯組件照舊）。
2. 瀏覽器（本機拋棄式資料、Edge 暫存 profile、`D1_A3_EDGE_LOCAL_TEST_MODE=1`）：設為不適用 → 原地淡化、未重載 → 重新整理仍不適用 → 切到另一副本仍可清點 → 恢復適用顯示原實點 → 歷史兩筆；D1 更正預覽的排除數含不適用；既有 `physical-quantity-browser.mjs` 全過。
3. 既有測試全跑（#12 與 D1 相關、卡套、收藏詳細頁）；`npm run astro -- check`（完整含同步；基準 6 errors）；`npm run build`。
4. 截圖 375／768／1280：清點清單含一列不適用、確認對話框前後、適用性歷史；中英各一組 1280。存 `docs/P0A-screenshots/`。
5. 回報寫入 §7.5：新增／修改檔案、每條測試指令與結果、修改了哪些既有斷言及理由、截圖清單、未執行項目。

### 7.5 Codex 執行回報（2026-11-26，Asia/Taipei）

`P0A-APP-20261126-01` **已授權，實作停在寫入守衛的授權邊界**。

- `changeComponentApplicability` 的現有 `INSERT` 接受逐對 revision，並於寫入時取得收藏的當前世代。0024 也透過實體組件候選檢視檢查收藏未封存。寫入陳述式及觸發器均未核對請求的 `definitionRevision`、副本是否仍在藏且未封膜。若 API 先查驗、再呼叫 helper，並行編輯組件或變更副本狀態仍可能在兩步之間成功，隨後適用性事件也會成功寫入。兩種變更即使推進收藏世代，helper 仍會讀到新世代並填入事件。這和 `AGENTS.md` 的條件式寫入及併發守衛要求衝突。證據見 [`component-applicability.ts`](../src/lib/component-applicability.ts)、[0024](../migrations/0024_component_applicability.sql) 與 [0017](../migrations/0017_physical_components.sql)。
- 最小待授權範圍為允許調整 `changeComponentApplicability` 寫入介面與 SQL，讓新 Admin 動作能在同一筆 `INSERT … SELECT` 核對已驗證的簽章、組件版本與副本可清點狀態，並將零列寫入回報為 409。既有 helper 呼叫端及測試的相容性需一併核對。
- 本輪只修改本文件，新增本節。新增／刪除檔案、程式或測試變更、既有斷言調整、截圖均為零。
- 尚未執行測試驗證。§7.4 的單元、既有回歸與 Edge 瀏覽器均未執行，無通過／失敗數。`npm run astro -- check` 與 `npm run build` 均未執行，6 errors 為工作單基準。本輪沒有建立暫存資料，也未執行網路、遠端、正式環境、commit 或 push 操作。

**2026-11-26（Asia/Taipei）｜P0A-APP-AUTH-02 已授權，程式已寫入，回歸驗證暫停於測試範圍邊界。**

- 修改 `src/lib/component-applicability.ts`、`src/lib/physical-component-management.ts`。新增適用性寫入及歷史讀取，寫入在同一陳述式比對組件版本、簽章及副本資格；清點寫入排除不適用的組件與副本配對。
- 修改 `src/lib/shared-quantity-preview.ts`、`src/lib/sleeve-shortage.ts`，將適用性納入預覽及需求快照。修改 `src/components/admin/PhysicalComponentsPanel.astro`、`src/lib/physical-component-admin-controller.ts`，加入伺服器預渲染及列內切換、歷史與重試。
- 修改 `tests/component-applicability.test.ts`、`tests/physical-component-management.test.ts`。新增寫入前版本、簽章、庫存或封膜狀態改變時拒絕且無事件的案例，以及 API 清點與預覽整合案例。跨收藏／非候選的既有寫入斷言由 `APPLICABILITY_TARGET_INVALID` 改為 `APPLICABILITY_STATE_CHANGED`，因資格不符時現在由條件式 INSERT 在觸發器前拒絕；既有無寫入及世代不變斷言保留。
- 修改 `tests/admin-collection-detail-browser.mjs` 與 `tests/physical-quantity-browser.mjs` 的既有截圖輸出路徑，改用傳入的暫存輸出目錄以避免覆寫已審查資料夾。尚未新增瀏覽器情境或截圖。
- 以行程範圍 username preload 執行 `node --import tsx --test tests/component-applicability.test.ts tests/physical-component-management.test.ts tests/admin-component-classification.test.ts tests/admin-collection-detail.test.ts tests/physical-quantity-impact.test.ts tests/shared-quantity-commit.test.ts tests/d1-quantity-api.test.ts tests/d1-quantity-history.test.ts tests/d1-0023-review.test.ts tests/release-migration-chain.test.ts tests/sleeve-admin.test.ts tests/sleeve-shortage.test.ts`，退出碼 1。四種並行狀態變更皆有通過證據。輸出截斷，無完整合計。適用性缺世代案例的錯誤碼與既有預期有差異，新增 API 整合案例在首次預覽回 400，均待修正及重跑。
- 範圍外阻擋：`tests/d1-quantity-api.test.ts` 的 fixture 只到 0023，預覽因缺 0024 檢視而回 503。`tests/d1-0023-review.test.ts` 的 R06 等價案例將目前服務載入 0022 與 0023 schema，清點也依賴該檢視。兩檔均未列入 §7.2。需授權調整這兩個測試的本機 fixture，同時維持 0023 觸發器審查個案的原始驗證範圍。
- `git diff --check` 通過。0024 SHA-256 複核為 `1684b36a845a6d414c5ac8e01ca2608eb6e99492bca90a8e5a25a1188ef4f540`。Edge 驗收、完整 Astro check、build、卡套專用適用性案例及截圖待續。無新增或刪除檔案，無本輪暫存檔。未執行網路、遠端或正式操作。

**2026-11-26（Asia/Taipei）｜P0A-APP-AUTH-03，§7.4 本機驗證完成。**

本輪修改下列檔案，未刪除任何專案檔案。

- `tests/d1-quantity-api.test.ts`：預覽 fixture 從 0001～0023 擴充至 0001～0024，更新測試名稱。13 個子測試斷言均保留。
- `tests/d1-0023-review.test.ts`：只在 R06 清點服務等價案例的兩端套用 0024。0022 基準端仍未套用 0023；兩端均只讀 0024 的適用性檢視。等價性、無更正收據及業務欄位斷言均保留，其餘五個 0023 審查案例的 schema 與斷言維持原範圍。
- `tests/component-applicability.test.ts`：缺世代案例的寫入錯誤由 `APPLICABILITY_GENERATION_CHANGED` 改為 `APPLICABILITY_STATE_CHANGED`，因同一陳述式的世代關聯使 INSERT 寫入零列，先於觸發器拒絕。讀取錯誤仍為 `APPLICABILITY_GENERATION_CHANGED`，並加驗零事件。
- `tests/physical-component-management.test.ts`：測試請求在無操作鍵時省略 `Idempotency-Key`。首次預覽的 400 來自測試送入空標頭，服務契約依然要求完全省略。原預覽 200、不可清點 409、預覽失效、原實點及歷史斷言均保留。另加封存收藏拒絕 409 且零事件的案例。
- `tests/sleeve-shortage.test.ts`：新增已關聯需求只計入適用副本、指定不適用副本不產生缺口、未關聯需求照常展開三項斷言。其餘斷言均保留。
- `tests/physical-quantity-browser.mjs`：原有 12 項斷言保留，新增 3 項，驗證原地淡化未重載、重整後仍不適用、D1 排除數含不適用、另一副本可清點、恢復原實點及兩筆雙語歷史。
- `src/lib/physical-component-admin-controller.ts`：適用性歷史的即時新增改用 `appendChild`、`createTextNode`、`insertBefore`，排除 Cloudflare 型別對 DOM `append`／`prepend` 的兩項新診斷，保留即時呈現及順序。
- 本文件追加本輪結果，並在 [docs/P0A-screenshots/](P0A-screenshots/) 新增 12 張合成資料截圖。

每個 Node 測試檔各自執行 `node --import <行程範圍 username preload> --import tsx --test tests/<檔名>`。預載只處理 `uv_os_get_passwd ENOMEM`，使用合成帳號名稱。

| Node 測試檔 | 通過 | 失敗 |
| --- | ---: | ---: |
| `admin-collection-detail.test.ts` | 6 | 0 |
| `admin-component-classification.test.ts` | 6 | 0 |
| `admin-dashboard.test.ts` | 5 | 0 |
| `component-applicability.test.ts` | 16 | 0 |
| `component-classifier-adapter.test.ts` | 21 | 0 |
| `component-classifier.test.ts` | 32 | 0 |
| `d1-0023-review.test.ts` | 6 | 0 |
| `d1-quantity-api.test.ts` | 14 | 0 |
| `d1-quantity-history.test.ts` | 6 | 0 |
| `d1-quantity-preview-view.test.ts` | 2 | 0 |
| `physical-component-management.test.ts` | 9 | 0 |
| `physical-quantity-impact.test.ts` | 14 | 0 |
| `release-migration-chain.test.ts` | 5 | 0 |
| `shared-quantity-commit.test.ts` | 32 | 0 |
| `sleeve-admin.test.ts` | 7 | 0 |
| `sleeve-shortage.test.ts` | 15 | 0 |
| `sleeve-workflow.test.ts` | 9 | 0 |
| **合計** | **205** | **0** |

Edge 以 `node tests/<檔名> <絕對暫存路徑>` 執行，使用暫存 profile、`D1_A3_EDGE_LOCAL_TEST_MODE=1` 及本機 loopback。卡套工作流程腳本另外在行程內使用 tsx 和 Edge 啟動預載，以解析無副檔名的匯入並套用本機 Edge 參數。其他回歸截圖僅輸出到各自的暫存目錄。

| Edge 測試檔 | 通過 | 失敗 |
| --- | ---: | ---: |
| `physical-quantity-browser.mjs`（既有 12、新增 3） | 15 | 0 |
| `admin-collection-detail-browser.mjs` | 72 | 0 |
| `admin-dashboard-browser.mjs` | 7 | 0 |
| `sleeve-shortage-browser.mjs` | 8 | 0 |
| `sleeve-workflow-browser.mjs` | 4 | 0 |
| **合計** | **106** | **0** |

- 完整 `npm run astro -- check`（含同步）檢查 371 檔，**6 個既有錯誤、0 個新增錯誤、0 個警告、25 個提示**。6 個錯誤位於既有兩支 controller、共用數量提交測試及 Major03 fixture。
- `npm run build` **通過**，完成 `/about/`、`/blog/`、`/en/about/`、`/en/blog/` 的靜態預渲染。完整檢查與建置均在系統暫存的無機密隔離目錄執行。建置重跑將 Cloudflare 本機 registry 改用暫存路徑、停用 CF 資料抓取，並將代理的例外限於 loopback。
- `git diff --check` 通過。0024 SHA-256 複核為 `1684b36a845a6d414c5ac8e01ca2608eb6e99492bca90a8e5a25a1188ef4f540`。
- 截圖尺寸已核對。中文各有 `zh-before-confirm-{375,768,1280}.png`、`zh-after-confirm-{375,768,1280}.png`、`zh-history-{375,768,1280}.png`。英文有 `en-excluded-1280.png`、`en-restored-1280.png`、`en-history-1280.png`。畫面截取原生確認框出現前及接受後的頁面狀態，確認框型別與文案由 Edge DevTools 驗證。
- §7.4 指定本機項目均執行。未執行全面 WCAG AA 稽核、外網存取、遠端或正式操作、部署、commit 或 push。依 §7.2，交接回報集中於本節。程式仍依賴 0024 正式套用。

- 暫存清理未完成。已確認兩個資料夾直接位於系統暫存目錄，且樹內沒有重解析點。執行環境的安全審查拒絕遞迴刪除，殘留路徑為 `D:/TEMP/p0a-2f914a1c-732e-472d-8aae-cfbee259022c` 與 `D:/TEMP/p0a-astro-dc4a746b-8df3-406a-a1c3-2a4fdda64c2f`。

### 7.6 禁止事項

網路存取、任何遠端／正式操作、commit、push；git worktree、node_modules junction、**在 repo 內建立整份專案副本**；`git reset --hard`／`checkout -- .`／`clean`／`stash`；覆寫其他截圖資料夾；讀取或複製 `.env`、`.dev.vars`、`backups/`、`*.sql` 備份。暫存資料放在 repo 外的系統暫存目錄，結束前自行清除。

### 7.7 Claude 審查（2026-11-26）

**結論：`P0A-APP-20261126-01` 通過**，沒有必修項目。工作樹另有 3 個小觀察，可之後一起處理。

**本人驗證**

- Node：以 §7.5 同一組 17 個測試檔合跑 `node --import tsx --test …`，**205 通過、0 失敗**。本人的環境沒有遇到 ENOMEM，不需要 preload。
- Edge：`D1_A3_EDGE_LOCAL_TEST_MODE=1 node tests/physical-quantity-browser.mjs <scratchpad 暫存目錄>`，**15 通過、0 失敗**，其中 3 項是適用性案例。其他 4 支 Edge 腳本、`astro check` 和 `build` 沒有重跑，結果以 §7.5 為準。
- `git diff --check` 通過。0024 SHA-256 仍是 `1684b36a…f540`，未被修改。
- 看過的截圖：`zh-after-confirm-1280`、`zh-history-375`、`en-history-1280`。不適用列會隱藏輸入、顯示「此副本不適用」與「恢復適用」；歷史以台北時間顯示，中英兩組都正確，375 寬沒有橫向捲動。

**逐項核對 §7.3**

1. `applicability` 動作：`verifiedPhysicalProof` 確認組件；寫入用單一 `INSERT … SELECT`，在同一陳述式核對組件 revision、簽章、副本「在藏且未封膜」與收藏世代，零列就回 `APPLICABILITY_STATE_CHANGED` → 409。這修好了 §7.5 第一輪指出的「先查再寫」並行漏洞，符合 AGENTS.md 4-4。錯誤碼對應符合規格，`TARGET_INVALID` 已併入 409。
2. 清點守衛：`count` 的條件寫入加上 `NOT EXISTS`（不適用就不寫）。寫入零列時再查一次，是不適用就回 `COMPONENT_NOT_APPLICABLE`，中英訊息都有。失敗關閉由伺服器保證。
3. D1 預覽：在同一個 SELECT 用純量子查詢讀取適用性，不是複合 SELECT，不受 #10 的段數上限影響。預覽憑證與 baseline 結構沒變；切換會讓世代 +1，舊預覽在提交時失效。
4. 卡套不足：`db.batch()` 增加第 6 條讀取。已關聯組件的需求會跳過不適用的副本；指定副本又不適用時跳過該需求；所有適用副本都排除時不算缺口；未關聯組件照舊展開；有 `unknown` 副本時仍標示資料不完整。
5. 畫面：原地切換不重載；未儲存的實點會在確認框提示捨棄；恢復後顯示原本的實點（S3-B）。結果不明時，「重試」會先重抓頁面，用 revision 判斷是否其實已成功。
6. 適用性歷史：唯讀，有空狀態，時區是 Asia/Taipei，操作人是 Access subject。

**小觀察（不擋上線）**

- O1：「淡化」只有 5% 底色，截圖上幾乎看不出來；文字與按鈕仍是正常對比。若要更明顯，可以改成文字降一階顏色或加左側色條，但要維持 WCAG AA 對比。
- O2：切換適用性失敗、尚未重試時，若先換副本，`render()` 會清掉待重試狀態。伺服器的 revision 守衛仍會擋下舊請求，不會寫錯；這和既有清點列的行為一樣。
- O3：`changeComponentApplicability` 新增兩個必填參數 `definitionRevision`、`signature`（AUTH-02 已授權），呼叫端只有 `writePhysicalComponent` 與測試。

**上線前提（重要）**

- 這次的改動讓 R06 頁、清點寫入、D1 預覽與卡套不足（R01 卡片、卡套尺寸頁）都要讀 `v2_component_applicability_current`。**0024 沒有正式套用前就部署，這幾頁都會回 503**。推送 `main` 會自動部署，所以順序必須是：提交（不推送）→ 0024 正式套用並對帳 → 推送部署 → 正式驗收。
- `main` 目前比 `origin/main` 多 4 個提交（含 `83cc6bf`）。工作樹變更還沒提交。
- Codex 殘留兩個暫存資料夾（`D:/TEMP/p0a-2f914a1c-…`、`D:/TEMP/p0a-astro-dc4a746b-…`），由使用者決定刪除方式。

## 8. 正式套用 0024（P0A-APPLY，比照 0025 §9，每步另行授權）

### 8.1 A0 本機提交

`83cc6bf`（0024 修訂）與 `8a0a9f7`（P0A-APP 程式）已在本機提交，未推送（2026-11-26）。

### 8.2 A1 唯讀預檢（2026-11-26，Claude 執行，使用者授權）

遠端操作：Metadata 1 次（`wrangler deployments status`）、唯讀 SELECT 2 次（第一次用 `--file`，不回傳結果列；第二次用 `--command` 跑同一查詢），寫入 0。查詢檔放在 scratchpad，不加入 repo。

| 項目 | 預期 | 實際 | 結果 |
| --- | --- | --- | --- |
| 流量版本 | 目前 `origin/main`（`0c47b36`）的部署 | `91ef7459`（100%，建立於台北 2026-11-25 23:37），即 #12 R06-MIN 部署 | 符合 |
| `d1_migrations` | 24 筆，最後一筆是 0025，沒有 0024 | 24 筆，最後 `0025_sleeve_gift_and_ledger_locks.sql`，0024 為 0 筆 | 符合 |
| 0024 物件（表、2 個索引、view、4 個觸發器，加上舊的 coverage 表名） | 0 個存在 | 0 | 符合 |
| 依賴物件（`d1_quantity_collection_generation`、`v2_owned_copies`、`v2_component_definitions`、`v2_collection_items`、view `v2_physical_component_candidates`） | 5 個存在 | 5 | 符合 |
| 資料筆數 | — | 收藏 256、副本 0、組件定義 178、實體組件候選 0、清點列 0、世代列 256、卡套需求 786、卡套交易 0、卡套產品 0 | 副本 0，所以套用不會碰到任何既有資料 |
| 使用者確認期間沒有其他更新 | 使用者在對話中回答 | 使用者回答「確認沒有」（2026-11-26） | 符合 |

**A1 全數通過。**

註：CURRENT_TASK 頂端的「正式環境現況」寫的是 `13f7be9b`，但之後 #12 已部署 `91ef7459`，以實際查到的為準。D1 大小 1.93 MB，共 51 張表。

### 8.3 A2 備份與本機預演（2026-11-26，Claude 執行，使用者授權）

- **官方 Export 1 次**（唯讀）：`wrangler d1 export boardgame-collection-db --remote` → `D:/CodexHome/private-0024-backup-9621f3d7540a/boardgame-collection-db-before-0024.sql`。資料夾在專案外，停用繼承，只有目前網域使用者有 FullControl，沒有加入 Git。檔案 2,145,132 bytes，SHA-256 `1783b36c5918aab185f4fe66dc85f3ae05527286b89dbb24721f0a92dd18fb69`。wrangler 輸出的一小時有效下載連結沒有記錄。內容沒有輸出，只解析了 schema 語句的開頭，用來診斷還原順序。
- **組合檔**：0024 原檔（SHA-256 `1684b36a…f540`，和審查時相同）加上 `INSERT INTO d1_migrations(name) VALUES ('0024_component_applicability.sql');`，組合檔 SHA-256 `a37db0c4f147bd110c5cc7a8bc8e0f7f644c401a2e78e3042689ab8ed48d882d`。放在 scratchpad，不加入 repo。
- **本機預演**（`node:sqlite` 記憶體資料庫，scratchpad 腳本只輸出計數）：
  - 還原時先關閉外鍵檢查。匯出檔會在 `collection_components` 建立前就插入 `sleeve_requirements` 的子列，`node:sqlite` 預設開啟外鍵檢查，第一次還原因此失敗，還沒執行到 0024。之後在開啟外鍵的狀態下，把組合檔放進一筆交易執行。
  - 還原後的數值和 A1 正式查詢完全相同：ledger 24、最後一筆 0025、0024 物件 0、收藏 256、副本 0、定義 178、清點 0、世代列 256、卡套需求 786、卡套交易 0、卡套產品 0。
  - 套用組合檔**成功**：ledger 25 筆、最後一筆 `0024_component_applicability.sql`；0024 物件 8／8；schema 物件 270 → 278（正好增加 8）；所有資料筆數不變；世代總和 256，沒有變；事件 0、目前值 0。
  - `PRAGMA foreign_key_check` 0 筆違規；`integrity_check` 回 `ok`。
- 遠端操作：Export 1 次，寫入 0。**A2 全數通過。**

### 8.4 A3 正式套用（2026-11-26，Claude 執行，使用者授權「只做 A3＋A4」）

- 執行前複核：0024 SHA-256 `1684b36a…f540`、組合檔 SHA-256 `a37db0c4…882d`，都和審查、預演時相同；`migrations/` 和 HEAD 沒有差異。
- 台北 2026-11-26 08:18:06～08:18:15，執行 `wrangler d1 execute boardgame-collection-db --remote --json --yes --file <組合檔>`，**正式寫入只有這 1 次**；沒有使用 `migrations apply`。
- 結果：結束碼 0、`success: true`、`changed_db: true`、執行 9 個查詢、寫入 13 列、`last_row_id` 25；資料表 51 → 52；D1 大小 1.94 MB。

### 8.5 A4 套用後唯讀對帳（2026-11-26，台北 08:18:31 起）

- 唯讀 SELECT 2 次：對帳 1 次，加上 1 次確認 D1 內部表。
  - ledger 25 筆，最後一筆是 `0024_component_applicability.sql`，比 A1 多 1 筆。
  - 0024 物件 8／8；coverage 表 0。
  - 事件 0、目前值 0。
  - 收藏 256、副本 0、定義 178、清點 0、世代列 256、世代總和 256、卡套需求 786、交易 0、產品 0，都和 A1 相同。
  - `pragma_foreign_key_check` 0 筆違規。
  - schema 物件正式 279 筆、預演 278 筆，差的 1 筆是 D1 內部表 `_cf_KV`（匯出檔不包含），所以兩者一致。
- 正式網站唯讀抽查 9 條，全部符合：公開頁 `/`、`/collection`、`/games`、`/about/` 回 200；`/admin`、`/admin/sleeves?view=sizes`、`/admin/collection/102/components`、`/api/admin/sleeves` 回 302 轉到 Access；`/dev/ui-kit` 回 404。
- **A3＋A4 全數通過。** 0024 已在正式環境就位。正式環境目前跑的程式仍是 `91ef7459`，它不讀 0024 的物件，所以新增這些物件沒有影響。
- 遠端操作合計（A1～A4）：Metadata 1、SELECT 5（A1 2、A4 2，另有 1 次 `_cf_` 確認算在 A4 內）、Export 1、正式寫入 1、HTTP 抽查 9。
- **還沒做**：推送 `main`（自動部署 `8a0a9f7` 等 P0A-APP 程式）和登入後的正式驗收，依 DEPLOY-01 需要另外授權。`migrations/` 已經沒有未套用的檔案。是否改回使用 `wrangler d1 migrations apply`，之後另行決定（§5 第 4 步）。

### 8.6 部署 P0A-APP（2026-11-26，Claude 執行，使用者授權「提交文件後推送」）

- 提交 `dee0033`（0024 套用紀錄文件）後，在台北 08:20:43 推送 `0c47b36..dee0033`，共 6 個提交，含 `83cc6bf`、`8a0a9f7`。
- Workers Builds 自動部署為 `8bd8b196`（100%，台北 08:21:38），距離 A3（08:18:15）約 3.5 分鐘。這段空窗期跑的是舊程式，不讀 0024 的物件，沒有影響。
- 唯讀抽查 16 條路由，全部符合：
  - 公開頁 `/`、`/collection`、`/games`、`/en/games`、`/about/`、`/games/bgg-451166` 回 200。
  - `/games/bgg/451166` 回 307；`/games/bgg/2147483647` 回 404。
  - `/admin`、`/admin/collection`、`/admin/collection/102/components`、`/admin/sleeves?view=sizes`、`/api/admin/sleeves`、`/api/admin/auth-check` 回 302 轉到 Access。
  - `/dev/ui-kit`、`/dev/collection-v2-test` 回 404。
- 遠端操作：推送 1 次、Metadata 輪詢（部署狀態）約 4 次、HTTP 16 次；D1 查詢與寫入 0。
- **待做**：使用者登入後，由 Claude 唯讀檢查 R06（含適用性歷史）、R01 卡套狀況和卡套尺寸頁，確認讀取 0024 檢視的頁面沒有回 503。正式環境 0 個副本，所以「此副本不適用」的切換要等第一次建立副本與組件時再確認，併入 #23。

### 8.7 正式驗收（2026-11-26，使用者登入後由 Claude 唯讀檢查）：通過

使用者在台北約 08:25 於瀏覽器面板完成 Access 登入。Claude 只讀取頁面，沒有新增或儲存任何資料。

- **R01 `/admin`**：HTTP 200。卡套狀況為「卡套尺寸數 116／有需求紀錄 786／庫存不足 0／資料不完整 0」，組件狀況為「組件定義數 178／實體組件紀錄 0」，收藏總數 256、已收藏 254，待處理項目「目前沒有待處理項目」，沒有「無法取得」。卡套數字和 #27、#28 驗收時相同。這頁的卡套數字由 `readSleeveShortage` 算出，現在會多讀 0024 的檢視。
- **卡套尺寸頁 `/admin/sleeves?view=sizes`**：HTTP 200，第 1 頁 20 列都是「尚無產品」，沒有錯誤訊息，和 #27 驗收時相同。
- **R06 `/admin/collection/102/components`**：中文與 `?lang=en` 都回 HTTP 200，沒有 503。頁面顯示「沒有可清點的在藏未封膜副本」「尚無由受控流程建立的組件」，符合正式環境 0 副本、0 實體組件的狀況。因為沒有組件，「適用性歷史」區塊與「此副本不適用」按鈕不會出現（數量 0，符合預期）。這頁伺服器端會讀 `readApplicabilityHistory`，已確認可以正常讀取。
- **沒驗收到的部分**：適用性切換、歷史列表、D1 預覽排除不適用副本，都需要至少 1 個副本和 1 個已確認組件，正式環境目前沒有。依 AGENTS.md「不補造資料」，等使用者第一次建立副本與組件時再確認，併入 CURRENT_TASK #23。這些行為已經由本機 Edge 驗收（§7.5、§7.7）涵蓋。
- **結論：R06-P0-A（#13 的 0024、#14 的 P0-A）正式上線並通過驗收。**
