# P3 D2 唯讀隔離與 EACCES 審查

2026-11-18 · `READONLY_REVIEW_COMPLETE` · `DYNAMIC_EXECUTION_NOT_AUTHORIZED`

## 1. 範圍與結論

本輪僅閱讀既有D1／Stage1證據、診斷檔及已安裝套件原始碼，新增本Markdown。不啟動Node、Miniflare、workerd；不執行SQL、連線探測、系統設定查詢命令或遠端請求；不修改診斷程式、六個Stage1檔案、產品、Migration、套件或舊證據。

主要結論：

1. `CODE_CONFIRMED`：Miniflare 5.20261006.1-alpha公開支援`cf: false`；V4轉換會保留false，setupCf會在讀快取及外連之前返回fallbackCf。這是阻止已知Request.cf路徑的設定，不是整個程序樹的網路隔離。
2. `CODE_CONFIRMED`：現有global fetch與Worker outbound deny沒有涵蓋套件自載Undici；警告hook也沒有停止流程。只改警告hook仍只能事後停止，不能回溯阻擋已發生的DNS／請求。
3. `CODE_CONFIRMED`：D1保存的直接原因是loopback connect EACCES。`UNKNOWN`：拒絕由哪個安全機制／程序條件造成，現有證據不足；不能歸因Cloudflare登入、SQL或特定port配置。
4. 下一次動態診斷之前，須先批准隔離修正與其覆蓋範圍。若要求整個Node／worker-thread／native workerd樹都具備「非loopback請求前阻擋」，目前尚無已證明可用且不需系統變更的邊界，不應只加`cf:false`就宣稱條件已滿足。

本報告標記：`CODE_CONFIRMED`指本機原始碼或既有執行證據直接支持；`INFERRED`指推導／候選；`UNKNOWN`指未證明。候選步驟均未執行。

