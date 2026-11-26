# 實體組件照片規劃（#37，候選）

- 日期：2026-11-26（Asia/Taipei）
- 狀態：Q127～Q136 **已採納**（2026-11-26，使用者「全部採建議」，DECISION_LOG PHOTO-37-Q）；**尚未實作**。R2 bucket、`wrangler.json` binding、Migration 0027 都要另外授權。
- 起因：R06 清點卡片已預留縮圖區（DECISION_LOG R06-THUMB-SLOT）。使用者希望能選擇圖片檔案或用手機拍照上傳，把照片指定給實體組件，並在公開網站顯示。

## 1. 使用者已表達的方向（2026-11-26）

| 項目 | 使用者回答 |
| --- | --- |
| 張數 | 一個組件**暫時**只放一張圖（將來可能擴充） |
| 語言版本 | 不同語言版本的桌遊，內容物可能不同，需要說明怎麼處理 |
| 公開網站 | 可以顯示這些照片 |
| 手機拍照 | 支援直接拍照上傳更好 |
| 設定位置 | 依 Claude 建議：放在「組件管理（影響所有副本）」，清點清單只負責顯示 |

## 2. 現有資料結構（唯讀盤點）

- `v2_component_definitions`：組件定義，屬於某個**收藏**（`collection_item_id`），所有副本共用。0007 的註解原本就寫著「零件因版本而不同時，可以連到特定副本」，但目前沒有這個欄位。
- `v2_owned_copies`：副本，已有 `edition` 和 `language_code` 欄位。
- 0024 適用性（`v2_component_applicability_events`）：可以標示某個組件「此副本不適用」。
- 公開網站目前只在卡套需求顯示組件名稱（`src/lib/public-game-collection.ts`），還沒有公開的組件清單。

## 3. 語言版本不同時怎麼處理（建議）

有兩種情況：

1. **內容物不同**（例如中文版少了某個擴充牌組，或多了贈品）：沿用現有機制，不必新做。
   - 各版本特有的組件各自建立一筆組件定義，在不包含它的副本上標記「此副本不適用」（0024）。
   - 每個組件定義有自己的照片，自然就分開了。
2. **內容物相同，只是印刷語言不同**（例如同一組卡牌，一副是中文、一副是英文）：
   - 暫時只放一張「代表照片」，清點時用來辨認組件是哪一種就夠了。
   - 將來如果要依語言顯示不同照片，可以改成「組件 × 語言」的照片表，再按副本的 `language_code` 挑選。第一版的資料表要預留這條路，不要把照片寫死成組件定義的單一欄位。

另一個做法是把不同語言版本建成**不同的收藏**。這樣組件定義完全分開，照片也分開，但同一款遊戲會出現兩筆收藏。這屬於收藏層級的選擇，不影響照片設計。

## 4. 建議架構

### 4.1 儲存：Cloudflare R2

- D1 只存照片的鍵值與中繼資料，圖片檔案放在 R2 bucket。
- 需要：在 Cloudflare 建立 bucket，並在 `wrangler.json` 加入 R2 binding。依 AGENTS.md §2、§5，這兩項都屬於高敏感設定，**需要使用者另外授權**。
- 本機開發和測試使用 Wrangler 的本機 R2 模擬（`remoteBindings:false`），不碰正式 bucket。

### 4.2 資料表（前向 Migration，候選編號 0027）

```sql
-- One current photo per component for now; language_code reserved for later per-language photos.
CREATE TABLE v2_component_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL REFERENCES v2_component_definitions(id) ON DELETE CASCADE,  -- Q135 B：刪除組件時一起刪除照片列，R2 物件交給待清理流程
  language_code TEXT,                -- 第一版固定 NULL（代表照片）
  object_key TEXT NOT NULL UNIQUE,   -- R2 鍵值，伺服器產生，不使用原始檔名
  thumb_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/webp','image/jpeg')),
  width INTEGER NOT NULL, height INTEGER NOT NULL, byte_size INTEGER NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 第一版：每個 (definition_id, language_code) 只能有一張
CREATE UNIQUE INDEX ... ON v2_component_photos(definition_id, COALESCE(language_code,''));
```

欄位細節（是否需要 `is_public`、版本守衛的形式）見問題清單。

### 4.3 上傳流程

