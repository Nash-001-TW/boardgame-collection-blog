// D1GA-20261119-001. Start only through the separately authorized supervisor.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RUN_ID = 'D1GA-20261119-001';
const BINDING = 'D1_GATE_A';
const VERSIONS = { node: 'v24.21.0', miniflare: '5.20261006.1-alpha', workerd: '1.20261006.1' };

// BEGIN GATE A SQL
const BOOTSTRAP = [
  'CREATE TABLE ga_definition (id INTEGER PRIMARY KEY, label TEXT NOT NULL, expected INTEGER, revision INTEGER NOT NULL)',
  'CREATE TABLE ga_probe (op TEXT PRIMARY KEY)',
  'CREATE TABLE ga_assertion (op TEXT PRIMARY KEY, affected INTEGER NOT NULL, CONSTRAINT ga_exactly_one CHECK (affected = 1))',
  'CREATE TABLE ga_history (op TEXT PRIMARY KEY, definition_id INTEGER NOT NULL, before_expected INTEGER, after_expected INTEGER, fault INTEGER NOT NULL, CONSTRAINT ga_history_write CHECK (fault = 0))',
  'CREATE TABLE ga_receipt (op TEXT PRIMARY KEY, definition_id INTEGER NOT NULL, after_expected INTEGER, fault INTEGER NOT NULL, CONSTRAINT ga_receipt_write CHECK (fault = 0))',
  "INSERT INTO ga_definition(id, label, expected, revision) VALUES (1, 'A1 original', 103, 7), (2, 'A2 original', 103, 7), (3, 'A3 original', 103, 7), (4, 'A4 original', 103, 7), (5, 'A5 original', 103, 7)",
];
const WRITES = [
  'INSERT INTO ga_probe(op) VALUES (?)',
  'UPDATE ga_definition SET expected = ?, label = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND expected IS ?',
  'INSERT INTO ga_assertion(op, affected) VALUES (?, changes())',
  'INSERT INTO ga_history(op, definition_id, before_expected, after_expected, fault) VALUES (?, ?, ?, ?, ?)',
  'INSERT INTO ga_receipt(op, definition_id, after_expected, fault) VALUES (?, ?, ?, ?)',
];
const READS = [
  'SELECT id, label, expected, revision FROM ga_definition ORDER BY id',
  'SELECT op FROM ga_probe ORDER BY op',
  'SELECT op, affected FROM ga_assertion ORDER BY op',
  'SELECT op, definition_id, before_expected, after_expected, fault FROM ga_history ORDER BY op',
  'SELECT op, definition_id, after_expected, fault FROM ga_receipt ORDER BY op',
];
// END GATE A SQL

const CASES = [
  { id: 1, revision: 7, historyFault: 0, receiptFault: 0, constraint: null },
  { id: 2, revision: 6, historyFault: 0, receiptFault: 0, constraint: 'ga_exactly_one' },
  { id: 3, revision: 7, historyFault: 1, receiptFault: 0, constraint: 'ga_history_write' },
  { id: 4, revision: 7, historyFault: 0, receiptFault: 1, constraint: 'ga_receipt_write' },
  { id: 5, revision: 7, historyFault: 0, receiptFault: 1, constraint: 'ga_receipt_write' },
];
const CONSTRAINTS = {
  ga_exactly_one: 'B3',
  ga_history_write: 'B4',
  ga_receipt_write: 'B5',
};

function databaseError(error) {
  // Match only named CHECK failures. Keep raw messages, paths and stacks out of evidence.
  const matches = new Set();
  let sqliteConstraint = false;
  for (let cause = error, depth = 0; cause instanceof Error && depth < 5; depth++, cause = cause.cause) {
    const match = /CHECK constraint failed:\s*(ga_exactly_one|ga_history_write|ga_receipt_write)\b/i.exec(cause.message);
    if (match) matches.add(match[1].toLowerCase());
    if (String(cause.code ?? '') === 'SQLITE_CONSTRAINT_CHECK') sqliteConstraint = true;
  }
  const constraint = matches.size === 1 ? [...matches][0] : null;
  return { constraint, statement: constraint ? CONSTRAINTS[constraint] : null, sqliteConstraint };
}

function failureKind(error) {
  for (let cause = error, depth = 0; cause instanceof Error && depth < 5; depth++, cause = cause.cause) {
    if (/\bconnect EACCES 127\.0\.0\.1:\d+\b/.test(cause.message) ||
        (cause.code === 'EACCES' && cause.syscall === 'connect' && cause.address === '127.0.0.1')) return 'LOOPBACK_EACCES';
    if (cause.code === 'EACCES') return 'ACCESS_DENIED_UNLOCATED';
  }
  return 'REDACTED_OR_UNKNOWN';
}

