# P3-L1 Windows + Miniflare 一般本機功能測試設計

2026-11-18（Asia/Taipei） · 設計候選，未授權修改或執行

`P3_L1_DESIGN_COMPLETE` / `LOCAL_TEST_POLICY_CANDIDATE` / `STAGE1_BLOCKED` / `L2_NOT_AUTHORIZED` / `L3_NOT_AUTHORIZED` / `STAGE2_NOT_AUTHORIZED`

## 1. 目的與狀態

使用者選擇優先規劃現有Windows＋Miniflare一般本機功能測試。本輪只定義新政策候選、最小修改設計及下一輪授權邊界，**未採納執行政策、未批准L2／L3，亦不追溯放寬D1或原Stage1的驗收**。

目的分兩步：先在相同host／port策略／版本／權限下，以單次零SQL診斷確認Miniflare能否取得本機D1 binding並保存EACCES原因；成功後，另案決定是否以一般本機政策執行既有功能案例。L3不包含第二步。

本機功能測試可驗證指定版本下的操作、guard、回滾與事件一致性，不能證明遠端Cloudflare D1行為、全程序樹強制隔離、正式架構選型或Production Ready。單次binding成功尤其不能證明SQL／並行案例通過。

原16個Stage1子案例、G-01／G-05／G-08、SNP、SELF，以及P1／P2、S1～S7與日期、歷史、冪等決策全部保留，不改測試語意、不以SQLite替換Miniflare D1。

## 2. 證據基準

