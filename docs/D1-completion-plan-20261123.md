# D1 完成規劃｜共用預期數量更正

2026-11-23（Asia/Taipei），Claude 起草。狀態：Q1～Q3 已於 2026-11-23 採納（DECISION_LOG D1-PLAN-Q1～Q3，Q2 附條件）；Q4 待階段 B 再決定。各工作命令仍須逐張批准。對應 CURRENT_TASK #1a。

依據（已採納）：D1 第一版方案 A、D1 勘誤證據保存方案 A、D1-17、D1-18（[台帳](Decision-Ledger-20261119.md)）、D1-AUTH-01（[DECISION_LOG](../DECISION_LOG.md)）。規格：[第一版範圍與驗收 D1-01～D1-09](V2-D1-expected-quantity-correction-scope.md)、[v2 整合設計 D1-10～D1-16](V2-D1-correction-state-and-storage-review-v2.md)。

## 1. 現況盤點（2026-11-23 靜態閱讀，未執行新測試）

| 區塊 | 檔案 | 狀態 | 說明 |
| --- | --- | --- | --- |
| 提交引擎 | [shared-quantity-commit.ts](../src/lib/shared-quantity-commit.ts) | 已實作，只被測試呼叫 | `q1.` 操作識別與內容指紋綁定；不可變回執 `d1_quantity_changes`；查詢狀態；結果分「已提交／永久拒絕／未知」。`verifyConfirmation` 留給未來「預覽確認」呼叫端，目前**沒有正式呼叫端** |
| Schema | [0023](../migrations/0023_shared_quantity_commit.sql) | 候選，未審查、未套用 | 收藏世代表＋約 45 個 trigger（任何相關寫入遞增世代）；回執表不可改、不可刪；寫入回執時由 trigger 同步更新共用預期量（單一寫入驅動更新，滿足 D1-11 原子性）；`evidence_json` 保存各副本當時實點快照（D1-18） |
| 影響預覽 | [physical-quantity-impact.ts](../src/lib/physical-quantity-impact.ts) | 已實作，只被測試呼叫 | 計算更正前後每盒「少幾張」。**依賴 0024 的逐副本適用性**（`validApplicabilityGeneration`） |
| 適用性 | [component-applicability.ts](../src/lib/component-applicability.ts)、[0024](../migrations/0024_component_applicability.sql) | 候選 | 屬 R06-P0-A，不在 D1 第一版（S4-A 維持共用定義）範圍 |
| 伺服器 API | [physical-component-management.ts:153](../src/lib/physical-component-management.ts) | 過渡 | 改預期量一律回 409 `D1_QUANTITY_PREVIEW_REQUIRED`；有 `quantity-status`；**沒有預覽與確認提交動作** |
| 前端 | [physical-component-admin-controller.ts](../src/lib/physical-component-admin-controller.ts) | 過渡（D1-FIX-20261123-01） | 顯示「預覽確認開發中」；任何 4xx 都清除待處理操作（**必修**，見 HANDOFF 2026-11-23 審查紀錄） |
| 勘誤公告與審查狀態 | — | **不存在** | 無公告表、無 `PENDING／NOT_APPLICABLE／APPLIED` 目標審查、無公告版本 |
| 更正歷史檢視 | `d1_quantity_history` view | 只有 view | 無 API、無畫面 |
| 測試 | `shared-quantity-commit`、`physical-quantity-impact`、`component-applicability` 三支 | 共 44 個 test 區塊 | 皆為隔離 SQLite，未在 Miniflare／正式資料量驗證 |

### 發現的落差

1. **`databaseEpoch` 沒有正式來源**：只有測試寫死字串。預覽需要一個代表「這個資料庫」的穩定值，否則跨環境的確認可能被誤用。
2. **預覽依賴 0024**：D1 第一版不需要逐副本適用性，但影響預覽程式要求它。
3. **兩條更正路徑只做了一條的底層**：提交引擎是「手誤修正」與「勘誤」共用的底層；勘誤要另外記公告版本、適用範圍與審查依據（D1-17），目前完全沒有。
4. **0023 影響面大**（Project-Review F6）：45 個 trigger 會加在所有收藏／副本／組件／清點寫入上，未量測效能，trigger 錯誤碼（如 `D1_QUANTITY_STATE_CHANGED`）尚未對應到 API 回應。
5. **錯誤被吞**（F5）：提交引擎四處 `.catch(() => null)` 直接回「未知」，沒有可追溯紀錄。

