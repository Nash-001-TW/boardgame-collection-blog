# D1 SQL Schema V1.1 — 現況、關聯與約束設計草案

> **非可執行 Migration**。本文件以已上傳的遠端 D1 `sqlite_master` 定義為已確認事實；新增欄位／表為**提案**，不可當成已存在。

## 1. 已確認的 V2 表（共 21 張）
`v2_acquisitions`, `v2_collection_items`, `v2_collection_relations`, `v2_component_definitions`, `v2_component_issues`, `v2_copy_components`, `v2_copy_condition_history`, `v2_copy_condition_tags`, `v2_cost_adjustments`, `v2_game_relations`, `v2_games`, `v2_legacy_id_map`, `v2_owned_copies`, `v2_purchase_allocations`, `v2_purchase_order_lines`, `v2_purchase_orders`, `v2_sleeve_applications`, `v2_sleeve_inventory_transactions`, `v2_sleeve_products`, `v2_sleeve_requirements`, `v2_sleeve_sizes`。

### 已確認核心關聯
- `v2_collection_items.game_id → v2_games.id`（`ON DELETE SET NULL`）。
- `v2_owned_copies.collection_item_id → v2_collection_items.id`（`RESTRICT`）；實體有 `edition`, `language_code`, `seal_status`, `inventory_status`, `inspection_status`, `trade_condition`。
- `v2_acquisitions.owned_copy_id → v2_owned_copies.id`；`purchase_order_line_id → v2_purchase_order_lines.id`（可 NULL）。
- `v2_purchase_order_lines.purchase_order_id → v2_purchase_orders.id`；`collection_item_id → v2_collection_items.id`（可 NULL）。
- `v2_purchase_allocations` 連訂單／明細／實體或收藏項目；有 XOR CHECK：`owned_copy_id` 與 `collection_item_id` 必須恰好一個非 NULL。
- `v2_component_definitions.collection_item_id → v2_collection_items.id`；`v2_copy_components` 連實體與配件定義。
- `v2_sleeve_requirements` 連收藏項目、可選實體、可選配件定義與卡套尺寸；尺寸欄位為 `size_id`（**不是** `sleeve_size_id`）。
- `v2_sleeve_sizes` 唯一鍵 `(width_tenth_mm,height_tenth_mm)`。
- `v2_purchase_orders.status` CHECK：`open, paid, partially_received, completed, cancelled`；不含 `draft`。
- `v2_purchase_orders` 已有 `item_subtotal_minor`, `shipping_minor`, `tax_minor`, `fee_minor`, `discount_minor`, `refunded_minor`。

**資料庫完整 CREATE TABLE 定義請以 `docs/reference/d1_v2_schema.json` 為準，不要用本文件替代。** 目前只有 CREATE TABLE，尚未取得完整 indexes/triggers/PRAGMA foreign_key_list，Codex 必須先比對專案 migrations 與正式 schema。

## 2. 權威資料邊界（避免雙主檔）
| 事實 | 權威表／預定權威來源 | 注意 |
|---|---|---|
| 商品 | `v2_games` | 不另建商品表 |
| 收藏項目 | `v2_collection_items` | 不等於一份實體 |
| 實體 | `v2_owned_copies` | 一份一列 |
| 訂單 | `v2_purchase_orders` | 沿用，擴充生命週期 |
| 訂單明細 | `v2_purchase_order_lines` | 沿用，正式快照獨立 |
| 取得事件 | `v2_acquisitions` | 不與 provenance 重複表示同一真相 |
| 精確到貨單位 | 擬新增 `purchase_receipt_units` | `(receipt_item_id,unit_index)` 唯一 |
| 付款／退款 | 擬新增獨立交易明細 | 舊累計欄位不得二次加總 |
| 卡套庫存 | `v2_sleeve_inventory_transactions` | 不建立第二套帳本 |

