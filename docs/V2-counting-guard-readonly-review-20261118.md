# 整盒完成判定守衛：五項唯讀核對結果

日期：2026-11-18（Asia/Taipei）。使用者明確要求推進既定五項唯讀核對。本輪只有本機原始碼／Migration／腳本靜態檢查與官方文件閱讀；未執行程式、測試、Wrangler、DB查詢、Migration、部署或秘密讀取。僅新增本報告並更新進度索引。

標記：ADOPTED_RULE＝已採納規則；CODE_CONFIRMED＝目前原始碼事實；INFERRED＝靜態推論未執行驗證；UNKNOWN＝仍無充分證據。下列 path:line 為本次工作區行號，未代表正式部署檔案逐位元比對。

## 結論

1. CODE_CONFIRMED：單項實體count已有讀取HMAC驗證與寫入SQL結構／版本守衛；不是完全沒有資格競爭保護。
2. CODE_CONFIRMED：現有R06畫面只讀physical_creation_token非空定義及可操作副本，不是新整盒N／M／U的完整候選集合。各清單並行讀取、分類另一次讀取，不保證共同快照。
3. CODE_CONFIRMED＋INFERRED：EVIDENCE_UNAVAILABLE可區分查詢失敗／超限，但簽章金鑰不可用也可能呈PHYSICAL_SOURCE_INVALID，不能僅按UNKNOWN或單一原因碼判定U或失去完成。現有count會拒寫；問題是未來整盒轉換語意，非已確認可繞過寫入。
4. UNKNOWN：整盒適用集合、新清點需求、使用者日期、完成目前值及事件尚未完整實作；不能由舊manual inspection或R06畫面直接取得新規格判定。
5. UNKNOWN：V1／V2與混合守衛皆未選定，亦未驗證交易可行性。已找到已知寫入者，但外部／動態SQL完整性仍無法保證。

## 01 分類依賴與跨定義證據

### 輸入表與實際欄位（CODE_CONFIRMED）

| 表 | 分類所讀欄位／關聯 | 證據 |
| --- | --- | --- |
| v2_component_definitions | id、collection_item_id、notes；physical_creation_token、component_type、quantity_unit；與來源按definition_id JOIN | src/lib/component-classifier-adapter.ts:23、25、33 |
| v2_physical_component_sources | creation_token、collection_item_id、record_scope、actor、request_digest、signature，按definition_id LEFT JOIN | src/lib/component-classifier-adapter.ts:26、34 |
| v2_collection_items | id；實體驗證另讀record_scope，按definition.collection_item_id JOIN | src/lib/component-classifier-adapter.ts:28、35、48 |
| collection_components | id、collection_item_id、component_type | src/lib/component-classifier-adapter.ts:42 |
| collection_items | id（此處不讀名稱或私人notes） | src/lib/component-classifier-adapter.ts:46 |
| v2_legacy_id_map | legacy_table、legacy_id、target_table、target_id；僅組件及收藏兩類映射 | src/lib/component-classifier-adapter.ts:50 |
| v2_collection_management | archived_at；是寫入候選條件，不是純分類adapter輸入 | migrations/0017_physical_components.sql:68 |

副本與清點目前值不在分類adapter內；新整盒判定須另取v2_owned_copies及v2_copy_components。不要把分類結果當成完整副本完成度。

adapter用單一UNION查詢讀所有定義與證據，COUNT(*) OVER加LIMIT 10001，檢查完整性及最多10000列：src/lib/component-classifier-adapter.ts:18、37、57、73、82。definitionIds只選結果；不是縮小全域證據的過濾器：同檔:148、168。

### 分支實際條件（CODE_CONFIRMED）

