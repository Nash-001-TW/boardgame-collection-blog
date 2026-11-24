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

## 10. A3 設計：預覽確認畫面（2026-11-24 已採納，DECISION_LOG D1-A3-Q6～Q8）

本機比較頁：[docs/UI/D1-A3-preview-options.html](UI/D1-A3-preview-options.html)（合成資料示意）。依據：§7 API 契約、設計規範 §6（確認彈窗、數量步進器、通知訊息）、UI-D8。

### 10.1 固定流程（不需選）

1. 組件編輯表單的預期量與原值不同時，出現必填「更正理由」，儲存鈕改為「預覽更正」；只改名稱、類型、單位維持「儲存」。
2. 送 `quantity-preview`；失敗時訊息顯示在表單上方，不產生待處理操作。
3. 預覽內容：前後值與理由、三個摘要數字（受影響副本、缺件張數前→後、無法判讀盒數）、每盒明細、不列入盒數（已出售等）、「實點、清點日期與完成狀態不會被改動」。副本名稱由頁面既有副本資料以 `copyId` 對照。多於預期顯示「不缺（多 N 張）」（D1-04），實點不明顯示「—」。
4. 確認鈕寫出數量：「確認更正（影響 N 盒）」。送出前存待處理操作，送出中兩鈕停用、Esc 不關閉。
5. 結果只看 `outcome`：`COMMITTED` 重新載入並顯示成功訊息（R06 改版時改原地更新）；`NOT_COMMITTED` 依 `code` 顯示原因並提供「重新預覽」，清除待處理；`UNKNOWN` 保留待處理並進入第 7 點的處理流程。查詢請求的 4xx 不清除待處理操作。
6. **前端逾時（2026-11-24 補）**：`quantity-commit` 與 `quantity-status` 的 `fetch` 以 `AbortController` 設 20 秒上限。逾時、斷線或回應無法解析，一律視為 `UNKNOWN`（待處理操作在送出前已存好）。`quantity-preview` 逾時只顯示「預覽逾時，請再試一次」，不產生待處理操作。
7. **結果不明的處理流程（2026-11-24 補）**：只靠查詢無法收斂——原請求若根本沒到伺服器，資料庫沒有回執、世代也沒前進，`quantity-status` 會一直回 `UNKNOWN`。因操作識別與內容綁定、提交冪等，以**同一識別、同一內容**重送 `quantity-commit` 是安全的：已寫入就取回原結果，沒寫入就寫入一次，期間資料有變動就回 `NOT_COMMITTED`。流程：
   1. 畫面顯示「查詢結果」（`quantity-status`）。
   2. 查詢仍為 `UNKNOWN` 時，再顯示「重新送出同一次更正（不會重複寫入）」，送出同一個 `operationId`、`baseline`、`previewToken` 與內容；不得重新預覽或換識別。
   3. 頁面載入時讀到待處理操作，自動查詢一次（查詢只讀不寫）；結果仍不明才停在第 1 步的畫面。
   4. 重送或查詢期間按鈕停用，同一時間只允許一個請求。
8. 訊息文字對照見比較頁第 4 節。

### 10.2 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q6 | 預覽放哪裡 | 原生 `<dialog>`，手機為全高底部面板 | 表單下方展開 | **A**：符合設計規範 §6，元件可沿用到 R06 改版 |
| Q7 | 每盒明細 | 分「變動／不變／無法判讀」三組，只展開變動 | 單一表格全列 | **A**：直接用 A2 回傳分組，手機不需橫捲 |
| Q8 | 結果不明時 | 鎖住該組件數量編輯，直到查詢或同識別重送得到確定結果（§10.1 第 7 點） | 只提醒，仍可編輯 | **A**：避免在值不確定時再次更正；有同識別重送，不會永久卡住 |

決定後產出 A3 工作命令（Codex 實作並提供桌面／手機截圖，Claude 審查）。

### 10.3 相關但不屬於 A3 畫面的項目（2026-11-24 補，依 2026-11-24 對話中逾時與重送機制的檢討）

| 項目 | 內容 | 歸屬 | 授權 |
| --- | --- | --- | --- |
| 成功紀錄 | `quantity-commit` 成功（含 `replayed`）時記一筆只含操作識別、`outcome`、階段的紀錄，與既有 F5 錯誤紀錄同格式，不含理由等使用者輸入。用來比對「收到請求、寫入成功、回應送出」 | 併入 A3 工作命令（伺服器端小幅修改，只限記錄） | 隨 A3 批准 |
| 保存紀錄 | `wrangler.json` 目前沒有 `observability`，正式環境的 `console.error` 只能用 `wrangler tail` 即時查看，事後查不到。建議開啟 Workers Logs | A5 | 高敏感設定，需另行授權 |
| 套用前對帳 | 唯讀檢查：每筆回執的更正後值與 revision，要能對上目前預期量或其後的一般編輯紀錄 | A5 套用前與驗收後各跑一次 | 隨 A5 授權 |
| 不採用 | 202 Accepted＋輪詢：寫入為毫秒級（A1 量測），非同步只增加狀態管理；定時對帳：個人收藏量小、回執不可變，以 A5 唯讀檢查取代 | — | — |

已確認無需再處理：查詢只在「世代已前進且無回執」或「已封存」時回 `NOT_COMMITTED`（[shared-quantity-commit.ts](../src/lib/shared-quantity-commit.ts) `outcome()`），這兩種情況下仍在途的原請求也必然被擋，不會出現「說沒寫入、其實寫了」。

## 11. 工作命令 A3（2026-11-24 已授權，DECISION_LOG D1-A3-AUTH）

