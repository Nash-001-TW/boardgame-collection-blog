# R11 設計決策與核對

2026-11-17。只討論與讀程式，不呼叫外部BGG、不寫正式資料、不實作或部署。

## 議題1 已採納

三平行分頁：BGG資料／遊戲關聯／收藏組合。無參數固定BGG資料；帶參數或返回恢復指定分頁篩選，各分頁不帶入不適用條件。暫不加角標。

固定說明：查看並同步BGG遊戲資料，同步不改個人收藏；遊戲關聯記錄擴充／系列／整合遊玩等身份關係，與擁有無關（不寫版本）；收藏組合記錄收藏紀錄關係，不合併收藏副本。跨頁連結／返回現況、空態與錯誤尚待完整核對。

## 議題2 程式核對

來源src/lib/bgg-sync-admin.ts、bgg-admin-api.ts、bgg-admin-controller.ts。未執行新測試，不能當作同步流程驗收。

- 搜尋只讀D1及既有靜態JSON，不呼叫BGG；因此不能寫只查已同步資料，還有未建立同步時間的靜態資料。
- syncBggBatch拒絕非1～3個或重複ID（400 BGG_BATCH_LIMIT），不截斷、不排隊。DB gate lease全域互斥，一批內串行，筆間／可重試間隔2秒，正常結束冷卻3秒；忙／冷卻409 BGG_SYNC_BUSY。前端目前沒勾選上限，後端有。
- 未登記ID會先INSERT bgg_games Pending／syncing列，即使後續失敗也可能保留；不建立v2_games身份、不建立收藏。不能把新快取列叫正式遊戲身份登記。
- 同步寫bgg_games及v2_bgg_sync_gate／v2_bgg_sync_commands；關聯證據在cache_json，不寫v2_game_relations／bgg_game_relations等關聯表。
- 每筆最多兩次；自動再試一次限TIMEOUT、FETCH_FAILED、HTTP202/429/500/502/503/504。其他HTTP、XML_INVALID、RESPONSE_TOO_LARGE不在當次自動重試清單。AUTH_UNAVAILABLE需伺服器配置，非盲目重試。
- syncing／last_attempt_at在每筆開始時持久化；成功才更新last_success_at並清last_error_code；失敗保留cache與last_success並寫新錯誤。開始重試未清前次錯誤，UI不應把它誤當本次最終結果。
- lease120秒；中斷可能留下syncing，讀取在lease過期後投影failed／BGG_INTERRUPTED，不一定改寫底層。批次不是全有全無，前筆成功可保留，未輪到ID未必有新嘗試時間。完成後才寫整批冪等結果，半途中斷重送不能假稱不再抓已成功ID。
- API整批結果返回，沒有即時進度串流。現有前端忙時停用所有button（含非寫入），完成重載，非真正逐筆即時進度。
- CURRENT_TIMESTAMP儲存UTC，UI需明確解析UTC轉Asia/Taipei，不能依瀏覽器預設。靜態無時間unknown不等於無資料。

## 議題2 本輪建議（待使用者確認）

查看／同步用詞與動作區分開，搜尋展證據非外部寫入；文案「搜尋只查本站現有資料，不會連線BGG」。批次勾選上限3與已選N/3，空選禁同步並說明，超限輸入不截斷。指定新ID同步的新增快取效果另明示，是否拆入口留下一輪討論。

狀態與資料可用性分開：同步狀態未知不直接叫未同步；成功／嘗試時間台北顯示。失敗有舊成功資料才說保留，沒有則說尚無成功同步資料，靜態替代另標。白話錯誤＋原碼詳情；可重試與需處理配置／輸入分開。

進行中停同步寫入不阻止唯讀查看，跨分頁由後端gate拒絕；即時逐筆進度需新增查詢／輪詢能力，不能把整批送出稱已有精準進度。結果摘要顯成功／失敗／未完成或未嘗試，不將中斷當全部失敗。原始區標「BGG原始關聯證據（唯讀）」，是解析後證據，不宣稱完整原始XML。新增測試需涵蓋以上限制與中斷、重送、首次失敗、靜態unknown、UTC轉台北及新ID不建身份。

## 議題2接續：使用者採納與新建議邊界