1. 在「組件管理」的組件列，或點清點卡片的縮圖，打開「設定照片」對話框，提示「照片會套用到所有副本」。
2. 檔案欄位使用 `<input type="file" accept="image/*">`。手機瀏覽器會讓你選「拍照」或「從相簿選」；若加上 `capture="environment"`，會直接開啟後鏡頭（見 Q130）。
3. 在瀏覽器端用 canvas 處理：依 EXIF 方向轉正、**移除 EXIF（含 GPS 位置）**，輸出兩個尺寸的 WebP，例如大圖最長邊 1600px、縮圖 224px（清點卡片 112px 的兩倍，給高解析度螢幕）。
4. 預覽確認後才上傳。Admin API 使用 multipart 上傳，沿用 Access 驗證、同源檢查、限流與 revision 守衛。伺服器再檢查一次類型、尺寸與大小上限。
5. 先寫入 R2，再用 D1 條件式寫入登記。D1 失敗時刪掉剛寫入的 R2 物件。換照片時，舊物件在 D1 提交成功後才刪除。
6. 可以「移除照片」，縮圖區會回到通用圖示。

### 4.4 讀取

- 公開路由（例如 `/media/components/<key>`）：只讀 D1 中 `is_public=1` 而且所屬收藏是公開狀態的照片，從 R2 串流回應，並設定長快取（鍵值每次更換都不同，可以設成 immutable）。
- 找不到時回 404；D1 或 R2 故障時回 503，不用預設圖掩蓋故障（依 AGENTS.md §4 失敗關閉）。
- 公開投影屬於高敏感區：必須以白名單輸出鍵值，不輸出 R2 內部路徑或中繼資料。

### 4.5 顯示位置

- Admin：R06 清點卡片的縮圖、組件管理列、點縮圖看大圖。
- 公開網站：目前沒有公開的組件清單，需要另外決定放在哪裡（見 Q133）。

## 5. 待決問題（Q127 起）

| 編號 | 問題 | 選項 | 建議（2026-11-26 已採納） |
| --- | --- | --- | --- |
| Q127 | 語言版本差異的處理 | A：內容物不同時用「各自的組件＋此副本不適用」；內容物相同時用一張代表照片；資料表預留 `language_code`。B：第一版就做「組件 × 語言」照片。C：建議把不同語言建成不同收藏 | A |
| Q128 | 儲存位置 | A：R2（需要授權 bucket 與 `wrangler.json` binding）。B：Cloudflare Images（付費服務，另有 API Token）。C：D1 BLOB（不建議，有列大小上限而且會拖慢查詢） | A |
| Q129 | 圖片處理 | A：瀏覽器端轉正、移除 EXIF、輸出 1600px 和 224px 兩種 WebP；伺服器只驗證。B：只上傳原圖，由伺服器縮圖（Workers 沒有內建影像處理，需要額外服務） | A |
| Q130 | 手機拍照 | A：同一個按鈕，由手機選「拍照」或「相簿」（不加 `capture`）。B：分成「拍照」和「選擇檔案」兩個按鈕（拍照按鈕加 `capture="environment"`） | B |
| Q131 | 設定入口 | A：組件管理列，加上點清點卡片縮圖也能打開同一個對話框（都提示套用到所有副本）。B：只在組件管理列 | A |
| Q132 | 上傳限制 | A：原始檔 20MB 以內（手機照片常見大小）；處理後大圖 1MB、縮圖 100KB 以內；只接受 JPEG、PNG、WebP、HEIC（HEIC 要看瀏覽器能否解碼，不能就提示改用 JPEG）。B：另訂 | A |
| Q133 | 公開網站顯示位置 | A：第一版只在後台顯示，公開路由與 `is_public` 先做好，等公開的組件清單規劃好再顯示。B：第一版就在公開遊戲頁新增「組件」區塊（需要新的公開投影規劃）。C：只在公開卡套需求的組件名稱旁顯示小圖 | A |
| Q134 | 個別照片是否可設為不公開 | A：保留 `is_public`，預設公開，對話框可勾「不公開」。B：全部公開，不做欄位 | A |
| Q135 | 刪除組件時的照片 | A：組件有照片時，要先移除照片才能刪除組件（RESTRICT）。B：刪除組件時一起刪除照片（R2 物件延後清理） | B |
| Q136 | 分階段 | A：P1 後台上傳與顯示＋Migration 0027＋R2；P2 公開顯示；P3 多張或依語言照片。B：一次全部做完 | A |

## 6. 需要的授權（實作前）

- 0027 Migration 本機實作與審查；正式套用沿用 A1～A4 流程，另外授權。
- 在 Cloudflare 建立 R2 bucket（由使用者在 Dashboard 操作，或授權 Claude 使用 Wrangler 建立）。
- 修改 `wrangler.json` 加入 R2 binding。
- Admin UI 版面要先給使用者看過截圖再部署（AGENTS.md §5 UI 規則）。

