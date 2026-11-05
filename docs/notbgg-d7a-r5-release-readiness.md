# D-7A-R5：NotBGG V1.2 部署候選與正式環境準備

日期：2026-11-04（Asia/Taipei）。結論：**NO-GO**。R5 在授權範圍內已執行；正式環境查核因 OAuth 過期 **BLOCKED**，沒有開始 D-7B。所有 PASS 均註明本機範圍，不以本機驗收替代正式結果。

## 1. Git 基線與完整提交計畫 — PASS（盤點）／BLOCKED（逐檔核准）

Branch：main。HEAD：`469866d6f7e3aed947f9f1c2e0d59b9cc16961a2`。既有待處理路徑 212 個（210 個分入六組，2 個暫存排除），本輪 R5 交付文件另列（新增 12 檔，最終待處理共 224 路徑）。Index 的 0003 仍為原 HEAD OID `1092ed35ce84571323d4be03b3d8e320a3475526`；cached diff 空白，原先 intent-to-add 檔維持原狀。未 git add／commit／push／Release。

以下保留已獲方向核准的分組，不代表每檔已核准。跨階段共用檔案須逐 hunk 審查，不能因檔名分組就假設每組獨立可建置；正式提交前應按依賴順序測試每個 Commit。禁止 blanket git add。

### 01 BGG 匯入及資料基線（13 檔）

- `package-lock.json`
- `package.json`
- `scripts/bgg-relations-import.ts`
- `scripts/check-bgg-collection-sync.ts`
- `scripts/lib/local-games-preview.ts`
- `scripts/lib/relation-import-engine.ts`
- `scripts/preview-games.ts`
- `scripts/validate-bgg-relations-b3a.ts`
- `scripts/validate-bgg-relations-b3c.ts`
- `scripts/validate-bgg-relations-b41.ts`
- `scripts/validate-bgg-relations-b42.ts`
- `scripts/validate-bgg-relations-b43.ts`
- `src/data/bgg-cache.json`

### 02 Catalog／詳情與共用 UI（B／C）（42 檔）

- `src/components/CatalogBrowserControls.astro`
- `src/components/CatalogCard.astro`
- `src/components/GameBrowserControls.astro`
- `src/components/GameDetail.astro`
- `src/components/GameList.astro`
- `src/components/GameRelations.astro`
- `src/components/GameSignals.astro`
- `src/components/GameSleeves.astro`
- `src/components/GameSummary.astro`
- `src/components/Header.astro`
- `src/i18n/accessory-categories.ts`
- `src/i18n/bgg-zh-TW.ts`
- `src/i18n/catalog-browser.ts`
- `src/i18n/ui.ts`
- `src/i18n/utils.ts`
- `src/layouts/Layout.astro`
- `src/lib/bgg-identity-gateway.ts`
- `src/lib/catalog-browsing.ts`
- `src/lib/catalog-payload.ts`
- `src/lib/catalog-presentation.ts`
- `src/lib/catalog-selection.ts`
- `src/lib/catalog-store.ts`
- `src/lib/detail-relations-controller.ts`
- `src/lib/detail-relations.ts`
- `src/lib/game-browser-capabilities.ts`
- `src/lib/game-browser-url.ts`
- `src/lib/game-catalog.ts`
- `src/lib/game-complexity.ts`
- `src/lib/game-content.ts`
- `src/lib/game-detail-controller.ts`
- `src/lib/game-detail-presentation.ts`
- `src/lib/game-list-controller.ts`
- `src/lib/game-name.ts`
- `src/lib/game-view-model.ts`
- `src/lib/games.ts`
- `src/lib/relation-direction.ts`
- `src/lib/relation-display.ts`
- `src/lib/relation-import-plan.ts`
- `src/pages/en/games.astro`
- `src/pages/en/games/[slug].astro`
- `src/pages/games.astro`
- `src/pages/games/[slug].astro`

### 03 NotBGG D-1～D-6 與 0014～0016（57 檔）

- `migrations/0014_notbgg.sql`
- `migrations/0015_notbgg_collection.sql`
- `migrations/0016_notbgg_link_commands.sql`
- `src/components/CollectionAdmin.astro`
- `src/components/CollectionCard.astro`
- `src/components/CollectionPage.astro`
- `src/components/NotBggAdmin.astro`
- `src/components/NotBggDetail.astro`
- `src/components/NotBggLinkAdmin.astro`
- `src/lib/auth/admin-request.ts`
- `src/lib/auth/cloudflare-access.ts`
- `src/lib/collection-admin-api.ts`
- `src/lib/collection-admin-controller.ts`
- `src/lib/collection-v2-adapter.ts`
- `src/lib/collection-v2-links.ts`
- `src/lib/collection-v2-management.ts`
- `src/lib/collection-v2-repository.ts`
- `src/lib/game-identity.ts`
- `src/lib/identity-resolution.ts`
- `src/lib/notbgg-admin-api.ts`
- `src/lib/notbgg-admin-controller.ts`
- `src/lib/notbgg-admin-fields.ts`
- `src/lib/notbgg-contract.ts`
- `src/lib/notbgg-link-api.ts`
- `src/lib/notbgg-link-controller.ts`
- `src/lib/notbgg-link-repository.ts`
- `src/lib/notbgg-public.ts`
- `src/lib/notbgg-repository.ts`
- `src/lib/notbgg-validation.ts`
- `src/lib/site-game-relations.ts`
- `src/pages/admin/collection/[id].astro`
- `src/pages/admin/collection/index.astro`
- `src/pages/admin/collection/new.astro`
- `src/pages/admin/index.astro`
- `src/pages/admin/notbgg/[id].astro`
- `src/pages/admin/notbgg/[id]/link.astro`
- `src/pages/admin/notbgg/[id]/relations.astro`
- `src/pages/admin/notbgg/index.astro`
- `src/pages/admin/notbgg/new.astro`
- `src/pages/api/admin/auth-check.ts`
- `src/pages/api/admin/collection/[id].ts`
- `src/pages/api/admin/collection/[id]/archive.ts`
- `src/pages/api/admin/collection/index.ts`
- `src/pages/api/admin/collection/search.ts`
- `src/pages/api/admin/notbgg/[id].ts`
- `src/pages/api/admin/notbgg/[id]/archive.ts`
- `src/pages/api/admin/notbgg/[id]/history.ts`
- `src/pages/api/admin/notbgg/[id]/link/compare.ts`
- `src/pages/api/admin/notbgg/[id]/link/history.ts`
- `src/pages/api/admin/notbgg/[id]/link/index.ts`
- `src/pages/api/admin/notbgg/[id]/relations/[relationId].ts`
- `src/pages/api/admin/notbgg/[id]/relations/index.ts`
- `src/pages/api/admin/notbgg/index.ts`
- `src/pages/collection.astro`
- `src/pages/en/collection.astro`
- `src/pages/en/games/notbgg/[id].astro`
- `src/pages/games/notbgg/[id].astro`

