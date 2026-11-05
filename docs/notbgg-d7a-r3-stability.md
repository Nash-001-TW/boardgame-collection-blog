# D-7A-R3：CLS 穩定性與空庫 Migration 重播調查

## D-7A-R4 更新：0003 BOM 編碼相容修正（2026-11-04）

本節取代下文「原檔空庫仍 FAIL／尚未授權修改 BOM」的歷史結論。使用者已明確授權只移除 0003 的前三個 BOM 位元組；SQL、檔名、編號及所有其他位元組不變，0001／0002／0004～0016 完全不變。

| 位元組驗證 | 修改前 | 修改後 |
| --- | --- | --- |
| 檔案 | `migrations/0003_sleeve_size_validation.sql` | 同名 |
| 開頭 | `EF BB BF 43 52 45 41 54 45` | `43 52 45 41 54 45` |
| 長度 | 494 bytes | 491 bytes |
| SHA256 | `2d0f6c76f1ba6f80702a467c8ccee9571c1e0a1d257062a93d0b668d9820f03b` | `211ed3bb90dc24e5be0e39dc6b7b6662967b3b9863099f582ab020835b8f11f0` |
| CRLF／LF 計數 | 1／15（LF 含 CRLF 中的 LF） | 1／15，原混合換行格式保留 |

寫入使用 Buffer.subarray(3)，直接 assert 新檔與原 Buffer 去掉前三 bytes 完全相等；再以「BOM＋目前檔案」SHA256 等於原 SHA256 重驗。這是工作目錄實際位元組證據，不只是文字 diff。未執行 Git commit／換行正規化。

**已套用相容性**：目前 Wrangler 4.149.0 建立的 d1_migrations 欄位為 id、name（UNIQUE）、applied_at；getUnappliedMigrations 只比對檔名，沒有 SQL hash／checksum 比對。專案未發現額外的 Migration hash 執行策略。更改同名 0003 編碼不使已登記檔案重跑；沒有刪除／改寫已套用登記。正式環境或外部另設 checksum 政策仍未遠端核對，不擴張為其他部署工具的保證。

**驗證直接使用專案正式 `migrations/` 目錄的絕對路徑，沒有複製／修補 SQL 到臨時目錄。** 只有本機設定、隨機 Database ID、persistence 及 synthetic rows 位於臨時路徑，Wrangler 僅允許 --local，清除 CF 憑證環境並隔離 XDG 設定，不讀正式資源。診斷入口：`node --import tsx tests/d7a-r4-migrations.mjs`。

| 本輪路徑／檢查 | 結果 |
| --- | --- |
| 空庫→0001～0016，真實 Wrangler | **PASS**，16 筆依序登記；0002／0005／0006 原有 BOM 未改，亦成功 |
| 模擬已登記 0013 的既有本地庫→0016 | **PASS**，原 13 筆 id／name／applied_at 及合成舊 V2 row 不變 |
| 已套用 0003 不重跑 | **PASS**，升級基線額外設置禁止再次登記 0003 的測試 Trigger，未觸發 |
| 再次執行兩組 Migration apply | **PASS**，No migrations to apply；tracking／Schema／NotBGG 身份、修訂、事件、關聯數不變 |
| 0003 INSERT／UPDATE Trigger | **PASS**，合法尺寸可新增，逆序尺寸新增／更新均拒絕 |
| Index／Foreign Key | **PASS**，關聯索引存在、FK 開啟、關聯外鍵存在、foreign_key_check 空 |
| 0015 DELETE／archive | **PASS**，硬刪除拒絕，合法封存保留列 |
| D-6 流程 | **PASS**，candidate→linked→BGG primary→unlinked，歷史保留 |

證據：[d7a-r4-migration-evidence.json](./d7a-r4-migration-evidence.json)。既有 0013 基線由隔離 helper 建立並填入合成的歷史登記，非正式資料複製；升級與空庫套用本身都由真實 Wrangler 讀專案目錄執行。

