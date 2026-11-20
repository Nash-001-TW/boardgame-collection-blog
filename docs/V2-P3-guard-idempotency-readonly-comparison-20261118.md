# P3：V1／V2／混合守衛與冪等責任唯讀比較

2026-11-18（Asia/Taipei）。承接使用者要求進入P3唯讀可行性比較。只讀本機程式／SQL及官方文件；沒有原型、SQL設計檔、測試執行、DB查詢、秘密讀取、Migration或部署。本輪只新增報告及同步進度／交接。

標記：ADOPTED_RULE＝使用者已採納；CODE_CONFIRMED＝原始碼直接支持；INFERRED＝基於證據的未實測設計推論；UNKNOWN＝缺證據。行號為目前工作區。

## 0. 決策定位與新基準

P1、TC23、P2適用性S1～S7及日期語意已收斂。日期預設台北今天、可填過去不可未來；成功清點必須同存actual／checked／日期／歷史。日期缺失不改M、不增U，不猜日期、不宣告有完整完成依據；未發現正式既有清點資料，異常修復另案。日期更正仍走成功確認事件，不新增日期專用入口。

C1（簽發請求憑證）、C2（不可變預宣告）是已保留的**請求冪等綁定與過期辨識候選**，不是V1／V2之外的另一種資料一致性守衛；也不是已決定保存完整判定集合。只保存摘要時，仍需另有可信輸入讓守衛實際比較。
V1／V2處理資料輸入在讀取與提交間是否改變；G處理事件排序／碰撞。三者責任不同。不能因V1／V2有效就省略冪等，也不能因憑證簽章有效就當目前資料未變。

## 1. 現有證據索引

| CODE_CONFIRMED事實 | path:line |
| --- | --- |
| 全域證據投影、完整性與上限；六張分類表 | src/lib/component-classifier-adapter.ts:23、37、57、73、82 |
| HMAC在JS，key不可用可能混為資格無效 | 同檔:113、162、167；src/lib/component-classifier.ts:225 |
| 讀取實體驗證後SQL pin來源／revision與全域數量 | src/lib/physical-component-management.ts:123、132 |
| count同語句比對逐組件revision並upsert | 同檔:151 |
| 定義編輯只推physical_revision，不推收藏revision | 同檔:138 |
| 實體source immutable、definition身份受保護、候選map排除 | migrations/0017_physical_components.sql:34、40、60 |
| 舊proof保留重複root key、競爭notes跨definition | src/lib/component-classifier.ts:95、182、252 |
| 收藏revision gate可由DB trigger中止交易 | migrations/0015_notbgg_collection.sql:71 |
| R11零列→NULL command.result_id→NOT NULL失敗、catch查重播 | src/lib/relation-admin.ts:31、61、62 |
| R03新收藏／可選副本同batch、fingerprint與request_key重播 | src/lib/collection-v2-management.ts:203、207、217、221、231 |
| R04補建副本，無成功command重播 | 同檔:264、273、289；src/lib/collection-admin-api.ts:49 |
| R05副本建立command＋event gate同batch | src/lib/collection-copies.ts:40、48、63、74、78、82 |
| 副本command不可改刪，但不是預宣告 | migrations/0019_collection_copy_commands.sql:2、10 |

## 2. V1／V2／混合比較

