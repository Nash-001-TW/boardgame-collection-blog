# R01～R07 二十項核對與 R06 六項資料盤點

日期：2026-11-17（Asia/Taipei）。此次完成既有程式／Schema核對、正式D1唯讀聚合與66項相關隔離測試。未修改功能／Migration／正式資料，未部署、未重驗登入。符合是指定範圍的既有能力證據，不代表整頁新設計或所有新規則通過。

## 正式唯讀快照

| 項目 | 數量 |
| --- | ---: |
| 收藏 | 256 |
| 組件定義 | 178 |
| 副本 | 0 |
| 組件逐副本清點 | 0 |
| 問題紀錄 | 0 |
| 狀況標籤／標籤歷史 | 0／0 |
| 簽章實體來源／結構候選 | 0／0 |
| USE交易／無套用關聯USE | 0／0 |
| 套用／未對應需求套用 | 0／0 |

178定義皆遷移來源，component_type皆other，quantity_unit分布card2、die1、other170、piece2、sheet2、tile1。單位不證明實體資格。

分類器以1302列完整證據、僅保留分類所需遷移proof欄位進行聚合：LEGACY_PRODUCT149，UNKNOWN29（全LEGACY_TYPE_UNSUPPORTED），PHYSICAL_COMPONENT0。私人legacy_notes在D1內移除、不讀回或保存；無實體來源，不取正式簽章金鑰。原版分類器對遷移proof核對，非名稱猜測。舊來源類型：base31、expansion107、promo11＝149；accessory22、storage4、other2、crowdfunding_reward1＝29未知。不把29筆直接當29個待確認收藏，且它們不代表29筆壞資料。

36個bundle皆未封存、無副本、有歷史組件定義；有身份5、無身份31。此特徵不證明純容器，也不回填不需清點。

## 二十項逐題結果

