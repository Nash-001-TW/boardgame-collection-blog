# P3 D3 隔離可行性與 EACCES 唯讀調查

2026-11-18（Asia/Taipei） · `D3_READONLY_INVESTIGATION_COMPLETE` · `RUNTIME_REMAINS_BLOCKED`

## 1. 結論

目前**不能證明已有可用的全程序樹非loopback egress強制限制**，也不能確定D1的EACCES由哪個機制造成。這不等於證明隔離不存在；是本次可讀證據不足。

本輪三項限縮系統查詢均未取得可用資料：防火牆profile摘要發生CIM錯誤；指定Security日誌查詢回LogInfoUnavailable；指定Defender日誌查詢被拒絕。各項均記UNKNOWN並停止，未重試、改用其他API或提權。沒有輸出完整規則、帳號、無關程序或原始事件內容。

可繼續設計`cf:false＋局部deny＋父程序停止`，但這不能被當成全程序樹強制隔離。在原硬性隔離要求不變的情況下，不建議直接批准下一次runtime。

本輪沒有啟動Node／Miniflare／workerd、建立listener、執行SQL、連線探測、遠端查詢、修改原型或系統設定。只新增本報告；Stage1及D1原始證據完整保留。

## 2. 調查範圍及方案名稱

承接`docs/P3-D2-isolation-and-loopback-readonly-review-20261118.md`及`docs/P3-stage1-runtime-diagnostic-result-20261118.md`。

使用者本次未另附A／B的新定義，因此本報告沿用D2第6節：

- **方案A：隔離修正先行**，包括判定保護強度、關閉已知外連與補足立即停止機制。
- **方案B：loopback診斷分離**，先收既有證據，必要時另批准一次runtime觀察或合成傳輸對照。

A、B不是互斥的正式架構候選；B的動態部分必須先滿足A的隔離要求。若審查中的A／B另有所指，不能將本報告的名稱映射當成新採納決策。

證據標記：CODE_CONFIRMED代表已有原始碼或保存結果直接支持；INFERRED代表推導；UNKNOWN代表未能證明。所有相對路徑基準為：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog`

## 3. 實際執行的唯讀查詢與結果

### 3.1 命令可用性

`Get-Command Get-NetFirewallProfile,Get-NetFirewallRule,Get-WinEvent,Get-NetTCPConnection`確認本機有NetSecurity、Microsoft.PowerShell.Diagnostics及NetTCPIP命令。**命令存在不代表有查詢權限或政策可讀。** 沒有因此執行全部命令；未查完整規則、目前TCP連線或其他程序清單。

### 3.2 防火牆摘要（一次）

```powershell
Get-NetFirewallProfile -PolicyStore ActiveStore -ErrorAction Stop |
  Select-Object Name,Enabled,DefaultOutboundAction,
    AllowLocalFirewallRules,AllowLocalIPsecRules
