import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { commitCache, executeRelationImport, ImportFailure, type WriteHooks } from '../scripts/lib/relation-import-engine.ts';

const nativeError = (code: string) => Object.assign(new Error('not persisted'), { code, errno: -1, syscall: 'rename', path: 'synthetic/source.tmp', dest: 'synthetic/cache.json' });
async function fixture(run: (file: string, original: string, dir: string) => Promise<void>) {
    const dir = await fs.mkdtemp(join(tmpdir(), 'bgg-replace-'));
    const file = join(dir, 'cache.json'), original = '{"seed":true}';
    await fs.writeFile(file, original);
    try { await run(file, original, dir); }
    finally { await fs.rm(dir, { recursive: true, force: true }); }
}
async function rejected(file: string, original: string, hooks: WriteHooks) {
    try { await commitCache(file, original, { next: true }, { sleep: async () => {}, ...hooks }); assert.fail('expected refusal'); }
    catch (error) { assert.ok(error instanceof ImportFailure); return error; }
}
async function intact(file: string, original: string, dir: string) {
    assert.equal(await fs.readFile(file, 'utf8'), original);
    for (const name of await fs.readdir(dir)) {
        if (name.endsWith('.bak')) assert.equal(await fs.readFile(join(dir, name), 'utf8'), original);
        assert.ok(!name.endsWith('.tmp') && !name.endsWith('.lock'));
    }
}
test('real filesystem: single and ten consecutive replacements', async () => fixture(async (file, original, dir) => {
    let previous = original;
    for (let i = 0; i < 11; i++) {
        const saved = await commitCache(file, previous, { i });
        assert.equal(await fs.readFile(saved.backup, 'utf8'), previous);
        previous = saved.bytes;
        assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { i });
    }
    assert.equal((await fs.readdir(dir)).filter(x => x.endsWith('.bak')).length, 11);
    assert.ok(!(await fs.readdir(dir)).some(x => /\.(tmp|lock)$/.test(x)));
}));
for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    test(`mock ${code}: first refusal, guarded second success`, async () => fixture(async (file, original) => {
        let calls = 0; const waits: number[] = [];
        const saved = await commitCache(file, original, { next: true }, {
            replace: async (a,b) => { if (++calls === 1) throw nativeError(code); await fs.rename(a,b); },
            sleep: async ms => { waits.push(ms); }
        });
        assert.equal(calls, 2); assert.deepEqual(waits, [200]);
        assert.equal(saved.diagnostics[0].code, code); assert.equal(saved.diagnostics[0].retryable, true);
        assert.equal(saved.diagnostics[0].errno, -1); assert.equal(saved.diagnostics[0].syscall, 'rename');
        assert.equal(saved.diagnostics[0].path, 'source.tmp');
        assert.equal(await fs.readFile(file, 'utf8'), saved.bytes);
    }));
    test(`mock ${code}: bounded exhaustion preserves original`, async () => fixture(async (file, original, dir) => {
        let calls = 0; const waits: number[] = [];
        const error = await rejected(file, original, { replace: async () => { calls++; throw nativeError(code); }, sleep: async ms => { waits.push(ms); } });
        assert.equal(error.code, `CACHE_REPLACE_${code}`); assert.equal(calls, 3); assert.deepEqual(waits, [200,500]);
        assert.equal(error.diagnostics.length, 3); assert.equal(error.diagnostics[2].attempt, 3);
        await intact(file, original, dir);
    }));
}
test('mock non-candidate EIO never retries', async () => fixture(async (file, original, dir) => {
    let calls = 0; await rejected(file, original, { replace: async () => { calls++; throw nativeError('EIO'); } });
    assert.equal(calls, 1); await intact(file, original, dir);
}));
for (const change of ['destination', 'temp-missing', 'temp-altered', 'backup']) test(`retry refuses ${change} mutation`, async () => fixture(async (file, original, dir) => {
    let calls = 0; let temp = '';
    await rejected(file, original, {
        replace: async source => { calls++; temp = String(source); throw nativeError('EPERM'); },
        sleep: async () => {
            if (change === 'destination') await fs.writeFile(file, '{"external":true}');
            else if (change === 'temp-missing') await fs.unlink(temp);
            else if (change === 'temp-altered') await fs.writeFile(temp, '{}');
            else await fs.writeFile(temp.replace(/\.tmp$/, '.bak'), '{}');
        }
    });
    assert.equal(calls, 1);
    assert.equal(await fs.readFile(file, 'utf8'), change === 'destination' ? '{"external":true}' : original);
    assert.ok(!(await fs.readdir(dir)).some(x => x.endsWith('.tmp')));
}));
test('backup failure preserves destination', async () => fixture(async (file, original) => {
    const error = await rejected(file, original, { beforeValidate: async temp => { await fs.mkdir(temp.replace(/\.tmp$/, '.bak')); } });
    assert.equal(error.diagnostics[0].stage, 'BACKUP_OPEN'); assert.equal(await fs.readFile(file, 'utf8'), original);
}));
test('cleanup failure is secondary; deliberate temp residue is observable', async () => fixture(async (file, original, dir) => {
    const error = await rejected(file, original, { replace: async () => { throw nativeError('EIO'); }, unlink: async () => { throw nativeError('EACCES'); } });
    assert.equal(error.code, 'CACHE_REPLACE_EIO');
    assert.equal(error.diagnostics[0].cleanupErrors[0].code, 'EACCES');
    assert.equal(await fs.readFile(file, 'utf8'), original);
    assert.equal((await fs.readdir(dir)).filter(x => x.endsWith('.tmp')).length, 1);
}));
test('cooperative lock held by independent Node process refuses import before HTTP', async () => fixture(async (file, original, dir) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e',
        "import fs from 'node:fs/promises';const h=await fs.open(process.argv[1],'wx');process.stdout.write('READY');process.stdin.once('data',async()=>{await h.close();await fs.unlink(process.argv[1]);process.exit(0)});setTimeout(()=>process.exit(2),10000);", file + '.import.lock'], { stdio: ['pipe','pipe','ignore'] });
    try {
        const [data] = await once(child.stdout, 'data'); assert.equal(String(data), 'READY');
        await assert.rejects(executeRelationImport(file, 1, 1, { token: 'SYNTHETIC', fetch: async () => { throw new Error('forbidden'); } }), (e: unknown) => e instanceof ImportFailure && e.code === 'CACHE_LOCKED' && e.diagnostics[0].stage === 'LOCK');
        const exited = once(child, 'exit'); child.stdin.end('release'); assert.equal((await exited)[0], 0);
        await intact(file, original, dir);
    } finally { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
}));
test('Windows actual non-share-delete FileStream blocks rename, then safe retry succeeds', { skip: process.platform !== 'win32' }, async t => fixture(async (file, original, dir) => {
    const script = join(dir, 'hold.ps1');
    await fs.writeFile(script, "$h=[IO.File]::Open($args[0],[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); try { [Console]::Out.WriteLine('READY'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $h.Dispose() }");
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-File',script,file], { stdio: ['pipe','pipe','ignore'] });
    try {
        const [data] = await once(child.stdout, 'data'); assert.equal(String(data).trim(), 'READY');
        let observed: string | undefined;
        const saved = await commitCache(file, original, { next: true }, {
            replace: async (a,b) => { try { await fs.rename(a,b); } catch (error) { observed = (error as NodeJS.ErrnoException).code; throw error; } },
            sleep: async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.stdin.end('release\n'); assert.equal((await exited)[0], 0); } }
        });
        assert.ok(['EPERM','EACCES','EBUSY'].includes(observed ?? ''));
        assert.equal(saved.diagnostics.length, 1); assert.equal(saved.diagnostics[0].syscall, 'rename');
        t.diagnostic(JSON.stringify({ kind: 'WINDOWS_NATIVE_OCCUPANCY', ...saved.diagnostics[0] }));
        assert.equal(await fs.readFile(file, 'utf8'), saved.bytes);
        assert.equal(await fs.readFile(saved.backup, 'utf8'), original);
        assert.ok(!(await fs.readdir(dir)).some(x => /\.(tmp|lock)$/.test(x)));
    } finally { if (child.exitCode === null) { const exited = once(child, 'exit'); child.stdin.end('release\n'); await exited; } }
}));
test('post-replacement readback refuses unexpected destination content', async () => fixture(async (file, original) => {
    const error = await rejected(file, original, { replace: async (a,b) => { await fs.rename(a,b); await fs.writeFile(b, '{"external":true}'); } });
    assert.equal(error.code, 'CACHE_COMMIT_VERIFY_FAILED');
    assert.equal(await fs.readFile(file, 'utf8'), '{"external":true}'); // Never overwrite a non-cooperating external edit.
}));
test('abort during replacement delay prevents further attempts', async () => fixture(async (file, original, dir) => {
    const controller = new AbortController(); let calls = 0;
    await rejected(file, original, { signal: controller.signal, replace: async () => { calls++; throw nativeError('EPERM'); }, sleep: async () => { controller.abort(); } });
    assert.equal(calls, 1); await intact(file, original, dir);
}));
