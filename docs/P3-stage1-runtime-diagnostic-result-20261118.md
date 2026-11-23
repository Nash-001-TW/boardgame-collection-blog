# P3 D1 單次 Runtime 診斷結果

2026-11-18 · `BLOCKED` · `CAUSE_CHAIN_CAPTURED` · Stage 1 未重跑

## 1. 結論與授權符合性

僅啟動一次 runtime。construct、ready 成功；getD1Database 失敗，取得底層錯誤 `connect EACCES 127.0.0.1:6655`；dispose 成功，所有本次 Node／workerd 程序已停止。未呼叫 SQL、prepare、batch 或 bootstrap。

**本次不能宣稱完全遵守隔離邊界。** Miniflare 啟動期間自帶的 Request.cf 查詢嘗試解析外部主機 workers.cloudflare.com，回報 ENOTFOUND。父程序 fetch allowlist 與 Worker outbound deny 未攔住套件自載 Undici 的請求。本次未取得外部回應的證據，但已出現禁止的外部連線嘗試。

這項警告在執行完成後閱讀 runtime-log 才辨識，沒有在警告當下立即停止；診斷程式仍繼續 ready／binding／dispose。這不符合「出現意外外部連線立即停止」要求，是本次診斷的隔離與停止機制缺口。沒有隱藏、刪除或改寫原始結果；原 result.json 的 DIAGNOSTIC_COMPLETED_RUNTIME_FAILED 僅描述流程結果，**本報告以 BLOCKED 覆蓋其整體驗收狀態**。

未提權、安裝、更新、登入、使用正式認證／備份／D1／KV、部署、修改原六檔／產品 src／Migration／node_modules；未進入 D2。原六檔、三個相關產品檔、helper、lock 及22份Migration共33個受保護檔案前後hash相同。此hash檢查不是全repository／node_modules逐檔驗證。

## 2. 實際命令與環境

由 PowerShell 的 .NET ProcessStartInfo 直接啟動，UseShellExecute=false、CreateNoWindow=true、stdout／stderr分開保存；單次 WaitForExit(60000)，逾時才 Kill(true) 本次程序樹。實際約2.82秒，未逾時、未強制終止。

```text
FileName: D:\Program Files\nodejs\node.exe
Arguments:
  D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\tests\p3-stage1\diagnose-runtime.mjs
  --workspace
  D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog
  --run-root
  D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\.wrangler\p3-stage1\diagnostics\P3D1-20261118-001
  --offline
  --no-sql
WorkingDirectory: 上述 run-root
```

ProcessStartInfo.Environment.Clear() 後僅繼承 SystemRoot、WINDIR、SystemDrive、COMSPEC、PATHEXT、PROCESSOR_ARCHITECTURE（存在者）。PATH固定Node及Windows System32；CI=true、WRANGLER_SEND_METRICS=false。TEMP／TMP→root/tmp，HOME／USERPROFILE→root/home，APPDATA→root/appdata，LOCALAPPDATA→root/localappdata，XDG_CONFIG_HOME→root/config，XDG_CACHE_HOME→root/cache。未輸出完整環境變數值。

Node v24.21.0；Miniflare 5.20261006.1-alpha；workerd 1.20261006.1。inline合成worker、唯一binding P3_TEST、host127.0.0.1、port0、compatibilityDate2026-10-01、telemetry disabled；state及tmp均位於獨立root。版本由本次Node與已安裝package metadata取得，未另執行workerd --version。

## 3. 前置檢查

- 診斷檔與指定root原先不存在；未覆寫舊run或診斷資料。
- workspace及root既有祖先無ReparsePoint；腳本再檢查lstat與cwd。
- 建立專用root及evidence、state、tmp、home、appdata、localappdata、config、cache。
- 環境白名單及隔離路徑檢查通過；禁止繼承認證／proxy／NODE_OPTIONS／NODE_PATH。
- started.json以wx寫入防止重複執行。22份Migration僅讀取hash，沒有載入Schema。
- 啟動前Node／workerd清單為空；launcher持有本次PID，僅本次樹可強制停止。
- 前置檢查通過不代表套件無內建外連；本次已證明原有deny策略不足。

## 4. UTC階段與endpoint

| UTC | 階段 | 結果 |
| --- | --- | --- |
| 08:44:08.5760877Z | launcher啟動 | PID10880 |
| 08:44:09.630Z | construct開始 | 一次 |
| 08:44:09.658Z | construct返回 | 成功 |
| 08:44:09.672Z | await ready開始 | 一次 |
| 08:44:09.708Z | Request.cf警告 | getaddrinfo ENOTFOUND workers.cloudflare.com |
| 08:44:10.497Z | ready返回 | 成功 |
| 08:44:10.501Z | getD1Database開始 | 一次，P3_TEST |
| 08:44:11.203Z | getD1Database失敗 | fetch failed／EACCES |
| 08:44:11.213Z | dispose開始 | 一次 |
| 08:44:11.236Z | dispose返回 | 成功 |
| 08:44:11.3960316Z | launcher停止檢查 | exited=true，exitCode1，剩餘Node／workerd空 |

