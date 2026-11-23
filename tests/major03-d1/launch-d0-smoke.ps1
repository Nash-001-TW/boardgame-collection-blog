#requires -Version 7.6
[CmdletBinding(DefaultParameterSetName = 'Supervisor')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Supervisor')]
    [string] $ApprovalPath,

    [Parameter(Mandatory, ParameterSetName = 'Supervisor')]
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string] $ApprovalSha256,

    [Parameter(Mandatory, ParameterSetName = 'Worker')]
    [switch] $Worker
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$nodePath = 'D:\Program Files\nodejs\node.exe'
$entryHash = '1BF7DF2E4C0A7D5F6948286496CF7B4B1198E97927E209E96E2A21F5BAA31B63'
$modes = @('normal','short-child','timeout','loopback','start-fail')
$utf8 = [Text.UTF8Encoding]::new($false, $true)

$bridge = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

public static class Major03Rev04
{
    const uint CreateFlags = 0x08080404;
    static readonly IntPtr Invalid = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    struct Security {
        public uint Length;
        public IntPtr Descriptor;
        public int Inherit;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Startup {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XCount, YCount, Fill, Flags;
        public ushort Show, ReservedLength;
        public IntPtr ReservedData, Input, Output, Error;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct StartupEx {
        public Startup Startup;
        public IntPtr Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo {
        public IntPtr Process, Thread;
        public uint Pid, Tid;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Accounting {
        public long TotalUser, TotalKernel, PeriodUser, PeriodKernel;
        public uint Faults, Total, Active, TerminatedByLimits;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct FileTime {
        public uint Low, High;
        public long Value => unchecked((long)(((ulong)High << 32) | Low));
    }

    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern IntPtr CreateJobObjectW(IntPtr security, IntPtr name);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int SetInformationJobObject(IntPtr job, int kind,
        ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int QueryInformationJobObject(IntPtr job, int kind,
        out Accounting info, uint length, out uint returned);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int IsProcessInJob(IntPtr process, IntPtr job, out int member);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int GetProcessTimes(IntPtr process, out FileTime created,
        out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", ExactSpelling=true)]
    static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern IntPtr OpenProcess(uint access, int inherit, uint pid);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int DuplicateHandle(IntPtr sourceProcess, IntPtr sourceHandle,
        IntPtr destinationProcess, out IntPtr destinationHandle,
        uint access, int inherit, uint options);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", ExactSpelling=true, CharSet=CharSet.Unicode,
        SetLastError=true)]
    static extern IntPtr CreateFileW(string path, uint access, uint share,
        ref Security security, uint disposition, uint attributes, IntPtr template);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int InitializeProcThreadAttributeList(IntPtr list, int count,
        uint flags, ref UIntPtr bytes);
    [DllImport("kernel32.dll", ExactSpelling=true, SetLastError=true)]
    static extern int UpdateProcThreadAttribute(IntPtr list, uint flags,
        UIntPtr key, IntPtr data, UIntPtr bytes, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll", ExactSpelling=true)]
    static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", ExactSpelling=true, CharSet=CharSet.Unicode,
        SetLastError=true)]
    static extern int CreateProcessW(string application, StringBuilder command,
        IntPtr processSecurity, IntPtr threadSecurity, int inheritHandles, uint flags,
        IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo info);

    static void Check(bool ok, string operation)
    {
        if (!ok) throw new Win32Exception(Marshal.GetLastPInvokeError(), operation);
    }

    static void Size<T>(int expected)
    {
        if (Marshal.SizeOf<T>() != expected)
            throw new InvalidOperationException("ABI size: " + typeof(T).Name);
    }

    static void Offset<T>(string field, int expected)
    {
        if (Marshal.OffsetOf<T>(field).ToInt32() != expected)
            throw new InvalidOperationException("ABI offset: " + typeof(T).Name + "." + field);
    }

    public static void CheckAbi()
    {
        if (IntPtr.Size != 8 || RuntimeInformation.ProcessArchitecture != Architecture.X64)
            throw new PlatformNotSupportedException("Windows x64 required");

        Size<Security>(24);
        Offset<Security>("Descriptor", 8);
        Offset<Security>("Inherit", 16);
        Size<Startup>(104);
        Offset<Startup>("Flags", 60);
        Offset<Startup>("ReservedData", 72);
        Offset<Startup>("Input", 80);
        Offset<Startup>("Output", 88);
        Offset<Startup>("Error", 96);
        Size<StartupEx>(112);
        Offset<StartupEx>("Attributes", 104);
        Size<ProcessInfo>(24);
        Offset<ProcessInfo>("Pid", 16);
        Size<BasicLimits>(64);
        Offset<BasicLimits>("Flags", 16);
        Offset<BasicLimits>("Affinity", 48);
        Size<IoCounters>(48);
        Size<ExtendedLimits>(144);
        Offset<ExtendedLimits>("Io", 64);
        Offset<ExtendedLimits>("ProcessMemory", 112);
        Size<Accounting>(48);
        Offset<Accounting>("Total", 36);
        Offset<Accounting>("Active", 40);
        Size<FileTime>(8);
    }

    public static void Close(IntPtr handle)
    {
        if (handle != IntPtr.Zero && handle != Invalid)
            Check(CloseHandle(handle) != 0, "CloseHandle");
    }

    public static IntPtr NewJob()
    {
        IntPtr job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
        Check(job != IntPtr.Zero, "CreateJobObjectW");
        try {
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000;
            Check(SetInformationJobObject(job, 9, ref limits, 144) != 0,
                "SetInformationJobObject");
            return job;
        } catch (Exception error) {
            try { Close(job); }
            catch (Exception closeError) { throw new AggregateException(error, closeError); }
            throw;
        }
    }

    public static uint[] Counts(IntPtr job)
    {
        Check(QueryInformationJobObject(job, 1, out Accounting info, 48,
            out uint returned) != 0, "QueryInformationJobObject");
        if (returned != 48) throw new InvalidOperationException("Accounting size mismatch");
        return new[] { info.Total, info.Active, info.TerminatedByLimits };
    }

    public static void KillJob(IntPtr job)
    {
        Check(TerminateJobObject(job, 124) != 0, "TerminateJobObject");
    }

    public static bool InJob(IntPtr process, IntPtr job)
    {
        Check(IsProcessInJob(process, job, out int member) != 0, "IsProcessInJob");
        return member != 0;
    }

    public static bool Exited(IntPtr process)
    {
        uint status = WaitForSingleObject(process, 0);
        if (status == 0) return true;
        if (status == 258) return false;
        if (status == uint.MaxValue) Check(false, "WaitForSingleObject");
        throw new InvalidOperationException("Unexpected wait status: " + status);
    }

    public static uint ExitCode(IntPtr process)
    {
        if (!Exited(process)) throw new InvalidOperationException("Process not signaled");
        Check(GetExitCodeProcess(process, out uint code) != 0, "GetExitCodeProcess");
        return code;
    }

    public static uint ProcessId(IntPtr process)
    {
        uint pid = GetProcessId(process);
        Check(pid != 0, "GetProcessId");
        return pid;
    }

    public static string CreatedUtc(IntPtr process)
    {
        Check(GetProcessTimes(process, out FileTime created, out _, out _, out _) != 0,
            "GetProcessTimes");
        return DateTime.FromFileTimeUtc(created.Value).ToString("o", CultureInfo.InvariantCulture);
    }

    public static IntPtr Observe(uint pid)
    {
        IntPtr handle = OpenProcess(0x00101000, 0, pid);
        Check(handle != IntPtr.Zero, "OpenProcess");
        return handle;
    }

    public static uint ClientPid(IntPtr pipe)
    {
        Check(GetNamedPipeClientProcessId(pipe, out uint pid) != 0,
            "GetNamedPipeClientProcessId");
        return pid;
    }

    public static uint ServerPid(IntPtr pipe)
    {
        Check(GetNamedPipeServerProcessId(pipe, out uint pid) != 0,
            "GetNamedPipeServerProcessId");
        return pid;
    }

    public static string GiveJob(IntPtr job, IntPtr worker)
    {
        Check(DuplicateHandle(GetCurrentProcess(), job, worker, out IntPtr remote,
            0x0005, 0, 0) != 0, "DuplicateHandle Job to Worker");
        return remote.ToInt64().ToString(CultureInfo.InvariantCulture);
    }

    static IntPtr OpenStd(string path, uint access, uint disposition)
    {
        var security = new Security { Length = 24, Inherit = 1 };
        IntPtr handle = CreateFileW(path, access, 3, ref security, disposition,
            0x80, IntPtr.Zero);
        Check(handle != Invalid, "CreateFileW: " + path);
        return handle;
    }

    static void Attribute(IntPtr list, uint key, IntPtr data, int count)
    {
        Check(UpdateProcThreadAttribute(list, 0, (UIntPtr)key, data,
            (UIntPtr)(count * IntPtr.Size), IntPtr.Zero, IntPtr.Zero) != 0,
            "UpdateProcThreadAttribute: " + key.ToString("X"));
    }

    public sealed class Target : IDisposable
    {
        IntPtr process, thread;
        public uint Pid { get; private set; }
        public string CreationUtc => CreatedUtc(process);

        public void Create(IntPtr job, string exe, string argument, string cwd,
            string environment, string stdout, string stderr)
        {
            if (process != IntPtr.Zero) throw new InvalidOperationException("Already created");

            IntPtr input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
            IntPtr list = IntPtr.Zero, handles = IntPtr.Zero, jobs = IntPtr.Zero;
            IntPtr env = IntPtr.Zero;
            bool initialized = false;
            Exception primary = null;
            try {
                input = OpenStd("NUL", 0x80000000, 3);
                output = OpenStd(stdout, 0x40000000, 1);
                error = OpenStd(stderr, 0x40000000, 1);

                UIntPtr size = UIntPtr.Zero;
                int sized = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
                int last = Marshal.GetLastPInvokeError();
                if (sized != 0 || last != 122 || size == UIntPtr.Zero)
                    throw new Win32Exception(last, "Size attribute list");

                list = Marshal.AllocHGlobal(checked((int)size.ToUInt64()));
                Check(InitializeProcThreadAttributeList(list, 2, 0, ref size) != 0,
                    "InitializeProcThreadAttributeList");
                initialized = true;

                handles = Marshal.AllocHGlobal(3 * IntPtr.Size);
                Marshal.Copy(new[] { input, output, error }, 0, handles, 3);
                jobs = Marshal.AllocHGlobal(IntPtr.Size);
                Marshal.WriteIntPtr(jobs, job);
                Attribute(list, 0x00020002, handles, 3);
                Attribute(list, 0x0002000D, jobs, 1);

                var startup = new StartupEx { Attributes = list };
                startup.Startup.Size = 112;
                startup.Startup.Flags = 0x100;
                startup.Startup.Input = input;
                startup.Startup.Output = output;
                startup.Startup.Error = error;
                env = Marshal.StringToHGlobalUni(environment);

                // TARGET_CREATE
                var command = new StringBuilder("\"" + exe + "\" " + argument);
                Check(CreateProcessW(exe, command, IntPtr.Zero, IntPtr.Zero, 1,
                    CreateFlags, env, cwd, ref startup, out ProcessInfo info) != 0,
                    "CreateProcessW");
                process = info.Process;
                thread = info.Thread;
                Pid = info.Pid;
                if (!InJob(process, job) || Exited(process))
                    throw new InvalidOperationException("Suspended target verification failed");
            } catch (Exception e) {
                primary = e;
                throw;
            } finally {
                if (initialized) DeleteProcThreadAttributeList(list);
                if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
                if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs);
                if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
                if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);

                var errors = new System.Collections.Generic.List<Exception>();
                foreach (IntPtr handle in new[] { input, output, error }) {
                    try { Close(handle); } catch (Exception e) { errors.Add(e); }
                }
                if (errors.Count != 0) {
                    if (primary != null) errors.Insert(0, primary);
                    throw new AggregateException(errors);
                }
            }
        }

        public void Resume()
        {
            uint previous = ResumeThread(thread);
            Check(previous != uint.MaxValue, "ResumeThread");
            if (previous != 1)
                throw new InvalidOperationException("Unexpected suspend count: " + previous);
        }

        public bool HasExited() => Exited(process);

        public void StopOwnedRoot()
        {
            if (process != IntPtr.Zero && !Exited(process))
                Check(TerminateProcess(process, 124) != 0, "Terminate owned root");
        }

        public void Dispose()
        {
            IntPtr t = thread, p = process;
            thread = process = IntPtr.Zero;
            try { Close(t); } finally { Close(p); }
        }
    }
}
'@

$rehearsalSource = @'
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { existsSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const net = require('node:net');

const mode = process.env.D0_REHEARSAL_MODE;
const emit = (event, fields = {}) =>
    console.log(JSON.stringify({ event, utc: new Date().toISOString(), ...fields }));

async function main() {
    let server;
    try {
        let endpoint = 'http://127.0.0.1:1/';
        if (mode === 'loopback') {
            server = net.createServer(socket => socket.destroy());
            const listening = once(server, 'listening');
            server.listen(0, '127.0.0.1');
            await listening;
            endpoint = `http://127.0.0.1:${server.address().port}/`;
        }
        emit('ready', { endpoint, syntheticEndpoint: mode !== 'loopback' });

        if (mode === 'short-child' || mode === 'timeout') {
            const child = spawn(process.execPath, ['-e',
                mode === 'timeout' ? 'setInterval(() => {}, 1000)' : 'process.exit(0)'
            ], { stdio: 'ignore', windowsHide: true });
            // Register both before awaiting either. Handle both rejections even
            // if spawn fails before the exit result is consumed.
            const spawned = once(child, 'spawn');
            const exited = once(child, 'exit');
            exited.catch(() => {});
            await spawned;
            emit('child_started', { pid: child.pid, parentPid: process.pid });
            const [code, signal] = await exited;
            emit('child_exited', { pid: child.pid, code, signal });
            if (mode === 'timeout' || code !== 0)
                throw new Error(`Unexpected synthetic child exit: ${code}/${signal}`);
        }

        if (mode === 'loopback') {
            while (!existsSync(process.env.D0_LOOPBACK_RELEASE)) await sleep(25);
        }

        emit('query_ok', { ok: 1 });
        emit('dispose_start');
        if (server) {
            await new Promise((resolve, reject) =>
                server.close(error => error ? reject(error) : resolve()));
            server = undefined;
        }
        emit('dispose_ok');
        emit('smoke_complete');
    } finally {
        if (server) server.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
'@

function Assert-Host {
    if (-not $IsWindows -or $PSVersionTable.PSVersion.ToString() -ne '7.6.9' -or
        [Runtime.InteropServices.RuntimeInformation]::FrameworkDescription -ne '.NET 10.0.14' -or
        [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64') {
        throw 'Unreviewed host'
    }
}

function Assert-PlainPath([string] $Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path)) { throw 'Expected absolute path' }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -notmatch '^[A-Za-z]:\\[^:]*$') { throw "Unsupported path: $full" }
    for ($cursor = $full; $null -ne $cursor; ) {
        $item = Get-Item -LiteralPath $cursor -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Reparse point: $cursor"
        }
        $parent = [IO.Directory]::GetParent($cursor)
        $cursor = if ($parent) { $parent.FullName } else { $null }
    }
    return $full
}

function Test-InTree([string] $Base, [string] $Path) {
    $relative = [IO.Path]::GetRelativePath($Base, $Path)
    return $relative -eq '.' -or (
        -not [IO.Path]::IsPathRooted($relative) -and
        $relative -ne '..' -and -not $relative.StartsWith('..\')
    )
}

function Get-Sha([string] $Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Assert-Pin([string] $Path, [string] $Hash) {
    $full = Assert-PlainPath $Path
    if ($Hash -notmatch '^[0-9A-Fa-f]{64}$' -or
        -not [IO.File]::Exists($full) -or (Get-Sha $full) -ine $Hash) {
        throw "Baseline mismatch: $full"
    }
    return $full
}

function Get-Inventory([string[]] $Paths) {
    $files = [Collections.Generic.SortedDictionary[string,string]]::new(
        [StringComparer]::Ordinal
    )
    foreach ($path in $Paths) {
        $pending = [Collections.Generic.Stack[string]]::new()
        $pending.Push((Assert-PlainPath $path))
        while ($pending.Count) {
            $item = Get-Item -LiteralPath ($pending.Pop()) -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Inventory reparse point: $($item.FullName)"
            }
            if ($item.PSIsContainer) {
                $files[$item.FullName] = 'DIRECTORY'
                foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) {
                    $pending.Push($child.FullName)
                }
            } else {
                $files[$item.FullName] = Get-Sha $item.FullName
            }
        }
    }
    return ,$files
}

function Save-Json([string] $Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 25))
}