| ID | 結果 | 位置與證據 |
| --- | --- | --- |
| P01 | 不符 | src/pages/admin/index.astro:36–99只聚合收藏／擁有／願望／預購／來源／組件／需求筆數；無已定異常／待確認或R09缺口統一服務。 |
| P02 | 不符 | collection-v2-management.ts:121–174清單只view/query/source/status/archive/wishlist等，無新異常篩選／異常待確認分離。 |
| P03 | 不符 | CollectionAdmin.astro與collection-admin-controller.ts:145–174仍入口＋表單／技術摘要，無紅灰頁首與分頁角標同步契約。 |
| P04 | 符合規格 | 已核品況來源trade_condition：unknown/new/secondhand_like_new/secondhand_used/secondhand_incomplete/secondhand_damaged；標籤v2_copy_condition_tags：sealed/opened_unplayed/sleeved/missing_parts/moisture_damage。R05分開select／checkbox（copies.astro:76–87），不是同一欄。 |
| P05 | 不符 | 私人自由說明為v2_owned_copies.condition_details（0021），writeCopyCondition上限3000；v2_copy_condition_history只記標籤增減，不含自由說明／trade／inspection完整前後值。不能宣稱有完整狀況歷史。獨立v2_component_issues另有問題notes／狀態時間，不能互當同一資料。 |
| P06 | 不符 | R05仍可手改inspection_status；purchase-admin.ts:133–145直接寫副本。R06 physical-component-management.ts:150–162只寫copy_components，不彙整回副本；舊路徑未撤。 |
| P07 | 無法判定 | 副本condition_checked_at是使用者填日期可空；組件last_checked_at是count儲存CURRENT_TIMESTAMP，僅最新一次覆寫。沒有全部完成時間／重新開啟回合定義。需要重開日期語意，不能直接把兩欄當同一時間或最大值當完成日。 |
| P08 | 不符 | 無明確可重用收藏清點需求欄位／寫入契約，新增持久欄位已由使用者採納，尚未實作；未據此讀私人notes斷言歷史完全無約定。 |
| P09 | 不符 | physical-component-admin-controller.ts用逐form POST、現頁輸入失敗保留、成功整頁reload；無持久草稿／跨form保留保證，儲存一表可能丟其他未存表。count有count_revision防舊寫、actual含0、伺服器時戳，但不彙整副本、不建問題；count未以create冪等重播處理網路結果未知。 |
| P10 | 無法判定 | 六項中1/2/3/4/6正式盤點完成、無紀錄；第5新版計數差異因未實作統一算法且若干語意待決不可算，不假0。 |
| P11 | 無法判定 | 本輪未有375px真機鍵盤工作階段；舊合成viewport圖不能當真機。既有R06無新固定操作列／紅灰角標，不以CSS檢查假稱已驗。 |
| P12 | 不符 | 現有受控實體資格可完整查明，但尚無不需清點欄位／提醒彙整；清點只在藏且seal_status<>'sealed'，包含unknown封膜。借出不寫符合已定，但unknown封膜是否可清點需明定，不能把<>sealed寫成已證明拆封。詳見下節。 |
| P13 | 不符 | 現R06只列physical_creation_token非空定義，其他多由R07看；沒有新未列清點原因總結／去重。分類UNKNOWN與未清點是不同維度，不能直接加成同一角標。 |
| P14 | 符合規格 | component-classifier.ts、adapter使用完整雙向來源／映射與遷移proof或HMAC來源，不憑名稱／型別／數量。三類與全部原因碼見下節；上限10000失敗封閉。 |
| P15 | 不符 | 歸屬確認不是可編pending/confirmed欄：create.confirmed必true，來源表綁definition/collection/scope/actor/digest/signature；不可變。只有使用者勾選無獨立待確認狀態、無既有重簽／認領流程。 |
| P16 | 符合規格 | 正式PHYSICAL_COMPONENT0，故現存「實體分類但不能清點」0；一般邏輯仍可能分類實體但收藏封存、副本借出／封膜、無可用簽章等阻擋。分類能力不等於本次可操作性；不能把這類全標UNKNOWN。 |
| P17 | 符合規格 | result有classification/reason/conflicts[]/evidence/canUseForInventory/canAssignToSleeves；evidence含legacyId/collectionItemId/legacyCollectionId/provenance/legacyProductType，實體另內部signature。R07證據完整性是UI推導字串不是儲存enum，conflicts可空；不能把未回報解讀為不存在。signature不可新增到公開或一般UI。 |
| P18 | 不符 | admin-component-classification.ts:16–25只id升序after游標、50筆，無分類篩選或未知優先。若加新排序需匹配複合cursor，不能現cursor原封套新排序。 |
| P19 | 不符 | R07唯讀，只連R06；R06不能編歷史映射／遷移備註，UNKNOWN29無既有修正／認領工作流。類型不支援不能靠改顯示型別解決，更不能直接把舊商品轉卡牌。 |
| P20 | 無法判定 | 已核實schema／輸出及正式分布，但新摘要篩選展開設計未依真實欄位完成；需使用者確認，不把現8欄表當新設計定稿。 |

P04/14/16/17的符合限查明來源與既有安全規則；其他新UI需求未驗。無法判定分別是未定語意／未具實機／新算法不存在，不以空庫掩蓋。

## 完整資格、分類與證據

1. 分類實體：受控physical_creation_token、對應immutable來源、definition/collection/scope/token一致、HMAC有效、無legacy map／非空notes衝突、完整集合唯一；卡套再要求card＋unit card。只有card字樣不夠。
2. 清點寫入：分類canUse、來源簽章及definition revision重驗、全域證據≤10000、候選收藏未封存、copy屬該收藏、inventory=in_collection、seal<>sealed、count_revision匹配、actual非負整數。未知封膜現會放行；定義expected可null或1～上限、不能0。
3. readonly分類不檢查所有即時操作條件：physical分類可以仍存在於已封存收藏，真正寫入候選會擋；這不是分類失敗。
4. LEGACY_PRODUCT只接受base/expansion/promo且遷移notes、單一正反map、來源唯一、收藏雙向map與型別一致。全部canUse/canAssign=false。
5. UNKNOWN原因：EVIDENCE_UNAVAILABLE、DEFINITION_NOT_UNIQUE、PHYSICAL_SOURCE_INVALID/CONFLICT、LEGACY_MAP_MISSING/AMBIGUOUS/ID_INVALID、MIGRATION_NOTES_MISSING/INVALID/MISMATCH、LEGACY_SOURCE_NOT_UNIQUE、COMPETING_SOURCE_CLAIM、COLLECTION_EVIDENCE_MISSING、COLLECTION_MAP_MISMATCH、LEGACY_TYPE_UNSUPPORTED/MISMATCH。失敗／超限不回部分正面結果。