## 2. 建議分兩階段

- **階段 A：手誤修正可用**。管理員在 R06 改預期量 → 看預覽（每盒更正前後差額）→ 填理由確認 → 原子提交並留歷史 → 可查歷史。涵蓋 D1-01、D1-04、D1-05、D1-10～D1-13、D1-16。這是最快能實際用的功能，且底層已大致完成。
- **階段 B：勘誤公告路徑**。登記公告、逐目標審查、確認全範圍後套用。涵蓋 D1-02、D1-03、D1-06～D1-09、D1-14、D1-15。需要新 Migration（0025）與新畫面，另做設計審查。

理由：階段 A 只缺「接線＋畫面」，階段 B 是新資料模型。先上 A 可以盡早取代過渡的 409，也讓 0023 先經過實際使用。

## 3. 工作命令拆分（階段 A，依序）

| 順序 | 工作命令 ID（暫定） | 內容 | 負責 | 前置 |
| --- | --- | --- | --- | --- |
| A1 | D1-0023-REVIEW-01 | **0023 審查與本機驗證**：在隔離 SQLite 套 0001～0023，用接近正式資料量的合成資料量測 trigger 寫入成本；列出 trigger 錯誤碼對 API 回應的對照；Claude 審查 SQL。不碰正式 D1 | Claude 審查、Codex 量測 | 本計畫批准 |
| A2 | D1-API-01 | **預覽與確認 API**：新增 `quantity-preview`（回每盒影響、簽章預覽憑證、`q1.` 操作識別）與 `quantity-commit`（驗證預覽憑證後呼叫 `commitSharedQuantity`）；加入 `databaseEpoch` 來源；預覽第一版不依賴 0024；修 F5（錯誤留可追溯紀錄）；測試涵蓋 D1-01／04／10～13 | Codex | A1、決策 Q1～Q3 |
| A3 | D1-UI-01 | **預覽確認畫面與前端流程**：改量後顯示預覽面板（更正前後每盒差額、理由必填、確認／取消）；結果「未知」時用原識別查詢；**只在原操作送出得到 4xx 時清除待處理操作**，查詢請求的 4xx 不清除。先給使用者看畫面比較再實作（AGENTS 第 5 節 UI 逐頁確認） | Claude 出畫面、使用者確認、Codex 實作並截圖 | A2 |
| A4 | D1-HIST-01 | **更正歷史檢視**：在組件卡或組件管理區顯示該定義的更正紀錄（前後值、理由、操作者、時間、當時每盒判讀）；缺資料顯示 `UNKNOWN` | 同 A3 | A2 |
| A5 | D1-REL-01 | **正式套用 0023 與部署**：建置、備份、套用 0023、部署、唯讀驗收 | 使用者授權 | A1～A4 驗收通過 |

A3 與 R06 改版（UI-D8，整頁共用副本選擇）會改同一頁。建議 A3 的預覽面板做成獨立元件，R06 改版時直接沿用，避免做兩次。

## 4. 待使用者決策

| # | 問題 | 建議 | 理由 |
| --- | --- | --- | --- |
| Q1 | 是否分兩階段，先做手誤修正（階段 A），勘誤公告（階段 B）之後另行設計？ | **是** | 階段 A 底層已有，能最快取代「開發中」提示 |
| Q2 | 採用 0023 的技術路線（收藏世代＋不可變回執＋回執驅動更新＋`q1.` 內容綁定識別）作為原「待選型」的整盒守衛與冪等方案？前提是 A1 驗證通過 | **是，附條件** | 已實作且符合 D1-10～D1-13 的契約；換路線要重寫。若 A1 量測效能不可接受再回頭 |
| Q3 | 預覽第一版是否先不依賴 0024（所有在藏副本都視為適用共用定義，符合 S4-A）？ | **是** | 0024 屬 R06-P0-A，綁在一起會拖慢 D1 |
| Q4 | 勘誤公告的原始依據第一版是否只存網址與文字摘錄，不支援上傳附件？ | **是**（階段 B 才用到，可之後再答） | 附件需要另外的儲存與保留政策（v2 §6 P1） |

