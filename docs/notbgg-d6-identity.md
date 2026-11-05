# D-6：NotBGG → BGG 身份、主要來源與可逆別名

本輪只在本機及全新隔離 Miniflare D1 開發／驗證。沒有操作正式／遠端 D1、沒有套用遠端 Migration、沒有部署。本文取代 D4「已確認項目暫不公開」及 D5 對這類項目的暫不可用投影；不改寫先前階段報告的歷史紀錄。

## 1. 架構盤點與資料庫

0014 已具備候選目標、pending／linked／revoked、獨立 primary_source、確認／解除資訊、不可變歷史與兩端有效一對一唯一索引，不需要重建身份表。0015 的收藏及兩種手動配件關聯繼續沿用。

只新增 `0016_notbgg_link_commands.sql`：

- `notbgg_link_command_gate`：在寫入既有不可變事件時，檢查來源最後事件 ID、NotBGG 原稿 revision，以及批次後應有的 link 狀態／主要來源。失敗會讓整個 D1 原子批次回滾。
- `notbgg_linked_type_guard`：有效對應存在時，不允許一般原稿編輯改變遊戲類型，必須先解除對應。API 提供明確 409 訊息；資料庫保護仍可攔截競爭情況。

沒有修改舊 Migration、沒有新增平行身份或收藏表。命令執行前檢查 0016 保護是否存在；缺少時回報 `SCHEMA_NOT_READY`／503，不降級成只有應用層檢查的寫入。

## 2. 狀態機

| 介面狀態 | 既有契約／資料庫 | 說明 |
|---|---|---|
| unlinked | 沒有 pending／linked 記錄 | 可提出新候選；舊 revoked 歷史仍保留 |
| candidate | `NotBggLinkStatus.pending`／link.status=pending | 尚未確認，不影響公開去重 |
| linked | linked | 已確認同一身份，主要來源另由 primary_source 決定 |
| 解除後 unlinked | 原 link 改為 revoked | 不刪除身份、原稿、收藏或舊事件 |

既有契約沒有 promoted，本輪不新增模糊的儲存狀態。BGG primary 是 linked 狀態的顯示選擇，不代表刪除／替換 NotBGG 身份。

`propose → confirm → primary（可來回）→ revoke` 都是獨立後端命令。候選若要改目標，先取消，再建立新的 proposal；已確認項目解除後也使用新 proposal，不重新啟用舊 revoked 記錄。

## 3. 目標驗證與人工確認

只使用既有 `getGames()`／BGG 快取，接受正的 safe integer BGG ID，沒有 BGG API、匯入或名稱相似度判斷。

比較介面提供兩邊名稱、類型、年份、圖片與來源欄位。確認時再次驗證 BGG 目標存在且原始 type 完全相容。配件不能對應 boardgame 本體；未提供強制忽略類型的例外開關。目前快取若沒有適合的配件類型，就不能確認配件對應。

確認時只登記／沿用獨立的 BGG `v2_games.id`，不修改 NotBGG 的 game_id、永久 ID、source、原始欄位或原稿修訂。新有效對應預設 **NotBGG primary**，改成 BGG 必須另按來源切換按鈕並填原因。

## 4. 並行、原子性與歷史

命令同時要求：

- `expectedEventId`：該永久來源最後的對應事件 ID；這是版本 token，不是自行分配 ID。
- `expectedProfileRevision`：管理員實際比較過的原稿版本。

事件與原稿兩種版本都可能造成 409。管理頁不自動重試覆寫；使用者須手動載入最新資料、重新比較。資料庫事件 gate 再於原子批次內檢查一次，避免讀取與寫入之間被其他操作改變。

既有有效一對一唯一約束繼續生效；條件式 UPDATE 防止競爭者改寫已確認／已解除的紀錄。重複確認回報明確的衝突或非法轉換，不假裝新增第二次成功。所有原因、操作者、時間與操作狀態保留於原有 link／event 表。

只使用 D1 `batch`，不使用手動 BEGIN／COMMIT。晚段事件失敗會回滾主要來源、確認與相關 BGG 身份登記，不留下缺事件的成功狀態。已提交事件不可修改或刪除。

## 5. 公開目錄與身份

BGG 仍是數字 ID；NotBGG 仍是永久來源 ID。沒有將 BGG ID 型別改成字串 union。

公開讀取只取 linked、NotBGG 原稿未封存且 BGG 目標仍存在的白名單資料：來源 ID、主要來源、名稱與圖片。不含 link ID、內部 game ID、actor、reason、event、editorNotes 或修訂快照。

- 未對應／只有候選：兩邊各自出現，名稱相同也不合併。
- 有效確認：只取指定主要來源的卡片內容，保留兩個精確搜尋身份。
- 群組穩定 key 使用永久 NotBGG ID，切換來源不換 key。
- `#194655`、`BGG:194655`、`NotBGG:000001` 均能命中同一張主要卡片；名稱搜尋保留兩邊公開名稱／別名。
- NotBGG primary 不借用 BGG 評分、排名或複雜度；BGG primary 沿用原 BGG payload，不改官方資料。
- 解除後恢復兩個獨立來源及各自的 key／網址。

