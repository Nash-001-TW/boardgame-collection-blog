# P3第一階段隔離執行單

2026-11-18（Asia/Taipei）。狀態：DESIGN_REVIEW_ONLY／EXECUTION_NOT_AUTHORIZED。

**本文件是未執行的計畫。** 本輪只有檔案／套件／路徑靜態盤點及Markdown整理。沒有建立下列原型、測試、SQL、設定或隔離目錄，沒有啟動Node／Miniflare／workerd，沒有操作任何DB、執行Migration或測試。P3-Review-01～05已採納，V2為第一驗證候選，非正式架構選型。

## 1. 環境、證據與隔離邊界

### 1.1 已讀取的本機證據

| 標記 | 發現 | path:line |
| --- | --- | --- |
| CODE_CONFIRMED | 專案要求Node>=22.12；宣告Miniflare 5 alpha與tsx；prebuild會執行Wrangler types | package.json:5、15、31、32 |
| CODE_CONFIRMED | node.exe存在；Windows檔案版本24.21.0.0，非本輪執行node --version取得 | D:/Program Files/nodejs/node.exe（Get-Command／檔案metadata） |
| CODE_CONFIRMED | 已安裝miniflare 5.20261006.1-alpha、workerd 1.20261006.1、tsx 4.23.15、wrangler 4.149.0 | node_modules/miniflare/package.json:3、node_modules/workerd/package.json:3、node_modules/tsx/package.json:3、node_modules/wrangler/package.json |
| CODE_CONFIRMED | Windows native workerd檔案存在，97,029,632 bytes | node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe；該package.json:16 |
| CODE_CONFIRMED | 既有helper直接建立本機Miniflare，隨機binding、獨立persist／tmp、telemetry off、outbound deny | tests/helpers/notbgg-local-d1.ts:8、14、16、17、18、20 |
| CODE_CONFIRMED | helper能解析多行trigger，將SQL用binding batch bootstrap；依cwd讀migration | tests/helpers/notbgg-local-d1.ts:26、38、46、47 |
| CODE_CONFIRMED | node:sqlite adapter手動BEGIN／COMMIT／ROLLBACK模擬D1 | tests/helpers/sqlite-d1.ts:1、25；不作本輪D1執行器 |
| CODE_CONFIRMED | 現有實體測試會建立Node SQLite及Auth／Astro fixture，不能不加審查直接整檔執行 | tests/physical-component-management.test.ts:7、45、46、47、89 |
| CODE_CONFIRMED | 舊release驗證腳本讀dist config及.env／.dev.vars，不符合本輪最小隔離 | scripts/validate-release-artifacts.mjs:12、25 |
| CODE_CONFIRMED | Miniflare本機型別有resourcePersistencePath、resourceTmpPath、telemetry、outboundService與remoteProxy設定；convertV4MiniflareOptions有export | node_modules/miniflare/dist/src/index.d.ts:205、364、379、989、991、999；index.js:37800 |
| CODE_CONFIRMED | 分類與proof原始碼可直接匯入，無dotenv／API fetch依賴 | src/lib/component-classifier.ts:280；component-classifier-adapter.ts:1、153；physical-component-proof.ts:11、16、20、25 |

UNKNOWN：上述套件存在不等於目前Windows sandbox能啟動native runtime、建立loopback服務或成功執行D1 batch。本輪未作啟動／版本執行／smoke test。待授權後若啟動失敗，停止並回報，不下載套件、不改用遠端、也不改以node:sqlite補成PASS。

### 1.2 建議唯一執行器

INFERRED：採**直接Miniflare本機D1 binding**，用現有已安裝版本的convertV4MiniflareOptions建構，binding名稱P3_TEST、值p3-stage1-synthetic-<run-id>。不用Wrangler CLI、Astro、npm／npx、已編譯dist或正式設定。