### 04 0003 BOM 相容修正（1 檔）

- `migrations/0003_sleeve_size_validation.sql`

### 05 F1 路由及 Runtime 設定（4 檔）

- `astro.config.mjs`
- `src/middleware.ts`
- `src/worker.ts`
- `wrangler.json`

### 06 驗收測試與文件證據（93 檔）

- `docs/D1_V1_1_MIGRATION.md`
- `docs/D1_V1_1_REQUIREMENTS.md`
- `docs/D1_V1_1_SCHEMA.md`
- `docs/D1_V1_1_TASKS.md`
- `docs/bgg-cache-replacement-b43f.md`
- `docs/bgg-relations-import.md`
- `docs/d7a-local-evidence.json`
- `docs/d7a-r3-cls-after-list.json`
- `docs/d7a-r3-cls-after.json`
- `docs/d7a-r3-cls-baseline.json`
- `docs/d7a-r3-invalid-instrumentation.json`
- `docs/d7a-r3-migration-evidence.json`
- `docs/d7a-r4-migration-evidence.json`
- `docs/notbgg-d1-contract.md`
- `docs/notbgg-d2-storage.md`
- `docs/notbgg-d3-admin.md`
- `docs/notbgg-d4-public.md`
- `docs/notbgg-d5-collection.md`
- `docs/notbgg-d6-identity.md`
- `docs/notbgg-d7a-preflight.md`
- `docs/notbgg-d7a-r3-stability.md`
- `docs/reference/d1_collection_status.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/d1_v2_counts.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/d1_v2_schema.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1D_20261027_R03_run_summary.ndjson` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_acquisitions_columns.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_acquisitions_fk.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_acquisitions_indexes.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_acquisitions_unique_columns.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_copies_columns.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_copies_fk.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_copies_index_columns.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_copies_indexes.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_fk_check.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_master.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_migrations.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `docs/reference/phase-c1/d1_C1_quick_check.json` — **BLOCKED**：歷史正式 metadata，提交處置待人工核准
- `tests/b3c-acceptance.test.ts`
- `tests/b3c-browser.cjs`
- `tests/b3d-browser.cjs`
- `tests/b41-acceptance.test.ts`
- `tests/b41-browser.cjs`
- `tests/b42-acceptance.test.ts`
- `tests/b42-browser.cjs`
- `tests/b43c-browser.cjs`
- `tests/bgg-static-alias.test.ts`
- `tests/c4-browser.cjs`
- `tests/cache-replacement.test.ts`
- `tests/catalog-initial-count.test.ts`
- `tests/catalog-payload.test.ts`
- `tests/catalog-performance.ts`
- `tests/catalog-visual-v1-browser.cjs`
- `tests/catalog-visual-v1.test.ts`
- `tests/d7a-cli-migrations.mjs`
- `tests/d7a-inventory.mjs`
- `tests/d7a-preflight.ts`
- `tests/d7a-r3-cls.ts`
- `tests/d7a-r3-migrations.mjs`
- `tests/d7a-r4-migrations.mjs`
- `tests/d7a-route-matrix.ts`
- `tests/detail-relations-controller.test.ts`
- `tests/fixtures/import-batches.ts`
- `tests/game-browser-navigation.cjs`
- `tests/game-browser-url.test.ts`
- `tests/game-catalog-browsing.test.ts`
- `tests/game-complexity.test.ts`
- `tests/game-content-render.test.ts`
- `tests/game-content.test.ts`
- `tests/game-detail-v2-browser.cjs`
- `tests/game-detail-v2.test.ts`
- `tests/game-module-boundaries.test.ts`
- `tests/game-name.test.ts`
- `tests/helpers/d7a-built-preview.ts`
- `tests/helpers/notbgg-access-fixture.ts`
- `tests/helpers/notbgg-admin-preview.ts`
- `tests/helpers/notbgg-local-d1.ts`
- `tests/notbgg-admin-api.test.ts`
- `tests/notbgg-admin-browser.cjs`
- `tests/notbgg-collection-browser.cjs`
- `tests/notbgg-collection.test.ts`
- `tests/notbgg-link-browser.cjs`
- `tests/notbgg-link.test.ts`
- `tests/notbgg-middleware.test.ts`
- `tests/notbgg-public-browser.cjs`
- `tests/notbgg-public.test.ts`
- `tests/notbgg-relation-retention.test.ts`
- `tests/notbgg-repository.test.ts`
- `tests/notbgg.test.ts`
- `tests/pages/bgg-test.astro`
- `tests/relation-direction.test.ts`
- `tests/relation-display.test.ts`
- `tests/relation-import-engine.test.ts`
- `tests/relation-import-plan.test.ts`

