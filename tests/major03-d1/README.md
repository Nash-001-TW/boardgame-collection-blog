# MAJOR03 隔離 D1 候選工具

工作單 D1-MAJOR03-D1-PREP-002。前置 MAJOR03_D1_PREP_001_COMPLETE。狀態 AWAITING_USER_APPROVAL。所有案例及命令目前均未執行。

## 候選檔案

| 檔案 | 用途 |
| --- | --- |
| wrangler.local.json | 本機 Worker 與單一隔離 D1 設定 |
| worker.ts | 固定 POST 案例，使用既有數量提交流程和本機 D1 binding |
| fixture.sql | 4 筆合成收藏、6 個副本、組件、來源及清點資料，全部使用 test 範圍 |
| local-wrangler.mjs | 固定本機 Migration、fixture、啟動入口及 ledger 核對 |
| run-local.mjs | 固定 loopback HTTP 執行器，逐案輸出 NDJSON，遇首個失敗停止發送請求 |
| migration-manifest.json | 0001～0023 的檔名、順序及原檔 SHA-256 |
| preflight.mjs | 核對／複製 Migration 及遠端離線授權核對 |
| denylist.json | 正式資料庫、當地專用 UUID 及 Stage1 命名空間拒絕清單 |
| approval.pending.json | 零授權範本，沒有可操作的遠端 UUID |
| records.example.ndjson | 案例及資源事件記錄範本，null 欄位待填 |
| .gitignore | 排除 .run 本機狀態、身分紀錄、設定與證據 |
| README.md | 執行順序、驗收、授權及清理計畫 |

## 設定與資料邊界

獨立設定使用 worker.ts、MAJOR03_DB、自有本機名稱與本機專用 UUID，沿用正式相容日期。捨去正式設定的資產、KV、圖片、限流、Node 相容旗標，以及任何遠端 binding 或預覽 UUID。只有 127.0.0.1:18743 可連入，停用 workers.dev、預覽、公開路由及遙測。網路層由 Wrangler 綁 loopback，Worker 再檢查固定 origin、代理相關標頭、方法、路徑、空 body 及固定標頭。固定標頭供請求辨識，僅靠 loopback 和獨立本機狀態建立隔離。Worker 僅執行內建查詢及案例，不接受使用者提供的 SQL、參數或資料庫身分。

fixture 的簽章為公開合成常數，確認回呼只供隔離案例。驗收涵蓋服務及 Migration 0023 的 D1 行為。Admin 認證、正式來源簽章和正式資料相容性需另有驗收。

## 本機階段，待核准

從專案根目錄執行，每步確認成功才繼續。stage 只接受全新 .run，逐一核對原檔雜湊後複製 23 份原始位元組。保留歷史排序及 SQL，包括 0002 的交易語句。

```powershell
node tests/major03-d1/preflight.mjs stage
node tests/major03-d1/local-wrangler.mjs migrate
node tests/major03-d1/local-wrangler.mjs seed
node tests/major03-d1/local-wrangler.mjs serve
```

另開本機終端執行 `node tests/major03-d1/run-local.mjs`，保留 stdout 與 exit code。要求 23 筆 ledger 名稱與順序完全一致，以及四案全 PASS。監聽啟動、ledger、seed 或 loopback 傳輸失敗即停止。Stage1 曾在本機 binding 取得時失敗，如本階段遇到類似問題，保留證據並停止，遠端階段須獨立審批。

| 案例 | 驗收對照 | PASS 條件 |
| --- | --- | --- |
| replay | D1-10／12／16 | 同一操作兩次併發均取得成功收據，後續重播成功，數量 103→100、revision 2、收據一筆，已清點與借出副本證據正確且售出副本排除 |
| stale | D1-13 | 副本版本欄位改值後還原，generation 仍前進，原確認永久拒絕，數量、revision 與收據不變 |
| rollback | D1-11 的直接寫入守衛／D1 batch 回滾 | 批次第二步直接改數量遭 D1_CURRENT_OPERATION_REQUIRED，第一步副本版本欄位與 generation 一起回滾，數量、revision 與收據不變 |
| null | FIX-001 | NULL→0 成功並可重播，留下唯一收據，未清點實點數保持 null |

## 遠端階段，待獨立核准

遠端候選只有離線核對器。以下是審查用命令規格，沒有遠端指令入口被啟用。建立之前 Cloudflare 尚未分配 UUID，因此建立屬獨立帳號層級核准。只允許指定帳號與本次精確新名稱，任何名稱碰撞都停止。後續所有既有資料庫操作一律鎖定完整 UUID。