盤點（2026-11-24 靜態閱讀）：R06 [manage.astro](../src/pages/admin/collection/components/manage.astro) 已有一直顯示的理由欄（第 141 行）與待處理面板，面板內有「查詢結果」「重送原操作」「安全封閉原操作」三鈕（第 145～149 行）。伺服器沒有 `quantity-retire` 動作，§10 也不含此流程，A3 移除該鈕。[controller](../src/lib/physical-component-admin-controller.ts) 的 `fetch` 沒有逾時。既有瀏覽器腳本 [physical-quantity-browser.mjs](../tests/physical-quantity-browser.mjs) 以本機 Edge＋拋棄式 SQLite 驅動真實 controller 與 API，A3 沿用它驗收與截圖。

```text
工作命令 ID：D1-UI-20261124-01
工作目標：完成 D1 階段 A 的預覽確認畫面與前端流程，取代「預覽確認開發中」的過渡提示。

已批准規格：docs/D1-completion-plan-20261123.md §7.2～7.3、§10（DECISION_LOG D1-A3-Q6～Q8）；
  比較頁 docs/UI/D1-A3-preview-options.html 的 A 案與第 4 節文字；設計規範 §6（確認彈窗、通知訊息）、§9（無障礙）。

行為要求：
  1. 預期量與原值不同時才顯示必填理由欄，儲存鈕改為「預覽更正」；改回原值則隱藏理由並恢復「儲存」。
     理由空白時前端擋下，不送預覽。
  2. 預覽成功開原生 <dialog>（aria-labelledby；開啟時焦點在標題；關閉後焦點回「預覽更正」）；
     手機（< 768px）為全高底部面板。內容依 §10.1 第 3 點；明細分三組，只展開「變動」。
     副本名稱以頁面既有副本資料用 copyId 對照，查不到顯示「副本 #<id>」。
  3. 取消或 Esc（送出前）關閉彈窗，不寫入、不留待處理操作。
  4. 確認：先存待處理操作再送 quantity-commit；送出中兩鈕停用、Esc 不關閉、確認鈕顯示轉圈並保留寬度。
  5. 結果只看 outcome（§7.3）；NOT_COMMITTED 依 code 顯示比較頁第 4 節文字並提供「重新預覽」。
  6. 逾時：commit／status 的 fetch 上限 20 秒（AbortController）；逾時、斷線、回應無法解析 → UNKNOWN。
     逾時值集中為單一常數；測試可注入較短值，但不得改變正式值。
  7. UNKNOWN 流程（§10.1 第 7 點）：鎖住該組件的預期量欄與「預覽更正」；第 1 步「查詢結果」；
     查詢仍 UNKNOWN → 第 2 步「重新送出同一次更正」（同 operationId、baseline、previewToken 與內容）＋「再查詢一次」。
     頁面載入讀到待處理操作時自動查詢一次。同一時間只允許一個請求。
  8. 查詢請求的 4xx 不清除待處理操作，只顯示錯誤。移除「安全封閉原操作」鈕與相關程式。
  9. 成功紀錄（§10.3）：quantity-commit 得到 COMMITTED（含 replayed）時，伺服器記一筆與 F5 錯誤紀錄同格式的
     紀錄，只含階段、操作識別、outcome、replayed；不含理由、名稱等使用者輸入。
  10. 中英文字齊全（沿用頁面 t() 模式）。

允許修改範圍：
  - 新增 src/components/admin/D1QuantityPreviewDialog.astro（彈窗外殼與樣式；樣式以元件內 <style> 使用設計規範 §3 色值，
    待設計規範階段 0 建立共用 token 後再搬移）
  - 新增 src/lib/d1-quantity-preview-view.ts（純函式：impact → 顯示模型，含分組、標籤、「不缺（多 N 張）」、「—」）
  - src/lib/physical-component-admin-controller.ts（只限數量更正流程）
  - src/pages/admin/collection/components/manage.astro（只限理由欄顯示條件、待處理面板、掛載彈窗、提供 copyId 對照資料）
  - src/lib/shared-quantity-commit.ts（只限新增成功紀錄函式；不在提交引擎內呼叫）
  - src/lib/physical-component-admin-api.ts（只限在 COMMITTED 分支、action 為 quantity-commit 時呼叫成功紀錄；
    回應格式不變。2026-11-24 擴大，DECISION_LOG D1-A3-AUTH-02：epoch 讀取失敗時以回執回復結果的路徑不經提交引擎，
    只有此處同時有原始動作與結果，能涵蓋一般提交、重送與回執回復，且不把 quantity-status 記成提交）
  - 新增 tests/d1-quantity-preview-view.test.ts；修改 tests/physical-quantity-browser.mjs；
    tests/d1-quantity-api.test.ts（只限新增成功紀錄的斷言）

禁止事項：不改 0023／0024 與其他 migrations、wrangler.json、package.json、astro.config.mjs；不改 R06 其他版面
  （整頁共用副本選擇等 UI-D8 改版不在本單）；不做 A4 歷史檢視；不改 API 回應格式；不連遠端、不建置、不部署；
  不讀機密與備份。發現需要超出範圍的修改時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/d1-quantity-preview-view.test.ts tests/d1-quantity-api.test.ts tests/shared-quantity-commit.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts tests/d1-0023-review.test.ts
  2. node tests/physical-quantity-browser.mjs <暫存目錄>（本機 Edge＋拋棄式 SQLite）
  3. npm run astro -- check（基準 10 個錯誤，不得新增）
  4. git diff --check

瀏覽器腳本必須涵蓋：
  - 理由欄顯示／隱藏與按鈕文字切換；理由空白被擋
  - 預覽後取消：資料庫無回執、無待處理操作
  - 確認成功：重新載入後顯示成功訊息與新值；回執恰好一筆
  - 回應遺失（已寫入）→ UNKNOWN → 查詢 → COMMITTED
  - 請求未送達（未寫入）→ UNKNOWN → 查詢仍 UNKNOWN → 同識別重送 → COMMITTED；回執恰好一筆
  - 逾時（測試注入短逾時）→ UNKNOWN，欄位鎖住
  - 查詢回 4xx：待處理操作仍在
  - 預覽後另有清點寫入 → 確認得到 NOT_COMMITTED（D1_CONFIRMATION_SUPERSEDED），待處理清除、鎖定解除
  - 帶待處理操作重新載入：自動查詢一次
  - Esc：送出前關閉並還原焦點；送出中不關閉

截圖（桌面 1440、手機 375，存 docs/D1-A3-screenshots/，只用合成資料）：
  表單（理由出現）、預覽彈窗、送出中、成功訊息、NOT_COMMITTED、UNKNOWN 第 1 步、UNKNOWN 第 2 步。

完成條件與交付：列出新增／修改檔案與摘要；各驗證指令與結果數字；瀏覽器腳本逐項結果；截圖清單；
  astro check 錯誤數；未執行項目明列；更新 HANDOFF.md 帶日期條目。
```

