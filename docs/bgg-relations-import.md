# BGG relation import (B-2)

## Commands

```powershell
npm run bgg:relations:import -- --root 205637 --dry-run
# Future explicit execution; not performed during B-2 acceptance:
npm run bgg:relations:import -- --root 205637 --execute --limit 5
# Isolated, fixed-scope validation; repeat without moving to the next missing IDs:
npm run bgg:relations:import -- --root 205637 --execute --limit 3 --cache-path "ISOLATED/bgg-cache.json" --ids 226690,233977,237424
```

The modes are mutually exclusive and one must be explicit. Execution reads
`BGG_API_TOKEN` from the process environment only. It does not load `.env`, print
credentials, or accept credentials in argv. `BGG_IMPORT_INTERVAL_MS` configures
the minimum request gap (default 2000 ms). Do not execute the second command
without separate approval for actual downloads and local cache changes.

`--cache-path` selects an existing cache file (default remains the project's
cache). `--ids` restricts candidates to the root's direct targets and refuses
unknown or duplicate IDs. Completed scoped IDs are reported in `skippedIds`;
the same scoped rerun never advances to unrelated missing targets. Dry Run also
respects this scope. `remainingIds` in execute results still describes all
remaining root targets, not permission to download them. HTTP attempt reporting
contains only ID, attempt number, status and fixed error codes. HTTP 401/403
stops the whole session immediately.

For runs that must stop on the first failed item, add `--stop-on-error`.
Without it, the B-2 default still continues after permanent per-item failures.
Storage failures and HTTP 401/403 always stop, regardless of this flag.

B-3C authorized three IDs were imported into the local project cache on
2026-11-03. The pre-import backup and validation reports are retained separately.
The real cache now has 765 records. The original B-1/A-2/A-3 snapshot assertions
retain their pre-B-3C expected values using the 762-record historical projection;
`tests/b3c-acceptance.test.ts` independently checks the real 765-record cache and
the explicit 67-derived / 49-unknown expansion results. No Parser or UI rule was
changed to obtain those counts. The B-3A validator remains a historical tool and
will reject the changed production-cache baseline rather than rerun downloads.

## Request and parsing contract

The CLI calls the isolated engine, not the auto-running legacy cache updater.
The existing Thing endpoint, Bearer authentication and `stats=1` convention are
retained. The existing `parseBggGameXml` is reused unchanged; the Astro-oriented
client uses `import.meta.env` and therefore is not directly imported into Node.

Only one ID is requested at a time. Defaults: five total attempts (four retries),
30-second timeout including response body, 2-second minimum gap. The engine API
allows timeout/attempt/gap configuration and injectable fetch/sleep for tests.
202, 429, 5xx and transport failures retry. Backoff is 5/10/20/40 seconds,
capped at 120 seconds. Valid Retry-After seconds or dates are never shortened;
waits longer than one day fail instead of sending an early retry. Cancellation
interrupts HTTP and waits. Redirects are refused.

XML must be well-formed, contain one expected item with matching ID and a
supported game type, and pass normalized structural completeness checks after
the existing Parser. DTD/entity declarations are refused. Malformed data,
ID/type mismatch and non-retryable HTTP statuses are permanent per-item failures.
Raw errors, response XML and credentials are not included in result reports.
Parser direction semantics are untouched.

## Storage and recovery

The canonical cache path has an exclusive `.import.lock` opened with `wx` for
the entire planning/download/commit session. Another engine session refuses to
proceed before making HTTP requests. This lock coordinates this tool only:
legacy updaters and manual editors must not run concurrently.

Each successful game commits independently: merge without overwriting complete
entries, write a unique same-directory temp file, sync and close it, parse and
compare its bytes, check the original cache has not changed, create and sync a
unique backup, verify backup bytes, recheck the original, then rename temp over
the cache. There is no destination unlink or copy fallback. A sharing/permission
failure stops the run, retains the original and backup, and returns a fixed
stage/error code with the partial result. Temporary files are cleaned on normal
error handling. Failed items remain pending; only committed entries count as
success. The initial root's depth-one queue is never expanded by downloaded data.

Re-execution replans against the cache. Completed items are skipped; failed or
unprocessed items remain eligible. No separate attempt log is treated as proof
of import. Limit applies after complete entries are skipped.

## Windows and remaining limits

Same-directory replacement succeeded in the isolated workspace acceptance test
on this Windows host. EPERM replacement failure was separately injected and
proved to preserve the old file. The initial OS-temp-directory replacement was
denied in this restricted environment; it was not represented as a success.
No guarantee is claimed for every Windows filesystem, antivirus configuration,
network drive or power-loss scenario. File sync is used, but directory metadata
durability after rename has not been proven. See Node's filesystem contract:
https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath

Forced termination can leave a stale lock, backup or temp file. Never auto-remove
a lock by PID: independently confirm the original importer has ended and inspect
the cache/backup before manually recovering. The JSON must already exist and be
parseable. Non-cooperating writers, hard-link aliases and external edits during
the final check/rename window are outside the lock's guarantee.

Actual BGG credentials, live HTTP behavior, production-file permissions, process
kill recovery and real disk-full/power-loss failures were not tested. Mock tests
exercise HTTP behavior, disk fault injection and isolated real file replacement.
This phase does not authorize the 53 Arkham downloads or any D1 operation.

## B-4.3F: replacement-only retry and diagnostics

`commitCache` now attempts same-directory `rename` at most three times, with
200ms and 500ms delays. Only EPERM, EACCES and EBUSY are candidates. These codes
are not proof of a transient lock: before another attempt the existing target,
temporary file and backup must still match their expected bytes. Missing or
changed files, abort, another error, or exhaustion stops the commit. There is no
download, parse, delete-target, copy fallback, ACL change or automatic rollback.
After rename, the target is read back and compared with the proposed JSON.

Storage failures retain stage/operation, native code/errno/syscall/path/dest when
available, attempt budget, elapsed time, retry eligibility and secondary cleanup
errors. Missing native fields are `unavailable`; no Win32 error is inferred.
Default diagnostics expose basenames only. The library's `detailedPaths` hook
is reserved for caller-owned access-controlled local evidence; CLI does not
enable it. Raw Error/message/stack/cause are never copied into storage reports.
Successful retries also retain their prior failed attempts in `storageDiagnostics`.

Temp and backup handles are closed before replacement. Finally attempts both
handle cleanup and temporary-file cleanup independently. Cleanup failure cannot
replace a commit's primary error. Session lock cleanup also preserves primary
HTTP/storage failures; if cleanup alone fails the session fails. A lock whose
handle failed to close is not unlinked. Unexpected residuals require inspection.

The lock is cooperative only. Byte comparisons plus rename are not an atomic
compare-and-swap: a non-cooperating writer can change the target after a guard.
Readback detects some changes but cannot recover overwritten external bytes.
Use an exclusive maintenance window; otherwise do not execute. Repeated permission
errors are never repaired by relaxing security. Synced temp/backup files and
readback do not prove directory metadata or hardware power-loss durability.

All B-4.3F tests use synthetic isolated writes and Mock HTTP. An actual Windows
FileStream lacking delete-sharing reproduced a rename refusal followed by a
successful replacement after release. This is a controlled occupancy scenario,
not proof of the historical B-4.3 failure's cause. See
`bgg-cache-replacement-b43f.md` for results and limitations. Formal continuation
requires separate authorization and fresh baseline/lock checks.
