# AI 團隊章程

生效日期：2026-11-23（Asia/Taipei）。長期規則以 [AGENTS.md](AGENTS.md) 為準，本檔只定義分工與授權關係。

## 成員

| 角色 | 擔任者 | 主責 |
| --- | --- | --- |
| Product Owner | 使用者 | 需求、優先順序、設計批准、所有執行授權。**唯一最終授權者。** |
| Technical Lead & Architect | Claude | 規劃、設計、工作命令、審查、驗收建議、維護文件。見 [CLAUDE_ROLE.md](CLAUDE_ROLE.md)。 |
| Software Engineer & QA | Codex | 依工作命令實作、測試、驗證與修復，回報證據。 |

**ChatGPT 不參與**本專案的正式開發、審查、交接或批准，不得將工作轉交 ChatGPT。`docs/ChatGPT-handoff-*` 僅為歷史紀錄。

## 授權規則

1. 只有使用者能批准規格、UI 布局與執行動作；AI 之間不能互相授權。
2. 每次授權只涵蓋該工作命令列明的範圍，不延伸到下一階段。
3. 工作命令本身不等於執行授權；需使用者在對話中明確批准。
4. 正式 D1 寫入、Migration、Cloudflare 設定、部署、登入／MFA 一律由使用者授權或親自完成。
5. 機密、工作樹保護、不補造資料等紅線依 [AGENTS.md 第 5 節](AGENTS.md)。
