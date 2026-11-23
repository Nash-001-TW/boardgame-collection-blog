# D1GA-20261119-001. Invocation requires separate A-1 authorization.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ExpectedWatchSha256,
    [Parameter(Mandatory)][string]$ExpectedLauncherSha256,
    [Parameter(Mandatory)][string]$ExpectedRunnerSha256,
    [Parameter(Mandatory)][string]$ExpectedSqlSha256,
    [Parameter(Mandatory)][string]$IsolationEvidencePath,
    [Parameter(Mandatory)][string]$ExpectedIsolationEvidenceSha256,
    [switch]$ExecutionAuthorized
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $ExecutionAuthorized) { throw 'A1_EXECUTION_NOT_AUTHORIZED' }
if ($PSVersionTable.PSVersion.Major -lt 7 -or -not [OperatingSystem]::IsWindows()) {
    throw 'BLOCKED_WINDOWS_POWERSHELL_REQUIRED'
}
$runId = 'D1GA-20261119-001'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if ($workspace -ne 'D:\WebProject\2026-0923 - TableGameInformation\boardgamecollection-blog' -or
    (Get-Location).ProviderPath -ne $workspace) { throw 'BLOCKED_WRONG_WORKSPACE' }
$watchResult = Join-Path $workspace ".wrangler/$runId-watch-result.json"
$watchTemporary = "$watchResult.tmp"
$root = Join-Path $workspace ".wrangler/d1-gate-a/$runId"
$launcher = Join-Path $PSScriptRoot 'launch-gate-a.ps1'
$pwsh = Join-Path $PSHOME 'pwsh.exe'

function Assert-PlainPath([string]$Target) {
    for ($current = $Target; $current; $current = Split-Path $current -Parent) {
        if ((Test-Path -LiteralPath $current) -and
            ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'BLOCKED_REPARSE_POINT'
        }
    }
}
function Assert-Hash([string]$Path, [string]$Expected) {
    Assert-PlainPath $Path
    if ($Expected -notmatch '^[a-fA-F0-9]{64}$' -or
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Expected) { throw 'BLOCKED_HASH_MISMATCH' }
}
Assert-PlainPath $root
Assert-PlainPath $watchResult
Assert-PlainPath $watchTemporary
Assert-PlainPath $pwsh
if ((Test-Path -LiteralPath $root) -or (Test-Path -LiteralPath $watchResult) -or (Test-Path -LiteralPath $watchTemporary) -or
    -not (Test-Path -LiteralPath (Join-Path $workspace '.wrangler') -PathType Container)) { throw 'BLOCKED_RUN_PATH' }
Assert-Hash $PSCommandPath $ExpectedWatchSha256
Assert-Hash $launcher $ExpectedLauncherSha256
Assert-Hash (Join-Path $PSScriptRoot 'gate-a.mjs') $ExpectedRunnerSha256
if ($ExpectedSqlSha256 -notmatch '^[a-fA-F0-9]{64}$' -or
    -not [IO.Path]::IsPathFullyQualified($IsolationEvidencePath) -or
    $ExpectedIsolationEvidenceSha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'BLOCKED_ARGUMENTS' }

# Load the outer watchdog before T+0. The launcher, including its Add-Type, is timed.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