- runtime只載入最小無外連worker腳本文字，沒有production Worker、KV、R2、queue、Access、BGG token、remoteProxy或其他外部binding。
- 明定loopback host 127.0.0.1，若需要監聽則port 0隨機；不開瀏覽器、不做外部HTTP。native runtime的內部通道允許，Worker outbound全部拒絕且計數。
- JS控制流程不得使用fetch／http(s)／net進行外網請求；執行前靜態allowlist檢查import，執行時封鎖控制流程的fetch。不能封鎖Miniflare必要loopback通道而使其無法運作；禁止網路的保證範圍見第9節。
- 測試資料只有合成收藏／definition／copy／notes／map；簽章用記憶體中生成的至少32 bytes合成key，僅傳原proof函式，不列印／寫檔。不讀正式key，不mock成永遠verify=true。
- 分類器與HMAC直接用既有src三檔；不複製或改寫分類演算法。測試中新增guard SQL與假想未來目前值／事件表只能位於本次隔離DB，不加入正式migration。
- 舊V1表若由既有0001～0022建立於隔離DB，只為既有分類器的合成來源。不得DROP舊表、去v2_前綴或順帶測試退役方案。

本機Miniflare結果只能寫LOCAL_D1_COMPATIBLE，不寫REMOTE_D1_VERIFIED／PRODUCTION_READY。套件版本相近不保證遠端D1一致。

## 2. 預計新增檔案、設定與資源（本輪均未建立）

以下全部位於可寫專案內。預定固定run-id為P3S1-20261118-001；若已存在，停止並人工選全新run-id，不覆寫、不清空既有資料。

### 2.1 未來測試專用原始碼

| 完整路徑 | 用途 |
| --- | --- |
| D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/runner.mjs | 啟動前路徑／env／import檢查，僅phase1；啟動唯一測試child、timeout、收集證據 |
| D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/local-runtime.ts | 建立／dispose Miniflare，binding與outbound防護，沒有Wrangler config discovery |
| D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/trusted-snapshot.ts | 後端快照擷取與原adapter結果關聯，保留來源hash，不重寫分類 |
| D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/stage1.test.ts | 僅第4～6節子案例；node:test，concurrency1 |
| D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/sql/stage1-only.sql | p3_s1_*測試表／約束／guard／合成delta；不是正式migration |
| D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/tsconfig.json | 僅測試TypeScript轉譯設定，不含env或Cloudflare遠端配置 |

只允許新增這6檔，不修改src、既有tests／helper、package.json／lock、wrangler.json、正式migration、.env或.dev.vars。若原型實作需要超出清單，先列差異，不自行改產品原始碼。

### 2.2 單次執行隔離root

完整root：D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/.wrangler/p3-stage1/runs/P3S1-20261118-001/

其下預計：

- state/：只含本次Miniflare本機資料，禁止指向既有.wrangler/state。
- tmp/：所有測試及workerd暫存。
- home/、config/、cache/、appdata/、localappdata/：隔離home／工具設定目錄，不拷貝使用者現有認證。
- schema-input/0001_sleeve_management.sql ～ 0022_bgg_sync_and_relations.sql：只複製目前22個既有migration原文，用作合成DB結構bootstrap；記SHA256，不複製資料庫備份或原始收藏輸入。
- evidence/manifest.json、cases.json、summary.md、stdout.log、stderr.log、query-trace.ndjson、network-denials.ndjson、before-after.json：本次證據。

上述相對子路徑全部解析到該固定root。runner啟動時列出實際絕對路徑與無reparse-point檢查結果。新增檔案／state預估大小未知，後續測量，不聲稱容量已驗證。

### 2.3 Schema bootstrap邊界

待授權後，在全新本機DB執行22份既有SQL的拷貝作schema bootstrap，必要時在0012前插入合成舊來源。這是**一次性測試DB內的DDL／DML執行**，須明確包含在第一階段授權中；不是呼叫migrations apply、更不是套用正式Migration。無d1_migrations真實ledger、無正式備份、無V1退役／rename。