| 面向 | V1世代守衛 | V2實際輸入完整比對 | 混合（候選） |
| --- | --- | --- | --- |
| 核心 | 全部相關變動推進可驗證世代，提交比對讀取世代 | 將曾驗證的輸入與當前DB輸入逐集合／欄位比對 | 資格證據世代＋收藏局部集合／清點／範圍精確比對等 |
| 現成能力 | 無完整世代；有收藏gate範例 | 有局部count／來源guard、R11零列守衛；無完整整盒比對 | immutable來源、逐組件revision可重用，但新整合未實作 |
| 寫入者要求 | 可用DB trigger涵蓋一般INSERT／UPDATE／DELETE，不必只信服務程式手動遞增；表與欄位覆蓋仍須完整 | 比對輸入本身，不要求每個外部普通DML寫入者推版本；必須覆蓋完整投影 | 哪類靠trigger、哪類靠值與集合，須有無缺口分工 |
| 跨定義proof | 所有相關notes／map變動推世代即可保護已做過的JS判定 | 比對完整分類輸入投影，包括原始notes；不必在SQL重寫JS proof parser | 可避免每次傳完整全域notes，但引入trigger遷移及無關衝突 |
| HMAC | JS驗證後pin世代與immutable source；驗證環境另管 | JS驗證後比對同一來源／上下文，確保DB證據未換；SQL不重算HMAC | immutable source＋精確pin；key／規則不靠DB世代解決 |
| 集合新增／移除 | 所有相關表insert/delete也推世代 | 比較雙向差異及必要的列數／唯一性，不只既有ID | 局部集合比對或局部世代仍待選 |
| 偽衝突 | 粗全域世代可能被無關變更打斷 | 完整全域輸入比對也可能因無關資料不同拒絕；精準裁剪須證明足夠 | 可降低或仍保留，不能先保證更少 |
| 主要成本 | 新表／trigger／初始化與維護契約、世代作用域 | 內部資料量、比較CPU、NULL／型別／重複語意、整批守衛複雜度 | 同時承擔兩種機制與覆蓋證明，不能先稱最小 |
| 結論標記 | INFERRED可評估；UNKNOWN完整覆蓋及效能 | INFERRED有官方SQL能力支持；UNKNOWN端到端效能與原子守衛 | INFERRED值得比較，未選定 |

### V1：閉包如何成立，不等於已成立

CODE_CONFIRMED：現有收藏gate及實體immutable trigger證明專案已使用DB trigger；沒有通用資格世代。
INFERRED：DB trigger可讓同一DB的一般DML（含由外部SQL執行）原子推世代，避免只在R03／R04／R05呼叫時手動記版本。須覆蓋六張分類表實際投影欄位，另涵蓋副本／清點／範圍／新適用表與新需求欄位，或拆分各作用域。
UNKNOWN：DROP／重建資料表、移除trigger、備份還原、遷移及部署切換需另有受控維護／重新基準契約；不能宣稱trigger能涵蓋所有DDL或資料庫替換。

世代讀取也須與輸入同快照，或採可證明穩定的讀取協定；先讀資料、稍後只讀較新世代，會把舊資料誤綁新世代。世代必須連同實際寫入及結果關聯在同交易檢查。世代相同不代表key可用、規則程式相同或證據未超限，這些仍須獨立驗證。

### V2：完整比對路線不必重寫分類器

INFERRED候選步驟（非可執行SQL／非已批准架構）：
1. 可信後端取得分類器真正使用的完整輸入投影及局部副本／清點／適用／範圍資料；完成JS分類與HMAC，產生候選結果。各次讀取的共同一致性仍須證明；不以R06畫面四次並行查詢冒充快照。
2. 以可信內部的輸入投影進行DB當前值比較。可以保留原始notes字串比對，避免把重複key proof語意改寫成json_extract。不是把瀏覽器送的集合當可信快照。
3. 同一提交batch先檢查前置狀態，守衛不成立就讓批次失敗；再施加本次操作，按最終狀態保存必要結果。自身新增定義／副本／例外是授權delta，不能被自己的新增誤判為外部競爭；也不能把guard移到獨立API造成檢查與寫入空窗。
4. count兩個並行操作不能僅比對各自那一列；均須保護其整盒判定依據。guard通過仍不等於提交成功。

SQLite雙向EXCEPT可作集合差異候選，但會去重；不能用它掩蓋多重列、JOIN放大、來源歧義。須在投影保留適當唯一識別與型別，對需要的多重性／列數另有驗證。NULL相等、整數／文字、raw JSON格式及空列／缺列均要明確。