已採納搜尋本站現有資料、不連BGG；撤回逐列即時進度，不新增輪詢，改批次忙碌與完成摘要。使用者提出五狀態與新增ID獨立入口，Codex同意方向，但細節仍待確認：狀態未知保守稱尚無可確認同步紀錄，只有具可靠依據才叫未曾同步；busy包含正常冷卻，不能一律說另一任務進行；網路斷線未取得批次結果時顯未能確認結果，不宣稱精確完成數，保留輸入並提供重新查詢，不自動重送。

新ID入口建議名「新增BGG資料並同步」，說明不建身份／收藏，首次失敗可留列、第一版不可移除；已存在（含靜態可見資料）逐ID辨別同步，不把混合批次全算新增。存在判定是提示，後端upsert處理競爭，不提供另一步只建空列API。

補查：v2_games由0012 migration、collection-v2-management.ts新增收藏BGG分支、NotBGG建立及身份對應確認建立（notbgg-repository.ts、notbgg-link-repository.ts），不由BGG同步建立。R03目前BGG搜尋／新增參照getGames靜態清單，不直接讀bgg_games新列；關聯選單讀v2_games。因此僅同步新ID，甚至成功，也不保證能新增收藏或選來建關聯，留作下一題身份入口責任待決，不自行擴大實作。

靜態更新腳本update-bgg-cache.ts從localGames與bgg-collection-cache蒐集ID，不從遠端bgg_games取空列；未找到管理UI/API刪除或隱藏bgg_games入口（狀態篩選不是刪除）。中斷lease到期前讀為syncing，到期後讀取投影BGG_INTERRUPTED。

錯誤對應清單待實作與測試：批次BGG_AUTH_UNAVAILABLE/BGG_BATCH_LIMIT/INVALID_BGG_ID/INVALID_IDEMPOTENCY_KEY/IDEMPOTENCY_CONFLICT/BGG_SYNC_BUSY/INVALID_BGG_QUERY/BGG_SERVICE_UNAVAILABLE，外層UNAUTHENTICATED/FORBIDDEN/DATABASE_UNAVAILABLE/ORIGIN_REJECTED及寫入限速／JSON錯誤；單筆BGG_TIMEOUT/BGG_FETCH_FAILED/BGG_XML_INVALID/BGG_RESPONSE_TOO_LARGE/BGG_HTTP_<status>，讀取投影BGG_INTERRUPTED。HTTP不是有限固定枚舉，未知碼用保守白話fallback，不顯完整上游內容。BGG_EMPTY_RESPONSE在fetch層會被歸成BGG_FETCH_FAILED。自動重試與手動允許再嘗試須分開標示。

## 議題3 程式核對及待確認建議

議題2上一輪修正使用者已採納。議題3新建議尚待確認：名稱優先關係句、來源與公開資格分欄、證據獨立唯讀、新增manual預設未確認、撤確認需影響提示、未確認篩選。不能將admin_confirmed直接叫已公開。

- v2_game_relations來源枚舉bgg/manual/import（0007），R11寫manual，現行同步不寫這張關聯表；非manual在R11唯讀。另有site_game_relations手動資料，來自NotBGG配件管理，不在現R11 v2列表中；公開查詢會合併它。
- 對稱類型是standalone_related、same_series、integrates_with；standalone_related句型宜「A與B為獨立遊戲相關關係」，不宣稱方向。compilation_of來源須bundle，語意合輯A包含B；requires_base擴充A需要主遊戲B、expansion_of擴充A屬B、accessory_for配件A適用B。other只有關聯，不將私人備註當公開說明。
- public-live-relations.ts即時查D1，未封存bgg來源可用，manual還須admin_confirmed=1，import不在此查詢；site表未封存manual直接合併；BGG靜態／成功快取證據獨立產生公開關係。尚有端點／公開資格與路由條件，因此確認不是保證一定可見。撤manual確認只排除該筆manual，不保證同對象BGG或site關係下架。
- 封存無還原action，save也要求archived_at IS NULL；第一版不可宣稱能恢復。現有UNIQUE涵蓋封存歷史，亦不能承諾同端點同類型可重新建立替代還原。
- 證據為expansions/implementations/compilations陣列，id/name/inbound可缺；反向可由別遊戲指回本遊戲取得，不把每筆當已驗方向。實際缺身份筆數本輪未查，不提供估值。
- readRelationAdmin回v2關聯列及另份identity清單，可映射名稱；端點封存／缺失時須保留名稱可得值與ID fallback，不能將列藏起。現來源ID篩選兩端皆比對，不等於只篩來源。
- 證據狀態不能只三選一：身份缺失與是否有紀錄是兩維，還有未確認／已封存／不同類型方向及site既有關係；不能以同一對遊戲有任一列就叫已建立相同關係。建議先顯身份是否可選，再列現有關聯含來源／類型／狀態，不自動判語意等價。
- 依證據建立只預填兩款身份，使用者明選方向與類型，預覽關係句；無身份僅提示。新同步資料如何建身份仍待決。查詢失敗不當作尚無關聯。此輪未變更功能或呼叫BGG。