## 7. 風險與注意事項

- 手機照片的 EXIF 可能含 GPS 位置；照片會在公開網站顯示，所以**一定要在瀏覽器端移除 EXIF**，伺服器也不保存原始檔。
- R2 與 D1 不能放在同一個交易裡，要用「先寫 R2、D1 提交成功才算完成、失敗就清掉」的順序，並留一份孤兒物件清理工具（可以之後再做）。
- 公開讀圖路由是新的公開入口，要設定查詢上限與快取，避免大量請求直接打到 D1。

## 8. 定案（2026-11-26）

使用者全部採用建議：Q127 A、Q128 A（R2）、Q129 A（瀏覽器端處理）、Q130 B（拍照與選擇檔案兩個按鈕）、Q131 A（組件管理列與清點縮圖兩個入口）、Q132 A、Q133 A（第一版只在後台顯示，公開路由先做好）、Q134 A（保留 `is_public`）、Q135 B（刪除組件時一起刪除照片，R2 延後清理）、Q136 A（分 P1／P2／P3）。

因為 Q135 採 B，§4.2 草案中的 `definition_id` 外鍵改為 `ON DELETE CASCADE`，被刪掉的 R2 鍵值要先記到待清理表（或清理工具），再由清理流程刪除物件。

**P1 範圍**：Migration 0027（照片表與待清理表）、R2 binding、Admin 上傳／替換／移除 API、照片對話框（拍照與選擇檔案、預覽、提示套用到所有副本）、R06 清點卡片與組件管理列顯示縮圖、點縮圖看大圖、公開讀圖路由（只讀 `is_public=1`，失敗關閉，但 P1 公開頁面還不引用）。

## 9. 工作命令 PHOTO-P1-20261126-01（2026-11-26 已授權，DECISION_LOG PHOTO-P1-AUTH）

- 執行：Codex；審查：Claude。只在本機進行，不連網、不碰正式 D1 或 R2、不部署、不提交。
- R2 binding 名稱 `COMPONENT_PHOTOS`，bucket 名稱候選 `boardgame-component-photos`（正式 bucket 由使用者或另行授權建立）。
- 完成條件：Node 測試涵蓋 Migration、API 守衛與 R2 失敗補償；Edge 瀏覽器腳本涵蓋選檔、預覽、上傳、替換、移除、兩個入口與手機寬度截圖；既有相關測試不回歸。
- **快取規則釐清（2026-11-26，Claude 技術決定）**：Codex 指出長效 `immutable` 快取和 Q134「可設為不公開」互相衝突：照片改成不公開或被移除後，已經快取的副本還會繼續被讀到。§4.4 原本寫的是「可以設成 immutable」，只是選項，不是已採納的規格，所以這裡改用短快取：`Cache-Control: public, max-age=300, must-revalidate`，並附 ETag。照片改成不公開、移除或替換後，最晚 5 分鐘內舊網址就會失效（回 404）。Admin 預覽改走需要驗證的讀圖路徑，並設定 `private, no-store`。

## 10. 審查結果（2026-11-26，Claude）

- Codex 已實作 P1：Migration 0027（照片、R2 待清理、冪等收據三張表與觸發器）、`component-photo-api.ts`／`component-photo-image.ts`（Access、同源、限流、冪等、revision、magic bytes 與尺寸驗證；先寫 R2 再提交 D1，失敗時補償刪除）、Admin 寫入與讀圖路由、公開 `/media/components/<key>`（只回公開照片，`public, max-age=300, must-revalidate`＋ETag／304）、照片對話框與兩個入口，以及 Node 與 Edge 測試。沒有修改 `src/middleware.ts`；Admin 讀圖沿用 middleware 統一給的 `no-store`。
- Claude 的修正：
  1. 清點卡片縮圖改成按鈕後，鍵盤 Tab 會先經過縮圖。這是預期變化，更新了 `tests/admin-collection-detail-browser.mjs` 的焦點斷言。
  2. 照片沒有填滿 112px 方框：全域的 `.admin-page button` 內距和 `.admin-page img{height:auto}` 蓋過了元件的局部樣式。已在選擇器前加上 `[data-count-row] button.component-thumb` 提高特異度。
