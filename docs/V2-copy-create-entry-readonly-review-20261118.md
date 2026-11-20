# 副本建立入口與S7差異：唯讀核對

2026-11-18（Asia/Taipei）。承接使用者貼入的S7採納與呼叫鏈核對需求。只讀src／scripts／migrations／tests，未執行任何測試、腳本、DB查詢或Migration；未改應用程式。本文件與進度索引為本輪文件更新。

## 最新設計基準

使用者已採納TC23、P1分類可用性及S1～S7；以下是設計規則，不是已實作能力：

- N只計適用且已確認實體定義ID，M須組件checked且actual為有效非負整數；LEGACY_PRODUCT不計N／M／U。不可用不冒充UNKNOWN或失去完成。
- 同收藏共用實體定義，可逐副本明確不適用；新增副本與定義預設共用。語言／版本不自動推斷；不設常態適用性待確認；逐副本expected差異另議。
- 恢復適用沿用仍有效的舊清點值／日期，不製造清點事件。適用性操作歷史與清點／完成事件分開；原因欄位等未定。
- 不適用不能排除UNKNOWN／驗證不可用來繞過U。適用變更、歷史及必要完成判定／事件一致提交，範圍外保留凍結判定。
- S6新增實體定義＋初始副本例外，S7新增副本＋初始定義例外，都是同一次確認與原子操作。只記最終有效適用設定，不偽造中間適用→排除；集合過期拒絕，不自動換版本重送。
- 新副本不複製其他副本清點紀錄。範圍外初始尚未判定；首次符合完成可記達成，不符合不記失去。
- C1／C2、V1／V2及順序／儲存方案均未選。UI、Schema、實作、測試與正式操作仍未授權。

## 搜尋範圍與結論

CODE_CONFIRMED：src內找到3處直接INSERT v2_owned_copies，位於2個寫入服務。scripts／migrations靜態搜尋未找到其他直接副本INSERT；tests有直接建立合成／驗證副本的程式，但本輪未執行，不列成日常管理入口。

UNKNOWN：專案外工具、人工SQL、未匹配的動態表名SQL或未來入口不在此閉包保證。以下是已檢查程式的呼叫鏈，不代表正式HTTP操作已驗收。

## 三條應用程式建立鏈

| 路徑 | 前端與API | 服務／直接INSERT | 何時建立 |
| --- | --- | --- | --- |
| R03 新收藏附建副本 | CollectionAdmin.astro:61；collection-admin-controller.ts:183；POST /api/admin/collection，collection-admin-api.ts:41 | CollectionV2Repository.management→CollectionV2Writer.create；collection-v2-management.ts:203、221 | createCopy=true；收藏與首個副本同批建立 |
| R04 收藏編輯補建 | controller:167、170、184；PATCH /api/admin/collection/[id]，collection-admin-api.ts:49 | CollectionV2Writer.update；collection-v2-management.ts:264、273 | 沒有managed_copy_id且createCopy=true。已有managed copy只更新該副本語言／版本，不新增 |
| R05 副本頁獨立新增 | collection-copies-controller.ts:20、29；POST /api/admin/collection/[id]/copies；collection-copies-api.ts:21 | writeCollectionCopy(edit=false)；collection-copies.ts:35、74 | 通過收藏歸屬／revision等檢查後新增，可與其他既有副本並存 |

API route轉接：src/pages/api/admin/collection/index.ts:6、[id].ts:6、[id]/copies.ts:6。Repository wrapper匯入CollectionV2Writer：src/lib/collection-v2-repository.ts:1。它不使三條鏈自動共用一個建立實作。

## 輸入與驗證

| 路徑 | 既有白名單／驗證 | S7缺口 |
| --- | --- | --- |
| R03 | 外層ref／data／createCopy；createCopy boolean，遊戲ref與scope驗證；data只接受收藏欄位及language／edition等，無新增組件或適用例外 | 新收藏目前不接受同操作新增定義，不應從S7順帶擴張。首副本初始化及集合契約未實作 |
| R04 | expectedRevision／data／createCopy；拒已封存、revision須匹配；已有managed copy則不建立 | 不接受例外，也沒有新判定契約；不能只因前端checkbox disabled就當後端無建副本路徑 |
| R05 | expectedRevision／label／language／edition，edit才可copyId；未知欄位拒絕。scope、收藏存在／未封存、revision重驗 | 例外欄位未接受；沒有適用關係／分類全集／首次完成判定 |

證據：collection-admin-api.ts:42、46、49；collection-v2-management.ts:11（data白名單）、203、264；collection-copies.ts:40、57。三鏈都有後端Access認證、Origin檢查與寫入限制，actor由auth.admin.subject取得：collection-admin-api.ts:11、13、16；collection-copies-api.ts:9、18、20。

