# P3 D5 本機虛擬化資源唯讀盤點

2026-11-18（Asia/Taipei）

`D5_READONLY_INVENTORY_COMPLETE` / `ENVIRONMENT_NOT_SELECTED` / `STAGE1_BLOCKED` / `RUNTIME_EXECUTION_NOT_AUTHORIZED`

## 1. 結論

目前沒有足夠證據確認任何本機虛擬化平台已可使用。主機OS架構為x64、D槽可用約895.06 GiB，wsl.exe存在；CPU／RAM／韌體虛擬化與Windows功能啟用狀態未取得。不能單由wsl.exe存在認定WSL2或任何發行版可用。

在PATH、指定常見安裝路徑及三個指定廠商安裝registry位置未找到VirtualBox／VMware；此結果僅代表已查範圍，不能斷言全機未安裝。沒有安全指定的離線資源目錄，因此映像與離線依賴庫均UNKNOWN，未搜尋磁碟或私人檔案。

**B1仍可保留為優先候選，但尚無已確認可直接利用的VM平台或映像。** 下一步應由使用者／環境提供者給出既有平台與安全離線資源目錄的必要摘要，而不是再試啟動或提升權限。

## 2. 依據與查詢邊界

依據`docs/P3-D4-isolated-environment-feasibility-comparison-20261118.md`。CODE_CONFIRMED表示本次唯讀查詢或本機檔案直接支持；INFERRED表示建議／推導；UNKNOWN表示無充分證據，不等於不存在。

查詢時間起點：2026-11-18T09:08:43.6677254Z（台北17:08:43）。僅以PowerShell讀取必要metadata。沒有收集帳號、序號、裝置ID或完整環境。未執行任何虛擬化工具本體，也未執行wsl --status／--list，避免把命令發現擴張為執行或啟動服務。

workspace根：`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog`

## 3. D5-01 主機資源摘要

| 項目 | 結果 | 分級與限制 |
| --- | --- | --- |
| Windows產品版本／build | UNKNOWN | Win32_OperatingSystem查詢失敗，未改讀其他系統來源繞過 |
| OS架構／目前PowerShell程序架構 | X64／X64 | CODE_CONFIRMED，RuntimeInformation屬性；不是CPU型號或虛擬化證明 |
| CPU型號／邏輯處理器數 | UNKNOWN | CIM查詢組於首項失敗後停止，未執行CPU查詢 |
| firmware virtualization／VM monitor／SLAT | UNKNOWN | 同上；未查BIOS、未啟動VM |
| hypervisor是否存在 | UNKNOWN | 同上 |
| 實體RAM總量／可用量 | UNKNOWN | 同上；未用程序heap大小冒充實體RAM |
| D槽剩餘空間 | 961,061,085,184 bytes，約895.06 GiB | CODE_CONFIRMED，Get-PSDrive當時讀值；非保留配額，也非VM存放位置已批准 |
| D槽已用空間 | 1,028,982,018,048 bytes | CODE_CONFIRMED，僅磁碟總體摘要，無內容盤點 |

實際命令範圍：

```powershell
[Runtime.InteropServices.RuntimeInformation]::OSArchitecture
[Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
Get-CimInstance Win32_OperatingSystem -Property Caption,Version,BuildNumber,
  OSArchitecture,TotalVisibleMemorySize,FreePhysicalMemory -ErrorAction Stop
Get-PSDrive -Name D -PSProvider FileSystem -ErrorAction Stop
```

CIM的首項OS查詢回`Microsoft.Management.Infrastructure.CimException`，FullyQualifiedErrorId=`Microsoft.Management.Infrastructure.CimException,Microsoft.Management.Infrastructure.CimCmdlets.GetCimInstanceCommand`。該try區塊立即停止，原定Win32_Processor、Win32_ComputerSystem均未執行。沒有把錯誤逕行歸因權限，也未改用WMI、systeminfo或registry再讀同項。