## 議題4核對與建議（待使用者確認）

2026-11-17正式唯讀聚合：v2_games總數225，v2_game_relations各來源查詢無列（總0，import0）；寫入0。225是全身份量，不等於可選／公開量。名稱現為primary_name及NotBGG seq，無中英文雙語名稱搜尋API，不能宣稱已有。

- 表單列表內展開、角色標籤／預覽、名稱搜尋方向同意；互動行為與收藏選擇共用但身份資料來源另設。欄位3000字計數，other不公開私人備註。
- relation-admin.ts對三個對稱類型做有效manual A-B/B-A重複檢查；DB UNIQUE(source,target,type,source)有序且含封存，不保障反向重複，也使原方向封存後不能重建。site重複檢查只查相同方向有效列，反向與跨入口一致性尚不完整。
- 建議第一版改為提供manual關聯恢復而非放寬歷史唯一約束；恢復回未確認，重新驗端點、重複／方向／循環與版本，不直接恢復公開。非manual維持唯讀。這會取代先前第一版無還原限制，待使用者確認，不先實作。
- 更新目前可改端點類型備註與confirmed，WHERE admin_revision比對增版；沒有核心變更自動撤確認。新規格須前後端一起強制核心變更後confirmed=0，不能同次送true跳過；下次明確重新確認。只備註不撤確認。
- 循環由0022 DB recursive trigger擋直接／間接：requires_base/expansion_of合併一圖、compilation_of與accessory_for各自同類型圖；不跨這些不同群混查。所有未封存列包括未確認／非manual參與。其餘對稱及other不擋循環。現回統一RELATION_STATE_CHANGED，未帶衝突路徑；多跳循環需回有界路徑而非只一筆，未知／查詢失敗不可假稱無循環。
- 遊戲身份無production/test屬性；新選項排封存NotBGG且有bgg_id或NotBGG seq，對已確認別名雙身份會拒絕互連。收藏domain才要求兩端同scope；不能把收藏範圍套遊戲身份。
- public-live-relations.ts以href+kind+source去重，v2 manual與site manual同對象同類型會合一；方向未納key可能掩蓋方向衝突，確認／管理入口仍互相獨立。不同kind/source仍可多列，不能聲稱跨入口不重複／不矛盾。保存雙方來源管理資訊待結構議題。
- 已採納議題3全部修正。新驗收需包含封存死路補救、恢復後撤確認及失效端點／併發、核心變更不可偽造保確認、對稱反向重複、跨表配件衝突、多跳循環路徑、225不全視為可選、名稱缺失fallback。此輪未修改功能或Migration。

## 議題4收斂與跨表方案建議（本輪待確認）

使用者已採還原與核心變更同存不得保持確認。還原細節同意：manual限定、封存預設隱藏可切、封存唯讀、還原需驗證且回未確認、無額外確認但完成提示；失效端點／循環錯誤帶對象。新增可直接勾確認但預設不勾；僅對「既有紀錄核心變更」要求先存再確認。若改回原核心值是否仍需撤確認，以最終值對已存值比較，避免僅操作過欄位就永久禁用。

建議納第一版DB對稱配對防護，針對三個對稱類型的有效manual紀錄正規化端點，保留原有歷史唯一約束與其他來源獨立性；若還原撞反向有效列須拒絕並連衝突列。需隔離遷移與真正併發測試，現未證明現行可被同時請求繞過，不能只憑理論宣稱漏洞。