## 交易、版本與冪等

### R03（CODE_CONFIRMED）

- actor＋scope＋Idempotency-Key組合request_key，fingerprint含ref、data、scope及createCopy；先查collection_management既有key，同內容回collectionId，不同內容409：collection-v2-management.ts:207。
- 建遊戲必要列、收藏、collection event、management、可選副本及舊採購圖在同一db.batch：同檔:214、217、219、220、221、224、231。
- batch失敗再查相同key競爭贏家的結果：:232。成功後另查collectionId：:235。
- INFERRED：現有設計意圖為收藏與副本同批提交，不能直接宣稱S7額外歷史／完成事件已受保護。提交後查詢失敗亦不代表batch回滾。
- 尚非新完整冪等契約：無過期辨識／新事件精確關聯；不可把collectionId重播當完整原結果快照。

### R04（CODE_CONFIRMED）

- get讀collection及revision，拒已封存，expectedRevision匹配：同檔:264、265。
- collection event推進revision，management更新；沒managed copy時可插入副本並更新managed_copy_id；可同批有舊採購寫入：:268、273、279。
- 全部statements交db.batch，失敗映射CONFLICT／STORAGE，成功後detail另讀：:289、290。
- 本分支沒有R03或R05式command成功識別重播；API PATCH不把Idempotency-Key傳給update：collection-admin-api.ts:49。
- INFERRED：相同舊revision重送通常被拒，可防相同確認重建，但無法讓呼叫端辨識第一次已成功。不能把revision守衛當冪等重播。

### R05（CODE_CONFIRMED）

- request_key hash綁actor／scope／collectionId／key；request_hash含edit／copyId／revision／fields：collection-copies.ts:48。
- 先查v2_collection_copy_commands重播，再查收藏狀態與revision：:50、56、57。
- collection event、management revision、副本INSERT、command在同一batch；用changes()把零列變NULL copy_id，NOT NULL觸發失敗：:63、74、78、82。
- 失敗後查既有command，回原copyId或映射狀態衝突：:85。
- collection revision gate在DB event插入時檢查預期版本：migrations/0015_notbgg_collection.sql:71；command schema與immutable trigger：migrations/0019_collection_copy_commands.sql:1。
- 目前重播copyId而非清點／完成原結果，也沒有新過期識別。前端鍵WeakMap只活在頁面記憶體，同內容重用、變內容換鍵：collection-copies-controller.ts:12、23。

## 是否能繞過共用責任

CODE_CONFIRMED：目前沒有S7共用建立責任；R03／R04走writer，R05獨立服務。只擴充R05會留下R03／R04缺口；只在前端新增例外控制也不足。

INFERRED：需讓三鏈達成同一業務不變條件，但不強制同一函式或API。R03須保留收藏／首副本整體原子邊界，不能在收藏提交後才呼叫另一個獨立副本API。

UNKNOWN：新收藏建立瞬間的空定義集合如何與S7初始化／外部並行新增銜接、適用例外與初始歷史、全候選分類、範圍與需求、重判與事件精確關聯，皆待設計。現有收藏revision未由所有組件寫入者推進，不能直接當完整定義集合守衛。

已採納R10唯一採購編輯入口；目前R03／R04仍有舊採購寫入。本次只記錄既有交易內容，不因此撤回R10設計或授權保留舊能力為新契約。

## 其他直接建立者（非日常入口）

tests/collection-gaps.test.ts:27、tests/d7a-preflight.ts:22、tests/helpers/public-collection-fixture.ts:42、tests/helpers/sleeve-workflow-fixture.ts:13、tests/notbgg-repository.test.ts:146、tests/physical-component-management.test.ts:82、tests/purchase-admin-browser.mjs:20、tests/purchase-admin.test.ts:17、tests/release-migration-chain.test.ts:22、tests/sleeve-workflow.test.ts:16等有fixture／驗證插入。檔名tests不等於允許執行；本輪沒有檢查每個腳本執行時的DB環境，更沒有執行。未用它們補造正式資料。

## 下一步建議

不用重新批准S7，也不用再增加一組入口原則。設計上把R03／R04／R05列為同波符合S7的驗收門檻；具體共用方式留技術方案。

下一個真正業務待決點是「checked且數量有效，但使用者清點日期缺失」如何影響目前完成／日期／首次事件；現有系統時間不能拿來回填。先處理此題，再回到完整交易／冪等候選與最小隔離驗證計畫。以上為建議，不授權實作或測試。
