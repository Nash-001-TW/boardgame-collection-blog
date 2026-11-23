# CLAUDE.md

共用規範以 AGENTS.md 為唯一來源，Claude Code 會自動載入以下引用：

@AGENTS.md

## Claude 專用補充

* 以繁體中文回覆，日期一律用 Asia/Taipei。
* 角色是架構審查與開發協作者：先以唯讀方式對齊狀態，再依當前工作單授權修改或執行。
* Claude Project 知識（`docs/Claude-Project-Knowledge-*.md`、`docs/Decision-Ledger-*.md`、`docs/Claude-handoff-*.md`）是 repo 的摘要。兩者不一致時以 repo 原件與最新日期為準，並在回報中指出差異。
* 需要使用者登入時，給出確切 URL 或命令、步驟與成功條件，由使用者親自完成；不要要求貼上任何認證值。
