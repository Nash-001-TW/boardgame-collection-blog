# NotBGG D2 storage

No Astro pages, public APIs, admin forms, BGG cache/parser or collection repositories
import the new repository. Production/remote D1 has not been queried or migrated.
The formal 0014 migration is applied only by the disposable local test harness.

## D1 contract reconciliation

The D1 field/identity business rules are unchanged. Scalar fields and validated JSON
arrays map to notbgg_games; accessoryCategories and relatedGameIds map to their join
tables. linkStatus is derived: pending/linked from the live row, unlinked if none
(including revoked-only history). linkedBggId/linkedAt are null unless confirmed.
source remains notbgg; BGG primary-source selection never rewrites original data.

The draft required three integrity refinements before formalization:

- A deferred composite FK from a game's (seq,revision) to its revision row prevents
  committing a game without its current revision, including the first revision.
- A revision insert precondition checks the current revision INSIDE the D1 atomic
  batch, before child deletions/archives. A stale writer aborts instead of silently
  updating zero rows and leaving partial child changes.
- Profile creation must start at revision 1; profile updates require the new revision
  row. Existing identity/source/history guards, one-to-one mappings and FKs remain.

No old migration was changed. The D1-only static draft test now checks the promoted
0014 migration instead of asserting that 0014 does not exist.

## Injected repository API

`new NotBggRepository(db: D1Database)` accepts only an explicit binding. There is no
default env.DB, network lookup, Astro dependency or fallback database.

| Method | Result |
|---|---|
| create(input, {actor,idempotencyKey}) | {game,replayed}; same key/content returns the current game, including archived status |
| getByNotBggId(id) | original NotBggGame or null; reservation-only IDs return null |
| getByInternalGameId(v2GameId) | original NotBggGame or null |
| list({includeArchived?,limit?,after?}) | {items,nextCursor}; defaults to active records, 50 entries; maximum 100 |
| update(id, patch, {actor,expectedRevision}) | updated original NotBggGame |
| archive(id, {actor,expectedRevision}) | archived original NotBggGame |
| getRevisionHistory(id) | ascending {revision,actor,createdAt,snapshot} entries |

Invalid editable input throws D1's NotBggValidationError. Repository errors expose
INVALID_ARGUMENT, NOT_FOUND, CONFLICT, ARCHIVED, IDEMPOTENCY_CONFLICT or STORAGE.
The future server route must authorize the caller and derive actor from trusted
authentication, never from an arbitrary form field. No HTTP permission boundary is
implemented in this phase.

Revision snapshots contain complete source fields, permanent/internal identities,
timestamps and archive state. This includes editorNotes and must stay admin-only.
Name/type mirror into the existing manual v2_games row in the same edit batch;
NotBGG year remains in its own profile (v2's older year range is narrower).
Scalar-only edits retain existing category/relation rows. Removed relations are
archived, not deleted. A snapshot preserves the old category/target selection.

## Allocation, idempotency and atomicity

1. Validate using D1 rules and hash the normalized editable content (SHA256).
2. INSERT a database-allocated notbgg_ids reservation with a globally unique key.
   Conflicting keys never change the stored content hash. This reservation commits
   separately and is not a valid/exposed game.
3. For a matching reservation, return an existing complete game as a replay, or use
   one D1 batch to insert its manual v2 identity, profile, first revision and children.
4. A duplicate concurrent creator loses on the unique profile seq; its entire batch,
   including the temporary v2 row, rolls back. It reads and returns the winner.
5. Any other create failure leaves only the immutable reservation. Public repository
   reads/list exclude it; retrying the same normalized content/key can complete it.

The immediate v2 insert -> last_insert_rowid() profile insert occurs inside ONE
non-interleaving D1 batch. Actual local D1 tests verify both distinct and identical
overlapping requests. No MAX+1, global JS counter, BEGIN or COMMIT is used in storage.

Edits/archive insert the next revision FIRST: the SQL trigger is the compare-and-swap
gate. Children/profile/v2 mirror then change inside the same batch. Failure rolls back
both the snapshot and all changes. Unchanged expectedRevision is required; archived
games cannot be edited/reactivated by this repository. Identity/link/time system
fields are never accepted as editable patches.

SQLite AUTOINCREMENT automatically avoids reusing previously COMMITTED allocated
rowids in that table, including deleted rows, but does not guarantee gap-free numbers.
Rolled-back allocations may be reused because they never committed. Here committed
reservations cannot be updated/deleted at all and survive failure/archive. We never
reset sqlite_sequence or use INSERT OR REPLACE. Width expands after 999999; the D1
safe-integer ceiling from D1-stage contracts remains Number.MAX_SAFE_INTEGER.

## Mapping foundation only

notbgg_bgg_links supports pending candidates, confirmed one-to-one active links,
explicit primary_source, revocation and historical rows. Confirming requires an
existing matching BGG internal identity. A pending proposal cannot select BGG as
primary. notbgg_link_events is append-only with a restrictive FK to the mapping.
No mapping workflow methods are exposed in D2. Dedicated authorized commands must
later append events atomically and require explicit primary-source confirmation.
No collectionId, game_id or owned-copy references are moved by mapping or archive.

## Isolated real D1 tests

Command: `node --import tsx --test tests/notbgg-repository.test.ts`

The harness uses the pinned, already-installed Miniflare 5 version with its supported
V4 options converter. It creates a fresh random TEST binding, a fresh temporary
persistence directory, disables telemetry and rejects Worker external fetches. It
does NOT load wrangler.json, .dev.vars, credentials, project .wrangler storage or a
remote proxy. Runtime disposal and checked temporary-directory cleanup run finally.

All migrations 0001..0014 are applied in order to the new empty local database.
Old 0002 contains CLI BEGIN/COMMIT: the harness leaves its file untouched and executes
the statements through D1 batch instead, preserving per-file atomicity. Tests compare
all existing V2 table definitions before/after 0014, verify foreign_key_check, and
exercise FKs, unique constraints and immutable history/source rules.

Actual overlapping Promise.all/Promise.allSettled calls (not a sequential simulation):
- 24 different creates: 24 unique NotBGG IDs and internal IDs.
- 12 identical creates: one game, one first revision, one non-replay winner.
- 2 same-key/different-content creates: one winner, one idempotency conflict.
- 2 same-revision edits: one winner, one conflict, no false revision.

Failure injection covers first-revision failure, late missing-target create/edit
failure, and archive failure. Tests prove complete rollback, safe retry, reservation
invisibility, snapshot retention and no orphan profile. A direct batch without the
initial revision is rejected by the deferred FK and rolls back the v2 row too.
This Miniflare alpha reports that deferred commit violation as a generic internal
error rather than a stable FOREIGN KEY string; the test verifies database state and
connection health instead of matching that message.

Sequential historical/rollback tests explicitly verify first IDs 000001/000002,
archive/no reuse, a committed 999999 reservation followed by 1000000, and reuse of an
uncommitted rolled-back allocation. These are NOT described as parallel tests.

References:
- https://developers.cloudflare.com/d1/worker-api/d1-database/ (batch atomicity)
- https://www.sqlite.org/autoinc.html (committed/deleted/rollback semantics)

## D3 remaining

Authentication/authorization boundary, trusted actor propagation, request size limits,
CSRF/origin handling, globally unique scoped idempotency keys, revision preconditions
in requests, admin forms and HTTP error mapping. Mapping workflow and public catalog
integration remain later phases. This phase does not authorize any production
migration or deployment.