所有相對路徑以workspace根為基準：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog`

| 標記 | 事實或限制 | 依據 |
| --- | --- | --- |
| CODE_CONFIRMED | 原Stage1在binding之前阻塞，16案例皆BLOCKED，未執行業務SQL | docs/P3-stage1-execution-result-20261118.md |
| CODE_CONFIRMED | D1 construct／ready成功，binding的cause為connect EACCES 127.0.0.1:6655；dispose成功 | docs/P3-stage1-runtime-diagnostic-result-20261118.md；原D1 evidence/error.json、stages.ndjson |
| CODE_CONFIRMED | D1有Request.cf外部解析嘗試，僅事後保存警告，沒有立即停止 | 同報告；tests/p3-stage1/diagnose-runtime.mjs:40、42、45 |
| CODE_CONFIRMED（靜態） | cf:false可經convertSharedOptions傳入，setupCf提前返回；原診斷未設定 | node_modules/miniflare/dist/src/index.js:132059、78670；docs/P3-D2-isolation-and-loopback-readonly-review-20261118.md |
| CODE_CONFIRMED | 同步bridge自載Undici並明確使用Pool dispatcher，主global fetch無法全面覆蓋 | 同bundle:119805、119818、119828；docs/P3-stage1-blocked-diagnosis-20261118.md |
| UNKNOWN | EACCES具體政策根因、現有全程序樹隔離 | docs/P3-D3-isolation-feasibility-and-eacces-readonly-review-20261118.md；不重查已失敗系統查詢 |
| INFERRED | 本文件的父程序監督／局部deny／新文件結構可作最小本機方案 | 尚未實作或動態驗證 |

D4獨立環境設計仍保留（docs/P3-D4-isolated-environment-feasibility-comparison-20261118.md）；優先規劃本機功能測試不等於認定原Windows隔離已證明或VM方案失效。

## 3. 新舊要求差異表

| 條件 | 原P3嚴格隔離 | 一般本機功能政策候選 | 處理 |
| --- | --- | --- | --- |
| 全程序樹非loopback請求前強制封鎖證明 | 必須具備，未證明即BLOCKED | 不作本機功能測試前置證明；明示無此保證 | **調整**，僅對新政策，須使用者批准；原驗收仍BLOCKED |
| 不主動使用外部服務、不允許外連 | 禁止 | 同樣禁止；未被hook攔住也不視為許可 | 保留 |
| 局部deny與異常停止 | 不能取代強制隔離 | 作風險降低與停止機制，逐項披露覆蓋 | 調整角色，非強隔離 |
| loopback host／port | 127.0.0.1／port0 | 完全保留 | 保留，不以改port修EACCES |
| 已知非必要外連 | 不允許 | 明確cf:false、telemetry off；無remote binding／upstream等 | 保留並補已知缺口 |
| 環境與正式資源分離 | 合成資料、白名單env、獨立目錄 | 同樣要求，不繼承正式認證或讀設定 | 保留 |
| 套件／執行器／權限 | 固定現有版本；不提權 | 同樣要求；錯誤即停，不換執行器 | 保留 |
| L3的SQL／分類器／HMAC呼叫 | 非L3原Stage1可有合成SQL | L3只binding，零SQL、不匯入業務測試或分類器 | L3不適用；未取消後續案例 |
| VM／容器及全邊界配置 | 可用來滿足強隔離 | 本機方案不建立VM／容器 | 此路徑不適用，原候選保留 |
| 結果分類 | 嚴格隔離＋功能均須對應證據 | 功能結果與本機政策遵循分列；原隔離獨立UNKNOWN／BLOCKED | 分軌記錄 |
| 部署／正式架構／遠端D1 | 未驗證 | 一樣未驗證 | 保留 |

「不作強隔離前置證明」是新政策最主要的差異，不能在批准L2寫檔時自動當成使用者接受L3動態風險。

## 4. 最小技術修改位置與檔案策略

### 4.1 cf:false

最小邏輯位置是Miniflare構造參數中的共享選項，位於`convertV4MiniflareOptions({...})`內，與host、port、telemetry同層：明確`cf:false`。原位置為`tests/p3-stage1/diagnose-runtime.mjs:45`；後續功能執行原型的對應位置為`tests/p3-stage1/local-runtime.ts:18`。本輪及建議L2均**不修改這兩個舊檔**，只在新的本機診斷檔採用該設定。

靜態鏈為V4 schema→convertSharedOptions的cf原值→V5 instance options→setupCf(false)早返，詳D2。無須繼承CLOUDFLARE_CF_FETCH_ENABLED或改NODE_ENV，更不能修改node_modules。cf:false只關閉已知Request.cf抓取，不證明其他網路能力不存在。

### 4.2 L2最小候選新增檔案（本輪未建立）

| 完整路徑 | 責任 |
| --- | --- |
| D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\tests\p3-local\launch-local-diagnostic.ps1 | 獨立父監督；白名單env、ProcessStartInfo、stdout控制協定、deadline、停止本次樹、最終證據與hash |
| D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\tests\p3-local\diagnose-local-runtime.mjs | 動態import Miniflare前安裝局部hook；construct／ready／binding／dispose各一次；零SQL |
| D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\tests\p3-local\diagnostic-evidence.mjs | Error遞迴序列化、同步fatal最小紀錄、控制訊息與去敏；無runtime／DB副作用 |

三檔只為L3，不引入新套件、不共用舊runner的Stage1啟動／Schema責任。L2審查須確認直接／傳遞imports及選項，保留33個既有受保護檔的hash；不把靜態審查當IPC與kill行為已驗證。未來要跑16案例必須另案審查執行器調整，不能直接指向原runner並稱沿用本政策。

## 5. 局部網路防護、fatal IPC與父程序停止

### 5.1 子程序局部防護

- 明確cf:false、telemetry.enabled=false，唯一合成P3_TEST，無KV／R2／queue／remoteProxy／upstream／registry／explorer或Cloudflare CLI。
- 在Miniflare動態import之前安裝主global fetch wrapper。僅允許字面loopback目的地及http／https；不接受URL userinfo；不主動發送探測。對該wrapper控制的fetch禁止自動外部redirect（採拒絕redirect），避免只驗第一跳。這不保證自載Undici也受控。
- 原生Worker outbound全部deny。deny先同步標記fatal及保存去敏最小事件，通知父程序，再拋出錯誤。即使套件catch吞掉例外，父程序仍應停止。
- 自載Undici、顯式Pool及worker threads等未覆蓋路徑明示UNKNOWN；本輪不建議注入全域preload或修改套件來聲稱全面攔截。

### 5.2 控制通道設計

以**子程序專用stdout作行分隔JSON控制通道**，屬本機pipe IPC，不建立TCP listener。只有證據helper可輸出協定；原始runtime log由custom Log轉成去敏記錄，禁止dump headers／env。每行限制16 KiB；已知kind包含stage、endpoint、fatal、final，runId及序號須匹配。非協定stdout、超長行、無法解析、重複final或不合法phase順序皆停止，不能忽略。

父程序使用非同步讀取stdout／stderr，不可先同步WaitForExit再讀輸出；等待／監督迴圈不得被read阻塞。收到fatal立即停止自己的Process物件及後代（Kill(true)），不按名稱殺所有Node。stderr非空先保存去敏摘要並視為runtime異常停止，不能假定只有Warning才重要。

子程序另以同步檔案寫入fatal.json作後備，父程序監督迴圈檢查；pipe傳送失敗、協定斷線、子程序異常退出均不視為成功。fatal不依賴finally才寫。同步bridge可能阻塞子程序事件迴圈，因此deadline與樹停止必須由不載Miniflare的父程序持有。

預計父監督檢查間隔上限100 ms，**不是即時性保證**；排程、I/O、IPC flush或kill均可能延遲。若子程序在送IPC之前已堵住，只有父deadline能兜底。不能承諾所有外連在發生前被阻擋。

### 5.3 runtime log異常辨識

custom Log遇Request.cf抓取警告、非loopback URL／DNS／connect警告、未能可靠分類的網路錯誤、或非預期runtime錯誤時，先標記fatal並發IPC，而非只append日誌。已知loopback EACCES作診斷失敗保存原cause，停止後續階段；不得改host／port重試。非預期警告採保守停止，之後由人審查，不自行加入忽略清單。

日誌識別只能事後偵測，可能漏掉不產生日誌的活動；成功的隱藏外連不能因未觀察而被認定不存在。若事後檢查才發現，仍標記本機政策違規，推翻政策PASS，保留原結果與補充結論，不覆寫證據。

### 5.4 正常與異常停止

正常：binding取得後立即dispose，等待成功，再final，正常退出。異常：fatal後不再呼叫binding或其他業務；若父程序先kill，dispose未完成則明記NOT_CONFIRMED／INTERRUPTED，不偽造成功。父程序在啟動起最多60秒停止本次樹；其後只做有界退出核對與證據收尾，不再啟動runtime。

進程樹所有權／基線與退出核對沿用D1的專屬Process控制；若無法確認自身後代已停止，標STOP_NOT_CONFIRMED並停止任務，不殺無關程序或提權。

## 6. 正式資料與認證限制

父程序Environment.Clear後只加入原Stage1已審查的Windows必要變數名、固定Node／System32 PATH、CI=true、WRANGLER_SEND_METRICS=false及本次隔離目錄變數。不得繼承CLOUDFLARE_*、CF_*、BGG_*、ADMIN_*、ACCESS_*、proxy、NODE_OPTIONS或NODE_PATH。不讀取這些被排除變數的原值。

不載入.env、.dev.vars、Wrangler設定、dist、Astro app、Access認證、正式key、備份、正式D1／KV binding；不使用npm／npx／Wrangler，不登入或下載。Miniflare僅由已安裝固定入口載入。讀package metadata及lock供版本hash，不代表允許執行package scripts。

L3不匯入Stage1測試、schema helper、分類器或HMAC；不複製Migration到DB、不呼叫prepare／batch／exec／SQL。可唯讀hash22份Migration，但不載入其語句。runtime可能自行建立metadata.sqlite與sidecars，必須明示這是本機runtime內部寫入，不能將「零SQL接口呼叫」寫成完全零磁碟寫入。

## 7. 新目錄、檔案白名單及停止後檢查

L3固定候選runRoot（本輪不建立）：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\.wrangler\p3-local\diagnostics\P3L3-20261118-001`

