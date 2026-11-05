# D-7A-R6：正式唯讀查核與部署候選準備

日期：2026-11-05（Asia/Taipei）。**結論 NO-GO，R6 完成後停止，不開始 D-7B。** 本輪沒有改 NotBGG 功能、Migration、Git Index 或正式設定。已解除 R5「OAuth 過期」阻擋，正式 D1 基線現在有實際唯讀證據；其餘狀態逐項列出。

## 1. 16 個歷史 metadata：逐檔審核 PASS／處置待核准 BLOCKED

16 檔 SHA256 與 R5 全數相同；15 個 JSON 為 UTF-16LE BOM，NDJSON 為 UTF-8。本輪先正確解碼，再審核完整內容與巢狀 keys/values，不只查關鍵字；未見 Token／私鑰／憑證值，已知本機敏感值 exact comparison 無命中。內容為正式業務聚合、Schema、tracking 或操作 metadata，**不是公開合成資料**；報告不轉載私人統計值、帳號識別或使用者路徑。

| 完整檔名 | 用途 | 來源 | 敏感內容類別 | 部署必要 | 建議處置 |
| --- | --- | --- | --- | --- | --- |
| `docs/reference/d1_collection_status.json` | 收藏 acquisition_status／record_scope 聚合 | 歷史正式 D1 SELECT 聚合，非 row 明細 | 私人業務統計及 API 執行 metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/d1_v2_counts.json` | V2 各主要表數量基線 | 歷史正式 D1 SELECT 聚合 | 私人規模統計及 API 執行 metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/d1_v2_schema.json` | V2 tables／DDL 快照 | 歷史正式 sqlite_schema 查詢 | Schema 與 API 執行 metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1D_20261027_R03_run_summary.ndjson` | C1 R03 執行、重試與 hash chain 摘要 | 2026-10-27 C1 runner；只含部分工作摘要 | 帳號／DB 識別、本機路徑、執行紀錄 | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_acquisitions_columns.json` | acquisitions 欄位／型別 | C1 PRAGMA table_info | 欄位預設值與 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_acquisitions_fk.json` | acquisitions 外鍵 | C1 PRAGMA foreign_key_list | FK 結構及 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_acquisitions_indexes.json` | acquisitions 索引 | C1 PRAGMA index_list | 索引結構及 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_acquisitions_unique_columns.json` | acquisitions UNIQUE 索引欄位 | C1 PRAGMA index_xinfo 類證據 | 索引欄位及 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_copies_columns.json` | owned copies 欄位／型別 | C1 PRAGMA table_info | 欄位預設值與 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_copies_fk.json` | owned copies 外鍵 | C1 PRAGMA foreign_key_list | FK 結構及 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_copies_index_columns.json` | owned copies 索引欄位 | C1 PRAGMA index_xinfo 類證據 | 索引欄位及 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_copies_indexes.json` | owned copies 索引清單 | C1 PRAGMA index_list | 索引結構及 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_fk_check.json` | 當時 FK 完整性結果 | C1 PRAGMA foreign_key_check | 執行 metadata；非現在正式結果 | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_master.json` | tables／indexes／triggers／views 完整 DDL | C1 sqlite_master 查詢 | 完整 Schema 與 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_migrations.json` | 歷史 Migration tracking | C1 d1_migrations 查詢 | Migration 日期與 API metadata | 否 | 排除 release Commit；人工核准後安全封存原文 |
| `docs/reference/phase-c1/d1_C1_quick_check.json` | 當時 SQLite integrity 結果 | C1 PRAGMA quick_check | 執行 metadata；非現在正式結果 | 否 | 排除 release Commit；人工核准後安全封存原文 |