### 11.1 A3 審查（2026-11-24）：通過，附三項小修

Codex 首輪在唯讀檢查時發現成功紀錄有一條路徑不經提交引擎而停下（D1-A3-AUTH-02 擴大範圍後續跑）。完成後 Claude 審查：

- **範圍**：變更檔案皆在 §11（含 AUTH-02）允許範圍內；migrations、wrangler.json、package.json 未動。
- **重跑**：六檔 Node 測試 **76／76 通過**；`astro check` **10 個錯誤**（與基準相同）；`git diff --check` 通過。Edge 腳本未由 Claude 重跑，引用 Codex 結果 11／11 與 14 張截圖（`docs/D1-A3-screenshots/`），已抽看桌面預覽、手機預覽、手機 UNKNOWN 第 2 步。
- **符合**：結果只看 `outcome`；查詢 4xx 不清除待處理；commit／status 20 秒逾時與無法解析一律走 UNKNOWN；頁面載入自動查詢一次；同識別同內容重送；全頁同時只允許一個請求；送出中 Esc 不關閉；「安全封閉原操作」已移除；成功紀錄只在 `quantity-commit` 的 COMMITTED 分支、只含識別／結果／replayed。測試用短逾時以打包時替換原始碼注入，不影響正式值；`--no-sandbox` 只在測試環境變數開啟時加在拋棄式 Edge。
- **觀察**：Codex 驗收時重現 Edge 會自動重送中斷的 POST。提交冪等，這種自動重送安全，也印證同識別設計的必要。

**小修（不擋 A3 完成，建議併入 A4 或另開小工作命令）**：
1. 無法判讀的盒子前後都只顯示「—」，沒有原因。比較頁示意為「尚未清點」；`judge()` 已有原因（UNCHECKED／NEEDS_REVIEW／EVIDENCE_UNAVAILABLE／ACTUAL_UNKNOWN／EXPECTED_UNKNOWN），應轉成文字顯示（`d1-quantity-preview-view.ts`）。
2. 「重新送出同一次更正」使用次要按鈕樣式；比較頁為主要按鈕。
3. 摘要「受影響副本」數字缺單位「盒」。

未執行：Claude 未重跑 Edge 腳本；未做真實 Miniflare／正式 D1、建置、部署。

**小修完成（2026-11-24，Claude 直接修改，屬 §11 已授權檔案）**：(1) `d1-quantity-preview-view.ts` 無法判讀時依 `judge()` 原因顯示文字（尚未清點／需要複查／清點證據不可用／實點不明／預期量未設定），單元測試同步更新；(2) `manage.astro` 重送鈕加 `primary`（目前 Admin 主要按鈕為既有綠色，設計規範階段 0 改紫色 token 時一併套用）；(3) controller 受影響副本顯示「N 盒」。驗證：六檔 76／76 通過；Edge 腳本 **Claude 親自重跑 11／11 通過**，14 張截圖已覆寫更新；`astro check` 10 個錯誤（無新增）；`git diff --check` 通過。

## 12. A4 設計：更正歷史檢視（2026-11-24 已採納，DECISION_LOG D1-A4-Q9～Q11）

本機比較頁：[docs/UI/D1-A4-history-options.html](UI/D1-A4-history-options.html)（合成資料示意）。依據：D1-05、D1-16、D1-17、D1-18；0023 的 `d1_quantity_changes`／`d1_quantity_history`。

### 12.1 盤點（2026-11-24 靜態閱讀）

- 回執欄位：`operation_id`、`actor`（Access JWT `sub`，不是 email）、`definition_id`、`collection_id`、`record_scope`、`before_quantity`／`after_quantity`、`name`、`component_type`、`unit`、`reason`、`evidence_json`（版本 1，最多 200 盒，每盒含版本、語言、封膜、庫存、實點、清點狀態、`lastSavedAt`；`countDate` 為 NULL、完成狀態為 `UNKNOWN`）、`before_generation`、`after_revision`、`committed_at`（unix 秒）。回執不可修改、不可刪除。
- 預覽的「快照 → 判讀列」轉換寫在 [shared-quantity-preview.ts](../src/lib/shared-quantity-preview.ts) 第 90～103 行，尚未抽成共用函式。
- 正式環境尚未套用 0023（屬 A5），頁面讀歷史會失敗，必須只影響歷史區。

### 12.2 固定規則（不需選）