## R06六項正式資料盤點

| 項 | 結果 | 限制 |
| --- | --- | --- |
| 1. 組件清點狀態 | unchecked0、checked0、needs_review0 | copy_components總0，不把178定義當178未清點實體。 |
| 2. checked數量0 | 0 | 0在API是合法確認量，未來應依預期數量判異常，不等於未清點。 |
| 3. checked數量NULL | 0 | DB允此組合存在，現count API不收null；新彙整不可只看checked就通過。 |
| 4. 副本未完成 | 無副本可分布（總0） | 不顯100%完成，不把沒copy_components當完整。隱含應清點副本×定義還需新算法。 |
| 5. 新舊計數差異 | 無法判定，非0 | 舊角標統計未實作，新未列清點／未知歸屬／日期等未定；不能以29UNKNOWN直接換算29收藏待確認。 |
| 6. 未解問題分布 | open0、in_progress0，所有類型／組件關聯皆0 | 問題表總0；標籤／自由說明不是同表不能假裝已有問題追蹤。 |

## 後加核對結果

- 新副本預設inventory=in_collection、inspection=unchecked、seal=unknown；R03建立副本／R04加managed副本／R05新增皆省略狀態沿DB預設。沒找到將新副本預設為inventory unknown的正常入口。正式副本0，unknown0且無建立時間分布。
- R05讀所有狀態；R06供清點只在藏＋非sealed；R09套用只在藏非sealed，但讀requirements/copies含全狀態；公開copyCount仍全副本、held只在藏不含借出。尚未按已定計數規則統一。
- 歷史手動USE0、全部USE0、套用0／未對應0。沒有正式交易去向可報，不借合成資料當歷史。
- 封存收藏R05可唯讀查看；R09 readSleeveWorkflow排封存收藏，仍無歷史套用專用可達入口，原待決未解。
- R02 LEFT JOIN可回無身份收藏並以display_name搜尋／獨立分組；現標source missing。R04可載入但顯game reference missing，未符合獨立組合正常狀態。新封面摘要與隱BGG連結未做真UI驗收。

## 需要重開的精確議題（不提出修改方案）

1. **R05／R06檢查語意與日期**：副本「已檢查」、組件「已清點」、取得品況、問題解決四者不是同欄，現無彙整／完成時間。需定義空組件、checked-null、部分完成與再次變更如何處理，再計角標。
2. **歷史UNKNOWN修正責任**：29是舊商品類型不支援，不是已證明實體；缺認領／修正入口。需決定只資訊提示還是建立人工證據流程，不能透過R06改type繞過分類器。
3. **「已確認實體但不可操作」與「未列清點」口徑**：封存／借出／封膜／未知封膜／證據不可用各是不同原因。未定其顯示與去重前不能得新版差異；尤其seal unknown目前可寫，不等於確認已拆封。

純容器持久欄位已定為新功能，不重開是否要做；實作應與上述口徑統一。手機真機與新UI實作未完成不是規格衝突，不為本輪假造通過。

## 執行證據

- scripts/r01-r07-preflight-readonly.sql：正式聚合，rows_written合計0。
- scripts/audit-component-classification-readonly.ts：已知遷移私密legacy_notes等在D1內移除後僅proof欄位帶入現分類器；首次保守拒絕非proof額外keys後確認0012結構，再補移除規則重跑，最終1302列、149/29/0，rowsWritten0。未知額外key仍失敗封閉，不取正式HMAC。
- node --import tsx --test tests/component-classifier.test.ts tests/component-classifier-adapter.test.ts tests/admin-component-classification.test.ts tests/physical-component-management.test.ts：66通過、0失敗。涵來源反向競爭、重複notes、證據上限、數量0、revision、回滾、Astro頁面驗證，非新規格驗收。
- 測試出現import.meta轉CJS警告及故意注入test rollback錯誤日誌，皆有測試斷言且最終全通過，未隱藏為正式故障。
- 未啟dev server、未控制正式瀏覽器、未要求認證秘密、未正式寫入。UI實機／真正正式併發本輪未驗。