- Claude 自行驗證：Node 28／28（照片 11、回歸 17）；Edge 照片流程 5／5、組件數量 20／20、Admin collection detail 74／74。Codex 回報 astro check 前後都是 6 個錯誤（新增 0），Claude 沒有重跑。截圖在 `docs/PHOTO-P1-screenshots/`。
- 未驗證：實機手機後鏡頭、EXIF 轉正、HEIC 解碼；孤兒 R2 清理只有待清理表，還沒有清理工具。
- **部署前提**：`wrangler.json` 已加入 R2 binding。正式 bucket `boardgame-component-photos` 不存在時，推送 `main` 觸發的自動部署可能失敗，所以要**先建立 bucket，再套用 0027，最後推送**。
- **對話框美化（2026-11-26，使用者要求，Claude 實作）**：`ComponentPhotoDialog.astro` 改用後台設計 token。版面：標題列加右上角關閉 ✕；「套用到所有副本」改成資訊提示；4:3 照片區（沒有照片時顯示圖示與「尚未設定照片」）；「拍照」和「選擇檔案」兩個等寬的次要按鈕；「不公開」附說明文字；底部分隔線下方是左側紅框的「移除照片」和右側紫色的「確認儲存」。所有 `data-photo-*` 屬性維持不變，控制器沒有改。Node 28／28、Edge 5／5 與 74／74。

## 11. 0027 正式套用

流程比照 0026（A1 唯讀預檢 → A2 備份與本機預演 → A3 套用 → A4 對帳），每一步都要另外授權。

### 11.1 A1 唯讀預檢（2026-11-26，Claude 執行，使用者授權「開始 A1」）

- 遠端操作：Metadata 1 次（`wrangler deployments status`），唯讀 SELECT 4 次。前 3 次沒有讀到預檢資料：第 1 次是 `--file` 上傳後 D1 拒絕過多的 UNION 段數；第 2 次多個敘述只回第一個結果，只拿到 ledger；第 3 次是多行 `--command` 解析錯誤（7500）。第 4 次改成單一 SELECT 成功。寫入 0（`changed_db:false`）。查詢檔放在 scratchpad。
- 0027 檔案 SHA-256 `f320fefb01b0cb261dcc3420a8befea76667cb4d8122a0bb82e91fd30a0bdcf7`（未提交）。

| 項目 | 預期 | 實際 | 結果 |
| --- | --- | --- | --- |
| 流量版本 | `origin/main` 的部署 | `14a30a3e`（100%，台北 22:19:48） | 符合 |
| `d1_migrations` | 26 筆，最後一筆是 0026，沒有 0027 | 26 筆，最後 `0026_count_date.sql`，0027 為 0 筆 | 符合 |
| 照片相關物件 | 0 | 0 | 符合 |
| 0027 依賴的欄位 | 全部存在 | 定義（id、collection_item_id、physical_creation_token）、收藏（id、game_id、record_scope）、管理（collection_item_id、archived_at）、來源（5 欄）、NotBGG（seq、game_id、archived_at）、遊戲（id、bgg_id）全部存在 | 符合 |
| 資料筆數 | — | 定義 190、副本 4、清點 12、收藏 260、適用性事件 0；定義表觸發器 11；schema 物件 281（資料表 54） | 0027 只新增物件，不改寫既有資料 |
| 外鍵檢查 | 0 | 0 | 符合 |
| R2 bucket | 存在 | `boardgame-component-photos` 已建立（PHOTO-R2-BUCKET） | 符合 |

0027 明確建立 6 個 schema 物件：3 張表、1 個唯一索引、2 個觸發器。另外，`object_key`／`thumb_key` 的 UNIQUE 和兩張表的文字主鍵會讓 SQLite 自動建立 4 個索引，所以預期總共 281 → 291。實際數字在 A2 本機預演確認。

**A1 全數通過。** A2～A4 期間請不要在後台新增或修改資料。

### 11.2 A2 備份與本機預演（2026-11-26，Claude 執行，使用者授權「確認沒有，開始 A2」）

- **官方 Export 1 次**（唯讀）：`wrangler d1 export boardgame-collection-db --remote` → `D:/CodexHome/private-0027-backup-fbea463d5178/boardgame-collection-db-before-0027.sql`。
  - 資料夾在專案外，已停用繼承，只有目前網域使用者有 FullControl；沒有加入 Git。
  - 檔案 2,192,361 bytes，SHA-256 `ca49776a1ee2c9e5d533bbacb4265a02eacde85f26527be426e2314afb537dfb`。下載連結沒有記錄，備份內容也沒有輸出。