1. 頁面伺服器端唯讀查詢，不新增 API、不寫入。
2. 每盒判讀以回執快照、**與預覽相同的函式**重算：把 12.1 的轉換抽成共用函式，預覽與歷史共用（預覽行為不得改變，既有測試須維持通過）。
3. 時間以 Asia/Taipei 顯示，`<time datetime>` 保留完整時間。
4. 操作者：一律顯示「管理員（識別碼末 6 碼）」，不顯示完整識別碼。（2026-11-24 修訂，DECISION_LOG D1-A4-ACTOR-01。原採納規則為「與目前登入者相同顯示『你』，否則『其他管理員（末 6 碼）』」；因 R06 頁面拿不到登入者身分，辨識需改 middleware／auth。目前只有單一管理員，將來新增管理員時再考慮。回執仍存完整識別碼，影響僅畫面文字。）
5. 副本名稱：副本仍存在用目前名稱並附快照版本／語言；已不存在顯示「副本 #id（已移除）」。快照缺欄位顯示 `UNKNOWN`／「—」，不讀現值補。
6. 每張卡固定註明「0023 套用前的預期量修改沒有紀錄（UNKNOWN）」。
7. 讀取失敗只在歷史區顯示「更正歷史暫時無法取得」，頁面其他部分照常；不以空清單掩蓋失敗。

### 12.3 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q9 | 歷史放在哪裡 | 每張組件卡內摺疊區「更正歷史（N）」 | 頁面底部整個收藏的獨立區 | **A**：就近查看，R06 改版後位置不變 |
| Q10 | 每筆顯示多少 | 摘要一行，點開看當時每盒判讀 | 全部展開 | **A**：平常簡潔，需要時可追溯 |
| Q11 | 是否並列目前判讀 | 只顯示當時快照並標明「當時」 | 當時與目前並列 | **A**：符合 D1-16 不得以現值倒填 |

決定後產出 A4 工作命令。

## 13. 工作命令 A4（2026-11-24 已授權，DECISION_LOG D1-A4-AUTH）

```text
工作命令 ID：D1-HIST-20261124-01
工作目標：在 R06 每張組件卡顯示該組件的共用預期數量更正歷史（唯讀）。

已批准規格：docs/D1-completion-plan-20261123.md §12（DECISION_LOG D1-A4-Q9～Q11、D1-A4-ACTOR-01）；
  比較頁 docs/UI/D1-A4-history-options.html 的 A 案與第 4 節；D1-05、D1-16、D1-18。

行為要求：
  1. 每張組件卡在「編輯組件」之後加摺疊區「更正歷史（N）」；N 為 0 時不顯示數量，內文「尚無更正紀錄」。
  2. 每筆摘要一行：時間（Asia/Taipei 月日時分，<time datetime> 保留完整 ISO 時間）、前值 → 後值＋單位、理由。
     依 committed_at 新到舊排序。
  3. 點開一筆：操作者「管理員（識別碼末 6 碼）」；當時受影響盒數與缺件張數前 → 後；
     提示「以下為 <時間> 更正當下的實點與判讀，不是目前值」；每盒表格（副本、當時實點、更正前、更正後）。
     判讀文字與 A3 預覽一致（含「不缺（多 N 張）」與無法判讀原因）。
  4. 每盒判讀以回執 evidence_json、before_quantity、after_quantity 重算，與預覽共用同一函式：
     把 shared-quantity-preview.ts 中「快照 → QuantityImpactRow[] → projectQuantityImpact」的轉換抽成共用函式，
     預覽改為呼叫它，行為不得改變。快照無法解析或 projectQuantityImpact 非 READY 時，該筆只顯示摘要並註明
     「當時判讀無法還原（UNKNOWN）」，不得用現值補。
  5. 副本名稱：副本仍存在用目前名稱並附快照的版本／語言；不存在顯示「副本 #id（已移除）」。
  6. 每張卡歷史區底部固定註明「0023 套用前的預期量修改沒有紀錄（UNKNOWN）」。
  7. 讀取失敗（含資料表不存在）：只在各卡歷史區顯示「更正歷史暫時無法取得」，頁面其他部分照常；
     記一筆不含使用者輸入的錯誤紀錄；不得顯示成「尚無更正紀錄」。
  8. 整頁只查一次（依收藏 ID 讀取 d1_quantity_history，伺服器端分組到各組件），不新增 API、不寫入。
  9. 中英文字齊全（沿用頁面 t() 模式）。

允許修改範圍：
  - 新增 src/lib/d1-quantity-history.ts（唯讀查詢、失敗隔離、顯示模型）
  - 新增 src/components/admin/D1QuantityHistory.astro（摺疊區與樣式，元件內 <style> 使用設計規範 §3 色值）
  - src/lib/shared-quantity-preview.ts（只限抽出共用轉換函式並改為呼叫它）
  - src/lib/d1-quantity-preview-view.ts（只限必要時匯出可重用的判讀文字函式；不改既有輸出）
  - src/pages/admin/collection/components/manage.astro（只限呼叫歷史查詢與在組件卡掛載元件）
  - 新增 tests/d1-quantity-history.test.ts；修改 tests/physical-quantity-browser.mjs（只限新增歷史驗收與截圖）

禁止事項：不改 migrations、wrangler.json、package.json、astro.config.mjs、middleware 與 src/lib/auth；
  不改 API 與提交引擎；不改 A3 流程；不做 R06 版面改版；不連遠端、不建置、不部署；不讀機密與備份；
  不 git commit。發現需要超出範圍的修改時停下回報。

允許執行的驗證：
  1. node --import tsx --test tests/d1-quantity-history.test.ts tests/d1-quantity-preview-view.test.ts tests/d1-quantity-api.test.ts tests/shared-quantity-commit.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts tests/d1-0023-review.test.ts
  2. node tests/physical-quantity-browser.mjs <暫存目錄>（本機 Edge＋拋棄式 SQLite）
  3. npm run astro -- check（基準 10 個錯誤，不得新增）
  4. git diff --check

單元測試必須涵蓋：
  - D1-05：103／99 → 少 4，更正為 100 後 → 少 1；之後重新清點為 100，歷史仍顯示當時 99 與少 4 → 少 1
  - 兩筆以上依時間新到舊；只列該組件、該收藏
  - 快照判讀與同一份快照的預覽結果一致
  - 快照損壞或無法判讀 → 摘要＋UNKNOWN 註明
  - 副本已移除 → 「（已移除）」
  - 資料表不存在或查詢拋錯 → 狀態為無法取得，不是空清單
  - 操作者只顯示「管理員（識別碼末 6 碼）」，不顯示完整識別碼
  - 預覽既有測試全數維持通過（抽函式不改行為）

瀏覽器腳本新增：
  - 確認更正成功並重新載入後，該組件卡「更正歷史（1）」，展開可見前後值、理由與每盒判讀
  - 截圖（桌面 1440、手機 375，存 docs/D1-A4-screenshots/，只用合成資料）：歷史收合、歷史展開

完成條件與交付：列出新增／修改檔案與摘要；各驗證指令與結果數字；瀏覽器新增項目結果；截圖清單；
  astro check 錯誤數；未執行項目明列；更新 HANDOFF.md 帶日期條目。
```

