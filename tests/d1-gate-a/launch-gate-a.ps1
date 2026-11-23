# D1GA-20261119-001. Static preparation alone does not authorize invocation.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ExpectedLauncherSha256,
    [Parameter(Mandatory)][string]$ExpectedRunnerSha256,
    [Parameter(Mandatory)][string]$ExpectedSqlSha256,
    [Parameter(Mandatory)][string]$IsolationEvidencePath,
    [Parameter(Mandatory)][string]$ExpectedIsolationEvidenceSha256,
    [switch]$ExecutionAuthorized,
    [Parameter(Mandatory)][string]$ControlNonce,
    [Parameter(Mandatory)][long]$WatchStartTick,
    [Parameter(Mandatory)][string]$WatchCoverageThroughUtc
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ExecutionAuthorized) { throw 'A1_EXECUTION_NOT_AUTHORIZED' }
if ($PSVersionTable.PSVersion.Major -lt 7 -or -not [OperatingSystem]::IsWindows()) {
    throw 'BLOCKED_WINDOWS_POWERSHELL_REQUIRED'
}

$runId = 'D1GA-20261119-001'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$expectedWorkspace = 'D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog'
if ($workspace -ne $expectedWorkspace -or (Get-Location).ProviderPath -ne $workspace) {
    throw 'BLOCKED_WRONG_WORKSPACE'
}
$parent = Join-Path $workspace '.wrangler/d1-gate-a'
$root = Join-Path $parent $runId
$runner = Join-Path $PSScriptRoot 'gate-a.mjs'
$node = 'D:\Program Files\nodejs\node.exe'
$frequency = [Diagnostics.Stopwatch]::Frequency
$releaseDeadline = $WatchStartTick + 20 * $frequency
$workDeadline = $WatchStartTick + 95 * $frequency
$finishDeadline = $WatchStartTick + 110 * $frequency
if ($ControlNonce -cnotmatch '^[0-9a-f]{32}$' -or $WatchStartTick -le 0 -or
    [Diagnostics.Stopwatch]::GetTimestamp() -lt $WatchStartTick -or
    [Diagnostics.Stopwatch]::GetTimestamp() -ge $releaseDeadline) {
    throw 'BLOCKED_WATCH_CONTROL'
}

function Get-RemainingMilliseconds([long]$Deadline, [int]$Cap) {
    $remaining = $Deadline - [Diagnostics.Stopwatch]::GetTimestamp()
    return [int][Math]::Max(0, [Math]::Min($Cap, [Math]::Floor(1000.0 * $remaining / $frequency)))
}

function Assert-PlainPath([string]$Target) {
    for ($current = $Target; $current; $current = Split-Path $current -Parent) {
        if ((Test-Path -LiteralPath $current) -and
            ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'BLOCKED_REPARSE_POINT'
        }
    }
}