| 分支 | 真正依賴及邊界 | 證據 |
| --- | --- | --- |
| PHYSICAL_COMPONENT | definition唯一；physicalSource存在；無指向本定義legacy map、notes必NULL；來源token／collection／scope一致、actor非空、digest／signature格式正確，HMAC通過；所屬收藏存在唯一 | adapter:118、123、167；component-classifier.ts:211、219、225 |
| LEGACY_PRODUCT | target map恰一、legacy ID正規數字；notes遷移proof有效且ID一致；舊來源恰一；同legacy來源不得映射其他definition，全部definition notes不得競爭認領；收藏來源存在，正反收藏map同一列且唯一；notes類型與來源相同，限base／expansion／promo | component-classifier.ts:238、244、249、252、261、266、273 |
| UNKNOWN | 上述任一分類條件不成立，或整體snapshot不可用；不能只看classification字串區分可歸屬未判定與不可用 | component-classifier.ts:205、211；adapter:177 |

遷移proof不是普通JSON.parse後取值：程式保留重複根key與ID原始數字拼法，另一個proof不完整definition仍可能形成競爭claim。證據：component-classifier.ts:95、103、124、182。INFERRED：若V2改以SQL重現，不能用簡單json_extract取代全部語意而宣稱等價。

實體直接分支不使用舊商品的claimsBySource判斷；但同一adapter仍受全域證據完整性／上限約束。證據：component-classifier.ts:220先return實體結果，舊競爭判斷在:252之後。整盒其他定義變UNKNOWN可影響U，不等於直接改變本實體來源資格。

## 02 已知寫入者與版本覆蓋

搜尋範圍：src、scripts、migrations的TS／MJS／CJS／SQL，包含INSERT OR IGNORE等語法；補看Migration trigger與動態欄位更新。未執行任何腳本。以下為已找到者，不宣稱涵蓋專案外人工SQL、所有動態拼接或未來Migration。

| 寫入者 | 改變輸入／版本 | 狀態與證據 |
| --- | --- | --- |
| 受控組件create | 新definition、immutable source，physical_revision=1；增加集合與全域證據數 | CODE_CONFIRMED physical-component-management.ts:82 |
| 受控組件edit | name／type／expected／unit；physical_revision+1 | CODE_CONFIRMED physical-component-management.ts:138 |
| count | 單副本×定義actual／checked／last_checked_at；count_revision+1 | CODE_CONFIRMED physical-component-management.ts:151 |
| 收藏create／patch／update／archive | 新收藏、管理revision、封存與管理欄位；只部分屬分類輸入，但新增收藏也改全域證據數 | CODE_CONFIRMED collection-v2-management.ts:217、238、264、268 |
| 副本create／basic edit | 新副本或label／language／edition，推進收藏revision；非組件集合版本 | CODE_CONFIRMED collection-copies.ts:63、69、74 |
| 品況writeCopyCondition | condition_revision+1、seal／舊inspection／trade／condition日期／details；非逐組件count_revision | CODE_CONFIRMED purchase-admin.ts:131、138、145 |
| Migration0012 | 新v2收藏、定義與舊收藏／組件map，遷移notes含proof；沒有新資格世代 | CODE_CONFIRMED migrations/0012_v1_to_v2_migration.sql:21、46、55、76 |
| Migration0013 | collection.record_scope更新 | CODE_CONFIRMED migrations/0013_v2_record_scope.sql:17 |
| 舊結構及數量Migration | 0004重建舊組件表；0006改舊quantity等（quantity不屬本分類投影，不一律稱直接資格變動） | CODE_CONFIRMED migrations/0004_collection_management_upgrade.sql:32；0006_collection_component_quantity.sql:15 |
| 舊匯入腳本 | 產生collection_items upsert SQL；新增id會影響全域證據；既有名稱更新不等於資格變動 | CODE_CONFIRMED scripts/import-sleeves-d1.ts:75 |
| release產物驗證 | 合成測試插入v2收藏，不是正式排程／寫入 | CODE_CONFIRMED scripts/validate-release-artifacts.mjs:48 |

CODE_CONFIRMED：受控source禁止update/delete、definition身份禁止變更或刪除，使用後type/unit鎖定，並防INSERT OR REPLACE替換：migrations/0017_physical_components.sql:34、40、47、51、76、83。

CODE_CONFIRMED：legacy map只有來源／目標四欄組合唯一，不能阻止同來源指向不同target，分類器需額外正反檢查：migrations/0007_v2_core_schema.sql:136。未在本次Migration檢查中找到涵蓋全部legacy證據的immutable／世代保護；此「未找到」不證明外部無機制。

