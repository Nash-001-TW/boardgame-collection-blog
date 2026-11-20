# V1退役與V2資料表命名正規化：正式唯讀對帳與方案

> **使用者安排（2026-11-18）：保留本方案，暫不執行。等後續有必要的資料庫變更時，一併評估V1來源證據獨立保存、解除依賴、舊表退役與表名正規化。這不是刪表／改名／Migration／部署授權，也不要求為此單獨開啟資料庫變更。屆時重新核對現況、對帳與備份，不直接沿用本次快照作正式執行依據。**

2026-11-18（Asia/Taipei）。使用者要求確認V1是否全轉V2，若成功希望刪V1並正規化V2表名。本輪完成必要唯讀核對，未滿足可直接刪除的條件，因此沒有刪表、改名、Migration、部署或程式修改。新增對帳SQL與本報告，更新進度／架構索引。

## 結論

**核心業務資料轉移對帳通過，但不能直接刪V1。**

1. 正式主庫唯讀對帳：收藏256、歷史組件178、尺寸116、需求786，V1／V2筆數相符；四類映射缺漏／歧義皆0、目標孤兒映射0，共同資料與舊metadata檢查差異0。
2. 唯一已發現差異是63.5×88尺寸標籤：V1「63.5 × 88」，V2「63.5 x 88 mm」。尺寸值相同，為文字格式差異，不擅自覆寫V2。
3. V1與V2卡套產品／庫存交易皆0，沒有現有交易須補搬；Migration0012本身未包含這兩類搬移語句，不能把本次空表結果當成它有完整搬移能力。
4. V1 collection_items／collection_components目前仍由正式程式作分類來源證據；刪除會破壞分類讀取、清點與卡套套用。要先把必要來源證據保存為不依賴V1表的受控歷史證據，改程式並驗證，再刪舊表。
5. 不帶v2_不等於舊版：bgg_games／bgg_game_relations、notbgg_*、site_*仍是現行功能，不能按前綴一併刪除。正式bgg_game_relations現有1224筆，本輪沒有要求把它們搬成另一種手動關係。

「所有V1資料完整轉移」仍需以核准的欄位保留契約表述：本輪已核對下列實際欄位，但不是所有表結構、索引、歷史審計或多時點變更的逐位元等價證明。數次只讀查詢並非整庫同時點備份；正式刪除前要重新確認無並行寫入與新備份。

## 正式對帳證據

目標：boardgame-collection-db（既有專案正式D1），Wrangler回應served_by_primary=true。所有成功回應rows_written=0、changes=0、changed_db=false。本輪不要求重新登入網站，網路受限重試後既有工具認證可用，未新要求使用者提供秘密。

| 類別 | V1 | V2 | 映射缺漏／歧義 | 欄位結果 |
| --- | ---: | ---: | --- | --- |
| 收藏 | 256 | 256 | 0／0 | 名稱、類型轉換、收藏狀態、wishlist、created／updated、BGG身份及metadata一致 |
| 舊組件→定義 | 178 | 178 | 0／0 | 名稱、數量、單位轉換、收藏映射及legacy metadata一致；other為既定轉換，不當實體認領 |
| 卡套尺寸 | 116 | 116 | 0／0 | 寬高一致；1筆label格式差異 |
| 卡套需求 | 786 | 786 | 0／0 | source_key、數量、source_fragment、assignment、notes、時間、收藏／尺寸／組件映射一致；owned_copy_id均按舊item級NULL |
| 卡套產品 | 0 | 0 | 0012無此類map | 無現有資料可漏搬 |
| 庫存交易 | 0 | 0 | 0012無此類map | 無現有資料可漏搬 |

收藏metadata在D1內比對migration、legacy_id、source_key／row／serial、match_status、owned、catalog_status、factory_seal_status、legacy_notes，只輸出差異數；未回傳私人notes。組件比對migration／legacy_id、legacy_component_type、legacy_bgg_id、legacy_owned、legacy_match_status、legacy_quantity_unit及legacy_notes。