1. **建立**。使用者先核准帳號與精確新名稱 `notbgg-major03-d1-<12 位識別字元>`，再對 Cloudflare API 發出 `POST /client/v4/accounts/{accountId}/d1/database`，JSON body 為 `{"name":"<核准名稱>"}`。驗證成功回傳的名稱、UUID、帳號請求路徑，保存去敏建立回應、時間、核准及建立紀錄引用。碰到衝突、逾時或結果不明時停止，先人工對帳，不重送建立請求。
2. **登錄白名單**。收到使用者對新 UUID 及動作的核准後，以範本建立 .run/approval.json。僅一組 accountId、databaseName、databaseId。填寫允許動作、建立／核准引用及整份 Migration manifest SHA-256。建立證據存 .run/creation.json。由審查者對照 Cloudflare 建立回應及使用者核准紀錄。JSON 欄位只做一致性核對。
3. **身分核對**。在 .run/wrangler.remote.json 填入精確 account_id、唯一 MAJOR03_DB binding、核准 name／UUID、remote false、migrations_dir 為 ./migrations。workers_dev、preview_urls、send_metrics 為 false，routes 為空陣列。其餘鍵省略。每次先執行 `node tests/major03-d1/preflight.mjs remote info`，成功才對 `GET /client/v4/accounts/{accountId}/d1/database/{databaseId}` 送請求。比對完整帳號路徑及回傳 UUID、名稱。把已核對值、下一個 action 及 UTC 時間存 .run/observed.json，再對該動作執行 preflight。超過五分鐘、回應異常、設定／帳號／UUID／binding／manifest 不符即停止。
4. **套用及核對 ledger**。需另獲 Migration 及指定 UUID 授權。成功執行 `node tests/major03-d1/preflight.mjs remote migrate` 後才使用下方命令草案。執行前鎖定本機已安裝 Wrangler 4.149.0，確認有效 account_id 與任何帳號環境變數一致，覆核設定未被替換。本機原始碼顯示該版會優先以明確 binding 解析精確設定 UUID。另取得 verify-ledger 授權後重做身分核對，再對 `POST /client/v4/accounts/{accountId}/d1/database/{databaseId}/query` 發出固定 SQL `SELECT name FROM d1_migrations ORDER BY id`。23 筆完全符合 manifest 才可標成功。部分 Migration 失敗時保存 ledger 與錯誤，停止並審查，切勿重建、跳過或手改 ledger。
5. **遠端範圍**。遠端候選只規劃空庫 Migration 與 ledger，fixture 及 Worker 保留在本機。正式與 Stage1 名稱、已知正式 UUID、本機 UUID 都優先拒絕，並對比根設定所列的正式及預覽 UUID。Stage1 證據記載 P3_TEST 與 p3-stage1-synthetic- 前綴，沒有可列入的遠端 UUID。如後續發現曾建立 Stage1 遠端資源，先補登其確切名稱與 UUID。名稱前綴只限制命名，授權以精確 UUID、建立紀錄及動作核准為準。

```powershell
# 僅在完成上述授權及身分核對後
node node_modules/wrangler/bin/wrangler.js d1 migrations apply MAJOR03_DB --remote --config tests/major03-d1/.run/wrangler.remote.json
```

Cloudflare API 請求僅使用官方 https://api.cloudflare.com，不跟隨重新導向。憑證透過後續核准階段的本機驗證流程取得，記錄不得包含 token、Cookie、授權標頭或憑證內容。命令參數與 config 以官方 [D1 Wrangler 文件](https://developers.cloudflare.com/d1/wrangler-commands/)及 [Wrangler 設定文件](https://developers.cloudflare.com/workers/wrangler/configuration/)為準。

## 清理與記錄

- 本機以 Ctrl+C 關閉 Wrangler，確認該次程序退出及 loopback listener 已釋放。保存去敏案例 NDJSON、ledger、manifest 雜湊及環境失敗代碼。需要新一輪時先確認解析後的清理目標確為本目錄內的 .run，且沒有連結或重解析點，再清除本次 state、設定與暫存副本。
- 遠端銷毀需獨立 delete 核准並重做新鮮身分核對。僅 `DELETE /client/v4/accounts/{accountId}/d1/database/{databaseId}`，保存成功回應及請求識別；再以獲准的 info 對同一 UUID 確認資源不存在，權限錯誤不能記為已銷毀。最後撤銷白名單並保留前後證據。目標不明或 API 結果不明時停止，交由人工對帳。
- 案例記錄使用 NOT_RUN／PASS／FAIL／BLOCKED。資源事件使用 CREATED、ACTION_RESULT，將建立、Migration、驗證與銷毀分開記錄，保存 UTC、精確 UUID、核准來源、結果及去敏證據引用。

下一步請分開核准本機 Migration、合成 fixture 寫入與固定案例執行。遠端建立、UUID 白名單登錄、遠端 Migration／ledger 及銷毀各自等待適用核准。

REMOTE_D1_NOT_AUTHORIZED  
MIGRATION_EXECUTION_NOT_AUTHORIZED  
DEPLOYMENT_NOT_AUTHORIZED