官方D1支援json_each與綁定JSON陣列，因此可評估以少量結構化參數比較多列，不受「一個ID一個placeholder」的100項假上限。此僅降低參數數，不消除輸入大小、DBCPU、查詢／回應限制；未測量效能，不選產品容量上限。

## 3. 按業務操作界定集合範圍

不是所有單副本清點都必須鎖整個收藏所有副本；須按操作影響範圍定義。這是候選設計，不變更S6／S7。

| 操作 | 須保護的局部全集／最終結果 | 額外依賴 |
| --- | --- | --- |
| 單副本count | 本副本全部候選定義、有效適用關係、相關清點值、最後判定、範圍／需求／日期 | 必要全域分類證據及規則／驗證上下文；不僅本次count_revision |
| 修改已存在的單副本適用性 | 本副本集合、該定義實體資格、變更前適用關係、最終適用判定及歷史 | 範圍外凍結最後判定但關係可改；不能排UNKNOWN |
| S6新增定義＋初始例外 | 收藏現有副本全集、例外目標、最終適用關係、範圍內受影響副本判定 | 拒絕過期副本集合；初始例外不偽造中間已適用歷史 |
| S7新增副本＋初始例外 | 本收藏定義全集及實體資格、例外、首次判定、收藏建立上下文 | R03／R04／R05均遵守；新副本無他盒清點值，範圍外尚未判定 |
| 收藏需求切換／解除封存（未實作入口） | 整體範圍、相關副本全集、重返副本的最終判定 | 退出不重算、不寫轉換；多副本整筆失敗不能分批 |

INFERRED：未完成→未完成、完成→完成及範圍外變動不一定有轉換事件，G不會自然捕捉它們；不能只用最後事件ID當完整輸入版本。

## 4. 冪等與事件結果統一責任

| 路徑 | CODE_CONFIRMED現況 | 新契約缺口 |
| --- | --- | --- |
| R03 | request_key＋內容fingerprint，同batch建收藏／副本，重播collectionId；management.ts:207、231 | 無新過期辨識、精確事件關聯與原結果摘要；新增副本例外未支援 |
| R04 | expectedRevision與DB event gate，batch；management.ts:264、289 | 無成功請求識別重播；不能只看前端送header就宣稱可辨識 |
| R05 | command綁actor／scope／collection／key，內容hash含revision；copies.ts:48、78 | 只copyId重播、無新期限／事件關聯；初始例外未支援 |
| count | 同一SQL count_revision守衛；physical-management.ts:151 | 沒有成功結果command重播；無新歷史／完整整盒guard |
| 實體create（S6前身） | creation token由actor／key衍生、digest內容比對，source與定義同batch；physical-management.ts:63、82 | 非C1請求憑證，不可把來源proof簽章當請求到期機制；無S6副本例外與整盒結果 |

共同候選責任順序：認證與請求綁定→辨識是否為期限內已成功純重播→新執行才驗證分類／集合→提交內guard、業務與事件及結果關聯→最終結果或未知。不得因純重播跳過認證／內容／目標／期限。

持久結果應指向確切副本／收藏ID、清點或適用歷史事件、可選完成事件及明確無轉換。回應只組裝已保存資料；未發生轉換不能查現況補原N／M／U或確認時間。失去事件時間不是新確認時間。

C1與C2仍須選擇一種可滿足「回滾後同鍵不能改內容、過期舊鍵不當新請求」的方式。既有成功command-only不能自行滿足兩條。C2宣告若先提交，是請求控制資料；失敗全不變指業務結果，不應說連宣告都必須消失。C1不可用來源金鑰直接混用；簽發、絕對到期、在途與清理仍待驗證。

同鍵並行唯一結果競爭敗者的batch必須整筆回滾，再辨識贏家。失敗後查不到結果不證明原請求回滾；不自動換key／版本重送。新key同內容僅在使用者明確新確認時執行。

## 5. 失敗風險與最小隔離驗證需求（計畫，未執行）