四類目標映射無dangling target。未將同source多target默認去重。尺寸label是否需保留原格式可作最終欄位保留決策，無須以自動覆寫修復。

SQL：scripts/v1-v2-retirement-audit-readonly.sql（7個SELECT／WITH讀取敘述）。補充metadata及schema清單以命令模式查詢，結果為本節摘要；沒有把私人列下載到報告。

操作記錄：第一次工具呼叫受sandbox日誌／網路限制失敗；允許外部唯讀後首次檔案查詢遇too many terms in compound SELECT，已移除首段六路UNION改成scalar counts。第二次檔案模式成功只回執行摘要（7queries、rows_written0）。嘗試命令轉送因npm／Windows參數處理在CLI解析時失敗，未執行SQL；改直接node呼叫已安裝Wrangler，取得7個結果。另6個metadata／schema／BGG計數SELECT及1個label差異SELECT均成功，寫入皆0。沒有業務SQL失敗後寫入修補或自動重跑Migration。

## Migration與現有依賴

- migrations/0012_v1_to_v2_migration.sql:6、21、55、84、93：有BGG身份、收藏、組件、尺寸與需求遷移，明寫additive、不刪V1。無產品／庫存交易搬移。
- docs/V2-Release-02-summary.md:79已明載APPLIED不證明歷史資料轉換完整；本次用新正式讀取補足核心資料對帳，不把ledger當內容驗收。
- src/lib/component-classifier-adapter.ts:42、46：查collection_components／collection_items；:50查legacy map，讀全域proof。
- src/lib/physical-component-management.ts:7：evidenceSize直接計V1兩表。
- src/lib/sleeve-workflow.ts:5：卡套套用證據量也直接讀V1兩表。
- src/lib/component-classifier.ts:89、168、252：歷史來源名稱、正反map、跨definition競爭認領參與資格。
- scripts/import-sleeves-d1.ts:75仍會產生V1收藏寫入；不能刪表後留下可誤用的活躍匯入入口。

## 刪除範圍與保留範圍候選

### V1退役候選（6張，尚未刪）

collection_items、collection_components、sleeve_sizes、sleeve_requirements、sleeve_products、sleeve_inventory_transactions，以及它們的舊view／index／trigger依賴。前兩張必須先替換分類證據來源；後四張即使對帳相符仍須核對FK／腳本／外部依賴與新名衝突。

### 保留現行資料

- bgg_games：現行BGG同步快取，不等於games身份表。
- bgg_game_relations：現行BGG證據，不與game_relations／site_game_relations盲目合併。
- notbgg_*、site_*：現行原稿、身份與關係／事件，沒有v2_不表示可刪。
- d1_migrations、_cf_KV、sqlite_*：遷移ledger與系統物件不作業務命名清理；不刪舊Migration檔案或重編歷史。
- 歷史備份與匯入原始檔不是V1表，保留，不按此任務清除。

## 命名正規化提案

命名採小寫snake_case、領域前綴、去版本前綴；本任務是表名一致化，不是重新做第三正規化、拆欄位或合併不同領域。以下31張v2_表均由正式schema清單確認；先移除v2_，保留既有語意。系統表及已正規命名的現行表不硬改。

