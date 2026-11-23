# V2-Release-03 — 正式環境更新與部署摘要

> **最新狀態（2026/11/12 10:50:04，Asia/Taipei）：SUCCESS — version 19 已正式部署，限定公開 HTTP 與管理員人工唯讀驗收通過。Access 部署阻礙已解除；完整結果與未實測項目見第 10 節。第 1～9 節的 BLOCKED／計數是過往作業快照。**


以下為初次停止時的歷史快照：日期 2026-11-12（Asia/Taipei），當時狀態 **BLOCKED**；最終 SUCCESS 以文件頂端及第 10 節為準。

**已確認正式目標與最新狀態，完成正式 D1 官方匯出及本機還原完整性驗證。因 Access 組織查詢回傳 HTTP 403、無法可靠確認正式登入設定，依安全停止條件停止後續變更。未配置 Secrets、未套用 Migration、未 Build、未部署。**

本次沿用 Release-01／02 的驗證結果，未重跑歷史測試、Migration 串接或完整 Schema 審查。使用者另已確認沒有其他人／自動流程更新此 Worker／D1，並確認沿用本機 `.dev.vars` 的 ADMIN_EMAIL、ACCESS_TEAM_DOMAIN；不記錄其值。

## 1. 正式安全確認

- OAuth 本次檢查時有效；未執行 login、未刷新認證、不輸出 Token。
- Account ID 遮蔽：`0994e9…24d96a`，與 Release-02 相同，僅一個可見帳號。
- Worker：`boardgame-collection-blog`，目前正式版本仍為 version 18，Version ID `9cf8a910-8a97-4746-b9b5-5326ae9496f6`。
- D1：`boardgame-collection-db`，ID 遮蔽 `59e9a1…14e395`。先以帳號及 D1 GET Metadata 確認，再執行該 DB 查詢／Export。
- DB、SESSION 資源身份與本機一致；ASSETS、IMAGES 綁定存在；NOTBGG_WRITE_LIMITER 的 namespace 及 30 次／60 秒設定一致。
- 正式 Migration 仍只有 0001～0016 的 16 筆紀錄，與 Release-02 相同；只重新檢查 0017～0022 的新物件／欄位名稱，未發現同名衝突。
- 沒有使用 Preview D1 或其他 Worker／DB。使用者的無並行更新確認加上 ledger／部署版本未變是本次依據；本次沒有建立跨工具的排他鎖，未宣稱可阻止其他操作者後續變更。

## 2. 正式 D1 備份

結果：**PASS（官方 SQL 匯出及本機可還原性驗證）**。

| 項目 | 結果 |
| --- | --- |
| 來源 | 指定正式 boardgame-collection-db |
| 方法 | Cloudflare D1 官方 Export API，完整 Schema 與資料，預設 D1 格式 |
| Export 作業 | 1 次；POST 2 次，包含啟動及輪詢；下載 GET 1 次 |
| 遠端 Export 請求時間 | 2026-11-12 01:47 UTC 期間（09:47 Asia/Taipei） |
| 本機驗證完成 | 2026-11-12T01:48:31.316Z |
| 檔案大小 | 1,948,396 bytes |
| SHA-256 | `aff80524d219916f4826ab0bd775bb035f95ea7721cc2edf00e1e2a070720bdd` |
| 可讀取／本機記憶體還原 | PASS |
| PRAGMA integrity_check | ok |
| 還原後 foreign_key_check | 0 個違反 |
| 還原後 Migration ledger | 16 筆，檔名及順序與匯出前相符 |

備份位置（專案外，未加入 Git）：

`D:/CodexHome/visualizations/2026/11/11/01a1c7ee-d59d-7720-a528-43c975ffb734/private-release03-backup-bbe2f2e1-8e63-4799-a70d-48bb6acb19fc/boardgame-collection-db-before-0017.sql`

目錄 ACL 已停用繼承，僅有目前 Windows 使用者的允許規則，檔案可讀。沒有將匯出內容、私人資料、下載簽名 URL 或認證輸出至聊天／報告。

