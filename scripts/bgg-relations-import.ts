import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { executeRelationImport, ImportFailure, scopedRelationPlan } from './lib/relation-import-engine.ts';
import { planRelationImport, dryRunReport, RelationPlanError } from '../src/lib/relation-import-plan.ts';

export class ImportArgumentError extends Error {
    constructor(public readonly code: 'DRY_RUN_REQUIRED' | 'MODE_CONFLICT' | 'ROOT_REQUIRED' | 'INVALID_ROOT_ID' | 'INVALID_LIMIT' | 'DUPLICATE_OPTION' | 'INVALID_ARGUMENT') { super(code); }
}
const positiveInteger = (text: string, code: 'INVALID_ROOT_ID' | 'INVALID_LIMIT') => {
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new ImportArgumentError(code);
    return Number(text);
};
export function parseRelationImportArgs(args: readonly string[]) {
    if (args.length === 1 && args[0] === '--help') return { help: true } as const;
    const seen = new Set<string>();
    let root: number | undefined, limit: number | undefined, dryRun = false, execute = false;
    let cachePath: string | undefined, targetIds: number[] | undefined;
    let stopOnFailure = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const split = arg.indexOf('=');
        const option = split < 0 ? arg : arg.slice(0, split);
        if (!['--root', '--limit', '--dry-run', '--execute', '--cache-path', '--ids', '--stop-on-error'].includes(option)) throw new ImportArgumentError('INVALID_ARGUMENT');
        if (seen.has(option)) throw new ImportArgumentError('DUPLICATE_OPTION');
        seen.add(option);
        if (option === '--dry-run' || option === '--execute' || option === '--stop-on-error') {
            if (split >= 0) throw new ImportArgumentError('INVALID_ARGUMENT');
            if (option === '--dry-run') dryRun = true; else if (option === '--execute') execute = true; else stopOnFailure = true;
        } else {
            const value = split >= 0 ? arg.slice(split + 1) : args[++i];
            const code = option === '--root' ? 'INVALID_ROOT_ID' : 'INVALID_LIMIT';
            if (value === undefined) throw new ImportArgumentError(code);
            if (option === '--cache-path') {
                if (!value.trim() || value.startsWith('--')) throw new ImportArgumentError('INVALID_ARGUMENT');
                cachePath = value; continue;
            }
            if (option === '--ids') {
                targetIds = value.split(',').map(id => positiveInteger(id, 'INVALID_ROOT_ID'));
                if (new Set(targetIds).size !== targetIds.length) throw new ImportArgumentError('INVALID_ARGUMENT');
                continue;
            }
            const number = positiveInteger(value, code);
            if (option === '--root') root = number; else limit = number;
        }
    }
    if (dryRun && execute) throw new ImportArgumentError('MODE_CONFLICT');
    if (!dryRun && !execute) throw new ImportArgumentError('DRY_RUN_REQUIRED');
    if (root === undefined) throw new ImportArgumentError('ROOT_REQUIRED');
    return { help: false, root, limit, dryRun, ...(execute ? { execute: true } : {}), ...(cachePath ? { cachePath } : {}), ...(targetIds ? { targetIds } : {}), ...(stopOnFailure ? { stopOnFailure: true } : {}) } as const;
}
export const importUsage = 'npm run bgg:relations:import -- --root 205637 (--dry-run | --execute) [--limit 5] [--cache-path PATH] [--ids 226690,233977,237424] [--stop-on-error]';

/** Execution is opt-in. Dry runs never read credentials or call the executor. */
export async function main(args = process.argv.slice(2)): Promise<void> {
    try {
        const options = parseRelationImportArgs(args);
        if (options.help) { console.log(importUsage); return; }
        const cacheFile = options.cachePath ?? fileURLToPath(new URL('../src/data/bgg-cache.json', import.meta.url));
        if (options.execute) {
            const token = process.env.BGG_API_TOKEN;
            if (!token) throw new ImportFailure('BGG_TOKEN_REQUIRED');
            const intervalMs = process.env.BGG_IMPORT_INTERVAL_MS === undefined ? 2000 : Number(process.env.BGG_IMPORT_INTERVAL_MS);
            const controller = new AbortController();
            const abort = () => controller.abort();
            process.on('SIGINT', abort); process.on('SIGTERM', abort);
            try {
                const attempts: {id:number;attempt:number;httpStatus?:number;errorCode?:string}[] = [];
                const result = await executeRelationImport(cacheFile, options.root, options.limit,
                    { token, intervalMs, signal: controller.signal, targetIds: options.targetIds, stopOnFailure: options.stopOnFailure, onAttempt: event => attempts.push(event) });
                console.log(JSON.stringify({...result, attempts}, null, 2));
                if (result.interrupted || result.results.some(r => r.status === 'FAILED')) process.exitCode = 1;
            } finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
            return;
        }
        let text: string;
        try { text = await readFile(cacheFile, 'utf8'); }
        catch { console.error(JSON.stringify({ status: 'ERROR', errorCode: 'CACHE_READ_FAILED' })); process.exitCode = 1; return; }
        let cache: unknown;
        try { cache = JSON.parse(text); }
        catch { console.error(JSON.stringify({ status: 'ERROR', errorCode: 'CACHE_JSON_INVALID' })); process.exitCode = 1; return; }
        console.log(JSON.stringify(dryRunReport(scopedRelationPlan(cache, options.root, options.limit, options.targetIds)), null, 2));
    } catch (error) {
        const known = error instanceof ImportArgumentError || error instanceof RelationPlanError || error instanceof ImportFailure;
        console.error(JSON.stringify({ status: 'ERROR', errorCode: known ? error.code : 'DRY_RUN_FAILED',
            ...(error instanceof ImportFailure ? { storageDiagnostics: error.diagnostics } : {}),
            ...(error instanceof RelationPlanError && error.issues.length ? { issues: error.issues } : {}), usage: importUsage }));
        process.exitCode = error instanceof ImportArgumentError ? 2 : 1;
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