每次目錄使用兩個固定 D1 查詢（精簡原稿與身份索引），不逐筆查詢，合併使用 Map。六種排序、缺值規則、分類、24 筆載入、Grid/List、URL／返回定位沿用既有規則。

## 6. 靜態 BGG 相容方案與網址

沒有把所有 BGG `[slug]` 改成 SSR，也沒有改動本輪既有 BGG 靜態路由實作或自訂 slug。

依官方支援方式新增 `src/worker.ts` 作為入口；`wrangler.json` 只新增 main 及 `/games/*`、`/en/games/*` 的 `assets.run_worker_first`。其他路由交給原 Astro handler，管理驗證不會被略過。

| 目前主要來源 | 原 BGG slug | 原 NotBGG URL |
|---|---|---|
| NotBGG | 307 到原 NotBGG URL | 200 原稿與雙身份說明 |
| BGG | 200 既有靜態 BGG 內容與雙身份說明 | 307 到既有 BGG slug |
| 解除 | 200 原 BGG 內容 | 200 原 NotBGG 內容 |

中英文各自保留路徑，導向保留 query，不以 301 固定錯誤身份。每個有效狀態只有單一方向的別名，不形成循環。

主要 200 頁使用單一 absolute canonical 指向目前語系的主要 URL；別名使用 307，不建立另一份可索引的 200 複製內容。BGG 靜態內容由 Worker HTMLRewriter 補 canonical 與公開身份說明，原官方資料不改動。NotBGG 由 SSR 輸出自身 canonical。

官方實作依據：[Astro Cloudflare 自訂 Worker 入口](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)、[Cloudflare Worker 優先路由](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)。

## 7. 可見性與快取

- 原稿封存後仍依 D4 回傳 404，不把私人封存原稿透過對應公開。這類來源不加入公開身份索引，既有公開 BGG 可獨立顯示。
- BGG 目標缺失時不能確認或切到 BGG；仍可切回有效 NotBGG 或解除。公開解析不導向無效目標，活躍原稿可安全回到原始 NotBGG 顯示。
- 未配置 DB 時，BGG 入口保留原始公開靜態頁並顯示身份解析不可用提示；NotBGG／管理 API 安全失敗。D1 查詢錯誤回一般化 503，不輸出 SQL。
- 動態身份回應／307 使用 `no-store`，不新增應用快取。BFCache 返回會重新請求以解析最新身份。
- BGG 靜態取回前移除 If-None-Match／If-Modified-Since，改寫後移除 ETag／Last-Modified，防止舊 304 本文留住錯誤身份說明或 canonical。

資料新增、來源切換、解除、封存於下一次請求可見，不做跨分頁即時推播。

## 8. 收藏與手動配件關聯

收藏查詢只增加白名單 join 投影；**不更新**收藏 game_id、collectionId、副本、價格、語言、日期、私人備註、record_scope 或採購圖。

adapter 保留原 `bggId / notBggId / gameId`，另提供目前主要名稱與來源 key、圖片及連結。個人 displayName 不被覆蓋。卡片同時顯示原始引用與目前主要身份；兩筆收藏即使現在解析到同一遊戲，仍是兩筆。

配件關聯保留原 source_game_id／target_game_id 與兩種類型，只在顯示時解析名稱、圖片、href。公開 originalKey／GameRef 保留原來源身份；解除後自然回到原連結，不需搬資料。

BGG 官方 expansion／implementation／compilation 資料、Parser、A-2／A-3 沒有改動。既有官方連結仍指向原 BGG slug，再由相同入口做公開身份解析。

## 9. 管理頁與 API

管理頁 `/admin/notbgg/[id]/link?lang=en`，繁體中文為預設。原稿編輯頁新增明確入口，普通儲存不會觸發身份命令。

頁面包含候選查詢、兩邊比較、必填原因、建立候選、人工確認、兩種主要來源、取消／解除、分頁歷史。確認／解除有對話提示，取消不寫入；顯示的比較目標與版本不符時不能直接確認。桌面、手機、鍵盤與純文字安全輸出通過。

| 方法 | API | 內容 |
|---|---|---|
| GET | `/api/admin/notbgg/[NotBGG ID]/link` | 原稿、目前候選／對應、事件版本（管理員資料） |
| GET | `.../link/compare?bggId=194655` | 既有 BGG 與 NotBGG 比較、原稿比較版本、類型相容性 |
| GET | `.../link/history?after=0&limit=20` | 不可變操作歷史；最多 100 筆／頁 |
| POST | `.../link` | action、expectedEventId、expectedProfileRevision、reason；另依操作指定 bggId／linkId／primarySource |

每個 API 獨立驗證 Access JWT 簽章、issuer、audience、期限與允許身份。actor 只能來自驗證後 subject。沿用 D3 Origin、Sec-Fetch-Site、custom header、JSON 格式／大小／欄位／深度限制及選配 NOTBGG_WRITE_LIMITER。未配置 limiter 不宣稱有正式分散式限流。

