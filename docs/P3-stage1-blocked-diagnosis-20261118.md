# P3 Stage 1 BLOCKED：既有證據唯讀故障診斷

日期：2026-11-18（Asia/Taipei）。Run：P3S1-20261118-001。

本輪授權只有唯讀分析與本Markdown交付。沒有重跑Stage1、建立新runRoot、修改六個原型／套件、啟動Node／Miniflare／workerd、開啟SQLite、查DB、提權、網路連線或清理證據。下列新命令／診斷腳本均只是待批准方案。

## 1. 結論：可定位故障通道，仍不能確認底層根因

**CODE_CONFIRMED：第一個保存下來的原始錯誤，是Miniflare內部Undici產生的`TypeError: fetch failed`。** 它發生於取得本機D1 binding所需的同步proxy bridge通道，而不是Schema、candidate guard或SQL執行。

**CODE_CONFIRMED：錯誤記錄沒有保存`cause`。** 原型只寫`String(e)`與`e.stack`；Undici在此路徑原本會以`new TypeError('fetch failed', { cause: response.error })`建立錯誤。現在證據無法還原response.error中的code／syscall／address／port等，因此不能聲稱已找到完整底層cause chain或OS根因。

**INFERRED：優先調查本機runtime entry的連線／transport失敗。** 已安裝Miniflare程式指出該proxy URL以runtime entry URL建立；設定host為127.0.0.1、port=0（由runtime分配）。本次未保存實際URL／port或native process日誌，不能把候選原因提升為已確認。

BLOCKED維持不變。16個業務子案例皆未執行；此結果不支持採納或否定V2完整比對方案。

## 2. 本輪讀取與完整性

已讀docs/P3-stage1-execution-result-20261118.md，以及原evidence的manifest、stdout、stderr、summary、cases、network-denials、bootstrap-error、runtime-stop、launcher、process-stop-check；亦讀started.json、檔案時間metadata及測試／Miniflare／Undici相關原始碼。

對manifest記錄的11檔重新Get-FileHash比較（六原型、三分類／proof產品來源、既有helper、package-lock），均相符。這支持目前檢視的原型與原run一致；不把它當所有node_modules已做事前後逐檔比對。node_modules診斷係根據目前安裝內容與原stack對照，不曾執行它。

原證據prefix：

`D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/.wrangler/p3-stage1/runs/P3S1-20261118-001/`

| 證據 | 觀察 |
| --- | --- |
| evidence/manifest.json | runner20048、child9072，Node24.21.0、Miniflare5.20261006.1-alpha、workerd套件1.20261006.1、tsx4.23.15；exit1，sourceChanges=[] |
| evidence/stdout.log | 1226 bytes，總控TAP失敗；TypeError stack含Miniflare內建Undici與`[worker eval]:35:22` |
| evidence/stderr.log | 0 bytes；不代表native runtime沒有出過任何錯誤，只是這份stderr沒有記錄 |
| evidence/bootstrap-error.json | 806 bytes，只有error、stack兩個property，沒有cause／errors／code／endpoint |
| evidence/cases.json | 16項皆BLOCKED，沒有started時間；未進saveCase |
| evidence/runtime-stop.json | disposed=true、denied=0、queries=0、bootstrapRowsWritten=0、testRowsWritten=0 |
| evidence/network-denials.ndjson | 0 bytes；只能說已安裝的兩個deny logger沒有寫到事件，不能排除Miniflare內部transport失敗 |
| evidence/before-after.json | 空陣列，無守衛／rollback證據 |
| evidence/summary.md | BLOCKED_OR_FAILED是原run簡略標籤；按階段／case證據精確分類為BLOCKED |
| state/cache及state/d1的metadata.sqlite與sidecars | 顯示runtime有局部初始化痕跡；本輪只看檔案metadata，沒有開DB |

## 3. 發生階段與呼叫鏈

### 3.1 測試程式路徑（CODE_CONFIRMED）

1. `tests/p3-stage1/runner.mjs:36`附近：以已安裝tsx CLI啟動單一test child，shell=false、隔離cwd／env。
2. `tests/p3-stage1/stage1.test.ts:68、70`：先保存空案例結果，然後`await openLocal()`；第一個`saveCase`在其後。
3. `tests/p3-stage1/local-runtime.ts:17、18`：建立state目錄、Miniflare設定，inline worker、合成P3_TEST、loopback、port0、獨立persist／tmp、telemetry=false、outbound deny。
4. 同檔:22：`await runtime.getD1Database('P3_TEST')`。此時db wrapper、schema-input讀取與bootstrap尚未開始（:23～30在其後）。
5. 同檔:33：捕捉錯誤後`dispose()`，再重新拋出同一錯誤。
6. `stage1.test.ts:87`：rt尚未成功賦值、startedCase=false，把16項列BLOCKED；只保存error及stack，之後拋給node:test。

