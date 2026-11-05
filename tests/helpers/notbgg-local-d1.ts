import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** No Wrangler config, production binding, credentials or remote proxy. Fresh disposable local state only. */
export async function isolatedNotBggD1(workerScript?:string) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'notbgg-d2-'));
    const cleanup = async () => {
        if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('notbgg-d2-')) throw new Error('Unsafe cleanup path');
        await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    };
    const databaseId=`notbgg-isolated-${crypto.randomUUID()}`;
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true,
        script: workerScript??'export default { fetch() { return new Response("isolated NotBGG test"); } }',
        d1Databases: { TEST: databaseId,...(workerScript?{DB:databaseId}:{}) },
        resourcePersistencePath: directory, resourceTmpPath: path.join(directory, 'tmp'), telemetry: { enabled: false },
        outboundService: () => new Response('External network disabled', { status: 403 }) }));
    try {
        const db = await runtime.getD1Database('TEST');
        return { db: db as unknown as D1Database, fetch:(url:string,headers?:Record<string,string>)=>runtime.dispatchFetch(url,{redirect:"manual",headers}), dispose: async () => { await runtime.dispose(); await cleanup(); } };
    } catch (error) { await runtime.dispose(); await cleanup(); throw error; }
}

/** Migration statements include multiline triggers; never split a trigger at its inner semicolon. */
export function migrationStatements(sql: string): string[] {
    const result: string[] = []; let pending = '';
    for (const line of sql.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith('--')) continue;
        pending += line + '\n';
        const trigger = /^\s*CREATE\s+TRIGGER\b/i.test(pending);
        if ((trigger ? /\bEND;\s*$/i : /;\s*$/).test(pending)) { result.push(pending.trim()); pending = ''; }
    }
    if (pending.trim()) throw new Error('Unterminated migration statement');
    return result;
}

export async function migrateIsolatedD1(db: D1Database, through?:string) {
    const files = (await readdir('migrations')).filter(file => /^\d+.*\.sql$/.test(file) && (!through || file<=through)).sort();
    let v2Before: { name: string; sql: string }[] = [];
    for (const file of files) {
        if (file === '0014_notbgg.sql') v2Before = (await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'v2_%' ORDER BY name").all<{ name: string; sql: string }>()).results;
        const statements = migrationStatements(await readFile(`migrations/${file}`, 'utf8'));
        // Legacy scripts contain BEGIN/COMMIT intended for a CLI. D1 binding does not
        // support those controls: preserve file-level atomicity using its supported batch API.
        const queries = statements.filter(statement => !/^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END);$/i.test(statement.trim()));
        await db.batch(queries.map(statement => db.prepare(statement)));
    }
    return { v2Before };
}