可重用helper的migrationStatements解析器，不能天真用分號切trigger；不直接呼叫migrateIsolatedD1，因它從cwd隱含發現migration。改用本次manifest明列且hash核對的22檔，schema bootstrap與測試candidate guard分開標示。若遇parser不支援，停止，不修改歷史SQL消除錯誤。

## 3. 預計完整命令與工作目錄（尚未執行）

### 3.1 唯一對外執行入口

PowerShell 7（本輪讀取PSVersionTable為7.6.9）；工作目錄：D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog。
以下命令只可在使用者授權建立原型及執行第一階段後使用。它會建立隔離root，所以本輪未執行。

```powershell
$p3Workspace = 'D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog'
$p3RunRoot = Join-Path $p3Workspace '.wrangler\p3-stage1\runs\P3S1-20261118-001'
if (Test-Path -LiteralPath $p3RunRoot) { throw 'Run root already exists; do not overwrite.' }
$p3ResolvedWorkspace = (Resolve-Path -LiteralPath $p3Workspace -ErrorAction Stop).Path
if (-not [IO.Path]::GetFullPath($p3RunRoot).StartsWith(
    $p3ResolvedWorkspace.TrimEnd('\') + '\.wrangler\p3-stage1\runs\',
    [StringComparison]::OrdinalIgnoreCase)) { throw 'Run root outside permitted base.' }
$p3Ancestor = [IO.Path]::GetDirectoryName($p3RunRoot)
while ($p3Ancestor) {
    if (Test-Path -LiteralPath $p3Ancestor) {
        $p3AncestorItem = Get-Item -LiteralPath $p3Ancestor -Force -ErrorAction Stop
        if (($p3AncestorItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Reparse point in run root ancestry; stop.'
        }
    }
    $p3Ancestor = [IO.Path]::GetDirectoryName($p3Ancestor)
}
if (-not (Test-Path -LiteralPath (Join-Path $p3Workspace 'tests\p3-stage1\runner.mjs'))) {
    throw 'Approved prototype has not been created; stop.'
}
New-Item -ItemType Directory -Path $p3RunRoot -ErrorAction Stop | Out-Null
foreach ($p3Subdir in @('tmp','home','config','cache','appdata','localappdata','evidence')) {
    New-Item -ItemType Directory -Path (Join-Path $p3RunRoot $p3Subdir) -ErrorAction Stop | Out-Null
}
$p3Start = [System.Diagnostics.ProcessStartInfo]::new()
$p3Start.FileName = 'D:\Program Files\nodejs\node.exe'
$p3Start.WorkingDirectory = $p3RunRoot
$p3Start.UseShellExecute = $false
$p3Start.CreateNoWindow = $true
$p3Start.Environment.Clear()
foreach ($p3Name in @('SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PROCESSOR_ARCHITECTURE')) {
    $p3Value = [Environment]::GetEnvironmentVariable($p3Name)
    if ($null -ne $p3Value) { $p3Start.Environment[$p3Name] = $p3Value }
}
$p3Start.Environment['PATH'] = 'D:\Program Files\nodejs;' + (Join-Path $env:SystemRoot 'System32')
$p3Start.Environment['TEMP'] = Join-Path $p3RunRoot 'tmp'
$p3Start.Environment['TMP'] = Join-Path $p3RunRoot 'tmp'
$p3Start.Environment['HOME'] = Join-Path $p3RunRoot 'home'
$p3Start.Environment['USERPROFILE'] = Join-Path $p3RunRoot 'home'
$p3Start.Environment['APPDATA'] = Join-Path $p3RunRoot 'appdata'
$p3Start.Environment['LOCALAPPDATA'] = Join-Path $p3RunRoot 'localappdata'
$p3Start.Environment['XDG_CONFIG_HOME'] = Join-Path $p3RunRoot 'config'
$p3Start.Environment['XDG_CACHE_HOME'] = Join-Path $p3RunRoot 'cache'
$p3Start.Environment['CI'] = 'true'
$p3Start.Environment['WRANGLER_SEND_METRICS'] = 'false'
foreach ($p3Arg in @(
    (Join-Path $p3Workspace 'tests\p3-stage1\runner.mjs'),
    '--workspace', $p3Workspace,
    '--run-root', $p3RunRoot,
    '--phase', '1',
    '--runtime', 'miniflare-local',
    '--offline',
    '--allow-synthetic-bootstrap',
    '--retain-state'
)) { $p3Start.ArgumentList.Add($p3Arg) }
$p3Process = [System.Diagnostics.Process]::Start($p3Start)
try {
    if (-not $p3Process.WaitForExit(900000)) {
        $p3Process.Kill($true)
        throw 'Phase 1 timed out; stopped. Preserve evidence; do not infer rollback.'
    }
    if ($p3Process.ExitCode -ne 0) { throw ('Phase 1 stopped with exit code ' + $p3Process.ExitCode) }
} finally { $p3Process.Dispose() }
```