public sealed class GateAWatch {
    [StructLayout(LayoutKind.Sequential)]
    private struct Security { public int Size; public IntPtr Descriptor; public int Inherit; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Startup {
        public int Size;
        public IntPtr Reserved, Desktop, Title;
        public int X, Y, Width, Height, XChars, YChars, Fill, Flags;
        public short Show, ReservedLength;
        public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct StartupEx { public Startup Startup; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Created { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Basic {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Extended {
        public Basic Basic;
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Accounting {
        public long User, Kernel, PeriodUser, PeriodKernel;
        public uint Faults, Total, Active, Terminated;
    }

    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetInformationJobObject(IntPtr job, int type, ref Extended info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting info, uint length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref Security security, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref UIntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value,
        UIntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
    private static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd,
        ref StartupEx startup, out Created created);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
        out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind,
        out AttributeTag info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind, IntPtr info, uint size);
    [StructLayout(LayoutKind.Sequential)]
    private struct AttributeTag { public uint Attributes, Tag; }

    private IntPtr outer, launcher, inner, node;
    private FileStream input, output;
    private Thread watchdog, hardStop;
    private readonly ManualResetEventSlim done = new ManualResetEventSlim();
    private readonly ManualResetEventSlim returned = new ManualResetEventSlim();
    private readonly object decision = new object();
    private enum ReleaseState { Pending, Scheduled, Sending, Confirmed, Expired }
    private ReleaseState release;
    private int sendStarted, workComplete, timedStage, outerStopRequested;
    private readonly List<Task> controlTasks = new List<Task>(); // Owned by the coordinator.
    private bool closing;
    private int terminationError;
    private readonly long start;
    public int TimedStage => Volatile.Read(ref timedStage);
    public int TerminationError => Volatile.Read(ref terminationError);
    public bool ReleaseStarted => Volatile.Read(ref sendStarted) != 0;
    public bool OuterStopRequested => Volatile.Read(ref outerStopRequested) != 0;

    public GateAWatch(long startTick) {
        start = startTick;
        hardStop = new Thread(() => {
            while (Elapsed < 120000) {
                int remaining = (int)Math.Max(0, Math.Ceiling(120000 - Elapsed));
                if (returned.Wait(remaining)) return;
            }
            // Only this dedicated watchdog process is terminated. The private Job handle is the OS backstop.
            TerminateProcess(GetCurrentProcess(), 124);
        }) { IsBackground = true };
        hardStop.Start();
    }
    private static void Require(bool ok) { if (!ok) throw new Win32Exception(); }
    private static void Close(ref IntPtr handle) {
        if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; }
    }
    private static void CloseOwned(ref IntPtr handle) {
        if (handle == IntPtr.Zero) return;
        Require(CloseHandle(handle));
        handle = IntPtr.Zero;
    }
    private double Elapsed => (Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency;
    private static string Quote(string argument) {
        var quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in argument) {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') quoted.Append('\\', slashes * 2 + 1);
            else quoted.Append('\\', slashes);
            quoted.Append(ch);
            slashes = 0;
        }
        return quoted.Append('\\', slashes * 2).Append('"').ToString();
    }

    public void Start(string exe, string[] argv, string cwd) {
        outer = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
        Require(outer != IntPtr.Zero);
        var limits = new Extended();
        limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE; no breakaway.
        Require(SetInformationJobObject(outer, 9, ref limits, (uint)Marshal.SizeOf<Extended>()));
        watchdog = new Thread(WatchDeadlines) { IsBackground = true };
        watchdog.Start();

        IntPtr fromOuter = IntPtr.Zero, outerWrite = IntPtr.Zero;
        IntPtr outerRead = IntPtr.Zero, toOuter = IntPtr.Zero;
        IntPtr list = IntPtr.Zero, inherited = IntPtr.Zero, thread = IntPtr.Zero;
        bool listReady = false, assigned = false;
        try {
            var security = new Security { Size = Marshal.SizeOf<Security>(), Inherit = 1 };
            Require(CreatePipe(out fromOuter, out outerWrite, ref security, 0));
            Require(CreatePipe(out outerRead, out toOuter, ref security, 0));
            Require(SetHandleInformation(outerWrite, 1, 0));
            Require(SetHandleInformation(outerRead, 1, 0));
            UIntPtr size = UIntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            if (size == UIntPtr.Zero) throw new Win32Exception();
            list = Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
            Require(InitializeProcThreadAttributeList(list, 1, 0, ref size));
            listReady = true;
            inherited = Marshal.AllocHGlobal(2 * IntPtr.Size);
            Marshal.WriteIntPtr(inherited, 0, fromOuter);
            Marshal.WriteIntPtr(inherited, IntPtr.Size, toOuter);
            Require(UpdateProcThreadAttribute(list, 0, new IntPtr(0x00020002), inherited,
                new UIntPtr((uint)(2 * IntPtr.Size)), IntPtr.Zero, IntPtr.Zero));
            var startup = new StartupEx();
            startup.Startup.Size = Marshal.SizeOf<StartupEx>();
            startup.Startup.Flags = 0x100; // STARTF_USESTDHANDLES.
            startup.Startup.Input = fromOuter;
            startup.Startup.Output = toOuter;
            startup.Startup.Error = toOuter; // Unstructured launcher errors fail the control protocol.
            startup.Attributes = list;
            var commandLine = new StringBuilder(Quote(exe));
            foreach (string argument in argv) commandLine.Append(' ').Append(Quote(argument));
            if (Elapsed >= 20000 || TimedStage != 0) throw new TimeoutException();
            Require(CreateProcessW(exe, commandLine, IntPtr.Zero, IntPtr.Zero, true,
                0x08080004, IntPtr.Zero, cwd, ref startup, out Created created)); // NO_WINDOW, EXTENDED, SUSPENDED.
            launcher = created.Process;
            thread = created.Thread;
            Close(ref fromOuter);
            Close(ref toOuter);
            if (Elapsed >= 20000 || TimedStage != 0) throw new TimeoutException();
            Require(AssignProcessToJobObject(outer, launcher));
            assigned = true;
            if (!Member(launcher, outer) || Active(outer) != 1) throw new InvalidOperationException();
            input = new FileStream(new SafeFileHandle(outerWrite, true), FileAccess.Write, 256, false);
            outerWrite = IntPtr.Zero;
            output = new FileStream(new SafeFileHandle(outerRead, true), FileAccess.Read, 256, false);
            outerRead = IntPtr.Zero;
            if (Elapsed >= 20000 || TimedStage != 0) throw new TimeoutException();
            Require(ResumeThread(thread) == 1);
        } catch {
            if (launcher != IntPtr.Zero && !assigned) {
                if (!TerminateProcess(launcher, 1)) terminationError = Marshal.GetLastWin32Error();
            } else if (launcher != IntPtr.Zero) StopOuter();
            throw;
        } finally {
            Close(ref fromOuter); Close(ref outerWrite); Close(ref outerRead); Close(ref toOuter); Close(ref thread);
            if (listReady) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (inherited != IntPtr.Zero) Marshal.FreeHGlobal(inherited);
        }
    }

    public void AcceptHandles(long jobValue, long processValue) {
        if (Elapsed >= 20000 || TimedStage != 0 || inner != IntPtr.Zero || node != IntPtr.Zero)
            throw new InvalidOperationException();
        IntPtr current = GetCurrentProcess();
        IntPtr newJob = IntPtr.Zero, newNode = IntPtr.Zero;
        try {
            Require(DuplicateHandle(launcher, new IntPtr(jobValue), current, out newJob, 0x000c, false, 0));
            Require(DuplicateHandle(launcher, new IntPtr(processValue), current, out newNode, 0x101000, false, 0));
            if (!Member(launcher, outer) || Member(launcher, newJob) ||
                !Member(newNode, outer) || !Member(newNode, newJob) ||
                Exited(newNode) || Active(newJob) != 1)
                throw new InvalidOperationException();
            node = newNode;
            newNode = IntPtr.Zero;
            Interlocked.Exchange(ref inner, newJob);
            newJob = IntPtr.Zero;
        } finally { Close(ref newJob); Close(ref newNode); }
    }

    private Task<T> QueueControl<T>(Func<T> operation) {
        if (closing) throw new InvalidOperationException();
        Task<T> task = Task.Run(operation);
        controlTasks.Add(task);
        return task;
    }
    public Task<string> ReadFrame() => QueueControl<string>(() => {
        using (var bytes = new MemoryStream()) {
            while (bytes.Length <= 1024) {
                int value = output.ReadByte();
                if (value == -1) {
                    if (bytes.Length == 0) return null;
                    throw new InvalidDataException();
                }
                if (value == 10) return new UTF8Encoding(false, true).GetString(bytes.ToArray()).TrimEnd('\r');
                if (bytes.Length == 1024) throw new InvalidDataException();
                bytes.WriteByte((byte)value);
            }
        }
        throw new InvalidDataException();
    });
    public Task SendRelease(string frame) {
        lock (decision) {
            if (closing || release != ReleaseState.Pending || TimedStage != 0 || OuterStopRequested || Elapsed >= 20000)
                throw new TimeoutException();
            release = ReleaseState.Scheduled;
        }
        return QueueControl(() => {
            byte[] bytes = Encoding.UTF8.GetBytes(frame + "\n");
            lock (decision) {
                if (release != ReleaseState.Scheduled || TimedStage != 0 || OuterStopRequested || Elapsed >= 20000)
                    throw new TimeoutException();
                release = ReleaseState.Sending;
                Volatile.Write(ref sendStarted, 1);
            }
            input.Write(bytes, 0, bytes.Length);
            input.Flush();
            input.Dispose(); // Exactly one release and then EOF.
            return true;
        });
    }
    public bool ConfirmRelease() {
        lock (decision) {
            if (release != ReleaseState.Sending || Elapsed >= 20000 || TimedStage != 0 || OuterStopRequested)
                return false;
            release = ReleaseState.Confirmed;
            return true;
        }
    }
    public bool ObserveWorkComplete() {
        if (Elapsed >= 95000 || TimedStage != 0 || node == IntPtr.Zero) return false;
        bool observed = Exited(node) && Active(inner) == 0;
        lock (decision) {
            if (!observed || Elapsed >= 95000 || TimedStage != 0) return false;
            workComplete = 1;
            return true;
        }
    }
    public bool LauncherExited() => Exited(launcher);
    public bool OuterStopped() => Active(outer) == 0 && Exited(launcher);
    public uint LauncherExitCode() {
        Require(GetExitCodeProcess(launcher, out uint code));
        return code;
    }
    public void StopOuter() {
        lock (decision) { Volatile.Write(ref outerStopRequested, 1); }
        StopJob(outer);
    }
    private void StopJob(IntPtr job) {
        if (job != IntPtr.Zero && !TerminateJobObject(job, 1))
            Interlocked.CompareExchange(ref terminationError, Marshal.GetLastWin32Error(), 0);
    }
    private void WatchDeadlines() {
        bool did20 = false, did95 = false;
        while (!done.Wait(5)) {
            double elapsed = Elapsed;
            if (!did20 && elapsed >= 20000) {
                did20 = true;
                bool stop = false;
                lock (decision) {
                    if (release != ReleaseState.Confirmed) {
                        release = ReleaseState.Expired;
                        Interlocked.CompareExchange(ref timedStage, 20, 0);
                        Volatile.Write(ref outerStopRequested, 1);
                        stop = true;
                    }
                }
                if (stop) StopJob(outer);
            }
            if (!did95 && elapsed >= 95000) {
                did95 = true;
                bool stop = false;
                lock (decision) {
                    if (workComplete == 0 && TimedStage == 0) {
                        Interlocked.CompareExchange(ref timedStage, 95, 0);
                        stop = true;
                    }
                }
                if (stop) {
                    IntPtr job = Interlocked.CompareExchange(ref inner, IntPtr.Zero, IntPtr.Zero);
                    if (job != IntPtr.Zero) {
                        StopJob(job);
                        if (TerminationError != 0) StopOuter();
                    } else StopOuter();
                }
            }
            if (elapsed >= 110000) {
                Interlocked.CompareExchange(ref timedStage, 110, 0);
                StopOuter();
                return;
            }
        }
    }
    private static bool Member(IntPtr process, IntPtr job) {
        Require(IsProcessInJob(process, job, out bool member));
        return member;
    }
    private static uint Active(IntPtr job) {
        Require(job != IntPtr.Zero);
        Require(QueryInformationJobObject(job, 1, out Accounting value, (uint)Marshal.SizeOf<Accounting>(), IntPtr.Zero));
        return value.Active;
    }
    private static bool Exited(IntPtr handle) {
        if (handle == IntPtr.Zero) return false;
        uint result = WaitForSingleObject(handle, 0);
        if (result == 0) return true;
        if (result == 258) return false;
        throw new Win32Exception();
    }
    public static Task<string> ReadEvidence(string path, int maxBytes) => Task.Run(() => {
        // Reject reparse points on the evidence path before reading.
        for (string current = path; !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new IOException();
        }
        using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        using (var bytes = new MemoryStream()) {
            var buffer = new byte[4096];
            int count;
            while ((count = stream.Read(buffer, 0, buffer.Length)) != 0) {
                if (bytes.Length + count > maxBytes) throw new InvalidDataException();
                bytes.Write(buffer, 0, count);
            }
            return new UTF8Encoding(false, true).GetString(bytes.ToArray());
        }
    });
    private static void PinParents(string directory, List<SafeFileHandle> pins) {
        string parent = Path.GetDirectoryName(directory);
        if (parent != null) PinParents(parent, pins);
        // Read attributes, share read only, open the directory itself even if it is a reparse point.
        SafeFileHandle pin = CreateFileW(directory, 0x80, 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        pins.Add(pin);
        Require(!pin.IsInvalid);
        Require(GetFileInformationByHandleEx(pin, 9, out AttributeTag info, (uint)Marshal.SizeOf<AttributeTag>()));
        if ((info.Attributes & 0x410) != 0x10) throw new IOException();
    }
    private static void PublishNew(SafeFileHandle staged, string destination) {
        byte[] name = Encoding.Unicode.GetBytes(destination);
        // FILE_RENAME_INFO: zero ReplaceIfExists and RootDirectory, followed by byte length and UTF-16 name.
        int lengthOffset = 2 * IntPtr.Size;
        int nameOffset = lengthOffset + sizeof(uint);
        byte[] info = new byte[nameOffset + name.Length + sizeof(char)];
        Buffer.BlockCopy(BitConverter.GetBytes(name.Length), 0, info, lengthOffset, sizeof(uint));
        Buffer.BlockCopy(name, 0, info, nameOffset, name.Length);
        GCHandle buffer = GCHandle.Alloc(info, GCHandleType.Pinned);
        try { Require(SetFileInformationByHandle(staged, 3, buffer.AddrOfPinnedObject(), (uint)info.Length)); }
        finally { buffer.Free(); }
    }
    public Task WriteEvidence(string path, string temporary, string json) => Task.Run(() => {
        var pins = new List<SafeFileHandle>();
        try {
            var drive = new DriveInfo(Path.GetPathRoot(path));
            if (drive.DriveType != DriveType.Fixed || !String.Equals(drive.DriveFormat, "NTFS", StringComparison.OrdinalIgnoreCase) ||
                !String.Equals(Path.GetDirectoryName(path), Path.GetDirectoryName(temporary), StringComparison.OrdinalIgnoreCase))
                throw new IOException();
            PinParents(Path.GetDirectoryName(path), pins);
            if (File.Exists(path) || Directory.Exists(path)) throw new IOException();
            if (Elapsed >= 120000) throw new TimeoutException();
            // CREATE_NEW, GENERIC_WRITE | DELETE, exclusive access. Retain the original file identity for rename.
            using (SafeFileHandle staged = CreateFileW(temporary, 0x40010000, 0, IntPtr.Zero, 1, 0x80, IntPtr.Zero)) {
                Require(!staged.IsInvalid);
                IntPtr current = GetCurrentProcess();
                Require(DuplicateHandle(current, staged.DangerousGetHandle(), current, out IntPtr writer, 0, false, 2));
                using (var writerHandle = new SafeFileHandle(writer, true))
                using (var stream = new FileStream(writerHandle, FileAccess.Write)) {
                    byte[] bytes = Encoding.UTF8.GetBytes(json);
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (Elapsed >= 120000) throw new TimeoutException();
                PublishNew(staged, path);
            }
        } finally {
            for (int i = pins.Count - 1; i >= 0; i--) pins[i].Dispose();
        }
    });
    public bool ReturnToCaller() {
        if (Elapsed >= 120000) return false;
        returned.Set();
        return true;
    }
    public void AwaitHardStop() { Thread.Sleep(Timeout.Infinite); }
    private int CleanupBudget => (int)Math.Max(0, Math.Min(250, Math.Floor(120000 - Elapsed)));
    public bool CloseOwnedResources() {
        if (!OuterStopped()) return false;
        closing = true;
        foreach (Task task in controlTasks) {
            try { if (!task.Wait(CleanupBudget)) return false; }
            catch (AggregateException) { } // A faulted control task has stopped using the pipe.
        }
        done.Set();
        if (watchdog != null && !watchdog.Join(CleanupBudget)) return false;
        input?.Dispose();
        output?.Dispose();
        CloseOwned(ref node); CloseOwned(ref inner); CloseOwned(ref launcher); CloseOwned(ref outer);
        return true;
    }
}
'@

$frequency = [Diagnostics.Stopwatch]::Frequency
$nonce = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(16)).ToLowerInvariant()
$t0Utc = [DateTimeOffset]::UtcNow
$t0 = [Diagnostics.Stopwatch]::GetTimestamp()
$releaseDeadline = $t0 + 20 * $frequency
$workDeadline = $t0 + 95 * $frequency
$finishDeadline = $t0 + 110 * $frequency
$endDeadline = $t0 + 120 * $frequency
# Reserve a best-effort evidence window without moving the hard cutoff.
$stopObservationDeadline = $endDeadline - 2 * $frequency

function Get-Remaining([long]$Deadline) {
    [int][Math]::Max(0, [Math]::Floor(1000.0 * ($Deadline - [Diagnostics.Stopwatch]::GetTimestamp()) / $frequency))
}
function Read-WatchFrame($Task, [string]$Type, [int]$Sequence, [string[]]$Extra) {
    if (-not $Task.Wait((Get-Remaining $releaseDeadline))) { throw 'CONTROL_DEADLINE' }
    $text = $Task.GetAwaiter().GetResult()
    if ($null -eq $text -or (Get-Remaining $releaseDeadline) -eq 0) { throw 'CONTROL_INCOMPLETE' }
    $frame = $text | ConvertFrom-Json -AsHashtable
    $fields = @('protocolVersion', 'runId', 'nonce', 'seq', 'type') + $Extra
    if ($null -eq $frame -or $frame.Count -ne $fields.Count -or
        @($fields | Where-Object { -not $frame.Contains($_) }).Count -ne 0 -or
        $frame.protocolVersion -cne 1 -or $frame.runId -cne $runId -or $frame.nonce -cne $nonce -or
        $frame.seq -cne $Sequence -or $frame.type -cne $Type) { throw 'CONTROL_FRAME_INVALID' }
    return $frame
}

$watch = [GateAWatch]::new($t0)
$releaseConfirmed = $false
$workComplete = $false
$outerStopped = $false
$controlClosed = $false
$extraFrame = $null
$reason = 'LAUNCHER_SETUP_UNCONFIRMED'
$confirmedOutcome = 'UNKNOWN'
$status = 'BLOCKED'
$timedStage = 0
$terminationError = 0
$cleanupComplete = $false
$write = $null
try {
    $arguments = @('-NoProfile', '-NonInteractive', '-File', $launcher,
        '-ExpectedLauncherSha256', $ExpectedLauncherSha256, '-ExpectedRunnerSha256', $ExpectedRunnerSha256,
        '-ExpectedSqlSha256', $ExpectedSqlSha256, '-IsolationEvidencePath', $IsolationEvidencePath,
        '-ExpectedIsolationEvidenceSha256', $ExpectedIsolationEvidenceSha256, '-ExecutionAuthorized',
        '-ControlNonce', $nonce, '-WatchStartTick', [string]$t0,
        '-WatchCoverageThroughUtc', $t0Utc.AddSeconds(150).ToString('o'))
    $watch.Start($pwsh, [string[]]$arguments, $workspace)
    $reason = 'READY_UNCONFIRMED'
    $ready = Read-WatchFrame ($watch.ReadFrame()) 'READY' 1 @('job', 'node')
    if (($ready.job -isnot [long] -and $ready.job -isnot [int]) -or
        ($ready.node -isnot [long] -and $ready.node -isnot [int]) -or
        $ready.job -le 0 -or $ready.node -le 0 -or $ready.job -eq $ready.node) { throw 'HANDLE_VALUES_INVALID' }
    $reason = 'HANDLE_HANDOFF_UNCONFIRMED'
    $watch.AcceptHandles($ready.job, $ready.node)
    $reason = 'RELEASE_NOT_STARTED'
    $send = $watch.SendRelease((@{
        protocolVersion = 1; runId = $runId; nonce = $nonce; seq = 2; type = 'RELEASE'; releaseDeadline = $releaseDeadline
    } | ConvertTo-Json -Compress))
    $reason = 'RELEASE_OUTCOME_UNKNOWN'
    if (-not $send.Wait((Get-Remaining $releaseDeadline))) { throw 'RELEASE_DEADLINE' }
    $send.GetAwaiter().GetResult()
    $null = Read-WatchFrame ($watch.ReadFrame()) 'RELEASED' 3 @()
    $releaseConfirmed = $watch.ConfirmRelease()
    if (-not $releaseConfirmed) { throw 'RELEASE_DEADLINE' }
    $extraFrame = $watch.ReadFrame()
    $reason = 'WORK_COMPLETION_NOT_CONFIRMED'
    while ((Get-Remaining $workDeadline) -gt 0 -and $watch.TimedStage -eq 0) {
        if ($extraFrame.IsCompleted) {
            $controlClosed = $null -eq $extraFrame.GetAwaiter().GetResult()
            if (-not $controlClosed -or -not $watch.LauncherExited()) {
                $reason = 'CONTROL_PROTOCOL_INTERRUPTED'
                throw 'CONTROL_PROTOCOL_INTERRUPTED'
            }
        }
        if ($watch.ObserveWorkComplete()) { $workComplete = $true; break }
        Start-Sleep -Milliseconds 10
    }
    # If T+95 won, leave the launcher its bounded evidence window. The independent clock
    # terminates the inner job even when the PowerShell control loop is waiting.
    if ($workComplete) { $reason = 'EVIDENCE_OR_EXIT_NOT_CONFIRMED' }
    while ((Get-Remaining $finishDeadline) -gt 0 -and -not $watch.OuterStopped()) {
        if ($extraFrame.IsCompleted -and -not $controlClosed) {
            $controlClosed = $null -eq $extraFrame.GetAwaiter().GetResult()
            if (-not $controlClosed -or -not $watch.LauncherExited()) {
                $reason = 'CONTROL_PROTOCOL_INTERRUPTED'
                throw 'CONTROL_PROTOCOL_INTERRUPTED'
            }
        }
        Start-Sleep -Milliseconds 10
    }
    if ((Get-Remaining $finishDeadline) -gt 0 -and $watch.OuterStopped()) {
        $outerStopped = $true
        if ($extraFrame.Wait((Get-Remaining $finishDeadline))) {
            $controlClosed = $null -eq $extraFrame.GetAwaiter().GetResult()
        }
        if ($workComplete -and $controlClosed -and $watch.TimedStage -eq 0 -and $watch.LauncherExitCode() -eq 0) {
            $reason = $null
        }
    }
} catch {
    # Phase codes are closed; exception messages and control payloads are not persisted.
    if ($reason -eq 'RELEASE_OUTCOME_UNKNOWN' -and -not $watch.ReleaseStarted) { $reason = 'RELEASE_NOT_STARTED' }
} finally {
    if (-not $outerStopped) {
        $watch.StopOuter()
        try {
            while ((Get-Remaining $stopObservationDeadline) -gt 0) {
                if ($watch.OuterStopped()) { $outerStopped = $true; break }
                Start-Sleep -Milliseconds 20
            }
        } catch { $outerStopped = $false }
    }
    $timedStage = $watch.TimedStage
    $terminationError = $watch.TerminationError
}

# Read bounded, structured evidence only. A known violation must survive a later timeout.
$failureReasons = @('NEGATIVE_CASE_CHANGED_STATE', 'NEGATIVE_CASE_BATCH_SUCCEEDED',
    'UNEXPECTED_COMMITTED_STATE', 'SUCCESS_CONTROL_INVARIANT_FAILED')
try {
    if ($watch.ReleaseStarted -and (Get-Remaining $endDeadline) -gt 0) {
        $childTask = [GateAWatch]::ReadEvidence((Join-Path $root 'evidence/child-result.json'), 16384)
        $caseTask = [GateAWatch]::ReadEvidence((Join-Path $root 'evidence/cases.ndjson'), 262144)
        $launcherTask = [GateAWatch]::ReadEvidence((Join-Path $root 'evidence/result.json'), 16384)
        $child = $null
        $report = $null
        $caseOrder = @()
        $casesComplete = $false
        try {
            if ($childTask.Wait([Math]::Min(300, (Get-Remaining $endDeadline)))) {
                $child = $childTask.GetAwaiter().GetResult() | ConvertFrom-Json
            }
        } catch { $child = $null }
        if ($null -ne $child -and $child.runId -ceq $runId -and $child.sqlSha256 -eq $ExpectedSqlSha256 -and
            $child.status -ceq 'FAIL' -and $child.reason -cin $failureReasons) { $status = 'FAIL' }
        try {
            if ($caseTask.Wait([Math]::Min(300, (Get-Remaining $endDeadline)))) {
                foreach ($line in ($caseTask.GetAwaiter().GetResult() -split "\r?\n")) {
                    if (-not $line) { continue }
                    try {
                        $row = $line | ConvertFrom-Json
                        $caseOrder += "$($row.op):$($row.status)"
                        if ($row.op -cmatch '^A[1-5]$' -and $row.status -ceq 'FAIL' -and
                            $row.reason -cin $failureReasons) { $status = 'FAIL'; break }
                    } catch { $caseOrder += 'INVALID'; continue }
                }
                $casesComplete = ($caseOrder -join ',') -ceq 'A1:PASS,A2:PASS,A3:PASS,A4:PASS,A5:PASS'
            }
        } catch { }
        if ($status -ne 'FAIL' -and $casesComplete -and $releaseConfirmed -and $null -eq $reason -and $timedStage -eq 0 -and $terminationError -eq 0 -and
            $null -ne $child -and $child.runId -ceq $runId -and $child.sqlSha256 -eq $ExpectedSqlSha256 -and
            $child.status -ceq 'PASS' -and $child.disposed -eq $true -and $child.completedCases -eq 5 -and
            $launcherTask.Wait([Math]::Min(300, (Get-Remaining $finishDeadline)))) {
            $report = $launcherTask.GetAwaiter().GetResult() | ConvertFrom-Json
            if ($report.runId -ceq $runId -and $report.authority -ceq 'LAUNCHER_OBSERVATION_ONLY' -and
                $report.status -ceq 'PASS' -and $report.processStopResult -ceq 'STOP_CONFIRMED' -and
                $outerStopped -and (Get-Remaining $finishDeadline) -gt 0) {
                $status = 'PASS'
                $confirmedOutcome = 'FIVE_CASES_VERIFIED'
            }
        }
    }
} catch {
    if ($null -eq $reason) { $reason = 'RESULT_READBACK_UNCONFIRMED' }
} finally {
    if ($outerStopped) {
        try { $cleanupComplete = $watch.CloseOwnedResources() } catch { $cleanupComplete = $false }
    }
    $timedStage = $watch.TimedStage
    $terminationError = $watch.TerminationError
}

if ($status -eq 'PASS' -and (-not $outerStopped -or -not $cleanupComplete -or $timedStage -ne 0 -or $terminationError -ne 0 -or
    (Get-Remaining $finishDeadline) -eq 0)) {
    $status = 'BLOCKED'
    $confirmedOutcome = 'UNKNOWN'
    $reason = $(if ($cleanupComplete) { 'NORMAL_EVIDENCE_DEADLINE' } else { 'HANDLE_CLEANUP_UNCONFIRMED' })
}
if ($status -eq 'BLOCKED' -and $null -eq $reason) { $reason = 'RESULT_EVIDENCE_INCOMPLETE' }
if ($reason -eq 'RELEASE_NOT_STARTED' -and $watch.ReleaseStarted) { $reason = 'RELEASE_OUTCOME_UNKNOWN' }
$summary = [ordered]@{
    runId = $runId; authority = 'OUTER_WATCH'; status = $status; reason = $reason
    startedUtc = $t0Utc.ToString('o'); elapsedMilliseconds = 120000 - (Get-Remaining $endDeadline)
    releaseAttempted = $watch.ReleaseStarted; releaseConfirmed = $releaseConfirmed; workCompletedBefore95 = $workComplete
    deadlineStage = $timedStage; terminationError = $terminationError
    outerStopRequested = $watch.OuterStopRequested; handleCleanupConfirmed = $cleanupComplete
    processStopResult = $(if ($outerStopped) { 'STOP_CONFIRMED' } else { 'STOP_NOT_CONFIRMED' })
    outcomeEvidence = $confirmedOutcome
}
$publicationState = 'NOT_STARTED'
if ((Get-Remaining $endDeadline) -gt 0) {
    try {
        $write = $watch.WriteEvidence($watchResult, $watchTemporary, ($summary | ConvertTo-Json -Compress))
        $publicationState = 'IN_PROGRESS'
    } catch { $publicationState = 'FAILED' }
}
if ($publicationState -eq 'IN_PROGRESS') {
    try {
        if ($write.Wait((Get-Remaining $endDeadline))) {
            $write.GetAwaiter().GetResult()
            $publicationState = $(if ((Get-Remaining $endDeadline) -gt 0) { 'SUCCEEDED' } else { 'TIMED_OUT_OR_UNKNOWN' })
        } else { $publicationState = 'TIMED_OUT_OR_UNKNOWN' }
    } catch {
        $publicationState = $(if ((Get-Remaining $endDeadline) -gt 0) { 'FAILED' } else { 'TIMED_OUT_OR_UNKNOWN' })
    }
}
if (-not ($outerStopped -and $cleanupComplete -and $publicationState -eq 'SUCCEEDED' -and $watch.ReturnToCaller())) {
    if ($status -ne 'FAIL') { $status = 'BLOCKED' }
    $processStopResult = $summary.processStopResult
    $evidenceState = $(if ($publicationState -eq 'SUCCEEDED') { 'FINAL_EVIDENCE_PUBLISHED' } else { 'FINAL_EVIDENCE_NOT_OBTAINED' })
    try {
        [Console]::Error.WriteLine("GATE_A_$status $processStopResult WATCH_PUBLICATION_$publicationState $evidenceState")
    } finally { $watch.AwaitHardStop() }
}
if ($status -ne 'PASS') { throw "GATE_A_$status" }
