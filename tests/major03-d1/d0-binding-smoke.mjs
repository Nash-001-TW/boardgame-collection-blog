import { randomUUID } from 'node:crypto';
import { readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

function requiredAbsolutePath(name) {
    const value = process.env[name];
    if (!value || !isAbsolute(value)) {
        throw new Error(`${name} must be an absolute path`);
    }
    return value;
}

function samePath(left, right) {
    return relative(left, right) === '';
}

function record(event, details = {}) {
    process.stdout.write(`${JSON.stringify({
        utc: new Date().toISOString(),
        event,
        ...details,
    })}\n`);
}

function reportError(phase, error) {
    process.exitCode = 1;
    console.error(`[${new Date().toISOString()}] ${phase}`);
    console.error(error);
}

async function main() {
    const runRoot = await realpath(requiredAbsolutePath('D0_RUN_ROOT'));
    const miniflareEntry = requiredAbsolutePath('D0_MINIFLARE_ENTRY');
    requiredAbsolutePath('MINIFLARE_WORKERD_PATH');
    if (process.env.CLOUDFLARE_CF_FETCH_ENABLED !== 'false') {
        throw new Error('CLOUDFLARE_CF_FETCH_ENABLED must be false');
    }
    if (!samePath(await realpath(process.cwd()), await realpath(join(runRoot, 'input')))) {
        throw new Error('Unexpected input working directory');
    }

    const state = join(runRoot, 'state');
    const runtimeTmp = join(runRoot, 'runtime-tmp');
    for (const directory of [state, runtimeTmp]) {
        if (!samePath(await realpath(directory), directory)
            || (await readdir(directory)).length !== 0) {
            throw new Error(`Expected a fresh run directory: ${directory}`);
        }
    }

    const { Miniflare, convertV4MiniflareOptions } =
        await import(pathToFileURL(miniflareEntry).href);

    let runtime;
    let querySucceeded = false;
    let disposeSucceeded = false;
    let phase = 'construct';
    try {
        runtime = new Miniflare(convertV4MiniflareOptions({
            modules: true,
            script: 'export default { fetch() { return new Response(null, { status: 204 }); } };',
            host: '127.0.0.1',
            port: 0,
            cf: false,
            resourcePersistencePath: state,
            resourceTmpPath: runtimeTmp,
            telemetry: { enabled: false },
            outboundService: () => new Response(null, { status: 403 }),
            d1Databases: { D0_DB: `major03-d0-${randomUUID()}` },
        }));

        phase = 'ready';
        const endpoint = await runtime.ready;
        if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1'
            || !/^[1-9]\d*$/.test(endpoint.port)) {
            throw new Error(`Unexpected runtime endpoint: ${endpoint.href}`);
        }
        record('ready', { endpoint: endpoint.href });

        phase = 'binding';
        const db = await runtime.getD1Database('D0_DB');

        phase = 'query';
        const row = await db.prepare('SELECT 1 AS ok').first();
        if (!row || row.ok !== 1 || Object.keys(row).length !== 1) {
            throw new Error('Unexpected result from SELECT 1 AS ok');
        }
        record('query_ok', { ok: row.ok });
        querySucceeded = true;
    } catch (error) {
        reportError(phase, error);
    } finally {
        if (runtime !== undefined) {
            record('dispose_start');
            try {
                await runtime.dispose();
                record('dispose_ok');
                disposeSucceeded = true;
            } catch (error) {
                reportError('dispose', error);
            }
        }
    }

    if (querySucceeded && disposeSucceeded) {
        record('smoke_complete');
    }
}

main().catch(error => reportError('preflight_or_import', error));
