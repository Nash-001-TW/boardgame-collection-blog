# B-4.3F — Windows 安全替換候選與隔離驗證

## 範圍與資料完整性

只修改本機安全寫入引擎、CLI 安全診斷、直接相關測試及文件。
沒有 BGG API、正式快取 execute、#347147 重試、其餘八款匯入、D1、Migration、部署或 Broker/R03/R04 操作。
正式快取維持 786 款，SHA256：

`7f8b5d2fbc7b196a0419236cc9dd461c014b534a568922d1236fff8777a54268`

## 修改清單

- `scripts/lib/relation-import-engine.ts`：StorageDiagnostic、REPLACE 有界重試、完整性守衛、替換後重讀、清理次要錯誤及鎖清理。
- `scripts/bgg-relations-import.ts`：外層錯誤出口保留安全 storageDiagnostics；execute 的部分結果亦保留。
- `tests/cache-replacement.test.ts`：18 項新隔離案例。
- `tests/relation-import-engine.test.ts`：既有 fixture 目錄刪除採有限重試；新增 2 項 lock cleanup 不遮蔽 HTTP／storage 主錯誤案例。
- `tests/fixtures/import-batches.ts`：歷史投影明確扣除 B-4.3 唯一已提交的 340953，不包含其餘九款。
- `tests/b41-acceptance.test.ts`、`tests/b42-acceptance.test.ts`：以歷史投影核對原數量與原 hash；原預期值完全保留，不把目前 786 筆誤當歷史 775／785 筆。
- `docs/bgg-relations-import.md`、本報告。

## 診斷契約

每筆失敗事件保存 operation、stage、code、errno、syscall、path、dest、attempt、maxAttempts、elapsedMs、retryable、cleanupErrors。
底層未提供的 errno/syscall/path/dest 為 `unavailable`，不推導 Win32 GetLastError。
stage 區分 LOCK、TEMP_OPEN／TEMP_WRITE／TEMP_SYNC／TEMP_CLOSE／TEMP_VALIDATE、BACKUP_OPEN／BACKUP_WRITE_SYNC／BACKUP_VERIFY、REPLACE／REPLACE_VERIFY、CLEANUP。
一般 CLI 只顯示路徑 basename；沒有原始 message、stack、cause、環境資料或 Token。
詳細路徑僅供 library 的 detailedPaths opt-in，呼叫端應保存在受控本機報告，不供一般日誌。
成功重試仍保留先前錯誤。Cleanup errors 是次要證據，不覆蓋已存在的主要 HTTP／storage 錯誤。

## 重試與提交順序

1. 呼叫端先取得協作式獨占 lock；直接 commitCache 的呼叫端仍負責鎖。
2. 同目錄 wx temp → write → sync → close → JSON parse 與完整 bytes 比對。
3. 正式檔比對 previous；wx backup → write → sync → close → bytes 比對。
4. 正式檔再次比對 previous → rename。
5. EPERM／EACCES／EBUSY 才可能重試；最多 3 次，等待 200ms、500ms。
6. 等待後檢查取消，再重讀正式檔=previous、tmp=proposed、backup=previous。全部通過才再 rename。
7. 非候選錯誤、狀態不一致／遺失、取消或預算耗盡直接停止。
8. 替換成功後重讀正式檔=proposed 才回報成功。失敗不自動回滾。
9. finally 分別處理殘餘 handle、tmp；呼叫端分別處理 lock close/unlink。

EACCES 可能是持續權限拒絕，因此只有有限探測，不修改權限；EPERM 也不一律視為短暫問題。
重試只重做 rename，不重抓 XML、不重建 JSON、不建立第二份提交／備份。
若實際已替換但回傳失敗，後續 previous 比對會阻擋重試；視為提交狀態有歧義，人工檢查，不宣稱成功。
清理失敗發生在成功替換後，可能已提交但整體回報失敗；不得自動回滾或重下資料，應重新唯讀檢查。

## 測試矩陣

新增 18 項 replacement 測試：