### 13.1 A4 審查（2026-11-24）：通過，附一項修正

- **範圍**：變更皆在 §13 允許範圍內（新增 `d1-quantity-history.ts`、`D1QuantityHistory.astro`、`tests/d1-quantity-history.test.ts`；修改 `shared-quantity-preview.ts` 只抽出 `projectQuantitySnapshot` 並由預覽呼叫、`manage.astro` 只掛載、`physical-quantity-browser.mjs` 只新增歷史驗收與截圖）。migrations、middleware、auth、API、提交引擎未動。
- **符合**：整頁依收藏一次唯讀查詢（含 5 秒逾時）；讀取失敗回 `unavailable`，只在歷史區顯示「暫時無法取得」，頁面其他部分照常；快照驗證不通過或判讀非 READY 時只顯示摘要＋「當時判讀無法還原（UNKNOWN）」，不讀現值；歷史與預覽共用 `projectQuantitySnapshot` 與 `quantityPreviewView`；操作者只取識別碼末 6 碼；副本已移除標「（已移除）」；固定註明 0023 前無紀錄。
- **Claude 修正（§13 已授權檔案內）**：(1) 歷史摘要與每盒判讀的單位原本直接顯示回執的單位代碼（中文頁出現「30 → 31 card」「缺 2 card」），改為與 R06 表單相同的中英標籤（張、件…）；(2) 歷史讀取失敗的錯誤紀錄補上錯誤類型（只記類型，不記訊息內容）。對應測試期望值同步更新（瀏覽器腳本改為「缺 2 張」，單元測試確認紀錄不含拋錯訊息）。
- **驗證（Claude 親自重跑，修正後）**：七檔 Node 測試 **82／82 通過**；Edge 腳本 **12／12 通過**，4 張 A4 截圖已更新；`astro check` **10 個錯誤**（無新增）；`git diff --check` 通過。
- **既有、非 A4**：組件卡標題列「預期數量 31 (card)」顯示單位代碼，是 R06 既有寫法，留給 R06 改版處理。

未執行：真實 Miniflare／正式 D1、建置、部署（0023 正式套用屬 A5）。

## 14. A5 規劃：正式套用 0023 與部署（2026-11-24 規劃已採納，DECISION_LOG D1-A5-Q12～Q16；各段執行另需授權）

依據：Release-03 程序（[V2-Release-03-summary.md §2、§10](V2-Release-03-summary.md)）、§10.3 歸屬、D1-A1-PASS（正式分類列數須於套用前唯讀確認）。本節只是規劃；**任何正式操作都須使用者逐項授權**（AGENTS.md 第 5 節）。

### 14.1 盤點（2026-11-24 靜態閱讀，未連遠端）

| 項目 | 現況 | 對 A5 的意義 |
| --- | --- | --- |
| 正式版本 | Release-03 version 19（2026-11-12），D1 已套 0001～0022 | v19 部署時沒有對應的 Git 提交，無法精確 diff；這次部署內容是 `main` HEAD |
| 這次會一起上線的變更 | 2026-11-20 起 12 個提交：公開網站 UI 修正（`d025959`、`c8c56be`、`66f798d`）、Admin 修正與素材（`32d81f2`、`a5e3ce3`）、D1 A2～A4 等 | 不只 D1；部署後的公開與 Admin 檢查要涵蓋 |
| 0023 相依 | 只有 D1 的預覽／確認／查詢／歷史讀寫 0023 物件；一般編輯、清點、卡套指派不依賴 0023 | 新程式在 0023 套用前可正常運作，D1 功能會顯示「暫時無法使用／無法取得」 |
| 0023 對舊程式的影響 | 0023 trigger 禁止不經回執直接改 `expected_quantity` | 若先套 0023、v19 仍在線，v19 改預期量會被擋（失敗關閉，不會寫壞資料） |
| `migrations/` 目錄 | 含候選 **0024**（不在 A5 範圍） | **不得使用 `wrangler d1 migrations apply`**（會連 0024 一起套）；比照 Release-03 逐檔執行 0023 並寫 ledger |
| 簽章金鑰 | `PHYSICAL_COMPONENT_SIGNING_KEY` 已在 v19 | 預覽憑證沿用，不需新 Secret |
| Workers Logs | `wrangler.json` 沒有 `observability` | 不開則正式錯誤／成功紀錄事後查不到（§10.3） |
| `/dev/collection-v2-test` | 不在 Admin 路由，middleware 不檢查 Access；`prerender = false`，會讀 D1 回傳收藏總數、願望清單／預購數與前五筆名稱 | CURRENT_TASK #7。重新部署會繼續公開，需決定是否先處理 |
| 回滾 | Worker 可退回 v19；Migration 只能前向 | 0023 套用後無法撤銷，只能另寫 0025 並另行授權；退回 v19 時預期量修改會被 trigger 擋 |