目錄存在即BLOCKED，不自動改runId。建立前核對絕對路徑與祖先reparse，腳本再核對cwd、root及wx啟動marker；不能覆寫Stage1或D1 root。

| 寫入範圍 | 候選白名單 |
| --- | --- |
| runRoot | started.json；state／tmp／home／appdata／localappdata／config／cache／evidence目錄 |
| evidence | preflight.json、manifest.json、stages.ndjson、runtime-log.ndjson、network-denials.ndjson、control.ndjson、endpoint.json、error.json、fatal.json（若有）、result.json、process-stop.json、protected-hashes.json、stdout-sanitized.log、stderr-sanitized.log |
| state／tmp等 | 僅Miniflare／workerd本地產物；不得寫到root以外；具體native檔名事前不冒稱已知 |

HOME／USERPROFILE等全部映射runRoot；MINIFLARE_CACHE_DIR若需要新增，須L2審查後在明確白名單指定root/cache，不繼承外值。cf:false不依賴快取命中。

父監督在啟動前／退出後核對三個新檔及既有33個受保護檔案hash（舊六檔、三個相關產品檔、helper、lock、22份Migration）；不宣稱這等於全node_modules完整性驗證。記錄版本、檔案清單、UTC、單調序號、duration、PID／樹停止結果、denial／fatal數、SQL接口呼叫0與授權模式LOCAL_FUNCTIONAL_CANDIDATE。