這不是把HOME系統變數拿來當任務暫存變數；是在**新子程序環境**明確指定隔離home，不更改目前shell或使用者設定。env使用allowlist，故無CLOUDFLARE_*、JWT、BGG token、proxy、NODE_OPTIONS／NODE_PATH或正式binding繼承；不讀／輸出其原值。

### 3.2 runner允許的唯一測試child

FileName固定為D:/Program Files/nodejs/node.exe，cwd固定為上述runRoot，shell=false、windowsHide=true，繼承同一allowlist環境。ArgumentList（均為獨立引數）：

```text
D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/node_modules/tsx/dist/cli.mjs
--tsconfig
D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/tsconfig.json
--test
--test-concurrency=1
--test-reporter=tap
D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/stage1.test.ts
```

runner負責stdout／stderr串流存到evidence，不把Process輸出等到結束才讀而造成pipe deadlock。phase1只跑固定案例ID，不透過glob載入整個tests。runner只可啟動此Node child；Miniflare只可啟動已安裝的native workerd，不允許npm install、npx、Wrangler、Astro、任何remote或部署子命令。

UNKNOWN：這些是待建立腳本的介面設計，不宣稱runner已存在或命令已成功。實際子程序版本須在授權後記錄；若tsx參數／API不同，停止列差異，不偷偷改執行器。

## 4. G-01／G-05／G-08具體資料、操作與驗收

### 合成baseline

合成收藏C1、其他收藏C2；副本A在藏未封膜、B借出；兩筆不同card定義D1／D2，另有一本booklet D3。D1 actual=0、D2 actual=100、D3 actual=1，checked與合法過去日期；expected各不同，證明expected不影響完成。來源以既有physicalSourceMessage／signPhysicalValue產生，actor固定p3-synthetic-admin（不是ADMIN_EMAIL或真JWT）。另建一筆完整migration proof的LEGACY_PRODUCT與可歸屬UNKNOWN作排除／U對照。所有ID、名稱、日期皆合成，並標記SYNTHETIC。

不匯入現有私人JSON或正式SQL備份。p3_s1_*表只模擬candidate目前判定／事件／結果關聯，明示不是正式Schema。副本／定義fixture可使用既有v2_*隔離表，不更名。