### 14.2 建議流程與關卡

| 關卡 | 內容 | 正式寫入 | 停止條件 |
| --- | --- | --- | --- |
| G0 唯讀預檢 | 確認 Account、Worker、D1 ID（遮蔽）、目前版本為 v19 且 100%、ledger 為 0001～0022、無 0023 同名物件；**分類列數**（`d1_quantity_admission` 相同口徑，0023 前以等價查詢）與 10,000 上限的距離；收藏數（0023 會為每個收藏建世代列） | 無 | 任何一項不符、分類列數 ≥ 8,000（80%）、使用者回報有其他人／流程在改 |
| G1 備份 | D1 官方 Export、本機還原、`integrity_check`、`foreign_key_check`、ledger 比對、SHA-256；存專案外私人目錄 | 無（Export） | 任一檢查失敗 |
| G2 建置 | 專案外副本、真實綁定、`npm run build`；產物掃描無 Token／AUD／Email／金鑰；確認 `migrations/` 不進產物 | 無 | 建置失敗或掃描命中 |
| G3 上傳與切換 | `wrangler versions upload`（不切流量）→ 核對綁定與 5 項 Secret 名稱 → `versions deploy` 100% | Worker 版本 | 核對不符 |
| G4 部署後檢查 | 沿用 Release-03 §10.5 公開路由清單＋Admin 302；使用者人工開 R06：歷史區應顯示「暫時無法取得」（0023 尚未套用，屬預期） | 無 | 任一路由異常 → 退回 v19 並停止 |
| G5 套用 0023 | 只執行 0023 原檔 SQL＋ledger INSERT（單一 batch）；完成後核對 ledger、3 表 4 view、trigger 數、`d1_quantity_epoch` 1 列、世代列數 = 收藏數 | Schema＋ledger＋初始化列 | 失敗即停，不重試、不補 ledger |
| G6 套用後對帳 | 唯讀：回執數 0、世代列數、epoch 存在；一般清點／編輯不受影響（使用者人工確認一次清點儲存可選） | 無 | 不符即停並回報 |
| G7 使用者驗收 | R06 歷史區顯示「尚無更正紀錄」；依 Q14 做預覽 | 依 Q14 | — |

### 14.3 待使用者決策

| # | 問題 | A | B | 建議 |
| --- | --- | --- | --- | --- |
| Q12 | 部署與 0023 的順序 | 先部署程式（G2～G4），再套 0023（G5） | 先套 0023，再部署 | **A**：新程式不依賴 0023 也能運作；反過來 v19 會短暫無法改預期量 |
| Q13 | 這次是否開啟 Workers Logs | 是：`wrangler.json` 加 `"observability": { "enabled": true }`，隨 G2 建置 | 否，維持現狀 | **A**：D1 的錯誤／成功紀錄才能事後追查；改的是高敏感設定，需你明確同意 |
| Q14 | 正式驗收要不要寫入 | 只做「預覽後取消」，不寫正式資料 | 做一筆真實更正（須是你實際需要的更正，由你指定組件與數值） | **A**：預覽已涵蓋讀取、憑證、epoch；寫入路徑已有本機 82 項與 Edge 12 項驗證 |
| Q15 | `/dev/collection-v2-test` | 部署前先另開小工作命令，讓它在正式環境回 404（只限 `import.meta.env.DEV` 才可用） | 本次不處理，維持 v19 現狀 | **A**：重新部署是封閉的好時機；改動小，但需另一張工作命令與你批准 |
| Q16 | 授權方式 | 分兩段：先授權 G0～G1（唯讀＋備份），看過預檢結果再授權 G2～G7 | 一次授權 G0～G7，遇停止條件即停 | **A**：分類列數與收藏數要先看到實際值 |

### 14.4 執行者與登入

~~比照 Release-03：由 Codex 執行遠端操作，Claude 審查每段結果。~~ **2026-11-24 修訂（DECISION_LOG TEAM-04）**：Claude 呼叫的 Codex 沙箱無法連外網，遠端操作改由 Claude 在對話中直接執行，結果回饋 Codex；Codex 負責本機修改與本機測試。Wrangler／Cloudflare 登入由使用者親自完成；若 OAuth 過期，提供 `npx wrangler login` 與成功條件，不在對話中貼任何認證值。不讀 `.env`／`.dev.vars` 內容；建置副本不複製這兩個檔。

### 14.5 工作命令 A5-PRE：部署前本機修改（2026-11-24 已授權，DECISION_LOG D1-A5-PRE-AUTH）

