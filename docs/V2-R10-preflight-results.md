# R10 實作前核對結果與 R11 背景

日期：2026-11-17（Asia/Taipei）。只做程式／Schema核對、正式唯讀聚合與隔離測試；沒有應用程式、Migration、正式資料修改或部署。以下符合／不符是對新規格的比較，不是正式功能完整驗收。

## 證據與限制

正式 D1 boardgame-collection-db 查得 orders_total=0、lines_total=0、allocations_total=0、noninteger_prices=0、overallocated_orders=0。幣別 GROUP BY 無列。正式查詢 rows_written=0、changed_db=false。未讀私人名稱、金額或備註，未重做網站登入。首次受沙箱網路與Wrangler日誌路徑限制失敗；使用允許網路與專案內日誌後成功，無重新登入。--file模式七個唯讀查詢只回摘要，最終以--command取得明確聚合結果，不把摘要當逐題結果。

測試命令：node --import tsx --test tests/purchase-admin.test.ts（10通過）；node --import tsx --test tests/r10-preflight-audit.test.ts（1通過）。均隔離記憶體SQLite／合成認證，不觸正式寫入；原測試中的fixture failure日誌為故意注入回滾案例，非測試失敗。新測試是現況特徵，不是新規格已通過。

## 第一組：資料與金額

| 題 | 結果 | 證據與解讀 |
| --- | --- | --- |
| 1 | 不符（附位置） | 正式沒有訂單，無已使用幣別。src/lib/purchase-admin.ts:31 只驗三碼大寫，無幣別精度表；migrations/0008_v2_purchase_costs.sql:3 定義整數最小單位，但空資料無法證明歷史轉換語意。 |
| 2 | 無法判定 | API purchaseInteger要求安全整數，Schema單價INTEGER；正式明細0、非整數單價0。沒有小於最小單位的現存樣本，不能推論實際未來需求。SQLite非STRICT的INTEGER affinity本身不是完整整數型別保證。 |
| 3 | 符合規格 | 正式未指定收藏明細／所屬訂單均0，無內容可分類；所有明細總數為0，不讀文字猜用途。Schema允空但目前API不允，見第三組。 |
| 4 | 符合規格 | 超額訂單0，計成本三狀態0、其他狀態0；僅判此次無既有異常，不代表新流程完成。 |
| 5 | 符合規格 | 正式分攤總數0，因此願望清單／封存收藏上的計成本分攤均0。 |
| 6 | 符合規格 | direct訂單0，可編0、鎖定0；不代表現行direct編輯行為符合新規格。 |

## 第二組：鎖定與引用

| 題 | 結果 | 證據與解讀 |
| --- | --- | --- |
| 1 | 符合規格 | 歷史實際指admin_managed不為1，不依日期。0021 migration舊列預設0、新R10訂單設1。purchase-admin.ts:94–108 的locked另含acquisitions引用、sleeve inventory引用及不符合編輯器圖形的分攤。外部圖形包括分攤數≠明細數、line_number非連續、每列非恰一同收藏／非副本分攤。無獨立白話鎖定原因陣列。 |
| 2 | 不符（附位置） | purchase-admin.ts:53–63 讀取＋UPDATE guard在後端擋歷史／引用訂單，409 PURCHASE_READ_ONLY；隔離直接API儲存／取消引用訂單均409。purchase-admin-api.ts:6–13只有GET/POST，沒有獨立取消／恢復端點，狀態可從通用POST修改，尚無新規格狀態操作邊界。 |
| 3 | 不符（附位置） | purchase-admin.ts:32只驗狀態枚舉，沒有前狀態轉換規則。隔離API paid→cancelled 201、cancelled狀態仍改備註201、cancelled→open 201。外部引用會擋取消，但未引用的cancelled未唯讀。 |
| 4 | 符合規格 | 路由src/pages/api/admin/purchases.ts交給purchase-admin-api.ts，非GET/POST回405；隔離DELETE確為405。未找到採購刪除API。DB外鍵不是全面禁止SQL刪除：訂單到明細／分攤RESTRICT、部分明細引用SET NULL、庫存引用RESTRICT；無API≠DB全不可變。 |
| 5 | 符合規格 | R10編輯器對庫存引用整單鎖定，不可改任何欄（purchase-admin.ts:58–59、101–108）；DB本身沒有同等整單鎖定。舊收藏編輯流程另見下方衝突。 |

引用來源：migrations/0008中的v2_acquisitions／v2_purchase_allocations引用明細、v2_collection_management.managed_order_id直接引用訂單、0011中的庫存交易引用明細。collection-v2-management.ts:224–229、282–286建立採購明細／取得關聯，分攤有的是綁副本而無line FK；R10寫入明細分攤。現行sleeve-admin.ts庫存新增欄位清單不寫purchase_order_line_id，sleeve-workflow.ts USE也不寫，未找到非測試庫存關聯寫入流程；欄位及可能外部SQL資料仍存在，不能說資料模型無引用。

## 第三組：實作落差與一致性