## 3. 建議新增邏輯表（**18 張候選，尚未定稿**）
| 表名 | 最低欄位／FK 建議 | 必要約束／設計備註 |
|---|---|---|
| `bundle_masters` | `id INTEGER PK`, `game_id INTEGER → v2_games.id` | `UNIQUE(game_id)`；bundle 主檔與商品主檔共用 |
| `bundle_versions` | `id`, `bundle_master_id → bundle_masters.id`, `version_no`, `created_at` | `UNIQUE(bundle_master_id,version_no)`；被正式引用後凍結 |
| `bundle_version_items` | `id`, `bundle_version_id → bundle_versions.id`, `game_id → v2_games.id`, `quantity` | `CHECK(quantity>0)`；不可巢狀 bundle，需跨表驗證 |
| `purchase_order_lifecycle` | `purchase_order_id INTEGER PK/FK → v2_purchase_orders.id`, `document_status`, `confirmed_at`, `archived_at` | 草稿／正式／作廢與履約／財務狀態分離；先檢查現有 status CHECK |
| `purchase_item_snapshots` | `id`, `order_line_id → v2_purchase_order_lines.id`, `game_id → v2_games.id` (nullable), `bundle_version_id → bundle_versions.id` (nullable), `snapshot_json` | 需確定套組展開結構、版本及購買時描述、價格、幣別；正式後不可覆寫 |
| `purchase_cost_entries` | `id`, `purchase_order_id → v2_purchase_orders.id`, `cost_type`, `amount_minor` | 正式費用與舊彙總欄位單一權威，修正採反向紀錄 |
| `purchase_payments` | `id`, `purchase_order_id → v2_purchase_orders.id`, `amount_minor`, `payment_method`, `occurred_at` | `CHECK(amount_minor>0)`；唯一外部請求鍵防重 |
| `purchase_refunds` | `id`, `purchase_order_id → v2_purchase_orders.id`, `payment_id → purchase_payments.id` (nullable), `amount_minor` | `CHECK(amount_minor>0)`；超額退款需交易內驗證 |
| `purchase_settlements` | `id`, `purchase_order_id → v2_purchase_orders.id`, `settlement_status`, `occurred_at` | 保留人工結算／重開歷史，避免單筆覆寫 |
| `purchase_receipt_batches` | `id`, `purchase_order_id → v2_purchase_orders.id`, `received_at`, `request_key` | 每批唯一、可冪等；不可直接刪正式收貨 |
| `purchase_receipt_items` | `id`, `receipt_batch_id → purchase_receipt_batches.id`, `order_line_id → v2_purchase_order_lines.id`, `game_id → v2_games.id`, `quantity` | `CHECK(quantity>0)`；跨表確認訂單一致、套組商品快照與可收數 |
| `purchase_receipt_units` | `id`, `receipt_item_id → purchase_receipt_items.id`, `unit_index`, `owned_copy_id → v2_owned_copies.id` | `UNIQUE(receipt_item_id,unit_index)`、`UNIQUE(owned_copy_id)`、`CHECK(unit_index>0)`；檢查 unit_index≤quantity |
| `purchase_change_events` | `id`, `purchase_order_id → v2_purchase_orders.id`, `event_type`, `status` | 多種異動，獨立結案／重開／作廢留痕 |
| `purchase_change_actions` | `id`, `change_event_id → purchase_change_events.id`, `action_type`, `status` | 同一事件多個處置、各自狀態 |
| `purchase_change_action_links` | `id`, `change_action_id → purchase_change_actions.id`, `target_type`, `target_id` | **多型 target_id 無法一般 FK 保證**；優先改成具體 FK 欄位／型別表或強制交易驗證 |
| `collection_provenance` | `id`, `owned_copy_id → v2_owned_copies.id`, `receipt_unit_id → purchase_receipt_units.id` (nullable), `source_type` | **須與 receipt_units / v2_acquisitions 去重**；未定稿前不可實作三份權威來源 |
| `purchase_audit_logs` | `id`, `entity_type`, `entity_id`, `before_json`, `after_json`, `actor`, `occurred_at` | 稽核不可無痕刪改；避免敏感資訊全文外洩 |
| `collection_copy_verifications` | `id`, `collection_item_id → v2_collection_items.id`, `confirmed_quantity`, `edition`, `language_code`, `verification_status`, `verified_at`, `applied_at` | 同項不同版本／語言分組；`draft/confirmed/applied`；需另設冪等來源對照或唯一鍵 |

