# V2-Release-01 — 正式上線前準備摘要

日期：2026-11-11。範圍：本機完整建置、隔離 Migration 串接及實際 Worker 產物驗證。**未執行正式環境操作，不能據此宣告正式環境已準備完成。**

## 建置結果與隔離方式

- 完整 `npm run build`：PASS，含既有 `prebuild`、Worker／client 編譯及靜態預渲染。
- 既有 `prebuild` 為 `npx wrangler types && node scripts/ensure-bgg-collection-cache.mjs`。
  - 前者產生本機型別；後者保留現有本機 JSON，只有檔案不存在才從範本建立。
  - 沒有 D1、Migration、Secrets 寫入或部署命令。
- 在獨立建置副本執行：未複製 `.env`／`.dev.vars`；D1／KV 使用合成識別碼；未使用原有資料庫或 Wrangler 狀態。
- 停用遙測、套件下載及遠端綁定；額外網路防護只允許本機預渲染通訊。未呼叫真實 BGG API。
- 此隔離產物包含合成綁定，**不得直接拿來正式部署**。正式部署前需在核准的設定下重新建置並核對綁定。
- 編譯產物包含 `dist/server/entry.mjs`、server chunks、`dist/client`、產物 Wrangler 設定及 deploy 設定指向；`DB`、`SESSION`、`ASSETS`、`IMAGES`、`NOTBGG_WRITE_LIMITER` 名稱保留。
- 公開首頁／清單／既有及新增 BGG／NotBGG 詳細頁均維持動態路由，沒有被重新產生為過期的靜態遊戲頁。
- 掃描 132 個文字產物，沒有出現本機設定檔中的 Token／Secret 值。此結果不代表已確認正式 Secrets 存在。

## 設定檢查（不記錄值）

| 設定名稱 | 本機存在情況 | 必要性／正式狀態 |
| --- | --- | --- |
| Worker `name`、`main` | 已設定 | 必要；主入口為 `src/worker.ts`，正式目標仍需核對 |
| `compatibility_date`、`nodejs_compat` | 已設定 | Worker／Adapter 相容設定 |
| `DB` | D1 綁定及識別設定存在 | V2 資料讀寫必要；正式連線與 Migration 版本未知 |
| `SESSION` | KV 綁定及識別設定存在 | 目前 Adapter 啟用的 session 儲存 |
| `ASSETS` | 已設定 | 靜態資產必要；遊戲路徑的 `run_worker_first` 已保留 |
| `IMAGES` | 已設定 | 目前 Adapter 選用的 Cloudflare Images 處理 |
| `NOTBGG_WRITE_LIMITER` | 已設定 | Admin 寫入必要，缺少或失敗時拒絕寫入 |
| `ACCESS_TEAM_DOMAIN` | `.dev.vars` 存在 | 管理員 JWT issuer／驗證必要；正式狀態未知 |
| `ACCESS_AUD` | `.dev.vars` 存在 | 管理員 JWT audience 必要；正式狀態未知 |
| `ADMIN_EMAIL` | `.dev.vars` 存在 | 管理員授權必要；正式狀態未知 |
| `BGG_API_TOKEN` | `.env`、`.dev.vars` 存在 | 伺服器同步必要；正式狀態未知 |
| `PHYSICAL_COMPONENT_SIGNING_KEY` | 所檢查本機設定檔未提供 | 可信任實體來源建立／驗證必要；正式狀態未知 |
| `LOCAL_ADMIN_DEV` | `.dev.vars` 存在 | 僅開發用途；正式授權不得依賴此旗標 |
| 自訂網域／Worker routes、Access 應用政策 | 本機 Wrangler 未設定自訂網域 routes；雲端政策未查詢 | 正式上線前核對；不能推定不存在 |

`PHYSICAL_COMPONENT_SIGNING_KEY` 需至少 32 UTF-8 bytes，且必須穩定保管。若已有可信任來源紀錄，不可直接用新金鑰取代舊金鑰，否則既有證據可能無法驗證；本階段沒有建立、輪替或上傳金鑰。

## Migration 依賴與風險

0001～0022 編號連續、無重複編號。全新隔離 SQLite 串接成功；每步外鍵檢查與最終完整性檢查通過。另在 0016 基準建立合成歷史資料，驗證 0017～0022 保留原有欄位、ID、Legacy Map、卡套引用、庫存交易、套用及採購資料。

| Migration | 依賴／功能 | 上線注意事項 |
| --- | --- | --- |
| 0017 | 0007、0011、0015 的組件／副本／需求、Legacy Map 與管理資料 | 新來源表初始空；原商品不取得可信任身分。來源驗證需要穩定簽章金鑰；新增身分保護觸發器 |
| 0018 | 0011 卡套產品與交易 | 新增產品版本及不可變 command receipts，不重算歷史庫存 |
| 0019 | 0007 副本 | 新增副本 command receipts，不建立或改寫歷史副本 |
| 0020 | 0011 套用／交易／清點／需求表 | 新增 nullable 需求引用，不回填舊套用；有舊未對應套用的收藏，其需求修改會保守鎖定 |
| 0021 | 0007、0008、0010 採購與副本狀況 | 舊採購 `admin_managed=0`，不由新編輯器接管；新增狀況欄位不覆寫舊 notes |
| 0022 | 0001 BGG、0007 關聯 | 不回填快取或成功時間；舊手動遊戲關聯預設待確認，可能須人工確認才公開；新增依賴型關聯循環防護 |