本機準備曾遇到 ACL SID 參數格式問題，修正後才發出首次 Export。下載後第一次記憶體載入因 Node SQLite 預設立即啟用外鍵、而匯出表的載入順序尚未建立被引用表而失敗；當時已停止遠端操作。對**同一個未修改的匯出檔**，改用載入時關閉外鍵的本機 SQLite 匯入設定，載入後重新啟用外鍵並執行完整性／外鍵檢查，結果通過。沒有重新匯出、修改備份 SQL、停用正式外鍵或嘗試正式還原。

還原方式與限制：官方 SQL 匯出可透過 D1 的 SQL import／Wrangler execute-file 流程匯入；參考 [官方匯入匯出文件](https://developers.cloudflare.com/d1/best-practices/import-export-data/)。**這不是對現有正式 DB 可直接重跑的更新腳本**，匯入既有資料庫可能遇到物件／ID／引用衝突。本機 SQLite 成功不等同已驗證 Cloudflare D1 遠端還原；若需要復原，須另行授權並先驗證空白隔離 D1 的外鍵、觸發器與匯入相容性，不自動清空或還原正式 DB。匯出不包含 Worker、KV、Secrets 或 Access 設定，也不包含匯出時間之後的寫入。

## 3. Secrets 設定

| 名稱 | 結果 |
| --- | --- |
| PHYSICAL_COMPONENT_SIGNING_KEY | 尚未配置；未產生、上傳或覆寫金鑰 |
| BGG_API_TOKEN | 本機既有設定存在，但未上傳、未呼叫 BGG API 驗證有效性 |
| ACCESS_TEAM_DOMAIN／ACCESS_AUD／ADMIN_EMAIL | 正式 Secret 名稱仍存在；未讀取遠端值、未修改 |

程式確認簽章金鑰需至少 32 UTF-8 bytes，未採用測試金鑰。若續行時來源表或金鑰狀態已有改變，需先確認連續性再配置；本次未讀取可信任來源業務紀錄。因已知 Access 停止條件，沒有留下不必要的部分 Secret 變更。

## 4. Access 保護結果與停止原因

- 使用者已確認沿用本機管理員身份與 Team Domain；本機格式檢查通過，不輸出值。
- `GET /accounts/{account}/access/organizations`：**HTTP 403，Cloudflare error code 10000**。
- `GET /accounts/{account}/access/apps?per_page=100`：HTTP 200，清單為空。
- `GET /accounts/{account}/access/identity_providers`：HTTP 200，清單為空。
- 因此無法核對本帳號 Zero Trust 組織與指定 Team Domain 的一致性，也沒有可確認的登入提供者／Access Application／Policy。403 表示本次認證未能取得必要組織設定，不能推定設定正確、組織不存在或已具備 Access 寫入權限。
- 未建立 Application、Policy、Identity Provider 或 Zero Trust 組織；未建立 Allow Everyone、未停用 JWT 驗證、未開放 Admin。

**安全停止：Access 無法可靠確認保護 Admin，禁止進入 Migration／Build／部署。** 需要由使用者在本機安全完成必要的 Cloudflare Zero Trust 身份／權限設定，讓指定帳號的組織設定可被可靠核對，並確認至少一個正式可用的登入方式。認證不得貼到對話、寫入專案或報告。若需建立帳號層級組織或額外資源，須先釐清是否在既有授權範圍，不能因本階段授權部署 Worker 就自行擴張。

## 5. Migration 0017～0022

| Migration | 最新狀態 | 本次執行 |
| --- | --- | --- |
| 0017_physical_components.sql | PENDING，未見目標衝突 | 未執行 |
| 0018_sleeve_admin.sql | PENDING，未見目標衝突 | 未執行 |
| 0019_collection_copy_commands.sql | PENDING，未見目標衝突 | 未執行 |
| 0020_sleeve_requirement_applications.sql | PENDING，未見目標衝突 | 未執行 |
| 0021_purchase_and_copy_admin.sql | PENDING，未見目標衝突 | 未執行 |
| 0022_bgg_sync_and_relations.sql | PENDING，未見目標衝突 | 未執行 |

最後既有版本為 0016；本次沒有成功或失敗的正式 Migration 執行，也沒有自動重試、補 ledger、資料回填或正式還原。備份之後沒有發送任何正式 SQL 寫入。

## 6. Build、部署及驗收

| 項目 | 結果 |
| --- | --- |
| 正式 Build | 未執行，受 Access 安全停止條件阻擋 |
| Worker 部署 | 未執行，無新 Version ID／部署時間 |
| 現行正式 Version ID | `9cf8a910-8a97-4746-b9b5-5326ae9496f6`（version 18，保持不變） |
| 既有正式 URL | https://boardgame-collection-blog.nash0710-001.workers.dev（沿用 Release-02 Metadata，非新版驗收） |
| 首頁、collection、games、BGG 中英文動態頁、NotBGG、舊 slug | 新版未部署，未驗收 |
| 404／503、Assets、sitemap、robots | 新版未部署，未驗收；不對正式環境製造故障 |
| 未登入／非管理員／管理員 Access 登入 | 未驗收，Access 設定尚未確認 |
| Dashboard、收藏、副本、組件、卡套、採購、BGG／關聯 Admin | 新版未部署，未驗收；未建立或修改任何測試業務資料 |
| 真實 BGG API | 未呼叫，Token 有效性尚未確認；未更新正式快取 |

沒有以本機 PASS 代替正式新版驗收。

## 7. 實際遠端操作次數

| 操作 | 次數 |
| --- | ---: |
| GET accounts | 3 |
| GET 指定 D1 Metadata | 3 |
| GET 指定 Worker settings／deployments | 各 1 |
| GET Access organizations | 1（403） |
| GET Access apps／identity_providers | 各 1 |
| 正式 D1 query POST | 4（全部為 Migration／Schema Metadata SELECT） |
| 正式 D1 export POST | 2（同一次匯出作業的啟動／輪詢） |
| 簽名下載 URL GET | 1（不附 Cloudflare Authorization，不保存 URL） |
| GET 合計 | 12，含下載及 1 次 403 |
| POST 合計 | 6，僅 Metadata SELECT 與已授權 Export |
| Wrangler CLI／login | 0 |
| 正式 D1 備份作業 | 1，驗證 PASS |
| 正式／Preview D1 資料修改 | 0 |
| Preview D1 存取 | 0 |
| 正式 Migration／正式還原／清除資料庫 | 0 |
| Secrets／Access／綁定／DNS 修改 | 0 |
| Worker／Assets 部署、其他 Worker／D1 變更 | 0 |
| 真實 BGG API／正式 BGG 快取寫入 | 0 |
| Build／歷史測試重跑 | 0 |

備份 Export 屬明確授權的遠端匯出作業，不宣稱本次全為唯讀 GET。所有業務資料寫入均為 0。輔助腳本及必要計數位於專案外；專案僅新增本報告。

## 8. 尚未解決與續行位置

1. 先解除 Access 組織設定不可核對的阻礙，確認 Team Domain、登入方式、正式／Preview 入口與最小權限 Policy 範圍。不得放寬 JWT 或允許所有人來通過。
2. 之後接續同一 Release-03；不需重新要求整個流程授權，但需重新確認認證、目標、無並行更新、ledger／Schema 是否仍相同，並確認備份後是否已有資料變更；必要時重新備份。
3. Access 與必要資訊可靠後，依已授權範圍處理 Secrets、Access Application／Policy、0017～0022、正式 Build、部署與限定驗收。任何新資源或超出既定範圍的操作仍須另行釐清。

目前 **BLOCKED**，已保留可驗證的正式備份；未執行後續正式變更或危險修復，交由 ChatGPT 驗收。

## 9. Access BLOCKED 續行補充（2026-11-12 09:53 Asia/Taipei）

本節只補充本次診斷結果，前述步驟與計數保留為前次快照；截至本次，狀態仍為 **BLOCKED**。

### 身份、角色與 403 原因的證據界線

- 使用同一份有效 Wrangler OAuth，沒有刷新、切換帳號、產生或擴大 Token。GET /user 成功；個人身份只在記憶體核對，不保存姓名、email 或完整回應。
- GET /accounts 仍僅列出原 Account；GET /memberships 確認此帳號的本人 membership 為 accepted，角色是 **Super Administrator - All Privileges**。因此不能把本次問題直接說成「需要提升使用者帳號角色」。
- Worker 及指定正式 D1 身份再次相符，DB 綁定仍指向同一資料庫。沒有選用其他 Account 或 Preview。
- GET /accounts/{account}/access/organizations 仍為 **HTTP 403／code 10000**。請求目標 Account 確實是 Worker 所屬帳號；但因組織不可讀，**Zero Trust 組織是否位於此 Account、其 Team Domain 是否等於本機設定，仍無法確認**。
- 現有 OAuth 的本機 scopes 有 account／Worker／D1 等項目，未明示 Access 專用 scope；這是可觀察事實，**不是足以證明 403 唯一成因的完整授權映射**。沒有取得可證明此 OAuth 對 Access 的完整有效權限資料，亦未用測試寫入試探權限。
- Application、帳號層級 Policy、Identity Provider 的清單 GET 均 HTTP 200，均為 0 筆。這能證明該認證的列舉結果，不能證明組織不存在、登入永遠不可用、或具有建立／修改權限。
- **結論：403 的唯一根因仍為 UNKNOWN**。已證明資源請求的 Account 未選錯、本人帳號角色為 Super Administrator；仍需在 Dashboard 核對 Zero Trust 所屬帳號與目前認證對組織／Access 的實際權限，不能擅自歸因或修改設定。

### 本次具體查詢

| GET 路徑（識別碼遮蔽） | 結果 |
| --- | --- |
| /user | 200，身份可用 |
| /accounts?per_page=100 | 200，原帳號 |
| /memberships?per_page=100 | 200，本人角色如上 |
| /accounts/{account}/d1/database/{database} | 200，原正式 D1 |
| /accounts/{account}/workers/scripts/boardgame-collection-blog/settings | 200，綁定及 Secret 名稱 |
| /accounts/{account}/access/organizations | 403，code 10000 |
| /accounts/{account}/access/apps?per_page=100 | 200，0 筆 |
| /accounts/{account}/access/policies?per_page=100 | 200，0 筆 |
| /accounts/{account}/access/identity_providers | 200，0 筆 |
| /accounts/{account}/workers/scripts/boardgame-collection-blog/subdomain | 200，正式及 Preview URL 均啟用 |

### 所需最小 API 能力（尚未授予或驗證）

| 工作 | 應由使用者確認的權限 |
| --- | --- |
| 核對 Team Domain／Zero Trust 組織 | `Access: Organizations, Identity Providers, and Groups Read` |
| 建立／管理本網站的 Application、Policy | `Access: Apps and Policies Write`；唯讀診斷使用對應 Read 能力 |
| 如確實需新增／修改登入提供者 | `Access: Organizations, Identity Providers, and Groups Write`；已有可用登入方式時不額外要求此寫入能力 |

資源範圍只限已確認的正式 Account，不是 All Accounts；不需要 Global API Key、Revoke 或無關資源權限。這是 API 所需能力說明，**不是本代理擴大現有 Token 或建立新 Token 的操作**。Dashboard 登入身份的角色與 API 認證的有效權限須分別確認，不能因本人是 Super Administrator 就宣稱任意 OAuth 都有 Access 寫入能力。

依據：[組織查詢接受的權限](https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/list/)、[API 權限名稱](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)、[新增 Identity Provider 權限](https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/create/)。

### 使用者需要在本機 Dashboard 完成的核對

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 使用現有身份登入，確認目前 Account 與本專案 Worker／D1 所屬帳號相同。只在本機比對完整 Account ID，不必把身份或完整敏感回應貼到聊天。
2. 開啟該 Account 的 Zero Trust，在 **Settings → Team name and domain** 核對組織與本機 `.dev.vars` 的 ACCESS_TEAM_DOMAIN。若導向別的 Account 或要求建立新組織，先停止並說明，不自行建立、切換或重命名。參考 [Team Domain 官方說明](https://developers.cloudflare.com/learning-paths/clientless-access/initial-setup/create-zero-trust-org/)。
3. 在 **Zero Trust → Access controls → Applications** 確認可查看並管理 Application／Policy；有既有有效項目就重用，不重複建立。參考 [Application 入口](https://developers.cloudflare.com/learning-paths/clientless-access/access-application/create-access-app/)。
4. 在 **Zero Trust → Integrations → Identity providers** 確認本機 ADMIN_EMAIL 能使用的登入方式，例如經確認可用的 One-time PIN 或既有 IdP；不要為了部署自行新增不明登入整合。參考 [Identity Provider 入口](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/)。
5. 在 Account 的 Members／角色與本機認證授權介面，分別核對上述角色及 API 最小能力。此次角色已證明是 Super Administrator，無須直接升級角色；若 API 授權仍不足，需由使用者在本機完成必要授權，或使用 Dashboard 完成經確認的 Access 設定。不要將 Token、密碼、Secret 或憑證貼到對話、寫入專案或報告。

完成後僅需回報「同一 Account／Team Domain 是否相符、選用哪一種登入方式、Access 查閱／管理權限是否可用」，不需提供 Secret 值。重新 login 本身不保證新增 Access 權限，因此沒有要求盲目重跑登入來取代核對。

### 實際需要的 Admin 保護

本機 `src/middleware.ts` 保護 /admin、/admin/*、/api/admin、/api/admin/*；`src/lib/auth/cloudflare-access.ts` 驗證 RS256、issuer、audience、必要 claims、有效時間及 ADMIN_EMAIL；`src/lib/auth/admin-request.ts` 與管理 API 重複執行授權。本次未修改上述邊界。

後續 Application 必須涵蓋正式 `boardgame-collection-blog.nash0710-001.workers.dev` 的上述頁面／API，以及已啟用 Preview URL 的額外入口。採用同一個可核對的 Application audience 涵蓋管理頁與 API；若拆分 Application 而 audience 不同，不能直接把多個值猜測串入目前的單一 audience 驗證。Policy 僅允許使用者已確認的 ADMIN_EMAIL，登入方式需實測能取得符合 issuer／audience 的 JWT，不使用 Allow Everyone、Bypass 或停用後端驗證。

目前只有正式 ACCESS_TEAM_DOMAIN、ACCESS_AUD、ADMIN_EMAIL 的 Secret 名稱，未讀取遠端值，故不能宣稱已匹配 Application。尚無可確認的 Application／Policy／登入提供者，不能新建猜測設定或直接部署。

### 保留成果與新增計數

- 原備份仍存在，本次只核對大小及 SHA-256，均與第 2 節紀錄一致；沒有重新匯出、重跑還原測試或修改備份。
- 本次新增 **GET 10 次**（9 次 200、1 次 403）；POST、D1 SQL、備份、寫入、Migration、Build、部署、BGG API 全部新增 0 次。
- Release-03 累計 **GET 22 次**（包含原備份下載）、**POST 6 次**（4 次 Metadata SELECT、2 次同一次 Export 的啟動／輪詢）；備份作業仍為 1 次。所有正式資料／Secrets／Access／綁定寫入、Migration、部署仍為 0。
- 不重做前次成功步驟；Access 能可靠確認後才接續既有授權流程，臨正式變更前仍須確認備份時點及 ledger 是否有後續變化。

本次仍 **BLOCKED**，等待使用者完成上述本機 Zero Trust／認證核對。沒有繞過 Access，也未自動進入正式部署。

## 10. Access 解除後續行與正式上線完成（2026/11/12 10:50:04，Asia/Taipei）

**最終狀態：SUCCESS（指定 Worker 正式部署及本階段限定驗收）。** 這不代表所有歷史功能已重新測試；本節明確區分遠端 HTTP 證據、使用者人工驗收與未實測項目。

### 10.1 Access 設定來源與解除證據

- 本機 ACCESS_TEAM_DOMAIN、ACCESS_AUD、ADMIN_EMAIL 均來自專案根目錄的 **.dev.vars**；.env 未提供這三項，wrangler.json 未宣告對應 vars。正式程式透過 cloudflare:workers 的 env bindings 讀取，既有正式版本三項皆為 secret_text，不依賴本機檔案或前端 JavaScript。
- 使用者人工確認既有 Application、正式 /admin 與 /api/admin destinations、限制兩個指定管理員 Email 的 Allow Policy、AUD Tag，且 Dashboard 可查看；**未新建或修改 Application／Policy**。
- 不帶 Cookie／Token 的 /admin 與 /api/admin/auth-check 正式 GET 均收到 Access 302 登入重新導向；將 redirect 的 hostname 與 kid 只在記憶體比對，本機 Team Domain／AUD **兩項均相符**。未輸出或保存完整 AUD、登入 URL 或認證值。
- 使用者於部署前，以本機 ADMIN_EMAIL 登入正式 auth-check，確認 Admin authentication passed；部署後再次確認同一成功訊息及下述管理頁均正常。這是正式 Worker 三項設定及 JWT 驗證可用的人工證據，不是代理讀取 Cookie／JWT 後自行測試。
- 本機 JWT 驗證仍核對 RS256、issuer、audience、有效時間、必要 claims 及單一 ADMIN_EMAIL；Admin middleware 與 API 的獨立驗證均未修改。Access Policy 雖允許兩個 Email，後端仍只接受該單一 Email；**未擴大管理員權限**，另一個 Email 可能由 Access 放行後被後端拒絕。
- 原 Access 組織 API 403／10000 根因仍 UNKNOWN。本次續行的 Application GET 可讀但仍回傳 0 筆，與 Dashboard／實際邊緣證據不同，**不能據此推定不存在或 API 權限已修復**。不再依賴此 API 建立／修改設定；將來若要操作，仍須先確認該 API 權限。
- 依實際保護與登入證據，**Access 的部署 BLOCKER 已解除**；沒有繞過 Access。

### 10.2 備份與 Secrets

- 沿用第 2 節的原官方備份，本次再次比對大小與 SHA-256 一致；**未重新備份**，未重跑歷史還原／Migration 串接測試。使用者已確認沒有其他更新作業，正式 ledger 及部署版本在執行前仍未變。
- 正式來源表在套用 0017 前尚不存在，沒有既有該來源表簽章需要沿用；使用 node:crypto 安全產生 64 隨機 bytes 的簽章金鑰，符合程式至少 32 UTF-8 bytes 的要求，未使用測試值。
- 使用既有本機 BGG Token，一次 GET BGG XML API（公開遊戲 ID 13）收到 200 並確認有效 XML 遊戲 ID；未自動重試、未批次同步、未寫入正式 BGG 快取。
- 必要兩項 Secrets 先安全準備於既有專案外私人目錄，隨新 Worker 版本上傳；**不使用會先發布舊程式版本的獨立 Secret put 流程**。上傳後、切流量前，以及部署後，都以版本 Metadata 確認兩項新 Secret 與三項既有 Access Secret 名稱齊全。
- PHYSICAL_COMPONENT_SIGNING_KEY、BGG_API_TOKEN 均為 **PRESENT_IN_ACTIVE_VERSION**；ACCESS_TEAM_DOMAIN、ACCESS_AUD、ADMIN_EMAIL 保留原值。未讀取遠端 Secret 值、未刪除或改寫無關設定。
- 簽章金鑰已保存在專案外僅目前使用者可存取的私人目錄；須持續妥善保存，不能把私人備份目錄當成可隨意清除的建置暫存。Secret 檔案不在 Git、HTML、JavaScript 或報告中。

### 10.3 正式 Migration 0017～0022

| Migration | 執行及 ledger／Schema 核對 | 目標物件／欄位數 | 完成時間（UTC） |
| --- | --- | ---: | --- |
| 0017_physical_components.sql | PASS | 15 | 2026-11-12T02:37:43.634Z |
| 0018_sleeve_admin.sql | PASS | 4 | 2026-11-12T02:37:44.832Z |
| 0019_collection_copy_commands.sql | PASS | 3 | 2026-11-12T02:37:45.637Z |
| 0020_sleeve_requirement_applications.sql | PASS | 8 | 2026-11-12T02:37:46.406Z |
| 0021_purchase_and_copy_admin.sql | PASS | 8 | 2026-11-12T02:37:47.596Z |
| 0022_bgg_sync_and_relations.sql | PASS | 20 | 2026-11-12T02:37:48.340Z |

執行前再次確認 Account、正式 D1、原 16 筆 ledger、原備份與待新增目標；每版使用原檔案 SQL，接同批 Migration ledger INSERT（與 Wrangler migration query 的組成方式相同），成功後再 SELECT ledger 及必要 Schema，確認才執行下一版。未重跑已套用版本、未修改既有 Migration、無失敗或自動重試。

正式狀態現為 **0001～0022 APPLIED**（0017～0022 為本次執行並核對）；沒有對歷史收藏／採購／卡套資料執行額外 DML。正式變更包含六個已授權 Migration 的 Schema 操作、六筆 ledger INSERT 與 0022 新控制表的一筆初始化資料，**不宣稱正式 D1 完全零寫入**。沒有自動回填或重新分類歷史資料。

### 10.4 正式 Build 與版本部署

- 在新的專案外建置副本使用**真實正式 Account、Worker、DB、SESSION 等綁定**，固定 account_id；不使用 Release-01 合成產物。
- 完整 npm run build **PASS**，含 prebuild 的本機 wrangler types、Astro／Cloudflare SSR Worker、client 與靜態預渲染。外部網路及遠端綁定代理關閉，只允許本機預渲染通訊；未將 .env／.dev.vars 複製到建置副本。
- 132 個文字產物掃描未發現本機 Token、AUD、管理員身份或新簽章金鑰值；動態公開頁與必要 Admin API 路由存在且 prerender=false；正式 /games/*、/en/games/* 的 run_worker_first 設定保留。
- wrangler versions upload 帶兩項必要 Secrets，產生未部署 **version 19**；先遠端核對 DB／SESSION 資源、ASSETS／IMAGES／限流、五項 Secret 名稱、相容日期與旗標，且當時流量仍為 version 18，再執行 versions deploy 切換 100%。
- Worker：boardgame-collection-blog。
- **Version ID：f4617e7b-d041-4c96-9605-dd49b74c38a5**。
- **Deployment ID：ba7c2b8a-52ac-492d-9a8d-8d2c8903a537**。
- 遠端部署時間：**2026-11-12T02:42:08.871666Z（台北 2026-11-12 10:42:08）**。
- 流量：**version 19，100%**，部署後 GET Metadata 已確認。
- 正式網址：[boardgame-collection-blog.nash0710-001.workers.dev](https://boardgame-collection-blog.nash0710-001.workers.dev)。未修改 DNS、Custom Domain、其他 Worker 或其他 D1。

### 10.5 公開 HTTP 驗收

| 路由／檢查 | 實際狀態 | 結果 |
| --- | --- | --- |
| / | 200 | PASS |
| /collection | 200 | PASS |
| /games | 200 | PASS |
| /en/games | 200 | PASS |
| /sitemap.xml | 200 | PASS |
| /robots.txt | 200 | PASS |
| /about/ | 200 | PASS |
| /api/public/catalog?source=bgg&page=1 | 200 | PASS |
| /games/bgg/451166 | 307 → 200 | PASS |
| /en/games/bgg/451166 | 307 → 200 | PASS |
| /games/bgg-451166 | 200 | PASS |
| /games/bgg-451166 | 200 | PASS |
| /api/public/catalog?source=notbgg&page=1 | 200 | PASS |
| NotBGG detail | NOT_AVAILABLE | 未驗證（無公開樣本） |
| /games/bgg/2147483647 | 404 | PASS |
| /_astro/Layout.CiQXxL3G.css | 200 | PASS |
| /admin | 302 | PASS |
| /api/admin/auth-check | 302 | PASS |
| /admin/bgg | 302 | PASS |
| /api/admin/bgg | 302 | PASS |

其中中英文數字路由的 307 最終導向既有 canonical slug 並回傳 200。初版驗收腳本誤把此正常相容行為預期為直接 200，亦誤把既有 /games/bgg-451166 預期為別名；已修正**驗收預期**並補查實際 redirect 及目標，沒有為了測試修改路由或程式。

公開卡片樣本未包含被檢查的 notes、價格、採購／訂單、signature、actor 等私人欄位；這是限定樣本核對，不宣稱遍歷所有正式資料。公開 API 與動態詳細頁收到 no-store，靜態 /_astro CSS 收到 immutable。HTML 首頁／清單未回傳 Cache-Control，需在後續快取策略檢查時留意，不能宣稱所有 HTML 已設 no-store。

### 10.6 Admin 與功能驗收來源

- **代理 HTTP**：部署後 /admin、/api/admin/auth-check、/admin/bgg、/api/admin/bgg 未登入均 302 導向 Access，未取得管理內容。
- **使用者部署後人工確認 PASS**：auth-check 顯示成功，/admin、/admin/collection、/admin/collection/components、/admin/sleeves、/admin/purchases、/admin/bgg 均正常，無回報 401／403／500 或載入錯誤；只讀取、不儲存業務資料。
- computer-use 瀏覽器驗收工具因 Windows 當前網址無法可靠辨識而安全停止，未再操作瀏覽器；**不把這部分說成代理完成的自動瀏覽器驗收**。使用者人工確認補足上述列出的登入／頁面唯讀驗收。
- 收藏、副本、組件清點、庫存、需求套用、採購、關聯與同步的正式寫入流程未操作；遵守不任意建立／修改／刪除正式資料的範圍。

### 10.7 已知驗收限制

1. 未取得可用的非管理員真實登入身份，未進行正式非管理員 JWT 登入實測；保留既有後端拒絕邏輯與先前本機驗證，不把它列為正式實測 PASS。
2. NotBGG 公開目錄沒有可用詳細頁樣本，未建立正式測試資料補足；NotBGG 詳細頁 200 尚未實測。
3. 數字 BGG 路由已測既有身份的 canonical 相容行為；沒有建立新的正式收藏／成功快取來實測全新、無靜態登錄的遊戲詳細頁 200。
4. 沒有在正式 DB 製造失敗以強制驗證 503；實測了不存在遊戲的 404，不以本機 503 驗證當成正式測試。
5. BGG Token 真實 API 驗證 PASS，但沒有觸發管理端正式同步或快取寫入；同步 UI 的讀取由使用者人工確認，寫入流程未重測。
6. 多副本／實體組件的逐筆編輯或清點、卡套扣庫存、採購分攤等未進行正式寫入驗收。既有正式資料保留，不新增測試業務列。
7. Access API 403 根因及 Preview 入口的邊緣 Access 覆蓋仍未確認；未修改既有 Preview 開關。後端 JWT 在所有 Admin 路由仍必須生效，不依賴僅正式 hostname 的 Access Policy。

以上是限定驗收的邊界，不影響本次已確認的部署／公開檢查／指定管理員人工唯讀結果；後續如需擴大正式驗收，必須先明確測試範圍，不自行製造資料或弱化保護。

### 10.8 最終實際操作計數（Release-03 累計）

| 操作 | 次數／範圍 |
| --- | --- |
| 輔助腳本直接 Cloudflare GET | 32（含歷次診斷，2 次組織 403） |
| 輔助腳本 D1 Metadata SELECT POST | 19 |
| 正式 D1 Migration POST batch | 6，每版一次，無自動重跑 |
| 官方 Export POST | 2，為原本同一次備份的啟動／輪詢 |
| 備份下載 GET | 1，未重新下載或備份 |
| 正式網站唯讀 GET | 25（含部署前邊緣檢查、部署後 smoke、canonical 補查） |
| 真實外部 BGG API GET | 1，HTTP 200，0 快取寫入 |
| Wrangler CLI | 3：本機 types 1、versions upload 1、versions deploy 1 |
| 正式 Build／Worker 版本上傳／流量部署 | 各 1 |
| 新增必要 Secrets | 2，隨 version 19 上傳並啟用；既有 3 項 Access Secret 保留 |
| 新建／修改 Access App、Policy、IdP／DNS | 0 |
| 正式業務資料額外新增／編輯／刪除 | 0；僅已授權 Migration 的 Schema、ledger、同步控制初始化變更 |
| Preview D1、其他 Worker／D1 修改 | 0 |
| 正式還原、清除 DB、失敗 Migration 重試、批次 BGG 同步 | 0 |

直接腳本共記錄 86 次請求嘗試；Wrangler upload／deploy 自身的資產上傳、版本與部署等內部 API 未逐一攔截計數，**不把 86 說成所有遠端 HTTP 的總次數**。以實際三次 CLI 與一次版本上傳／部署記錄其副作用。使用者手動瀏覽頁面請求亦不在腳本計數內。

本次新增／更新的專案文件為本報告及公開架構參考的部署狀態註記；應用程式、舊 Migration 與核心驗證規則未因本次續行再修改。未提交或推送 Git。

**Release-03 已完成並停止。交由 ChatGPT 最終驗收，不自動執行其他正式變更。**

## 11. 進度保存與登入協作約定

使用者於 2026-11-12 指示：保存目前進度，網站登入以本次人工驗收通過為準，不再重複要求登入驗證；日後開發遇到必須由使用者登入的部分，直接提示並說明具體操作方式。

已保存於 [目前進度與後續協作紀錄](current-progress.md)，並由專案 AGENTS.md 引用。本次僅更新文件，未重新登入、發送正式環境請求或修改部署／資料。