公開ready endpoint：protocol=`http:`、host=`127.0.0.1`、port=`6655`。未記錄proxy路徑、secret或headers。port0為配置，不是實際連線port；實際分配6655。

## 5. 完整可取得錯誤鏈

```text
TypeError: fetch failed
    at Object.processResponse (D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\node_modules\miniflare\node_modules\undici\lib\web\fetch\index.js:237:16)
    at D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\node_modules\miniflare\node_modules\undici\lib\web\fetch\index.js:1081:19
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\node_modules\miniflare\node_modules\undici\index.js:157:7
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async MessagePort.<anonymous> ([worker eval]:35:22)
cause:
Error: connect EACCES 127.0.0.1:6655
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:2021:16)
```

本次可觀察Error沒有獨立的code、errno、syscall、address、port或AggregateError.errors欄位；不由文字虛造原始欄位。可從message看到EACCES及地址，但不知道內部傳播是否移除了其他屬性。cause無更深一層可取得值。

序列化限制深度8、總節點64、errors最多16，WeakSet處理循環，僅白名單欄位，字串長度限制及認證／長hex／URL去敏。未保存原始headers、proxy secret、金鑰或完整環境。完整可取得的Error資訊見error.json。

## 6. 根因分級與隔離限制

**CODE_CONFIRMED（本次動態證據及靜態程式支持）：** ready後同步proxy transport連接127.0.0.1:6655被拒絕，原始cause為EACCES。這是本次fetch failed的直接失敗原因，尚不是作業系統拒絕的最終根因。

**UNKNOWN：** 是sandbox、安全軟體、系統權限策略或其他網路限制導致EACCES，未取得區分證據。不能單憑EACCES指定責任機制；未提權驗證，未更換port／host。也不能把本次cause倒填成前次Stage1已證實的cause。

**CODE_CONFIRMED：** runtime-log記錄外部Request.cf解析失敗；已安裝Miniflare bundle `node_modules/miniflare/dist/src/index.js:78584`定義外部cf.json endpoint，`:78672`附近setupCf處理選項，`:78689`附近以自身import_undici.fetch取得。原診斷設定未顯式關閉cf；telemetry off不等於cf fetch off。`network-denials.ndjson`為空／denied=0不能作為沒有外連的證明。

**INFERRED：** 若另案修訂隔離，公開cf=false候選可能阻止該啟動取值路徑；須先核對convertV4及新版設定傳遞，再另取授權，不能現在修改或重跑。這與loopback EACCES是兩個問題；沒有證據顯示cf解析失敗造成EACCES。

Native runtime自行建立cache／D1 metadata.sqlite及sidecars；未開啟、查詢或清理它們。不宣稱完全沒有runtime內部儲存寫入；sqlCalls=0指診斷程式未呼叫任何SQL接口。

## 7. 新增檔案、資源及停止證據

Workspace根：`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog`

新增診斷檔：`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\tests\p3-stage1\diagnose-runtime.mjs`

新增本報告：`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\docs\P3-stage1-runtime-diagnostic-result-20261118.md`

完整證據根：`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\.wrangler\p3-stage1\diagnostics\P3D1-20261118-001\evidence`

內含launcher.json、manifest.json、stages.ndjson、endpoint.json、error.json、runtime-log.ndjson、network-denials.ndjson、result.json、stdout.log、stderr.log、process-stop.json。run root另有started.json；state/cache/miniflare-CacheObject及state/d1/miniflare-D1DatabaseObject各有metadata.sqlite、-shm、-wal，全部保留。其他隔離目錄保留，未清除資源。

process-stop.json確認PID10880退出、timeout=false、treeKillUsed=false、baselineProcesses=[]、remainingProcesses=[]。因此不僅dispose成功，本次launcher亦確認無Node／workerd殘留。未停止其他程序。

## 8. 下一步最小建議與停止點

先審查隔離缺口：僅唯讀核對公開cf設定如何經convertV4傳遞，以及如何讓已觀察外連在首次警告時立即中止；另釐清EACCES可取得哪些無提權的系統證據。任何修改或新runtime執行都需另案授權；本輪沒有D2、SQL、Stage1重跑或遠端D1驗證。

本次診斷證據蒐集已結束，整體驗收為`BLOCKED`。不標PRODUCTION_READY、REMOTE_D1_VERIFIED或STAGE1_EXECUTION_COMPLETE。停止等待ChatGPT審查。