- 0017～0022 沒有對既有歷史列執行清除、價格回填或重新分類的 SQL；0022 只初始化新同步控制表的一列。
- 沒有重複建立既有欄位／資料表；但含 `ALTER TABLE ADD COLUMN`，**不是可任意重跑的冪等腳本**。隔離測試確認重跑 0017 會被 duplicate column 拒絕。
- 較早 Migration 仍有資料操作／結構重建，例如 0002 尺寸去重、0012 舊資料轉換、0013 特定測試資料標記、0015 關聯表重建。因此不能因新六個檔案屬加法擴充，就不查正式紀錄而重跑整條歷史鏈。
- 未查詢正式／Preview D1，無法判定正式還有哪些待套用版本；若實際 Schema 與 Migration ledger 不一致，應停止並另行審查。

## 修正、驗證與仍待確認事項

- `astro.config.mjs` 加入 `cloudflare({ remoteBindings: false })`，避免本機建置／開發建立遠端綁定代理。沒有修改正式綁定或 Secrets。
- 初次隔離副本無法建立依賴 junction，離線 npx 因套件不可用而中止，當次 Wrangler 未啟動；建立本機依賴 junction 後解決。
- 本機網路防護曾阻擋預渲染 loopback，後續修正隔離防護的 HTTP dispatcher／Response 類型相容性；沒有修改 Astro／Cloudflare 套件來跳過驗證。
- 最終完整建置 PASS，沒有發現需修改 V2 業務邏輯的建置錯誤。
- 新增 `tests/release-migration-chain.test.ts`：1 PASS，包含 122 筆**合成**歷史商品定義保留與空來源表驗證；不是對正式 122 筆資料的查詢或保證。
- 新增 `scripts/validate-release-artifacts.mjs`：靜態產物檢查 PASS；實際編譯 Worker 在全新本機 Miniflare 中通過 13 個路由檢查、307 別名及缺 Schema 的 503。未登入 Admin／API 拒絕正常。
- Worker 測試停用外部網路，使用合成 DB／KV／Assets／rate limiter；未測試真實 Images 服務、正式 Access 登入或真實 BGG 認證。
- 上線阻礙仍是**尚未核對的正式 Migration 狀態、備份、綁定、Secrets、網域與 Access 政策**，不能以本機設定檔推定雲端已具備。

## 後續正式操作順序與授權邊界（本階段未執行）

| 順序 | 最小必要操作 | 需要使用者明確授權的範圍 |
| --- | --- | --- |
| 1 | 確認正式 Worker／DB 目標、Migration ledger 與必要 Schema 一致性 | 正式 Cloudflare 設定與 D1 唯讀存取；不可連錯 Preview |
| 2 | 備份正式 D1，確認備份檔可用及儲存位置 | 正式資料匯出、私人備份保存；不得把內容輸出至聊天或 Git |
| 3 | 核對必要 Secrets、穩定簽章金鑰、Access issuer／audience／管理員與網域政策 | 雲端設定／Secret 名稱唯讀核對；補設或修改 Secrets／政策須另授權寫入 |
| 4 | 審閱並只套用實際待套用的 Migration | 明確正式 DB、版本範圍與 Migration 寫入授權；先完成備份 |
| 5 | 以核准設定重新建置並部署 Worker／Assets | 正式部署、路由／資源設定變更授權；不可部署本次合成綁定產物 |
| 6 | 驗證公開頁、舊 slug、新 ID、404／503、canonical、sitemap 與快取 | 正式網站唯讀驗收，包含頁面產生的 D1 讀取 |
| 7 | 驗證 Access：未登入、非管理員與管理員 | 正式登入與授權政策驗收，不繞過 Access |
| 8 | 小量驗證 BGG 同步 | 真實 BGG API 呼叫及正式 BGG 快取寫入授權 |
| 9 | 驗證主要 Admin 操作，先讀取，再逐項核准寫入 | 正式收藏／副本／組件／卡套／採購等寫入須明確授權測試範圍與資料處理方式 |

## 實際操作計數

- Wrangler CLI：`npx wrangler types` **4 次**，均在隔離副本，只產生本機型別。另一次離線 npx 失敗在 Wrangler 啟動前。
- Wrangler 部署、D1 查詢、Migration、Secret 命令：**0 次**。
- 正式／Preview D1 存取、正式 Migration、正式 Secrets 修改、Worker 部署、真實外部 BGG API：均 **0 次**。
- SQLite Migration 與資料操作僅在新建的記憶體／本機隔離資料庫進行，未清除既有資料庫。

本階段完成後停止；上述表格是計畫，不是正式操作授權。