## 5. 非目標

逐副本適用性（R06-P0-A）、使用者清點日期（R06-P0-B）、整盒進度（R06-P0-C）、R06 版面改版本身、0024 套用。本計畫批准不等於授權任何程式修改、測試執行、Migration 或部署；每張工作命令各自批准。

## 6. 工作命令 A1（2026-11-23 已授權，DECISION_LOG D1-A1-AUTH）

```text
工作命令 ID：D1-0023-REVIEW-20261123-01
工作目標：驗證候選 Migration 0023 能否作為 D1 階段 A 的底層（DECISION_LOG D1-PLAN-Q2 的通過條件）。
  只做量測與對照，不改 0023、不改產品程式碼。

已批准規格：
  - DECISION_LOG D1-PLAN-Q1～Q3、D1-AUTH-01
  - 台帳 D1-17、D1-18、D1 第一版方案 A
  - docs/V2-D1-correction-state-and-storage-review-v2.md §3、§5（D1-10～D1-13）

允許修改範圍（只新增）：
  - tests/d1-0023-review.test.ts（新檔：量測與錯誤碼對照）
  - docs/D1-0023-review-20261123.md（新檔：結果報告）
  不得修改 migrations/、src/、既有測試。

允許執行的驗證：
  1. node --import tsx --test tests/d1-0023-review.test.ts
  2. node --import tsx --test tests/shared-quantity-commit.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts
  3. git diff --check
  資料來源：只能用 node:sqlite 記憶體資料庫（沿用 tests/helpers/sqlite-d1.ts）
  與程式產生的合成資料。不得讀取 backups/、*.sql 匯出檔、.dev.vars、.env。

量測內容：
  A. 效能：同一份合成資料分別建「0001～0022」與「0001～0023」兩個資料庫，
     規模至少：收藏 1,000、副本 3,000、組件定義 10,000、清點列 30,000、狀態標籤 3,000。
     對下列寫入各跑 200 次以上，報告兩邊的中位數與 p95（毫秒）及倍率：
       新增收藏、改副本欄位、新增組件、改組件名稱、清點 upsert、封存收藏、新增舊 ID 對照。
     另量測一次 commitSharedQuantity 成功提交的耗時，以及 d1_quantity_admission
     在單一定義有 200 個副本時的讀取耗時。
  B. 錯誤碼對照：逐一觸發 0023 每個 RAISE（D1_INITIAL_MARKER_FORBIDDEN、
     D1_REVISION_REGRESSION、D1_MARKER_WITHOUT_CHANGE、D1_CURRENT_OPERATION_REQUIRED、
     D1_HISTORY_IMMUTABLE、D1_HISTORY_EXISTS、D1_QUANTITY_STATE_CHANGED、
     D1_EXPECTED_ONE_DEFINITION_UPDATE，以及世代表與 no_replace 系列 trigger 的訊息），
     記錄：觸發的操作、目前哪個 API／服務函式會遇到、該函式現在回給使用者的 HTTP 狀態與代碼。
     沒有任何呼叫端會遇到的標「不可達」。
  C. 既有寫入路徑回歸：確認 R06 一般編輯、清點、卡套指派、建立組件，以及其他 v2 寫入
     （副本、收藏管理、採購）在套用 0023 後行為不變；有差異逐條列出。

禁止事項：
  - 修改 0023 或任何 migration；修改 src/；新增依賴；改 package.json。
  - 連線正式或遠端 D1、wrangler d1 任何指令、部署、建置。
  - 讀取或輸出機密檔與資料庫備份。
  - 量測結果不得用推估值補洞；跑不出來的項目標 UNKNOWN 並說明原因。

完成條件：
  - 驗證指令 1～3 實際執行並附輸出摘要。
  - 報告含 A 的數字表、B 的完整對照表、C 的差異清單。
  - 報告明確列出：node:sqlite 與 Cloudflare D1 的差異（無網路往返、batch 行為由 helper 模擬），
    說明這些數字只能作相對比較。

預期交付成果：
  - 新增檔案清單與內容摘要。
  - 測試輸出（通過／失敗數）。
  - 未執行或無法執行的項目及原因。
```

### Claude 審查時的通過標準（供使用者參考）

