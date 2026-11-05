# NotBGG V1.2：部署候選與 D-7B Runbook

日期：2026-11-05（Asia/Taipei）。本文件為最後準備，不新增 R7／R8，不執行正式部署。**限流候選修正 GO（本機驗證）；正式部署仍 NO-GO，尚無實際 Git Commit／獨立正式操作核准。** 本輪已依核准完成30/60、namespace12071的最小修正；未部署或修改正式Binding。

## 1. 固定候選版本與三個 Commit

採用使用者已核准的 R6 三組原子方案。候選 source/build-input SHA256：

`a2f10dddfa6f2821f6be411bf2dceeb752100e248e6742cacc09967038c95410`

此識別使用notbgg-rc-git-tree-v2：完整候選樹按UTF-8路徑bytes排序，記錄path、六位Git mode、Git Blob OID。符號連結以lstat/readlink讀取target原始bytes、mode120000，不解參照；一般檔按Git clean filter及filemode規則。Manifest與Runbook仍在220項中，其內容OID在識別payload設null，路徑/mode仍納入，避免循環。

Git Branch：main；基線 HEAD：`469866d6f7e3aed947f9f1c2e0d59b9cc16961a2`。Git Index／cached diff 空，原有 intent-to-add 狀態保持原狀。**未 git add／commit／push**，因此三個實際 Commit SHA 均尚無；不能將這個工作目錄識別冒稱 Git Commit。使用者允許以 SHA256 追溯，本輪先固定內容，不為取得 Commit SHA 擅自操作 Git。

| 順序 | 內容 | 檔數 | 依賴 |
| --- | --- | ---: | --- |
| 1 | 0003 BOM 相容修正（R6 第04組） | 1 | 使用已驗證的 LF clean Blob |
| 2 | BGG／Catalog／NotBGG／Worker runtime 原子提交（01＋02＋03＋05） | 116 | 01/02/03 互相 import，合併避免中間缺模組；含 0014～0016、F1/F2、Worker-first |
| 3 | 測試、安全文件與發布證據（06） | 103 | 原96檔＋前輪5檔＋本輪2檔；不納入16原始正式 metadata |

三個 Commit 是**內容已固定的提交計畫**，不是已執行的提交。之後若獲授權建立 Commit，先逐檔核對 manifest，再按順序提交；本輪限流修正已獲准並完成，識別已更新；先前候選 cc713488d9fc84466e41e9423a82d1efbf9a35d8c182cc7c58a7927999d15d44 已被本版取代，不可繼續作部署依據。沒有必要再建立新的大型驗收階段。


### 候選識別演算法 v2（本輪核准修正）

演算法版本：`notbgg-rc-git-tree-v2`。以完整預計Git tree（280路徑；220提交項＋60繼承基線）為輸入，不只取非docs檔。canonical JSON依序keys為algorithm、baselineHead、privateBuildInputSha256、contentExclusions、files；files每項keys依序path、gitMode、gitBlobOid。路徑使用repo-relative POSIX字串，按UTF-8 bytes升序；mode為100644/100755/120000六位字串，OID為Git SHA-1小寫hex。JSON為UTF-8、無BOM、compact、無結尾換行，再SHA256。

contentExclusions固定按UTF-8排序為`docs/notbgg-d7b-deployment-runbook.md`與`docs/notbgg-deployment-candidate.json`；僅把兩者的內容gitBlobOid設null，其path/mode仍保留。兩份檔案均照原清單提交，不移出220項。其餘278項的內容（包含所有其他docs及繼承基線）全部納入。一般檔用git hash-object --path=<path> --stdin計clean Blob；連結僅readlink的raw bytes交git hash-object --stdin，不套filter、不補換行。

Git core.filemode=false時一般檔沿用既有Index的regular mode，新檔預設100644；true時依執行位元100755/100644。lstat的連結型別必須與Index區分，禁止以Index Blob替代工作樹檢查。CLAUDE.md必須為120000／47dc3e3d863cfb5727b87d785d09abf9743c0a72。

本機產生器位於ignored `.wrangler/release-candidate-final/generator.mjs`；屬本次任務工具，不加入220範圍，非新增正式工具入口。其完整來源與SHA256嵌入Manifest中繼資料；Runbook提供不依賴ignored工具的唯讀checker，另以獨立Python程序重算。

舊識別`41855c8f7ea80de577e5461c1c4eb61b0e030665e948927488685da72b2b211d`因連結處理錯誤已廢止，不可用於最後RC。其他舊算法證據只作歷史基線。本Manifest/Runbook為提交前凍結記錄，actualDeploymentCommit維持生成時null；三個實際SHA另存本機Git及ignored操作收據，不為回填SHA增加第4個Commit或amend。

### 0003／Migration／F1／F2 — PASS（候選）

0003 工作檔仍與 R4 完全相同（491 bytes，SHA256 211ed3bb90dc24e5be0e39dc6b7b6662967b3b9863099f582ab020835b8f11f0，含1個CRLF）。現有 core.autocrlf=input、無 .gitattributes override；預期 LF Git Blob 490 bytes，OID b80fa2945d8b5ea3ae1ddf5441163dd22c95ced6，SHA256 5f70e687a582c2cb8c4598a7bd776b205b12e4a59d738b1d281ac7552805e76e。它精確等於 HEAD 移除3個BOM bytes，SQL 本文無其他變更。R6 已實測兩種文字的 Trigger Schema／合法 INSERT／非法 INSERT/UPDATE 相同，本輪沿用該驗收；**LF Blob 與 R4 raw 混合換行 bytes 不相同，SQL／Trigger 行為一致**。未修改檔案或換行規則。