### 3.2 Miniflare與Undici靜態路徑

以下`node_modules/miniflare/dist/src/index.js`行號為本機安裝bundle；不是遠端文件推測：

| 路徑 | 程式證據 | 結論 |
| --- | --- | --- |
| getD1Database → #getProxy | :135240、135163 | binding取得透過proxy，不是直接從Node回傳SQLite連線 |
| _getProxyClient | :135100～135106 | 先等待ready及同步bridge warm |
| proxyClient.env[binding] | :135171 | 讀取proxy property會觸發同步GET |
| ProxyStubHandler GET → bridge.sync.fetch | :120360～120367 | 對bridge URL發POST，headers包含內部操作資訊；本報告不輸出內部secret header值 |
| SynchronousFetcher worker | :119792～119828、119906 | 在worker_threads的eval script中自行createRequire並載入`undici`的Pool／fetch，不是測試主程序的global fetch |
| bridge fetch的catch與傳回 | :119844～119849、119936～119948 | 先嘗試以MessagePort傳Error；若不可序列化才退化成new Error(String(error))，主程序再throw。此次究竟走哪種序列化未保存分支記錄 |
| ProxyClient bridge URL | :120019～120022、120046～120047 | URL由runtimeEntryURL與平台proxy路徑組成 |
| runtime entry URL | :134671～134684 | 從runtime回報的entry socket port與可用host構造，而非從正式D1網址構造 |

Undici原始碼：

- `node_modules/miniflare/node_modules/undici/lib/web/fetch/index.js:237`：network error response使Promise reject為`TypeError('fetch failed', {cause: response.error})`。
- 同檔:1081：排入processResponse的microtask，與原stack相符。
- `node_modules/miniflare/node_modules/undici/index.js:152～161`：fetch wrapper補／捕獲stack後重新throw，並非此處判定Cloudflare認證失敗。
- `[worker eval]:35:22`與Miniflare嵌入的同步fetch worker呼叫位置相符。這是庫內部worker thread，不是瀏覽器或應用worker的對外API請求。

INFERRED：若此stack確實由上述# getProxy property路徑產生，ready與warm已走到足以開始proxy GET；因此不能籠統稱node或workerd完全沒有啟動。但沒有native PID／ready URL的直接紀錄，不能進一步宣稱native socket已正常可連或D1 binding已完成。

## 4. 可還原的cause chain，以及不可還原部分

```text
Node test總控失敗（ERR_TEST_FAILURE，報告層包裝）
  └─ 原始TypeError: fetch failed
       ├─ Undici processResponse → Promise reject
       ├─ Miniflare synchronous-fetch worker／MessagePort傳播
       └─ cause: response.error
            └─ 未保存；可能有code／syscall／address／port或AggregateError.errors
```

這是「完整列出可確認的鏈與缺口」，不是冒稱已恢復完整cause。不能從一般stack文字逆推出ECONNREFUSED、EPERM、EACCES、ECONNRESET、DNS或其他代碼。

已確認的診斷缺口：`stage1.test.ts:87`的JSON只包含String(e)與stack。`local-runtime.ts:33`沒有序列化原錯誤的cause。node:test這份TAP也沒有列cause。即使MessagePort最初保留了cause，後續這個JSON記錄方式仍會漏掉它；如果上游曾採fallback簡化Error，則更早就可能遺失。無法由目前證據分辨兩者。

## 5. 程序與事件時間順序

除另註外，以下為檔案內UTC事件時間，不將檔案最後寫入時間當成原錯誤發生時間。台北時間為UTC+8。