middleware 在 LOCAL_ADMIN_DEV 下仍保護這些路由；API 不能依賴隱藏按鈕。未知管理欄位會被拒絕，錯誤只回安全代碼，管理／稽核回應禁止快取。公開頁面不呼叫管理 API。

## 10. 驗收

- 完整相關自動化 **159/159 PASS**：D1～D6、C、A-2／A-3。
- 真正重疊的並行呼叫：同 BGG 的兩個來源競爭確認、同筆確認、同筆解除、來源切換；均只一個成功，其餘衝突。這些不是順序模擬。
- 故障注入：晚段稽核失敗全回滾，事件／原稿版本衝突不產生假成功，0016 缺失時不寫入。
- 人工比較後原稿被另一編輯修改，即使對應事件版本沒變也拒絕確認。
- 實際 workerd + 隔離 D1 + HTMLRewriter：自訂 santorini slug、英中文 307、單一 absolute canonical、保留靜態本文、舊 ETag／304、一般化 503 通過。此測試以靜態 handler fixture 替代 Astro handler，不宣稱已驗收正式 ASSETS 路由。
- D6 實際 Astro 元件／控制器桌面與 390px 手機：候選、取消／確認、來源切換、409／手動 reload、雙網址、canonical、精確 ID、Grid/List／URL／返回、收藏／配件引用保留、解除與封存隱私通過，無 pageerror。
- D3／D4／D5 瀏覽器回歸通過；C1／C2／C3 **11／4／5 checks PASS**，815 與 24→48→815 保留。
- TypeScript strict、Astro check、production build 全數通過；Astro **0 errors、0 warnings、13 hints**。

BGG 快取 SHA256：`1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`，保持不變。

本輪未量測真實外部圖片或正式 Worker／D1 延遲：**NOT MEASURED**。瀏覽器使用合成圖片。正式 Cloudflare Access、ASSETS／邊緣快取、遠端 Migration、正式 D1 與部署後端到端行為：**NOT TESTED**。

## 11. 檔案清單

新增：

- `migrations/0016_notbgg_link_commands.sql`
- `src/lib/notbgg-link-repository.ts`、`notbgg-link-api.ts`、`notbgg-link-controller.ts`
- `src/lib/identity-resolution.ts`、`bgg-identity-gateway.ts`、`src/worker.ts`
- `src/components/NotBggLinkAdmin.astro`
- `src/pages/admin/notbgg/[id]/link.astro`
- `src/pages/api/admin/notbgg/[id]/link/{index,compare,history}.ts`
- `tests/notbgg-link.test.ts`、`tests/notbgg-link-browser.cjs`、本文件

修改：

- `wrangler.json`（main／Worker-first 規則；未操作既有遠端 Binding）
- `src/layouts/Layout.astro`、兩語系 `games/notbgg/[id].astro`
- `src/lib/notbgg-public.ts`、`catalog-browsing.ts`、`game-list-controller.ts`
- `src/lib/collection-v2-repository.ts`、`collection-v2-adapter.ts`、`src/components/CollectionCard.astro`
- `src/lib/notbgg-repository.ts`、`notbgg-admin-api.ts`、`notbgg-admin-controller.ts`（有效對應類型變更保護）
- `src/components/NotBggAdmin.astro`（獨立對應入口）、`src/lib/game-view-model.ts`（只更新來源 adapter 職責註解）
- `scripts/lib/local-games-preview.ts`、`tests/helpers/notbgg-admin-preview.ts`、`notbgg-local-d1.ts`
- `tests/notbgg-public.test.ts`（D6 取代舊 withholding 預期）、`tests/notbgg-middleware.test.ts`（新路由防繞過案例）

工作區其他原有未提交變更保留。本輪未修改 BGG 快取、Parser、官方關聯語意、原 BGG `[slug]` 實作或舊 Migration。

## 12. 上線前事項與步驟（尚未執行）

1. 審閱程式、0016 與既有 Migration 套用狀態；確認目標資料庫與明確授權。依既有流程安排資料庫復原措施，不修改／刪除原始身份與稽核歷史。
2. 先在獲准的 staging 驗證 0014→0015→0016、正式 Access 設定與可選 limiter。0016 未就緒時寫入應為 503。
3. 以完整建置產物驗證自訂 Worker main 與 run_worker_first 確實先於靜態資產；不可只上傳 dist/client，否則動態別名無法生效。
4. 核對正式 canonical origin、兩語系自訂 slug、無永久身份導向、cache rules 不覆寫 no-store，並處理舊 HTML 快取。
5. 在 staging 重新量測 BGG HTML 的 Worker／D1 額外成本與延遲。保留靜態渲染不代表零額外請求成本；本輪沒有用快取換取不正確的解除可見性。
6. 經另行明確授權後才可操作遠端或部署；本輪沒有執行這些步驟。若需回退，先停止管理寫入並保留 schema／歷史，不自動刪表或搬移收藏。回到 D5 顯示策略前須重新審核已確認資料與路由。

D6 本機範圍完成後停止，不自動部署或開始其他階段。