搜尋選項端點採有界一次載入／本地過濾方向，不因目前225永久無上限；若超限須明示並轉查詢方案，不能截斷假裝完整。中英文名稱僅用可靠既有來源，不生成翻譯或假定每身份都有雙語名；端點資格後端提交再驗，無權或私人欄位不回。

跨表選修正版B：兩表並存，R11顯NotBGG配件唯讀並連原管理入口；完全相同有效manual關係（同方向／同類型／同一實際端點）阻擋新增並連既有列，不退回只有警告（目前R11已有單方向跨表阻擋）。同對象不同類型／方向顯警告，是否允許仍需通過角色與循環；兩邊API一致，不只R11單側防護。整表遷移後續。

公開去重需納關係方向／角色及穩定身份，對稱類型正規化，不直接加入row id或管理表名導致相同語意重複。目前public DTO缺方向／端點資訊，需同步調整查詢投影與前端句型，不能只改Set key就聲稱衝突可見；來源管理入口可保留多值，但私人備註不公開。

補查2026-11-17正式唯讀：site_game_relations總0、有效0、accessory_for0；v2_game_relations accessory_for0，寫入0。管理頁/admin/notbgg/[id]/relations，NotBGG編輯也有relatedGameIds寫入來源，須納同一管理邊界。site表來源NotBGG配件→目標遊戲有方向，compatible_with也是配件適用方向，不能自動當遊戲同系列對稱。還原同列未改唯一key不自撞，但可能撞有效反向或跨表關係，不能省驗證。此次未實作、未遷移、未測新功能。

## 議題5 收藏組合定位（本輪建議待確認）

使用者採納議題4全部補強。收藏組合主bundle_contains、其他類型保留次要，無使用者習慣證據不宣稱已知實際用法。遊戲事實記遊戲關聯，收藏紀錄實際配置記收藏組合，不複製身份層事實；固定說明不合併／不建副本組件採購。

組合分組與成員、其他類型關係句；單收藏篩兩端並標作為組合／所屬組合，R02只呈標記篩選與連結，不做群組檢視。N定為有效直接成員數，非遞迴成員或當頁數；完整群組需按組合分頁／獨立展開查詢，不可目前21條edge切頁後假裝完整群組。收藏封存是獨立標記不是替代owned等狀態。

核對：0007的v2_collection_relations八類、有序UNIQUE含封存、私人notes；0022加admin_revision/archived_at，沒有relation_source或admin_confirmed，不涉及公開確認。應用層三對稱反向去重，版控編輯封存；無還原且同方向封存重建被UNIQUE擋，需比照補恢復，但收藏恢復只有有效關係、不加確認公開步驟。

方向／循環：bundle_contains來源item_type須bundle，不能任意把一般收藏當容器；來源→直接成員，禁止自連與間接循環；requires_base/expansion_of共圖、bundle/accessory各同類圖。組合收藏如何合法建立尚待核對／討論，不以分組UI假定已有入口。同scope指兩端record_scope相同production/test，需白話正式資料／測試資料，UI先篩且API重驗。

readRelationAdmin已用source參數比對source/target兩端；查全部關係但選項僅未封存收藏，無端點狀態完整輸出。R02目前未呈所屬組合，僅R04已有連結；不能當R02標記已實作。建議R02預設只將有效關係且兩端未封存者列目前組合，含封存歷史另標不刪，確切歷史展示待確認。

正式唯讀v2_collection_relations總0、各類分布無列、寫入0。src/scripts搜尋未發現收藏關聯影響公開查詢、R06組件或R09需求的讀取，目前只relation-admin管理讀寫；不得藉組合關係自動複製卡套需求或成本。新增測試：群組跨頁完整、直接數不重複遞迴、不跨scope、封存端點歷史可見且不可新選、restore無公開確認、嵌套循環、R02標記不串成完整群組；未執行新測試。

## 議題6 收藏組合表單（建議待確認）