| 題 | 結果 | 證據與解讀 |
| --- | --- | --- |
| 1 | 不符（附位置） | PurchaseLine.astro:8–9前端收藏／說明required；purchase-admin.ts:38–39後端收藏正整數／說明非空；77–78只寫production未封存收藏。DB 0008:38 collection_item_id可空，但37 description NOT NULL＋trim長度>0；封存無DB FK禁止。另allocations必須指定副本或收藏其中一個，所以未指定且不分攤的新明細不能沿用「每列必建分攤」不變的圖形。 |
| 2 | 符合規格 | 非整批刪明細；purchase-admin.ts:76–80以(order,line_number) UPSERT，行id保留但按輸入位置映射。分攤65行先刪後逐列重建，依本次陣列index對應line_number並存實際line FK。55行禁止新列數少於舊列數；未有payload穩定line id驗證，不代表任意重排安全。 |
| 3 | 符合規格 | UPDATE以admin_revision比對並增版，舊版409；命令表冪等鍵hash，同鍵同內容重播、不同內容409。既有隔離測試驗舊版／重送，但未模擬真正同時兩個遠端請求；不宣稱已完成真併發驗收。 |
| 4 | 符合規格 | purchase-admin.ts:51–90同一db.batch儲存，receipt及末尾guard強制失敗回滾；隔離測試驗無效收藏與晚期注入失敗均無半套訂單。SQLite adapter顯式BEGIN/ROLLBACK；正式未進行寫入測試。 |
| 5 | 符合規格 | 查得公開public-site-data／public-game-collection／public-live-relations採白名單，無採購表公開輸出；公開DTO不傳價格／訂單／私人備註。purchase-admin.test.ts公開投影私密哨兵測試通過。這是已檢查程式與樣本證據，不是所有未來欄位或既有靜態資料的普遍保證。 |

## 是否需要重開規格

發現兩項跨既定範圍的衝突，不能回報「無衝突直接進R11」：

1. **舊收藏編輯是另一條採購寫入路徑。** collection-v2-management.ts:275–279可更新managed_order_id的單明細採購、幣別、價格與分攤，僅檢查其管理圖形；不使用R10的admin_managed／admin_revision或取消唯讀規則。這種訂單在R10通常是歷史／副本引用而唯讀，但R04仍可改。R10「鎖定全後端強制／非零幣別不可改／一致成本」若跨所有入口適用，須決定舊R04採購欄位是否仍保留編輯責任。本報告不建議修改方案，待釐清責任。
2. **說明選填涉及DB約束；未指定明細涉及分攤圖形。** 不只是前後端改驗證：DB description CHECK拒絕空值，現行編輯器鎖定要求每列恰一分攤，allocations又不能無目標。需明確第一版是否包含對應Schema／圖形契約變更；不能用虛構說明、虛構收藏或假分攤冒充符合。本報告不提出修改方案。

取消唯讀、direct顯式轉換、幣別精度等其餘現況不符是已定新功能落差，不等於需要重談已定稿政策。正式目前空採購庫，沒有既有採購資料迫使改政策。

## R11 可直接交給討論者的現況（非新規格）

路由/admin/bgg，三分頁：BGG快取、遊戲關聯（?view=relations&domain=game）、收藏組合（domain=collection）。來源index.astro、RelationForm.astro、bgg-sync-admin.ts、relation-admin.ts。

- 快取：ID或名稱搜尋、同步狀態、最後成功／嘗試時間、錯誤碼；指定ID／勾選／單筆重試。每批最多3、並行1、間隔至少2秒、每筆最多2次嘗試。失敗保留最後成功快取，不改個人收藏，不推估靜態JSON時間。可展開原始expansions/implementations/compilations證據與inbound方向，不自行推定。
- 遊戲關聯是遊戲身份層，不等於擁有；來源目標選已登記BGG／NotBGG身份。類型requires_base、expansion_of、standalone_related、same_series、integrates_with、compilation_of、accessory_for、other。手動確認checkbox控制公開資格，備註私人3000字。只有manual來源可手動編輯封存，不覆寫BGG原始證據。
- 收藏組合是收藏紀錄間關係，不合併收藏／副本，不自動建採購、組件；類型類似但用bundle_contains取代compilation_of。端點須相同production/test範圍且未封存。
- 拒絕自己連自己、重複與不合格方向，依賴關係需確認類型方向；相關／同系列／整合可循環。後端實際循環規則與所有方向例外若影響設計須再核對。
- 現在來源目標為select帶內部ID與名稱，列表偏內部ID／英文代碼；來源或目標ID篩選、游標分頁、新增展開、逐列編輯／封存。沒有獨立Promo或重新實作手動類型，不能自行改解讀。
- 已定跨頁：R02顯示所屬組合／篩選、多組合與R11連結，不做完整群組檢視；R11維護組合。其餘R11新布局／流程尚未定稿。

待R10上述衝突釐清後，建議R11從「三分頁的任務與名稱是否清楚、預設入口」開始，接著BGG查詢與同步寫入如何區分，再分開討論遊戲關聯及收藏組合。這只是討論順序，不是批准方案。