function Get-NativeError($Record) {
    $exception = $Record.Exception
    while ($exception) {
        # An AggregateException includes cleanup failure. Do not certify it
        # as an isolated CreateProcessW negative control.
        if ($exception -is [AggregateException]) { return $null }
        if ($exception -is [ComponentModel.Win32Exception]) {
            return @{ code = $exception.NativeErrorCode; operation = $exception.Message }
        }
        $exception = $exception.InnerException
    }
    return $null
}

function Make-Environment([string] $Root) {
    return @{
        SystemRoot = $env:SystemRoot
        WINDIR = $env:SystemRoot
        TEMP = (Join-Path $Root 'temp')
        TMP = (Join-Path $Root 'temp')
        HOME = (Join-Path $Root 'profile')
        USERPROFILE = (Join-Path $Root 'profile')
        APPDATA = (Join-Path $Root 'profile\AppData\Roaming')
        LOCALAPPDATA = (Join-Path $Root 'profile\AppData\Local')
        NODE_DISABLE_COMPILE_CACHE = '1'
    }
}

function Convert-EnvironmentBlock($Environment) {
    $sorted = [Collections.Generic.SortedDictionary[string,string]]::new(
        [StringComparer]::OrdinalIgnoreCase
    )
    foreach ($name in $Environment.Keys) {
        $value = [string] $Environment[$name]
        if ($name -notmatch '^[A-Za-z_][A-Za-z_0-9]*$' -or $value.Contains("`0")) {
            throw 'Invalid environment entry'
        }
        $sorted.Add($name, $value)
    }
    $pairs = @(foreach ($name in $sorted.Keys) { "$name=$($sorted[$name])" })
    return ([string]::Join("`0", [string[]] $pairs) + "`0`0")
}