| 案例 | 類別 | 結果 |
|---|---|---|
| 單次及連續 10 次替換（共 11 次） | 真實 Windows NTFS | PASS |
| EPERM／EACCES／EBUSY 首次拒絕後成功（3 項） | 注入錯誤＋真實隔離替換 | PASS |
| 三種候選連續拒絕，3 次耗盡（3 項） | Mock | PASS |
| EIO 立即停止 | Mock | PASS |
| 外部改正式檔、tmp 遺失、tmp 改變、backup 改變（4 項） | 隔離檔案變動 | PASS |
| backup 無法建立 | 隔離目錄阻擋 | PASS |
| tmp cleanup 失敗不蓋主錯誤 | Mock；驗證預期 tmp 殘留 | PASS |
| 獨立 Node 程序持協作鎖，另一引擎拒絕且不發 HTTP | 真實多程序 | PASS |
| FileStream 未允許 delete sharing；釋放後成功 | 真實 Windows 占用 | PASS |
| rename 後外部變更被 readback 拒絕 | 隔離注入 | PASS |
| backoff 期間取消，不再替換 | Mock＋隔離檔案 | PASS |

Windows 占用案例實際診斷：code=EPERM、errno=-4048、syscall=rename、attempt=1、maxAttempts=3、retryable=true。
沒有記錄或推導 Win32 error number。此案例無法證明歷史 #347147 是同一原因。
原檔／新檔與備份均以完整 bytes 驗證；未出現半寫入正式 JSON。
故意的 cleanup 拒絕在斷言時保留 tmp／lock，fixture teardown 才清除，並非清理全成功。

## 回歸與限制

最終指令與完整輸出保存在獨立 `bgg-b43f-20261103-results` 目錄。
最終相關回歸 **147/147 PASS**（包含新 replacement 18 項及新增 lock cleanup 2 項），沒有跳過案例。
相關套件包含 B1、B2、B3A Mock scope、B3C、B4.1、B4.2 歷史驗收、A2、A3、B3D 與實際 Astro 元件編譯／渲染。
本輪沒有重新執行歷史真實 API 匯入；B3A 只測 Mock scope，不宣稱重驗遠端 API。
整站 build 未執行，避免 prebuild Wrangler；未另啟動瀏覽器或部署。

初期受限 sandbox 內正常 rename 也被 EPERM 拒絕；經核准在限制外執行同一隔離測試後成功。
初輪另有 fixture rmdir EBUSY 與歷史快照未扣除 340953 的失敗；後續調整測試清理及歷史投影，沒有修改正式資料或舊預期 hash。
這些初期失敗不冒充 PASS，也不認定為歷史事故根因。
初期失敗／中斷留下兩個隔離 fixture 目錄 `.bgg-b2-test-1JZTMi`、`.bgg-b2-test-FSA5Oi`；僅有合成 cache.json 與 .bak，為保留失敗證據而未刪除，清冊見 initial-run-residue.json。
正式 src/data 無 .import.lock 或 .tmp 殘留；不能將上述初期 fixture 說成全部清除。

整站 `tsc --noEmit` 回報 18 個錯誤，位於本輪未修改的 collection sync、舊 batch validator、catalog-store、detail-relations-controller 及 game-list-controller；整站 TypeScript 不宣稱通過。
針對本輪引擎、CLI 與兩份寫入測試的 strict 檢查通過，未放寬 strict。

## 殘餘風險與 B-4.3C

- 協作鎖不能阻止外部編輯器、不合作寫入者或占用者。
- guard 與 rename 仍有 TOCTOU；不是 compare-and-swap。Readback 無法挽回在最後空窗被覆蓋的外部變更。
- 本輪真正 Windows 占用只觀察到 EPERM；EACCES／EBUSY 為 Mock，未宣稱三種原生錯誤皆實測。
- 真實 disk full、sync 失敗、斷電、網路磁碟、所有防毒配置、強制終止及 lock close 原生失敗仍 NOT TESTED。
- 原因不明的外部修改、持續權限拒絕、備份不一致或清理殘留均應停止，不刪原檔、不降級 copy、不自動回滾。

建議可提交下一輪 B-4.3C 的明確授權審核；不是自動放行匯入。
前置條件：重新核對 786／88／29 與正式 hash、獨立備份、固定剩餘九款清單、無殘留正式 lock/tmp、維護期間排除其他寫入者、接受未解歷史根因與全站 TS 限制。
若無法確認獨占維護條件，維持 NO-GO。沒有在本輪開始 B-4.3C。
