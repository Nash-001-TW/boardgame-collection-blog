# Board Game Collection Blog — D1 V1.1 需求與決策交接

> 狀態：規劃／審查版，非實作授權。更新：2026-10-22。適用：Astro + TypeScript + Cloudflare Workers + D1 + BGG API。

## 0. Codex 工作邊界（必讀）
- **第一階段只能閱讀、分析、提出建議。** 不得修改程式碼、Schema、Migration、D1 資料、Cloudflare 設定或部署。
- 不得執行任何遠端 D1 寫入、DDL、匯入、資料清理；不得自動產生或套用 254 份實體收藏品。
- 不得以空表為由擅自覆蓋／重建既有表；不執行破壞性變更。任何後續修改必須先提出檔案清單、SQL、風險、驗收與回復計畫，等待使用者明確授權。
- 專案實際程式、`migrations/`、正式 D1 Schema 為實作事實來源；本文件為業務決策來源。若衝突，列出差異，不自行猜測。

## 1. 產品目標
個人桌遊收藏部落格，整合 BGG 商品資訊與自訂收藏資料；新增套組版本、購買訂單、分批到貨、逐份實體、付款／退款、售後異動、卡套庫存與可追溯稽核。UI 與 DB 必須區分「商品／收藏項目／每一份實體」。

## 2. 已確認的遠端 D1 現況（2026-10-22，唯讀查詢）
- 21 張 `v2_` 表；`v2_games` 224；`v2_collection_items` 256；`v2_component_definitions` 178；`v2_sleeve_requirements` 786。
- `v2_collection_items`：`production/owned` 254、`production/preordered` 2；無其他分類（就該次分組查詢而言）。
- `v2_owned_copies`、`v2_purchase_orders`、`v2_purchase_order_lines`、`v2_acquisitions`、`v2_purchase_allocations` 均為 0 筆。
- **這些是資料列數，不是實際收藏份數。** `owned` 254 不可推論為 254 份實體。
- 參照使用者提供的 `d1_v2_schema.json`、`d1_v2_counts(1).json`、`d1_collection_status.json`；CMD 輸出可能為 UTF-16 LE，解析時先偵測編碼。

## 3. 核心實體與語意
1. `v2_games`：商品／BGG 或手動主檔；主鍵 `id INTEGER`。不可另建平行商品主檔。
2. `v2_collection_items`：收藏清單項目、預購／願望清單、顯示名稱；`game_id` 可為 NULL；**不是每份實體**。
3. `v2_owned_copies`：每一份實際持有實體；`collection_item_id` 必填；版本、語言、封膜、盤點、檢查、保存狀況逐份記錄。
4. `v2_component_definitions`：卡牌、圖板、模型、Token 等**實體配件定義**，不是套組包含的桌遊商品。
5. `v2_sleeve_requirements`：現有卡套需求，不可重新匯入或覆蓋 786 筆。
6. `v2_purchase_orders` / `v2_purchase_order_lines`：沿用既有訂單主檔及明細，不另建第二套權威訂單表。

## 4. 舊收藏品實體化（使用者已明確決定）
- **逐項人工確認實際份數、版本及語言後，才可建立 `v2_owned_copies`。**
- 254 筆 `owned` 先保留原狀；2 筆 `preordered` 不可提前建立實體。
- 一項多份、多語言、多版本：依每個確認群組與實際份數建立獨立實體；支援批次確認但不得跳過核對。
- 不明份數／版本／語言應保留待確認，不能填入猜測值；沒有購買來源的舊藏品允許空白／opening balance。
- 確認與套用分離：預覽、核准、套用、驗證；重試冪等，保留確認紀錄與實體對照、操作者、時間及更正原因。