| ID | 候選／案例 | 必須觀察到的結果 |
| --- | --- | --- |
| G-01 | V2讀後新增／刪除／等量替換定義或map；其他definition notes競爭claim | 舊依據拒絕，無清點／適用／完成／成功結果部分提交 |
| G-02 | V1每張受保護表的insert/update/delete，包括維護式DML | 相應世代原子推進；失敗回滾連世代一併回滾；未覆蓋行為明確列出 |
| G-03 | 兩個不同組件同時count、其中最後一個讓整盒完成 | 無遺失完成、無雙重達成；衝突失敗不自動換版本 |
| G-04 | S6與新增副本競爭；S7與新增定義競爭；例外同時改 | 集合過期拒絕；最終適用與歷史一致，沒有使用者無意中間轉換 |
| G-05 | 零列guard、唯一約束競爭、事件寫入失敗 | 整個業務batch回滾；不因UPDATE零列直接默認成功 |
| G-06 | key缺失／HMAC拋例外／確定不符／可信結構否定／超限 | 分清不可用與UNKNOWN；不可用不虛構U／失去事件；純成功重播不重判 |
| G-07 | 同key同內容並行、不同內容、明確回滾後改內容、逾期及未知重試 | 最多一次成功，內容綁定與期限有效，原結果只組裝已保存紀錄 |
| G-08 | JSON集合>100成員、NULL／型別／重複列／缺列、raw proof重複key | 不是依placeholder容量誤拒；無資料歧義被去重吞掉；比較與分類語意一致 |
| G-09 | 多副本原子操作容量與逾時／提交回應丟失 | 量測可支援範圍，不自行分批；結果未知不誤宣告回滾 |
| G-10 | 範圍退出／重返、適用恢復、尚未判定、日期更正 | 不產生錯誤中間／範圍外事件，舊清點日期不被操作日覆蓋 |

UNKNOWN：本機SQLite行為不等於D1部署環境驗證；隔離測試是否用本機D1相容執行器或遠端隔離庫，另列授權範圍。此報告不新增測試檔、不執行任何案例。

## 6. 建議與目前可裁決的範圍

INFERRED建議：**先以V2「可信輸入投影完整比對」作第一個隔離驗證對象**，保留V1／混合作比較。理由是可先沿用現有JS分類／HMAC，而不是重寫分類器；官方有結構化集合查詢能力，且不用先假設所有舊證據已具世代。這是推薦驗證順序，不是採納V2上線。

若完整投影比較過大或過於頻繁衝突，再評估以DB trigger維護「資格世代」＋局部實際集合／清點比對；不先把全域世代排除，也不無證據稱混合一定更快。兩者都需原子前置guard與同批成功結果關聯。

接下來只需審查上述驗證計畫是否覆蓋既定語意，並選定第一個待驗證候選；不必請使用者逐欄裁決SQL技巧。完整原型／隔離測試需要另行明確授權，正式寫入與部署不包含在內。C1／C2冪等機制仍須後續選定，不能以V2取代。

## 官方來源（本輪查閱）

- Cloudflare D1 Database API：https://developers.cloudflare.com/d1/worker-api/d1-database/ ，batch失敗回滾序列。
- Cloudflare D1 Limits：https://developers.cloudflare.com/d1/platform/limits/ ，100參數／100KB每語句、查詢時間限制；batch對Worker查詢數只算一次。
- Cloudflare D1 Query JSON：https://developers.cloudflare.com/d1/sql-api/query-json/ ，支援json_each及將JSON陣列作綁定參數。
- Cloudflare D1 SQL statements：https://developers.cloudflare.com/d1/sql-api/sql-statements/ ，支援的SQL／PRAGMA（包括trigger相關設定）；不代替本案端到端驗證。
- SQLite SELECT：https://www.sqlite.org/lang_select.html ，雙向差異可評估EXCEPT，但EXCEPT移除重複且有NULL／型別語意。
- SQLite Transactions：https://www.sqlite.org/lang_transaction.html ，交易與寫入並行說明；D1需以Binding batch契約為執行邊界，不自行執行BEGIN或跨API假想交易。
