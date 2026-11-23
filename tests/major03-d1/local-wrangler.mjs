import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = new URL('./', import.meta.url);
const config = fileURLToPath(new URL('wrangler.local.json', here));
const persist = fileURLToPath(new URL('.run/state', here));
const cli = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', here));
const binding = 'MAJOR03_DB';
const options = ['--config', config, '--persist-to', persist];
const ledgerQuery = 'SELECT name FROM d1_migrations ORDER BY id';
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(SystemRoot|WINDIR|ComSpec|PATH|PATHEXT|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)));
Object.assign(env, {
    WRANGLER_SEND_METRICS: 'false',
    CLOUDFLARE_CF_FETCH_ENABLED: 'false',
    WRANGLER_HIDE_BANNER: 'true',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
    XDG_CONFIG_HOME: fileURLToPath(new URL('.run/config', here)),
});

function run(entry, args, capture = false) {
    const result = spawnSync(process.execPath, [entry, ...args], {
        cwd: fileURLToPath(here), env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    });
    if (result.status !== 0) throw new Error('LOCAL_COMMAND_FAILED');
    return result.stdout;
}

try {
    const [action] = process.argv.slice(2);
    if (process.argv.length !== 3 || !['migrate', 'seed', 'serve'].includes(action)) {
        throw new Error('UNSUPPORTED_ARGUMENTS');
    }
    const expectedConfig = {
        name: 'notbgg-major03-local',
        main: 'worker.ts',
        compatibility_date: '2026-10-01',
        workers_dev: false,
        preview_urls: false,
        routes: [],
        send_metrics: false,
        dev: { ip: '127.0.0.1', port: 18743 },
        d1_databases: [{
            binding,
            database_name: 'notbgg-major03-local',
            database_id: '1b7cd021-a655-451d-a4b5-5fd7bb5b8e72',
            remote: false,
            migrations_dir: './.run/migrations',
        }],
    };
    if (!isDeepStrictEqual(JSON.parse(readFileSync(config, 'utf8')), expectedConfig)
        || readdirSync(here).some(name => /^(?:\.env|\.dev\.vars)(?:\.|$)/i.test(name))) {
        throw new Error('LOCAL_CONFIG_MISMATCH');
    }
    run(fileURLToPath(new URL('preflight.mjs', here)), ['check-staged']);

    if (action === 'serve') {
        run(cli, ['dev', '--local', '--ip', '127.0.0.1', '--port', '18743', '--inspector-port', '0', ...options]);
    } else {
        if (action === 'migrate') run(cli, ['d1', 'migrations', 'apply', binding, '--local', ...options]);
        const ledger = JSON.parse(run(cli, ['d1', 'execute', binding, '--local', ...options,
            '--command', ledgerQuery, '--json'], true));
        const expected = JSON.parse(readFileSync(new URL('migration-manifest.json', here), 'utf8'));
        const actual = ledger.flatMap(result => result.results ?? []).map(row => row.name);
        if (JSON.stringify(actual) !== JSON.stringify(expected.map(row => row.file))) {
            throw new Error('MIGRATION_LEDGER_MISMATCH');
        }
        if (action === 'seed') run(cli, ['d1', 'execute', binding, '--local', ...options,
            '--file', fileURLToPath(new URL('fixture.sql', here))]);
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