**版本控制來源查核 PASS（範圍明確）**：各檔在 main／origin 分支歷史皆沒有相同 Blob，也沒有正常路徑提交紀錄。git rev-list --objects --all 的相同內容來自 refs/codex/turn-diffs/* 的內部 tree 快照；不是可依賴的正式 Commit／遠端備份，可能受快照清理影響。外部 repository 是否另有版本 **NOT VERIFIED**，沒有宣稱不存在。C1 的 12 個 JSON SHA256 與 R03 run summary 內 manifest 全數吻合，提供歷史來源一致性；前 3 個一般快照的精確收集時間不具自驗證依據。

**逐檔建議均為提案，未套用**：不把原始正式 metadata 納入 release；在人工選定且確認 ACL／加密／保留期的受保護位置封存原文與 SHA256 manifest，保留 R03 chain／相關 runner 身份及用途說明。可在 Git 提交 R6 的最小安全摘要；Schema 的可重建來源使用 migrations／合成測試，不把歷史正式 SQL 快照當 deployment input。沒有刪除、搬移、遮罩原檔或修改 .gitignore；須人工確認後才可執行封存或調整提交範圍。

詳證據：metadata-review.json，每檔含 encoding、hash、來源、Git 查核與建議。

## 2. OAuth — PASS；部分 API 權限仍 BLOCKED

Wrangler 本機 OAuth expiry 為 2026-11-05T01:15:03.160Z（台北 09:15:03）；查核約台北 08:15～08:25 時有效。實際 accounts、指定 D1 metadata、Worker deployments/settings/version 等 GET 成功，證實不只本機檔案看起來有效。Token 僅於記憶體用於 Cloudflare API Authorization，未輸出／保存；未 refresh、重新登入或繞過授權。Access organization 與 subscriptions GET 為 403／10000，個別項目保留 BLOCKED。授權狀態只代表查核當時，不保證之後仍有效。

若後續 OAuth 再過期，停止正式查核，由人工在專案終端執行 `npx wrangler login`，於瀏覽器確認正確 Cloudflare 帳號及範圍，再以 `npx wrangler whoami` 確認；不要貼 Token／cookie／完整敏感輸出。R6 沒有代為登入。

## 3. 正式唯讀盤點

| 項目 | 狀態 | 本輪實際證據／限制 |
| --- | --- | --- |
| Worker／部署版本 | PASS | boardgame-collection-blog；version 75e4aec7-6bdb-4202-bee4-a0827dcbca53，100%；deployment 2006142e-9631-451f-bd21-958da6f16572，2026-10-21T09:22:18.403099Z |
| 正式 hostname | PASS | boardgame-collection-blog.nash0710-001.workers.dev；workers.dev enabled、preview enabled |
| Custom Domain | PASS（該帳號清單）／NOT VERIFIED（其他 DNS） | account Worker domains 清單沒有此 service 對應；不推定外部 DNS／其他帳號沒有設定 |
| Zone Route 完整清單 | BLOCKED | account filter 下可見 zones=0，無 zone route 可讀；不能將空清單當作所有路由不存在 |
| ASSETS binding | PASS | 目前 version/settings 都有 ASSETS、type=assets |
| 正式 ASSETS router／worker-first | NOT VERIFIED | API 回傳只有 binding，沒有 assets router config；已安裝 Wrangler 的遠端 config 比對也註明 assets remotely 至多回傳 binding；不能以候選 wrangler.json 代替 |
| D1 ID／Binding | PASS | DB→59e9a17a-ff0f-494e-aab9-dd903a14e395；DB name=boardgame-collection-db，metadata 證實唯一目標帳號 |
| 正式 Migration／Schema | PASS（讀取） | 確認 0001～0013，0014～0016 未登記；見下節 |
| Access 匿名保護 | PASS | /admin、/admin/notbgg、/admin/collection 皆 302 至 noisy-glade-c822.cloudflareaccess.com，private/no-store；未跟隨登入、未使用測試 Token |
| Access Team／Audience／管理員 policy | BLOCKED | Team domain 僅由 challenge Location 觀察；organization GET 403，account App 清單未提供對應 App。Secret 名稱存在不代表值／Audience／policy 正確；尚無有效管理員登入驗證 |
| Secret 名稱 | PASS（名稱） | ACCESS_AUD、ACCESS_TEAM_DOMAIN、ADMIN_EMAIL 皆為 secret_text；未讀值。其他維護／BGG 憑證是否需正式 runtime 依功能流程另核對 |
| Rate Limiter | FAIL | 目前 settings/version 無 NOTBGG_WRITE_LIMITER／ratelimit binding；本輪不新增 |
| KV | PASS | SESSION→c8cacd003f7043f7a12368210f91e256，與候選相同 |
| Images | PASS | IMAGES，type=images |
| R2 | PASS（盤點） | settings/version 未綁定 R2；不代表需要新增 |
| Storage／Time Travel 類型 | PASS（metadata） | D1 version=production，符合新 storage 的 Time Travel 類型；未查 bookmark／未備份／未恢復 |
| 方案／Time Travel 保留期 | BLOCKED | subscriptions GET 403，不能選定 7／30 日或假定正式保障 |

Cloudflare response 的部署者 email 等非必要識別已從交付證據移除，只留版本／時間／binding 等必要 metadata。完整唯讀 request path、HTTP 結果及安全摘要見 cloudflare-readonly.json；SQL POST 是 Cloudflare query API 傳輸方式，內容只有 SELECT／唯讀 PRAGMA，沒有正式寫入。

### 正式 canonical／CDN — FAIL（現行部署觀察）

抽樣 /games/santorini、/en/games/santorini、.html、index.html、/games、/en/games：先 307 加尾 slash，最終 200。用不受 link attribute 順序／quoted/unquoted 影響的 parser 複查，六組最終回應皆無 canonical link。既有靜態頁 Cache-Control=public,max-age=0,must-revalidate，重複讀取觀察到 MISS→HIT；初段 307 沒有 Cache-Control。這是**目前 2026-10-21 部署**，不是 V1.2 候選測試失敗，也不是已部署 F1。

正式 hostname 已知，但 canonical 目標／Cache Rules／Worker-first 整合尚不能放行。R5 的 F1 210 個 HTTP 情境為本機候選證據；R6 只執行現有公開頁的非破壞性抽樣，沒有為測試而在正式建立／對應／解除／封存資料。

## 4. 正式 D1 Migration／Schema — PASS（唯讀基線）

先實際 SELECT sqlite_schema 名稱／類型，再 PRAGMA table_info 確認 tracking 欄位，才讀取 d1_migrations 的 id/name/applied_at。**現在才確認正式已到 0013，並非沿用歷史假設**。13 筆登記檔名依序符合 0001～0013；0014／0015／0016 全部未登記。NotBGG／site relation／management 等預期新增物件數為 0，三個 pending migration 的 CREATE 名稱沒有與現有 Schema 相撞。

PRAGMA foreign_key_check 回傳 0 違規，quick_check=ok；核對 v2_collection_items、v2_games、v2_owned_copies 既有欄位。沒有讀取收藏名稱、備註、價格或私人 row，也沒有新匯出正式 SQL。物件名稱沒有衝突不代表所有正式資料都已完成升級相容驗證；未執行 migration 或正式測試寫入。

```sql
SELECT type,name,tbl_name FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name;
PRAGMA table_info(d1_migrations);
SELECT id,name,applied_at FROM d1_migrations ORDER BY id;
PRAGMA foreign_key_check;
PRAGMA quick_check;
PRAGMA table_info(v2_collection_items);
PRAGMA table_info(v2_games);
PRAGMA table_info(v2_owned_copies);
```

未讀取遠端 0003 SQL 原文／checksum；tracking 只證明檔名已套用，不證明遠端檔案 bytes 與候選相同。正式備份／完整資料恢復驗證仍 BLOCKED。

## 5. 原 SQL dump 失敗：確切根因 PASS

使用與 R5 相同專案 migrations／Wrangler、全合成資料、隨機本機 D1 與獨立 config/persistence，再次產生 SQL export。**原樣 import 仍 FAIL**：no such table: main.notbgg_game_revisions。

原 export statement 的零起始順序：63～64 insert notbgg_ids；65 create notbgg_games；**66～67 insert notbgg_games**；68 才 create notbgg_game_revisions；69～70 insert revisions。notbgg_games 的 (seq,revision) 外鍵指向尚未建立的 revisions 表，且該表又參照 profile，形成循環。即使 constraint 宣告 DEFERRABLE INITIALLY DEFERRED，SQLite/D1 在 INSERT 時仍必須解析被參照表；延後 row constraint 不等於允許缺少 table definition。

**原始失敗點前有 0 個 Trigger**。因此 R5 對「Schema／Trigger 依賴」的概括描述在 R6 細化：第一個失敗由 Schema 建立／資料交錯順序與 FK 目標表解析造成，不能歸因 Trigger 或 BOM／SQL parser 語法不相容。

| 隔離控制組（實際 D1 batch） | 結果 | 解讀 |
| --- | --- | --- |
| 原 export 順序，移除所有 Trigger | FAIL：同一 missing revisions table | 排除 Trigger 是第一個錯誤的原因 |
| 所有 table 先建，無 Trigger，defer FK | PASS | export SQL 語法與資料可被 D1 接受，Schema 順序是必要修正 |
| 所有 table 先建，無 Trigger，未另加 defer PRAGMA | PASS | 此單一 batch fixture 本身有 deferred constraints；不宣稱 PRAGMA 是此案例唯一必要條件 |
| table 齊全，先建 Trigger 再載入歷史 rows | FAIL：LINK_SOURCE_CONFLICT | 另外存在歷史事件與 command guard 的重播順序衝突 |
| table→rows／sequence→indexes→Trigger | PASS | 受控恢復，不讓 runtime command guard 重新審核歷史寫入命令 |

**格式相容性結論**：Wrangler export 產生可解析 SQL，execute 支援同一格式，但此循環 FK＋歷史 Trigger Schema 的原始 data-bearing dump 不能原樣 round-trip。不是匯出成功就能還原，也不是單改副檔名／關閉 FK 就解決。沒有修改 Migration 或正式配置。

### 受控合成恢復 — PASS

真實 Wrangler --local 從原專案 migrations 建 source（16 筆 tracking），建立兩個 NotBGG、關聯、兩筆不同 scope 的合成收藏／副本／購買，以及 propose→confirm→revoke 三筆 link events。保留 raw FAIL，改用另一個全新 target：

1. Wrangler splitter 解析；未知 statement fail closed，原 export 不覆蓋。
2. 先建齊所有表；同批次以 defer_foreign_keys=ON 載入完整 rows。
3. 以來源 sequence manifest 還原 sqlite_sequence，確保永久 ID／下一號不倒退。
4. 建 indexes/views，最後建立原 Trigger；不改 Trigger SQL。
5. 逐表 rows、完整 Schema、tracking、sequence deep equality；FK check 空、quick_check=ok。

本輪 40 table statements、68 row statements、53 indexes、56 Trigger。核對收藏 2、副本 2、orders 2、order lines 2、acquisitions 2、allocations 2、NotBGG 2、v2_games 3、site relation 1、link 1、link events 3；synthetic production/test 各 1，revision／collection／relation／link 歷史全表一致。

匯出 SHA256：`e4b4acc98b881f611df9bcdac8886e78e623b58dbd4a329b13b4c04c3531fe8b`；受控 SQL SHA256：`ae4ae9f412db71669fc8bf2f37124c43fc528cc2387b596acff9116e19a690d1`。原始資料與 dump 僅為合成資料，位於臨時／ignored 路徑，不含正式 row。可重跑 source、診斷結果及全表數量存 restore-evidence.json。這是本機恢復證據，不是正式 Time Travel 驗收，也不是獲准正式執行的 loader。

### D1 支援路徑與正式適用性 — PASS（能力／storage）／BLOCKED（正式恢復）

[Time Travel 官方文件](https://developers.cloudflare.com/d1/reference/time-travel/) 提供新 storage 時間點恢復，Free 最多 7 日、Paid 最多 30 日；正式 metadata 已確認 production storage，因此類型適用。方案權限不足，實際保留期仍 BLOCKED。還原會覆寫資料庫並中止進行中的查詢；本輪未取得 bookmark 或執行正式備份／恢復。

[SQL import/export 官方文件](https://developers.cloudflare.com/d1/best-practices/import-export-data/) 支援 SQL 匯出與 execute --file，raw SQLite 檔不能直接 import。長期／異地備份仍可規劃受保護 SQL＋Schema／sequence manifest，但要審查本輪受控 loader、正式規模／批次／quota，並在另行核准的受保護目標驗證。不能把正式私人 dump 放入本輪合成測試。

[D1 外鍵文件](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) 說明 D1 的 FK 強制與 defer 行為；defer 不能修補尚未建立的 table。傳統 alpha snapshot 不是本正式 production storage 的首選流程。Worker rollback 只換程式，不能代替 D1 Schema／資料恢復。正式備份還原、RTO／RPO、可接受停機與資料損失仍 BLOCKED／NOT VERIFIED；上線後新寫入若被舊恢復點覆寫會損失，不能假定零損失。

## 6. 224 路徑最終檢查與六組依賴

**PASS（檢查）**：R5 的 224 路徑全部存在，逐檔 SHA256 未變；HEAD 仍為 469866d6f7e3aed947f9f1c2e0d59b9cc16961a2，Branch main，cached diff 空。新 R6 證據另列，不更動 R5 的歷史報告或檔案。原始 224 清單的逐檔 disposition／hash／group 在 git-candidate.json，並於下方逐檔列出。

原 224 中：**206 INCLUDE PROPOSED**（待人工核准）、**16 HOLD**（建議排除 raw metadata 並安全封存，未執行）、**2 EXCLUDE**（沿用已核准暫存排除原則）。INCLUDE 是提交提案，不是已 stage／已核准。必要 Worker、0014～0016、F1/F2 與測試皆在 206 清單內；私人 cache／環境檔／dist／本機 D1 仍不納入。

### 0003 — PASS（SQL／預期 Blob）／BLOCKED（提交策略核准）

工作檔 491 bytes，SHA256 211ed3bb90dc24e5be0e39dc6b7b6662967b3b9863099f582ab020835b8f11f0，與 R4 驗收完全相同，含一個 CRLF。HEAD Blob 493 bytes，BOM＋LF。無 .gitattributes／effective attribute，core.autocrlf=input；預期 clean Blob 為 490 bytes、全 LF、OID b80fa2945d8b5ea3ae1ddf5441163dd22c95ced6、SHA256 5f70e687a582c2cb8c4598a7bd776b205b12e4a59d738b1d281ac7552805e76e。預期 Blob 精確等於 HEAD 移除 BOM，沒有其他 SQL 差異。

R6 以兩個隔離 D1 分別套用 R4 工作文字與預期 LF 文字：Trigger Schema 相等（2 個）；合法 INSERT 成功，非法 INSERT／UPDATE 均拒絕，**PASS**。因此預期 Git Blob 的 SQL 行為已驗證，但**不能說它的 raw bytes 等於 R4 混合換行檔**；需要人工核准保留既有 LF Git 正規化策略。未改 .gitattributes／Migration／Git 設定、未 stage；尚未有真正 Commit 的 clean-checkout 全套 release 驗收。

### 依賴分析與最終 Commit 提案 — BLOCKED（待核准）

六組是合理的審查單元，但不能當成六個可依序獨立建置的 Commit。相對 imports 實證存在 01↔02、01↔03、02↔03 循環；例如 02 的 GameSummary 依賴 03 的 collection-v2-adapter，03 的 CollectionPage 又依賴 02 的 GameSummary／controls／i18n；05 Worker 依賴 02／03 gateway／identity。僅重排 01→02→03 不可能解除這個循環，不能宣稱每組中間版本已可建置。

**推薦保留六組審查清單，採三個原子 Commit；此為變更提案，未套用、待人工核准：**

| 順序 | Commit 範圍 | 依賴及 gate |
| --- | --- | --- |
| 1 | 04：0003 BOM，1 檔 | 人工核准預期 LF Blob；獨立相容性提交 |
| 2 | 01＋02＋03＋05 runtime，116 檔 | 一起納入相依 source、package／lock、0014～0016、F1 Worker／gateway／Wrangler；避免任何中間缺模組版本 |
| 3 | 06 測試與安全文件證據（原 89 檔＋本輪 7 檔） | 排除提案中的 16 raw metadata 待人工確認；在清理後 clean checkout 跑全套驗收，才可稱候選 Commit |

若人工堅持六個獨立功能 Commit，須另核准逐 hunk／模組分拆及對應測試計畫，不能自動拆已驗收功能。本提案無需修改功能，只把強相依變更作原子提交；沒有擅自搬移 gateway 或任何檔案。完整每個推薦 Commit 的檔案清單在 git-candidate.recommendedCommitPlan。

### 原六組逐檔清單（保留原分組，僅加處置）

#### 01 BGG 匯入及資料基線

- `package-lock.json` — INCLUDE PROPOSED
- `package.json` — INCLUDE PROPOSED
- `scripts/bgg-relations-import.ts` — INCLUDE PROPOSED
- `scripts/check-bgg-collection-sync.ts` — INCLUDE PROPOSED
- `scripts/lib/local-games-preview.ts` — INCLUDE PROPOSED
- `scripts/lib/relation-import-engine.ts` — INCLUDE PROPOSED
- `scripts/preview-games.ts` — INCLUDE PROPOSED
- `scripts/validate-bgg-relations-b3a.ts` — INCLUDE PROPOSED
- `scripts/validate-bgg-relations-b3c.ts` — INCLUDE PROPOSED
- `scripts/validate-bgg-relations-b41.ts` — INCLUDE PROPOSED
- `scripts/validate-bgg-relations-b42.ts` — INCLUDE PROPOSED
- `scripts/validate-bgg-relations-b43.ts` — INCLUDE PROPOSED
- `src/data/bgg-cache.json` — INCLUDE PROPOSED

#### 02 Catalog／詳情與共用 UI（B／C）

- `src/components/CatalogBrowserControls.astro` — INCLUDE PROPOSED
- `src/components/CatalogCard.astro` — INCLUDE PROPOSED
- `src/components/GameBrowserControls.astro` — INCLUDE PROPOSED
- `src/components/GameDetail.astro` — INCLUDE PROPOSED
- `src/components/GameList.astro` — INCLUDE PROPOSED
- `src/components/GameRelations.astro` — INCLUDE PROPOSED
- `src/components/GameSignals.astro` — INCLUDE PROPOSED
- `src/components/GameSleeves.astro` — INCLUDE PROPOSED
- `src/components/GameSummary.astro` — INCLUDE PROPOSED
- `src/components/Header.astro` — INCLUDE PROPOSED
- `src/i18n/accessory-categories.ts` — INCLUDE PROPOSED
- `src/i18n/bgg-zh-TW.ts` — INCLUDE PROPOSED
- `src/i18n/catalog-browser.ts` — INCLUDE PROPOSED
- `src/i18n/ui.ts` — INCLUDE PROPOSED
- `src/i18n/utils.ts` — INCLUDE PROPOSED
- `src/layouts/Layout.astro` — INCLUDE PROPOSED
- `src/lib/bgg-identity-gateway.ts` — INCLUDE PROPOSED
- `src/lib/catalog-browsing.ts` — INCLUDE PROPOSED
- `src/lib/catalog-payload.ts` — INCLUDE PROPOSED
- `src/lib/catalog-presentation.ts` — INCLUDE PROPOSED
- `src/lib/catalog-selection.ts` — INCLUDE PROPOSED
- `src/lib/catalog-store.ts` — INCLUDE PROPOSED
- `src/lib/detail-relations-controller.ts` — INCLUDE PROPOSED
- `src/lib/detail-relations.ts` — INCLUDE PROPOSED
- `src/lib/game-browser-capabilities.ts` — INCLUDE PROPOSED
- `src/lib/game-browser-url.ts` — INCLUDE PROPOSED
- `src/lib/game-catalog.ts` — INCLUDE PROPOSED
- `src/lib/game-complexity.ts` — INCLUDE PROPOSED
- `src/lib/game-content.ts` — INCLUDE PROPOSED
- `src/lib/game-detail-controller.ts` — INCLUDE PROPOSED
- `src/lib/game-detail-presentation.ts` — INCLUDE PROPOSED
- `src/lib/game-list-controller.ts` — INCLUDE PROPOSED
- `src/lib/game-name.ts` — INCLUDE PROPOSED
- `src/lib/game-view-model.ts` — INCLUDE PROPOSED
- `src/lib/games.ts` — INCLUDE PROPOSED
- `src/lib/relation-direction.ts` — INCLUDE PROPOSED
- `src/lib/relation-display.ts` — INCLUDE PROPOSED
- `src/lib/relation-import-plan.ts` — INCLUDE PROPOSED
- `src/pages/en/games.astro` — INCLUDE PROPOSED
- `src/pages/en/games/[slug].astro` — INCLUDE PROPOSED
- `src/pages/games.astro` — INCLUDE PROPOSED
- `src/pages/games/[slug].astro` — INCLUDE PROPOSED

#### 03 NotBGG D-1～D-6 與 0014～0016

- `migrations/0014_notbgg.sql` — INCLUDE PROPOSED
- `migrations/0015_notbgg_collection.sql` — INCLUDE PROPOSED
- `migrations/0016_notbgg_link_commands.sql` — INCLUDE PROPOSED
- `src/components/CollectionAdmin.astro` — INCLUDE PROPOSED
- `src/components/CollectionCard.astro` — INCLUDE PROPOSED
- `src/components/CollectionPage.astro` — INCLUDE PROPOSED
- `src/components/NotBggAdmin.astro` — INCLUDE PROPOSED
- `src/components/NotBggDetail.astro` — INCLUDE PROPOSED
- `src/components/NotBggLinkAdmin.astro` — INCLUDE PROPOSED
- `src/lib/auth/admin-request.ts` — INCLUDE PROPOSED
- `src/lib/auth/cloudflare-access.ts` — INCLUDE PROPOSED
- `src/lib/collection-admin-api.ts` — INCLUDE PROPOSED
- `src/lib/collection-admin-controller.ts` — INCLUDE PROPOSED
- `src/lib/collection-v2-adapter.ts` — INCLUDE PROPOSED
- `src/lib/collection-v2-links.ts` — INCLUDE PROPOSED
- `src/lib/collection-v2-management.ts` — INCLUDE PROPOSED
- `src/lib/collection-v2-repository.ts` — INCLUDE PROPOSED
- `src/lib/game-identity.ts` — INCLUDE PROPOSED
- `src/lib/identity-resolution.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-admin-api.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-admin-controller.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-admin-fields.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-contract.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-link-api.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-link-controller.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-link-repository.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-public.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-repository.ts` — INCLUDE PROPOSED
- `src/lib/notbgg-validation.ts` — INCLUDE PROPOSED
- `src/lib/site-game-relations.ts` — INCLUDE PROPOSED
- `src/pages/admin/collection/[id].astro` — INCLUDE PROPOSED
- `src/pages/admin/collection/index.astro` — INCLUDE PROPOSED
- `src/pages/admin/collection/new.astro` — INCLUDE PROPOSED
- `src/pages/admin/index.astro` — INCLUDE PROPOSED
- `src/pages/admin/notbgg/[id].astro` — INCLUDE PROPOSED
- `src/pages/admin/notbgg/[id]/link.astro` — INCLUDE PROPOSED
- `src/pages/admin/notbgg/[id]/relations.astro` — INCLUDE PROPOSED
- `src/pages/admin/notbgg/index.astro` — INCLUDE PROPOSED
- `src/pages/admin/notbgg/new.astro` — INCLUDE PROPOSED
- `src/pages/api/admin/auth-check.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/collection/[id].ts` — INCLUDE PROPOSED
- `src/pages/api/admin/collection/[id]/archive.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/collection/index.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/collection/search.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id].ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id]/archive.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id]/history.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id]/link/compare.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id]/link/history.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id]/link/index.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id]/relations/[relationId].ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/[id]/relations/index.ts` — INCLUDE PROPOSED
- `src/pages/api/admin/notbgg/index.ts` — INCLUDE PROPOSED
- `src/pages/collection.astro` — INCLUDE PROPOSED
- `src/pages/en/collection.astro` — INCLUDE PROPOSED
- `src/pages/en/games/notbgg/[id].astro` — INCLUDE PROPOSED
- `src/pages/games/notbgg/[id].astro` — INCLUDE PROPOSED

#### 04 0003 BOM 相容修正

- `migrations/0003_sleeve_size_validation.sql` — INCLUDE PROPOSED

#### 05 F1 路由及 Runtime 設定

- `astro.config.mjs` — INCLUDE PROPOSED
- `src/middleware.ts` — INCLUDE PROPOSED
- `src/worker.ts` — INCLUDE PROPOSED
- `wrangler.json` — INCLUDE PROPOSED

#### 06 驗收測試與文件證據

- `docs/D1_V1_1_MIGRATION.md` — INCLUDE PROPOSED
- `docs/D1_V1_1_REQUIREMENTS.md` — INCLUDE PROPOSED
- `docs/D1_V1_1_SCHEMA.md` — INCLUDE PROPOSED
- `docs/D1_V1_1_TASKS.md` — INCLUDE PROPOSED
- `docs/bgg-cache-replacement-b43f.md` — INCLUDE PROPOSED
- `docs/bgg-relations-import.md` — INCLUDE PROPOSED
- `docs/d7a-local-evidence.json` — INCLUDE PROPOSED
- `docs/d7a-r3-cls-after-list.json` — INCLUDE PROPOSED
- `docs/d7a-r3-cls-after.json` — INCLUDE PROPOSED
- `docs/d7a-r3-cls-baseline.json` — INCLUDE PROPOSED
- `docs/d7a-r3-invalid-instrumentation.json` — INCLUDE PROPOSED
- `docs/d7a-r3-migration-evidence.json` — INCLUDE PROPOSED
- `docs/d7a-r4-migration-evidence.json` — INCLUDE PROPOSED
- `docs/notbgg-d1-contract.md` — INCLUDE PROPOSED
- `docs/notbgg-d2-storage.md` — INCLUDE PROPOSED
- `docs/notbgg-d3-admin.md` — INCLUDE PROPOSED
- `docs/notbgg-d4-public.md` — INCLUDE PROPOSED
- `docs/notbgg-d5-collection.md` — INCLUDE PROPOSED
- `docs/notbgg-d6-identity.md` — INCLUDE PROPOSED
- `docs/notbgg-d7a-preflight.md` — INCLUDE PROPOSED
- `docs/notbgg-d7a-r3-stability.md` — INCLUDE PROPOSED
- `docs/reference/d1_collection_status.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/d1_v2_counts.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/d1_v2_schema.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1D_20261027_R03_run_summary.ndjson` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_acquisitions_columns.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_acquisitions_fk.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_acquisitions_indexes.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_acquisitions_unique_columns.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_copies_columns.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_copies_fk.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_copies_index_columns.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_copies_indexes.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_fk_check.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_master.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_migrations.json` — HOLD；建議不提交原文，待核准封存
- `docs/reference/phase-c1/d1_C1_quick_check.json` — HOLD；建議不提交原文，待核准封存
- `tests/b3c-acceptance.test.ts` — INCLUDE PROPOSED
- `tests/b3c-browser.cjs` — INCLUDE PROPOSED
- `tests/b3d-browser.cjs` — INCLUDE PROPOSED
- `tests/b41-acceptance.test.ts` — INCLUDE PROPOSED
- `tests/b41-browser.cjs` — INCLUDE PROPOSED
- `tests/b42-acceptance.test.ts` — INCLUDE PROPOSED
- `tests/b42-browser.cjs` — INCLUDE PROPOSED
- `tests/b43c-browser.cjs` — INCLUDE PROPOSED
- `tests/bgg-static-alias.test.ts` — INCLUDE PROPOSED
- `tests/c4-browser.cjs` — INCLUDE PROPOSED
- `tests/cache-replacement.test.ts` — INCLUDE PROPOSED
- `tests/catalog-initial-count.test.ts` — INCLUDE PROPOSED
- `tests/catalog-payload.test.ts` — INCLUDE PROPOSED
- `tests/catalog-performance.ts` — INCLUDE PROPOSED
- `tests/catalog-visual-v1-browser.cjs` — INCLUDE PROPOSED
- `tests/catalog-visual-v1.test.ts` — INCLUDE PROPOSED
- `tests/d7a-cli-migrations.mjs` — INCLUDE PROPOSED
- `tests/d7a-inventory.mjs` — INCLUDE PROPOSED
- `tests/d7a-preflight.ts` — INCLUDE PROPOSED
- `tests/d7a-r3-cls.ts` — INCLUDE PROPOSED
- `tests/d7a-r3-migrations.mjs` — INCLUDE PROPOSED
- `tests/d7a-r4-migrations.mjs` — INCLUDE PROPOSED
- `tests/d7a-route-matrix.ts` — INCLUDE PROPOSED
- `tests/detail-relations-controller.test.ts` — INCLUDE PROPOSED
- `tests/fixtures/import-batches.ts` — INCLUDE PROPOSED
- `tests/game-browser-navigation.cjs` — INCLUDE PROPOSED
- `tests/game-browser-url.test.ts` — INCLUDE PROPOSED
- `tests/game-catalog-browsing.test.ts` — INCLUDE PROPOSED
- `tests/game-complexity.test.ts` — INCLUDE PROPOSED
- `tests/game-content-render.test.ts` — INCLUDE PROPOSED
- `tests/game-content.test.ts` — INCLUDE PROPOSED
- `tests/game-detail-v2-browser.cjs` — INCLUDE PROPOSED
- `tests/game-detail-v2.test.ts` — INCLUDE PROPOSED
- `tests/game-module-boundaries.test.ts` — INCLUDE PROPOSED
- `tests/game-name.test.ts` — INCLUDE PROPOSED
- `tests/helpers/d7a-built-preview.ts` — INCLUDE PROPOSED
- `tests/helpers/notbgg-access-fixture.ts` — INCLUDE PROPOSED
- `tests/helpers/notbgg-admin-preview.ts` — INCLUDE PROPOSED
- `tests/helpers/notbgg-local-d1.ts` — INCLUDE PROPOSED
- `tests/notbgg-admin-api.test.ts` — INCLUDE PROPOSED
- `tests/notbgg-admin-browser.cjs` — INCLUDE PROPOSED
- `tests/notbgg-collection-browser.cjs` — INCLUDE PROPOSED
- `tests/notbgg-collection.test.ts` — INCLUDE PROPOSED
- `tests/notbgg-link-browser.cjs` — INCLUDE PROPOSED
- `tests/notbgg-link.test.ts` — INCLUDE PROPOSED
- `tests/notbgg-middleware.test.ts` — INCLUDE PROPOSED
- `tests/notbgg-public-browser.cjs` — INCLUDE PROPOSED
- `tests/notbgg-public.test.ts` — INCLUDE PROPOSED
- `tests/notbgg-relation-retention.test.ts` — INCLUDE PROPOSED
- `tests/notbgg-repository.test.ts` — INCLUDE PROPOSED
- `tests/notbgg.test.ts` — INCLUDE PROPOSED
- `tests/pages/bgg-test.astro` — INCLUDE PROPOSED
- `tests/relation-direction.test.ts` — INCLUDE PROPOSED
- `tests/relation-display.test.ts` — INCLUDE PROPOSED
- `tests/relation-import-engine.test.ts` — INCLUDE PROPOSED
- `tests/relation-import-plan.test.ts` — INCLUDE PROPOSED

#### EXCLUDE 測試暫存產物

- `.bgg-b2-test-1JZTMi/cache.json` — EXCLUDE（既有核准原則）
- `.bgg-b2-test-FSA5Oi/cache.json` — EXCLUDE（既有核准原則）

#### R5 新增證據（已計入原 224；均第 06 組）

- `docs/d7a-r5-0003-bytes.json` — INCLUDE PROPOSED
- `docs/d7a-r5-auth-status.json` — INCLUDE PROPOSED
- `docs/d7a-r5-browser-results.json` — INCLUDE PROPOSED
- `docs/d7a-r5-candidate-manifest.json` — INCLUDE PROPOSED
- `docs/d7a-r5-check-results.json` — INCLUDE PROPOSED
- `docs/d7a-r5-final-verification.json` — INCLUDE PROPOSED
- `docs/d7a-r5-git-inventory.json` — INCLUDE PROPOSED
- `docs/d7a-r5-migration-evidence.json` — INCLUDE PROPOSED
- `docs/d7a-r5-restore-evidence.json` — INCLUDE PROPOSED
- `docs/d7a-r5-sensitive-audit.json` — INCLUDE PROPOSED
- `docs/d7a-r5-smoke-matrix.json` — INCLUDE PROPOSED
- `docs/notbgg-d7a-r5-release-readiness.md` — INCLUDE PROPOSED

#### 本輪 R6 新增證據（7 檔；第 06 組提案，原 224 之外）

- `docs/notbgg-d7a-r6-release-preparation.md`
- `docs/d7a-r6-auth-status.json`
- `docs/d7a-r6-metadata-review.json`
- `docs/d7a-r6-cloudflare-readonly.json`
- `docs/d7a-r6-restore-evidence.json`
- `docs/d7a-r6-git-candidate.json`
- `docs/d7a-r6-0003-verification.json`

## 7. 高 BODY CLS — NOT VERIFIED

R3 已修復 SSR count 造成的小位移（baseline 0.00954，後測 Grid 10／List 2 為 0），R5 初始 count 測試 PASS；早期 BODY 約 0.33842 的根因仍未證實。R6 不改 UI，也沒有重新執行或宣稱正式 CLS 通過。

需正式真圖片／CDN 壓縮／CSS delivery、冷暖 cache、慢 CPU、手機／桌面、Grid／List、多次固定條件與長窗口量測；最大 1s 間隔／5s session window，排除 recent input，保留所有有效樣本。建議 p75 CLS≤0.1（手機／桌面分開），任何再次 >0.25／BODY 大 shift 應停止放行、收集安全 selectors、before/after rect、CSS／image／font timing、computed body margin 與 Performance trace；不可用單次 0 結案。私人 DOM／Token 不得進 trace 分享檔。沿用 R5 詳細量測／驗收方案。

## 8. 尚未解除的 GO／NO-GO 條件

| 條件 | 狀態 | 下一個必要動作 |
| --- | --- | --- |
| R5 OAuth 過期 | PASS（本輪解除） | 後續操作前重驗 expiry／實際權限 |
| 正式 Worker／D1 tracking／FK／quick check | PASS（唯讀） | 保留本輪基線，上線前再查；不自動 migration |
| Route 全貌／ASSETS worker-first | BLOCKED／NOT VERIFIED | 取得 zone visibility／router 設定證據；不由本輪修改 |
| Access policy／Audience／管理員身份 | BLOCKED | 取得對應 App／組織唯讀權限及人工受控登入驗證 |
| Rate Limiter binding | FAIL | 另提配置與授權、隔離 429 測試；本輪不加設定 |
| 正式 canonical／CDN | FAIL（現行部署） | 候選正式部署後才可按已核准 smoke 核對；先核准 hostname/canonical/cache 政策 |
| 原 SQL dump 直接恢復 | FAIL | 使用受審查的 Schema/data/Trigger 受控流程；不可原樣匯入 |
| 受控合成恢復 | PASS（本機） | 仍需正式規模、受保護恢復與責任／停寫方案 |
| 正式備份／Time Travel／保留期／RTO/RPO | BLOCKED／NOT VERIFIED | 取得方案資訊，另獲明確授權驗證；不把 storage 支援當正式恢復 PASS |
| Metadata 原文處置 | BLOCKED | 人工逐檔同意排除／安全封存；原文保持不動 |
| Commit 依賴／224 檔／0003 LF | BLOCKED（核准） | 核准三個原子 Commit 提案或另定六 Commit 拆分，及逐檔清單 |
| 不可變部署候選／rollback 語意相容 | BLOCKED | 人工建立核准 Commit 後 clean checkout 重建；現行 Worker ID 已知，但不代表其了解 D-6 Schema／primary semantics |
| 私人 BGG build input／artifact | NOT VERIFIED | 依 R5 manifest 核准可重現輸入；不把私人 cache 或 dist/server/.dev.vars 提交／打包 |
| 高 BODY CLS | NOT VERIFIED | 完成正式相容條件觀測，或由責任人明確處置殘餘風險 |

R5 的 305／305、F1 210、D-5／D-6、C-1～C-3、strict／Astro／build／0001～0016 重播證據沒有因 R6 自動變成本輪重跑結果；原 224 bytes 未變，本輪新增的是遠端唯讀、根因控制組與 normalized 0003 測試。實際發布候選 Commit 尚未建立，屆時應重新依 R5 preflight 驗收。

## 9. 結論 — NO-GO

已取得正式 0013 基線、現行 Worker version 與 binding，確切定位 SQL dump 的 Schema 順序及獨立 Trigger 重播問題，隔離恢復與預期 0003 Blob 行為通過；但正式限流、Access 完整驗證、ASSETS／Route、恢復能力、不可變候選及高 CLS 仍未放行。**不得部署或開始 D-7B。**

R6 到此停止，等待人工核准 metadata 處置、提交計畫及後續查核／驗證範圍。沒有 git add／commit／push／Release、正式 Migration／寫入／備份／匯出／恢復、DNS／Route／Access／Secret／Cloudflare 設定變更。所有寫入測試只發生在隔離合成 D1；既有功能與 Migration 完全未修改。