wsl.exe檔案版本為`10.0.26100.9949 (WinBuild.160101.0800)`，**僅為該檔版本，不用來推定Windows產品版本／edition**。

## 4. D5-02 工具存在、功能啟用與可用性

| 候選 | 功能／工具存在證據 | 已啟用？ | 可使用？ |
| --- | --- | --- | --- |
| Hyper-V | Get-VMHost／Get-VM未在命令發現中找到；C:\Windows\System32\vmms.exe未找到 | UNKNOWN | UNKNOWN，未查VM、未連服務 |
| VirtualBox | VBoxManage.exe／VirtualBox.exe不在PATH；指定VBoxManage路徑及廠商key未找到 | UNKNOWN／沒有已找到安裝 | UNKNOWN，未執行工具 |
| VMware | vmware.exe／vmrun.exe不在PATH；指定vmware路徑及廠商key未找到 | UNKNOWN／沒有已找到安裝 | UNKNOWN，未執行工具 |
| WSL2 | C:\Windows\System32\wsl.exe存在且PATH可發現 | WSL功能、VirtualMachinePlatform、WSL2預設／各distro版本均UNKNOWN | UNKNOWN；wsl.exe存在不證明WSL2可啟動 |
| Windows Sandbox | WindowsSandbox.exe不在PATH；指定System32檔案未找到 | UNKNOWN | UNKNOWN，未啟動 |

一次`Get-WindowsOptionalFeature -Online`後僅篩選以下FeatureName：`Microsoft-Hyper-V.*`、`Microsoft-Windows-Subsystem-Linux`、`VirtualMachinePlatform`、`Containers-DisposableClientVM`，僅預計保存FeatureName及State。實際呼叫回`System.Runtime.InteropServices.COMException`，FullyQualifiedErrorId=`Microsoft.Dism.Commands.GetWindowsOptionalFeatureCommand`；沒有取得功能清單或狀態。停止此項，未使用DISM.exe、registry或其他方式重查。

未找到Hyper-V命令可能與模組、PATH或目前環境可見性有關，不能單獨證明Windows不支援該功能。工具檔案缺少亦不代表已查遍所有安裝位置。

### 固定位置檢查清單

僅以Test-Path／Get-Item查以下檔案，不列整個目錄：

- `C:\Program Files\Oracle\VirtualBox\VBoxManage.exe`、`D:\Program Files\Oracle\VirtualBox\VBoxManage.exe`：皆未找到。
- `C:\Program Files\VMware\VMware Workstation\vmware.exe`、`C:\Program Files (x86)\VMware\VMware Workstation\vmware.exe`、`D:\Program Files\VMware\VMware Workstation\vmware.exe`：皆未找到。
- `C:\Windows\System32\wsl.exe`：存在；僅讀file version。
- `C:\Windows\System32\WindowsSandbox.exe`、`C:\Windows\System32\vmms.exe`：未找到。

僅檢查三個廠商安裝key是否存在，若存在才讀Version／InstallDir／InstallPath：`HKLM:\SOFTWARE\Oracle\VirtualBox`、`HKLM:\SOFTWARE\VMware, Inc.\VMware Workstation`、`HKLM:\SOFTWARE\WOW6432Node\VMware, Inc.\VMware Workstation`。三者皆未找到。未列完整Uninstall清單、未查使用者hive、未讀授權key或無關設定。

## 5. D5-03 離線資源

未提供可安全盤點目錄。依授權，以下一律UNKNOWN：VM磁碟／模板、OS ISO或安裝媒體、Node離線installer、目標平台套件cache及完整離線依賴庫。未掃Downloads、備份、其他磁碟或現有VM內容。

另已讀取**既有專案指定資源**的metadata，這不是證明存在可攜離線安裝包：

