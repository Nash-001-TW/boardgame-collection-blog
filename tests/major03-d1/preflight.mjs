import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const here = new URL('./', import.meta.url);
const read = url => JSON.parse(readFileSync(url, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestUrl = new URL('migration-manifest.json', here);
const binding = 'MAJOR03_DB';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const actions = ['info', 'migrate', 'verify-ledger', 'delete'];

function requireCheck(ok, code) {
    if (!ok) throw new Error(code);
}

function checkedFiles() {
    const manifest = read(manifestUrl);
    requireCheck(manifest.length === 23, 'MIGRATION_COUNT');
    return manifest.map(({ file, sha256: expected }, index) => {
        const sequence = String(index + 1).padStart(4, '0');
        requireCheck(new RegExp('^' + sequence + '_[a-z0-9_]+[.]sql$').test(file), 'MIGRATION_ORDER');
        const bytes = readFileSync(new URL('../../migrations/' + file, here));
        requireCheck(sha256(bytes) === expected, 'MIGRATION_HASH_' + sequence);
        return { file, bytes };
    });
}

function stage() {
    const files = checkedFiles();
    const run = new URL('.run/', here);
    mkdirSync(run);
    const target = new URL('migrations/', run);
    mkdirSync(target);
    for (const { file, bytes } of files) writeFileSync(new URL(file, target), bytes, { flag: 'wx' });
}

function checkStaged() {
    const files = checkedFiles();
    const target = new URL('.run/migrations/', here);
    requireCheck(isDeepStrictEqual(readdirSync(target).sort(), files.map(({ file }) => file)), 'STAGED_FILE_SET');
    for (const { file, bytes } of files) {
        requireCheck(readFileSync(new URL(file, target)).equals(bytes), 'STAGED_HASH_' + file);
    }
}

function verifyRemote(action) {
    const approval = read(new URL('.run/approval.json', here));
    requireCheck(approval.status === 'APPROVED' && Array.isArray(approval.allowedActions)
        && approval.allowedActions.includes(action) && actions.includes(action)
        && approval.approvalReference?.trim() && approval.creationReference?.trim(), 'REMOTE_D1_NOT_AUTHORIZED');
    const { accountId, databaseId, databaseName } = approval;
    requireCheck(typeof accountId === 'string' && /^[0-9a-f]{32}$/.test(accountId)
        && typeof databaseId === 'string' && uuid.test(databaseId)
        && typeof databaseName === 'string' && /^notbgg-major03-d1-[a-z0-9]{12}$/.test(databaseName),
        'INVALID_REMOTE_IDENTITY');

    const denied = read(new URL('denylist.json', here));
    const root = read(new URL('../../wrangler.json', here));
    const production = [...root.d1_databases, ...Object.values(root.env ?? {}).flatMap(env => env.d1_databases ?? [])];
    requireCheck(![...denied.databaseIds, ...denied.stage1DatabaseIds,
        ...production.flatMap(db => [db.database_id, db.preview_database_id])].some(id => id?.toLowerCase() === databaseId)
        && ![...denied.databaseNames, ...production.map(db => db.database_name)].some(name => name?.toLowerCase() === databaseName)
        && !denied.stage1NamePrefixes.some(prefix => databaseName.startsWith(prefix)), 'DENIED_TARGET');

    const created = read(new URL('.run/creation.json', here));
    requireCheck(created.schema === 1 && created.event === 'CREATED'
        && created.workOrder === 'D1-MAJOR03-D1-PREP-002'
        && created.reference === approval.creationReference
        && created.accountId === accountId && created.databaseId === databaseId
        && created.databaseName === databaseName && Number.isFinite(Date.parse(created.at)), 'CREATION_RECORD_MISMATCH');

    const expected = {
        account_id: accountId,
        workers_dev: false,
        preview_urls: false,
        routes: [],
        send_metrics: false,
        d1_databases: [{ binding, database_id: databaseId, database_name: databaseName, remote: false, migrations_dir: './migrations' }],
    };
    requireCheck(isDeepStrictEqual(read(new URL('.run/wrangler.remote.json', here)), expected), 'REMOTE_CONFIG_MISMATCH');
    requireCheck(approval.migrationManifestSha256 === sha256(readFileSync(manifestUrl)), 'MANIFEST_NOT_APPROVED');
    checkStaged();

    if (action !== 'info') {
        const observed = read(new URL('.run/observed.json', here));
        const age = Date.now() - Date.parse(observed.at);
        requireCheck(observed.action === action && observed.accountId === accountId
            && observed.databaseId === databaseId && observed.databaseName === databaseName
            && age >= 0 && age <= 300000, 'FRESH_REMOTE_IDENTITY_REQUIRED');
    }
    return { action, accountId, databaseId, databaseName, binding };
}

try {
    const [mode, action, ...extra] = process.argv.slice(2);
    if (extra.length > 0) throw new Error('UNSUPPORTED_ARGUMENTS');
    if (mode === 'stage' && action === undefined) stage();
    else if (mode === 'check-staged' && action === undefined) checkStaged();
    else if (mode === 'remote' && actions.includes(action)) {
        try {
            console.log(JSON.stringify(verifyRemote(action)));
        } catch (error) {
            if (error?.code === 'ENOENT') throw new Error('REMOTE_D1_NOT_AUTHORIZED');
            throw error;
        }
    } else throw new Error('UNSUPPORTED_ARGUMENTS');
} catch (error) {
    console.error(error.code ?? error.message);
    process.exitCode = 1;
}