本輪回歸：**305／305 全套自動化 PASS**（29 個 test.ts，含 F1 的 210 個 HTTP 情境與 D-5／D-6 既有測試）；TypeScript strict PASS；Astro check 0 errors／0 warnings／13 hints；直接 Astro production build PASS（55.08 s，未執行 npm 資料初始化 prebuild）。BGG SHA256 仍為 `1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`。本輪只新增 R4 隔離驗證腳本與必要證據／更新文件，沒有改 SQL 語意、其他 Migration、應用程式或依賴版本。

**F4 的本機空庫重播阻擋已解除**，不再需要 R3 的暫存去 BOM 控制組或另開 Migration。R3 下文的失敗／控制組與原診斷腳本代表修改前歷史，不當作目前原檔驗收結果。完整 production 私人資料備份／還原、正式 tracking／Binding／Access／限流／部署與回滾仍 NOT VERIFIED；高 BODY CLS 仍 NOT VERIFIED，整體維持 **NO-GO**。本輪沒有遠端 D1、部署或正式設定修改。

日期：2026-11-04。**整體 NO-GO，不部署。** 已修復可穩定重現的小幅 CLS；早期 BODY 高位移未重現，仍為 **NOT VERIFIED**。空庫 0003 的失敗已確認是 BOM 與 Wrangler splitter 的相容性問題，但尚未授權修改歷史檔案，原始檔案的 CLI 空庫重播仍 **FAIL**。0013→0016 升級則獨立 **PASS**。

## 1. 測試環境與證據

本輪有效手機量測共 **22 次**：修補前 Grid 10 次、修補後 Grid 10 次、修補後 List 2 次；每次全新 Edge headless process／context，無共用瀏覽器 cache／session。所有有效樣本都保留，沒有挑最佳結果。

沿用 D-7A：Windows、Edge 156.0.4314.58、本機 production Worker＋實際 dist/client ASSETS、隔離 Miniflare D1／KV、815 BGG＋3 合成 NotBGG。每次先以桌面 1440×1000 載入完整 818 筆，再切換手機並獨立導航，沿用先前的導航次序。

| 條件 | 全部有效手機樣本 |
| --- | --- |
| Viewport | 390×844 CSS px；DPR 記錄於每次 JSON |
| 網路 | latency 150 ms、download 200000 bytes/s、upload 100000 bytes/s、cellular3g |
| CPU | CDP rate=1，未加入額外 CPU slowdown；與原 D-7A 無 CPU 節流一致 |
| Cache | CDP cache disabled；新 process／context |
| HTML 傳輸 | 原 D-7A Node bridge，identity encoding，非正式 CDN 壓縮 |
| 圖片 | 外部請求攔截成 300×400 合成 SVG；沒有下載真實 BGG 封面 |
| 觀測窗口 | 導航 load／控制器就緒後額外 1200 ms；frame 狀態記錄至導航後 10 s |
| CLS 算法 | 排除 hadRecentInput，最大 session window：相隔不超過 1 s、總長不超過 5 s；另保留 shiftTotal |

原始量測檔（含全部 shift 時間、DOM before/after rect、CSS 資源時間、圖片屬性／狀態、字型、初始 view、SSR／client keys、錯誤）：

- [修補前 10 次](./d7a-r3-cls-baseline.json)
- [修補後 Grid 10 次](./d7a-r3-cls-after.json)
- [修補後 List 2 次](./d7a-r3-cls-after-list.json)
- [Migration 原始／控制組證據](./d7a-r3-migration-evidence.json)

記錄器初次執行因 tsx 的 keepNames `__name` helper 沒進入序列化瀏覽器函式，觀測器未安裝，曾產生 null LCP／空 frames。這些是**無效測試**，沒有算作 CLS=0 或計入 22 次；原因與 10 個無效嘗試的錯誤摘要保留於 [invalid-instrumentation](./d7a-r3-invalid-instrumentation.json)。修正後加入錯誤／null LCP／空 frame 檢查，避免再產生假成功。