錯誤僅保存白名單name／message／stack／cause／AggregateError.errors／code／errno／syscall／address／port；設深度、節點、字串及循環限制。沒有的屬性不由message補造；URL只留protocol／host／port，禁止proxy secret、headers、cookies、完整env或私人資訊。去敏後的「完整可取得錯誤鏈」不等於保存未去敏原始輸出。

停止後列出本次root檔案及hash，檢查預期保護檔未變、endpoint為loopback、程序均停止、控制協定／日誌有無異常。沒有OS級檔案／網路全面追蹤，因此不得說「已證明無任何越界寫入／未觀察外連絕對不存在」。若有寫出root跡象即停止且不自動刪除；不清理原證據或native state。

## 8. 殘餘風險與必須停止事件

### 8.1 可供使用者考慮接受的殘餘風險（尚未採納）

- 沒有全程序樹網路隔離證明；套件自載或native通道可能未被局部hook攔截。
- 未產生日誌的活動可能無法被觀察；父程序停止有延遲，異常發現後不能取消已發生的DNS／請求。
- EACCES可能再次發生，單次診斷仍可能無法指認根因。
- runtime內部有合成本機metadata寫入；強停可能留下state／不完整證據，保留而不猜測提交狀態。

接受上述「控制／觀測有缺口」不等於允許任何外連目的地。**外連許可清單仍為空**；非loopback未被攔住不是授權，已觀察嘗試即政策違規，不能標成合規PASS。

### 8.2 必須停止

root已存在、reparse／cwd／env檢查失敗、工具版本漂移、import／選項超白名單、正式資料／認證讀取跡象、非loopback endpoint、任何外部請求／DNS／Worker outbound、必要IPC失效、非協定輸出、runtime警告／異常、EACCES、deadline、dispose失敗、受保護檔hash變動、無法確認程序停止。

前置失敗不啟動runtime；執行中失敗停止本次樹；不自動重試、換識別、版本、host、port、權限或執行器。由父程序歸檔後停止，等待人審查。

## 9. L3單次零SQL診斷候選授權單

**此段可供後續批准，不是現在的執行許可。** 前提為L1本機政策與殘餘風險已明確採納，L2檔案修改已批准並完成靜態審查。

候選呼叫介面：在workspace中執行`tests/p3-local/launch-local-diagnostic.ps1`，傳入固定workspace、上述P3L3-20261118-001 runRoot、`D:\Program Files\nodejs\node.exe`及`--no-sql`等明確模式。**實際PowerShell參數名稱、完整命令與三檔hash須由L2交付後審查，本文件不提供尚不存在腳本的可直接執行承諾。** L3不得拿舊D1命令代跑。

允許的單次順序：