- 套用 0023 後，一般寫入中位數增加在 **2 倍以內**、單筆仍在個位數毫秒等級，視為可接受；超過則帶數字回報使用者決定，不自行放寬。
- B 表中所有「可達」的錯誤碼都有明確對應；沒有對應的列入 A2（預覽與確認 API）必修項目。
- C 沒有非預期的行為改變。

## 7. A2 設計：預覽與確認 API（2026-11-23 已採納，DECISION_LOG D1-A2-AUTH）

2026-11-23 起草。依據：D1-PLAN-Q1～Q3、D1-A1-PASS、[A1 報告](D1-0023-review-20261123.md)。

### 7.1 流程

1. 管理員在組件編輯表單改預期量，**同時填寫更正理由**（理由是操作指紋的一部分，必須在預覽前確定）。
2. 前端送 `quantity-preview`。伺服器檢查資格、比對目前值，回傳每盒影響、操作識別與簽章預覽憑證。**不寫入任何資料。**
3. 管理員看過預覽後按確認。前端先把「操作識別＋請求內容」存進 sessionStorage，再送 `quantity-commit`。
4. 結果不明時，前端用同一個識別與內容送 `quantity-status` 查詢，不換識別重做。

一般 `edit` 動作改預期量時，維持回 409 `D1_QUANTITY_PREVIEW_REQUIRED`，舊頁面不會繞過預覽。

### 7.2 API 契約（同一個端點 `/api/admin/collection/components`，沿用既有授權、同源與限流）

| 動作 | 請求 | 伺服器行為 | 回應 |
| --- | --- | --- | --- |
| `quantity-preview` | `definitionId`、`definitionRevision`、`previousExpected`、`expected`、`name`、`type`、`unit`、`reason`；不帶 Idempotency-Key | 驗證組件資格（沿用 `verifiedPhysicalProof`）；revision 與目前預期量須等於請求值；讀收藏世代、記錄範圍、證據快照，算 `evidenceDigest`；組出 `QuantityBaseline` 與 `q1.` 操作識別；把證據快照轉成影響列（Q3：所有列出的副本一律視為適用，`applicability` 以 revision 0、目前世代填入），呼叫 `projectQuantityImpact` | 200：`{ operationId, baseline, previewToken, impact }`。409 `COMPONENT_STATE_CHANGED`（值或 revision 已變）、409 `COMPONENT_INELIGIBLE`、409 `D1_EVIDENCE_TOO_LARGE`（單一定義超過 200 盒或 256 KB）、503 `EVIDENCE_UNAVAILABLE`（全域分類列數超過 10,000） |
| `quantity-commit` | Idempotency-Key = `operationId`；body：預覽時的全部欄位＋`baseline`＋`previewToken` | 以 HMAC 驗證 `previewToken` 作為 `verifyConfirmation`；**寫入前**先檢查全域分類列數，超過就不送出寫入；呼叫 `commitSharedQuantity` | 見 7.3 |
| `quantity-status` | Idempotency-Key = `operationId`；body 同 `quantity-commit` | 呼叫 `confirmedQuantityOperationStatus`，不寫入 | 見 7.3；**業務結果一律 200**，只有授權、格式錯誤才回 4xx |

`previewToken` = HMAC（沿用 `PHYSICAL_COMPONENT_SIGNING_KEY` 與 `physical-component-proof.ts`）簽 `['d1-quantity-preview-v1', actor, operationId, edit 全部欄位, baseline 全部欄位]`。不另設時效：預覽後任何相關寫入都會推進收藏世代，舊預覽會被提交引擎判為 `D1_CONFIRMATION_SUPERSEDED`。

### 7.3 結果欄位（A3 前端只看 `outcome`，不看 HTTP 狀態）

`quantity-commit` 與 `quantity-status` 的回應一律帶 `outcome`：

| outcome | 意義 | `quantity-commit` HTTP | 前端（A3）處理 |
| --- | --- | --- | --- |
| `COMMITTED` | 已提交（含重送取得原結果，`replayed: true`） | 200 | 清除待處理，顯示新值 |
| `NOT_COMMITTED` | **確定沒有寫入**，附 `code`：`D1_CONFIRMATION_SUPERSEDED`、`COLLECTION_ARCHIVED`、`D1_PREVIEW_INVALID`、`IDEMPOTENCY_CONFLICT`、`EVIDENCE_UNAVAILABLE`（寫入前檢查超限） | 409；超限為 503 | 清除待處理，提示重新預覽 |
| `UNKNOWN` | 已嘗試寫入但結果不明 | 503，`code: D1_RESULT_UNKNOWN` | 保留待處理，提供「查詢結果」 |