基線採樣期間另曾嘗試 production build，因正在使用的 ASSETS 目錄被鎖，在清理階段出現 EPERM，未產生新產物；保留全部基線資料，不挑除前幾次。這段主機負載不是完全受控，不能把 LCP 微小差異當優化成果。關閉 runtime 後重建成功，修補後主要採樣期間沒有其他瀏覽器回歸或 build 同時執行。

CLS 定義與良好門檻 0.1 依 [web.dev 指標說明](https://web.dev/articles/cls)。本機 22 次不是正式使用者 p75 Core Web Vitals。

## 2. CLS 全部有效測試數據

時間為相對 navigation start 的毫秒。B=修補前 Grid；A=修補後 Grid；L=修補後 List。各列的 viewport／網路／CPU 相同，詳見上表與 JSON。沒有 shift 的列沒有「shift DOM／時間」，不是漏測。

| 樣本 | 初始 view | CLS | LCP ms | Layout Shift 時間 ms | 位移 DOM |
| --- | --- | --- | --- | --- | --- |
| B1 | Grid | 0.00954154 | 3644 | 4692.7 | `.game-grid`、`.result-actions` |
| B2 | Grid | 0.00954154 | 3620 | 4632.7 | 同上 |
| B3 | Grid | 0.00954154 | 3636 | 4656.1 | 同上 |
| B4 | Grid | 0.00954154 | 3640 | 4633.5 | 同上 |
| B5 | Grid | 0.00954154 | 3636 | 4614.1 | 同上 |
| B6 | Grid | 0.00954154 | 3632 | 4608.2 | 同上 |
| B7 | Grid | 0.00954154 | 3620 | 4621.6 | 同上 |
| B8 | Grid | 0.00954154 | 3640 | 4647.2 | 同上 |
| B9 | Grid | 0.00954154 | 3632 | 4611.1 | 同上 |
| B10 | Grid | 0.00954154 | 3624 | 4569.4 | 同上 |
| A1 | Grid | 0 | 3620 | — | 無 |
| A2 | Grid | 0 | 3652 | — | 無 |
| A3 | Grid | 0 | 3640 | — | 無 |
| A4 | Grid | 0 | 3640 | — | 無 |
| A5 | Grid | 0 | 3600 | — | 無 |
| A6 | Grid | 0 | 3616 | — | 無 |
| A7 | Grid | 0 | 3624 | — | 無 |
| A8 | Grid | 0 | 3616 | — | 無 |
| A9 | Grid | 0 | 3608 | — | 無 |
| A10 | Grid | 0 | 3636 | — | 無 |
| L1 | List | 0 | 3648 | — | 無 |
| L2 | List | 0 | 3660 | — | 無 |

Grid 基線平均 LCP 3632.4 ms，修補後 3625.2 ms；不將 7.2 ms 差異宣稱為有效速度改善。CLS 基線 10／10 為 0.009541543057468127；修補後 10／10 為 0，List 2／2 為 0。

## 3. 已確認的小幅 CLS 根因與修正

SSR 已計算篩選結果與首批卡片，卻輸出空白 `<p data-game-result-count>`。`game-list-controller` 初始化後填入「找到 327 款遊戲」，在 390px 工具列新增約 21px 文字行高，推動 `.result-actions` 與下方 Grid。實際 B1 前後：actions y=500.875→521.875，Grid y=557.875→578.875；相鄰 controller/count mutation 時間與 shift 時間一致。

只改兩個現有元件：

- `src/components/GameList.astro`：保留一次 `selectCatalogEntries` 的完整 matched 結果，以 matched.length 傳入 controls，首批仍 slice 24，沒有額外查詢、沒有改搜尋／排序／URL 語意。
- `src/components/CatalogBrowserControls.astro`：SSR 直接顯示相同語言／相同篩選的結果數量，內容與 client controller 完全一致；沒有用假值、隱藏內容或延遲顯示來降低 CLS。

`tests/catalog-initial-count.test.ts` 驗證真實 production HTTP 的中文全部 815、英文 List 全部 815、搜尋空結果 0、現有 BGG 配件篩選結果 1，且不是只顯示初始 24。這是 Astro SSR 加原生 client controller 的 DOM 增補，沒有 React／Vue hydration；首批 SSR／client keys 在 22 次量測均一致。

## 4. 圖片、字型、Grid／List 與早期高 CLS

Grid 圖片 width／height attribute 為 300／400、decoding=async，cover-shell aspect-ratio=3/4；首屏代表圖片實際約 172×229.33px、naturalWidth／Height=300／400。各樣本完整圖片摘要及首四張的 rect／complete／loading 均保存於 JSON。lazy 未進入載入範圍的圖片保持 pending 是預期行為，不視為失敗；本次沒有圖片失敗或由圖片尺寸引起的 shift。

Grid／List 初始 data-view 正確，沒有 Grid 閃成 List；List 使用原有縮圖及內容兩欄結構，首圖 96×128px。各樣本均為 24 張圖片；Grid 的 capture 時點 12 loaded／12 pending，List 9 loaded／15 pending，皆 0 failed。CSS 在首次已記錄的 frame 都已載入、body margin=0；沒有重現 body margin 8→0。字型 CSS 堆疊沿用 Microsoft JhengHei／Noto Sans TC／Arial／sans-serif，document.fonts 全部記錄為 loaded、fontFaces=0，沒有 webfont 網路請求或 loading→loaded 引起的位移。本輪沒有調整圖片品質／來源、字型或 CSS。

**早期單次 BODY shift≈0.33842 的實際根因仍 NOT VERIFIED。** 本輪 22 次有效樣本都未重現它；不能用結果數量的小幅位移解釋該 BODY 高位移，也不能宣稱 F3 完全解除。原證據仍在 `d7a-local-evidence.json.mobileHistory`。若需進一步驗證，應在核准的 Preview／正式相容環境補實際圖片、壓縮與 CSS delivery／長觀測窗口；本輪合成圖片與有限窗口無法排除所有晚發或實際網路問題。

## 5. 0003 原始 SQL 與根本原因

依檔名排序，順序為 0001→0002→0003→…→0013，之後 0014→0015→0016；完整名稱與各檔 SHA256 在 Migration JSON。原始空庫 CLI 實際只登記成功 0001、0002，於 0003 回報：

```text
incomplete input: SQLITE_ERROR
```

0003 開頭位元組是 `EF BB BF 43 52 45…`（UTF-8 BOM＋CREATE）。檔案要建立兩個完整 Trigger：

```sql
CREATE TRIGGER IF NOT EXISTS trg_sleeve_sizes_validate_insert
BEFORE INSERT ON sleeve_sizes
FOR EACH ROW
WHEN NEW.width_tenth_mm > NEW.height_tenth_mm
BEGIN
    SELECT RAISE(ABORT, 'Sleeve size must be short side first');
END;
```

第二個是同條件的 BEFORE UPDATE OF width_tenth_mm, height_tenth_mm。依賴 `sleeve_sizes` 與兩個尺寸欄位；0001～0002 已建立它們，原生 `PRAGMA table_info` 證實存在，沒有缺表／缺欄位，也不需要特殊歷史資料才能建立 Trigger。

Wrangler 4.149.0 的 `unstable_splitSqlQuery` 可直接重現：保留 BOM 時輸出 **3 段**，第一段在內部 `RAISE(... )` 的分號即結束，缺少 END；第二段為獨立 `END`；第三段才是完整 update Trigger。splitter 把 BOM 當 identifier 的一部分，使開頭 `CREATE` 無法進入 CREATE→TRIGGER 狀態，誤用普通 SQL 的分號邊界。`trimSqlQuery` 在此路徑沒有移除開頭 BOM。

在記憶體中只去掉首個 U+FEFF，同一 splitter 正確輸出 **2 個完整 Trigger**。同一個本地 D1：送錯切的 3 段得到 identical incomplete input；改送完整 Trigger 且**第一段仍保留 BOM**則成功建立兩個 Trigger，非法 700×600 尺寸也正確遭拒。這排除「SQLite 不接受原始 Trigger／BOM」與「Schema 不相容」，問題位於 CLI 分段。

版本：Node 24.21.0、Wrangler 4.149.0、Miniflare 5.20261006.1-alpha。D1 authorizer 拒絕 `sqlite_version()`，所以精確 D1 SQLite 版本 **NOT MEASURED**；沒有假借 Node SQLite 版本代表 D1。其他 Wrangler 版本未測試，不能宣稱升級最新版必然修好。

## 6. 空庫控制組、正式升級與災難復原

| 路徑 | 實際結果 | 判斷 |
| --- | --- | --- |
| 全新隔離 D1，原始檔案＋真實 Wrangler migrations apply --local | FAIL；只成功 0001／0002，0003 incomplete input | 目前原檔 CLI 新安裝不可宣稱可重建 |
| 另一全新隔離 D1，**只在臨時副本移除 BOM**、同名 SQL＋同一 Wrangler | PASS；0001～0016 全部套用且 tracking 有 16 筆，FK check 空 | 證實 BOM 是此次阻擋因素；診斷控制組不是已上線的修正 |
| 新合成 0013 native 基線→**原始**0014→0015→0016，真實 Wrangler | PASS；每次 d1_migrations 有正確名稱 | 保留既有升級驗證，不因舊 0003 失敗否定此路徑 |

臨時正規化副本僅移除 0002／0003／0005／0006 的開頭 BOM，沒有改 SQL 內容、名稱、順序或 repo 原檔；這些檔案中首先碰到會被內部分號破壞的 Trigger 是 0003。診斷後刪除臨時設定／狀態／副本。沒有使用正式資料或把正式資料複製出來。

**正式升級安全性**：若實際正式環境已正確在 0013，pending 0014～0016 無 BOM，獨立升級測試通過；仍須在授權階段核對正式 Schema／tracking／身份／備份。沒有遠端查詢，不能拿本機推定正式基線。若正式低於 0003 或狀態不一致，停止並另行審查。

**新安裝／災難復原**：目前從原檔以鎖定 CLI 版本重播會失敗，是未解除的可重建性阻擋。這不表示既有資料庫必須回滾，也不表示 Time Travel／整庫備份還原一定失敗；後兩種還原路徑未執行。不能把成功的 native 測試 helper 當正式 recovery 工具。

待人工決策的相容方案（本輪都未套用）：

1. **受控正規化 runner**：保留歷史原檔不變，只對新安裝／重建產生可驗證的暫存 SQL（同檔名、去 BOM、原始／轉換後 hash manifest），再由 Migration manager 登記。控制組已驗證技術可行，但正式工具的路徑／權限／fail-closed／恢復程序仍需審查，不能直接拿診斷腳本操作正式庫。
2. **授權後僅移除歷史 BOM**：若選擇直接修正 0002／0003／0005／0006 的檔案編碼，需明確核准、提交獨立 Commit、證明除了 3 bytes BOM 外沒有 SQL 差異，確認共用環境／checksum 政策；已套用者不重跑，不修改 d1_migrations。這屬歷史 Migration 修改，本輪未授權也未執行。
3. **工具修補／版本升級**：使用已證實修復 BOM tokenizer 的 Wrangler 版本或上游修補，重新驗證兩個完整 Trigger、全鏈重播與 0013 升級；目前沒有已驗證的替代版本，不自動改依賴或 patch node_modules。

## 7. 完整回歸

回歸於修補後 production 產物執行。量測與瀏覽器功能回歸分開，避免把同時跑多個瀏覽器的回歸時間當效能數據。

| 檢查 | 最終結果 |
| --- | --- |
| 全套自動化 | **PASS：305／305，29 個 test.ts，0 fail／skip**；包含 D-1～D-6、A-2／A-3 與新增 SSR count 5 項 |
| F1 真實 HTTP | **PASS：210 個路徑／方法／身份狀態情境**，production Worker＋ASSETS；CSS／JS／favicon 位元組一致、無多餘 D1 |
| D-5 瀏覽器 | **PASS**：桌面／手機、Access、收藏／副本／購買／語言、scope、封存與隱私 |
| D-6 瀏覽器 | **PASS**：桌面／手機、候選／確認／來源切換／解除、CAS、舊網址／canonical、收藏及關聯保留 |
| C-1 | **PASS：11 項**，24→48→815、815 個唯一項目 |
| C-2 | **PASS：4 項** |
| C-3 | **PASS：5 項** |
| TypeScript strict | **PASS**：tsc --noEmit |
| Astro check | **PASS**：0 errors／0 warnings／13 hints |
| Production build | **PASS**：58.51 s，直接 Astro build；沒有執行 npm 資料初始化 prebuild |
| Migration 原檔完整性 | **PASS**：0001～0016 的 SHA256 前後一致；沒有修改 node_modules／lockfile |
| BGG SHA256 | **PASS**：與指定基準一致 |

全套第一次失敗是新測試誤以為無 NotBGG 時配件篩選為 0；查證既有 BGG #448621 就是配件，應為 1。只修正測試預期，沒有改資料或分類。重跑 focused 5／5，再全套 305／305。C-1／C-3 首次功能檢查已 PASS，但退出清理遇 Windows EBUSY；單獨重跑皆以 exit 0 完成，沒有修改它們的測試程式。這些嘗試沒有被描述為產品已通過的首次驗收。

可重跑的診斷入口：

```text
node --import tsx tests/d7a-r3-cls.ts <playwright-module-path> <edge-executable> 10 baseline
node --import tsx tests/d7a-r3-cls.ts <playwright-module-path> <edge-executable> 10 after
node --import tsx tests/d7a-r3-cls.ts <playwright-module-path> <edge-executable> 2 after-list list
node --import tsx tests/d7a-r3-migrations.mjs
```

`baseline`／`after` 是證據檔名標籤，不會替換應用程式版本；要重做真正修改前基線需使用對應的受控程式版本，不能在修補後版本執行 baseline 標籤便宣稱量到修補前結果。

## 8. 修改檔案與完整性

應用程式只改 `src/components/GameList.astro`、`src/components/CatalogBrowserControls.astro`。新增：`tests/catalog-initial-count.test.ts`、`tests/d7a-r3-cls.ts`、`tests/d7a-r3-migrations.mjs`、本報告及必要的上述 JSON 證據。既有 D-7A JSON 由回歸更新，F1／F2 證據保留。

**0001～0016 全部原檔 SHA256 維持不變**；0014／0015／0016 沒有再次修改。BGG 快取 SHA256：`1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91`。沒有修改 Parser、官方關聯、正式 D1、正式資源／設定、Secret，沒有提交 Git 或部署。

## 9. GO／NO-GO 與剩餘風險

**NO-GO**。F1／F2 的本機修復保留；穩定出現的 0.00954 位移已最小修復並在 12 次後測為 0，但歷史高 BODY CLS 仍 NOT VERIFIED。R3 當時 F4 尚為 FAIL；後續 R4 已依明確授權僅移除 0003 BOM，專案 Migration 原目錄的空庫重播、既有升級與不重跑驗證均 PASS，F4 本機阻擋已解除（詳見首節）。這不取代正式私人資料恢復驗收。

其他既有事項沒有自動解除：正式 Access／路由與 Cache Rules、限流、不可變 release Commit、正式基線核對、備份／回滾版本及實際恢復演練。沒有自動開始下一階段；需要人工確認的是 recovery 相容方案與後續授權，並非本輪已執行正式操作。