```text
工作命令 ID：D1-A5-PRE-20261124-01
工作目標：依 Q13、Q15 完成 A5 建置前需要的兩項本機修改；不連遠端。

已批准規格：docs/D1-completion-plan-20261123.md §14.3 Q13、Q15（DECISION_LOG D1-A5-Q12～Q16）。

修改內容：
  1. src/pages/dev/collection-v2-test.astro：非開發模式（!import.meta.env.DEV）時，在讀取任何 D1 資料前
     回 404（Cache-Control: no-store），本機 astro dev 行為不變。
  2. wrangler.json：只新增頂層 "observability": { "enabled": true }，其他鍵值一字不改。

允許修改範圍：上述兩個檔案；可新增 tests/dev-page-production-guard.test.ts（以建置或渲染方式確認非 DEV 回 404 且不觸碰 DB，
  方式由執行者決定，不得連遠端）。

禁止事項：不改其他程式、migrations、package.json、astro.config.mjs、middleware；不建置、不部署、不連遠端；
  不讀 .env／.dev.vars；不 git commit。

允許執行的驗證：
  1. 新增測試（若有）
  2. node --import tsx --test tests/d1-quantity-history.test.ts tests/d1-quantity-preview-view.test.ts tests/d1-quantity-api.test.ts tests/shared-quantity-commit.test.ts tests/physical-component-management.test.ts tests/physical-quantity-impact.test.ts tests/d1-0023-review.test.ts
  3. npm run astro -- check（基準 10 個錯誤）
  4. git diff --check

交付：修改摘要、wrangler.json 的完整 diff（只應有新增的 observability）、驗證結果、未執行項目；更新 HANDOFF.md。
```

#### 14.5.1 A5-PRE 審查（2026-11-24）：通過

- `wrangler.json` diff 只新增頂層 `observability.enabled: true`，其他鍵值未動。
- **更正 §14.1 與 CURRENT_TASK #7**：`/dev/collection-v2-test` 自 `469866d`（2026-10-21）起就已有 `!import.meta.env.DEV` → 404 的守衛，且位於讀 D1 之前；§14.1「會讀 D1 回傳收藏統計」是 Claude 盤點時只看了檔頭的錯誤判斷。v19（2026-11-12）應已含此守衛，但 v19 沒有對應提交，未實測正式回應。本單實際變更為 404 加上 `Cache-Control: no-store`，並新增測試確認非 DEV 時回 404、不觸碰 D1 binding。
- Claude 重跑：八檔 Node 測試 **83／83 通過**；`astro check` **10 個錯誤**（無新增）；`git diff --check` 通過。未建置、未連遠端。

### 14.6 工作命令 A5-G01：唯讀預檢與備份（2026-11-24 已授權，DECISION_LOG D1-A5-G01-AUTH）

```text
工作命令 ID：D1-A5-G01-20261124-01
工作目標：執行 §14.2 的 G0（唯讀預檢）與 G1（正式 D1 備份），回報實際數值供使用者決定是否授權 G2～G7。

正式環境操作授權範圍（僅此）：
  - Cloudflare 帳號、Worker、D1 的 Metadata 讀取（GET）
  - 正式 D1 的唯讀 SELECT（下列查詢，不得有任何寫入語句）
  - 正式 D1 官方 Export（含啟動、輪詢、下載各 1 次；失敗不自動重試）

G0 必須回報（ID 一律遮蔽）：
  1. Account、Worker 名稱、D1 名稱與遮蔽 ID 與 Release-03 一致
  2. 目前流量版本與比例（預期 version 19、100%）
  3. d1_migrations ledger 筆數與檔名（預期 0001～0022 共 22 筆）；不存在 d1_quantity_* 同名物件
  4. 分類列數：以 src/lib/physical-component-management.ts 的 evidenceSize 運算式同口徑 SELECT；
     回報數值、與 10,000 上限的比例；≥ 8,000 即停止
  5. v2_collection_items 筆數（0023 將建立的世代列數）
  6. 使用者確認期間沒有其他人或自動流程更新此 Worker／D1（由使用者在對話中回答）

G1 必須完成：
  - 官方 Export → 專案外、僅目前使用者可存取的私人目錄；回報檔案大小與 SHA-256
  - 本機還原（載入時關閉外鍵、載入後開啟）→ PRAGMA integrity_check = ok、foreign_key_check = 0、ledger 與 G0 相符
  - 不把匯出內容、私人資料、簽名 URL、認證輸出到對話或報告

停止條件：任一 G0 項目不符、分類列數 ≥ 8,000、Export 或還原檢查失敗、需要登入但未登入（提供 npx wrangler login
  與成功條件，由使用者親自完成）。停止後不重試、不改用其他方法。

禁止事項：任何正式寫入（Migration、Worker 上傳或部署、Secret、Access、DNS、資料 DML）；Preview D1 或其他資源；
  讀取 .env／.dev.vars 內容；git commit。

交付：G0 六項數值、G1 備份證據、實際遠端操作次數（GET／SELECT／Export 分列）、未執行項目；
  新增 docs/V2-Release-04-preflight.md（去敏）並在 HANDOFF.md 追加條目。
```

兩張工作命令可並行準備；A5-PRE 不碰遠端，G01 不改程式。G2～G7 的工作命令待 G01 結果出來後起草。

### 14.7 A5 修訂流程（2026-11-24 已採納，DECISION_LOG D1-A5-REV-01）

背景：已證實推送 `main` 會自動部署（DEPLOY-01 保留此機制）；正式環境已是 A4 程式（`eff80d59`），D1 未套 0023。已採納的 §14.2 G2～G4 與 Q12「先部署程式再套 0023」需配合調整，下列修訂在使用者批准前不生效。