## 5. 套組、商品與訂單
- 套組主檔／版本／版本商品項目三層；不允許巢狀套組；版本被正式訂單引用後不可原地改寫。
- 單品、擴充、PROMO、配件、加購、贈品替代可進入訂單；套組內容可包含多個獨立商品。
- 套組本身只有一個購買售價；**不將套組價格強制分攤到內含商品**。加購品獨立計價；既有 `v2_purchase_allocations` 不可自動觸發強制分攤。
- 草稿可編輯，只有正式確認才產生正式訂單編號及不可任意改寫的購買快照；草稿不計入正式財務／到貨／待辦。
- 正式訂單可透過可稽核事件追加加購、取消未到貨項目、修正；不可無痕覆寫原購買快照。
- 正式文件狀態、履約狀態、財務狀態、封存狀態要分開；`v2_purchase_orders.status` 目前只允許 `open/paid/partially_received/completed/cancelled`，不可直接寫入 `draft`。

## 6. 財務
- 單一幣別 TWD（現有表仍有 `currency_code`，需定義相容規則）；金額整數 `*_minor`，須先明確定義新台幣金額與 minor unit 轉換及 UI 顯示。
- 支援商品數量×單價、折扣、運費、稅費、多筆其他費用、現金取貨／轉帳／分期／信用卡付款、退款、人工結算與重開。
- 正式付款、退款、費用交易明細各自為權威資料；舊表 `refunded_minor` 等累計欄位不得重複加總。結算可手動覆核但保留歷史。

## 7. 到貨、實體與售後
- 依到貨批次、訂單／套組快照商品、數量逐次收貨；不得超收。
- 每一實際收到的商品份數產生一筆 `v2_owned_copies`（先確認 `v2_collection_items` 對應策略），且有唯一到貨單位與可稽核來源。
- 人類可讀編號：`YYYYMMDD-收貨明細代碼-單位序號`，**不可當穩定關聯主鍵**；穩定唯一鍵 `(receipt_item_id, unit_index)`。
- 到貨與實體建立／來源關聯原子性，重試冪等；部分到貨、缺貨、退貨、換貨、補寄、替代品與原商品關聯可追蹤。
- 實體狀態：收藏中、借出、售出、贈送、遺失、退回／換出等；需檢視既有 CHECK 限制再決定延伸方式。
- 缺件／損壞的「配件補件」不是新的桌遊實體；整盒換貨才建立新的實體並保留舊實體處理歷史。
- 售後事件（短少、取消、替代、補寄、折扣、退款、退換貨）可多處置、分別完成、手動關閉／重開、作廢留痕；待辦以有效未結事項計算。

## 8. 卡套與配件
- 沿用 `v2_sleeve_sizes`（`width_tenth_mm/height_tenth_mm`，十分之一毫米）、`v2_sleeve_products`、`v2_sleeve_requirements`、`v2_sleeve_inventory_transactions`、`v2_sleeve_applications`。
- 需求依收藏項目／版本／語言／卡牌群組判斷，實際使用進度依每份實體；僅已擁有、尚未完成上套的實體計入缺口。
- 卡套採包裝與散片、開包、使用、退回、損耗的庫存流水；先審核既有交易語意，不可另設相互衝突的庫存真相。

## 9. 不可違反的驗收原則
- 既有 224/256/178/786 筆保護不丟失；不可自動生成 254 筆實體。
- 沒有正式確認的草稿不可出現在財務／到貨／待辦。
- 套組正式快照不可隨新版套組變動。
- 任何到貨不超收、不重複；每份實體有唯一有效精確來源或明確標示歷史未知來源。
- 正式財務不重複計價；更正／退款／退換貨可稽核；每個階段具備可驗證與回復方案。

## 10. 尚未確認，不得自行決定
- 既有 `v2_collection_items` 與新收到商品的映射／去重策略。
- `purchase_receipt_units` 與 `collection_provenance` 是否合併權威關聯；與 `v2_acquisitions` 的一致性策略。
- 舊 `v2_purchase_orders.status` 的安全演進（新增生命週期表或受控重建）。
- `v2_purchase_allocations` 與新費用明細如何相容；既有 `refunded_minor` 是否快取／停用。
- 正式快照採結構化明細加 JSON 的具體欄位與不可變策略。
- 各種交易狀態及退換貨語意的最終 CHECK／索引／Trigger。