| UTC／台北 | 事件 | 證據與限制 |
| --- | --- | --- |
| 08:30:25.6446732／16:30:25.6446732 | launcher記錄runner20048 | launcher.json；表示launcher取得Process，不等於child已開始 |
| 08:30:25.837／16:30:25.837 | runner寫started marker | started.json |
| 08:30:26.524／16:30:26.524 | runner建立manifest版本／hash資料 | manifest.startedUTC |
| 08:30:26之後，精確時間未記 | spawn child9072；tsx／node:test載入 | manifest.childPid及command；沒有child開始事件timestamp，不能使用manifest最後mtime回推 |
| 約08:30:31.336～31.400 | cases與before-after首次落盤 | filesystem CreationTimeUtc；僅輔助確認進入測試main前置persist，不是精確程序事件時間 |
| 約08:30:34.323～34.351 | cache／D1 metadata檔初始化 | filesystem metadata；不是schema bootstrap查詢證據 |
| dispose之前，精確時間未記 | getD1Database的fetch拋錯 | local-runtime順序＋原stack；不能用bootstrap-error.json寫入時間當拋錯時間 |
| 08:30:34.702／16:30:34.702 | runtime.dispose完成後寫stop紀錄 | runtime-stop.json；queries／rowsWritten均0 |
| 約08:30:34.706 | 外層保存bootstrap-error | filesystem CreationTimeUtc；因catch先dispose再throw，錯誤檔比stop晚是正常順序，不是dispose造成原錯誤 |
| 約08:30:34.716 | summary落盤，然後node:test輸出失敗 | summary metadata與程式順序 |
| 08:30:34.809／16:30:34.809 | runner記child exit1、childStopped=true | manifest.finishedUTC；更新檔案mtime稍後，不是額外執行 |
| 08:31:21.372615／16:31:21.372615 | 上一輪檢查runner／child不存在、node／workerd皆空 | process-stop-check.json。本輪未啟動或停止程序，也未把歷史檢查冒充即時檢查 |

TAP總控duration約3389.93ms，整個node test程序約6888.28ms。沒有60秒案例timeout或15分鐘launcher timeout跡象；不把它判為計畫超時停止。

## 6. 根因分級

### 已確認（CODE_CONFIRMED）

- 故障位置：本機Miniflare的同步proxy bridge fetch，於getD1Database回傳前。
- 初始schema／candidate SQL／16子案例沒有執行；沒有guard失敗／rollback測試結果。
- 沒有保存完整cause與實際endpoint，是本次無法確認底層根因的直接可觀察原因。
- 測試主程序globalThis.fetch防護（local-runtime.ts:15）不覆蓋Miniflareworker thread自載Undici fetch（bundle:119805）。network-denials空不能當作內部HTTP通道無失敗的證明。
- 原錯誤文字不是我們防護層會拋的`ISOLATION_STOP external fetch`或`ISOLATION_STOP Worker outbound`，且denied=0；沒有證據證明由已安裝的兩個deny hook主動拒絕造成。

### 可能原因（INFERRED，無排序定論）

| 假設 | 與現況相容的理由 | 尚缺什麼 |
| --- | --- | --- |
| 本機runtime entry連線遭拒或listener非預期關閉 | synchronous bridge是HTTP transport，Undici回network error | 原始cause code、host／port、listener ready與exit事件 |
| 本機安全限制阻擋worker-thread/native loopback通道 | 授權環境可能限制部分連線；主程序fetch hook不涵蓋該通道 | EACCES／EPERM等cause或對應系統證據；現有記錄沒有，不能直接怪sandbox |
| Miniflare／workerd／Undici的啟動或URL／proxy生命週期問題 | bundle在ready後更新runtimeEntryURL並從worker thread取proxy，存在可診斷的生命周期 | 實際readyURL、版本相依、native stderr／structured log及時間戳；alpha字樣本身不是缺陷證明 |
| loopback位址／分配port的解析或協定不符 | host127.0.0.1、port0需要轉成有效entry地址 | 實際URL／port與cause；不能因配置port0就推測實際連的是port0 |

### 不支持或本輪無法推論

- 沒有SQL syntax／FK／guard或migration錯誤證據；程式未走到該處。
- 沒有正式D1／Access／Cloudflare token錯誤證據；配置為本機binding且未執行Wrangler，不能用重新登入來修此錯誤。
- 沒有證據證明父程序移除proxy環境變數必然造成問題；不能為此恢復正式認證或外部proxy。
- metadata.sqlite存在不等於業務D1已ready或Migration已執行。
- 無node_modules事前逐檔hash，不能由本輪靜態閱讀證明原run時所有套件內容完全一樣；原manifest僅記套件版本與package-lock。

## 7. 設定審查與紀錄改善候選

原型配置維持inline worker、單一P3_TEST、無remoteProxy／KV／正式設定，state／tmp均在指定root。runner env白名單、child cwd及固定測試檔也符合計畫；未看到可直接證實的「誤連正式DB」設定。

最需要補的不是放寬隔離，而是可觀察性：