function Send-Control($Writer, $Value) {
    $Writer.WriteLine((ConvertTo-Json -InputObject $Value -Depth 15 -Compress))
}

function Decode-Control([AllowNull()][string] $Line) {
    if ($null -eq $Line -or $Line.Length -gt 65536) { throw 'Invalid control line' }
    $record = ConvertFrom-Json -InputObject $Line -AsHashtable
    if ($record -isnot [Collections.IDictionary]) { throw 'Invalid control shape' }
    return $record
}

function Wait-Bootstrap($Task, $Clock) {
    while (-not $Task.IsCompleted) {
        if ($Clock.ElapsedMilliseconds -ge 30000) { throw 'BOOTSTRAP_DEADLINE' }
        Start-Sleep -Milliseconds 20
    }
    if ($Clock.ElapsedMilliseconds -ge 30000) { throw 'BOOTSTRAP_DEADLINE' }
    return $Task.GetAwaiter().GetResult()
}

if ($Worker) {
    $pipe = $reader = $writer = $target = $null
    $owner = $job = [IntPtr]::Zero
    $phase = 'worker_bootstrap'
    $code = 1

    try {
        Assert-Host
        if ($env:D0_PIPE -notmatch '^major03-d0-[0-9a-f]{32}$' -or
            $env:D0_NONCE -notmatch '^[0-9a-f]{64}$' -or
            $env:D0_SUPERVISOR_PID -notmatch '^[1-9][0-9]*$' -or
            $env:D0_SUPERVISOR_CREATED -notmatch '^\d{4}-\d{2}-\d{2}T') {
            throw 'Worker handshake unavailable'
        }

        Add-Type -TypeDefinition $bridge -Language CSharp
        [Major03Rev04]::CheckAbi()
        $pipe = [IO.Pipes.NamedPipeClientStream]::new(
            '.', $env:D0_PIPE, [IO.Pipes.PipeDirection]::InOut,
            [IO.Pipes.PipeOptions]::CurrentUserOnly
        )
        $pipe.Connect(10000)
        $ownerPid = [uint32] $env:D0_SUPERVISOR_PID
        if ([Major03Rev04]::ServerPid($pipe.SafePipeHandle.DangerousGetHandle()) -ne $ownerPid) {
            throw 'Unexpected pipe server'
        }
        $owner = [Major03Rev04]::Observe($ownerPid)
        if ([Major03Rev04]::ProcessId($owner) -ne $ownerPid -or
            [Major03Rev04]::CreatedUtc($owner) -cne $env:D0_SUPERVISOR_CREATED -or
            [Major03Rev04]::Exited($owner)) {
            throw 'Supervisor identity mismatch'
        }

        $reader = [IO.StreamReader]::new($pipe, $utf8, $false, 4096, $true)
        $writer = [IO.StreamWriter]::new($pipe, $utf8, 4096, $true)
        $writer.AutoFlush = $true
        Send-Control $writer @{ kind = 'armed'; nonce = $env:D0_NONCE }

        $plan = Decode-Control ($reader.ReadLine())
        if ($plan.kind -cne 'create' -or $plan.nonce -cne $env:D0_NONCE -or
            [Major03Rev04]::Exited($owner)) { throw 'Invalid create permit' }

        # The received duplicate belongs to this Worker from this point.
        $job = [IntPtr]::new([long]::Parse(
            $plan.jobHandle, [Globalization.CultureInfo]::InvariantCulture
        ))
        if ($job -eq [IntPtr]::Zero) { throw 'Missing Job handle' }

        $cwd = Assert-PlainPath $plan.cwd
        $root = Split-Path -Parent $cwd
        $stdout = Join-Path $root 'evidence\stdout.raw'
        $stderr = Join-Path $root 'evidence\stderr.raw'
        [void] (Assert-PlainPath (Split-Path -Parent $stdout))
        $allowedExe = if ($plan.mode -ceq 'start-fail') {
            Join-Path $cwd 'deliberately-absent.exe'
        } else { $nodePath }
        if ($plan.mode -cnotin $modes -or
            [IO.Path]::GetRelativePath($cwd, (Get-Location).Path) -ne '.' -or
            $plan.exe -ine $allowedExe -or $plan.argument -cne '.\rehearsal.cjs' -or
            $plan.stdout -ine $stdout -or $plan.stderr -ine $stderr) {
            throw 'Worker target scope mismatch'
        }
        if ($plan.mode -ceq 'start-fail') {
            if (Test-Path -LiteralPath $allowedExe) { throw 'Negative executable exists' }
        } else {
            [void] (Assert-Pin $allowedExe $plan.nodeSha256)
        }
        [void] (Assert-Pin (Join-Path $cwd 'rehearsal.cjs') $plan.rehearsalSha256)

        $childEnv = Make-Environment $root
        $childEnv.D0_REHEARSAL_MODE = $plan.mode
        $childEnv.D0_LOOPBACK_RELEASE = Join-Path $root 'evidence\loopback-release'

        $phase = 'create_target'
        $target = [Major03Rev04+Target]::new()
        $target.Create($job, $allowedExe, '.\rehearsal.cjs', $cwd,
            (Convert-EnvironmentBlock $childEnv), $stdout, $stderr)
        Send-Control $writer @{
            kind = 'suspended'; pid = $target.Pid; createdUtc = $target.CreationUtc
        }

        $phase = 'resume_target'
        $permit = Decode-Control ($reader.ReadLine())
        if ($permit.kind -cne 'resume' -or $permit.nonce -cne $env:D0_NONCE -or
            [Major03Rev04]::Exited($owner)) { throw 'Invalid resume permit' }
        $target.Resume()
        Send-Control $writer @{ kind = 'resumed'; pid = $target.Pid }

        $phase = 'wait_target'
        while (-not $target.HasExited()) {
            if ([Major03Rev04]::Exited($owner)) { throw 'Supervisor exited' }
            Start-Sleep -Milliseconds 20
        }
        Send-Control $writer @{ kind = 'root_exited'; pid = $target.Pid }
        $code = 0
    } catch {
        $original = $_
        try { [Console]::Error.WriteLine($original.ToString()) } catch { }
        if ($writer) {
            try {
                Send-Control $writer @{
                    kind = 'error'; phase = $phase
                    native = (Get-NativeError $original)
                    message = $original.Exception.ToString()
                }
            } catch { try { [Console]::Error.WriteLine($_.ToString()) } catch { } }
        }
        if ($target) {
            try { $target.StopOwnedRoot() }
            catch { try { [Console]::Error.WriteLine($_.ToString()) } catch { } }
        }
    } finally {
        foreach ($item in @($target, $writer, $reader, $pipe)) {
            try { if ($item) { $item.Dispose() } }
            catch {
                $code = 1
                try { [Console]::Error.WriteLine($_.ToString()) } catch { }
            }
        }
        foreach ($handle in @($job, $owner)) {
            # Avoid resolving the bridge type if Add-Type itself failed.
            if ($handle -ne [IntPtr]::Zero) {
                try { [Major03Rev04]::Close($handle) }
                catch {
                    $code = 1
                    try { [Console]::Error.WriteLine($_.ToString()) } catch { }
                }
            }
        }
    }
    exit $code
}

