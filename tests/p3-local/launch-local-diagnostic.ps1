# L2 STATIC PREPARATION. Run only after separate L3 authorization.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Workspace,
  [Parameter(Mandatory)][string]$RunRoot,
  [Parameter(Mandatory)][string]$ExpectedLauncherSha256,
  [Parameter(Mandatory)][string]$ExpectedRuntimeSha256,
  [Parameter(Mandatory)][string]$ExpectedEvidenceSha256,
  [string]$NodePath='D:\Program Files\nodejs\node.exe',
  [switch]$NoSql,[switch]$LocalFunctionalPolicy,[switch]$ExecutionAuthorized
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion -lt [System.Management.Automation.SemanticVersion]'7.5.0'){throw 'BLOCKED requires PowerShell 7.5.0 or newer for ConvertFrom-Json -DateKind String'}
if(-not [OperatingSystem]::IsWindows()){throw 'BLOCKED requires a Windows host'}
function Assert-PlainPath([string]$Target) {
  for($cursor=$Target;$cursor;$cursor=Split-Path $cursor -Parent){
    if(Test-Path -LiteralPath $cursor){if((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'BLOCKED reparse point'}}
  }
}
function Safe-Reason($ErrorRecord) {
  # Only our closed diagnostic reason codes are eligible for persistence.
  $known=@('DEADLINE','CHILD_FATAL_MARKER','STDERR_ANOMALY','INVALID_IPC_FRAME','IPC_FIELDS','IPC_ID_SEQUENCE_TIME','IPC_STAGE_FIELDS','IPC_STAGE_ORDER','IPC_ENDPOINT_MISSING','IPC_ENDPOINT_FIELDS','IPC_ENDPOINT','IPC_FINAL_FIELDS','IPC_FINAL_INVALID','CHILD_FATAL_IPC','IPC_KIND','IPC_LINE_TOO_LONG','IPC_CLOSED_BEFORE_FINAL','INCOMPLETE_OR_FAILED_EXIT','IPC_PAYLOAD_TYPE','IPC_FATAL_FIELDS')
  try{if($ErrorRecord.Exception.Message -cin $known){return $ErrorRecord.Exception.Message}}catch{}
  return 'PARENT_EXCEPTION_REDACTED'
}
function Assert-Fields($Value,[string[]]$Names) {
  if($Value -isnot [pscustomobject] -or ((@($Value.PSObject.Properties.Name|Sort-Object -CaseSensitive) -join ',') -cne (@($Names|Sort-Object -CaseSensitive) -join ','))){throw 'EVIDENCE_FIELDS'}
}
function Assert-Utc($Value,[switch]$Persisted) {
  $parsed=[DateTimeOffset]::MinValue
  $formats=[string[]]@("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
  if($Persisted){$formats+=@("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'")}
  $styles=[Globalization.DateTimeStyles]::AssumeUniversal
  if($Value -isnot [string] -or -not $Value.EndsWith('Z',[StringComparison]::Ordinal) -or -not [DateTimeOffset]::TryParseExact($Value,$formats,[Globalization.CultureInfo]::InvariantCulture,$styles,[ref]$parsed)){throw 'EVIDENCE_UTC'}
}
function Read-EvidenceJson([string]$Name) {
  $p=Join-Path $ev $Name;Assert-PlainPath $p
  if(-not(Test-Path -LiteralPath $p -PathType Leaf) -or (Get-Item -LiteralPath $p).Length -gt 2097152){throw 'EVIDENCE_MISSING_OR_OVERSIZE'}
  $record=Get-Content -LiteralPath $p -Raw|ConvertFrom-Json -DateKind String -Depth 24
  if($record -is [pscustomobject] -and $null -ne $record.PSObject.Properties['utc']){Assert-Utc $record.utc -Persisted}
  return $record
}
function Read-EvidenceLines([string]$Name) {
  $p=Join-Path $ev $Name;Assert-PlainPath $p
  if(-not(Test-Path -LiteralPath $p -PathType Leaf) -or (Get-Item -LiteralPath $p).Length -gt 2097152){throw 'EVIDENCE_MISSING_OR_OVERSIZE'}
  foreach($line in [IO.File]::ReadAllLines($p)){
    if($line.Length -eq 0 -or [Text.Encoding]::UTF8.GetByteCount($line) -gt 16384){throw 'EVIDENCE_LINE'}
    $record=$line|ConvertFrom-Json -DateKind String -Depth 24
    if($record -is [pscustomobject] -and $null -ne $record.PSObject.Properties['utc']){Assert-Utc $record.utc -Persisted}
    $record
  }
}
function Inventory-Root([string]$Directory) {
  # Check each directory before descending: never follow a discovered reparse point.
  foreach($item in Get-ChildItem -LiteralPath $Directory -Force){
    if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'OUTPUT_REPARSE'}
    if($item.PSIsContainer){Inventory-Root $item.FullName}else{
      $h=Get-FileHash -LiteralPath $item.FullName
      [pscustomobject]@{relativePath=[IO.Path]::GetRelativePath($RunRoot,$h.Path);bytes=$item.Length;sha256=$h.Hash}
    }
  }
}
function Hash-Rows([string[]]$Files){
  foreach($file in $Files){$h=Get-FileHash -LiteralPath $file -Algorithm SHA256;[pscustomobject]@{path=$h.Path;sha256=$h.Hash}}
}
if(-not($NoSql -and $LocalFunctionalPolicy -and $ExecutionAuthorized)){throw 'BLOCKED L3 execution gates missing'}
$Workspace=[IO.Path]::GetFullPath($Workspace).TrimEnd([IO.Path]::DirectorySeparatorChar)
$RunRoot=[IO.Path]::GetFullPath($RunRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$scriptWorkspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')).TrimEnd([IO.Path]::DirectorySeparatorChar)
$runId='P3L3-20261118-001'
if($Workspace -ne $scriptWorkspace -or (Get-Location).Path -ne $Workspace){throw 'BLOCKED workspace/cwd'}
if($RunRoot -ne (Join-Path $Workspace ".wrangler/p3-local/diagnostics/$runId")){throw 'BLOCKED run root'}
if(Test-Path -LiteralPath $RunRoot){throw 'BLOCKED run root already exists'}
Assert-PlainPath $Workspace;Assert-PlainPath $RunRoot
if($NodePath -ne 'D:\Program Files\nodejs\node.exe'){throw 'BLOCKED Node path'}
Assert-PlainPath $NodePath
$nodeFileVersion=(Get-Item -LiteralPath $NodePath).VersionInfo.FileVersion
$nodeVersionMatch=[regex]::Match($nodeFileVersion,'^(24\.21\.0)(?:\.|$)')
if(-not $nodeVersionMatch.Success){throw 'BLOCKED Node file version'}
$environmentSummary=[ordered]@{
  powerShellVersion=$PSVersionTable.PSVersion.ToString()
  nodeVersion=$nodeVersionMatch.Groups[1].Value
  osType='Windows'
  testMode='LOCAL_FUNCTIONAL'
  result='UNKNOWN'
  elevated='UNKNOWN'
  sandboxStatus='UNKNOWN'
}
# The Node version above comes from file metadata. No token elevation or sandbox attestation is available here.
$toolFiles=@('launch-local-diagnostic.ps1','diagnose-local-runtime.mjs','diagnostic-evidence.mjs')|ForEach-Object {Join-Path $PSScriptRoot $_}
$toolHashes=@($ExpectedLauncherSha256,$ExpectedRuntimeSha256,$ExpectedEvidenceSha256)
for($i=0;$i -lt 3;$i++){Assert-PlainPath $toolFiles[$i];if($toolHashes[$i] -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $toolFiles[$i]).Hash -ne $toolHashes[$i]){throw 'BLOCKED reviewed tool hash mismatch'}}
foreach($entry in @(@('miniflare','5.20261006.1-alpha'),@('workerd','1.20261006.1'))){
  $package=Join-Path $Workspace "node_modules/$($entry[0])/package.json"
  Assert-PlainPath $package
  if((Get-Content -LiteralPath $package -Raw|ConvertFrom-Json -DateKind String).version -ne $entry[1]){throw 'BLOCKED package version'}
}
$native=Join-Path $Workspace 'node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe'
Assert-PlainPath $native
Assert-PlainPath (Join-Path $Workspace 'node_modules/miniflare/dist/src/index.js')
if(-not(Test-Path -LiteralPath $native -PathType Leaf)){throw 'BLOCKED native runtime absent'}
$protected=@('runner.mjs','local-runtime.ts','trusted-snapshot.ts','stage1.test.ts','sql/stage1-only.sql','tsconfig.json','diagnose-runtime.mjs')|ForEach-Object {Join-Path $Workspace "tests/p3-stage1/$_"}
$protected+=@('src/lib/component-classifier.ts','src/lib/component-classifier-adapter.ts','src/lib/physical-component-proof.ts','tests/helpers/notbgg-local-d1.ts','package-lock.json')|ForEach-Object {Join-Path $Workspace $_}
$migrations=@(Get-ChildItem -LiteralPath (Join-Path $Workspace 'migrations') -File|Where-Object {$_.Name -match '^\d{4}_.*\.sql$'}|Sort-Object Name)
if($migrations.Count -ne 22){throw 'BLOCKED migration count'}
for($i=0;$i -lt 22;$i++){if([int]$migrations[$i].Name.Substring(0,4) -ne ($i+1)){throw 'BLOCKED migration sequence'}}
$protected+=@($migrations|ForEach-Object {$_.FullName});$protected+=@($toolFiles)
foreach($file in $protected){Assert-PlainPath $file}
$before=@(Hash-Rows $protected)
# The launcher has no verified Job Object assignment before the child can spawn descendants.
# Direct child exit and Kill(true) do not attest to all descendants. Keep the stop gate closed.
New-Item -ItemType Directory -Path $RunRoot -ErrorAction Stop|Out-Null
foreach($sub in @('evidence','state','tmp','home','appdata','localappdata','config','cache')){New-Item -ItemType Directory -Path (Join-Path $RunRoot $sub)|Out-Null}
$ev=Join-Path $RunRoot 'evidence'
function Save-Json([string]$Name,$Value){
  $output=Join-Path $ev $Name
  if(Test-Path -LiteralPath $output){throw 'PARENT_EVIDENCE_OVERWRITE_REFUSED'}
  [IO.File]::WriteAllText($output,($Value|ConvertTo-Json -Depth 24),[Text.UTF8Encoding]::new($false))
}
Save-Json 'preflight.json' @{utc=[DateTime]::UtcNow.ToString('o');cwd=$Workspace;root=$RunRoot;rootWasAbsent=$true;reparseChecks='PASS';reviewedHashes=$toolHashes;sqlAllowed=$false;executionMode='LOCAL_FUNCTIONAL';strictIsolation='UNKNOWN_NOT_TESTED'}
$start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$NodePath;$start.WorkingDirectory=$RunRoot
$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true;$start.RedirectStandardInput=$true
foreach($arg in @($toolFiles[1],'--workspace',$Workspace,'--run-root',$RunRoot,'--no-sql','--local-functional-policy')){$start.ArgumentList.Add($arg)}
$start.Environment.Clear()
foreach($name in @('SystemRoot','WINDIR','SystemDrive','COMSPEC','PATHEXT','PROCESSOR_ARCHITECTURE')){
  $value=[Environment]::GetEnvironmentVariable($name);if($null -ne $value){$start.Environment[$name]=$value}
}
$start.Environment['PATH']='D:\Program Files\nodejs;'+(Join-Path $env:SystemRoot 'System32')
foreach($entry in @{TEMP='tmp';TMP='tmp';HOME='home';USERPROFILE='home';APPDATA='appdata';LOCALAPPDATA='localappdata';XDG_CONFIG_HOME='config';XDG_CACHE_HOME='cache'}.GetEnumerator()){$start.Environment[$entry.Key]=Join-Path $RunRoot $entry.Value}
$start.Environment['CI']='true';$start.Environment['WRANGLER_SEND_METRICS']='false'
Save-Json 'manifest.json' @{utc=[DateTime]::UtcNow.ToString('o');nodeFile=$NodePath;arguments=@($start.ArgumentList);environmentNames=@($start.Environment.Keys);protectedBefore=$before;miniflare='5.20261006.1-alpha';workerd='1.20261006.1';cf=$false;telemetry=$false;host='127.0.0.1';port=0;compatibilityDate='2026-10-01';binding='P3_TEST';sqlCallsAllowed=0;networkCoverage='LOCAL_HOOKS_ONLY_NOT_FULL_TREE_EGRESS'}
$proc=[Diagnostics.Process]::new();$proc.StartInfo=$start
$started=$false;$reason=$null;$final=$false;$endpointSeen=$false;$sequence=0;$stageIndex=0
$frames=[Collections.Generic.List[object]]::new();$endpoint=$null;$finalPayload=$null;$fatalPayload=$null
$phaseOrder=@('control:READY','construct:START','construct:SUCCESS','ready:START','ready:SUCCESS','getD1Database:START','getD1Database:SUCCESS','dispose:START','dispose:SUCCESS')
$stdoutBuffer='';$outEof=$false;$errEof=$false;$stdoutChars=[char[]]::new(1024);$stderrChars=[char[]]::new(1024)
$clock=[Diagnostics.Stopwatch]::new()
try {
  $clock.Start();[void]$proc.Start();$started=$true
  $outTask=$proc.StandardOutput.ReadAsync($stdoutChars,0,$stdoutChars.Length)
  $errTask=$proc.StandardError.ReadAsync($stderrChars,0,$stderrChars.Length)
  while($true){
    if($clock.ElapsedMilliseconds -ge 60000){throw 'DEADLINE'}
    if(Test-Path -LiteralPath (Join-Path $ev 'fatal.json')){throw 'CHILD_FATAL_MARKER'}
    if(-not $errEof -and $errTask.IsCompleted){
      $count=$errTask.GetAwaiter().GetResult()
      if($count -gt 0){'REDACTED: unclassified stderr content omitted'|Add-Content -LiteralPath (Join-Path $ev 'stderr-sanitized.log');throw 'STDERR_ANOMALY'}
      $errEof=$true
    }
    if(-not $outEof -and $outTask.IsCompleted){
      $count=$outTask.GetAwaiter().GetResult()
      if($count -eq 0){$outEof=$true}else{
        $stdoutBuffer += [string]::new($stdoutChars,0,$count)
        while($stdoutBuffer.Contains("`n")){
          $split=$stdoutBuffer.IndexOf("`n");$line=$stdoutBuffer.Substring(0,$split).TrimEnd("`r");$stdoutBuffer=$stdoutBuffer.Substring($split+1)
          if([Text.Encoding]::UTF8.GetByteCount($line) -gt 16384 -or $final){throw 'INVALID_IPC_FRAME'}
          $frame=$line|ConvertFrom-Json -DateKind String -Depth 12
          Assert-Fields $frame @('kind','payload','runId','seq','utc')
          Assert-Utc $frame.utc
          if($frame.kind -isnot [string] -or $frame.runId -isnot [string] -or $frame.runId -cne $runId -or ($frame.seq -isnot [long] -and $frame.seq -isnot [int]) -or $frame.seq -ne ($sequence+1)){throw 'IPC_ID_SEQUENCE_TIME'}
          if($frame.payload -isnot [pscustomobject]){throw 'IPC_PAYLOAD_TYPE'}
          $sequence++
          switch -CaseSensitive ($frame.kind){
            'stage' {
              Assert-Fields $frame.payload @('phase','status')
              $key="$($frame.payload.phase):$($frame.payload.status)"
              if($frame.payload.phase -isnot [string] -or $frame.payload.status -isnot [string] -or $stageIndex -ge $phaseOrder.Count -or $key -cne $phaseOrder[$stageIndex]){throw 'IPC_STAGE_ORDER'}
              if($key -eq 'ready:SUCCESS' -and -not $endpointSeen){throw 'IPC_ENDPOINT_MISSING'}
              $stageIndex++
              if($key -eq 'control:READY'){$proc.StandardInput.WriteLine("GO $runId");$proc.StandardInput.Flush();$proc.StandardInput.Close()}
            }
            'endpoint' {
              Assert-Fields $frame.payload @('host','port','protocol')
              if($endpointSeen -or $stageIndex -ne 4 -or $frame.payload.protocol -isnot [string] -or $frame.payload.protocol -cne 'http:' -or $frame.payload.host -isnot [string] -or $frame.payload.host -cne '127.0.0.1' -or $frame.payload.port -isnot [string] -or $frame.payload.port -cnotmatch '^\d{1,5}$' -or [int]$frame.payload.port -lt 1 -or [int]$frame.payload.port -gt 65535){throw 'IPC_ENDPOINT'}
              $endpointSeen=$true;$endpoint=$frame.payload
            }
            'fatal' {
              Assert-Fields $frame.payload @('code','errorPublication')
              if($frame.payload.code -isnot [string] -or $frame.payload.code -cnotin @('OUTBOUND_DENIED','URL_PARSE_REJECTED','UNCAUGHT_EXCEPTION','UNHANDLED_REJECTION','HANDSHAKE_FAILED','EVIDENCE_FAILURE','RUNTIME_LOG_ANOMALY','RUNTIME_LOG_ERROR','DIAGNOSTIC_FAILURE','DISPOSE_FAILED','IPC_FAILURE')){throw 'IPC_FATAL_FIELDS'}
              if($frame.payload.errorPublication -isnot [string] -or $frame.payload.errorPublication -cnotin @('PUBLISHED','EVIDENCE_MISSING')){throw 'IPC_FATAL_FIELDS'}
              $fatalPayload=$frame.payload
              $frames.Add($frame);$frame|ConvertTo-Json -Depth 5 -Compress|Add-Content -LiteralPath (Join-Path $ev 'control.ndjson');throw 'CHILD_FATAL_IPC'
            }
            'final' {
              Assert-Fields $frame.payload @('bindingAcquired','childResultSha256','disposed','sqlCalls','strictIsolationResult')
              if($stageIndex -ne $phaseOrder.Count -or $frame.payload.bindingAcquired -isnot [bool] -or $frame.payload.bindingAcquired -ne $true -or $frame.payload.disposed -isnot [bool] -or $frame.payload.disposed -ne $true -or ($frame.payload.sqlCalls -isnot [int] -and $frame.payload.sqlCalls -isnot [long]) -or $frame.payload.sqlCalls -ne 0 -or $frame.payload.strictIsolationResult -isnot [string] -or $frame.payload.strictIsolationResult -cne 'UNKNOWN_NOT_TESTED' -or $frame.payload.childResultSha256 -isnot [string] -or $frame.payload.childResultSha256 -cnotmatch '^[a-f0-9]{64}$'){throw 'IPC_FINAL_INVALID'}
              $final=$true;$finalPayload=$frame.payload
            }
            default {throw 'IPC_KIND'}
          }
          # Store only parsed, expected control fields; no raw stdout from unknown producers.
          $frames.Add($frame);$frame|ConvertTo-Json -Depth 5 -Compress|Add-Content -LiteralPath (Join-Path $ev 'control.ndjson')
        }
        if([Text.Encoding]::UTF8.GetByteCount($stdoutBuffer) -gt 16384){throw 'IPC_LINE_TOO_LONG'}
        $outTask=$proc.StandardOutput.ReadAsync($stdoutChars,0,$stdoutChars.Length)
      }
    }
    if($outEof -and -not $proc.HasExited -and -not $final){throw 'IPC_CLOSED_BEFORE_FINAL'}
    if($proc.HasExited -and $outEof -and $errEof){break}
    Start-Sleep -Milliseconds 20
  }
  if($stdoutBuffer.Length -ne 0 -or -not $final -or $proc.ExitCode -ne 0){throw 'INCOMPLETE_OR_FAILED_EXIT'}
} catch {
  $reason=Safe-Reason $_
} finally {
  $killUsed=$false;$exitConfirmed=$false
  if($started){
    if(-not $proc.HasExited){try{$proc.Kill($true);$killUsed=$true}catch{$reason='STOP_NOT_CONFIRMED'}}
    try{$exitConfirmed=$proc.WaitForExit(3000)}catch{$reason='STOP_NOT_CONFIRMED'}
  }
  $clock.Stop()
  # Only the directly owned Process is confirmed. No PID name/delta is descendant evidence.
  $stopResult='STOP_NOT_CONFIRMED'
  $stopEvidence=@{runId=$runId;utc=[DateTime]::UtcNow.ToString('o');pid=$(if($started){$proc.Id}else{$null});started=$started;ownedProcessExitConfirmed=$exitConfirmed;killTreeRequested=$killUsed;confirmedDescendants=@();descendantCoverage='UNKNOWN';processStopResult=$stopResult;scope='Owned Process only; Kill(true) is an attempt, not descendant exit attestation';durationMs=$clock.ElapsedMilliseconds;exitCode=$(if($exitConfirmed){$proc.ExitCode}else{$null})}
  $stopSaved=$false;try{Save-Json 'process-stop.json' $stopEvidence;$stopSaved=$true}catch{$reason='STOP_EVIDENCE_NOT_SAVED'}
  $errorPublication='UNKNOWN'
  $markerPath=Join-Path $ev 'fatal.json'
  if($fatalPayload -or (Test-Path -LiteralPath $markerPath)){
    $errorPublication='EVIDENCE_MISSING'
    try{
      $notice=$fatalPayload
      $marker=$null
      if(Test-Path -LiteralPath $markerPath){
        $marker=Read-EvidenceJson 'fatal.json'
        Assert-Fields $marker @('runId','utc','code','errorPublication')
        Assert-Utc $marker.utc
        if($marker.runId -cne $runId -or ($notice -and ($notice.code -cne $marker.code -or $notice.errorPublication -cne $marker.errorPublication))){throw 'EVIDENCE_FATAL_MISMATCH'}
        $notice=$marker
      }
      if($notice.errorPublication -ceq 'PUBLISHED'){
        $failure=Read-EvidenceJson 'error.json'
        Assert-Fields $failure @('runId','utc','code','phase','error')
        Assert-Utc $failure.utc
        if($failure.runId -cne $runId -or $failure.code -cne $notice.code -or ($marker -and $failure.utc -cne $marker.utc)){throw 'EVIDENCE_FATAL_MISMATCH'}
        $errorPublication='PUBLISHED'
      }
    }catch{$errorPublication='EVIDENCE_MISSING'}
  }elseif($reason -or -not $final){
    # A deadline or lost IPC can leave no reliable indication of child-side publication.
    $errorPublication='UNKNOWN'
  }else{
    $errorPublication='NOT_REPORTED'
  }
  $after=@();$changes=@();$files=@();$hashVerified=$false;$evidenceVerified=$false;$inventoryComplete=$false;$inventoryStable=$false
  try{
    $after=@(Hash-Rows $protected)
    for($i=0;$i -lt $before.Count;$i++){if($before[$i].sha256 -ne $after[$i].sha256){$changes+=$before[$i].path}}
    $hashVerified=($before.Count -eq $after.Count -and $changes.Count -eq 0)
  }catch{$reason='POSTCHECK_NOT_CONFIRMED'}
  try{Save-Json 'protected-hashes.json' @{before=$before;after=$after;changed=$changes;verified=$hashVerified}}catch{$hashVerified=$false;$reason='HASH_EVIDENCE_NOT_SAVED'}
  try{
    # Independent persisted-evidence checks: final IPC alone never establishes completeness.
    if(-not $started -or -not $exitConfirmed -or -not $final -or $proc.ExitCode -ne 0 -or $stageIndex -ne $phaseOrder.Count -or -not $endpointSeen){throw 'EVIDENCE_INCOMPLETE'}
    if(Test-Path -LiteralPath (Join-Path $ev 'fatal.json')){throw 'EVIDENCE_FATAL_PRESENT'}
    if(Test-Path -LiteralPath (Join-Path $ev 'error.json')){throw 'EVIDENCE_ERROR_PRESENT'}
    $startedFile=Read-EvidenceJson '../started.json'
    Assert-Fields $startedFile @('runId','pid','utc');Assert-Utc $startedFile.utc
    if($startedFile.runId -cne $runId -or $startedFile.pid -ne $proc.Id){throw 'EVIDENCE_STARTED'}
    $savedEndpoint=Read-EvidenceJson 'endpoint.json';Assert-Fields $savedEndpoint @('protocol','host','port')
    if(($savedEndpoint|ConvertTo-Json -Compress) -cne ($endpoint|ConvertTo-Json -Compress)){throw 'EVIDENCE_ENDPOINT_MISMATCH'}
    $savedControl=@(Read-EvidenceLines 'control.ndjson')
    $savedStages=@(Read-EvidenceLines 'stages.ndjson');$expectedStages=@($frames|Where-Object {$_.kind -ceq 'stage'})
    if($savedControl.Count -ne $frames.Count -or @($savedControl|Where-Object {$_.kind -ceq 'final'}).Count -ne 1 -or $savedStages.Count -ne $phaseOrder.Count){throw 'EVIDENCE_EVENT_COUNT'}
    for($i=0;$i -lt $frames.Count;$i++){if(($savedControl[$i]|ConvertTo-Json -Depth 8 -Compress) -cne ($frames[$i]|ConvertTo-Json -Depth 8 -Compress)){throw 'EVIDENCE_CONTROL_MISMATCH'}}
    for($i=0;$i -lt $expectedStages.Count;$i++){if(($savedStages[$i]|ConvertTo-Json -Depth 8 -Compress) -cne ($expectedStages[$i]|ConvertTo-Json -Depth 8 -Compress)){throw 'EVIDENCE_STAGE_MISMATCH'}}
    $child=Read-EvidenceJson 'child-result.json'
    Assert-Fields $child @('schema','runId','utc','bindingAcquired','disposed','denied','sqlCalls','strictIsolationResult');Assert-Utc $child.utc
    if(($child.schema -isnot [int] -and $child.schema -isnot [long]) -or $child.schema -ne 1 -or $child.runId -cne $runId -or $child.bindingAcquired -isnot [bool] -or -not $child.bindingAcquired -or $child.disposed -isnot [bool] -or -not $child.disposed -or ($child.denied -isnot [int] -and $child.denied -isnot [long]) -or $child.denied -ne 0 -or ($child.sqlCalls -isnot [int] -and $child.sqlCalls -isnot [long]) -or $child.sqlCalls -ne 0 -or $child.strictIsolationResult -cne 'UNKNOWN_NOT_TESTED'){throw 'EVIDENCE_CHILD_RESULT'}
    if((Get-FileHash -LiteralPath (Join-Path $ev 'child-result.json')).Hash -ine $finalPayload.childResultSha256){throw 'EVIDENCE_CHILD_RESULT_HASH'}
    if(@(Read-EvidenceLines 'network-denials.ndjson').Count -ne 0){throw 'EVIDENCE_DENIAL_PRESENT'}
    foreach($entry in @(Read-EvidenceLines 'runtime-log.ndjson')){
      Assert-Fields $entry @('runId','utc','level','summary');Assert-Utc $entry.utc
      if($entry.runId -cne $runId -or ($entry.level -isnot [int] -and $entry.level -isnot [long]) -or $entry.level -lt 3 -or $entry.level -gt 5){throw 'EVIDENCE_RUNTIME_LOG'}
      if($entry.summary.event -ceq 'READY_LOOPBACK'){Assert-Fields $entry.summary @('event','port');if($entry.summary.port -ne [int]$endpoint.port){throw 'EVIDENCE_READY_PORT'}}
      elseif($entry.summary.event -ceq 'REDACTED_LOG'){Assert-Fields $entry.summary @('event')}
      else{throw 'EVIDENCE_RUNTIME_LOG_EVENT'}
    }
    $savedPreflight=Read-EvidenceJson 'preflight.json';$savedManifest=Read-EvidenceJson 'manifest.json'
    Assert-Fields $savedPreflight @('utc','cwd','root','rootWasAbsent','reparseChecks','reviewedHashes','sqlAllowed','executionMode','strictIsolation')
    Assert-Fields $savedManifest @('utc','nodeFile','arguments','environmentNames','protectedBefore','miniflare','workerd','cf','telemetry','host','port','compatibilityDate','binding','sqlCallsAllowed','networkCoverage')
    if($savedPreflight.cwd -cne $Workspace -or $savedPreflight.root -cne $RunRoot -or $savedPreflight.rootWasAbsent -ne $true -or $savedPreflight.reparseChecks -cne 'PASS' -or ($savedPreflight.reviewedHashes|ConvertTo-Json -Compress) -cne ($toolHashes|ConvertTo-Json -Compress) -or $savedPreflight.sqlAllowed -ne $false -or $savedPreflight.executionMode -cne 'LOCAL_FUNCTIONAL' -or $savedPreflight.strictIsolation -cne 'UNKNOWN_NOT_TESTED' -or $savedManifest.nodeFile -cne $NodePath -or $savedManifest.cf -ne $false -or $savedManifest.telemetry -ne $false -or $savedManifest.host -cne '127.0.0.1' -or $savedManifest.port -ne 0 -or $savedManifest.binding -cne 'P3_TEST' -or $savedManifest.sqlCallsAllowed -ne 0 -or $savedManifest.compatibilityDate -cne '2026-10-01' -or $savedManifest.miniflare -cne '5.20261006.1-alpha' -or $savedManifest.workerd -cne '1.20261006.1' -or ($savedManifest.protectedBefore|ConvertTo-Json -Depth 8 -Compress) -cne ($before|ConvertTo-Json -Depth 8 -Compress) -or ($savedManifest.arguments|ConvertTo-Json -Compress) -cne (@($start.ArgumentList)|ConvertTo-Json -Compress) -or $savedManifest.networkCoverage -cne 'LOCAL_HOOKS_ONLY_NOT_FULL_TREE_EGRESS'){throw 'EVIDENCE_CONFIG'}
    $savedHash=Read-EvidenceJson 'protected-hashes.json'
    if(-not $hashVerified -or -not $savedHash.verified -or @($savedHash.changed).Count -ne 0 -or ($savedHash.before|ConvertTo-Json -Depth 8 -Compress) -cne ($before|ConvertTo-Json -Depth 8 -Compress) -or ($savedHash.after|ConvertTo-Json -Depth 8 -Compress) -cne ($after|ConvertTo-Json -Depth 8 -Compress)){throw 'EVIDENCE_HASH'}
    $savedStop=Read-EvidenceJson 'process-stop.json'
    if(-not $stopSaved -or $savedStop.runId -cne $runId -or $savedStop.pid -ne $proc.Id -or $savedStop.ownedProcessExitConfirmed -ne $exitConfirmed -or $savedStop.killTreeRequested -ne $killUsed -or $savedStop.descendantCoverage -cne 'UNKNOWN' -or @($savedStop.confirmedDescendants).Count -ne 0 -or $savedStop.processStopResult -cne $stopResult){throw 'EVIDENCE_STOP'}
    $evidenceVerified=$true
  }catch{if($null -eq $reason){$reason='EVIDENCE_INCOMPLETE_OR_INCONSISTENT'}}
  try{$files=@(Inventory-Root $RunRoot);$inventoryComplete=$true;$inventoryStable=($stopResult -ceq 'STOP_CONFIRMED')}catch{$reason='INVENTORY_NOT_CONFIRMED'}
  # This revision has no trusted all-descendant attestation. Hence no overall PASS is possible.
  if($null -eq $reason -and $stopResult -cne 'STOP_CONFIRMED'){$reason=$stopResult}
  $pass=($null -eq $reason -and $evidenceVerified -and $hashVerified -and $inventoryComplete -and $inventoryStable -and $stopResult -ceq 'STOP_CONFIRMED' -and $errorPublication -ceq 'NOT_REPORTED')
  $environmentSummary.result=if($pass){'LOCAL_BINDING_DIAGNOSTIC_COMPLETE'}else{'BLOCKED'}
  try{
    Save-Json 'result.json' @{runId=$runId;finalStatus=$environmentSummary.result;environmentSummary=$environmentSummary;reason=$reason;errorPublication=$errorPublication;finalReceived=$final;bindingFunctionalResult=$(if($stageIndex -ge 7){'BINDING_ACQUIRED_OBSERVATION'}else{'NOT_CONFIRMED'});localPolicyResult=$(if($evidenceVerified){'EVIDENCE_CHECKS_PASSED_ONLY'}else{'NOT_CONFIRMED'});evidenceVerified=$evidenceVerified;hashVerified=$hashVerified;protectedChanges=$changes;sqlCallsObservedFromChildEvidence=$(if($evidenceVerified){0}else{$null});strictIsolationResult='UNKNOWN_NOT_TESTED';processStopResult=$stopResult;inventoryComplete=$inventoryComplete;inventoryStable=$inventoryStable;fileInventoryBeforeResult=$files;inventoryScope='Point-in-time list before result.json; excludes its own hash; not OS write isolation or stable snapshot if descendants unknown';utc=[DateTime]::UtcNow.ToString('o')}
    [void](Read-EvidenceJson 'result.json')
  }catch{$pass=$false;throw 'L3 BLOCKED: final evidence could not be saved/parsed'}
}
if(-not $pass){throw 'L3 BLOCKED; retain all evidence and stop. No retry authorized.'}
Write-Output 'LOCAL_BINDING_DIAGNOSTIC_COMPLETE; strict isolation UNKNOWN; no SQL; stop for review.'