0014～0016 SHA256 仍與 R4 相同；0015 包含重建表後恢復的 site_game_relations_no_delete。F1 gateway／src/worker.ts／wrangler.json 及 F1/F2 測試都在清單內。候選 assets.run_worker_first：/games/*、/en/games/*、/*%*、//*、/en//*；build 後 generated config 一致，210 HTTP 回歸 PASS。

### 本輪必要驗證 — PASS（只驗限流與指定回歸）

| 項目 | 結果 |
| --- | --- |
| Wrangler 4.149.0 config/types | PASS，ratelimits/name/namespace_id/simple格式與本機schema相容 |
| 候選／generated config | PASS，NOTBGG_WRITE_LIMITER、12071、30/60完全一致，Worker-first五條不變 |
| 目標API／安全／D-5／D-6 | PASS 46／46，4個測試檔，0 fail／skip |
| 新增限流測試 | PASS 7項，九個寫入路徑：缺失／例外／異常decision／超額均無DB呼叫；Access/CSRF先拒絕 |
| 正常管理寫入 | PASS，profile／collection／D6 propose，先allow再碰DB；三類共享同一hashed subject key |
| 實際本機workerd Binding | PASS，候選30/60可allow及回429，非僅mock；不推論為全球嚴格計數 |
| Admin、D-5／D-6 browser | PASS，桌面／手機；原功能fixture明確注入allow limiter，不改驗收語意 |
| TypeScript strict | PASS |
| Astro check | PASS，201 files、0 errors／0 warnings／13 hints |
| Production build | PASS，命令總耗時62.651s；未更新BGG／未執行資料初始化prebuild |
| Migration 0001～0016、BGG | PASS，所有Migration hash與R4相同；BGG仍1e345be12cf66b871f0267af622445d50ba1120ba98181ca2390dadc0da82f91 |

本輪沒有重新展開F1／C階段／還原演練。前輪305／305與F1 210是已驗收基線，保存在deployment-verification.json，**不冒稱新限流候選重跑了全部305項**；最新46項及必要檢查在notbgg-rate-limiter-verification.json。既有身份邏輯／資料模型／Migration未改，R6合成還原沿用。

## 2. Access 最小安全確認

下列正式Access與部署verifier證據沿用前輪；本輪只做namespace共用檢查的唯讀GET與隔離Access／CSRF回歸，未再次全面查Access Policy。正式目前 Worker 的已知基線為 `75e4aec7-6bdb-4202-bee4-a0827dcbca53`，100% 流量；本輪唯讀重新核對，沒有部署。

| 關鍵項目 | 結果 |
| --- | --- |
| /admin、/api/admin、/api/admin/auth-check | PASS：匿名 GET 皆302到Access，private/no-store |
| /api/admin/notbgg、/api/admin/collection | PASS：匿名 GET 被Access攔截；不以舊Worker沒有新功能當作授權成功 |
| 偽造JWT header、encoded api／duplicate slash aliases | PASS：抽樣皆302 challenge，未見繞過 |
| 正式JWT／Issuer／Audience實作 | PASS（程式及隔離重播）：取得現行部署 verifier，確認 RS256、固定 JWKS/Issuer、Audience、管理員 email/sub |
| 現行 verifier 實際密碼學測試 | PASS：以生成的RSA/JWKS在本機重播**同一個部署函式**；拒絕無JWT、錯簽章／Issuer／Audience／過期／錯管理員 |
| 候選內部再次授權 | PASS：middleware正規化path，各NotBGG／collection／link handler先驗JWT再存取DB；既有及本輪目標簽章／claims測試通過 |
| 正式有效管理員登入 | NOT VERIFIED：未取得／複製正式session，不為驗證發正式寫入；部署前只需人工瀏覽器 GET auth-check 成功，不需全面再查Access Policy |
| 未登入管理寫入 | PASS（多層證據）：edge匿名拒絕＋已部署middleware驗簽＋候選獨立handler測試；**未對正式送POST/PATCH來試寫** |

取樣GET共9例，詳細路徑／狀態在 deployment-safety.json。沒有測到未授權管理寫入繞過；這不是所有可能路徑的滲透測試。GET sleeves APIs 為既有唯讀公開API，不是管理寫入後門。

注意現行舊 verifier 雖驗證已提供的 exp，但沒有要求 exp claim 必須存在；本機對同一個舊函式的有效簽章、缺exp合成token測試確實被接受。它仍須通過正確簽章／Issuer／Audience／管理員驗證，不能據此宣稱匿名可偽造。**已驗收候選已明確 requiredClaims=exp/iat/sub/email，缺exp會拒絕**，不需本輪新增功能。正式Audience/管理員secret值未讀取，實際登入可用性須人工做一次安全GET確認。

## 3. Rate Limiter — PASS（候選），正式啟用待核准部署

使用者核准limit=30、period=60，namespace_id=12071附條件核准；候選設定為：

```json
{ "ratelimits": [{ "name": "NOTBGG_WRITE_LIMITER", "namespace_id": "12071", "simple": { "limit": 30, "period": 60 } }] }
```

Worker程式與設定名稱完全一致。Wrangler types、Astro Cloudflare generated config及本機workerd Binding皆已驗證；沒有新增依賴或改變資料模型。namespace唯讀清單完整列出目前可見1個Worker並讀其settings，未發現12071已被使用，查核時HTTP200；後續須保持12071專用，不把它配置給其他Worker。這證明本次可見現行Binding沒有共用，不是對未來或不可見歷史的永久唯一保證。詳細時點／範圍在notbgg-rate-limiter-verification.json。

三個寫入入口共用notbgg-admin-api.ts的requireAdminWriteLimit：

- 缺Binding、limit不是函式、執行例外、無效decision：503 RATE_LIMITER_UNAVAILABLE，任何DB操作之前拒絕。
- success=false：429 RATE_LIMITED、Retry-After:60、no-store，沒有DB讀寫。
- 僅success=true允許繼續；GET不要求limiter。Access與CSRF保持在限流前面，未授權請求不耗管理員額度。
- key沿用SHA256(已驗證JWT subject)，三類寫入共享同一管理員quota，不能換endpoint繞開。未記錄raw subject／JWT／limiter例外。

受保護寫入：NotBGG新增／PATCH／archive、D6 link命令、collection新增／PATCH／archive、site relations新增／archive。其他Access、同源／CSRF、大小／欄位驗證、CAS／idempotency／歷史保護均保留。正常管理寫入與D-5/D-6回歸通過。現有測試fixture加入明確的test-only allow binding，故不再以「沒Binding仍可寫」作功能fixture；新的專項測試另外檢驗缺Binding必須拒絕。

平台語意與原設計一致，沒有放寬：**每個Cloudflare location、每位已驗證管理員約30次／60秒**，不是全球合計嚴格30，也不能保證並行第31次一定被拒絕；429依Binding的success=false決定。[Cloudflare官方語意](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)說明eventual consistency與跨location獨立計數。本機native Binding已觀察到allow/429；未做正式負載或管理資料試寫。

### 本輪檔案與Commit分組

- 修改runtime（原第2個原子Commit內既有檔）：wrangler.json、src/lib/notbgg-admin-api.ts、src/lib/collection-admin-api.ts、src/lib/notbgg-link-api.ts。
- 修改6個既有fixture（第3個Commit）：tests/notbgg-admin-api.test.ts、tests/notbgg-collection.test.ts、tests/notbgg-link.test.ts、tests/notbgg-admin-browser.cjs、tests/notbgg-collection-browser.cjs、tests/notbgg-link-browser.cjs。
- 新增（第3個Commit）：tests/notbgg-rate-limiter.test.ts、docs/notbgg-rate-limiter-verification.json。
- 更新（第3個Commit）：本Runbook、docs/notbgg-deployment-candidate.json。

共14個新增／修改路徑，**不需改變三組原子Commit結構**，檔數為1／116／103。產生的worker-configuration.d.ts、build、logs仍為本機排除項，不提交。16 metadata及2暫存仍全部排除，原文未動。

**正式Binding未被本輪更改或啟用。** 它應在第四階段核准的Worker部署中與新程式、核准30/60設定同時附加；部署後未確認Binding正確前維持停寫。即使部署配置缺失，新程式也會503 fail-closed，不會回到無限流寫入。

## 4. 正式D1恢復能力 — PASS（既有歷史metadata）／NOT VERIFIED（實際正式恢復）

D1 ID 59e9a17a-ff0f-494e-aab9-dd903a14e395，名稱boardgame-collection-db，storage version=production。R6已實際確認0001～0013、FK與quick_check通過；0014～0016尚未套用。本輪不再重複整套D1盤點。

本輪以**GET既有Time Travel歷史metadata**查詢 `2026-11-05T00:40:56.137Z`，兩次HTTP200且同一書籤，證實近期歷史查詢API可用；只記錄書籤SHA256 `acebfbb438a390d3f3504c9085a2536e4bb78426e32cdf9e482994a5f04a2f6b`，不將可操作的書籤值放入Git。沒有建立備份、匯出、還原或寫入，也沒有呼叫restore endpoint。

[Time Travel 官方文件](https://developers.cloudflare.com/d1/reference/time-travel/)：新storage可時間點恢復，方案最多Free7日／Paid30日。正式方案／完整保留期仍未取得，不能自行指定；近期書籤查詢成功不代表已實測正式恢復內容，也不是可永久保存的備份。D-7B前停寫後重新查得的書籤才是本次部署恢復點，**不得使用本輪較早的觀察點**。

恢復點驗證：核對account／DB UUID、停寫完成時間、schema=0013、必要聚合／外鍵／quick_check；同一UTC timestamp重查bookmark一致，保存JSON及hash到受保護位置，部署前再次確認可查與在有效窗口。R6合成恢復已驗證Schema／全表rows／sequence／收藏／購買／關聯／歷史一致；本輪沿用，不拿它冒稱正式Time Travel演練。正式實際恢復未測與容許停機／資料損失，須由Migration核准者明確接受或另定保護方案，不能偷偷填RTO/RPO=0。

失敗處理：維持停寫、停止後續Migration／Worker部署，先讀tracking與Schema確定成功邊界；不要刪tracking或重跑已套用檔，也不直接降Schema。原export dump在循環FK表建立順序失敗，Trigger先建又會重播guard衝突；若以SQL恢復需沿用R6受審查的table→rows/sequence→index→Trigger流程，不能原樣import。Time Travel覆寫原庫會丟失恢復點後新寫入，需獨立恢復核准及對帳。[D1 Migration失敗語意](https://developers.cloudflare.com/d1/wrangler-commands/)為當前失敗migration回復、先前成功migration保留，不能假設0014～0016是一起原子回復。

Worker rollback只切換程式版本，D1資料與Schema不隨之回退。已知舊Worker ID不是已證明的D-6語意相容rollback：舊版可能不理解primary映射，必須維持停寫並經相容性判斷；不得直接用它恢復管理寫入。

## 5. D-7B Runbook（尚未執行；依停寫、獨立核准與各階段gate前進）

命令適用PowerShell／安裝於lockfile的Node工具，從**人工核准Commit的乾淨release checkout**執行。不要直接在含未提交變更的原工作目錄部署；原metadata留在原處，無須刪除／封存。

共同變數（操作者填入已核准資料，未填不得繼續）：

```powershell
$NotBggReleaseSha = '<人工核准的完整Commit SHA>'
$NotBggExpectedSourceId = 'a2f10dddfa6f2821f6be411bf2dceeb752100e248e6742cacc09967038c95410'
$NotBggDb = 'boardgame-collection-db'
$NotBggOrigin = 'https://boardgame-collection-blog.nash0710-001.workers.dev'
$NotBggRollbackVersion = '75e4aec7-6bdb-4202-bee4-a0827dcbca53'
$NotBggEvidenceDir = '<人工核准的受保護目錄；不得在Git目錄內>'
$NotBggApprovedAccountId = '<人工確認的正式account ID>'
if ($NotBggApprovedAccountId -notmatch '^[a-f0-9]{32}$') { throw 'STOP: account未核准' }
if (-not (Test-Path -LiteralPath $NotBggEvidenceDir -PathType Container)) { throw 'STOP: evidence目錄尚未核准建立' }
$env:CLOUDFLARE_ACCOUNT_ID = $NotBggApprovedAccountId
```

**目前source ID已包含本輪限流修正；尚不是Git Commit或正式部署核准。** 建立核准Commit後核對同一manifest，不得把不同內容硬套本ID；若再修改任何source/config，更新ID並做必要驗證。書籤、聚合快照、登入資訊只保存在核准位置，不進Git。

### 第一階段：固定Git版本及確認恢復點

**核准：需要Git add/commit的獨立明確授權，且操作者已確認停寫／維護窗口、恢復責任人、容許停機與資料損失。這些目前尚未核准。** 本輪限流修正核准不是Git、Migration或Worker部署授權。

```powershell
git status --porcelain=v1 --untracked-files=all
git rev-parse HEAD
if ((git rev-parse HEAD).Trim() -ne $NotBggReleaseSha) { throw 'STOP: release Commit mismatch' }
if (git status --porcelain=v1 --untracked-files=all) { throw 'STOP: release checkout not clean' }
node .\node_modules\wrangler\bin\wrangler.js whoami
if ($LASTEXITCODE -ne 0) { throw 'STOP: OAuth/account check failed; complete manual login first' }
node .\node_modules\wrangler\bin\wrangler.js d1 info $NotBggDb --config .\wrangler.json --json
node .\node_modules\wrangler\bin\wrangler.js d1 migrations list $NotBggDb --remote --config .\wrangler.json
```

預期：HEAD等於核准release SHA；乾淨checkout無未核准檔；account／DB UUID正確、pending**恰好0014、0015、0016**。先核對manifest所有clean Blob；私人bgg-collection-cache僅以R5/候選記錄的hash作受保護build輸入，不能進Git。已有example initializer，但不可默默用空template替換本輪已測私人輸入後宣稱同一候選。

乾淨checkout缺dependencies／types時：

```powershell
npm ci
node .\node_modules\wrangler\bin\wrangler.js types --config .\wrangler.json
# 由操作者以已核准安全方式提供同hash的私人build input；不得顯示內容或提交
node .\node_modules\astro\bin\astro.mjs build
if ($LASTEXITCODE -ne 0) { throw 'STOP: release build failed' }
```

不得把dist/server/.dev.vars打包；核對generated config的DB／ASSETS／worker-first／核准limiter，對比核准source與artifact manifest。如果build環境／輸入讓artifact不同，先審核差異，不直接發布。

候選manifest v2核對命令（唯讀、symlink-aware；不寫Git object）：

~~~powershell
$env:NOTBGG_EXPECTED_SOURCE_ID = $NotBggExpectedSourceId
@'
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto');
const m=JSON.parse(fs.readFileSync('docs/notbgg-deployment-candidate.json','utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const cmd=(...a)=>cp.execFileSync('git',a,{stdio:['ignore','pipe','ignore']});
const index=new Map(cmd('ls-files','--stage','-z').toString().split('\0').filter(Boolean).map(s=>{const [v,p]=s.split('\t'),[mode,oid]=v.split(' ');return[p,{mode,oid}];}));
const fileMode=cmd('config','--get','core.filemode').toString().trim()==='true';
const exclusions=['docs/notbgg-d7b-deployment-runbook.md','docs/notbgg-deployment-candidate.json'];
const files=[...m.reviewFiles].sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path))).map(f=>{
 const st=fs.lstatSync(f.path);let mode,oid;
 if(st.isSymbolicLink()){mode='120000';oid=cp.execFileSync('git',['hash-object','--stdin'],{input:fs.readlinkSync(f.path,{encoding:'buffer'}),stdio:['pipe','pipe','ignore']}).toString().trim();}
 else {if(!st.isFile()||index.get(f.path)?.mode==='120000')throw Error('STOP: file type changed');mode=fileMode?((st.mode&0o111)?'100755':'100644'):(index.get(f.path)?.mode||'100644');if(!exclusions.includes(f.path))oid=cp.execFileSync('git',['hash-object','--path='+f.path,'--stdin'],{input:fs.readFileSync(f.path),stdio:['pipe','pipe','ignore']}).toString().trim();}
 if(mode!==f.gitMode||(!exclusions.includes(f.path)&&oid!==f.gitBlobOid))throw Error('STOP: mode/blob changed: '+f.path);
 return {path:f.path,gitMode:mode,gitBlobOid:exclusions.includes(f.path)?null:oid};
});
if(sha(fs.readFileSync(m.privateBuildInput.path))!==m.privateBuildInput.sha256)throw Error('STOP: private build input changed');
const p={algorithm:'notbgg-rc-git-tree-v2',baselineHead:m.baselineHead,privateBuildInputSha256:m.privateBuildInput.sha256,contentExclusions:exclusions,files};
const id=sha(Buffer.from(JSON.stringify(p),'utf8'));
if(m.algorithmVersion!=='notbgg-rc-git-tree-v2'||id!==m.candidateSourceId||id!==process.env.NOTBGG_EXPECTED_SOURCE_ID)throw Error('STOP: candidate identity mismatch');
console.log('CANDIDATE_CONTENT_PASS '+id);
'@ | node
if ($LASTEXITCODE -ne 0) { throw 'STOP: candidate changed' }
~~~

完成**所有管理寫入入口的停寫**後，記錄新恢復點與基線（以下都唯讀）：

```powershell
$NotBggRecoveryUtc = (Get-Date).ToUniversalTime().ToString('o')
$NotBggPointJson = node .\node_modules\wrangler\bin\wrangler.js d1 time-travel info $NotBggDb --config .\wrangler.json --timestamp $NotBggRecoveryUtc --json
if ($LASTEXITCODE -ne 0) { throw 'STOP: recovery lookup failed' }
$NotBggPoint = $NotBggPointJson | ConvertFrom-Json
if (-not $NotBggPoint.bookmark) { throw 'STOP: missing bookmark' }
$NotBggRestoreBookmark = $NotBggPoint.bookmark
$NotBggPointJson | Set-Content -Encoding utf8 (Join-Path $NotBggEvidenceDir 'pre-migration-point.json')
node .\node_modules\wrangler\bin\wrangler.js d1 time-travel info $NotBggDb --config .\wrangler.json --timestamp $NotBggRecoveryUtc --json
node .\node_modules\wrangler\bin\wrangler.js d1 execute $NotBggDb --remote --config .\wrangler.json --file .\docs\notbgg-deployment-integrity.sql --json > (Join-Path $NotBggEvidenceDir 'pre-integrity.json')
if ($LASTEXITCODE -ne 0) { throw 'STOP: baseline check failed' }
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $NotBggEvidenceDir 'pre-migration-point.json')
Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $NotBggEvidenceDir 'pre-integrity.json')
```

預期：同timestamp bookmark相同、DB仍0013、FK空、quick_check=ok，聚合基線可讀；這是確認自動Time Travel恢復點，不是執行restore或SQL export。**停止**：無書籤／查詢權限、狀態漂移、未完成停寫、恢復條件或資料損失責任未核准。**恢復**：此階段沒改DB／Worker，修正前置條件後再決定，不需要Schema回滾。

### 第二階段：確認Access與Rate Limiter

**核准：唯讀檢查不需要部署核准；任何程式／Binding／Access變更需另行明確核准。本輪未授權或執行。**

```powershell
$NotBggCode = curl.exe --path-as-is --max-redirs 0 -sS -o NUL -w '%{http_code}' "$NotBggOrigin/admin"
if ($NotBggCode -notin @('302','401','403')) { throw 'STOP: admin not protected' }
$NotBggCode = curl.exe --path-as-is --max-redirs 0 -sS -o NUL -w '%{http_code}' "$NotBggOrigin/api/admin/auth-check"
if ($NotBggCode -notin @('302','401','403')) { throw 'STOP: admin API not protected' }
node .\node_modules\wrangler\bin\wrangler.js secret list --name boardgame-collection-blog --config .\wrangler.json
```

人工在瀏覽器登入Access後，只開啟 /api/admin/auth-check 確認200及success，不複製JWT/cookie，不做管理寫入。核對當前正式settings並如實記錄Binding是否尚未啟用；候選已驗證缺binding503、deny429、例外拒絕。正式Binding將隨第四階段核准部署附加，部署後必須確認type/namespace/30/60。使用受權唯讀API GET /accounts/{account}/workers/scripts/boardgame-collection-blog/settings 的bindings，不讀Secret值。不能只檢查Secret list代替limiter或只看本機config。

候選設定的快速停止gate：

```powershell
@'
const fs=require('fs');const c=JSON.parse(fs.readFileSync('wrangler.json','utf8'));
const b=c.ratelimits?.find(x=>x.name==='NOTBGG_WRITE_LIMITER');
if(!b||b.namespace_id!=='12071'||b.simple?.period!==60||b.simple?.limit!==30)throw Error('STOP: approved limiter configuration differs');
'@ | node
if ($LASTEXITCODE -ne 0) { throw 'STOP: limiter gate failed' }
```

**此候選gate現在應PASS。** 若正式舊版尚無Binding，第二階段只能在「管理寫入持續停用／停寫、候選fail-closed測試已通過、generated config精確為12071/30/60、namespace專用條件已確認」下準備Migration；不把舊正式Binding缺失標為PASS，也不在此階段偷偷改正式設定或先部署Worker。第四階段取得獨立W核准後，Binding和新程式同次部署；第六階段驗證正式Binding前不得恢復管理寫入。

**停止**：未停寫、匿名管理資料外洩、auth-check不可用、候選Binding/數值漂移、namespace衝突、寫入guard失效。**回復**：此時未Migration，維持現行版本及停寫；不以繞過Access或開放無限流解決。

### 第三階段：正式0014～0016 Migration

**獨立人工核准 M 必須明確指定：account、DB ID、當次恢復點、三個SQL的hash、pending清單及維護窗口。Worker部署核准不能代替M。**

```powershell
# 只有取得核准M且第一、二階段通過後才執行
node .\node_modules\wrangler\bin\wrangler.js d1 migrations list $NotBggDb --remote --config .\wrangler.json
# 人工確認恰好0014/0015/0016，沒有其他pending
node .\node_modules\wrangler\bin\wrangler.js d1 migrations apply $NotBggDb --remote --config .\wrangler.json
if ($LASTEXITCODE -ne 0) { throw 'STOP: migration failed; do not deploy Worker' }
node .\node_modules\wrangler\bin\wrangler.js d1 execute $NotBggDb --remote --config .\wrangler.json --file .\docs\notbgg-deployment-integrity.sql --json > (Join-Path $NotBggEvidenceDir 'post-migration-integrity.json')
if ($LASTEXITCODE -ne 0) { throw 'STOP: integrity check failed' }
```

預期：依序登記至0016，原13筆tracking不變，原收藏／game／copy／purchase聚合與scope不變，FK空、quick_check=ok；0015 delete guard、0016 command gate存在。未核准的測試資料不能趁此插入。

**停止**：任何一步失敗／pending漂移／統計或Schema不符；不得開始第四階段。先讀tracking及Schema判斷0014／0015／0016哪個成功；既有成功Migration保留。0015失敗特別查table rebuild／row／sequence／indexes／delete guard，0016失敗不准啟用無command gate的寫入fallback。

**恢復**：優先維持停寫與舊Worker，依實際成功邊界審查前向修復；若必須Time Travel還原，取得**獨立人工核准 R**後才可：

```powershell
# 事故分支：只在核准R、持續停寫、DB/恢復點再次核對後執行
node .\node_modules\wrangler\bin\wrangler.js d1 time-travel restore $NotBggDb --config .\wrangler.json --bookmark $NotBggRestoreBookmark
if ($LASTEXITCODE -ne 0) { throw 'STOP: recovery failed; retain write freeze' }
node .\node_modules\wrangler\bin\wrangler.js d1 execute $NotBggDb --remote --config .\wrangler.json --file .\docs\notbgg-deployment-integrity.sql --json > (Join-Path $NotBggEvidenceDir 'restored-integrity.json')
```

比對pre-integrity與恢復後tracking／核心聚合／FK／Schema，確認沒有丟失恢復點後合法變動；若已開始寫入，先做受保護對帳再判斷可否覆寫。不能用刪表／刪tracking／反向執行0013來降版。

### 第四階段：部署候選Worker

**另取獨立人工核准 W：明確指向release Commit SHA、source ID、artifact hash、Worker name、bindings／ASSETS，以及rollback風險。Migration核准M不代表W。**

```powershell
# 只有取得W，且0016與所有前置gate通過後才執行
git rev-parse HEAD
node .\node_modules\wrangler\bin\wrangler.js deploy --config .\dist\server\wrangler.json --keep-vars
if ($LASTEXITCODE -ne 0) { throw 'STOP: deployment failed; retain write freeze' }
node .\node_modules\wrangler\bin\wrangler.js deployments list --name boardgame-collection-blog --config .\wrangler.json
```

部署後、仍停寫時，唯讀核對正式Binding；未通過不得恢復管理寫入：

~~~powershell
@'
const fs=require('fs'),path=require('path');
(async()=>{
 const toml=fs.readFileSync(path.join(process.env.APPDATA,'xdg.config/.wrangler/config/default.toml'),'utf8');
 const token=toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
 const expiry=toml.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
 if(!token||!expiry||Date.parse(expiry)<=Date.now())throw Error('OAuth unavailable');
 const account=process.env.CLOUDFLARE_ACCOUNT_ID;
 if(!/^[a-f0-9]{32}$/.test(account||''))throw Error('Account not verified');
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/boardgame-collection-blog/settings',{headers:{Authorization:'Bearer '+token}});
 const body=await r.json();
 if(!r.ok||!body.success)throw Error('Settings read failed');
 const b=body.result.bindings?.find(x=>x.name==='NOTBGG_WRITE_LIMITER');
 if(!b||b.type!=='ratelimit'||String(b.namespace_id)!=='12071'||b.simple?.limit!==30||b.simple?.period!==60)throw Error('Binding differs');
 console.log('FORMAL_LIMITER_BINDING_PASS');
})().catch(()=>{console.error('STOP: formal limiter binding not verified');process.exitCode=1;});
'@ | node
if ($LASTEXITCODE -ne 0) { throw 'STOP: retain management write freeze' }
~~~

使用Astro build產生的server config／entry.mjs及實際ASSETS，不只上傳dist/client，也不直接把src/worker.ts當作已編譯產物部署。--keep-vars避免清空既有plain vars；Secret名稱、DB ID、SESSION、IMAGES、NOTBGG_WRITE_LIMITER（12071/30/60）、五條worker-first仍須核對；不能用此flag假定所有binding自動保留。

預期：新version確實使用核准產物、100%或核准比例、DB/ASSETS正確。**停止**：版本／配置漂移、upload失敗、secret名稱或binding缺失、500／503異常；先停第五階段寫入恢復。**回滾**：取得事故回滾核准，且已確認舊版能安全讀目前Schema時才可切回：

```powershell
# 事故分支；舊版未證明D6語意相容前保持停寫
node .\node_modules\wrangler\bin\wrangler.js rollback $NotBggRollbackVersion --name boardgame-collection-blog --config .\wrangler.json --message 'Approved NotBGG V1.2 rollback'
```

此命令**不還原D1**。正式已開始寫入／建立mapping時，舊版可能顯示錯誤primary；回滾不是立刻恢復寫入的許可。

### 第五階段：正式HTTP Smoke Test

**核准：唯讀Smoke在W核准範圍內；任何建立／確認對應／解除／封存／購買或收藏寫入仍需獨立安全資料核准。**

```powershell
$NotBggPaths = @('/games','/en/games','/games/santorini','/en/games/santorini','/games/santorini.html','/games/santorini/index.html','/games/%73antorini','//games/santorini.html','/en//games/santorini.html','/games/notbgg/999999','/favicon.svg')
foreach ($NotBggPath in $NotBggPaths) {
  curl.exe --path-as-is --max-redirs 0 -sS -o NUL -w '%{http_code} %{redirect_url}\n' "$NotBggOrigin$NotBggPath"
  if ($LASTEXITCODE -ne 0) { throw 'STOP: HTTP transport failure' }
}
curl.exe --path-as-is --max-redirs 0 -sS -D (Join-Path $NotBggEvidenceDir 'bgg-headers.txt') -o (Join-Path $NotBggEvidenceDir 'bgg-body.html') "$NotBggOrigin/games/santorini"
curl.exe --path-as-is --max-redirs 0 -sS -I "$NotBggOrigin/games/santorini/index.html?q=keep%20state"
```

不自動follow跨origin redirect。若307，人工確認Location同origin、語言正確、query保留，再讀Location，最多4次、不可循環或永久301。中英文BGG最終200／正確內容／單一正式canonical；新動態目錄無503，missing NotBGG ID為404。從HTML取實際/_astro CSS／JS各一個URL，加favicon比對核准artifact bytes及MIME；重複GET檢查Cache-Control、Age、CF-Cache-Status。身份相關頁／307／管理no-store；hashed資產可immutable，不能把舊版public HIT當新身份頁合格。

NotBGG正向動態頁若正式尚無資料，記NOT VERIFIED，沿用本輪隔離正向測試；不創造正式收藏做測試。confirmed／primary／revoke／archive完整210狀態矩陣已在合成環境通過，正式只讀當下已核准公開狀態；新fixture需另提安全資料方案。再做第二階段的匿名GET及人工有效auth-check GET。

**停止**：錯primary／canonical、迴圈、307 query遺失、靜態資產錯誤、公開私人欄位、Access失效、必要binding缺失。**回復**：維持停寫，依第四階段相容性判斷Worker rollback；不要為HTTP問題直接恢復D1。

### 第六階段：完整性、管理安全與監測

**核准：解除停寫／正式使用者恢復寫入須由部署責任人核准；本輪不做。**

```powershell
node .\node_modules\wrangler\bin\wrangler.js d1 execute $NotBggDb --remote --config .\wrangler.json --file .\docs\notbgg-deployment-integrity.sql --json > (Join-Path $NotBggEvidenceDir 'post-smoke-integrity.json')
if ($LASTEXITCODE -ne 0) { throw 'STOP: final integrity check failed' }
node .\node_modules\wrangler\bin\wrangler.js deployments list --name boardgame-collection-blog --config .\wrangler.json
# 受保護終端檢視；不要把私人console內容原樣貼到Git／聊天
node .\node_modules\wrangler\bin\wrangler.js tail boardgame-collection-blog --config .\wrangler.json --format pretty
```

預期：對比pre/post核心聚合與scope一致、tracking16筆、FK空、quick_check=ok；人工有效管理員GET200、匿名拒絕、limiter確實綁定。429行為沿用隔離測試或另行核准獨立fixture，不用正式收藏做負載／破壞測試。監測401/403/429/500/503、D1錯誤與身份／canonical異常；出現異常先停止管理寫入，依事故分支判斷，不假定Schema可降版。

**高BODY CLS仍NOT VERIFIED，列為部署後監測項，不另開R7。** 以真圖片/CDN、冷暖cache、手機/桌面、長窗口蒐集layout-shift；記錄安全selector／before-after rect／CSS/圖片/字型時點、body margin，排除recent input並使用最大session window。建議mobile/desktop分別p75≤0.1；再次>0.25或BODY大shift即調查及評估暫停／Worker回滾，不因最近0值結案，不因此盲目還原D1。Trace不得含私人DOM或憑證。

## 6. 完整納入及排除清單

待提交增量共220檔，依三組如下；基線中未變更檔案另列，完整候選樹與每檔hash在candidate manifest。沒有刪除／封存16原始metadata，也沒有改ignore去隱藏它們。

### Commit 1 — 1檔

- `migrations/0003_sleeve_size_validation.sql`

### Commit 2 — 116檔

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
- `astro.config.mjs`
- `src/middleware.ts`
- `src/worker.ts`
- `wrangler.json`

### Commit 3 — 103檔

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
- `docs/d7a-r5-0003-bytes.json`
- `docs/d7a-r5-auth-status.json`
- `docs/d7a-r5-browser-results.json`
- `docs/d7a-r5-candidate-manifest.json`
- `docs/d7a-r5-check-results.json`
- `docs/d7a-r5-final-verification.json`
- `docs/d7a-r5-git-inventory.json`
- `docs/d7a-r5-migration-evidence.json`
- `docs/d7a-r5-restore-evidence.json`
- `docs/d7a-r5-sensitive-audit.json`
- `docs/d7a-r5-smoke-matrix.json`
- `docs/notbgg-d7a-r5-release-readiness.md`
- `docs/notbgg-d7a-r6-release-preparation.md`
- `docs/d7a-r6-auth-status.json`
- `docs/d7a-r6-metadata-review.json`
- `docs/d7a-r6-cloudflare-readonly.json`
- `docs/d7a-r6-restore-evidence.json`
- `docs/d7a-r6-git-candidate.json`
- `docs/d7a-r6-0003-verification.json`
- `docs/notbgg-d7b-deployment-runbook.md`
- `docs/notbgg-deployment-candidate.json`
- `docs/notbgg-deployment-safety.json`
- `docs/notbgg-deployment-verification.json`
- `docs/notbgg-deployment-integrity.sql`

- `tests/notbgg-rate-limiter.test.ts`
- `docs/notbgg-rate-limiter-verification.json`

### 從HEAD繼承、未新增修改的基線檔（60檔）

- `.gitignore`
- `.vscode/extensions.json`
- `.vscode/launch.json`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `migrations/0001_sleeve_management.sql`
- `migrations/0002_normalize_sleeve_sizes.sql`
- `migrations/0004_collection_management_upgrade.sql`
- `migrations/0005_collection_item_metadata.sql`
- `migrations/0006_collection_component_quantity.sql`
- `migrations/0007_v2_core_schema.sql`
- `migrations/0008_v2_purchase_costs.sql`
- `migrations/0009_v2_purchase_integrity.sql`
- `migrations/0010_v2_copy_conditions.sql`
- `migrations/0011_v2_sleeve_management.sql`
- `migrations/0012_v1_to_v2_migration.sql`
- `migrations/0013_v2_record_scope.sql`
- `public/favicon.ico`
- `public/favicon.svg`
- `public/images/cat-adventure-banner.png`
- `scripts/bgg-collection-types.ts`
- `scripts/bgg-mechanics-list.csv`
- `scripts/check-mechanics.mjs`
- `scripts/ensure-bgg-collection-cache.mjs`
- `scripts/import-sleeves-d1.ts`
- `scripts/parse-bgg-collection.ts`
- `scripts/test-bgg-collection.ts`
- `scripts/update-bgg-cache.ts`
- `scripts/update-bgg-collection-cache.ts`
- `scripts/verify_schema.py`
- `src/components/AboutPage.astro`
- `src/components/BlogPage.astro`
- `src/components/CollectionFilter.astro`
- `src/components/HomePage.astro`
- `src/data/bgg-collection-cache.example.json`
- `src/data/game-sleeves.json`
- `src/data/games.ts`
- `src/env.d.ts`
- `src/i18n/game-localization.ts`
- `src/i18n/mechanics.ts`
- `src/lib/bgg-collection-parser.ts`
- `src/lib/bgg-collection-types.ts`
- `src/lib/bgg-parser.ts`
- `src/lib/bgg-types.ts`
- `src/lib/bgg.ts`
- `src/lib/game-sleeves.ts`
- `src/pages/about.astro`
- `src/pages/api/sleeves/game/[id].ts`
- `src/pages/api/sleeves/games.ts`
- `src/pages/api/sleeves/summary.ts`
- `src/pages/blog.astro`
- `src/pages/dev/collection-v2-test.astro`
- `src/pages/en/about.astro`
- `src/pages/en/blog.astro`
- `src/pages/en/index.astro`
- `src/pages/index.astro`
- `src/pages/sleeves.astro`
- `src/styles/cat-adventure-theme.css`
- `tsconfig.json`

### 明確排除（18檔，保留原文）

- `.bgg-b2-test-1JZTMi/cache.json` — 測試暫存，不納入Commit
- `.bgg-b2-test-FSA5Oi/cache.json` — 測試暫存，不納入Commit
- `docs/reference/d1_collection_status.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/d1_v2_counts.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/d1_v2_schema.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1D_20261027_R03_run_summary.ndjson` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_acquisitions_columns.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_acquisitions_fk.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_acquisitions_indexes.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_acquisitions_unique_columns.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_copies_columns.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_copies_fk.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_copies_index_columns.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_copies_indexes.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_fk_check.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_master.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_migrations.json` — 歷史正式metadata，不納入Commit；不刪除／封存
- `docs/reference/phase-c1/d1_C1_quick_check.json` — 歷史正式metadata，不納入Commit；不刪除／封存

其他本機排除：.env／.env.*／.dev.vars*、私人src/data/bgg-collection-cache.json、.wrangler（含本輪logs／screenshots／temporary verifier）、.astro、node_modules、dist、generated worker-configuration.d.ts、SQLite／journals／backups／*.bak／*.log，沿用既有ignore。既有HEAD的editor設定不是本輪新增產物；不屬Worker artifact，沒有擅自刪掉已追蹤基線檔。部署manifest特別排除dist/server/.dev.vars及任何.env類檔；私人build input只留hash，不提交內容。

## 7. 剩餘條件與GO／NO-GO

- **GO（本機候選限流修正）**：核准30/60/12071已加入；缺Binding/例外fail-closed、429與正常寫入已測，Wrangler相容、D-5/D-6、strict、Astro、build通過。原已確認的候選安全缺口已解除。
- **尚未部署／啟用**：正式Binding不會因本機修正自動存在；第四階段以核准W同次附加並在停寫下驗證。若部署後缺Binding，新程式拒絕寫入，不能把安全修正PASS當成正式Binding PASS。
- **NO-GO（直接正式部署）**：尚無實際Git Commit SHA，尚未取得Git操作、當次恢復點/維護窗口與獨立Migration M／Worker W核准；本輪不代為執行。
- 正式Access有效管理員GET、恢復點及部署後Binding／Smoke依原Runbook於D-7B當次完成；不再新增D-7A階段。高BODY CLS維持既定部署後監測項。

完整納入／排除與新source SHA256見candidate manifest。未git add／commit／push，未部署，未正式Migration／D1寫入，未修改正式Access／Route／Binding／Secret；16 metadata及2暫存原檔未刪除、未封存。到此停止，等待人工核准下一步。