$root = $evidence = $before = $plan = $null
$workerProcess = $pipe = $reader = $writer = $rawReader = $null
$workerOut = $workerErr = $stdoutTask = $stderrTask = $null
$watch = $null
$job = $targetHandle = [IntPtr]::Zero
$mode = $null
$phase = 'preflight'
$traceWritable = $true

$facts = [ordered]@{
    runId = $null
    mode = $null
    startUtc = $null
    endUtc = $null
    failureKind = $null
    firstFault = $null
    createPermit = $false
    resumePermit = $false
    resumed = $false
    controlEof = $false
    createFailureReported = $false
    negativeCreateVerified = $false
    workerStart = 'NOT_ATTEMPTED'
    workerPid = $null
    workerCreatedUtc = $null
    workerState = 'NOT_CREATED'
    workerExit = $null
    workerExitObservedUtc = $null
    rootPid = $null
    rootCreatedUtc = $null
    rootState = 'NOT_PERMITTED'
    rootExit = $null
    rootExitObservedUtc = $null
    rootExitNotice = $false
    jobCurrent = $null
    jobLastKnown = $null
    events = [Collections.Generic.List[object]]::new()
    errors = [Collections.Generic.List[object]]::new()
    controlErrors = [Collections.Generic.List[object]]::new()
    recoveryAttempts = [Collections.Generic.List[object]]::new()
    recovery = 'NOT_NEEDED'
    recoveryStartedUtc = $null
    recoveryMs = $null
    capture = @{
        stdout = @{ state = 'WORKER_NOT_CREATED'; eof = $false; flushed = $false }
        stderr = @{ state = 'WORKER_NOT_CREATED'; eof = $false; flushed = $false }
    }
    targetRawSealed = $false
    finalInventorySealed = $false
    protectedChanges = @()
    localEventsComplete = $false
    listenerSnapshotPort = $null
    listenerReleaseSnapshot = $false
    observedChildPid = $null
    childStartObservedMs = $null
    observedChildExit = $false
    external = [ordered]@{
        tripartiteResultAcceptance = 'PENDING'
        runtimeHardWatchdog = 'UNKNOWN'
        osNonLoopbackBlock = 'UNKNOWN'
        hostVisibility = 'UNKNOWN'
        processIdentityAndExitEvents = 'UNKNOWN'
        listenerOwnershipAndRelease = 'UNKNOWN'
        networkEvents = 'UNKNOWN'
        transientAndOutOfInventoryWrites = 'UNKNOWN'
        fullRecoveryReview = 'UNKNOWN'
    }
}

function Add-Fault([string] $Where, $Record) {
    $item = @{
        phase = $Where
        native = (Get-NativeError $Record)
        message = $Record.Exception.ToString()
        utc = [DateTimeOffset]::UtcNow.ToString('o')
    }
    if ($null -eq $facts.firstFault) { $facts.firstFault = $item }
    $facts.errors.Add($item)
}

function Log-Fact([string] $Kind, $Details) {
    $event = [ordered]@{
        utc = [DateTimeOffset]::UtcNow.ToString('o')
        monotonicMs = $(if ($watch) { $watch.ElapsedMilliseconds } else { $null })
        kind = $Kind
        details = $Details
    }
    $facts.events.Add($event)
    if ($evidence -and $traceWritable) {
        try {
            [IO.File]::AppendAllText((Join-Path $evidence 'supervisor.ndjson'),
                ((ConvertTo-Json -InputObject $event -Depth 15 -Compress) + "`n"))
        } catch {
            $script:traceWritable = $false
            Add-Fault 'trace' $_
        }
    }
}

function Require-Trace {
    if (-not $traceWritable) { throw 'Supervisor trace write failed' }
}

function Refresh-Worker {
    if (-not $workerProcess) {
        $facts.workerState = if ($facts.workerStart -ceq 'NOT_ATTEMPTED') {
            'NOT_CREATED'
        } else { 'UNKNOWN' }
        return
    }
    $facts.workerState = 'UNKNOWN'
    if ([Major03Rev04]::Exited($workerProcess.Handle)) {
        $facts.workerExit = [Major03Rev04]::ExitCode($workerProcess.Handle)
        $facts.workerExitObservedUtc = [DateTimeOffset]::UtcNow.ToString('o')
        $facts.workerState = 'EXIT_CONFIRMED'
    } else {
        $facts.workerState = 'ACTIVE'
    }
}

function Refresh-Root {
    if ($targetHandle -eq [IntPtr]::Zero) {
        $facts.rootState = if (-not $facts.createPermit) { 'NOT_PERMITTED' }
            elseif ($facts.negativeCreateVerified) { 'CONFIRMED_NOT_CREATED' }
            else { 'EXIT_UNKNOWN' }
        return
    }
    $facts.rootState = 'EXIT_UNKNOWN'
    if ([Major03Rev04]::Exited($targetHandle)) {
        $facts.rootExit = [Major03Rev04]::ExitCode($targetHandle)
        $facts.rootExitObservedUtc = [DateTimeOffset]::UtcNow.ToString('o')
        $facts.rootState = 'EXIT_CONFIRMED'
    } else {
        $facts.rootState = 'ACTIVE'
    }
}

function Refresh-Job {
    # Invalidate before calling Win32. Historical zero is evidence only.
    $facts.jobCurrent = $null
    if ($job -eq [IntPtr]::Zero) { return }
    $counts = [Major03Rev04]::Counts($job)
    $sample = [ordered]@{
        total = $counts[0]; active = $counts[1]; terminatedByLimits = $counts[2]
        sampledUtc = [DateTimeOffset]::UtcNow.ToString('o')
        sampledMs = $(if ($watch) { $watch.ElapsedMilliseconds } else { $null })
        afterConfirmedWorkerExit = $facts.workerState -ceq 'EXIT_CONFIRMED'
    }
    $facts.jobCurrent = $sample
    $facts.jobLastKnown = $sample
}

function Observe-ForRecovery {
    try { Refresh-Worker } catch { Add-Fault 'worker_observation' $_ }
    try { Refresh-Root } catch { Add-Fault 'root_observation' $_ }
    try { Refresh-Job } catch { Add-Fault 'job_observation' $_ }
}

function Test-JobEmptyAfterWorker {
    return $null -ne $facts.jobCurrent -and
        $facts.jobCurrent.active -eq 0 -and
        $facts.jobCurrent.afterConfirmedWorkerExit
}