| 原關卡 | 修訂 |
| --- | --- |
| G0 | 不變，但第 2 項基準改為 `eff80d59`（A4）；續查第 3～5 項 |
| G1 | 不變（正式 D1 備份） |
| G2～G4（自行建置、上傳、切換、部署後檢查） | **取消**。Q12 的目的（程式先上線、確認不依賴 0023）已由 A4 自動部署達成；改為 G0 時對正式網站做唯讀抽查（Release-03 §10.5 公開路由＋Admin 302；R06 由使用者人工確認一般清點可用、D1 歷史顯示「暫時無法取得」） |
| G5 套用 0023 | 不變（逐檔＋ledger，禁止 `migrations apply`） |
| G6 套用後對帳 | 不變 |
| 新增 G6a 推送 A5-PRE | 提交 A5-PRE（dev 頁 `no-store`、`wrangler.json` observability）並推送＝部署；推送前依 DEPLOY-01 取得部署授權；部署後唯讀確認新版本 100%、`/dev/collection-v2-test` 回 404 |
| G7 使用者驗收 | 不變（預覽後取消，不寫正式資料） |

執行者依 TEAM-04：遠端與正式操作由 Claude 執行。

## 15. 工作命令 A5-G56：正式套用 0023 與套用後對帳（2026-11-24 已授權，DECISION_LOG D1-A5-G56-AUTH）

執行者：Claude（TEAM-04）。前置：G0、G1 通過（[Release-04 預檢](V2-Release-04-preflight.md) 第四輪）。

### 15.1 0023 盤點（2026-11-24）

- 檔案 `migrations/0023_shared_quantity_commit.sql`，450 行，最後修改提交 `7a460fd`，SHA-256 `8f2c8daa…b892d3`。
- 建立：3 表（`d1_quantity_collection_generation`、`d1_quantity_changes`、`d1_quantity_epoch`）、3 view（`d1_quantity_copy_evidence`、`d1_quantity_admission`、`d1_quantity_history`）、52 個 trigger（名稱皆以 `d1_` 開頭：`d1_generation_*` 43、`d1_quantity_*` 9）。
- 修改既有表：`ALTER TABLE v2_component_definitions ADD COLUMN last_quantity_operation_id TEXT`。
- 初始化資料：為每筆 `v2_collection_items` 建世代列（正式 256 筆）；`d1_quantity_epoch` 1 列（隨機值）。
- 與正式備份比對：52 個 trigger 名稱無衝突；`last_quantity_operation_id` 欄位不存在。
- ledger 表 `d1_migrations(id, name, applied_at)`。

```text
工作命令 ID：D1-A5-G56-20261124-01
工作目標：在正式 D1 套用 Migration 0023，並完成套用後唯讀對帳（§14.2 G5、G6）。

步驟與授權範圍：
  G5-R 本機預演（不連遠端）：
    以 G1 備份還原的記憶體 SQLite 執行「0023 原檔＋ledger INSERT」，確認無錯誤，並跑下列 G6 核對查詢得到預期值。
    不通過即停止，不進入 G5。
  G5-0 套用前唯讀複查（正式 D1 唯讀 SELECT 1 次）：
    ledger 仍為 22 筆且最後為 0022；d1_ 開頭物件 0；流量版本仍為 eff80d59（Metadata 讀取 1 次）。不符即停止。
  G5 套用（正式寫入，僅此 1 次）：
    以 npx wrangler d1 execute boardgame-collection-db --remote --file <組合檔> 執行。
    組合檔 = 0023 原檔內容（SHA-256 須與上方相同）＋ INSERT INTO d1_migrations(name) VALUES ('0023_shared_quantity_commit.sql');
    組合檔放在 Claude scratchpad，不加入 repo。
    **禁止** wrangler d1 migrations apply（migrations/ 內含候選 0024）。
  G6 套用後唯讀對帳（正式 D1 唯讀 SELECT，最多 2 次）：
    1. ledger 23 筆，最後一筆為 0023_shared_quantity_commit.sql
    2. sqlite_master 中 d1_ 開頭：table 3、view 3、trigger 52
    3. v2_component_definitions 含 last_quantity_operation_id 欄位
    4. d1_quantity_epoch 1 列；d1_quantity_collection_generation 筆數 = v2_collection_items 筆數（預期 256）
    5. d1_quantity_changes 0 列
    6. 分類列數（evidenceSize 同口徑）與 G0 相同（1,302）
  G6 正式網站唯讀抽查：Release-03 §10.5 清單（同 G0），確認套用後公開與 Admin 302 行為不變。
  G6 使用者人工確認（需登入）：R06 組件卡「更正歷史」改顯示「尚無更正紀錄」；一般清點可儲存（若使用者願意做一次真實清點）。

停止條件：G5-R 失敗；G5-0 任一項不符；G5 指令非 0 結束或回報錯誤；G6 任一項不符。
  停止後：不重試、不補 ledger、不手動補建物件、不執行任何修復 SQL；回報實際狀態。
  若懷疑部分套用（物件存在但 ledger 無 0023，或反之），立即停止並回報；修復需另行授權（可用 G1 備份，但正式還原屬高風險，須另擬計畫）。

風險與已知限制：
  - 0023 套用後不可撤銷（Migration 只能前向）。
  - wrangler --remote --file 在失敗時是否完全回滾，Claude 無法事先證實；以 G5-R 預演降低語法與資料面失敗機率，並以 G6 核對結果。
  - 套用後 52 個 trigger 會加在收藏、副本、組件、清點等寫入上（A1 量測一般寫入成本約 1.2～2 倍，皆在微秒級）。
  - 正式環境已是 A4 程式，套用後 D1 預覽、確認、歷史即開始可用。

禁止事項：除 G5 那 1 次外的任何正式寫入；DML 修資料；部署、推送、Secret、Access、DNS；Preview D1；
  讀取 .env／.dev.vars；git commit。

交付：G5-R 結果、G5-0 複查、G5 指令結果與時間、G6 六項數值、抽查結果、遠端操作次數（Metadata／SELECT／寫入分列）；
  追加至 docs/V2-Release-04-preflight.md（或新增 docs/V2-Release-04-summary.md），並在 HANDOFF.md 追加條目。
```
