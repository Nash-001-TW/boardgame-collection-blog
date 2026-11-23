# P3 D4 隔離執行環境可行性比較

2026-11-18 · `D4_DESIGN_COMPARISON_COMPLETE` · `STAGE1_BLOCKED`

## 1. 範圍與建議

承接使用者「Next」，本輪僅進行D4文件比較，並未取得建立環境、安裝、修改程式或執行測試的授權。不再查Windows系統、不啟動Node／Miniflare／workerd、不連線遠端。

**建議優先審查「無外部網路介面的獨立虛擬機」能否由環境提供者供應，其次為已有可證明網路邊界的受管隔離環境。** 這是候選評估順序，不是確認現有電腦支援、也不是採納或授權建立。若無適合資源，維持BLOCKED，繼續靜態工作；不改用SQLite把Stage1補成通過。

比較採兩條主路徑：A＝現有Windows；B＝獨立隔離環境。與D2／D3的「隔離修正／loopback診斷」A、B不同，也與V1／V2資料架構候選無關。

## 2. 已有證據與尚缺證據

| 分級 | 內容 | 來源 |
| --- | --- | --- |
| CODE_CONFIRMED | D1 ready返回127.0.0.1:6655後，binding連線EACCES | docs/P3-stage1-runtime-diagnostic-result-20261118.md；D1 evidence/error.json、endpoint.json |
| CODE_CONFIRMED | Request.cf曾嘗試外部解析，現有應用層hook未覆蓋 | 同報告；D1 evidence/runtime-log.ndjson |
| CODE_CONFIRMED（靜態） | cf:false可關閉該已知取值路徑；不等同封鎖全程序樹 | docs/P3-D2-isolation-and-loopback-readonly-review-20261118.md第2～4節；node_modules/miniflare/dist/src/index.js:132059、78670 |
| CODE_CONFIRMED | D3三項系統查詢均未取得政策／事件資料 | docs/P3-D3-isolation-feasibility-and-eacces-readonly-review-20261118.md第3節 |
| UNKNOWN | 本機是否已有可用虛擬化、容器、離線映像或受管隔離資源 | 本輪不進行系統盤點，不能由設計候選推定已安裝 |
| UNKNOWN | 其他環境的Miniflare可啟動性、loopback與強制網路政策 | 尚無配置證據或執行驗收 |

本文件不引用未查證的特定產品功能或版本保證。以下獨立環境均是**必須滿足的配置要求及INFERRED設計候選**；不是對現成工具可用性的認證。

## 3. 不可降低的驗收要求

1. 啟動任何測試程序前，已禁止測試環境所有非loopback連線，包含DNS與直接IP、IPv4與IPv6；允許必要127.0.0.1內部通訊。若需其他loopback位址，須事先列明。
2. 邊界涵蓋Node、worker threads、自載Undici、native workerd及其子程序，不依賴它們是否願意使用特定fetch wrapper。
3. 沒有可繞過的第二網卡、橋接／NAT、proxy、主機服務轉送、共享socket或管理通道讓測試程序借道外連。管理通道與資料搬運方式也須納入審查。
4. 合成資料、合成金鑰、獨立state／tmp／home／config；不搬正式設定、備份、認證或既有node_modules整包冒充跨平台可用。
5. 保留Miniflare D1 binding及workerd執行語意、既有分類器／HMAC及22份Migration。環境／平台更換需重查套件與native依賴，不表示遠端D1已驗證。
6. 有獨立於被測程序的期限與停止邊界；異常時停止本次程序樹或整個專用環境，不影響其他工作。斷電／強停後的證據完整性須標記，不假裝正常dispose。
7. 原有G-01／05／08、SNP與SELF等案例及驗收要求保留。環境可用不等於任一測試通過，不自動執行第二階段。

## 4. 候選環境比較

| 候選 | loopback及非loopback限制要求 | 全程序樹覆蓋要求 | Miniflare D1語意 | 配置／授權缺口 | 本階段定位 |
| --- | --- | --- | --- | --- | --- |
| A 現有Windows受管環境 | 需提供有效政策與loopback例外，不能只依network restricted宣告 | 需證明主程序、threads、native後代受同一邊界 | 保留現有Windows套件最直接，但EACCES未解 | 政策不可讀；不得提權查詢或修改規則 | 保留，暫不重試 |
| B1 專用虛擬機，測試時無外部網路介面 | 要求所有虛擬網卡移除／斷開且無其他可路由通道；guest內loopback另驗 | 以整個guest作邊界，不只特定exe；共享整合功能需關閉或證明無網路轉送 | 在guest安裝對應平台同版Miniflare／workerd；仍是本機D1相容測試 | 虛擬化／映像／授權／資源是否可用未知；建立與配置可能需管理員或提供者協助 | 優先取得配置可行性證據 |
| B2 既有受管隔離執行環境 | 提供可審閱的loopback-only政策、DNS限制與生效時間 | 明確涵蓋整個環境與子程序；管理平面不可成旁路 | 需支援該平台native workerd及本機binding | 供應者、位置、政策、檔案搬運與是否需遠端操作均未知 | 次優先；無明確授權不連接 |
| B3 專用容器／網路命名空間 | 要求僅loopback且無host network、外部路由、proxy／共享daemon socket | 需證明全部容器程序在同一邊界，不能有權限逃逸或host socket | 平台套件與workerd相容性待核；不是SQLite adapter | runtime是否存在未知；平台、capabilities、mount與host整合需詳審 | 備選，不能把「容器」本身當安全證明 |
| C 純離線靜態審查 | 不啟動runtime，不需要新網路通道 | 無新增測試程序 | **不能驗證Miniflare／D1 batch／並行行為** | 可繼續整理守衛／證據／案例；不產生執行PASS | 無可用環境時的工作替代，不是測試替代 |