| 本機資源 | 已確認 | 不代表 |
| --- | --- | --- |
| D:\Program Files\nodejs\node.exe | 檔案存在；既有D1記Node v24.21.0 | 存在Node installer／Linux binary或可直接移植完整runtime |
| node_modules/miniflare/package.json:3、97 | 5.20261006.1-alpha，Node>=22.0.0 | 所有離線依賴齊全或guest可執行 |
| node_modules/workerd/package.json:3、20、21 | 1.20261006.1；宣告linux-64及windows-64對應optional package | Linux實體套件已安裝或可離線取得 |
| node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe | 檔案存在 | Guest平台／OS相容性已通過 |
| node_modules/tsx/package.json:3、62 | 4.23.15，Node>=18 | 跨平台依賴閉包已證明 |
| package.json:6 | 專案Node>=22.12.0 | 任何滿足最低版的Node都與既有診斷完全等價 |

未啟動任何binary。Node v24.21.0為既有D1執行證據，沒有本輪重新執行node --version。

## 6. D5-04 B1隔離可行性與缺口

**UNKNOWN：目前沒有任何候選平台的實際VM／網路配置可供審查。** 未因Hyper-V、VirtualBox、VMware、WSL2或Sandbox名稱判定隔離成立。

| 要求 | 若採專用VM的設計候選（INFERRED） | 本機證據狀態 |
| --- | --- | --- |
| 測試前禁止所有非loopback | VM啟動前移除／斷開全部外部網路介面；包含IPv4／IPv6、DNS、NAT／橋接路徑 | UNKNOWN，無VM配置 |
| guest內127.0.0.1 | 保留guest loopback供Miniflare內部通道，需另授權一次零SQL binding驗收 | UNKNOWN，尚未建立guest，不能承諾EACCES消失 |
| 防旁路 | 不掛host network、daemon socket／pipe或proxy；共享資料及管理整合亦需盤點 | UNKNOWN，無整合設定 |
| 全程序樹 | 以整個guest邊界涵蓋Node、threads、Undici、workerd與後代；不得有可借道host的通道 | UNKNOWN，不能由應用層deny替代 |
| 獨立停止 | 提供者可控制專用guest停止及timeout；guest內亦控制本次程序樹 | UNKNOWN，目前無可用管理介面證據 |
| 證據保存 | 先寫guest獨立runRoot，停機後以經批准的非網路方式搬出、hash核對；原始證據不覆寫 | INFERRED方案；搬運通道與儲存位置未決 |

cf:false與telemetry off仍應保留作局部防護，但不代表guest無外部網路。平台的封網配置須審查後才談執行。

## 7. D5-05 最小Guest與資源建議

以下均為**INFERRED工程起始預算，不是產品官方最低規格或實測容量**。主機CPU／RAM未知，故不能確認能分配這些資源，也不應現在保留空間。

| 項目 | 候選建議 | 待驗／成本 |
| --- | --- | --- |
| Guest OS／架構 | x86-64 Linux專用guest優先評估；Windows x64 guest作保留候選 | 發行版、kernel／libc或Windows build支援及映像授權均UNKNOWN；未選OS |
| vCPU | 起始2 vCPU；並行／容量案例若不足再審查4 vCPU | 主機邏輯CPU未知，不預設可承擔 |
| RAM | Linux guest起始4 GiB；Windows guest起始8 GiB | 主機須保留自身工作餘裕；實際可分配量UNKNOWN |
| 磁碟 | Linux獨立虛擬磁碟40 GiB；Windows起始64 GiB，另計離線依賴／證據／快照 | D槽總空間看似有餘裕，但guest路徑、配額、映像大小及寫入授權未決；不用thin配置假裝空間已保證 |
| Node | 優先與既有D1 v24.21.0對齊並取得對應平台離線資源 | 須驗來源與hash、OS相容性；不可直接用Windows node.exe於Linux |
| Miniflare／workerd／tsx | 保持5.20261006.1-alpha／1.20261006.1／4.23.15與lock依據 | 需取得目標平台完整依賴、native package；保留既有JS分類器與HMAC |
| 離線供應 | 提供者以批准來源準備OS與工具，列manifest／hash，再以批准媒體搬入 | 本輪不下載、安裝；不能把Windows node_modules整包搬去Linux冒充可用 |