function assertMatches(actual, expected) {
  // Column names and order are fixed by READS. Compare entries independently of row key order.
  const canonical = rows => rows.map(group => group.map(row => Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
  return JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));
}

async function receiveGo() {
  const input = createInterface({ input: process.stdin, terminal: false });
  let timer;
  try {
    const value = await Promise.race([
      input[Symbol.asyncIterator]().next(),
      new Promise(resolve => { timer = setTimeout(() => resolve({ done: true }), 10_000); }),
    ]);
    if (value.done || value.value !== `GO ${RUN_ID}`) throw new Error('CONTROL_REJECTED');
  } finally {
    clearTimeout(timer);
    input.close();
  }
}

const sqlSha256 = createHash('sha256').update(JSON.stringify({ BOOTSTRAP, WRITES, READS })).digest('hex');
const [workspaceArg, rootArg, expectedSqlSha256] = process.argv.slice(2);
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.join(workspace, '.wrangler', 'd1-gate-a', RUN_ID);
if (process.argv.length !== 5 || workspaceArg !== workspace || rootArg !== root || process.cwd() !== root ||
    expectedSqlSha256?.toLowerCase() !== sqlSha256) {
  process.exitCode = 1;
} else {
  await run(workspace, root);
}

async function run(workspace, root) {
  const evidence = path.join(root, 'evidence');
  const save = (name, data) => writeFileSync(path.join(evidence, name), JSON.stringify(data, null, 2), { flag: 'wx' });
  const record = data => appendFileSync(path.join(evidence, 'cases.ndjson'), JSON.stringify(data) + '\n');
  let runtime;
  let phase = 'CONTROL';
  let binding = 'NOT_STARTED';
  let bindingFailure = null;
  let ready = false;
  let sqlCalls = 0;
  let completedCases = 0;
  let status = 'BLOCKED';
  let reason = 'CONTROL_NOT_CONFIRMED';
  let disposed = false;
  let runtimeWarning = false;

  try {
    await receiveGo();
    phase = 'VERSION';
    if (process.version !== VERSIONS.node) throw new Error('NODE_VERSION_MISMATCH');
    for (const name of ['miniflare', 'workerd']) {
      const metadata = JSON.parse(readFileSync(path.join(workspace, 'node_modules', name, 'package.json'), 'utf8'));
      if (metadata.version !== VERSIONS[name]) throw new Error('PACKAGE_VERSION_MISMATCH');
    }
    phase = 'RUNTIME';
    const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(
      pathToFileURL(path.join(workspace, 'node_modules/miniflare/dist/src/index.js')).href
    );
    class GateLog extends Log {
      constructor() { super(LogLevel.WARN); }
      logWithLevel(level) {
        if (!Number.isInteger(level) || level <= LogLevel.WARN) runtimeWarning = true;
      }
      error() { runtimeWarning = true; }
    }
    runtime = new Miniflare(convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("D1 GATE A SYNTHETIC ONLY")}}',
      host: '127.0.0.1',
      port: 0,
      compatibilityDate: '2026-10-01',
      cf: false,
      telemetry: { enabled: false },
      log: new GateLog(),
      d1Databases: { [BINDING]: 'd1-gate-a-20261119-001' },
      resourcePersistencePath: path.join(root, 'state'),
      resourceTmpPath: path.join(root, 'tmp'),
      outboundService: () => {
        runtimeWarning = true;
        throw new Error('WORKER_OUTBOUND_DENIED');
      },
    }));
    const endpoint = await runtime.ready;
    if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port || runtimeWarning) {
      throw new Error('RUNTIME_PREFLIGHT_FAILED');
    }
    ready = true;
    phase = 'BINDING';
    binding = 'REQUESTED';
    const db = await runtime.getD1Database(BINDING);
    binding = 'ACQUIRED';
    const runBatch = async statements => {
      if (runtimeWarning) throw new Error('RUNTIME_WARNING');
      sqlCalls++;
      return db.batch(statements);
    };
    const snapshot = async () => {
      const results = await runBatch(READS.map(sql => db.prepare(sql)));
      if (results.length !== READS.length || results.some(result => !result.success || !Array.isArray(result.results))) {
        throw new Error('SNAPSHOT_UNAVAILABLE');
      }
      return results.map(result => result.results);
    };
    phase = 'BOOTSTRAP';
    const setup = await runBatch(BOOTSTRAP.map(sql => db.prepare(sql)));
    if (setup.length !== BOOTSTRAP.length || setup.some(result => !result.success)) throw new Error('BOOTSTRAP_FAILED');
    const seeded = [CASES.map(({ id }) => ({ id, label: `A${id} original`, expected: 103, revision: 7 })), [], [], [], []];
    if (!assertMatches(await snapshot(), seeded)) throw new Error('BOOTSTRAP_STATE_MISMATCH');

    for (const test of CASES) {
      const op = `A${test.id}`;
      phase = op;
      const before = await snapshot();
      const label = test.id === 5 ? 'A5 edited' : `${op} original`;
      const parameters = [
        [op],
        [100, label, test.id, test.revision, 103],
        [op],
        [op, test.id, 103, 100, test.historyFault],
        [op, test.id, 100, test.receiptFault],
      ];
      let batchResult = null;
      let error = null;
      try {
        const result = await runBatch(WRITES.map((sql, index) => db.prepare(sql).bind(...parameters[index])));
        batchResult = result.map(item => ({ success: item.success, changes: item.meta?.changes ?? null }));
      } catch (caught) {
        error = databaseError(caught);
      }
      let after;
      try {
        after = await snapshot();
      } catch {
        record({ op, before, batchResult, error, after: null, status: 'BLOCKED', reason: 'READBACK_UNAVAILABLE' });
        status = 'BLOCKED'; reason = 'READBACK_UNAVAILABLE';
        break;
      }

      const expected = structuredClone(before);
      if (!test.constraint) {
        const row = expected[0].find(item => item.id === test.id);
        Object.assign(row, { label, expected: 100, revision: 8 });
        expected[1].push({ op });
        expected[2].push({ op, affected: 1 });
        expected[3].push({ op, definition_id: test.id, before_expected: 103, after_expected: 100, fault: 0 });
        expected[4].push({ op, definition_id: test.id, after_expected: 100, fault: 0 });
      }
      if (test.constraint) {
        if (!assertMatches(after, before)) {
          status = 'FAIL'; reason = 'NEGATIVE_CASE_CHANGED_STATE';
        } else if (batchResult?.length === WRITES.length && batchResult.every(item => item.success)) {
          status = 'FAIL'; reason = 'NEGATIVE_CASE_BATCH_SUCCEEDED';
        } else if (error?.constraint !== test.constraint) {
          status = 'BLOCKED'; reason = 'EXPECTED_CONSTRAINT_NOT_IDENTIFIED';
        } else {
          status = 'PASS'; reason = 'EXPECTED_CONSTRAINT_AND_ROLLBACK';
        }
      } else if (batchResult?.length === WRITES.length && batchResult.every(item => item.success)) {
        status = assertMatches(after, expected) ? 'PASS' : 'FAIL';
        reason = status === 'PASS' ? 'EXPECTED_ATOMIC_COMMIT' : 'UNEXPECTED_COMMITTED_STATE';
      } else if (!assertMatches(after, before) || error?.constraint === 'ga_exactly_one') {
        status = 'FAIL'; reason = 'SUCCESS_CONTROL_INVARIANT_FAILED';
      } else {
        status = 'BLOCKED'; reason = 'SUCCESS_CONTROL_UNAVAILABLE';
      }
      record({ op, expectedConstraint: test.constraint, before, after, batchResult, error, status, reason });
      completedCases++;
      if (status !== 'PASS') break;
    }
  } catch (error) {
    status = status === 'FAIL' ? 'FAIL' : 'BLOCKED';
    const safeCodes = new Set(['CONTROL_REJECTED', 'NODE_VERSION_MISMATCH', 'PACKAGE_VERSION_MISMATCH',
      'RUNTIME_PREFLIGHT_FAILED', 'RUNTIME_WARNING', 'BOOTSTRAP_FAILED', 'BOOTSTRAP_STATE_MISMATCH', 'SNAPSHOT_UNAVAILABLE']);
    reason = error instanceof Error && safeCodes.has(error.message) ? error.message : `${phase}_FAILED`;
    if (phase === 'BINDING' || phase === 'RUNTIME') bindingFailure = failureKind(error);
  } finally {
    if (runtime) {
      try { await runtime.dispose(); disposed = true; } catch { /* supervisor owns the deadline */ }
    }
    if (status === 'PASS' && (!disposed || runtimeWarning || completedCases !== CASES.length)) {
      status = 'BLOCKED';
      reason = !disposed ? 'DISPOSE_NOT_CONFIRMED' : runtimeWarning ? 'RUNTIME_WARNING' : 'CASE_EVIDENCE_INCOMPLETE';
    }
    save('binding-result.json', { runId: RUN_ID, ready, binding, bindingFailure, sqlCalls, runtimeWarning });
    save('child-result.json', { runId: RUN_ID, status, reason, completedCases, disposed, sqlSha256 });
    process.exitCode = status === 'PASS' ? 0 : 1;
  }
}