> 注意：18 張是設計候選清單，**不是要求一定建立 18 張**。Codex 應提出最小可維護正規化方案，尤其精確來源表、取得來源、套組快照、異動連結可能整併或調整。

## 4. 邏輯關聯示意（非 DDL）
```text
v2_games ─── bundle_masters ─── bundle_versions ─── bundle_version_items ──> v2_games
     │
     └──> v2_collection_items ──> v2_owned_copies ──> v2_copy_components / v2_sleeve_applications
                  │                      ▲
                  └──> v2_purchase_order_lines (可選) │
v2_purchase_orders ──> v2_purchase_order_lines ──> purchase_item_snapshots
         │                         │
         ├──> purchase_receipt_batches ──> purchase_receipt_items ──> purchase_receipt_units ─┘
         ├──> purchase_payments / purchase_refunds / purchase_cost_entries / purchase_settlements
         └──> purchase_change_events ──> purchase_change_actions
```
`v2_purchase_order_lines.collection_item_id` 目前可 NULL，實際訂單商品／套組快照映射需要設計，不可假定 `v2_games` 與 `v2_collection_items` 一對一。

## 5. 重要資料庫約束與 D1/SQLite 限制
- 既有 V2 主鍵是 `INTEGER`；新 FK 連既有表必須使用相容的 `INTEGER`，不得臆造 TEXT UUID 主鍵。
- `UNIQUE(receipt_item_id,unit_index)`；`UNIQUE(owned_copy_id)` 要考慮 NULL 與作廢後重收語意；若採部分唯一索引，明確定義有效狀態。
- 單位編號不可超過收貨明細數量；累計收貨不可超過訂單／套組快照數量；**CHECK 無法直接查其他表**，須交易驗證／Trigger。
- 需核對 receipt_item 的 order_line 與 batch 是否同一訂單、game 是否在正式快照內、owned_copy 對應 collection_item 是否正確。
- 正式快照不可變：定義可變更欄位、事件追加、必要 Trigger／權限路徑，不能只靠 UI 禁用。
- 冪等：唯一 `request_key`／`source_key` + 原子交易，重試不得重複產生收貨與實體。
- 不允許因日期更正而改動穩定 FK；人類可讀收貨碼是衍生顯示，不是唯一內部 ID。
- 訂單 `draft` 不在現有 status CHECK，**不能直接 UPDATE 成 draft**；須設計生命週期表或經審核的安全表重建。
- 財務 `*_minor` 單位與幣別必須明確一致；負數更正只允許受控型別；不重複計算舊彙總欄位。
- D1 遠端實作前須確認 Wrangler／D1 可用的原子交易方式，不能假定任意 BEGIN/COMMIT SQL 在執行環境都可直接使用。

## 6. 待 Codex 先閱讀／核對的本機檔案
- `wrangler.json`：binding `DB`，database_name `boardgame-collection-db`，`migrations_dir=./migrations`（以實際專案為準）。
- 既有 migrations：`0007_v2_core_schema.sql`、`0008_v2_purchase_costs.sql`、`0009_v2_purchase_integrity.sql`、`0010_v2_copy_conditions.sql`、`0011_v2_sleeve_management.sql`、`0012_v1_to_v2_migration.sql`（以專案實際路徑為準）。
- 任何現有 Astro 頁面、D1 access layer、資料型別／查詢／寫入 service。
- 必須另盤點 `sqlite_master` 的 indexes/triggers、`PRAGMA foreign_key_list`、`PRAGMA index_list`、`PRAGMA table_info` 與 migration 歷史；目前未完整取得。

## 7. 待決議問題（先提問，不要擅自填補）
1. 新收到商品若尚無 collection_item，如何建立／重用而不重複？
2. receipt_units、collection_provenance、v2_acquisitions 三者哪一張是精確到貨來源的唯一權威？
3. 套組版本與 snapshot_json 是否同時需要結構化 constituent rows？
4. 退款、費用與 v2_purchase_orders 彙總欄位的兼容及同步方式？
5. 既有 status CHECK 的安全演進方案與原程式兼容性？
6. 舊藏品人工確認分批建立的唯一來源鍵及可重試流程？