這同時解決 HANDOFF 記錄的必修項：前端改為依 `outcome` 判斷，`quantity-status` 的業務結果不再以 4xx 回傳，所以查詢不會誤清待處理操作。

### 7.4 提交引擎必修（A1 審查與 F5）

1. **超限不得回 `UNKNOWN`**：在送出 INSERT 前讀 `d1_quantity_admission.classification_rows`，超過 10,000 就回 `NOT_COMMITTED` + `EVIDENCE_UNAVAILABLE`。只有實際送出寫入後失敗，才可回 `UNKNOWN`。
2. **錯誤可追溯（F5）**：所有 `.catch(() => null/undefined)` 改為記錄錯誤類型與操作識別（`console.error`，不含使用者輸入與機密），回傳語意不變。
3. 新增 `PERMANENTLY_REJECTED` → `NOT_COMMITTED` 的對外命名轉換；內部型別可保留。

### 7.5 `databaseEpoch`（2026-11-23 採方案 A，DECISION_LOG D1-PLAN-Q5）

用途：讓本機或備份資料庫產生的預覽，不能拿到正式資料庫確認。

| 方案 | 作法 | 優點 | 缺點 |
| --- | --- | --- | --- |
| **A（建議）** | 在候選 0023 內加一張單列表 `d1_quantity_epoch`，Migration 執行時以 `lower(hex(randomblob(16)))` 產生 | 每個資料庫自動不同，不用改設定、不用管理變數 | 要改候選 0023（尚未部署，可改），需重跑 A1 的 0023 相關測試 |
| B | `wrangler.json` 加非機密變數 `D1_DATABASE_EPOCH`，本機另設不同值；缺值時預覽回 503 | 不動 0023 | 改高敏感設定檔；兩邊值要人工維持不同 |

從備份還原的資料庫會沿用相同 epoch。這是同一份資料的延續，可接受。

### 7.6 驗收（A2 範圍）

D1-01（103 → 100、實點 99、checked 與日期保留）、D1-04（超量保留）、D1-10（一致性、只改名不產生更正紀錄）、D1-11（零列與寫入失敗不留半套用）、D1-12（回應遺失後重送取得原結果、同識別異內容拒絕）、D1-13（兩個識別競爭只成功一筆、一般編輯撞更正、封存後拒絕），另加：竄改或他人的 `previewToken` 回 `D1_PREVIEW_INVALID`；超限在寫入前回 `NOT_COMMITTED`；`quantity-status` 業務結果皆 200。

## 8. 工作命令 A2（2026-11-23 已授權，DECISION_LOG D1-A2-AUTH）