1. 在new Miniflare前後、await ready前後、getD1Database前後及dispose前後記錄階段與monotonic／UTC時間。
2. 保存遞迴error.cause與AggregateError.errors，以及白名單name／message／stack／code／errno／syscall／address／port；循環引用與深度上限；不列headers、認證、完整env或PROXY_SECRET。
3. 經公開ready getter取得經確認為loopback的protocol／host／port，非loopback立即停，不發探測請求。已安裝型別有`get ready(): Promise<URL>`：node_modules/miniflare/dist/src/index.d.ts:1247。
4. 使用可用的公開log／handleStructuredLogs收集runtime啟動錯誤並去敏；不修改node_modules注入logging、不公開內部proxy secret。
5. 清楚記錄worker-thread的Undici不經global hook，不能讓「denied=0」承擔OS級封網保證。若需要更強防護，須另案設計，不能在診斷時偷偷更換策略。

以上皆未修改。此報告不把記錄缺口稱為fetch失敗根因，也不因找到缺口就改原型重跑。

## 8. 最小後續診斷方案與授權需求

### D0：本輪已完成的唯讀診斷

只用Get-Content、rg、Get-Item／ChildItem與Get-FileHash讀既有檔案及安裝程式。沒有Node啟動、網路、DB或新run。除本Markdown外不改原有檔案／證據。

### D1：建議下一個最小動態診斷（未授權、未執行）

不重跑Stage1，也不執行任何SQL。建議另案批准**單次本機runtime診斷**：

- 新增獨立檔案：`D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/diagnose-runtime.mjs`；不改原六檔，不修改node_modules或產品src。
- 新root：`D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/.wrangler/p3-stage1/diagnostics/P3D1-20261118-001/`。保持原run完整；存在即停，不自動換名重試。
- 保持同套Miniflare／workerd、inline worker、loopback／port0、telemetry off及outbound deny、allowlist env與獨立home／config／state／tmp。不得恢復正式env或提權。
- 命令介面候選（須先核准及建立檔案，現在不可執行）：

```text
FileName: D:/Program Files/nodejs/node.exe
WorkingDirectory: D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/.wrangler/p3-stage1/diagnostics/P3D1-20261118-001/
Arguments:
  D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/tests/p3-stage1/diagnose-runtime.mjs
  --workspace
  D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog
  --run-root
  D:/WebProject/2026-0923 - TableGameInformation/boardgamecollection-blog/.wrangler/p3-stage1/diagnostics/P3D1-20261118-001/
  --offline
  --no-sql
```

- 行為：construct一次→await ready一次（只記loopback URL）→getD1Database一次→立刻dispose，不呼叫prepare／batch、不bootstrap、不分類／HMAC、不載stage1.test。
- 記錄第7節cause chain與時間；若成功只表示本次binding可取得，不自動進SQL或Stage1。若失敗保留原因並停，無自動重試／新key／替代執行器。
- 60秒單次上限、launcher持有此run Process樹停止；保留native metadata／logs。不做Test-NetConnection、curl、遠端ping或Cloudflare呼叫。
- runtime本身仍可能建立本機metadata.sqlite；所以雖然不執行SQL，這不是純唯讀，**需要明確新授權建立檔案／目錄及啟動本機runtime**。

### D2：只有D1取得原因後才考慮（未授權）

如果cause被MessagePort fallback丟失，需另提出更細的worker-thread／transport日誌方案，不能先修改套件或攔截內部secret headers。如果cause顯示需要改host／port、權限、版本或隔離策略，應分項提出並取得使用者批准，不一次同時改多個變數。

### 授權矩陣

| 動作 | 新命令 | 修改測試檔 | 啟runtime／新資源 | 本輪允許？ |
| --- | --- | --- | --- | --- |
| 讀既有檔案／安裝程式，hash與時間對照 | 僅唯讀shell | 否 | 否 | 是，已完成 |
| 交付本診斷Markdown | 文件寫入 | 否 | 否 | 是 |
| 補原六檔cause logging並重跑Stage1 | 是 | 是 | 是 | 否；且非建議第一步 |
| 獨立D1單次binding診斷 | 是 | 新增第七個獨立檔案，不改六檔 | 是 | 否，須新授權 |
| 新run完整Stage1 | 是 | 視審查結果 | 是，並含隔離SQL | 否，不能由診斷成功自動取得 |
| 提權／替換SQLite／套件更新／遠端連線 | 是 | 可能 | 是 | 明確禁止，本方案不包含 |

## 9. 本輪停止點

已完成使用者要求的既有證據唯讀診斷。可確認同步proxy transport錯誤與cause記錄缺口；底層連線根因仍UNKNOWN。未重啟、未變更原型、未修改／刪除evidence、未新增runRoot、未提權或連遠端。只交付本文件後停止，等待ChatGPT與使用者審查後續診斷範圍。

`STAGE1_BLOCKED` / `READONLY_DIAGNOSIS_COMPLETE` / `ROOT_CAUSE_NOT_CONFIRMED` / `NO_RERUN_AUTHORIZED`