UNKNOWN：沒有完整寫入者閉包，也沒有覆蓋所有分類輸入的現成世代。physical_revision不能因欄位名含revision就當資格版本。

## 03 count讀取驗證與提交守衛

| 條件 | 讀取／程式驗證 | 寫入SQL／DB守衛 | 缺口或限制 |
| --- | --- | --- | --- |
| 數量與ID | safe integer、actual 0..100000 | 綁入數量並寫checked | CODE_CONFIRMED management:17、149；此上限非種類數 |
| HMAC | key匯入、source message及verify | 只比對已驗證signature值；不在SQL重算HMAC | CODE_CONFIRMED proof.ts:11、16、25；adapter:167；management:133 |
| 來源結構 | adapter檢查token／scope／collection／actor／digest | view JOIN重驗來源與collection／scope／token，notes NULL；immutable source阻止替換 | CODE_CONFIRMED adapter:118；0017:60 |
| 定義revision | request.definitionRevision | p.physical_revision=? | CODE_CONFIRMED management:122、133 |
| legacy map衝突 | classifier排除本definition target | view NOT EXISTS本definition target map | CODE_CONFIRMED classifier:222；0017:70；新增此map會擋count |
| 證據上限 | 全域snapshot最多10000且可解析完整 | evidenceSize<=10000 | CODE_CONFIRMED adapter:73；management:7、133；只重查數量，不是完整證據相等 |
| 收藏封存 | 來源收藏可查 | 候選view m.archived_at IS NULL | CODE_CONFIRMED 0017:68 |
| 副本操作條件 | copyId為正整數 | copy.collection_id對定義、在藏、seal<>sealed | CODE_CONFIRMED management:148、154；未知seal允許 |
| 清點版本 | revision非負整數 | COALESCE(既有count_revision,0)=?，同語句upsert | CODE_CONFIRMED management:146、156 |
| 新需求／整盒事件 | 無新流程 | 無N／M／U、雙日期、完成事件或冪等結果關聯 | CODE_CONFIRMED本函式完整action分支:112至179；新契約UNKNOWN |

寫入零列後writeOne會再次查證據數，超限回503，否則409：management:38。這次後查不是提交時精確原因快照，INFERRED：不能把409固定解讀成某項分類失效。現有API沒有保存完成事件，所以不存在已證明的「不可用誤寫失去完成」路徑；風險是未來新流程，勿寫成現有正式缺陷。

### 新發現：key不可用與資格失敗混在原因碼

CODE_CONFIRMED：physicalSigningKey對缺值／短字串回null：physical-component-proof.ts:11。adapter仍可取得complete snapshot，但沒有key就不會驗證proof，source.signature保持null：adapter:113、162、167。classifier因此可回PHYSICAL_SOURCE_INVALID：component-classifier.ts:225，而不一定EVIDENCE_UNAVAILABLE。count隨後因無signature／canUse=false回409：management:125。

INFERRED：若新整盒流程把所有PHYSICAL_SOURCE_INVALID直接當可計U的確定資格失效，就可能把驗證環境問題誤寫失去完成。需要能區分驗證前提可用性與資料資格結果；具體契約未定，本輪未讀任何金鑰值、未注入故障測試。若verify拋例外，adapter catch則保留unavailable，與verify回false的情境不同：adapter:170、175、177。

## 04 整盒集合與N／M／U可重驗性