| ID | 操作 | 成功／預期拒絕條件 | 回滾證據／停止條件 |
| --- | --- | --- | --- |
| G01-A | 快照後新增一筆本收藏適用definition，再送舊快照 | 舊確認拒絕，不能用舊N／M／U | 外部合成新增仍在；被拒請求的actual、日期、事件、結果關聯均不變。任何局部寫入即FAIL停止 |
| G01-B | 既有證據等量替換map、其他definition新增競爭notes；總列數保持不變 | 必須偵測內容／映射差異，不能只靠COUNT／MAX ID | 被拒請求業務狀態hash不變；沒有把證據失效默認成功 |
| G01-C | 修改另一組件count_revision／數量／日期，或適用例外／範圍值 | 所有被判定實際依賴的輸入變化可被捕捉 | 不自動換版本／key重送；清楚記GUARD_REJECTED且證明未提交 |
| G01-D | 不變baseline提交 | 成功一次，預期N／M／U及日期，事件／結果指向一致 | guard永遠拒絕不可算PASS；沒有正向對照則STOP |
| G05-A | 故意讓條件UPDATE命中0列，先做未加失敗guard的負向對照 | 對照須證明零列本身不必然使batch失敗（僅隔離DB） | 記negative-control結果，不拿對照當可用原型；若runtime語意不同如實記錄停止分析 |
| G05-B | 同樣零列，加明確NOT NULL／約束失敗守衛，且前面已有合成寫入 | batch拒絕，所有本次寫入回滾 | DB前後列／value hash、事件數／結果數、錯誤分類，任一殘留FAIL |
| G05-C | guard通過後，於事件或結果寫入故意觸發約束失敗 | 仍整批回滾；不能把guard通過報成已提交 | 清點、日期、例外、事件與結果均無殘留；結果未知不當回滾證據 |
| G08-A | 1、120、1000個合成集合成員，用少量JSON bind參數比對 | 確實執行到guard並正確比對，不是用placeholder個數推容量 | 記參數數／輸入bytes／SQL bytes／耗時；容量結論只限本案例 |
| G08-B | NULL對缺列、integer對text、actual0、checked NULL、非checked有效數量 | 嚴格遵守M及資料語意，不默默轉型補值 | 逐項預期差異可觀察；非法fixture若被DB先拒絕則標schema rejection，不能當guard已測 |
| G08-C | 注入比較manifest重複ID、JOIN放大／來源歧義；EXCEPT去重反例 | 去重不能吞歧義；明確拒絕無效manifest或標可歸屬UNKNOWN | 不為造重複破壞正式PK；使用candidate投影／fixture JOIN，記分層結果 |
| G08-D | proof原始notes含重複root key／不同數字拼法，及字串等價但raw不同 | 使用原分類器判斷，不以json_extract替代；完整比對不錯過實際依賴 | 若只格式差導致保守衝突可接受但須記錄；錯誤放行FAIL |

G08數量均控制在合成全域證據10000上限內；如果fixture構成導致超限，記UNAVAILABLE並調整尚未執行的計畫，不把超限當容量guard成功。10001全域超限與驗證環境全套G06留後續階段，不偷偷擴成整輪回歸。

## 5. 一致性快照最小案例（SNP-01／02，併入G01）

**目的：不是證明兩個JSON相等，而是證明原JS分類器／HMAC實際使用的證據，確實就是提交guard保護的輸入。**

INFERRED候選：可信測試DB wrapper接收原adapter實際發出的證據SELECT（不複製投影或分類演算法），把它作為一個單語句的子查詢／CTE，連同本副本局部清點、適用、範圍資料一併擷取成server-owned manifest；向原adapter回傳該manifest內的原證據列，局部值交整盒candidate，保留exact raw notes／型別。manifest在後端建立且不可由測試HTTP／瀏覽器覆寫。

- 若此包裝無法在既有Miniflare／SQL中保持原查詢語意，標BLOCKED並停止，不改分類器、不退回未證明的多次查詢拼接。
- manifest內每項證據需能追溯query index、row id、讀取雜湊與分類輸出；HMAC只呼叫現有proof函式。合成key不寫manifest，signature也不放一般stdout；內部測試證據以hash／識別記錄。
- SNP-01：在manifest讀取後、HMAC完成前，以明確barrier改DB來源／其他清點值。adapter仍只用原manifest；提交guard必須發現改變並拒絕。不能把新rows替換進原manifest後假稱一致。
- SNP-02：負向對照刻意拼接互相不一致、無法對應提交時狀態的證據與局部值，再由來源關聯／完整guard拒絕；不能只斷言query次數等於1。若不同時間的值恰好與提交時完整狀態一致，不應只因時間不同就要求拒絕；測試必須構造可證明不一致的情境。正向對照無改變須能提交。
- 至少包含「可歸屬UNKNOWN與LEGACY_PRODUCT存在」的全集對照，不能只擷取R06 token清單。保護投影必須涵蓋所有原分類用欄位，未覆蓋者列缺口而非PASS。