### EXCLUDE 測試暫存產物（2 檔）

- `.bgg-b2-test-1JZTMi/cache.json`
- `.bgg-b2-test-FSA5Oi/cache.json`

### 本輪 R5 交付，歸入第 06 組（文件／必要證據）

- `docs/notbgg-d7a-r5-release-readiness.md`
- `docs/d7a-r5-git-inventory.json`
- `docs/d7a-r5-auth-status.json`
- `docs/d7a-r5-0003-bytes.json`
- `docs/d7a-r5-check-results.json`
- `docs/d7a-r5-browser-results.json`
- `docs/d7a-r5-migration-evidence.json`
- `docs/d7a-r5-restore-evidence.json`
- `docs/d7a-r5-sensitive-audit.json`
- `docs/d7a-r5-candidate-manifest.json`
- `docs/d7a-r5-smoke-matrix.json`
- `docs/d7a-r5-final-verification.json`

**BLOCKED：提案與待決事項，未擅自調整清單。** F1 的 `src/lib/bgg-identity-gateway.ts` 目前按原提案列在第 02 組，建議人工核准後與第 05 組 Worker／Wrangler 一起提交；否則第 05 組必須明確依賴第 02 組。尚未移組。F1 測試 `tests/bgg-static-alias.test.ts`／helpers 在第 06 組；F2 修復在第 03 組的 0015，`tests/notbgg-relation-retention.test.ts` 與重播測試在第 06 組。0014／0016、第 05 組候選設定均已列入。R3 SSR count 修正在 GameList（02）及 CatalogBrowserControls（02），對應測試在 06。

**排除原則 PASS**：僅原兩個 .bgg-b2-test-* cache.json 排除，不刪檔。既有 ignore 的 .wrangler、dist、.env*、.dev.vars*、SQLite、備份及私人 BGG collection cache 不納入提交。本輪 runner、截圖與本機日誌留在已忽略的 .wrangler/r5-verification。16 個 docs/reference 檔案仍在原 06 清單，已標示 BLOCKED，尚未遮罩、移組或排除。

### 全檔敏感資訊審核 — PASS（完成檢視）／BLOCKED（正式 metadata 處置）

審核不限關鍵字：逐檔讀取完整 bytes 並留 SHA256；對 code 列舉字串／template、檢查環境變數與憑證來源、外部目的地、參數化 SQL、公開／私人資料投影；對 JSON 遞迴檢查 keys／資料來源；對 lockfile 檢查 resolved URL 來源與嵌入帳密／query；對本機已知敏感值做 exact match（只保存名稱），並掃描公開 dist/client。產生的 R5 文件亦納入最終審核；詳細逐檔分類在 sensitive-audit。這不是未知 Secret 的絕對保證或完整滲透測試。

未發現可提交檔中的 Token／私鑰／憑證值或公開產物的已知敏感值。最終審核共 224 檔、13,333 個 code 字串／template；206 檔內容審查 PASS，18 檔 BLOCKED（16 正式 metadata＋2 已同意排除的暫存），PASS 不等於逐檔提交核准。測試 RSA／JWT 由 runtime 生成，example.test／invalid 與 synthetic 標記為測試來源。BGG cache 815 筆遞迴 keys 為公開遊戲 metadata，不含收藏／商店／購買／私人評分資料結構。SQL 檔為 Schema／Trigger 與內部資料搬移，非正式私人 row dump。

**已發現正式資料來源**：docs/reference 是歷史 production 聚合／Schema／Migration／執行 metadata；run summary 另含帳號識別資訊、本機使用者路徑。它們不是 Secret，也不是完整私人收藏明細，但不能直接視為合成證據或當次正式結果。是否提交原文、遮罩或排除須人工決定；報告不轉載其敏感識別或私人聚合值。

.gitignore 查核 **PASS**：0001～0016、wrangler.json、src/worker.ts 及本輪必要測試沒有被意外排除。私人 collection cache 的忽略為有意保護，不能為了 build 直接納入 Git。

## 2. 0003 精確位元組與候選設定 — PASS／NOT VERIFIED

專案無 .gitattributes，git check-attr --all 對 0003 無 attribute；生效 core.autocrlf=input（使用者設定覆蓋系統 true），core.eol 未設。git ls-files --eol 為 i/lf、w/mixed。沒有修改 Git 設定或執行寫入物件的 hash-object -w。

| 0003 來源 | bytes | BOM | CRLF | LF（含 CRLF） | SHA256 |
| --- | ---: | --- | ---: | ---: | --- |
| HEAD Git Blob | 493 | 有 | 0 | 15 | 354869861c66cfc2daa6357a18f8e2217b22e6a9f3785d20c2cbfe37df973005 |
| R4 原始工作檔（歷史 manifest） | 494 | 有 | 1 | 15 | 2d0f6c76f1ba6f80702a467c8ccee9571c1e0a1d257062a93d0b668d9820f03b |
| 目前工作檔＝R4 驗收檔 | 491 | 無 | 1 | 15 | 211ed3bb90dc24e5be0e39dc6b7b6662967b3b9863099f582ab020835b8f11f0 |
| 目前規則下預期提交 Blob | 490 | 無 | 0 | 15 | 5f70e687a582c2cb8c4598a7bd776b205b12e4a59d738b1d281ac7552805e76e |