離線安裝可能仍有postinstall/native選擇需求：workerd/package.json:7含postinstall。需先審查所需腳本及完整離線依賴閉包，不能安裝時才自動下載。Linux來源存在於optionalDependencies不等於資源已齊全。

預期成本：取得映像／授權、平台配置、目標平台依賴準備、隔離與停止驗收、證據搬運。未取得資源前無法估可信時程；不能把本文件規格當可立即執行的VM建立單。

## 8. D5-06 候選比較與授權

| 候選 | 可利用現有資源 | 額外配置／管理協助 | 本輪判斷 |
| --- | --- | --- | --- |
| Hyper-V專用VM | 沒有已證實可用的平台 | 啟用狀態、主機支援、管理權限、離線映像均待提供者確認 | 尚無足夠證據，不啟用 |
| VirtualBox專用VM | 指定位置未找到工具 | 若需安裝／driver／網路配置須另審，可能需管理員 | 尚無足夠證據，不安裝 |
| VMware專用VM | 指定位置未找到工具 | 平台／授權與管理需求均未知 | 尚無足夠證據，不安裝 |
| WSL2 | 僅確認wsl.exe存在 | 功能與distro未知；主機整合、network及共享通道須另審 | 不能當成已可用的獨立全邊界 |
| Windows Sandbox | 指定執行檔未找到 | 功能、映像依賴、網路禁用及持久證據機制均未知 | 不選定，不啟用 |
| 提供者供應的獨立離線VM | 尚未提供 | 可減少本機權限需求，但需配置／政策與搬運證據 | 保留B1方向，不能視為現有資源 |
| 既有Windows直接重跑 | 原工具檔存在 | D3隔離政策與EACCES缺口未解 | 維持BLOCKED |

最小下一步是由使用者／環境提供者提供兩類**非敏感資料**：

1. 是否已有可供專用使用的VM平台／guest，以及可分配CPU／RAM與網路／停止能力摘要。沒有就如實記無資源，不要求提權取得。
2. 明確可盤點的離線資源目錄及允許檢查的檔名／副檔名範圍。後續仍只能metadata盤點，不讀映像內容或私人檔案。

取得後再提出具體環境與離線供應設計供審查。本輪不自行進D6。安裝／啟用功能、建立VM、搬運檔案、配置網路、修改測試及單次runtime驗收，各須明列授權；D5完成不提供其中任何執行許可。

## 9. 執行範圍與停止證據

- D5前已確認本報告不存在；唯一新增檔案即本報告。
- 已讀D4與指定專案package metadata、固定binary metadata；沒有全磁碟搜尋、映像內容讀取或正式認證／備份／DB讀取。
- CIM／Windows功能查詢失敗後各停止該項，沒有提權、替代查詢繞過或重試D3安全事件／防火牆。
- 工具僅Get-Command／固定Test-Path／Get-Item／廠商安裝key存在性，未執行Hyper-V／VBoxManage／VMware／WSL／Sandbox操作。
- 未建立listener、VM／容器、runRoot，未啟動Node／Miniflare／workerd；所以沒有本輪測試程序需要停止。這是本輪操作範圍紀錄，不冒充全機程序掃描。
- 未修改產品src、正式Migration、原六個測試檔、診斷原型或Stage1／D1原始證據；未執行SQL、安裝、政策變更、部署或遠端連線。

唯一交付：
`D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog\docs\P3-D5-local-virtualization-readonly-inventory-20261118.md`

`D5_READONLY_INVENTORY_COMPLETE` / `ENVIRONMENT_NOT_SELECTED` / `STAGE1_BLOCKED` / `RUNTIME_EXECUTION_NOT_AUTHORIZED`

完成後停止，等待ChatGPT審查與使用者下一次授權。