| 現名 | 建議新名 |
| --- | --- |
| v2_games | games |
| v2_game_relations | game_relations |
| v2_collection_items | collection_items |
| v2_collection_relations | collection_relations |
| v2_collection_management | collection_management |
| v2_collection_events | collection_events |
| v2_owned_copies | owned_copies |
| v2_component_definitions | component_definitions |
| v2_copy_components | copy_components |
| v2_component_issues | component_issues |
| v2_copy_condition_tags | copy_condition_tags |
| v2_copy_condition_history | copy_condition_history |
| v2_physical_component_sources | physical_component_sources |
| v2_purchase_orders | purchase_orders |
| v2_purchase_order_lines | purchase_order_lines |
| v2_purchase_allocations | purchase_allocations |
| v2_acquisitions | acquisitions |
| v2_cost_adjustments | cost_adjustments |
| v2_sleeve_sizes | sleeve_sizes |
| v2_sleeve_products | sleeve_products |
| v2_sleeve_requirements | sleeve_requirements |
| v2_sleeve_inventory_transactions | sleeve_inventory_transactions |
| v2_sleeve_applications | sleeve_applications |
| v2_sleeve_admin_commands | sleeve_admin_commands |
| v2_sleeve_workflow_commands | sleeve_workflow_commands |
| v2_collection_copy_commands | collection_copy_commands |
| v2_purchase_admin_commands | purchase_admin_commands |
| v2_relation_admin_commands | relation_admin_commands |
| v2_bgg_sync_gate | bgg_sync_gate |
| v2_bgg_sync_commands | bgg_sync_commands |
| v2_legacy_id_map | legacy_id_map |

legacy_id_map不是因legacy字樣就可刪：保留來源ID與追溯，需審查新分類證據契約。若想改稱migration_id_map可在最後命名表選定，不在此擅自定案。

配套：v2_ view、index、trigger名稱亦盤點正規化，不能只改table而留不一致工具引用。最重要是**歷史字串名稱不可全域取代**：legacy_table、target_table、notes內proof的collection_items／v2_collection_items等是歷史來源識別；需區分來源namespace與現行實體表名。新V2 collection_items沿用舊名字後尤其不能讓分類器把新表當V1來源，形成自我驗證。不可用修改immutable source或偽造proof來讓測試通過。

## 可執行變更前的完整路徑

1. 本報告核心對帳完成；最終保留欄位契約處理label差異，必要時補反向映射唯一性／全部來源欄位及FK檢查。不能只依同筆數驗收。
2. 設計不依賴V1實體表的遷移證據：例如受控immutable來源證據／原始來源快照及ID映射，保存分類所需欄位與競爭認領語意；不是直接移除proof檢查、把歷史商品當實體，或把29UNKNOWN強改分類。這是必要新契約，方案未選。
3. 準備程式及腳本的新引用、停止V1匯入／寫入、保留歷史replay與移除舊表後可重建能力。rename不會更新程式SQL字串，亦不會自動更新資料列內歷史名稱。
4. 在隔離副本驗證遷移／改名、分類149／29／0語意、清點／卡套、公開資料、FK／完整性、歷史映射、全新建庫與舊庫升級；新測試／原型另授權。本輪沒有執行。
5. 準備新Migration及新Worker切換的部署／回復方案：改名後舊Worker會讀不到表，不能把SQL成功當網站可用。保留回復產物、驗證備份可還原，不能只回滾Worker忽略DB結構。
6. 正式執行前重新備份、確認無並行寫入、取得當前schema與完整對帳、審核具體刪除與rename清單；條件滿足後依使用者授權執行。現在因仍有必要依賴，刪除條件未達成，不執行DROP或rename。

## 官方技術依據

- https://www.sqlite.org/lang_altertable.html ：rename可更新schema中的部分FK／view／trigger引用（依設定／版本），不會替換程式碼或資料字串；index／trigger附著保留不代表名稱自動符合命名規範。D1實際行為須隔離驗證。
- https://developers.cloudflare.com/d1/reference/migrations/ ：用新順序Migration記錄改動，保留既有d1_migrations與歷史鏈，不修改已套用0012偽裝原本即無V1。

## 本輪狀態

V1_CORE_DATA_RECONCILIATION_PASSED_WITH_ONE_LABEL_FORMAT_DIFFERENCE

V1_RUNTIME_DEPENDENCY_PRESENT / RETIREMENT_NOT_READY

TABLE_NORMALIZATION_MAPPING_PROPOSED

NO_PRODUCTION_SCHEMA_OR_BUSINESS_DATA_WRITES