function Assert-FileHash([string]$File, [string]$Expected) {
    Assert-PlainPath $File
    if ($Expected -notmatch '^[a-fA-F0-9]{64}$' -or
        -not (Test-Path -LiteralPath $File -PathType Leaf) -or
        (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ne $Expected) {
        throw 'BLOCKED_FILE_HASH_MISMATCH'
    }
}

Assert-PlainPath $root
if (-not (Test-Path -LiteralPath (Join-Path $workspace '.wrangler') -PathType Container) -or
    ((Test-Path -LiteralPath $parent) -and -not (Test-Path -LiteralPath $parent -PathType Container)) -or
    (Test-Path -LiteralPath $root)) { throw 'BLOCKED_RUN_ROOT' }
Assert-FileHash $PSCommandPath $ExpectedLauncherSha256
Assert-FileHash $runner $ExpectedRunnerSha256
if ($ExpectedSqlSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'BLOCKED_SQL_HASH_REQUIRED' }
Assert-PlainPath $node
if ((Get-Item -LiteralPath $node).VersionInfo.FileVersion -notmatch '^24\.21\.0(?:\.|$)') {
    throw 'BLOCKED_NODE_VERSION'
}
foreach ($entry in @{ miniflare = '5.20261006.1-alpha'; workerd = '1.20261006.1' }.GetEnumerator()) {
    $metadata = Join-Path $workspace "node_modules/$($entry.Key)/package.json"
    Assert-PlainPath $metadata
    if ((Get-Content -LiteralPath $metadata -Raw | ConvertFrom-Json).version -ne $entry.Value) {
        throw 'BLOCKED_PACKAGE_VERSION'
    }
}
Assert-PlainPath (Join-Path $workspace 'node_modules/miniflare/dist/src/index.js')
$nativeRuntime = Join-Path $workspace 'node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe'
Assert-PlainPath $nativeRuntime
if (-not (Test-Path -LiteralPath $nativeRuntime -PathType Leaf)) { throw 'BLOCKED_WORKERD_MISSING' }

# This gate consumes A-1-reviewed host-control evidence. It does not create or infer firewall rules.
# The reviewer must separately verify the referenced enforcement and loopback evidence.
if (-not [IO.Path]::IsPathFullyQualified($IsolationEvidencePath)) { throw 'BLOCKED_ISOLATION_EVIDENCE_PATH' }
$isolationFile = [IO.Path]::GetFullPath($IsolationEvidencePath)
if (-not $isolationFile.EndsWith('.json', [StringComparison]::OrdinalIgnoreCase) -or
    $isolationFile.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BLOCKED_ISOLATION_EVIDENCE_PATH'
}
Assert-FileHash $isolationFile $ExpectedIsolationEvidenceSha256
if ((Get-Item -LiteralPath $isolationFile).Length -gt 16384) { throw 'BLOCKED_ISOLATION_EVIDENCE_SIZE' }
$isolationBytes = [IO.File]::ReadAllBytes($isolationFile)
if ($isolationBytes.Length -gt 16384 -or
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($isolationBytes)) -ne $ExpectedIsolationEvidenceSha256) {
    throw 'BLOCKED_ISOLATION_EVIDENCE_CHANGED'
}
$isolation = [Text.Encoding]::UTF8.GetString($isolationBytes) | ConvertFrom-Json -AsHashtable
$required = @('runId', 'computer', 'enforcedScope', 'externalEgress', 'loopback', 'validThroughUtc', 'controlReference')
if ($isolation.Count -ne $required.Count -or @($required | Where-Object { -not $isolation.Contains($_) }).Count -ne 0) {
    throw 'BLOCKED_ISOLATION_EVIDENCE_FIELDS'
}
$expires = [DateTimeOffset]::MinValue
$coverageThrough = [DateTimeOffset]::MinValue
if ($isolation.runId -cne $runId -or $isolation.computer -ne [Environment]::MachineName -or
    $isolation.enforcedScope -cne 'NODE_AND_DESCENDANTS' -or $isolation.externalEgress -cne 'DENIED' -or
    $isolation.loopback -cne 'ALLOWED' -or $isolation.controlReference -isnot [string] -or
    [string]::IsNullOrWhiteSpace($isolation.controlReference) -or
    -not [DateTimeOffset]::TryParse([string]$isolation.validThroughUtc, [ref]$expires) -or
    -not [DateTimeOffset]::TryParseExact($WatchCoverageThroughUtc, 'o',
        [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$coverageThrough) -or
    $expires -lt $coverageThrough -or
    $expires -lt [DateTimeOffset]::UtcNow.AddMilliseconds((Get-RemainingMilliseconds ($WatchStartTick + 120 * $frequency) 120000) + 30000)) {
    throw 'BLOCKED_ISOLATION_EVIDENCE_INVALID'
}

# The trusted Node entry waits for GO before importing Miniflare or creating descendants.
# Only after assignment to this private job may the supervisor release it.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public sealed class GateAJob : SafeHandleZeroOrMinusOneIsInvalid {
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits {
        public BasicLimits Basic;
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Accounting {
        public long User, Kernel, PeriodUser, PeriodKernel;
        public uint Faults, Total, Active, Terminated;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(GateAJob job, int type, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(GateAJob job, int type, out Accounting info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(GateAJob job, SafeProcessHandle process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsProcessInJob(SafeProcessHandle process, GateAJob job, out bool inJob);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(GateAJob job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int type);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    public static void ProtectControlHandles() {
        foreach (int type in new[] { -10, -11, -12 }) {
            IntPtr handle = GetStdHandle(type);
            if (handle == IntPtr.Zero || handle == new IntPtr(-1) || !SetHandleInformation(handle, 1, 0))
                throw new Win32Exception();
        }
    }

    public GateAJob() : base(true) {
        SetHandle(CreateJobObjectW(IntPtr.Zero, IntPtr.Zero));
        if (IsInvalid) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE, no breakaway flags.
        if (!SetInformationJobObject(this, 9, ref limits, (uint)Marshal.SizeOf<ExtendedLimits>())) {
            var error = new Win32Exception();
            Dispose();
            throw error;
        }
    }
    public bool Assign(SafeProcessHandle process) {
        if (!AssignProcessToJobObject(this, process)) throw new Win32Exception();
        if (!IsProcessInJob(process, this, out bool member)) throw new Win32Exception();
        return member;
    }
    public uint Active() {
        if (!QueryInformationJobObject(this, 1, out Accounting value, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero))
            throw new Win32Exception();
        return value.Active;
    }
    public void Terminate() {
        if (!TerminateJobObject(this, 1)) throw new Win32Exception();
    }
    protected override bool ReleaseHandle() { return CloseHandle(handle); }
}
'@
[GateAJob]::ProtectControlHandles()
if ((Get-RemainingMilliseconds $releaseDeadline 20000) -eq 0) { throw 'BLOCKED_PRE_GO_DEADLINE' }

function Send-WatchFrame($Frame) {
    [Console]::Out.WriteLine(($Frame | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}

function Save-Evidence([string]$Name, $Value) {
    $destination = Join-Path $evidence $Name
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Value | ConvertTo-Json -Depth 20))
    $stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

# All preconditions above precede workspace writes.
if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
    New-Item -ItemType Directory -Path $parent | Out-Null
}
New-Item -ItemType Directory -Path $root | Out-Null
foreach ($subdir in @('state', 'tmp', 'evidence')) {
    New-Item -ItemType Directory -Path (Join-Path $root $subdir) | Out-Null
}
$evidence = Join-Path $root 'evidence'
Save-Evidence 'preflight.json' @{
    runId = $runId; launcherSha256 = $ExpectedLauncherSha256; runnerSha256 = $ExpectedRunnerSha256
    sqlSha256 = $ExpectedSqlSha256; isolationEvidenceSha256 = $ExpectedIsolationEvidenceSha256
    isolationCheck = 'MATCHED_REVIEWED_HOST_ATTESTATION'; root = $root
    node = '24.21.0'; miniflare = '5.20261006.1-alpha'; workerd = '1.20261006.1'
}

$start = [Diagnostics.ProcessStartInfo]::new($node)
$start.WorkingDirectory = $root
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
foreach ($argument in @($runner, $workspace, $root, $ExpectedSqlSha256)) { $start.ArgumentList.Add($argument) }
$start.Environment.Clear()
foreach ($name in @('SystemRoot', 'WINDIR', 'SystemDrive', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($null -ne $value) { $start.Environment[$name] = $value }
}
$start.Environment['PATH'] = 'D:\Program Files\nodejs;' + (Join-Path $env:SystemRoot 'System32')
foreach ($name in @('TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME')) {
    $start.Environment[$name] = Join-Path $root 'tmp'
}
$start.Environment['CI'] = 'true'
$start.Environment['WRANGLER_SEND_METRICS'] = 'false'

$proc = [Diagnostics.Process]::new()
$proc.StartInfo = $start
$job = $null
$started = $false
$assigned = $false
$released = $false
$forced = $false
$stopConfirmed = $false
$active = $null
$out = $null
$err = $null
$reason = 'JOB_CREATE_FAILED'
try {
    $job = [GateAJob]::new()
    $reason = 'PROCESS_START_FAILED'
    if (-not $proc.Start()) { throw 'PROCESS_START_FAILED' }
    $started = $true
    $out = $proc.StandardOutput.ReadToEndAsync()
    $err = $proc.StandardError.ReadToEndAsync()
    $reason = 'JOB_ASSIGNMENT_NOT_CONFIRMED'
    $assigned = $job.Assign($proc.SafeHandle)
    if (-not $assigned -or $job.Active() -ne 1) { throw 'JOB_ASSIGNMENT_NOT_CONFIRMED' }
    $reason = 'GO_NOT_CONFIRMED'
    if ((Get-RemainingMilliseconds $releaseDeadline 20000) -eq 0) { throw 'PRE_GO_DEADLINE' }
    Send-WatchFrame @{
        protocolVersion = 1; runId = $runId; nonce = $ControlNonce; seq = 1; type = 'READY'
        job = $job.DangerousGetHandle().ToInt64(); node = $proc.SafeHandle.DangerousGetHandle().ToInt64()
    }
    # The outer job enforces the deadline even if the pipe read blocks.
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line.Length -gt 1024) { throw 'WATCH_RELEASE_INVALID' }
    $permit = $line | ConvertFrom-Json -AsHashtable
    $fields = @('protocolVersion', 'runId', 'nonce', 'seq', 'type', 'releaseDeadline')
    if ($null -eq $permit -or $permit.Count -ne $fields.Count -or
        @($fields | Where-Object { -not $permit.Contains($_) }).Count -ne 0 -or
        $permit.protocolVersion -cne 1 -or $permit.runId -cne $runId -or $permit.nonce -cne $ControlNonce -or
        $permit.seq -cne 2 -or $permit.type -cne 'RELEASE' -or $permit.releaseDeadline -cne $releaseDeadline -or
        $expires -lt $coverageThrough -or
        $expires -lt [DateTimeOffset]::UtcNow.AddMilliseconds((Get-RemainingMilliseconds ($WatchStartTick + 120 * $frequency) 120000) + 30000) -or
        (Get-RemainingMilliseconds $releaseDeadline 20000) -eq 0) { throw 'WATCH_RELEASE_INVALID' }
    $proc.StandardInput.WriteLine("GO $runId")
    $proc.StandardInput.Close()
    $released = $true
    Send-WatchFrame @{ protocolVersion = 1; runId = $runId; nonce = $ControlNonce; seq = 3; type = 'RELEASED' }
    $reason = 'PROCESS_DEADLINE'
    if (-not $proc.WaitForExit((Get-RemainingMilliseconds $workDeadline 75000))) { throw 'PROCESS_DEADLINE' }
    $reason = $null
} catch {
    # Keep only the closed phase reason; raw exceptions can contain private paths.
} finally {
    if ($started) {
        try {
            if ($assigned) {
                $active = $job.Active()
                if ($active -ne 0 -or -not $proc.HasExited) {
                    $forced = $true
                    $job.Terminate()
                }
                $stopDeadline = [Diagnostics.Stopwatch]::StartNew()
                do {
                    $active = $job.Active()
                    $stopConfirmed = $active -eq 0 -and $proc.HasExited
                    if (-not $stopConfirmed) { Start-Sleep -Milliseconds 50 }
                } while (-not $stopConfirmed -and $stopDeadline.ElapsedMilliseconds -lt 5000 -and
                    (Get-RemainingMilliseconds $finishDeadline 5000) -gt 0)
            } else {
                # GO has not been sent. Terminate only the directly owned pre-GO process.
                if (-not $proc.HasExited) { $forced = $true; $proc.Kill() }
                $stopConfirmed = $proc.WaitForExit((Get-RemainingMilliseconds $finishDeadline 5000))
            }
        } catch {
            $stopConfirmed = $false
        }
    }
    if ($null -ne $job) { $job.Dispose() }
}

# Raw streams are never persisted. A known, bounded delivery is needed for the final audit.
$streamsComplete = $false
$stdoutChars = $null
$stderrChars = $null
if ($null -ne $out -and $null -ne $err) {
    try {
        $streamsComplete = [Threading.Tasks.Task]::WaitAll(
            [Threading.Tasks.Task[]]@($out, $err), (Get-RemainingMilliseconds $finishDeadline 2000))
        if ($streamsComplete) {
            $stdoutChars = $out.GetAwaiter().GetResult().Length
            $stderrChars = $err.GetAwaiter().GetResult().Length
        }
    } catch { $streamsComplete = $false }
}
foreach ($item in @(@{ Name = 'stdout.log'; Count = $stdoutChars }, @{ Name = 'stderr.log'; Count = $stderrChars })) {
    [IO.File]::WriteAllText((Join-Path $evidence $item.Name), "Raw stream omitted. Observed characters: $($item.Count)")
}
Save-Evidence 'process-stop.json' @{
    started = $started; assigned = $assigned; released = $released; activeJobProcesses = $active
    forced = $forced; stopConfirmed = $stopConfirmed; streamsComplete = $streamsComplete
    coverage = $(if ($assigned) { 'JOB_MEMBERS_ONLY' } else { 'DIRECT_PRE_GO_ONLY' })
}

$status = 'BLOCKED'
$childReason = $null
$inventoryReason = $null
$childFile = Join-Path $evidence 'child-result.json'
try {
    if ($stopConfirmed -and (Test-Path -LiteralPath $childFile -PathType Leaf)) {
        Assert-PlainPath $childFile
        if ((Get-Item -LiteralPath $childFile).Length -gt 16384) { throw 'CHILD_EVIDENCE_OVERSIZE' }
        $child = Get-Content -LiteralPath $childFile -Raw | ConvertFrom-Json
        if ($child.runId -ne $runId -or $child.sqlSha256 -ne $ExpectedSqlSha256) { throw 'CHILD_EVIDENCE_MISMATCH' }
        $childReason = $child.reason
        if ($child.status -eq 'FAIL') { $status = 'FAIL' }
        if ($null -eq $reason -and $assigned -and $released -and -not $forced -and $streamsComplete -and
            $stdoutChars -eq 0 -and $stderrChars -eq 0 -and $proc.ExitCode -eq 0 -and
            $child.status -eq 'PASS' -and $child.completedCases -eq 5 -and $child.disposed -eq $true) {
            $status = 'PASS'
        }
    }
} catch { if ($null -eq $reason) { $reason = 'CHILD_EVIDENCE_INVALID' } }
if ($status -eq 'BLOCKED' -and $null -eq $reason) {
    $reason = if (-not $stopConfirmed) { 'STOP_NOT_CONFIRMED' }
        elseif (-not $streamsComplete) { 'STREAMS_NOT_CONFIRMED' }
        elseif ($stdoutChars -ne 0 -or $stderrChars -ne 0) { 'UNEXPECTED_CHILD_OUTPUT' }
        elseif ($null -eq $childReason) { 'CHILD_EVIDENCE_MISSING' }
        else { 'CHILD_RUN_BLOCKED' }
}
$proc.Dispose()

function Read-RunInventory([string]$Directory) {
    foreach ($item in Get-ChildItem -LiteralPath $Directory -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'INVENTORY_REPARSE_POINT' }
        if ($item.PSIsContainer) {
            Read-RunInventory $item.FullName
        } else {
            @{
                path = [IO.Path]::GetRelativePath($root, $item.FullName)
                bytes = $item.Length
                sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
            }
        }
    }
}

try {
    Save-Evidence 'file-inventory.json' @{
        scope = 'Point-in-time inventory before file-inventory.json and result.json'
        stable = $stopConfirmed
        files = @(Read-RunInventory $root)
    }
} catch {
    if ($status -ne 'FAIL') { $status = 'BLOCKED' }
    $inventoryReason = 'INVENTORY_UNAVAILABLE'
    if ($null -eq $reason) { $reason = $inventoryReason }
}
Save-Evidence 'result.json' @{
    runId = $runId; status = $status; reason = $reason; childReason = $childReason; inventoryReason = $inventoryReason
    processStopResult = $(if ($stopConfirmed) { 'STOP_CONFIRMED' } else { 'STOP_NOT_CONFIRMED' })
    authority = 'LAUNCHER_OBSERVATION_ONLY'
}
if ($status -ne 'PASS') { throw "GATE_A_$status" }