function Invoke-Recovery {
    # RECOVERY: start before the first cleanup observation.
    if (-not $workerProcess -and $job -eq [IntPtr]::Zero -and
        $targetHandle -eq [IntPtr]::Zero -and $facts.workerStart -ceq 'NOT_ATTEMPTED') {
        return
    }

    $clock = [Diagnostics.Stopwatch]::StartNew()
    $facts.recoveryStartedUtc = [DateTimeOffset]::UtcNow.ToString('o')
    Observe-ForRecovery
    $workerSafe = $facts.workerState -cin @('NOT_CREATED','EXIT_CONFIRMED')
    $rootSafe = $facts.rootState -cin @('NOT_PERMITTED','CONFIRMED_NOT_CREATED','EXIT_CONFIRMED')
    $jobSafe = $job -eq [IntPtr]::Zero -or (
        $null -ne $facts.jobCurrent -and $facts.jobCurrent.active -eq 0 -and
        ($facts.jobCurrent.afterConfirmedWorkerExit -or
         ($facts.workerState -ceq 'NOT_CREATED' -and -not $facts.createPermit))
    )

    if ($clock.ElapsedMilliseconds -lt 5000 -and $workerSafe -and $rootSafe -and $jobSafe) {
        return
    }

    $facts.recovery = 'RECOVERY_UNKNOWN'
    Log-Fact 'recovery_start' @{
        budgetMs = 5000; observedMs = $clock.ElapsedMilliseconds
        worker = $facts.workerState; root = $facts.rootState; job = $facts.jobCurrent
    }

    $secondJobTermination = $false
    foreach ($operation in @('terminate_worker','terminate_job')) {
        $attempt = [ordered]@{
            operation = $operation; startedMs = $clock.ElapsedMilliseconds
            finishedMs = $null; outcome = 'NOT_NEEDED'
        }
        try {
            if ($operation -ceq 'terminate_worker' -and $workerProcess -and
                $facts.workerState -cne 'EXIT_CONFIRMED') {
                $workerProcess.Kill()
                $attempt.outcome = 'REQUESTED'
            } elseif ($operation -ceq 'terminate_job' -and $job -ne [IntPtr]::Zero) {
                [Major03Rev04]::KillJob($job)
                $attempt.outcome = 'REQUESTED'
            }
        } catch {
            $attempt.outcome = 'ERROR'
            Add-Fault $operation $_
        }
        $attempt.finishedMs = $clock.ElapsedMilliseconds
        $facts.recoveryAttempts.Add($attempt)
        Log-Fact 'recovery_attempt' $attempt
    }

    while ($clock.ElapsedMilliseconds -lt 5000) {
        Observe-ForRecovery
        $observedMs = $clock.ElapsedMilliseconds
        Log-Fact 'recovery_observation' @{
            elapsedMs = $observedMs; worker = $facts.workerState
            root = $facts.rootState; job = $facts.jobCurrent
        }
        if ($clock.ElapsedMilliseconds -ge 5000) { break }

        if ($facts.workerState -ceq 'EXIT_CONFIRMED' -and
            (Test-JobEmptyAfterWorker) -and $facts.rootState -cne 'ACTIVE') {
            $facts.recoveryMs = $clock.ElapsedMilliseconds
            if ($facts.recoveryMs -lt 5000) { $facts.recovery = 'JOB_RECOVERY_CONFIRMED' }
            break
        }

        if ($facts.workerState -ceq 'EXIT_CONFIRMED' -and $job -ne [IntPtr]::Zero -and
            -not $secondJobTermination -and -not (Test-JobEmptyAfterWorker)) {
            $secondJobTermination = $true
            $attempt = [ordered]@{
                operation = 'terminate_job_after_worker_exit'
                startedMs = $clock.ElapsedMilliseconds; finishedMs = $null
                outcome = 'REQUESTED'
            }
            try { [Major03Rev04]::KillJob($job) }
            catch { $attempt.outcome = 'ERROR'; Add-Fault $attempt.operation $_ }
            $attempt.finishedMs = $clock.ElapsedMilliseconds
            $facts.recoveryAttempts.Add($attempt)
            Log-Fact 'recovery_attempt' $attempt
        }
        Start-Sleep -Milliseconds 20
    }

    if ($facts.recovery -cne 'JOB_RECOVERY_CONFIRMED') {
        $facts.recoveryMs = $clock.ElapsedMilliseconds
        # Supplemental observation only. No promotion to confirmed recovery.
        Observe-ForRecovery
        if ($facts.workerState -ceq 'ACTIVE' -or $facts.rootState -ceq 'ACTIVE' -or
            ($null -ne $facts.jobCurrent -and $facts.jobCurrent.active -gt 0)) {
            $facts.recovery = 'RECOVERY_FAILED'
        }
        Log-Fact 'post_recovery_window_observation' @{
            elapsedMs = $clock.ElapsedMilliseconds; worker = $facts.workerState
            root = $facts.rootState; job = $facts.jobCurrent
        }
    }

    Log-Fact 'recovery_end' @{
        recovery = $facts.recovery; elapsedMs = $facts.recoveryMs
        worker = $facts.workerState; workerExit = $facts.workerExit
        root = $facts.rootState; rootExit = $facts.rootExit; job = $facts.jobCurrent
    }
}

function Drain-WorkerEvidence {
    if (-not $workerProcess) { return }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $streams = @(
        @{ name = 'stdout'; task = $stdoutTask; file = $workerOut },
        @{ name = 'stderr'; task = $stderrTask; file = $workerErr }
    )
    while ($clock.ElapsedMilliseconds -lt 2000 -and
           @($streams | Where-Object { $_.task -and -not $_.task.IsCompleted }).Count) {
        Start-Sleep -Milliseconds 20
    }

    foreach ($stream in $streams) {
        $state = $facts.capture[$stream.name]
        if (-not $stream.task) {
            $state.state = 'CAPTURE_NOT_STARTED'
            continue
        }
        if (-not $stream.task.IsCompleted) {
            $state.state = 'INCOMPLETE'
            continue
        }
        try {
            $stream.task.GetAwaiter().GetResult()
            $state.eof = $true
            $stream.file.Flush($true)
            $state.flushed = $true
            $state.state = 'CAPTURE_COMPLETE'
        } catch {
            $state.state = 'CAPTURE_FAILED'
            Add-Fault ('capture_' + $stream.name) $_
        }
    }
    Log-Fact 'worker_capture' $facts.capture
}

