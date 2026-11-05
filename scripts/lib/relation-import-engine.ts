import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { XMLValidator, XMLParser } from 'fast-xml-parser';
import { parseBggGameXml } from '../../src/lib/bgg-parser.ts';
import { cachedGameIssues, planRelationImport } from '../../src/lib/relation-import-plan.ts';

export interface StorageDiagnostic {
    operation: string; stage: string; code: string; errno: number | 'unavailable'; syscall: string;
    path: string; dest: string; attempt: number; maxAttempts: number; elapsedMs: number;
    retryable: boolean; cleanupErrors: StorageDiagnostic[];
}
export class ImportFailure extends Error {
    constructor(public readonly code: string, public readonly diagnostics: StorageDiagnostic[] = []) { super(code); }
}
function storageDiagnostic(error: unknown, stage: string, operation: string, started: number, attempt = 1, maxAttempts = 1, detailed = false): StorageDiagnostic {
    const e = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const path = (value: unknown) => typeof value === 'string' && value.length <= 32768 && !/[\r\n\0]/.test(value)
        ? detailed ? value : basename(value) : 'unavailable';
    return { stage, operation, code: typeof e.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(e.code) ? e.code : 'IO_FAILED',
        errno: typeof e.errno === 'number' && Number.isSafeInteger(e.errno) ? e.errno : 'unavailable',
        syscall: typeof e.syscall === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(e.syscall) ? e.syscall : 'unavailable',
        path: path(e.path), dest: path(e.dest), attempt, maxAttempts, elapsedMs: Date.now() - started,
        retryable: false, cleanupErrors: [] };
}
const fail = (code: string): never => { throw new ImportFailure(code); };
export function validateGameXml(xml: string, id: number) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) fail('XML_INVALID');
    let item;
    try { item = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(xml)?.items?.item; }
    catch { return fail('XML_INVALID'); }
    if (!item || Array.isArray(item)) fail('XML_ITEM_INVALID');
    if (Number(item.id) !== id) fail('ID_MISMATCH');
    if (!['boardgame', 'boardgameexpansion', 'boardgameaccessory'].includes(item.type)) fail('GAME_TYPE_INVALID');
    let game;
    try { game = parseBggGameXml(xml); } catch { return fail('PARSE_FAILED'); }
    if (cachedGameIssues(game, id).length) fail('GAME_DATA_INVALID');
    return game;
}
export interface RequestOptions {
    token: string; signal?: AbortSignal; intervalMs?: number; maxAttempts?: number; timeoutMs?: number;
    fetch?: typeof fetch; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    targetIds?: readonly number[];
    stopOnFailure?: boolean;
    onAttempt?: (event: { id: number; attempt: number; httpStatus?: number; errorCode?: string }) => void;
}
export function createGameRequester(options: RequestOptions) {
    const interval = options.intervalMs ?? 2000, attempts = options.maxAttempts ?? 5, timeout = options.timeoutMs ?? 30000;
    if (!Number.isSafeInteger(interval) || interval < 0 || !Number.isInteger(attempts) || attempts < 1 || attempts > 10 || !Number.isInteger(timeout) || timeout < 1) fail('REQUEST_CONFIG_INVALID');
    const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
    let requested = false;
    return async (id: number) => {
        for (let attempt = 1; attempt <= attempts; attempt++) {
            options.signal?.throwIfAborted();
            if (requested) await sleep(interval, options.signal);
            requested = true;
            let retryMs = Math.min(5000 * 2 ** (attempt - 1), 120000);
            try {
                const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]);
                const response = await (options.fetch ?? fetch)(`https://boardgamegeek.com/xmlapi2/thing?id=${id}&stats=1`, {
                    headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/xml' }, signal, redirect: 'error'
                });
                options.onAttempt?.({ id, attempt, httpStatus: response.status });
                if (response.status === 202 || response.status === 429 || response.status >= 500) {
                    const header = response.headers.get('retry-after');
                    const seconds = header !== null && /^\d+(\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : NaN;
                    const parsed = Number.isFinite(seconds) ? seconds : header ? Date.parse(header) - Date.now() : NaN;
                    if (Number.isFinite(parsed)) retryMs = Math.max(retryMs, parsed, 0);
                    await response.body?.cancel();
                } else {
                    if (!response.ok) fail(`HTTP_${response.status}`);
                    return validateGameXml(await response.text(), id);
                }
            } catch (error) {
                if (options.signal?.aborted) fail('ABORTED');
                if (error instanceof ImportFailure) throw error;
                options.onAttempt?.({ id, attempt, errorCode: 'TRANSPORT_FAILED' });
                // Transport and body-read timeouts only; validation failures never retry.
            }
            if (attempt === attempts) fail('RETRY_EXHAUSTED');
            // Never shorten Retry-After. Refuse impractical waits rather than retrying early.
            if (retryMs > 86400000) fail('RETRY_AFTER_TOO_LONG');
            await sleep(retryMs, options.signal);
        }
        return fail('RETRY_EXHAUSTED');
    };
}
export type Cache = Record<string, unknown>;
export function scopedRelationPlan(cache: unknown, root: number, limit?: number, scope?: readonly number[]) {
    const full = planRelationImport(cache, root);
    if (!scope) return planRelationImport(cache, root, limit);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) fail('INVALID_LIMIT');
    if (!scope.length || new Set(scope).size !== scope.length || scope.some(id => !Number.isSafeInteger(id) || !full.targets.some(t => t.id === id))) fail('TARGET_SCOPE_INVALID');
    const pendingIds = full.pendingIds.filter(id => scope.includes(id));
    const plannedIds = pendingIds.slice(0, limit);
    return { ...full, limit: limit ?? null, pendingIds, plannedIds, deferredIds: pendingIds.slice(plannedIds.length),
        stats: { ...full.stats, pendingImport: pendingIds.length, plannedCount: plannedIds.length, deferredCount: pendingIds.length - plannedIds.length } };
}
export async function readCache(file: string): Promise<{ cache: Cache; bytes: string }> {
    const bytes = await fs.readFile(file, 'utf8');
    const cache = JSON.parse(bytes);
    if (!cache || typeof cache !== 'object' || Array.isArray(cache)) fail('CACHE_INVALID');
    return { cache, bytes };
}
export interface WriteHooks {
    beforeValidate?: (temp: string) => Promise<void>; replace?: typeof fs.rename;
    unlink?: typeof fs.unlink; sleep?: (ms: number) => Promise<void>;
    /** Full native paths only for caller-owned, access-controlled local evidence. */
    detailedPaths?: boolean;
    signal?: AbortSignal;
}
/** Caller owns the exclusive lock for the entire read/plan/download/commit session. */
export async function commitCache(file: string, previous: string, cache: Cache, hooks: WriteHooks = {}) {
    const tag = randomUUID(), temp = `${file}.${tag}.tmp`, backup = `${file}.${tag}.bak`;
    const json = JSON.stringify(cache, null, 2) + '\n';
    let handle, backupHandle;
    const started = Date.now(), diagnostics: StorageDiagnostic[] = [];
    let primary: ImportFailure | undefined;
    let recordedReplaceError: unknown;
    let attempt = 1;
    let stage = 'TEMP_OPEN';
    try {
        handle = await fs.open(temp, 'wx', 0o600);
        stage = 'TEMP_WRITE';
        await handle.writeFile(json, 'utf8');
        stage = 'TEMP_SYNC'; await handle.sync();
        stage = 'TEMP_CLOSE'; await handle.close(); handle = undefined;
        await hooks.beforeValidate?.(temp);
        stage = 'TEMP_VALIDATE';
        const verified = await fs.readFile(temp, 'utf8');
        JSON.parse(verified);
        if (verified !== json) fail('TEMP_VERIFY_FAILED');
        if (await fs.readFile(file, 'utf8') !== previous) fail('CACHE_CHANGED');
        stage = 'BACKUP_OPEN';
        backupHandle = await fs.open(backup, 'wx', 0o600);
        stage = 'BACKUP_WRITE_SYNC';
        await backupHandle.writeFile(previous, 'utf8'); await backupHandle.sync();
        await backupHandle.close(); backupHandle = undefined;
        stage = 'BACKUP_VERIFY';
        if (await fs.readFile(backup, 'utf8') !== previous) fail('BACKUP_VERIFY_FAILED');
        if (await fs.readFile(file, 'utf8') !== previous) fail('CACHE_CHANGED');
        // Same-directory rename only. Never unlink destination or use delete/copy fallback.
        stage = 'REPLACE';
        for (attempt = 1; attempt <= 3; attempt++) {
            hooks.signal?.throwIfAborted();
            try { await (hooks.replace ?? fs.rename)(temp, file); break; }
            catch (error) {
                recordedReplaceError = error;
                const diagnostic = storageDiagnostic(error, 'REPLACE', 'rename', started, attempt, 3, hooks.detailedPaths);
                diagnostics.push(diagnostic);
                if (!['EPERM', 'EACCES', 'EBUSY'].includes(diagnostic.code) || attempt === 3) throw error;
                await (hooks.sleep ?? (ms => delay(ms)))(attempt === 1 ? 200 : 500);
                hooks.signal?.throwIfAborted();
                // Observational guards, not a CAS: external non-cooperating writers remain a TOCTOU risk.
                stage = 'REPLACE_VERIFY';
                if (await fs.readFile(file, 'utf8') !== previous) fail('CACHE_CHANGED');
                if (await fs.readFile(temp, 'utf8') !== json) fail('TEMP_VERIFY_FAILED');
                if (await fs.readFile(backup, 'utf8') !== previous) fail('BACKUP_VERIFY_FAILED');
                diagnostic.retryable = true; // Eligible only after every integrity guard passes.
                stage = 'REPLACE';
            }
        }
        stage = 'REPLACE_VERIFY';
        if (await fs.readFile(file, 'utf8') !== json) fail('CACHE_COMMIT_VERIFY_FAILED');
    } catch (error) {
        const diagnostic = storageDiagnostic(error, stage, stage === 'REPLACE' ? 'rename' : 'commit', started, attempt, stage === 'REPLACE' ? 3 : 1, hooks.detailedPaths);
        if (stage !== 'REPLACE' || error !== recordedReplaceError) diagnostics.push(diagnostic);
        primary = new ImportFailure(error instanceof ImportFailure ? error.code : `CACHE_${stage}_${diagnostic.code}`, diagnostics);
    } finally {
        const cleanupErrors: StorageDiagnostic[] = [];
        for (const owned of [handle, backupHandle]) {
            if (owned) try { await owned.close(); } catch (error) { cleanupErrors.push(storageDiagnostic(error, 'CLEANUP', 'close', started, 1, 1, hooks.detailedPaths)); }
        }
        try { await (hooks.unlink ?? fs.unlink)(temp); }
        catch (error) {
            if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
                cleanupErrors.push(storageDiagnostic(error, 'CLEANUP', 'unlink', started, 1, 1, hooks.detailedPaths));
        }
        if (cleanupErrors.length) {
            if (diagnostics.length) diagnostics[diagnostics.length - 1].cleanupErrors.push(...cleanupErrors);
            else diagnostics.push(...cleanupErrors);
            primary ??= new ImportFailure('CACHE_CLEANUP_FAILED', diagnostics);
        }
    }
    if (primary) throw primary;
    return { bytes: json, backup, diagnostics };
}
export async function executeRelationImport(file: string, root: number, limit: number | undefined, request: RequestOptions, hooks: WriteHooks = {}) {
    file = await fs.realpath(file);
    const lockPath = file + '.import.lock';
    let lock;
    const lockStarted = Date.now();
    try { lock = await fs.open(lockPath, 'wx', 0o600); } catch (error) { throw new ImportFailure('CACHE_LOCKED', [storageDiagnostic(error, 'LOCK', 'open', lockStarted, 1, 1, hooks.detailedPaths)]); }
    const storageDiagnostics: StorageDiagnostic[] = [];
    let sessionError: unknown;
    let hasPrimaryFailure = false;
    try {
        let { cache, bytes } = await readCache(file);
        const fullPlan = planRelationImport(cache, root); // Immutable depth-one snapshot.
        const scope = request.targetIds;
        const plan = scopedRelationPlan(cache, root, limit, scope);
        const get = createGameRequester(request);
        const results: { id: number; status: string; errorCode?: string }[] = [];
        let interrupted = false;
        let fatalErrorCode: string | undefined;
        for (const id of plan.plannedIds) {
            if (request.signal?.aborted) { interrupted = true; break; }
            let game;
            try { game = await get(id); }
            catch (error) {
                hasPrimaryFailure = true;
                if (request.signal?.aborted) { interrupted = true; break; }
                const errorCode = error instanceof ImportFailure ? error.code : 'REQUEST_FAILED';
                results.push({ id, status: 'FAILED', errorCode });
                if (request.stopOnFailure || errorCode === 'HTTP_401' || errorCode === 'HTTP_403') { fatalErrorCode = errorCode; break; }
                continue;
            }
            if (request.signal?.aborted) { interrupted = true; break; }
            if (Object.hasOwn(cache, String(id)) && !cachedGameIssues(cache[String(id)], id).length) { results.push({ id, status: 'SKIPPED' }); continue; }
            const merged = { ...cache, [id]: game };
            // Storage failures stop the run; prior per-item commits remain resumable.
            let saved;
            try { saved = await commitCache(file, bytes, merged, { ...hooks, signal: request.signal }); }
            catch (error) {
                hasPrimaryFailure = true;
                if (error instanceof ImportFailure) storageDiagnostics.push(...error.diagnostics);
                fatalErrorCode = error instanceof ImportFailure ? error.code : 'CACHE_COMMIT_FAILED';
                results.push({ id, status: 'FAILED', errorCode: fatalErrorCode }); break;
            }
            cache = merged; bytes = saved.bytes;
            storageDiagnostics.push(...saved.diagnostics);
            results.push({ id, status: 'IMPORTED' });
        }
        return { mode: 'execute', rootId: root, depth: 1, interrupted, fatalErrorCode, plannedIds: plan.plannedIds, results, storageDiagnostics,
            skippedIds: scope?.filter(id => !fullPlan.pendingIds.includes(id)) ?? [],
            remainingIds: planRelationImport(cache, root).pendingIds };
    } catch (error) { sessionError = error; throw error; }
    finally {
        const cleanupErrors: StorageDiagnostic[] = [];
        let closed = false;
        try { await lock.close(); closed = true; } catch (error) { cleanupErrors.push(storageDiagnostic(error, 'CLEANUP', 'lock-close', lockStarted)); }
        // Never remove the cooperative lock if its handle could still be held.
        if (closed) try { await (hooks.unlink ?? fs.unlink)(lockPath); } catch (error) { cleanupErrors.push(storageDiagnostic(error, 'CLEANUP', 'lock-unlink', lockStarted)); }
        if (cleanupErrors.length) {
            storageDiagnostics.push(...cleanupErrors);
            if (sessionError instanceof ImportFailure) sessionError.diagnostics.push(...cleanupErrors);
            else if (!sessionError && !hasPrimaryFailure) throw new ImportFailure('CACHE_LOCK_CLEANUP_FAILED', storageDiagnostics);
        }
    }
}