**PASS**：目前工作檔與 R4 驗收逐 byte 相同；補回前三個 EF BB BF 後精確符合 R4 修正前 hash。HEAD 與工作檔的 raw byte 差異是移除 BOM（−3）及一個 LF→CRLF（＋1），因此不能直接說 raw diff 僅 3 bytes。

**PASS**：用 git hash-object --path=... --stdin（無 -w、無 stage）驗證 clean filter；預期 Git OID `b80fa2945d8b5ea3ae1ddf5441163dd22c95ced6`，與自行只將 CRLF→LF 的 490 bytes 一致。預期 Blob **精確等於 HEAD 去掉前三個 BOM bytes**；SQL 本文沒有其他變化。精確預期 UTF-8 本文已存 0003-bytes.expectedBlobUtf8，末尾仍有 LF。

**NOT VERIFIED（提交策略核准）**：R4 工作檔的那一個 CRLF 在 Git Blob 不會保留；預期 Blob 的 SHA 不等於 R4 工作檔 SHA。尚未以此 Blob 建立乾淨 checkout 重做 release 驗收。若要求 Git Blob 必須 byte-for-byte 等於 R4 混合換行，須另行核准 .gitattributes／編碼策略及再驗證；本輪不改檔或規則。

0014／0015／0016 **PASS**：SHA256 與 R4 一致，依序為：

- 0014：d2c7a0efabec9fb7c1d3440f09744448c9610341c0ce99e8c693b9665bf7a0c6
- 0015：b6ead70bf65a496c68dddece26d5704e115ece6d320ced93f52aa9669cdb9760
- 0016：cf85894f8414da3b0edd79188d02cea871d743416a8ee777c3c413a2902757a5

0015 的 site_game_relations_no_delete BEFORE DELETE Trigger 在 table rebuild 後恢復；DELETE 被拒絕，正常新增／UPDATE archive 不受阻。本輪 F2、舊／新／已封存關聯與失敗 batch 原子回復測試 PASS。沒有改 Migration。

