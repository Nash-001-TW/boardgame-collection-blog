# BoardGame Dashboard V2｜ChatGPT 最新交接（2026-11-19，台北）

## 請 ChatGPT 接手的事

請先做專案管理與設計審查。把可獨立推進的 D1 規格與 P3 測試工具分開，先指出最值得使用者決定的一件事。P3 若繼續，請把下述 v2 四項缺口整理成一次 v3 修訂，送獨立審查。現有授權未涵蓋下一階段實作、乾跑或正式操作。

## 今天已交付

- **P3 R2-S 已交付實際程式修正。** 三檔在 `tests/p3-local/`。加入 PowerShell 7.5.0 門檻、JSON 日期以字串讀取、錯誤檔先發布再發 fatal、七欄去識別環境摘要。第一輪 Claude 審查抓到 PowerShell catch 裡有 JS 風格註解，已修並移除對 `$Matches` 的依賴。09:57 Claude 依三檔全文附帶條件通過靜態複審。Codex 重算 SHA-256 與附件一致，使用者獨立核對仍待確認。未執行測試、語法剖析或診斷。依 [Decision Ledger](Decision-Ledger-20261119.md)。
- **D1 採納一個實際案例。** 說明書 103 張更正為 100 張，保留實點 99、原日期與 checked；能回溯原判讀少 4、現判讀少 1，更正不可波及不適用版本。第一版建議保留 S4-A、只在勘誤涵蓋整個共用定義時改預期量、保留超量實點並顯示差額；方向仍待使用者正式確認。部分版本勘誤證據存放位置、一般缺件公式與逐副本預期量模型仍待決。現有 language_code／edition 是可空文字，無法可靠自動套用公告。
- **交接與可追溯性。** 已建 Claude Project 的知識文件，整理決策台帳、比對 11/18 與 11/19 交接，並區分 v19 正式部署紀錄與本機 HEAD。乾淨的 bf6b8e4 無法代表 v19 完整建置輸入。原始來源與產物對應仍 UNKNOWN。

## P3 目前卡在哪裡

- 原 Stage1 在 D1 binding 取得前受阻：16 案例全 BLOCKED、SQL 0。另一次 D1 診斷觀察到 ready 之後 loopback EACCES，並另有 Request.cf DNS 嘗試。作業系統層根因未證實。
- R2-S 保留 STOP_NOT_CONFIRMED；沒有實作可核實的全 Job 成員停止證據。這是測試監督工具的缺口，沒有新增桌遊清點功能。
- 延續單 `P3R2S2-20261119-001` 到 **階段 1 v2 設計**。採暫停建立子程序、納管後才恢復（方案 B），監督者留在 Job 外。保留 TMP_ONLY、TokenElevation、本機／轉交證據區分及 DryRun／L3 互斥。v2 尚需修訂：(1) 明定可取消的 stdio、EOF 與截止；(2) 區分程序已建立、從未恢復、清理是否確認，避免用已關閉 handle 測錯；(3) 修正 N4 目標是目錄時 TMP_ONLY 的判定，兩種 fatal 首次觀測都驗證有效檔；(4) Job 活動計數與清單一致歸零，正向案例先觀測到孫程序確實被納管，再驗證清場。TokenElevationType DEFAULT 只表示沒有 linked token。
- **下一步選擇。** 可先定 D1 第一版範圍，或請 Claude 一次修完 v3 後交獨立審查。階段 2、假程序檔 D-0、乾跑執行 D-1、L3 各自待批准。完整整盒守衛、冪等 C1／C2、事件排序與儲存機制仍待選型。

## 正式與工作區界線

Release-03 的 Worker v19、Migration 0001～0022、使用者登入與指定唯讀頁面驗收沿用。Admin UI 逐頁確認仍待，V1 退役與改名延後。本機已有大量未提交及未追蹤檔，保留工作樹。若需要原始證據，優先查 `docs/Decision-Ledger-20261119.md`、`docs/Claude-Project-Knowledge-20261119.md` 與對應 P3 報告。