1. 父程序完成路徑、版本、env、輸入hash與可停止性檢查；建立全新root及white-list目錄。
2. 啟動一個專用Node子程序，無shell、無視窗；父程序保持監督，子程序完成control ready握手後才import／construct。
3. **construct一次 → await ready一次 → getD1Database('P3_TEST')一次 → dispose一次**。Miniflare內部為binding所需的本機通訊屬runtime流程，不能當額外手動probe。
4. ready只記protocol／host／port，固定host127.0.0.1、port0；保留現有Node v24.21.0、Miniflare 5.20261006.1-alpha、workerd 1.20261006.1與compatibilityDate2026-10-01。檔案metadata與歷史版本不符即停，不自行降升版。
5. 任意fatal按第5節停止；最長60秒，零SQL、不讀分類證據或測試fixtures；不進入Stage1。父程序保存退出／停止後檢查。

若再次EACCES，只保留本次完整可取得cause；若cause遺失，標CAUSE_UNAVAILABLE。不可用前次6655錯誤當作本次cause，也不可手動探測該舊port。

## 10. 不同PASS標準與報告格式

| 驗收軸 | PASS必要條件 | 不可推論 |
| --- | --- | --- |
| L3 binding功能 | 授權範圍內一次取得P3_TEST並正常dispose，零SQL，時間／版本完整 | SQL／16案例通過、EACCES根因已解 |
| 一般本機政策遵循 | 採納政策後執行；前置與停止檢查通過，無觀察到違規／fatal，受保護檔不變、程序停止、證據齊全 | 未觀察外連≠證明全程序樹無外連 |
| 後續Stage1本機功能 | 另授權後原16案例各自有guard／rollback／SNP／SELF證據；任何BLOCKED不可算PASS | 不取代原嚴格隔離驗收 |
| 原P3嚴格隔離 | 仍須全程序樹強制邊界等原證據 | 本機功能成功不能將此軸改PASS；本輪保持BLOCKED／UNKNOWN |

未來L3報告至少分列：`bindingFunctionalResult`、`localPolicyResult`、`strictIsolationResult`、`processStopResult`。binding若成功但發現外連，功能觀察可記「已取得」，整體本次驗收仍BLOCKED／POLICY_VIOLATION；不能只報綠燈。

runtime無法啟動屬BLOCKED；具體binding例外記功能失敗／原因，不把它冒充guard SQL的FAIL；證據缺失為UNKNOWN，不猜測結果；所有測試仍未執行。L3全通過最多標`LOCAL_BINDING_DIAGNOSTIC_COMPLETE`，不得標STAGE1_EXECUTION_COMPLETE、STRICT_ISOLATION_PASS、REMOTE_D1_VERIFIED或PRODUCTION_READY。

## 11. L2／L3授權邊界及本輪停止點

| 階段 | 需單獨批准的範圍 | 禁止連帶動作 |
| --- | --- | --- |
| L1本輪 | 只交付此設計文件 | 不修改任何工具、不執行 |
| L2候選 | 僅新增第4節三檔、靜態審查與hash清單；交付完整L3命令與最終選項 | 不執行腳本、node --check或任何Node程序，不建立runRoot、不測IPC／SQL |
| L3候選 | 明確接受本機政策及殘餘風險後，批准固定hash工具、全新root及一次零SQL診斷 | 不重跑舊D1／Stage1、不改策略、不自動續跑 |
| 後續功能驗證 | 依L3結果另審原16案例的本機執行單 | 不因binding成功自動授權SQL、Stage2或部署 |

本輪唯一新增檔案：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\docs\P3-L1-windows-miniflare-local-test-design-20261118.md`

原Stage1、D1全部state／evidence與D2～D5文件保持原樣；本輪未查系統、啟動程序、建立listener／VM、安裝、改政策、執行SQL或遠端操作。沒有批准L2／L3或正式架構，V1退役與表名正規化繼續延後。

`P3_L1_DESIGN_COMPLETE` / `LOCAL_TEST_POLICY_CANDIDATE` / `STAGE1_BLOCKED` / `L2_NOT_AUTHORIZED` / `L3_NOT_AUTHORIZED` / `STAGE2_NOT_AUTHORIZED`

完成文件後停止，等待審查。