UNKNOWN：此方案待原型與隔離驗證；沒有單語句manifest的實測證據。第一階段若只通過G08但SNP未證明，結論須為V2核心尚未成立。

## 6. 自身授權變更最小案例（SELF-06／07，併入G04最小子集）

本階段只測單次操作的前置guard與授權delta，不做多程序真並行、多副本容量或完整S6／S7產品流程。

| 案例 | 合成操作 | 預期 |
| --- | --- | --- |
| SELF-06 | 基本3項已清點的A／B；新增繁中說明書D4，同次指定A不適用、B適用 | guard比較操作前輸入；同批建立D4／source／例外／初始歷史並按最終集合判定。A N=3 M=3無完成轉換；B N=4 M=3寫失去完成；無組件清點事件、無先全適用再排除的假歷史 |
| SELF-07 | 既有4筆definition，新增副本C，同次排除繁中說明書 | 新C N=3 M=0 U=0，首次未完成不寫失去；不複製A／B值或日期；沒有先N=4的已提交中間結果 |
| SELF-NEG | manifest後另操作新增一個副本（S6）或定義（S7），但非本次授權delta | 拒絕過期確認，不把外部新增混成自己的合法delta；整筆rollback |

若使用者尚未要求建正式S6／S7流程，本次只允許測試用候選SQL與p3_s1_*狀態表，不修改產品API白名單。因現有immutable source約束，新定義fixture仍須由既有proof函式正確簽章，不能刪trigger／關閉FK來讓測試通過。

## 7. 成功、拒絕、回滾與全局停止條件

- PASS：有正向提交對照、預期拒絕對照、before／after業務狀態證據及對應guard／結果關聯，所有固定案例符合語意。
- EXPECTED_REJECT：有可信錯誤及完整回滾驗證；不僅是返回409／拋exception。約束失敗需在本機D1 binding取得，不靠node:sqlite模擬。
- UNKNOWN_RESULT：通信／程序中斷，不能推定回滾；保留state與所有證據，停止該run，不自動新key／新版本重跑。第一階段不實作C1／C2，也不以測試結果表當正式冪等契約已完成。
- FAIL_STOP：原型放行舊集合、部分業務殘留、證據無法綁定、不可用被當U、或錯誤完成事件。第一個此類錯誤後不繼續擴大案例，先報告。
- ISOLATION_STOP：意外非loopback連線、remote binding、讀正式環境檔／備份、路徑逃逸／reparse point、觸及既有state、需要安裝／升級／登入／修改src，立即停止。即使該網路請求被阻擋也記錄與停止，不能當正常通過。
- 環境啟動或bootstrap失敗為BLOCKED，不改成SQLite替代PASS、不提權自動解限制；必要權限差異另報。
- 每案例上限60秒，整run上限15分鐘；達上限停止本次child及其native子程序，不終止使用者其他Node／workerd。timeout不宣稱DB已回滾。
- 不自動進第二階段G03／G04全套／G09、G06／G07／G10或V1 G02。只包含明列的snapshot及SELF最小子集。

## 8. 證據、版本及結果保存

manifest須記：run-id、Asia/Taipei與UTC時間、workspace／source realpath、Git HEAD與工作區dirty摘要、6個新增檔案hash、3個實際src分類／proof hash、22份schema輸入hash、package-lock hash、實際Node／Miniflare／workerd／tsx版本、OS架構、binding合成名稱、cwd、env允許**名稱**（不列原值）、remoteProxy不存在、KV數0、outbound deny啟用、測試專用設定摘要。

