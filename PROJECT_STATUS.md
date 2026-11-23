# 專案狀態

更新日期：2026-11-23（Asia/Taipei）。詳細證據見 [HANDOFF.md](HANDOFF.md)；本檔只保留摘要。

## 正式環境

| 項目 | 狀態 | 證據 |
| --- | --- | --- |
| Worker | Release-03，version 19，流量 100%（2026-11-12 部署） | [Release-03 §10](docs/V2-Release-03-summary.md) |
| D1 Migration | 0001–0022 已套用 | 同上 |
| 公開 HTTP、管理員登入與唯讀驗收 | 已驗證，不需重做 | [current-progress.md](docs/current-progress.md) |
| 正式寫入流程（清點、扣庫存、採購） | 未驗證 | 同上，保留限制 |

## 主線：R06 實體組件與清點

| 項目 | 狀態 |
| --- | --- |
| 舊基準（逐卡選副本、存實點、revision、重載） | 已驗證（歷史 66 項測試） |
| 工作樹 R06 變更（7 檔，未提交） | 已實作，未驗證 |
| 頁面布局 | 候選，等待使用者決策（[CURRENT_TASK.md](CURRENT_TASK.md)） |
| 逐副本適用性、使用者清點日期、整盒進度 | 規則已採納，未實作 |

## 候選與未授權

- Migration 0023（共用預期量更正）、0024（組件適用性）：存在於工作樹，未審查、未授權。
- `shared-quantity-commit.ts`、`physical-quantity-impact.ts`、`component-applicability.ts`：已實作，未驗證。

## 2026-11-23 新增

| 項目 | 狀態 |
| --- | --- |
| 公開網站 UI 修正（web-design-guidelines 審查後三個提交 `d025959`、`c8c56be`、`66f798d`） | 已實作；`astro check` 無新增錯誤；本機僅部分頁面驗證；未建置、未部署、未推送 |
| Admin 視覺基準（UI-01）與 UI 分工（TEAM-03） | 已採納 |
| [V2 UI／UX 設計規範](docs/UI/V2-UI-Design-System.md)（UI-02，D1～D8 已決定） | 已採納 |
| R06-UI-01 四項頁面決策（UI-D8） | 已採納 |
| F1／F2 過渡修正（`32d81f2`） | 已實作；Node 測試 67 項通過；瀏覽器未驗證 |
| 全部待辦的優先順序 | 見 [CURRENT_TASK.md](CURRENT_TASK.md)「全部待辦」 |

## 暫緩

P3 R2-D／L3、Major03 Launcher／Gate L2／D0、V1 退役與表名正規化。

## 文件落差

`docs/current-progress.md` 停在 2026-11-18，內容含「移交 ChatGPT」等已失效的安排。現況以 HANDOFF.md（2026-11-23）及本檔為準。