```text
工作命令 ID：D1-API-20261123-01
工作目標：完成 D1 階段 A 的伺服器端：預覽、確認提交、結果查詢三個動作，
  以及提交引擎的必修項。不含任何畫面（屬 A3）。

已批准規格：
  - DECISION_LOG D1-PLAN-Q1～Q3、D1-A1-PASS、D1-PLAN-Q5、D1-AUTH-01
  - docs/D1-completion-plan-20261123.md §7（7.1～7.6 全部，本工作命令批准即採納該設計）
  - 台帳 D1-17、D1-18；docs/V2-D1-correction-state-and-storage-review-v2.md §3、§5

允許修改範圍：
  - migrations/0023_shared_quantity_commit.sql：只可新增單列表 d1_quantity_epoch
    （id 固定為 1、epoch 由 lower(hex(randomblob(16))) 產生、禁止 UPDATE／DELETE 的 trigger）
    與其 INSERT。不得改動 0023 其他既有內容。
  - src/lib/shared-quantity-commit.ts（§7.4 必修：寫入前超限檢查、F5 錯誤紀錄、outcome 命名）
  - src/lib/shared-quantity-preview.ts（新檔：預覽計算、baseline 與憑證簽發／驗證）
  - src/lib/physical-component-management.ts（高敏感區，本工作命令授權：只可新增
    quantity-preview／quantity-commit 分派，並將 quantity-status 改為 §7.2 新契約；
    edit／count／assign／create 的既有行為不得改變）
  - src/lib/physical-component-admin-api.ts（只可加入 outcome 與 HTTP 狀態對應）
  - tests/d1-quantity-api.test.ts（新檔）
  - tests/shared-quantity-commit.test.ts、tests/physical-component-management.test.ts、
    tests/d1-0023-review.test.ts：只可為配合新契約或 epoch 表做必要調整，不得刪除既有斷言的意圖

允許執行的驗證：
  1. node --import tsx --test tests/d1-quantity-api.test.ts tests/shared-quantity-commit.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts tests/d1-0023-review.test.ts
  2. npm run astro -- check（基準 14 個既有錯誤，新增須為 0）
  3. git diff --check
  資料來源：只限 node:sqlite 記憶體資料庫與合成資料。
  若 tsx 遇 ENOMEM，可沿用 A1 的程序限定 NODE_OPTIONS 相容作法，並在報告說明。

驗收（測試須涵蓋）：
  - D1-01、D1-04、D1-10～D1-13（細節見 §7.6）
  - 預覽不寫入任何資料（前後列數與世代不變）
  - previewToken 竄改、換操作者、換 epoch 皆回 NOT_COMMITTED + D1_PREVIEW_INVALID
  - 全域分類列數超過 10,000：預覽回 503 EVIDENCE_UNAVAILABLE；確認在寫入前回 NOT_COMMITTED，且無寫入嘗試
  - quantity-status 的業務結果一律 HTTP 200 並帶 outcome
  - 一般 edit 改預期量仍回 409 D1_QUANTITY_PREVIEW_REQUIRED
  - 兩個不同資料庫（各自套用 0023）產生的 epoch 不同，跨庫憑證被拒

禁止事項：
  - 修改 src/lib/physical-component-admin-controller.ts、manage.astro 及任何畫面（屬 A3）
  - 修改 0024、其他 migration、wrangler.json、package.json、astro.config.mjs；新增依賴
  - 連線正式或遠端 D1、wrangler d1 指令、建置、部署
  - 讀取 backups/、*.sql 匯出檔、.env、.dev.vars
  - 回應或紀錄中輸出機密、簽章金鑰、使用者輸入全文

完成條件：
  - 驗證指令 1～3 實際執行並附通過／失敗數
  - 每項驗收對應到測試名稱
  - 列出所有變更檔案與摘要；對 0023 的變更附完整 diff

預期交付成果：
  - 變更檔案清單、測試輸出摘要、astro check 結果
  - 未執行項目與原因
  - 發現但未處理的問題（不得自行擴大範圍）
```

## 9. A2 審查（2026-11-23）與修正工作命令（已授權，DECISION_LOG D1-A2-FIX-AUTH）

### 9.1 審查結論：退回一項實質缺陷，其餘通過

已核對：變更只在 §8 允許範圍內；0023 只新增 `d1_quantity_epoch` 與三個不可變 trigger；Claude 本機重跑 5 支測試 **68／68 通過**；`astro check` 12 個錯誤，無 A2 新增。三個動作、HMAC 憑證、epoch、寫入前超限檢查、F5 紀錄、`quantity-status` 一律 200，皆符合 §7。

**缺陷（必修）**：§7.3 規定 `NOT_COMMITTED` 代表「確定沒有寫入」，但下列情況是**查不到結果**，卻回了 `NOT_COMMITTED`：

| 位置 | 情況 |
| --- | --- |
| `shared-quantity-commit.ts` `checkOperation` | 憑證驗證拋錯（例如簽章金鑰暫時讀不到）→ `NOT_COMMITTED` + `EVIDENCE_UNAVAILABLE`，且在讀回執之前就回傳 |
| `commitSharedQuantity` | `observe` 讀取失敗（`!before`、`!current`）、准入查詢拋錯 → `NOT_COMMITTED` |
| `physical-component-management.ts` | 讀 epoch 拋錯 → `NOT_COMMITTED` |
| `physical-component-admin-api.ts` | 三個數量動作的非預期例外 → 503，**沒有 `outcome`** |