F1 候選設定 **PASS（本機）**：main=src/worker.ts，ASSETS=dist/client，run_worker_first 為 /games/*、/en/games/*、/*%*、//*、/en//*；編碼／重複 slash 先進 Worker。來源與 build 產生設定一致，210 真實 HTTP 情境 PASS。

## 3. 部署候選版本 — BLOCKED

NotBGG V1.2 RC 仍是 dirty workspace 候選，package version 0.0.1 不代表 release。未建立不可變 Commit／Release／部署包；不能指定預計部署 Commit SHA。基線 HEAD 同上。

本輪 source manifest SHA256：`d9a70aeceff8662d8b47a5e7e65172018f7473cf7e6c097101d0d9123719a6dc`；dist（排除環境檔）manifest SHA256：`5aaf26da45d5a12110141858b818db79041c9851fd40b7b70fc3bc69bb118cde`。版本、逐檔輸入／產物 hash 見 candidate-manifest；這些指紋提供本機追溯，沒有證明正式版本。

**NOT VERIFIED**：src/lib/games.ts 靜態 import 已忽略的私人 bgg-collection-cache.json，當次 build 沿用現有檔；manifest 只記錄該輸入 hash，不複製內容。專案已有 tracked example 與安全 initializer 可在缺檔時建立模板，本輪未執行 npm prebuild；用 template 的乾淨 checkout 是否產生相同 slug／產物尚未驗證。正式 release 需核准可重現輸入方式，不能把私人 cache 提交。build 曾讀取 .dev.vars／prerender 環境檔；不打包這些本機環境檔，不將任意整個 dist 當正式 release 包。實際發現的環境檔為 dist/server/.dev.vars，未納入 artifact manifest。其餘 manifest 產物已逐檔對已知本機敏感值檢查，命中 0；此檢查不包含被刻意排除的環境檔。

## 4. Cloudflare 正式唯讀查核與 OAuth — BLOCKED

**PASS（本機授權盤點）**：只解析 Wrangler 授權設定是否存在及 expiry，沒有輸出或保存 Token。OAuth 到期 UTC 為 `2026-10-27T01:43:36.851Z`（台北 2026-10-27 09:43:36）；檢查時已過期。環境未見 CLOUDFLARE_API_TOKEN／CLOUDFLARE_API_KEY。沒有執行可能自動 refresh 的 whoami、沒有刷新／繞過授權、沒有正式 API 請求。這不是有效授權的正式驗證。

| 正式項目 | 狀態 | 本機候選／仍需取得的證據 |
| --- | --- | --- |
| Worker 名稱／目前版本 | BLOCKED | 候選 name=boardgame-collection-blog；正式 version ID、部署比例、Git SHA／回滾版本未知 |
| Route／Custom Domain | BLOCKED | 候選未宣告 routes／custom_domain；正式 zone route、hostname、DNS／憑證未知 |
| ASSETS | BLOCKED | 候選 ASSETS binding、dist/client、五條 worker-first 已驗證；正式配置未知 |
| D1 ID／Binding | BLOCKED | 候選 DB、boardgame-collection-db、59e9a17a-ff0f-494e-aab9-dd903a14e395；正式綁定未核對 |
| Migration 登記 | BLOCKED | 只驗證本機；正式 tracking 與最新版本未知 |
| Access Team Domain／Audience | BLOCKED | 程式需要 ACCESS_TEAM_DOMAIN／ACCESS_AUD；正式值、App、path coverage 未驗證 |
| 管理員授權 | BLOCKED | 程式驗證 RS256、issuer／audience／expiry／subject／ADMIN_EMAIL；正式 policy／白名單未核對 |
| Rate Limiter | BLOCKED | API 支援 NOTBGG_WRITE_LIMITER；候選未配置 ratelimits，不能宣稱分散式限流 PASS |
| KV／R2／Images | BLOCKED | 候選 SESSION KV、IMAGES；未宣告 R2；正式 binding／ID／權限未知 |
| Secret 名稱完整性 | BLOCKED | 需比對 Secret 名稱及 plain vars（DB binding 不是 Secret）；沒有列出正式 Secret 或值 |
| Cache Rules／CDN | BLOCKED | 正式 bypass／cache key／status 與 no-store 遵循未知 |

Secret／變數需求清單（僅名稱，正式存在性皆 BLOCKED）：ACCESS_TEAM_DOMAIN、ACCESS_AUD、ADMIN_EMAIL 為管理員驗證必要輸入；LOCAL_ADMIN_DEV 正式不得啟用。DB、SESSION、IMAGES、NOTBGG_WRITE_LIMITER 是 binding，不能以 Secret 名稱存在代替。BGG_API_TOKEN 為既有 BGG requester／維護工具的憑證需求，須確認正式是否啟用該功能以及 runtime／build 注入位置；BGG_IMPORT_INTERVAL_MS 屬本機匯入工具設定，不直接推定為正式 Secret。

人工重新登入說明：在自己的終端切至專案，執行 `npx wrangler login`，在 Cloudflare 瀏覽器選定正確帳號並核准必要權限；完成後由人工用 `npx wrangler whoami` 確認帳號及授權範圍，只回報成功／失敗，不貼 Token／cookie／完整敏感輸出。本輪不代為登入。登入後的後續查核仍限 read-only；若需要 Access／zone 額外權限，個別項目繼續 BLOCKED。

## 5. 正式 D1 Schema／Migration 安全檢查 — BLOCKED

不假設已套用至 0013；歷史 docs/reference 不作為本輪即時正式證據。收藏量、v2_games 量、collectionId→game_id 完整性、FK、scope、0014～0016 pending、Schema 衝突皆 BLOCKED。未遠端執行任何 SQL。

以下僅為經審閱的唯讀 SQL 計畫，**未執行**；須先確認正式 DB ID 與實際 Schema。先做 metadata，不在不存在欄位／表上盲查：

```sql
SELECT type,name,tbl_name,sql FROM sqlite_schema
WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name;
PRAGMA table_info(d1_migrations);
PRAGMA table_info(v2_collection_items);
PRAGMA table_info(v2_games);
PRAGMA foreign_key_list(v2_collection_items);
PRAGMA foreign_key_check;
PRAGMA quick_check;
```

核對 tracking table 名稱／欄位後，才執行（若有 migrations_table override 必須先對照，不動態拼接未驗證名稱）：

```sql
SELECT id,name,applied_at FROM d1_migrations ORDER BY id;
SELECT COUNT(*) AS collection_count FROM v2_collection_items;
SELECT COUNT(*) AS game_count FROM v2_games;
SELECT COUNT(*) AS orphan_game_refs FROM v2_collection_items c
LEFT JOIN v2_games g ON g.id=c.game_id
WHERE c.game_id IS NOT NULL AND g.id IS NULL;
SELECT COUNT(*) AS unregistered_collection_items
FROM v2_collection_items WHERE game_id IS NULL;
SELECT record_scope,COUNT(*) AS count FROM v2_collection_items
GROUP BY record_scope;
SELECT COUNT(*) AS invalid_scope FROM v2_collection_items
WHERE record_scope IS NULL OR record_scope NOT IN ('production','test');
SELECT COUNT(*) AS orphan_copy_refs FROM v2_owned_copies p
LEFT JOIN v2_collection_items c ON c.id=p.collection_item_id WHERE c.id IS NULL;
```

NULL game_id 與 orphan 分開，前者不自動算損毀。collectionId 為 API 對 v2_collection_items.id 的映射，不能直接假設有 collectionId SQL 欄位。舊 V1 收藏若仍存在也應比對 count 與 v2_legacy_id_map 統計；只保存聚合，不輸出名稱／備註／價格／row 明細。scope 欄不存在即記錄實際版本落差並停止相關查詢。

0014～0016 需核對三個檔名是否登記、所需 object 是否缺少／同名衝突、0015 retention Trigger 是否存在。若登記與 Schema 不一致、或任一舊 0015 已套用，立即停止；不得刪 tracking／重跑已套用檔來補修。FK 只以唯讀 check 與 schema 清單核對，不透過正式測試寫入確認。

## 6. 備份／還原能力、流程與隔離預演

### 能力與適用性 — PASS（文件查核）／BLOCKED（正式適用性）

[D1 Time Travel 官方說明](https://developers.cloudflare.com/d1/reference/time-travel/)：新儲存版本提供時間點還原，Free 最多 7 日、Paid 最多 30 日；production／alpha storage 需以 d1 info 的 version 確認，legacy alpha 使用舊快照能力。Time Travel 是覆寫原庫，會中止進行中的查詢；不是 Worker 回滾。正式方案／storage／實際保留期未能查證，因此適用性 BLOCKED，不自行假設 30 日。

[D1 匯入／匯出官方說明](https://developers.cloudflare.com/d1/best-practices/import-export-data/)：可匯出 SQL，再以 d1 execute --file 匯入；原始 .sqlite3 不能直接當 import 檔。匯出成功不代表包含 Trigger／FK 的應用 Schema 必然可原樣匯回。正式適用方式優先評估 Time Travel，另以受保護 SQL 匯出提供異地／長期恢復；本輪未對正式查 bookmark、匯出、備份或還原。

### 正式流程提案 — NOT VERIFIED（僅計畫，需另行授權）

1. 確認正式帳號／DB／storage／plan／Schema／tracking，選定精確 Worker release 及可語意相容的回滾版本。
2. 由責任人安排寫入凍結，涵蓋所有 API／管理入口，不只前端。停寫後記錄恢復點與前置聚合／Schema manifest；R5 不執行。
3. 後續另獲核准才取得有效 bookmark／受保護 SQL 備份，記錄時間、DB ID、版本、大小、SHA256、存放 ACL、加密與保留期；不進 Git 或一般 fixture。
4. 在另行核准的受保護隔離 DB 驗證正式備份可讀／可恢復；不得將私人資料放進本輪合成測試環境。比對完整性摘要、Schema／Trigger／tracking、收藏／副本／購買／關聯、FK／scope／ID／sequence，不能只看檔案 hash。
5. 還原前停止寫入並保存事故後合法資料的受保護對帳來源；選定允許的資料損失範圍才做 Time Travel 或受審查 loader。還原後核對同一 manifest，再由責任人恢復寫入。

### 隔離合成預演 — PASS（受控還原）／FAIL（原樣匯入）

使用專案 0001～0016、真實 Wrangler --local、隨機 source／target D1 ID、獨立暫存 config/persistence，清除 CF 憑證環境、不使用正式 DB；合成 production／test 只是本機 scope 字串。原樣失敗 target 不重用，受控還原使用另一全新隨機本機 DB。所有臨時 SQL／狀態於測試後依已驗證路徑清理；報告只留合成統計／hash／runner。

| 預演檢查 | 結果 | 證據 |
| --- | --- | --- |
| Source 空庫真實 migrations apply | PASS | 16 筆登記 |
| Wrangler local SQL export | PASS | 71437 bytes，SHA256 a5a0bb39b15d4b608789e26bde0395333255b7767c218b5eba52d0a0d31d9797 |
| 原始 dump 直接 local import | **FAIL** | no such table: main.notbgg_game_revisions；前段資料觸發尚未齊全的 Schema／Trigger 依賴 |
| 受控 parser | PASS | Wrangler splitter；只接受明確 SQL 類型，未知類型 fail closed；保留原始 export |
| 受控 restore | PASS | 全 CREATE TABLE→資料（defer FK）→來源 sqlite_sequence manifest→index/view→Trigger；不改 Trigger／Migration SQL 語意 |
| 精確 Schema／全表 rows／sequence 比對 | PASS | deep equality，包括 tracking、revision、link／collection／relation events |
| 合成收藏／副本／購買 | PASS | 收藏 2、副本 2、orders 2、lines 2、acquisitions 2、allocations 2 |
| 身份／關聯與歷史 | PASS | NotBGG 2、v2_games 3、relation 1、link 1、link events 3 |
| scope | PASS | 合成 production 1／test 1，逐列與還原前一致 |
| FK／quick_check | PASS | FK check 空、quick_check=ok |
| 正式 Time Travel／正式恢復耗時 | BLOCKED／NOT VERIFIED | 未操作；本機不能模擬正式 Time Travel |

受控 loader 是**隔離預演方案，不是已批准的正式恢復工具**；正式資料量、quota、批次原子性、租戶及 Time Travel 必須另行驗證。完整來源與可重跑方式存 restore-evidence.runner，腳本不接受 remote flag。

### Worker 與 D1 回滾、Migration 失敗 — NOT VERIFIED（計畫）

Worker 回滾只切換程式及相應資產版本，不撤回 D1 Schema／資料。不可直接把目前 HEAD 當成回滾：舊程式可能不理解 D-6 primary mapping，或被新的 immutable Trigger 拒絕寫入；需驗證 Schema 及身份語意相容，回滾期間維持停寫。

0014 失敗：核對 transaction／tracking／Schema 是否一致，修正前不部署依賴它的 Worker。0015 失敗：特別檢查 relation table rebuild、原 row／sequence／indexes／delete guard；不手動刪新舊表或重寫 tracking。0016 失敗：D-6 commands 保持 fail-closed，不能用缺 gate 的寫入 fallback。每一步成功可保留為前向相容基線；先確認實際 pending，再決定經審查前向修復或恢復點還原。不得假設多個 Migration 合成一個原子 transaction，也不得用重跑舊檔作 downgrade。官方 [Migration tracking 說明](https://developers.cloudflare.com/d1/reference/migrations/) 需與正式設定核對。

一旦正式開始寫入，舊恢復點會抹去其後合法收藏、副本、價格及對應事件；匯出檔也不是增量合併工具。不得直接覆蓋後宣稱零損失。**可接受停機時間、RTO、RPO、容許資料損失、停寫責任人及事故後對帳方式均 NOT VERIFIED／待人工定義**，本輪不填假定數值。

## 7. 正式部署後 Route Smoke Test 計畫 — PASS（計畫）／BLOCKED（正式執行）

完整 210 列計畫存 smoke-matrix：15 個路徑變體 × 2 語言 × 7 身份／方法狀態（unlinked、candidate、linked NotBGG primary、linked HEAD、linked BGG primary、revoked、archived）。本機 210 情境通過不是正式結果。先核對正式 hostname／Worker version／Routes／ASSETS／Access／Cache Rules，再替換測試 origin；雙 slash 必須以 pathname／原始路徑送出，避免被 client 當另一個 hostname。

| 情境 | 正式驗收預期 | 安全方法 |
| --- | --- | --- |
| BGG 靜態中英文詳細頁 | 正確內容、200、單一正式 canonical | GET／HEAD 現有公開 BGG slug，只讀 |
| .html、index.html、尾 slash | 307 至同源正確 primary，保留 query，最終 200，無循環 | 以 F1 相同變體測；不接受以 301 永久記錯映射 |
| URL 編碼、encoded slash、重複 slash | 經身份 gateway；不可繞過回傳過期 static primary | 對驗證過的 origin 用原始 path request；不發 double-encoded 寫入 |
| NotBGG 動態頁／中英文 | 正確 active profile；primary 別名 307；canonical 正確 | 只讀已核准公開 profile；無資料時記 NOT VERIFIED |
| candidate／confirm／primary／revoke | candidate 不合併，確認後正確互指，解除可逆 | 完整狀態切換在獨立合成 preview D1；正式僅比對當下既有狀態 |
| archive | NotBGG 詳細頁 404；舊 BGG 恢復原 static，不洩漏歷史私人欄位 | 不封存正式收藏／profile；隔離 fixture 完整測，正式只讀既有核准例 |
| canonical／語言 | 每個詳細頁只有一個絕對 canonical，指向正式 primary 同語言路徑 | 比對 response HTML；目錄 canonical／hreflang 另有既有 SEO 未決，不能標 PASS |
| CSS／JS／favicon | 200、正確 MIME／bytes；hashed 資產可 immutable；編碼別名不觸發多餘 D1 | 比對核准 artifact hash；不得以 gateway debug header 作正式依賴 |
| Access | 匿名不見私人內容，依 Access policy challenge／拒絕；有效管理員可讀、錯身份拒絕 | 匿名及人工核准測試帳號 GET；不保存 JWT／cookie，無寫入 |
| Cache-Control／CDN | 動態目錄／身份頁／307／管理 no-store；無 stale 跨身份快取；_astro 依 hash immutable | 多次冷暖 GET／HEAD 記錄 Cache-Control、Age、CF-Cache-Status、Vary／Location；跨 PoP 待實測 |

缺 CF-Cache-Status 不能證明 bypass；需正式 Cache Rules 與重複請求合併判斷。真實公開身份變更後的快取失效，只能在另行授權的安全 fixture 上測。**record_scope 只隔離收藏，不會把 NotBGG profile 從公開 catalog 隔離**；因此本輪不將 test scope 當成可以安全寫正式庫的理由。正式需寫入的情境一律獨立 preview／DB，或另提人工核准資料／清理／影響方案；不破壞正式收藏。

## 8. CLS 殘餘風險 — NOT VERIFIED

已知修復證據：R3 baseline Grid 10／10 為 0.00954154，SSR count 空白→client 填字造成約 21px 位移；GameList／CatalogBrowserControls SSR 輸出相同 count 後 Grid 10／10、List 2／2 為 0。catalog-initial-count HTTP 回歸本輪 PASS。

**早期 BODY 約 0.33842 仍 NOT VERIFIED**；不能用最近 0 值結案。原量測使用 390×844、150ms latency、200000 bytes/s、CPU rate=1、禁 cache、合成 300×400 SVG、Node identity encoding、本機 Worker；主要觀測為控制器就緒後約 1200ms，frames 至 10s。真圖片、正式 CDN 壓縮、慢 CPU、CSS delivery／字型、晚發載入與更長互動都未覆蓋；當時 BODY margin 8→0 的高 shift 根因未證實。

正式驗證提案：中英文目錄／詳細頁、Grid／List、390×844 與 desktop、冷／暖 cache、實際圖片／錯圖、CPU rate 1／4、正常與 3G 節流、直接導航／返回／重新整理；每個關鍵條件建議至少 10 次，完整保留而非挑樣本，load 後至少 30s 並涵蓋捲動／lazy load／view switch。合成 preview 可檢查私人頁，正式只用核准公開頁或受保護人工帳號，避免 trace 記錄私人資料。這些是建議條件，尚未正式執行。

建議門檻：正式 RUM 依 mobile／desktop 分開 p75 CLS≤0.1；預先固定實驗條件也要求每個有效 run≤0.1，任何 >0.25 或再次 BODY 大位移即停止放行並調查；沒有足夠 RUM 時維持 NOT VERIFIED，不用單次 0 取代 p75。[CLS 官方定義與門檻](https://web.dev/articles/cls)。

收集方式：導航前裝 PerformanceObserver（layout-shift buffered），排除 hadRecentInput，以 1s 間隔／5s 最大 session window 計最大 CLS，另保留全部 shift。記錄 time/value、sources 的安全 selector、previousRect/currentRect、CSS request/response／首屏套樣式時點、body computed margin、viewport／DPR、圖片 intrinsic/rect/loading/fail、font readiness、SSR/client 初始 keys／view。搭配 DevTools Performance screenshots/trace 定位 shift 前後 mutation；若 source 是 BODY，檢查 CSS 是否延遲而非直接歸因排序。不得輸出 DOM 文字、Token 或私人內容，trace 只存受保護位置。觀測器例外或缺 frames／LCP 不可當 CLS=0。

## 9. 最終 Preflight — PASS（本機）

| 檢查 | 本輪結果 | 範圍／入口 |
| --- | --- | --- |
| 全套自動化 | PASS 305／305、29 檔，0 fail／skip | node --import tsx --test --test-concurrency=1 tests/*.test.ts（runner 展開實際檔案，不靠 PowerShell glob） |
| F1 HTTP | PASS 210 情境 | bgg-static-alias.test.ts；production Worker／ASSETS／真 loopback HTTP |
| F2 relation retention | PASS | 0015 舊／新／archive 關聯、failed batch 原子性與 delete guard |
| D-5／D-6 | PASS desktop／mobile | notbgg-collection-browser.cjs、notbgg-link-browser.cjs；合成 D1／簽章測試身份 |
| C-1 | PASS 11 項 | b43c-browser --case=c1；24→48→815、815 unique |
| C-2 | PASS 4 項 | --case=c2-focused |
| C-3 | PASS 5 項 | --case=c3 |
| TypeScript strict | PASS | tsc --noEmit；extends astro/tsconfigs/strict |
| Astro check | PASS | 0 errors／0 warnings／13 hints，200 files |
| Production build | PASS | 69s，直接 Astro build，不執行 npm prebuild、不更新資料 |
| 空庫 0001～0016 | PASS | 真實 Wrangler --local，直接專案 migrations 原目錄，16 筆 tracking |
| 0013～0016 升級 | PASS | 合成既有 tracking 前13筆／原 game 不變，已登記0003不重跑 |
| 再次 apply | PASS | 兩路徑皆 No migrations to apply，Schema／資料／tracking 不變 |
| BGG SHA256 前後 | PASS | 1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91 |
| git diff --check | FAIL（既有格式） | GameList.astro:59 trailing whitespace；按限制未修 |
| 正式 smoke／Edge／D1 | BLOCKED | 沒有正式驗證，不以本表替代 |

本機執行曾有路徑誤用及沙箱 loopback EACCES，已更正安裝套件的 Astro bin 路徑並經允許重試本機 runtime。原樣還原及受控 parser 首次拒絕未知 PRAGMA 的失敗均有記錄；修正的是隔離 runner，不是產品／Migration。自動核准審查一度因用量無法完成，該次命令未執行；使用者指示繼續後重試獲准，預演已完成，未繞過核准。最終結果見 final-verification／browser-results／migration-evidence，原始 logs 留在 ignored .wrangler。

## 10. 尚未解除的阻擋 — BLOCKED／NOT VERIFIED

- **BLOCKED**：OAuth 已過期，正式版本／Route／Binding／D1／Access／Secret 名稱／Rate Limiter／Cache Rules 未核對。
- **BLOCKED**：不可變 deployment Commit、正式回滾 version／相容性、乾淨 checkout 輸入與可發布 artifact 尚未核准。
- **BLOCKED**：16 個歷史正式 metadata 檔案提交處置及 F1 gateway 分組依賴待人工核准；六組方向核准不等於 212 檔核准。
- **NOT VERIFIED**：0003 正規化後 Blob／換行提交策略與乾淨 checkout 驗收；目前工作檔的 R4 一致性已 PASS。
- **FAIL／BLOCKED**：原 SQL export 不能直接 import；受控合成 restore PASS，但正式 loader／Time Travel／正式備份適用性未核准。
- **BLOCKED**：正式分散式 Rate Limiter 未證實，候選缺 binding，不由本輪新增正式配置。
- **NOT VERIFIED**：高 BODY CLS 根因／正式觀測、正式 hostname canonical、目錄 SEO 決策。
- **NOT VERIFIED**：RTO／RPO／容許停機及資料損失、寫入凍結及恢復責任人。
- **FAIL（低風險格式）**：既有尾端空白未改；不把它和功能測試失敗混稱。

## 11. D-7B 前人工核准 — BLOCKED

1. 逐檔／逐 hunk 提交範圍、metadata 保護／排除策略、F1 gateway 同組或依賴、0003 clean Blob 策略；本輪仍禁止 git add／commit／push。
2. 以清理後乾淨 checkout 建立不可變候選 SHA、核准 build inputs／artifact 內容與 hash，再對 release 產物驗證。
3. 恢復唯讀授權並核對正式帳號／Worker／DB／hostname／Access／Secret 名稱／Rate Limiter／CDN，查明真實 tracking／Schema；不假設 0013。
4. 選定與目前資料語意相容的 Worker rollback version、正式受保護恢復流程與已驗證備份，核准 RTO／RPO／停寫窗口及可接受的資料損失；R5 未建立正式備份。
5. 核准 CLS 尚未驗證風險處置、正式 smoke 範圍與獨立合成寫入驗證方法。
6. 另就精確 pending Migration（若有）、部署版本及執行者取得**明確 D-7B 授權**；本報告與 R5 附條件核准不構成部署授權。

## 12. GO／NO-GO — BLOCKED／NO-GO

本機功能、建置、Migration 重播與受控合成還原均有可追溯證據；正式狀態、正式恢復能力、限流、不可變 release 與 CLS 風險尚未解除，**NO-GO**。R5 到此停止。沒有正式寫入／Migration／備份／匯出／還原、Cloudflare 部署或設定變更，沒有 git add／commit／push／Release；NotBGG 功能與 Migration 均未修改。