議題5四項補充已採，R02所屬標記實作屬R02範圍，R11只負責可達的兩端篩選。入口建議A：R03建立bundle，R11不建／轉收藏，無可選容器連R03。R03新建bundle的身份選擇／是否獨立容器尚需明確設計，不因新增類型欄默認可建無身份收藏或更改遊戲身份類型。

正式唯讀核對bundle共36（production36、test0），含封存未另分，不能宣稱36皆可選。0012遷移保留legacy bundle；現在R03由BGG型別映射base/expansion/accessory或NotBGG映射，沒有bundle新增選項，R04無item_type變更入口。只有bundle_contains要求source bundle，其他類型依各自角色，不全要求bundle。

同意展開表單、bundle預設、角色預覽、端點scope與封存排除、私人備註3000、核心編輯完整驗證與封存／恢復。先改端點若造成scope不合，清楚提示重新選擇，不靜默把另一端換成別筆。成員可含bundle但需防嵌套循環，不自動展開或繼承需求。

第一版建議一次一成員；成功可保留容器／scope並清成員，快速連加，不做批次API。批次可用db.batch但需驗批內互相影響及全體失敗定位，不當成免費前端功能，留後續。

列表按容器分頁、成員獨立完整查詢／明確分頁且總數完整，不把截斷當完整。N是有效關係且成員未封存直接數；有效關係但成員封存另列N項收藏已封存；關係本身封存另分歷史，不混同。容器封存整組標記歷史、不當目前組合。當前API按edge分頁，需新增聚合查詢但不必新增資料表。

R04現連結?view=relations&domain=collection&source=<id>&lang=，source是兩端篩選，不能自動當container；表單角色預填須另參數並驗bundle資格。record_scope現R03/R04可切，R11 options目前同時返回兩scope，UI須白話分隔選擇但後端仍同scope驗證。

統計目前按收藏列／副本列計數，不依關聯去重；容器與成員各是紀錄，會各計收藏項目，不是關聯JOIN造成重複。不能把收藏項目數宣稱實體盒數；副本仍按各自資料，不自動創容器副本或刪成員副本。

還原同列不自撞原唯一key，但端點／反向重複／循環／scope／版本仍重驗；不涉及公開確認。新驗收：36歷史bundle可讀、不可自轉一般收藏、R03新增bundle不建採購、source兩端篩選不誤預填、連續單筆增無重複、有效／成員封存／關係封存分開計、整組封存、分頁群組完整、正常個別統計不因關聯增減。未改功能／Migration。

## R03組合身份：補查與最新建議（待使用者確認）

2026-11-17正式唯讀36 bundle身份分布：BGG5、game_id NULL31，無NotBGG組合樣本。0007的collection.game_id原已nullable，不須為可空本身改Schema；API目前必選身份，仍需修改建立契約與顯示／搜尋／公開資格驗證。不能將「已有nullable」當前後端已支援。

NotBGG現有type只有boardgame/boardgameexpansion/boardgameaccessory，沒有bundle類型；notbgg-public.ts明定未封存原稿可公開，無草稿／private開關可因組合類型預設不公開。故使用者A建議依賴不存在的類型與公開控制，不能強迫自訂容器建假遊戲。

Codex最新建議C（不是已批准）：R03明選組合包後可連既有真實BGG/NotBGG身份，或獨立容器無game_id以收藏名識別；只改collection.item_type為bundle，不把所連遊戲game_type改bundle、不補造身份。保留既有5+31，不自動轉換。獨立容器顯「獨立組合」而非缺少來源異常；預設不建副本，不自動創組件需求，不能一律禁止真實產品組合有實體資料。

計數一筆收藏紀錄（非盒數）；有身份沿用公開資格、不因bundle自動公開／隱藏。獨立容器建議僅管理用途、不新建公開身份入口；現有公開列表如何處理無身份組合仍須驗證，不擅改歷史公開資料。角色純容器可沿用已確認不需清點語意，不能泛化所有bundle都無卡牌／無清點。

交接第六節五項Codex方向本輪明確同意：R03建入口且R11只管關係、一次一成員、有效／成員封存／關係封存分計、容器分頁成員另取、收藏還原無公開確認。身份C及其邊界仍待使用者採納。使用者最新進度表記為其狀態陳述，R01～R07完整20項與六項仍未取得，不能宣稱已自行逐項審查。
