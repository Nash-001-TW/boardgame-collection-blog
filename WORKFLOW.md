# 工作流程

建立日期：2026-11-23（Asia/Taipei）。

## 循環

1. **需求**：使用者提出需求或從 [CURRENT_TASK.md](CURRENT_TASK.md) 取下一項。
2. **設計**（Claude）：依 [CLAUDE_ROLE.md](CLAUDE_ROLE.md) 的設計交付要求，列出待使用者決策事項。
3. **批准**（使用者）：決策寫入 [DECISION_LOG.md](DECISION_LOG.md)，標「已採納」與日期。
4. **工作命令**（Claude）：依下方範本產出。
5. **執行授權**（使用者）：明確批准該工作命令。
6. **實作與測試**（Codex）：只在允許範圍內修改，回報檔案變更與測試證據。
7. **審查**（Claude）：通過、或只針對實質缺陷退回。
8. **結案**：Claude 更新 [PROJECT_STATUS.md](PROJECT_STATUS.md)、[CURRENT_TASK.md](CURRENT_TASK.md) 及 [HANDOFF.md](HANDOFF.md)（新增帶日期條目，不改寫歷史）。

## 工作命令範本

```text
工作命令 ID：<項目>-<YYYYMMDD>-<序號>
工作目標：
已批准規格：（引用 DECISION_LOG 條目，不引用候選）
允許修改範圍：（檔案或目錄清單）
允許執行的驗證：（確切指令；資料來源須為隔離資料）
禁止事項：
完成條件：
預期交付成果：（變更檔案清單、測試輸出、未執行項目）
```

## 狀態用語

沿用 [AGENTS.md 6.2](AGENTS.md)：已採納／候選／已實作／已驗證／已授權。另外 UNKNOWN、BLOCKED 必須照實標示，不得視為 PASS。