情境：第一次確認其實已寫入但回應遺失，前端重送或查詢時剛好遇到 D1 暫時讀取錯誤，系統回「確定沒寫入」。前端會清除待處理操作，畫面告訴管理員沒寫入，但資料其實已改。這正是 D1-12 要防的情況。

**次要**：A1 新增的 `tests/d1-0023-review.test.ts` 第 265～266 行有 2 個型別錯誤（`GameRef`），測試可跑但 `astro check` 會報。

### 9.2 修正工作命令

```text
工作命令 ID：D1-API-FIX-20261123-01
工作目標：修正 A2 把「查不到結果」誤報為「確定沒寫入」的問題。

已批准規格：docs/D1-completion-plan-20261123.md §7.3、§9.1；DECISION_LOG D1-A2-AUTH。

規則：
  - NOT_COMMITTED 只能用在「業務條件確定」的情況：憑證驗證結果為 false、內容與識別不符、
    世代已前進或已封存、寫入前檢查超限、寫入前確認候選列不存在且世代未前進。
  - 基礎設施錯誤（任何 D1 讀取拋錯、憑證驗證拋錯、epoch 讀取拋錯、非預期例外）
    → quantity-commit 與 quantity-status 一律回 outcome UNKNOWN、code D1_RESULT_UNKNOWN
    （commit 為 503，status 為 200），並保留 F5 紀錄。
  - quantity-preview 的基礎設施錯誤維持 503 EVIDENCE_UNAVAILABLE（預覽不寫入，無結果問題）。
  - 拋錯前若能讀到回執，以回執為準（COMMITTED 或 IDEMPOTENCY_CONFLICT）。

允許修改範圍：
  - src/lib/shared-quantity-commit.ts
  - src/lib/physical-component-management.ts（只限三個數量動作的分支）
  - src/lib/physical-component-admin-api.ts（只限數量動作的例外對應）
  - tests/d1-quantity-api.test.ts、tests/shared-quantity-commit.test.ts（新增測試）
  - tests/d1-0023-review.test.ts（只修第 265～266 行的型別錯誤，不改斷言）

允許執行的驗證：
  1. node --import tsx --test tests/d1-quantity-api.test.ts tests/shared-quantity-commit.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts tests/d1-0023-review.test.ts
  2. npm run astro -- check（目前 12 個錯誤；修正後應為 10 個，且無新增）
  3. git diff --check
  資料來源同 A2：只限 node:sqlite 與合成資料；ENOMEM 可沿用 A1 相容作法。

必須新增的測試：
  - 第一次確認已寫入、回應遺失；重送時憑證驗證拋錯 → UNKNOWN（不是 NOT_COMMITTED）
  - 同上，重送時 observe 讀取拋錯 → UNKNOWN
  - quantity-status 遇 D1 讀取拋錯 → HTTP 200、outcome UNKNOWN
  - epoch 讀取拋錯 → commit 503 UNKNOWN、status 200 UNKNOWN
  - 數量動作非預期例外的回應帶 outcome UNKNOWN
  - 既有 NOT_COMMITTED 情境（竄改憑證、世代前進、封存、超限）結果不變

禁止事項：同 §8（不改畫面與 controller、0023／0024、wrangler.json、package.json；
  不連遠端、不建置部署；不讀機密與備份）。

完成條件與交付：同 §8，另附每條新測試名稱。
```

### 9.3 修正審查（2026-11-23）：通過

Codex 完成 `D1-API-FIX-20261123-01`。變更只在 §9.2 允許範圍內，0023 本次無變更。基礎設施錯誤一律先以回執判定（`recoverQuantityResult`），讀不到回執就回 `UNKNOWN`；`NOT_COMMITTED` 只剩業務條件確定的情況（憑證驗證結果為 false、內容不符、世代前進、封存、epoch 不符、寫入前超限、類型使用中）。非預期例外的回應也帶 `outcome: UNKNOWN`。Claude 本機重跑 5 支測試 **74／74 通過**（新增 6 項故障測試）；`astro check` **10 個錯誤**（12 → 10，消除 A1 測試檔 2 個），無新增；`git diff --check` 通過。

**A2 判定完成。** 下一步 A3（預覽確認畫面），先依使用者偏好製作本機比較頁給使用者看過再定案。