| 所需輸入 | 既有可取得內容 | 缺口 |
| --- | --- | --- |
| 副本歸屬／狀態 | owned_copies.collection_item_id、inventory_status、seal_status；copies讀各狀態 | CODE_CONFIRMED collection-copies.ts:22；新共同範圍判定未實作 |
| 定義集合 | definitions按collection_item_id；目前沒有edition／copy適用欄位，copy_components只連副本與定義 | CODE_CONFIRMED 0007:87、103；是否全部同收藏定義適用每副本，須契約明定，不能由缺少清點列推「不適用」 |
| 清點目前值 | actual、inspection、last_checked_at及count_revision；沒列可表示未建立 | CODE_CONFIRMED 0007:103、0017:4；新日期與初始化語意未落地 |
| UNKNOWN與完整分類 | adapter可回reason／evidence，但不可用時仍輸出UNKNOWN | CODE_CONFIRMED classifier:79、205；U歸屬／不可用需新整合層，且key不可用特殊情境見03 |
| 收藏清點需求 | 無明確新持久欄位 | UNKNOWN待設計；不得猜notes或bundle回填 |
| 整盒目前值／雙時間／事件 | 舊副本inspection不等於新彙整 | UNKNOWN待新增契約；未找到新聚合或轉換路徑 |

CODE_CONFIRMED：R06 manage頁只讀token非NULL的definition，copy只在藏且非sealed；countList也限受控definition，並未取inspection欄位；四個查詢Promise.all後再讀分類：src/pages/admin/collection/components/manage.astro:50、51、54、60、71。因此不能拿該畫面清單算U，或當借出／封膜副本的清點需求全集；也不能宣稱這些資料來自共同快照。

CODE_CONFIRMED：adapter若definitionIds空直接回[]而不查證據：adapter:158。INFERRED：整盒層必須先證明候選全集確實為空，不能拿已過濾的空清單斷言N=0／U=0或全域證據可用。

ADOPTED_RULE：證據完整但資料條件不成立可為UNKNOWN；查詢失敗、超限或集合不完整是判定不可用，不宣告完成、不推定失去完成、不填虛構N／M／U。UNKNOWN：目前adapter結果不足以直接實現所有新可用性語意。不可用時整體操作是否拒絕／恢復與顯示尚需契約；本輪不新增欄位或狀態機。

## 05 候選守衛必要前提與限制

| 候選 | 必要前提 | 本輪結論 |
| --- | --- | --- |
| V1 集合／資格世代 | 明確界定所有相關欄位與寫入者，含新增／刪除／替換、Migration及維護；DB trigger或服務能原子遞增；跨部署規則／key可用性另處理 | UNKNOWN閉包未證明；全域世代可能有無關衝突，不先採納 |
| V2 完整輸入比對 | 比對完整集合而非只既有列；保護跨定義notes／正反map及實體來源；DB內守衛須使batch失敗，不能僅命中零列；程式HMAC與JSON proof語意須可銜接 | INFERRED可作候選；未寫SQL／未驗證，不能聲稱必然可行或不可行 |
| 混合 | 拆分immutable來源、可變集合、逐組件清點、範圍及規則／驗證環境，指定每項由哪個守衛覆蓋 | INFERRED較適合下一輪列具體設計，但仍未選型 |

官方文件核對：

- https://developers.cloudflare.com/d1/worker-api/d1-database/ ：batch語句失敗回滾整序列；不代表SQL零列自動失敗。
- https://developers.cloudflare.com/d1/platform/limits/ ：每語句最多100綁定參數、100KB SQL、查詢時間限制；整個batch對每次Worker查詢次數上限只計一次。不能由50／1000推單批副本上限。
- 規則版本、分類程式部署與驗證金鑰可用性不全是DB世代能表達；新提交流程需考慮，不於本輪選方案。

UNKNOWN：實際D1 batch競爭、零列guard、事件識別／順序取得、超限／逾時、結果重播與多副本原子容量都未執行驗證。帳戶方案未查。單副本種類上限未確認，不先新增產品限制；可比較集合式SQL／結構化參數，不能把100參數直接當100組件。

## 建議下一步（不是新實作授權）

先討論一題：分類驗證環境不可用（特別是key不可用）應如何與資料資格不成立區別，以及新整盒提交遇不可用如何處理。這會決定U與事件守衛的可靠輸入。再把每個輸入分派給直接比對／世代／immutable證據等具體候選，及整理最小隔離驗證計畫。

本報告完成既定五項靜態核對，不代表外部寫入者已全找齊、完整守衛定稿或已授權測試。C1／C2、V1／V2、G皆維持未選定。