cases.json每子案例記SETUP／ACTION／EXPECTED／OBSERVED／PASS／FAIL／BLOCKED／UNKNOWN、guard結果與最終提交結果分開、各SQL影響列與batch是否拒絕、before／after count及必要合成值hash、原snapshot來源關聯及事件精確ID。結果表若保存不含N／M／U，不准從目前值補原結果。query-trace只記合成SQL模板／參數型別／數量／hash／耗時，不列key或秘密。

stdout／stderr即時保存，report不能只留最後PASS；fixture初始化與被測業務操作分別統計rows written。本階段隔離DB有寫入屬預期，但正式DB連線數須0（以無remote配置／無credential／無遠端呼叫路徑的防護與紀錄支持，不偽稱已做OS全面封網審計）。

所有輸出附LOCAL_D1_COMPATIBLE、NOT_REMOTE_D1_VERIFIED。無原prototype跑出的數字前不填耗時／容量、不保證所有案例能完成。

## 9. 清理與意外連線防護

### 執行前與執行中

- 啟動器從白名單環境建立process，連NODE_OPTIONS也不繼承，避免啟動前注入；不讀root wrangler.json、.env、.dev.vars、dist、backups、imports、既有D1 state。
- 只許可分類三檔與migration parser等已列來源，新增import須檢查完整依賴；不直接import產品API、Astro preview、release script或auth fixture。
- Miniflare僅inline script、合成D1 binding、local persistence；禁止remoteProxyConnectionString、upstream、KV／其他binding、外部modules。outboundService deny只保護Worker outbound，不是整個OS防火牆；Node parent以無外網功能與env隔離降低風險，不能宣稱阻止所有native惡意連線。若要求OS級強隔離，需另設斷網sandbox，不能假裝本計畫已做到。
- 外部網路嘗試即停；loopback僅本run runtime必要連線。證據檢查不得為證明隔離而實際發Cloudflare請求。

### 結束後

- finally只dispose本run Miniflare及child，釋放檔案；先保留完整state／tmp／logs供審查，不在測完自動recursive delete。
- 本階段批准不包含刪除既有資源。後續若清理，只准本runRoot的state／tmp／隔離home等可重建資料；先驗證絕對realpath仍在固定runRoot、無junction／symlink，檔案屬本run manifest，無程序使用，再用PowerShell Remove-Item -LiteralPath，禁止跨shell拼接刪除命令。
- evidence與6檔測試原始碼先保留。不得清理根.wrangler/state、私人備份、node_modules、其他run、V1表或rename表。若這次失敗，留下失敗證據，不清空後假裝首次成功。

## 10. 尚待使用者一次授權的具體動作

以下均**未授權、未執行**：

1. 新增第2.1節6個測試專用檔案及candidate SQL／設定，不改產品src／正式migration。
2. 建立指定runRoot與隔離目錄，拷貝22份既有schema SQL作只讀輸入副本。
3. 啟動已安裝Node／tsx／Miniflare／workerd、必要loopback通道；不安裝套件、不登入、不呼叫Wrangler或網路。
4. 在全新合成Miniflare D1內執行schema bootstrap、fixture DDL／DML及第一階段固定案例，容許測試專用表／trigger／約束／故障注入。
5. 將證據寫入runRoot／evidence，保留隔離state；完成後dispose本run進程並停止，不進後續階段。

建議授權文字（只供審查，未視為使用者已同意）：

> 同意依此執行單建立6個測試專用檔案與指定隔離目錄，使用本機Miniflare及合成資料執行第一階段G01／G05／G08與SNP／SELF最小案例。允許一次性隔離DB的DDL／DML／schema bootstrap及候選guard，不允許正式資源、產品src／migration修改、安裝套件、遠端驗證或自動進下一階段。保存完整證據；遇隔離／一致性失敗立即停止回報。

本輪準備完成後停止等待此範圍的一次確認。不重問已採納業務規則，也不將V1退役／表名正規化納入本輪。