所有以下path:line以workspace根為基準：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog`

## 2. cf:false公開契約與實際傳遞

| 路徑 | 已確認行為 | 證據 |
| --- | --- | --- |
| 套件版本 | 安裝版本5.20261006.1-alpha | node_modules/miniflare/package.json:3；D1 evidence/manifest.json |
| 公開V4型別 | cf允許boolean、string、record | node_modules/miniflare/dist/src/index.d.ts:9867 |
| V4執行期schema | cf為optional union，包含boolean | node_modules/miniflare/dist/src/index.js:131983 |
| 轉換入口 | V4MiniflareOptionsSchema.parse後合併convertSharedOptions與workers | 同檔:132031 |
| 共享選項傳遞 | `cf: options.cf`，未用truthy判斷丟掉false | 同檔:132059 |
| V5執行期schema | InstanceOptionsSchema也接受cf boolean | 同檔:89396 |
| 初始化 | assembleConfig呼叫setupCf(log, sharedOpts.cf) | 同檔:134170 |
| 選項優先序 | 明確cf值（包含false）優先於環境變數 | 同檔:78657 |
| 返回點 | effectiveCf=false時直接回fallbackCf；不執行後續快取讀取或fetch | 同檔:78670 |
| 已知外連 | 自載Undici fetch到defaultCfFetchEndpoint | 同檔:78565、78584、78690 |

因此候選修正應在既有`convertV4MiniflareOptions({...})`的共享選項明確加入`cf:false`。不是在回傳結果上隨意新增欄位，也不須設定NODE_ENV=test或繼承CLOUDFLARE_*環境變數。環境變數禁用路徑確實存在（:78585、:78643），但本輪不建議為此放寬原環境白名單。

這裡的「false」不是停用全部Request.cf語意：它改用套件內建fallbackCf，而非線上抓取的資料。未執行轉換函式或runtime驗證；靜態傳遞已確認，實際修訂後仍需獨立批准才可測。

快取路徑由MINIFLARE_CACHE_DIR或cwd下node_modules/.mf、.wrangler/cache選擇（:78566）；既有D1 cwd及環境隔離不會自動阻止快取失敗後的外連。不應靠預先填快取或讓DNS失敗作為隔離方式。

## 3. 初始化與相關網路路徑盤點

以下區分「套件含此能力」與「本次初始化會走到」；不是掃到fetch字串就認定已外連。

| 路徑 | 證據與觸發條件 | 分級／本次情況 |
| --- | --- | --- |
| Request.cf資料抓取 | setupCf未明確false且無有效快取，透過自載Undici取得https://workers.cloudflare.com/cf.json | **已觀察**：runtime-log.ndjson:1於08:44:09.708Z記ENOTFOUND；不是成功遠端回應。CODE_CONFIRMED |
| 同步binding proxy | worker thread自己require Undici，Pool連runtimeEntryURL；getD1Database進proxy取得binding | **已觀察本機通道**：error.json記127.0.0.1:6655 EACCES。bundle:119805、119818、119828、135100、135240。不是外部請求 |
| Worker一般fetch | outboundService經V4轉入dev.outboundService，再配置自訂service | CODE_CONFIRMED：bundle:132155、132425、121040；既有inline worker沒有外部fetch，deny=0。此hook不攔Node內部fetch |
| workerd一般internet service | core生成allow public/private的network service | CODE_CONFIRMED：bundle:121303。能力存在不代表本次發出請求；不能以用戶worker deny宣稱所有native內部通道皆封鎖 |
| remote binding／remote proxy | dev.remoteProxyConnectionString及各資源remote判定決定遠端代理 | CODE_CONFIRMED能力：bundle:132090、132159、132285。診斷僅合成D1字串，無remote connection string；沒有此遠端分支被啟用證據 |
| upstream | 僅配置upstream時加入對應內容 | CODE_CONFIRMED條件：bundle:121223；診斷未設定。不推定發生upstream連線 |
| dev registry／其他本機instance | registryPath有值才isEnabled；共享服務可能連其他instance | CODE_CONFIRMED：bundle:131052、133287、134172；診斷未設定unsafeDevRegistryPath，沒有啟用證據 |
| inspector／browser probe | inspector需相應設定；browser readiness probe會fetch指定wsEndpoint的HTTP origin | CODE_CONFIRMED能力：bundle:133253、126350、128330；診斷未開browser或inspectorPort，無此路徑執行證據 |
| explorer／observability／telemetry | explorer在unsafeLocalExplorer條件下組裝，傳入telemetry；observability另有開關 | CODE_CONFIRMED：bundle:121323、121359、121365；本次telemetry.enabled=false，無explorer／observability開關。不能把telemetry off等同全套件無外連 |
| 套件包含的tunnel／容器／下載等工具 | bundle含額外工具與fetch能力，但不是現有inline D1設定的啟用證據 | UNKNOWN完整閉包：本輪未逐一證明所有模組載入副作用及native二進位內部行為；不得宣稱列完所有潛在外連 |

原始碼含有外連URL不等於本次已請求；反之network-denials空也不能證明沒有外連。ENOTFOUND只能確認解析失敗，不提供OS網路封包／DNS resolver完整記錄。

## 4. 最小停止方案：阻擋與事後停止分開

### 4.1 建議的最小分層候選（未實作）

1. **構造前關閉已知非必要路徑**：明確cf:false，保持telemetry off、無remote／upstream／explorer／registry；保留原合成binding、host及port策略。靜態驗證最終選項而不記secret。
2. **沿用請求前deny**：主global fetch只允許明確loopback；Worker outbound全部拒絕。命中時同步標記fatal並送出簡短IPC，父launcher停止自己的子程序樹。避免只throw後被套件catch吞掉而繼續執行。
3. **警告／錯誤即停止作後備**：custom Log偵測已知外連警告或其他無法歸屬的網路錯誤，先標記fatal，發送IPC到父launcher；父程序Kill(true)本次樹，保留證據。僅寫非同步檔案不足。不能只在await ready之後檢查fatal，因為binding內同步bridge可能阻塞主事件迴圈。
4. **父程序獨立deadline**：保留最多60秒及專屬Process控制；停止後核對自身PID與子程序。不以process.exit單獨替代樹清理，也不無差別終止所有node／workerd。

| 保護 | 是否請求前阻擋 | 限制 |
| --- | --- | --- |
| cf:false | 是，針對setupCf已知取值路徑不建立請求 | 不攔其他Undici／native通道 |
| 主global fetch deny | 是，僅經此wrapper的呼叫 | module已捕捉的fetch、自載Undici及worker thread不保證覆蓋 |
| Worker outbound deny | 是，僅路由到該service的Worker請求 | 非Node／整個workerd程序樹防火牆 |
| Log／stderr警告→父程序停止 | **否**，警告通常發生在DNS／連線失敗之後 | 只能減少後續動作；不能抹去已發生嘗試，也不保證成功外連一定產生日誌 |
| 60秒上限 | 否 | 是程序生命週期保護，不是網路隔離 |

最小候選能修復「已知cf路徑」及「發現後不立即停止」兩個缺口，但**仍不足以證明任意意外外連都在請求前被攔**。

### 4.2 若要涵蓋套件自載Undici

可另案評估測試專用preload，在Miniflare import之前為所用Undici dispatcher安裝loopback allowlist，並驗證同步worker thread是否繼承且在其require／new Pool前生效。現有同步bridge使用**顯式Pool dispatcher**（bundle:119818、119828），單改global dispatcher不保證有效；只patch主程序同名套件也不保證另一模組實例／thread生效。

這是更大的測試程式與啟動策略變更，需要新增授權及覆蓋證明，不是本輪建議直接執行。不得記錄request headers、內部proxy secret或未去敏URL。攔截僅觀測hook並不等於阻擋hook；不能在不支援的診斷channel callback中隨意throw便稱為安全邊界。

即使Node層dispatcher封住，native workerd、其他net／tls／DNS路徑仍可能不在範圍。若要求整個程序樹具備強制非loopback隔離，應先確認既有受管環境是否提供可證明的egress policy，或另案設計獨立隔離環境。**本輪不新增防火牆規則、不變更權限；若無可用邊界則繼續BLOCKED。**

## 5. EACCES：已知、可能原因及區分證據

已知時間鏈：D1於08:44:10.497Z取得公開ready URL http://127.0.0.1:6655，08:44:10.501Z開始getD1Database，08:44:11.203Z記TypeError fetch failed，其cause為connect EACCES同位址。08:44:11.236Z dispose成功，08:44:11.3960316Z停止檢查無node／workerd。參見既有D1 stages.ndjson、error.json、endpoint.json、process-stop.json。

EACCES文字支持連線權限拒絕，不支持指定哪個機制拒絕。數字IPv4目的地使localhost DNS或IPv6選擇問題對這一次錯誤的解釋較弱；ready也不能證明稍後connect必成功。6655是分配後實際port，不是配置port0被拿來連線。

| 可能原因（INFERRED） | 現有支持／限制 | 不提權的區分證據候選，均未取得／未執行 |
| --- | --- | --- |
| 執行沙箱／受管政策限制loopback connect | EACCES相容；沒有政策決策記錄可指定沙箱 | 查閱已存在的政策說明、launch拒絕記錄；如需宿主端資訊由管理者提供去敏結論，不索取認證。不得以提權或移出沙箱作預設驗證 |
| Windows Filtering Platform／防火牆／端點防護 | EACCES相容；無規則命中證據 | 若目前帳號有讀權，查既有同時間／PID／位址的防護與防火牆事件；沒有事件不能排除，拒讀即記UNKNOWN，不啟用審計或更改規則 |
| listener關閉、port所有者變化、native重啟 | ready後仍可能變動；一般單純無listener較常見不同錯誤，但不能僅此排除 | 下次另授權runtime時，同時取得loopback Listen狀態／OwningProcess、workerd lifecycle與時間；現在runtime已停，查6655現況無法還原當時 |
| Windows埠保留／其他socket資源或政策 | 沒有證據；不能把port0直接當錯誤原因 | 另授權唯讀查看excluded port ranges、目前listener及既存錯誤；保留範圍相交也不自動證明此outbound connect根因，不自行改port |
| Node／Undici worker-thread傳輸或平台相容性 | 故障由同步bridge自載Undici拋出 | 先唯讀檢查版本及程式路徑；如需同環境主thread與worker-thread的合成loopback對照，屬新動態測試，需獨立授權且不得讀proxy headers |

可另授權的唯讀Windows命令候選為`Get-NetTCPConnection -State Listen`（需按本次PID／endpoint限縮保存）、`netsh interface ipv4 show excludedportrange protocol=tcp`及按UTC窗口／既知provider過濾的`Get-WinEvent`。本輪未執行；可用性與普通帳號讀取權限未知。輸出可能含無關程序／安全資訊，需先限定範圍及去敏，不直接dump全系統事件。任何AccessDenied均停止該項，不要求提權。

現有Error沒有獨立code／errno／syscall／address／port欄位可取得；不從message偽造原始屬性。cf的ENOTFOUND與loopback的EACCES是不同失敗，尚無因果證據；不以解決cf便承諾修好binding。

## 6. 隔離修正與loopback候選步驟／授權

### A. 隔離修正先行

| 步驟 | 內容 | 風險與授權 |
| --- | --- | --- |
| A0 本輪 | 確認cf傳遞與現有hook缺口，交付本報告 | 已完成唯讀；無新執行授權 |
| A1 待批准設計 | 選定保護強度：已知路徑關閉＋局部deny，或全程序樹強制egress限制；逐通道列涵蓋與缺口 | 若硬要求全覆蓋而證據不足，維持BLOCKED；不暗自降級原要求 |
| A2 待批准修改 | 僅測試專用檔加入cf:false、fatal IPC、父程序立即停止及deadline；指定新檔與新root，不覆寫D1 | 修改程式／啟動契約均需明確授權；保留原D1原樣 |
| A3 待批准動態驗證 | 經審查後一次synthetic runtime construct→ready→binding→dispose，零SQL；如需deny負測試先列具體本機模擬方法，不發真正外部探測 | 不是本輪授權；不得自動從通過進Stage1，亦不可現在先建立root |

### B. Loopback診斷分離

| 步驟 | 候選內容 | 風險與授權 |
| --- | --- | --- |
| B0 先收既有資訊 | 已存在的執行策略／防護事件、安裝套件路徑、版本 | 本輪已讀套件；新增系統事件查詢另列授權，拒讀不提權 |
| B1 一次runtime觀察 | 保持host127.0.0.1／port0／版本，保存ready endpoint、listen owner、native生命週期、cause；沿用修好的隔離停止機制 | runtime及配套OS觀察需新授權；不得先改host／port或擅換執行器 |
| B2 最小傳輸對照 | 如仍需要，另設合成loopback listener與主thread／worker-thread連線，與runtime分開，無SQL／proxy secret | 新增測試檔、額外listener／請求均超出D1；先審查逐項次數與上限，再授權，非自動後續 |

若任一步出現外連、隔離不明或需要權限變更，保存並停止；結果未知不當回滾；不以成功binding接著跑SQL。A與B可以共用證據，但不應一次變更cf、host、port、版本和權限後失去區分能力。

## 7. 原始證據保存與交付

Stage1原root：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\.wrangler\p3-stage1\runs\P3S1-20261118-001`

D1原root：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\.wrangler\p3-stage1\diagnostics\P3D1-20261118-001`

兩者所有原檔、evidence、state、metadata.sqlite及sidecars均留存。本輪只用讀取／搜尋／列目錄，未清除、搬移、重寫或開啟sqlite。未把D1的cause改寫進Stage1舊error。原D1 result.json保持原狀，其整體隔離驗收仍以既有D1報告的BLOCKED為準。

本輪唯一新增檔案：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\docs\P3-D2-isolation-and-loopback-readonly-review-20261118.md`

`D2_READONLY_REVIEW_COMPLETE` / `RUNTIME_REMAINS_BLOCKED` / `NO_RERUN_PERFORMED`

本輪完成後停止，等待審查；不標記D1修復、Stage1完成、正式架構選定或REMOTE_D1_VERIFIED。