```

結果：`UNKNOWN`；exception type=`System.Management.Automation.MethodInvocationException`，FullyQualifiedErrorId=`CimException`。未取得任何profile資料。

此錯誤不足以分辨權限、CIM服務或受管環境限制，因此不直接寫成「防火牆拒絕存取」，也不認定防火牆關閉／開啟。未接著查Get-NetFirewallRule／registry／netsh／服務狀態以繞過此失敗。

即使profile摘要可讀，它也只能作初步資訊：DefaultOutboundAction不能單獨證明DNS、IPv4／IPv6、Node worker threads及native子程序皆受相同loopback例外保護，還須證明有效規則及政策作用範圍。

### 3.3 D1時間點WFP阻擋事件（一次）

UTC窗口：`2026-11-18T08:43:30.000Z`至`2026-11-18T08:44:40.000Z`，即台北16:43:30至16:44:40。涵蓋D1啟動08:44:08.576Z及binding錯誤08:44:11.203Z。

以Get-WinEvent -FilterXml限縮：Security，EventID 5157或5152，且EventData.DestAddress=`127.0.0.1`、DestPort=`6655`；MaxEvents=20。XPath條件如下：

```xml
<QueryList><Query Id="0" Path="Security"><Select Path="Security">
*[System[(EventID=5157 or EventID=5152) and
TimeCreated[@SystemTime&gt;='2026-11-18T08:43:30.000Z' and
@SystemTime&lt;='2026-11-18T08:44:40.000Z']]] and
*[EventData[Data[@Name='DestAddress']='127.0.0.1' and
Data[@Name='DestPort']='6655']]
</Select></Query></QueryList>
```

如有結果，原定只輸出UTC、事件ID、ProcessID、應用程式是否為node／workerd的布林值與固定目的地，不輸出Application完整路徑或帳號。

實際結果：`UNKNOWN`；exception type=`System.Exception`，FullyQualifiedErrorId=`LogInfoUnavailable,Microsoft.PowerShell.Commands.GetWinEventCommand`。沒有取得事件，亦沒有證明是「零筆命中」。停止此項，不切換其他Security讀取方法、不放大時間窗口、不開啟審計。

### 3.4 Defender限縮事件（一次）

Get-WinEvent -FilterHashtable：LogName=`Microsoft-Windows-Windows Defender/Operational`；Id=1121、1122、1125、1126；同一UTC窗口（轉換成DateTime後傳入）；MaxEvents=30。若可讀，只在記憶體篩選含node.exe／workerd.exe／127.0.0.1／6655的事件，僅輸出UTC及事件ID，無完整Message或XML。

實際結果：`UNKNOWN`；exception type及FullyQualifiedErrorId皆指出`System.UnauthorizedAccessException`（GetWinEventCommand）。停止此項，不換provider、API或權限。

即使這組ID可讀且未命中，也不能排除第三方端點防護、其他WFP規則或未記錄的政策；本次更未取得該種否定證據。

## 4. 三種保護不可混稱

| 類型 | 本次能證明什麼 | 缺口／判定 |
| --- | --- | --- |
| 全程序樹強制隔離 | 執行環境宣告network restricted；但未提供有效網路規則、loopback例外、子程序繼承或政策命中證據 | **UNKNOWN**。宣告不是本專案可獨立證明的Windows／受管政策驗收 |
| 應用程式局部攔截 | 原診斷global fetch wrapper及Worker outbound deny原始碼存在；D2已確認cf:false可關閉setupCf已知路徑 | **CODE_CONFIRMED局部能力**；自載Undici、顯式Pool、thread及native通道不因此全覆蓋 |
| 事後停止 | 原D1有60秒程序樹deadline及dispose，實際未逾時；尚無警告即IPC停止的實作 | **CODE_CONFIRMED現況**。警告後kill是後備，不是請求前封鎖 |

原D1觀察到workers.cloudflare.com解析失敗，說明有一次外部嘗試，不證明成功外連，也不證明DNS／TCP整體隔離策略。EACCES只針對當次loopback connect，不能反推「所有非loopback一定被擋」或「loopback一定全部禁止」。

全程序樹驗收至少需覆蓋：Node主程序、其worker threads、自載網路套件、native workerd及其後代；IPv4／IPv6、DNS與直接IP；policy在啟動前生效、子程序不可逃出、只允許所需loopback。現有查詢與原日誌不足以完成這項證明。

## 5. EACCES既有證據與根因分級

既有CODE_CONFIRMED：

- D1 endpoint為`http:`／`127.0.0.1`／`6655`；ready已返回。
- binding階段取得`TypeError: fetch failed`，cause=`Error: connect EACCES 127.0.0.1:6655`；stack經Miniflare自載Undici及worker eval。
- 沒有獨立code／errno等屬性可讀；不補造原始欄位。
- dispose成功，歷史process-stop.json記PID10880退出，當時無剩餘node／workerd。
- 沒有當時listener owner、WFP filter／policy命中、端點防護事件或同步native退出證據。

| 假設（INFERRED） | 本輪是否得到區分證據 | 目前結論 |
| --- | --- | --- |
| 受管執行沙箱拒絕本機TCP | 無policy命中／作用範圍資訊 | UNKNOWN，不歸咎特定sandbox機制 |
| Windows防火牆／WFP或端點防護拒絕 | profile／Security／Defender查詢未取得資料 | UNKNOWN，不能排除或確定 |
| listener在ready後消失／port owner變化／runtime重啟 | 原始證據沒有當時listener觀察 | UNKNOWN；事後查6655現況無法還原，故未查 |
| 埠保留／socket資源條件 | 本輪未查保留範圍，亦無其他原始證據 | UNKNOWN，不因port0或6655推定根因 |
| Node／Undici同步thread傳輸問題 | 已知故障路徑，但無主thread與worker-thread對照 | UNKNOWN；不能由alpha版本名稱直接認定缺陷 |

Request.cf的ENOTFOUND與loopback EACCES分開處理；沒有證據顯示前者造成後者。未取得新根因證據，不把本次UNKNOWN寫成「已排除Windows防護」。

## 6. 方案A／B可行性與授權需求

### 方案A：隔離修正先行

**可行部分（靜態證據）**：明確cf:false可避免setupCf的已知外連；維持telemetry off、無remote／upstream／registry；補上fatal IPC與父程序對專屬樹的停止。D2原始碼證據：`node_modules/miniflare/dist/src/index.js:132059`（cf傳遞）、`:78670`（早返）、`:119818`（顯式Pool）；`tests/p3-stage1/diagnose-runtime.mjs:40`、`:42`（原deny／只記log的缺口）。

**不可承諾部分**：上述不能證明全程序樹請求前阻擋。當前Windows政策又不可讀，所以不應把它直接當成符合原硬性隔離要求的方案。

**最小前置需求**：由環境提供者給出可公開／去敏的政策適用範圍證據，例如loopback例外、對Node及native子程序的繼承、DNS與IPv4／IPv6處理、啟動前生效方式；不要求使用者貼秘密或完整防火牆規則。若現有環境無法提供，另案審查隔離環境；本輪不建立或切換環境。

**授權**：任何測試檔／launcher修改、新root、preload、runtime啟動或環境切換都需明確授權。不能因D2審查通過視為已授權。若要求保護強度調整，必須由使用者明確決定，不能以「低風險合成資料」替代原限制。

### 方案B：loopback診斷分離

**本輪可做且已做**：限縮既有事件與policy摘要讀取；失敗停止，結果UNKNOWN。

**可候選但未授權**：在可證明隔離下，一次construct→ready→binding→dispose，旁路只記當次listener owner／native生命週期／cause；保留host127.0.0.1、port0及版本。若需要合成listener與主thread／worker-thread對照，必須再列成獨立測試，不能塞入這一次runtime。

**風險／缺口**：當前政策可能連loopback也拒絕；cf修正不保證解決EACCES；額外觀察可能改變時序；listener讀取權限也未證明可用。不能自動改host、port、版本、權限或用別的執行器來求通過。

**授權**：B的動態部分需另外批准具體檔案、次數、命令、觀察方式及停止條件，而且先滿足A。事件查詢目前已遇限制，不建議再以其他介面反覆重試。

## 7. 最小後續實作提案（未實作）

建議先補「隔離可證明性」而非再跑binding：

1. 取得上述去敏政策證據，確認是否存在可用的全程序樹邊界。若無，維持BLOCKED並審查其他隔離環境；不改本機權限。
2. 條件成立後，提出一次性測試檔與launcher的具體差異：cf:false、fatal IPC、同步最小去敏紀錄、父程序立即停止本次樹、60秒上限。明列每個網路通道的保護及未涵蓋部分，不把log hook標成pre-request deny。
3. 另列一次無SQL的runtime診斷授權單。必須指定新root且存在即停；原D1與Stage1不得覆寫。只取得binding也不進Stage1。
4. EACCES若仍存在，依新證據另決定是否值得做合成loopback傳輸對照；不自動進行。

本輪沒有產生或執行新腳本、SQL、listener、診斷root、系統規則或測試資源。

## 8. 證據保存與停止點

原始Stage1：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\.wrangler\p3-stage1\runs\P3S1-20261118-001`

原始D1：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\.wrangler\p3-stage1\diagnostics\P3D1-20261118-001`

本輪未寫入、刪除、搬移或清理上述目錄；未開啟sqlite。系統查詢的去敏結果及範圍已記於本報告，沒有另寫入原evidence。唯一新增檔案：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\docs\P3-D3-isolation-feasibility-and-eacces-readonly-review-20261118.md`

調查完成，停止等待審查。`FULL_TREE_EGRESS_ISOLATION_UNKNOWN`／`EACCES_POLICY_CAUSE_UNKNOWN`／`NO_DYNAMIC_EXECUTION`。不標記D1修復、Stage1完成或REMOTE_D1_VERIFIED。