- **組合檔**：0027 原檔（SHA-256 `f320fefb…dcf7`，未提交）＋ `INSERT INTO d1_migrations(name) VALUES ('0027_component_photos.sql');`，組合檔 SHA-256 `b141109f1d2cfadd172ca79b5d6a6cd7d6680740842dbd1463d1e3489fe4563e`。放在 scratchpad，不加入 repo。
- **本機預演**（`node:sqlite` 記憶體資料庫，scratchpad 腳本只輸出計數和通過／失敗）：
  - **還原後**和 A1 一致：ledger 26、最後一筆 0026、照片物件 0、定義表觸發器 11、定義 190、副本 4、清點 12、收藏 260、適用性事件 0。schema 物件 280、資料表 53；正式環境是 281／54，差的 1 個是 D1 內部表 `_cf_KV`，和 0024、0026 時相同。外鍵檢查 0。
  - **在交易中套用組合檔：成功。** ledger 27，最後一筆是 `0027_component_photos.sql`；新增 3 張表、5 個索引（1 個明確建立、4 個自動建立）、2 個觸發器，schema 物件 280 → 290（+10）；既有資料筆數全部不變。外鍵檢查 0；`integrity_check` 回 `ok`。
  - **寫入測試**：在 savepoint 中執行，結束後全部 rollback（照片 0、待清理 0）。11 項全部符合預期：

    | 測試 | 結果 |
    | --- | --- |
    | 有效照片 | 可寫入 |
    | 同一個組件第二張照片 | 被拒（唯一索引） |
    | PNG 類型 | 被拒 |
    | 設定 `language_code` | 被拒（第一版固定 NULL） |
    | 縮圖鍵和大圖鍵相同 | 被拒 |
    | 寬度超過 1600 | 被拒 |
    | 不存在的組件（外鍵） | 被拒 |
    | 替換照片鍵 | 舊的 2 個鍵進入待清理表 |
    | 刪除照片 | 2 個鍵進入待清理表 |
    | 重複的冪等收據 | 被拒 |
    | 刪除合成組件 | 照片一起刪除，2 個鍵進入待清理表 |

- 遠端操作：Export 1 次，寫入 0。**A2 全數通過。** A4 預期正式環境 schema 物件 281 → 291、ledger 27。

### 11.3 A3 正式套用（2026-11-26，Claude 執行，DECISION_LOG PHOTO-0027-A34，使用者授權「只做 A3＋A4」）

- 執行前複核：0027 SHA-256 `f320fefb…dcf7`、組合檔 SHA-256 `b141109f…563e`，都和 A2 預演時相同。
- 台北 2026-11-26 23:37:16～23:37:26 執行 `wrangler d1 execute boardgame-collection-db --remote --json --yes --file <組合檔>`，**正式寫入只有這 1 次**，沒有使用 `migrations apply`。
- 結果：結束碼 0、`success: true`、`changed_db: true`、執行 7 個查詢、寫入 16 列、`last_row_id` 27；`num_tables` 52 → 55；D1 大小 1.99 MB。

### 11.4 A4 套用後唯讀對帳（2026-11-26）

- 唯讀 SELECT 1 次：
  - ledger 27 筆，最後一筆是 `0027_component_photos.sql`，比 A1 多 1 筆。
  - 照片相關物件 10 個：3 張表、5 個索引、2 個觸發器，和 A2 預演相同。
  - schema 物件 281 → 291（+10），資料表 54 → 57；定義表觸發器仍是 11 個。
  - 定義 190、副本 4、清點 12、收藏 260、適用性事件 0，都和 A1 相同；照片、待清理、收據都是 0。
  - `pragma_foreign_key_check` 0 筆違規。
- 正式網站唯讀抽查 9 條，全部符合：
  - `/`、`/collection`、`/games`、`/about/` 回 200；
  - `/admin`、`/admin/collection/102/components`、`/api/admin/collection/component-photos` 回 302 轉到 Access；
  - `/dev/ui-kit` 回 404；
  - `/media/components/<測試鍵>` 回 404，因為新程式還沒部署，舊版本沒有這條路由。
- **A3＋A4 全數通過，0027 已在正式環境就位。** 正式程式仍是 `14a30a3e`，不會讀寫新的表，所以不受影響。
- 遠端操作合計（A1～A4）：Metadata 1、SELECT 5（A1 有 3 次沒讀到資料）、Export 1、正式寫入 1、HTTP 抽查 9。
- **還沒做**：提交並推送 `main` 部署 P1（包含三行高度縮圖與對話框美化），以及登入後正式驗收。需要另外授權。