「離線安裝套件」只處理供應與下載，不自動讓runtime無外連。虛擬機、容器或WSL之類名稱本身也不證明隔離；必須看實際配置。沒有配置證據時全部維持UNKNOWN，不能以一般產品能力寫成已滿足要求。

## 5. B1最小設計輪廓（尚未建立）

採「資源準備」與「測試執行」分離：

- 由提供者先提供可審查的專用映像、OS／架構、Node及平台對應套件清單、版本／雜湊及來源。任何下載、安裝或更新需另列授權；本輪不做。
- 轉入測試前移除／斷開全部外部網路介面，確認無NAT／橋接／共享網路socket或可借道主機的轉送。若隔離只在測試開始後才生效，不能驗收。
- 程式採最小來源清單搬運：測試專用檔、分類器與proof相關檔、鎖檔及22份Migration；盤點直接依賴後再定清單。不得搬.env、.dev.vars、認證目錄、正式資料或舊state。既有證據保留在原位置，可另提供去敏報告副本。
- 以可驗證的離線媒體／檔案搬運方案導入合成資源；只讀掛載或複製方式須另審，不暴露整個host磁碟。檔案傳輸通道不能變成執行中的網路旁路。
- Guest中仍明確cf:false、telemetry off、合成P3_TEST、獨立目錄與local-only配置；局部deny與fatal停止作第二層防護。
- 先批准環境驗收／一次零SQL binding診斷，完成後再審查是否恢復Stage1。兩者不合併成自動連續執行。

若用Linux guest，現有Windows workerd.exe不可直接沿用；需要相同目標版本的該平台套件及重新記錄版本／雜湊。若用Windows guest，也不能假設宿主的EACCES一定消失。環境更換只能提供新的可驗證邊界，不保證binding成功。

## 6. 證明方式與安全驗收順序

**先配置證據，再批准有限動態驗收。** 本輪不對公網做「看看是否被擋」的探測。

| 證據 | 必須交付 | 不足以取代它的資訊 |
| --- | --- | --- |
| 邊界配置 | NIC／路由／網路命名空間或受管政策的去敏有效配置；其他通道清單；啟動前生效證據 | 沒有DNS成功、沒有回應或僅一個外連失敗 |
| 程序覆蓋 | 環境邊界與後代繼承、無host network／daemon socket／proxy旁路的證據 | global fetch wrapper、cf:false、程序名稱封鎖 |
| 本機通訊 | 另授權後，限定loopback endpoint的ready與binding結果 | 只證明listener存在或只看到ready |
| 停止 | 專用環境／本次程序樹的所有權、deadline與退出記錄 | 被測程序自己宣稱已停止 |
| 可重現性 | OS／架構、工具版本、來源hash、環境配置、命令、結果及隔離異常 | 只說「同一套件版本」 |

動態負向驗收若確有需要，先設計無公網目的地的受控方式並明列授權；若設計本身要求外部可達路徑，須重新審查，不能以「測隔離」自行取得外連許可。配置證據與有限驗收各有範圍，均不宣稱形式化證明所有未知通道。

## 7. 授權與可行性門檻

| 工作 | 現在狀態 | 所需下一步 |
| --- | --- | --- |
| 本輪D4文件比較 | 完成 | 等待審查 |
| 提供既有獨立環境的去敏能力／政策資料 | 未取得 | 先確認提供者與可讀資料來源，不查秘密、不連遠端 |
| 查虛擬化／容器工具、配置或管理權限 | 未做 | 明列唯讀範圍後授權；不能重開已被拒的Windows事件查詢 |
| 建立VM／容器、配置網路、安裝套件 | 未授權 | 完整配置與回復／停止方案；管理員需求由提供者說明，不自行提權 |
| 修改測試檔／launcher | 未授權 | 具體差異與檔案清單審查 |
| 啟動零SQL binding診斷 | 未授權 | 前置隔離驗收通過，另批准單次命令與停止條件 |
| 恢復Stage1／執行SQL | 未授權 | binding結果審查後，重新批准相應執行單 |

可行性決策只問「有沒有能提供上述配置證據的專用環境」，不先要求採用某個工具或購買服務。若沒有，保留現狀並繼續靜態設計；不降低標準、不執行舊配置。

## 8. 停止點與保留事項

本輪唯一新增檔案為本報告。未建立新runRoot、虛擬機或容器；未查Windows事件／防火牆；未修改原型、正式src、Migration、資料或套件；未執行任何測試、SQL或遠端操作。

Stage1與D1原root完整保留：

- `.wrangler/p3-stage1/runs/P3S1-20261118-001/`
- `.wrangler/p3-stage1/diagnostics/P3D1-20261118-001/`

P1／P2、S1～S7、日期與事件規則、P3既有測試設計均保留。V1退役及表名正規化不啟動。C1／C2、V1／V2及G仍未選定。

`D4_DESIGN_COMPARISON_COMPLETE` / `ENVIRONMENT_NOT_SELECTED` / `STAGE1_BLOCKED` / `RUNTIME_EXECUTION_NOT_AUTHORIZED`

完成後停止，等待審查。