function Test-Listener([int] $Port) {
    $matches = @(
        [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().
            GetActiveTcpListeners() |
            Where-Object { $_.Address.ToString() -eq '127.0.0.1' -and $_.Port -eq $Port }
    )
    return $matches.Count -gt 0
}

try {
    Assert-Host
    $approval = Assert-Pin $ApprovalPath $ApprovalSha256
    $plan = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $approval -Raw) -AsHashtable
    $mode = $plan.mode
    $facts.mode = $mode
    if ($mode -cnotin (@('d0') + $modes) -or
        $plan.authorizationRef -isnot [string] -or
        [string]::IsNullOrWhiteSpace($plan.authorizationRef)) {
        throw 'Unreviewed mode or missing authorization reference'
    }

    # D0_GATE: no Approval assertion can unlock this revision.
    if ($mode -ceq 'd0') {
        $facts.failureKind = 'D0_OUTER_CONTROL_NOT_IMPLEMENTED'
        throw 'D0 requires independent per-run watchdog, isolation and observer evidence'
    }

    $workspace = Assert-PlainPath (Join-Path $PSScriptRoot '..\..')
    $parent = Assert-PlainPath $plan.diagnosticParent
    if (-not [IO.Directory]::Exists($parent) -or
        (Test-InTree $workspace $parent) -or (Test-InTree $parent $workspace)) {
        throw 'Diagnostic parent overlaps workspace or is not a directory'
    }

    $self = Assert-Pin $PSCommandPath $plan.launcherSha256
    $pwsh = Assert-Pin (Join-Path $PSHOME 'pwsh.exe') $plan.pwshSha256
    $node = Assert-Pin $nodePath $plan.nodeSha256
    $entry = Assert-Pin (Join-Path $PSScriptRoot 'd0-binding-smoke.mjs') $entryHash
    $id = [guid]::NewGuid().ToString('N')
    $facts.runId = $id
    $root = Join-Path $parent "MAJOR03-D0-$id"
    New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
    [void] (Assert-PlainPath $root)
    foreach ($name in @('evidence','input','state','runtime-tmp','temp',
                         'profile\AppData\Local','profile\AppData\Roaming')) {
        $directory = Join-Path $root $name
        [void] [IO.Directory]::CreateDirectory($directory)
        [void] (Assert-PlainPath $directory)
        if ($name -ceq 'evidence') { $evidence = $directory }
    }

    $cwd = Join-Path $root 'input'
    $stdout = Join-Path $evidence 'stdout.raw'
    $stderr = Join-Path $evidence 'stderr.raw'
    $release = Join-Path $evidence 'loopback-release'
    $fixture = Join-Path $cwd 'rehearsal.cjs'
    [IO.File]::WriteAllText($fixture, $rehearsalSource)
    $fixtureHash = Get-Sha $fixture
    $exe = if ($mode -ceq 'start-fail') {
        Join-Path $cwd 'deliberately-absent.exe'
    } else { $node }
    if ($mode -ceq 'start-fail' -and (Test-Path -LiteralPath $exe)) {
        throw 'Negative executable exists'
    }

    $protected = @($workspace, $approval, $pwsh, $node, $entry, $cwd)
    $before = Get-Inventory $protected
    Save-Json (Join-Path $evidence 'before.json') $before
    $targetEnv = Make-Environment $root
    $targetEnv.D0_REHEARSAL_MODE = $mode
    $targetEnv.D0_LOOPBACK_RELEASE = $release
    Save-Json (Join-Path $evidence 'launch.json') @{
        runId = $id; mode = $mode; approvalSha256 = $ApprovalSha256
        authorizationRef = $plan.authorizationRef; argv = @($exe, '.\rehearsal.cjs')
        cwd = $cwd; environment = $targetEnv
        sha256 = @{
            launcher = $plan.launcherSha256; pwsh = $plan.pwshSha256
            node = $plan.nodeSha256; entry = $entryHash; rehearsal = $fixtureHash
        }
        limitsMs = @{
            bootstrap = 30000; query = 45000; dispose = 10000
            total = 60000; recovery = 5000; evidenceDrain = 2000
        }
    }

    $phase = 'bridge'
    Add-Type -TypeDefinition $bridge -Language CSharp
    [Major03Rev04]::CheckAbi()
    $phase = 'job_create'
    $job = [Major03Rev04]::NewJob()

    $phase = 'worker_bootstrap'
    $nonce = [Convert]::ToHexString(
        [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    ).ToLowerInvariant()
    $pipeName = "major03-d0-$id"
    $options = [IO.Pipes.PipeOptions]::Asynchronous -bor [IO.Pipes.PipeOptions]::CurrentUserOnly
    $pipe = [IO.Pipes.NamedPipeServerStream]::new(
        $pipeName, [IO.Pipes.PipeDirection]::InOut, 1,
        [IO.Pipes.PipeTransmissionMode]::Byte, $options
    )

    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $pwsh
    $psi.WorkingDirectory = $cwd
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($argument in @('-NoLogo','-NoProfile','-NonInteractive','-File',$self,'-Worker')) {
        $psi.ArgumentList.Add($argument)
    }
    $psi.Environment.Clear()
    $workerEnv = Make-Environment $root
    $workerEnv.D0_PIPE = $pipeName
    $workerEnv.D0_NONCE = $nonce
    $workerEnv.D0_SUPERVISOR_PID = [string] $PID
    $identity = [Diagnostics.Process]::GetCurrentProcess()
    try { $workerEnv.D0_SUPERVISOR_CREATED = [Major03Rev04]::CreatedUtc($identity.Handle) }
    finally { $identity.Dispose() }
    foreach ($key in $workerEnv.Keys) { $psi.Environment[$key] = $workerEnv[$key] }

    $workerOut = [IO.File]::Open(
        (Join-Path $evidence 'worker-stdout.raw'), [IO.FileMode]::CreateNew)
    $workerErr = [IO.File]::Open(
        (Join-Path $evidence 'worker-stderr.raw'), [IO.FileMode]::CreateNew)

    $boot = [Diagnostics.Stopwatch]::StartNew()
    $facts.workerStart = 'ATTEMPTED'
    $facts.workerState = 'UNKNOWN'
    # WORKER_CREATE
    $workerProcess = [Diagnostics.Process]::Start($psi)
    if (-not $workerProcess) { throw 'Worker start returned no process object' }
    $facts.workerStart = 'CREATED'
    $facts.capture.stdout.state = 'CAPTURE_NOT_STARTED'
    $facts.capture.stderr.state = 'CAPTURE_NOT_STARTED'
    $stdoutTask = $workerProcess.StandardOutput.BaseStream.CopyToAsync($workerOut)
    $facts.capture.stdout.state = 'CAPTURE_IN_PROGRESS'
    $stderrTask = $workerProcess.StandardError.BaseStream.CopyToAsync($workerErr)
    $facts.capture.stderr.state = 'CAPTURE_IN_PROGRESS'
    $workerHandle = $workerProcess.Handle
    $facts.workerPid = [Major03Rev04]::ProcessId($workerHandle)
    $facts.workerCreatedUtc = [Major03Rev04]::CreatedUtc($workerHandle)

    Wait-Bootstrap ($pipe.WaitForConnectionAsync()) $boot | Out-Null
    if ([Major03Rev04]::ClientPid($pipe.SafePipeHandle.DangerousGetHandle()) -ne $facts.workerPid) {
        throw 'Unexpected pipe client'
    }
    $reader = [IO.StreamReader]::new($pipe, $utf8, $false, 4096, $true)
    $writer = [IO.StreamWriter]::new($pipe, $utf8, 4096, $true)
    $writer.AutoFlush = $true
    $armed = Decode-Control (Wait-Bootstrap ($reader.ReadLineAsync()) $boot)
    if ($armed.kind -cne 'armed' -or $armed.nonce -cne $nonce) {
        throw 'Worker authentication failed'
    }

    $phase = 'control'
    $remoteJob = [Major03Rev04]::GiveJob($job, $workerHandle)
    $facts.startUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $watch = [Diagnostics.Stopwatch]::StartNew()
    Log-Fact 'create_permit' @{ workerPid = $facts.workerPid; createdUtc = $facts.workerCreatedUtc }
    Require-Trace
    $facts.createPermit = $true
    $facts.rootState = 'EXIT_UNKNOWN'
    Send-Control $writer @{
        kind = 'create'; nonce = $nonce; jobHandle = $remoteJob
        mode = $mode; exe = $exe; argument = '.\rehearsal.cjs'
        cwd = $cwd; stdout = $stdout; stderr = $stderr
        nodeSha256 = $plan.nodeSha256; rehearsalSha256 = $fixtureHash
    }

    $controlTask = $reader.ReadLineAsync()
    $protocol = 'await_suspended'
    $names = @('ready','query_ok','dispose_start','dispose_ok','smoke_complete')
    $eventIndex = 0
    $disposeAt = $null
    $bytes = [byte[]]::new(4096)
    $partial = [Collections.Generic.List[byte]]::new()

    while ($true) {
        $now = $watch.ElapsedMilliseconds
        if ($now -ge 60000) { throw 'TOTAL_DEADLINE' }
        if ($eventIndex -lt 2 -and $now -ge 45000) { throw 'QUERY_DEADLINE' }
        if ($null -ne $disposeAt -and $eventIndex -lt 4 -and
            $now - $disposeAt -ge 10000) { throw 'DISPOSE_DEADLINE' }

        if ($controlTask -and $controlTask.IsCompleted) {
            $line = $controlTask.GetAwaiter().GetResult()
            if ($null -eq $line) {
                $controlTask = $null
                $facts.controlEof = $true
            } else {
                $message = Decode-Control $line
                Log-Fact 'worker_control' $message
                Require-Trace
                switch -CaseSensitive ($message.kind) {
                    'suspended' {
                        if ($protocol -cne 'await_suspended') { throw 'Unexpected suspended event' }
                        $reportedPid = [uint32] $message.pid
                        $candidate = [IntPtr]::Zero
                        try {
                            $candidate = [Major03Rev04]::Observe($reportedPid)
                            $created = [Major03Rev04]::CreatedUtc($candidate)
                            if ([Major03Rev04]::ProcessId($candidate) -ne $reportedPid -or
                                $created -cne $message.createdUtc -or
                                -not [Major03Rev04]::InJob($candidate, $job) -or
                                [Major03Rev04]::Exited($candidate)) {
                                throw 'Root identity, Job membership or liveness mismatch'
                            }
                            $targetHandle = $candidate
                            $candidate = [IntPtr]::Zero
                            $facts.rootPid = $reportedPid
                            $facts.rootCreatedUtc = $created
                            $facts.rootState = 'ACTIVE'
                        } finally {
                            if ($candidate -ne [IntPtr]::Zero) {
                                try { [Major03Rev04]::Close($candidate) }
                                catch { Add-Fault 'close_unverified_root_handle' $_ }
                            }
                        }

                        $protocol = 'await_resumed'
                        Log-Fact 'resume_permit' @{ pid = $facts.rootPid; createdUtc = $facts.rootCreatedUtc }
                        Require-Trace
                        if ($watch.ElapsedMilliseconds -ge 45000) { throw 'QUERY_DEADLINE' }
                        $facts.resumePermit = $true
                        Send-Control $writer @{ kind = 'resume'; nonce = $nonce }
                    }
                    'resumed' {
                        if ($protocol -cne 'await_resumed' -or $message.pid -ne $facts.rootPid) {
                            throw 'Unexpected resumed event'
                        }
                        $facts.resumed = $true
                        $protocol = 'await_root_exit'
                    }
                    'root_exited' {
                        if ($protocol -cne 'await_root_exit' -or $message.pid -ne $facts.rootPid) {
                            throw 'Unexpected root exit event'
                        }
                        $facts.rootExitNotice = $true
                        $protocol = 'finished'
                    }
                    'error' {
                        $facts.controlErrors.Add($message)
                        if ($protocol -ceq 'await_suspended' -and $mode -ceq 'start-fail' -and
                            $message.phase -ceq 'create_target' -and $message.native -and
                            $message.native.code -eq 2 -and
                            $message.native.operation -ceq 'CreateProcessW') {
                            $facts.createFailureReported = $true
                            $protocol = 'expected_create_failure'
                        } else { throw 'WORKER_ERROR' }
                    }
                    default { throw 'Unknown control event' }
                }
                $controlTask = $reader.ReadLineAsync()
            }
        }

        if (-not $rawReader -and [IO.File]::Exists($stdout)) {
            $rawReader = [IO.File]::Open($stdout, [IO.FileMode]::Open,
                [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        }
        $read = if ($rawReader) { $rawReader.Read($bytes, 0, $bytes.Length) } else { 0 }
        for ($index = 0; $index -lt $read; $index++) {
            if ($bytes[$index] -ne 10) {
                $partial.Add($bytes[$index])
                if ($partial.Count -gt 65536) { throw 'Oversize target event' }
                continue
            }

            $line = $utf8.GetString($partial.ToArray()).TrimEnd("`r")
            $partial.Clear()
            $event = Decode-Control $line
            $seen = $watch.ElapsedMilliseconds
            if ($seen -ge 60000) { throw 'TOTAL_DEADLINE' }
            if ($eventIndex -lt 2 -and $seen -ge 45000) { throw 'QUERY_DEADLINE' }
            if ($null -ne $disposeAt -and $eventIndex -lt 4 -and
                $seen - $disposeAt -ge 10000) { throw 'DISPOSE_DEADLINE' }
            if (-not $facts.resumePermit) { throw 'Target event before resume permit' }

            if ($event.event -ceq 'child_started') {
                if ($mode -cnotin @('short-child','timeout') -or $eventIndex -ne 1 -or
                    $facts.observedChildPid -or $event.parentPid -ne $facts.rootPid -or
                    [uint32] $event.pid -eq 0) { throw 'Unexpected child start event' }
                $facts.observedChildPid = [uint32] $event.pid
                $facts.childStartObservedMs = $seen
            } elseif ($event.event -ceq 'child_exited') {
                if ($mode -cne 'short-child' -or $eventIndex -ne 1 -or
                    $facts.observedChildExit -or -not $facts.observedChildPid -or
                    $event.pid -ne $facts.observedChildPid -or $event.code -ne 0 -or
                    $null -ne $event.signal) { throw 'Unexpected child exit event' }
                $facts.observedChildExit = $true
            } else {
                if ($eventIndex -ge $names.Count -or $event.event -cne $names[$eventIndex]) {
                    throw 'Invalid target event sequence'
                }
                if ($event.event -ceq 'ready') {
                    $url = [uri] $event.endpoint
                    if ($url.Scheme -cne 'http' -or $url.Host -cne '127.0.0.1' -or
                        $url.Port -lt 1 -or $event.syntheticEndpoint -isnot [bool] -or
                        $event.syntheticEndpoint -ne ($mode -cne 'loopback')) {
                        throw 'Unexpected ready endpoint'
                    }
                    if ($mode -ceq 'loopback') {
                        if (-not (Test-Listener $url.Port)) { throw 'Loopback snapshot missing' }
                        $facts.listenerSnapshotPort = $url.Port
                        Log-Fact 'listener_snapshot' @{ port = $url.Port; owner = 'UNKNOWN' }
                        Require-Trace
                        [IO.File]::WriteAllText($release, 'snapshot-recorded')
                    }
                }
                if ($event.event -ceq 'query_ok' -and
                    ($event.ok -isnot [ValueType] -or $event.ok -is [bool] -or $event.ok -ne 1)) {
                    throw 'Invalid query result'
                }
                if ($event.event -ceq 'dispose_start') { $disposeAt = $seen }
                $eventIndex++
            }
            Log-Fact 'target_event' @{ observedMs = $seen; record = $event }
            Require-Trace
        }

        $phase = 'accounting'
        Refresh-Worker
        Refresh-Root
        Refresh-Job
        $phase = 'control'

        if ($facts.workerState -ceq 'EXIT_CONFIRMED' -and $facts.controlEof -and $read -eq 0) {
            if ($facts.createFailureReported) {
                if ($protocol -cne 'expected_create_failure' -or $facts.workerExit -ne 1 -or
                    $facts.resumePermit -or $targetHandle -ne [IntPtr]::Zero -or
                    $eventIndex -ne 0 -or $partial.Count -ne 0 -or
                    -not (Test-JobEmptyAfterWorker) -or $facts.jobCurrent.total -ne 0 -or
                    -not [IO.File]::Exists($stdout) -or -not [IO.File]::Exists($stderr) -or
                    (Get-Item -LiteralPath $stdout).Length -ne 0 -or
                    (Get-Item -LiteralPath $stderr).Length -ne 0) {
                    throw 'Negative create evidence mismatch'
                }
                if ($watch.ElapsedMilliseconds -ge 45000) { throw 'QUERY_DEADLINE' }
                $facts.negativeCreateVerified = $true
                $facts.rootState = 'CONFIRMED_NOT_CREATED'
                $facts.failureKind = 'EXPECTED_CREATE_FILE_NOT_FOUND'
                break
            }

            if ($protocol -cne 'finished' -or -not $facts.rootExitNotice -or
                $facts.rootState -cne 'EXIT_CONFIRMED' -or $facts.workerExit -ne 0 -or
                $facts.rootExit -ne 0) { throw 'Incomplete root or Worker exit' }
            if (-not (Test-JobEmptyAfterWorker)) { throw 'DESCENDANTS_REMAIN' }
            if ($eventIndex -ne 5 -or $partial.Count -ne 0) { throw 'Incomplete target events' }
            if ($facts.listenerSnapshotPort) {
                if (Test-Listener $facts.listenerSnapshotPort) { throw 'Loopback port remains present' }
                $facts.listenerReleaseSnapshot = $true
                Log-Fact 'listener_release_snapshot' @{ port = $facts.listenerSnapshotPort }
                Require-Trace
            }
            if ($watch.ElapsedMilliseconds -ge 60000) { throw 'TOTAL_DEADLINE' }
            $facts.localEventsComplete = $true
            break
        }
        Start-Sleep -Milliseconds 20
    }
} catch {
    Add-Fault $phase $_
    if ($_.Exception.Message -cin @('QUERY_DEADLINE','DISPOSE_DEADLINE','TOTAL_DEADLINE',
                                   'DESCENDANTS_REMAIN','BOOTSTRAP_DEADLINE','WORKER_ERROR')) {
        $facts.failureKind = $_.Exception.Message
    } elseif ($phase -ceq 'accounting') {
        $facts.failureKind = 'JOB_OR_EXIT_OBSERVATION'
    } elseif (-not $facts.failureKind) {
        $facts.failureKind = 'FAILED_' + $phase.ToUpperInvariant()
    }
} finally {
    $beforeCleanupErrors = $facts.errors.Count

    try { Invoke-Recovery }
    catch {
        $facts.recovery = 'RECOVERY_UNKNOWN'
        Add-Fault 'recovery_driver' $_
        # Supervisor still owns the specific Job even if observation failed.
        if ($job -ne [IntPtr]::Zero) {
            try { [Major03Rev04]::KillJob($job) }
            catch { Add-Fault 'recovery_fallback_job' $_ }
        }
    }

    try { Drain-WorkerEvidence }
    catch { Add-Fault 'worker_evidence' $_ }

    foreach ($item in @($rawReader, $writer, $reader, $pipe)) {
        try { if ($item) { $item.Dispose() } }
        catch { Add-Fault 'close_observer' $_ }
    }
    foreach ($handle in @($targetHandle, $job)) {
        if ($handle -ne [IntPtr]::Zero) {
            try { [Major03Rev04]::Close($handle) }
            catch { Add-Fault 'close_native' $_ }
        }
    }
    foreach ($item in @($workerOut, $workerErr, $workerProcess)) {
        try { if ($item) { $item.Dispose() } }
        catch { Add-Fault 'close_worker_resources' $_ }
    }

    # FINAL_SEAL: unresolved writers leave their data in place and unsealed.
    $allWritersClosed = $facts.workerState -ceq 'EXIT_CONFIRMED' -and
        $facts.rootState -cin @('EXIT_CONFIRMED','CONFIRMED_NOT_CREATED') -and
        (Test-JobEmptyAfterWorker) -and
        $facts.recovery -cnotin @('RECOVERY_UNKNOWN','RECOVERY_FAILED')
    $captureComplete = $facts.capture.stdout.state -ceq 'CAPTURE_COMPLETE' -and
        $facts.capture.stderr.state -ceq 'CAPTURE_COMPLETE'

    if ($evidence -and $allWritersClosed -and $captureComplete -and
        $facts.errors.Count -eq $beforeCleanupErrors) {
        try {
            Save-Json (Join-Path $evidence 'raw-hashes.json') @{
                stdout = (Get-Sha $stdout); stderr = (Get-Sha $stderr)
                workerStdout = (Get-Sha (Join-Path $evidence 'worker-stdout.raw'))
                workerStderr = (Get-Sha (Join-Path $evidence 'worker-stderr.raw'))
            }
            $facts.targetRawSealed = $true

            if ($null -eq $before) { throw 'Missing protected baseline' }
            $after = Get-Inventory $protected
            Save-Json (Join-Path $evidence 'after.json') $after
            $facts.protectedChanges = @(
                foreach ($key in (@($before.Keys) + @($after.Keys) |
                                   Sort-Object -CaseSensitive -Unique)) {
                    if (-not $before.ContainsKey($key) -or -not $after.ContainsKey($key) -or
                        $before[$key] -cne $after[$key]) { $key }
                }
            )
            Save-Json (Join-Path $evidence 'run-inventory.json') (Get-Inventory @(
                (Join-Path $root 'input'), (Join-Path $root 'state'),
                (Join-Path $root 'runtime-tmp'), (Join-Path $root 'temp'),
                (Join-Path $root 'profile')
            ))
            $facts.finalInventorySealed = $true
        } catch { Add-Fault 'final_inventory' $_ }
    }
    $facts.endUtc = [DateTimeOffset]::UtcNow.ToString('o')
}

function Get-FinalResult {
    $closureFaults = $facts.errors.Count -gt $beforeCleanupErrors -or
        @($facts.errors | Where-Object {
            $_.phase -cin @('trace','close_unverified_root_handle')
        }).Count -gt 0
    $qualified = $traceWritable -and $facts.targetRawSealed -and
        $facts.finalInventorySealed -and $facts.protectedChanges.Count -eq 0 -and
        -not $closureFaults

    $startNegative = $mode -ceq 'start-fail' -and $facts.negativeCreateVerified -and
        $facts.rootState -ceq 'CONFIRMED_NOT_CREATED' -and
        $facts.failureKind -ceq 'EXPECTED_CREATE_FILE_NOT_FOUND' -and
        $facts.controlEof -and $facts.workerExit -eq 1 -and
        (Test-JobEmptyAfterWorker) -and $facts.jobCurrent.total -eq 0 -and
        $facts.recovery -ceq 'NOT_NEEDED' -and $qualified

    $normalExit = $facts.localEventsComplete -and $facts.resumed -and
        $facts.rootState -ceq 'EXIT_CONFIRMED' -and $facts.rootExit -eq 0 -and
        $facts.workerState -ceq 'EXIT_CONFIRMED' -and $facts.workerExit -eq 0 -and
        (Test-JobEmptyAfterWorker) -and $facts.recovery -ceq 'NOT_NEEDED'

    $ready = @($facts.events | Where-Object {
        $_.kind -ceq 'target_event' -and $_.details.record.event -ceq 'ready'
    })
    $query = @($facts.events | Where-Object {
        $_.kind -ceq 'target_event' -and $_.details.record.event -ceq 'query_ok'
    })
    $timeoutCandidate = $mode -ceq 'timeout' -and
        $facts.failureKind -ceq 'QUERY_DEADLINE' -and $facts.resumed -and
        $facts.rootState -ceq 'EXIT_CONFIRMED' -and $null -ne $facts.rootExit -and
        $facts.workerState -ceq 'EXIT_CONFIRMED' -and $null -ne $facts.workerExit -and
        $facts.rootCreatedUtc -and $facts.workerCreatedUtc -and
        $facts.rootExitObservedUtc -and $facts.workerExitObservedUtc -and
        $facts.observedChildPid -and $null -ne $facts.childStartObservedMs -and
        $facts.childStartObservedMs -lt 45000 -and
        $ready.Count -eq 1 -and $ready[0].details.record.syntheticEndpoint -eq $true -and
        $query.Count -eq 0 -and
        (Test-JobEmptyAfterWorker) -and $facts.jobCurrent.total -eq 2 -and
        $facts.recovery -ceq 'JOB_RECOVERY_CONFIRMED' -and
        $null -ne $facts.recoveryMs -and $facts.recoveryMs -lt 5000 -and $qualified

    $launcher = 'LAUNCHER_BLOCKED'
    $rehearsal = if ($mode -cin $modes) { 'REHEARSAL_BLOCKED' } else { 'NOT_RUN' }

    if ($startNegative) {
        $rehearsal = 'REHEARSAL_PASS'
    } elseif ($timeoutCandidate) {
        $launcher = 'LAUNCHER_FAIL'
    } elseif ($normalExit -and $qualified -and -not $facts.failureKind) {
        switch -CaseSensitive ($mode) {
            'normal' {
                if ($facts.jobCurrent.total -eq 1) {
                    $launcher = 'LAUNCHER_PASS'
                    $rehearsal = 'REHEARSAL_PASS'
                } else {
                    $launcher = 'LAUNCHER_FAIL'
                    $rehearsal = 'REHEARSAL_FAIL'
                }
            }
            'short-child' {
                if ($facts.jobCurrent.total -eq 2 -and $facts.observedChildPid -and
                    $facts.observedChildExit) {
                    $launcher = 'LAUNCHER_PASS'
                } else {
                    $launcher = 'LAUNCHER_FAIL'
                    $rehearsal = 'REHEARSAL_FAIL'
                }
            }
            'loopback' {
                if ($facts.jobCurrent.total -eq 1 -and $facts.listenerSnapshotPort -and
                    $facts.listenerReleaseSnapshot) {
                    $launcher = 'LAUNCHER_PASS'
                } else {
                    $launcher = 'LAUNCHER_FAIL'
                    $rehearsal = 'REHEARSAL_FAIL'
                }
            }
            default {
                $launcher = 'LAUNCHER_FAIL'
                $rehearsal = 'REHEARSAL_FAIL'
            }
        }
    } elseif ($facts.resumePermit -or $closureFaults -or $facts.protectedChanges.Count -or
              $facts.recovery -cin @('RECOVERY_UNKNOWN','RECOVERY_FAILED') -or
              $facts.createFailureReported -or
              ($facts.workerStart -ceq 'CREATED' -and
               ($facts.capture.stdout.state -cne 'CAPTURE_COMPLETE' -or
                $facts.capture.stderr.state -cne 'CAPTURE_COMPLETE'))) {
        $launcher = 'LAUNCHER_FAIL'
        if ($facts.createPermit) { $rehearsal = 'REHEARSAL_FAIL' }
    } elseif ($facts.createPermit) {
        $rehearsal = 'REHEARSAL_FAIL'
    }

    $code = switch -CaseSensitive ($launcher) {
        'LAUNCHER_PASS' { 0 }
        'LAUNCHER_FAIL' { 1 }
        default { 2 }
    }

    return [ordered]@{
        schema = 4
        launcher = $launcher
        rehearsal = $rehearsal
        d0 = 'D0_BLOCKED'
        exitCode = $code
        recovery = $facts.recovery
        timeoutLocalCandidate = [bool] $timeoutCandidate
        evidenceDirectory = $evidence
        resultFileCommitted = $false
        stdoutDelivery = 'VERIFY_FROM_CAPTURE'
        externalAcceptance = 'PENDING'
        facts = $facts
    }
}

function Publish-Result($Result) {
    # resultFileCommitted=true is effective only for the payload successfully
    # moved to the final path. A pending file is never a committed result.
    $committed = $false
    $pending = $null
    try {
        if ($evidence) {
            $path = Join-Path $evidence 'result.json'
            $pending = Join-Path $evidence (
                'result.pending-' + [guid]::NewGuid().ToString('N') + '.json'
            )

            $document = [ordered]@{}
            foreach ($key in $Result.Keys) { $document[$key] = $Result[$key] }
            $document.resultFileCommitted = $true
            $json = ConvertTo-Json -InputObject $document -Depth 25 -Compress
            $payload = $utf8.GetBytes($json + "`n")
            $stream = [IO.File]::Open($pending, [IO.FileMode]::CreateNew,
                [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $stream.Write($payload, 0, $payload.Length)
                $stream.Flush($true)
            } finally { $stream.Dispose() }

            [IO.File]::Move($pending, $path, $false)
            $committed = $true
            $Result.resultFileCommitted = $true
        } else {
            if ($Result.launcher -ceq 'LAUNCHER_PASS' -or $Result.rehearsal -ceq 'REHEARSAL_PASS') {
                throw 'No evidence directory for successful outcome'
            }
            $json = ConvertTo-Json -InputObject $Result -Depth 25 -Compress
        }
    } catch {
        if ($committed) { throw }
        $Result.resultFileCommitted = $false
        $Result.launcher = 'LAUNCHER_FAIL'
        if ($facts.createPermit) { $Result.rehearsal = 'REHEARSAL_FAIL' }
        $Result.exitCode = 1
        $Result.publicationError = $_.Exception.Message
        $Result.pendingResultPath = $pending
        $json = ConvertTo-Json -InputObject $Result -Depth 25 -Compress
    }

    try {
        # Console writers can suppress I/O errors. Write encoded bytes directly.
        $standardOutput = [Console]::OpenStandardOutput()
        $bytes = $utf8.GetBytes($json + "`n")
        $standardOutput.Write($bytes, 0, $bytes.Length)
        $standardOutput.Flush()
    } catch {
        try { [Console]::Error.WriteLine("RESULT_STDOUT_FAILED: $($_.Exception.Message)") }
        catch { }
        return 1
    }
    return [int] $Result.exitCode
}

$result = Get-FinalResult
exit (Publish-Result $result)
