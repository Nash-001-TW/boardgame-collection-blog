# NotBGG D-1 contract (not connected to production)

**D2 status:** the SQL candidate has been promoted to `migrations/0014_notbgg.sql`
and tested ONLY in disposable local Miniflare D1. The historical D1-stage statements
below about an unapplied draft describe that phase, not the current test status.
See `notbgg-d2-storage.md` for the repository API, constraints, actual tests and scope.
There are still no public route/collection integrations. Auth/forms remain D3 work;
full BGG mapping commands remain outside D2.

The D1 phase added pure identity, validation and projection modules. At that stage no
route, repository, cache, parser, collection flow or A-2/A-3 interpreter imported them.
At D1 the SQL candidate was `docs/drafts/0014_notbgg.sql`, outside Wrangler's
`migrations/` directory. D2 confirmed 0014 was free and moved it into that directory.
At D1 the draft had NOT been applied, including to local/test D1 or an in-memory database.
Its execution, constraints and concurrency behavior were NOT TESTED in that phase.

## Identity

- Keep BGG IDs as positive safe-integer numbers. Never convert them into a string union.
- `GameRef` discriminates BGG and NotBGG sources. Serialization/catalog keys are
  `BGG:205637` and `NotBGG:000001`; numeric suffixes are never keys by themselves.
- NotBGG is canonical, case-sensitive, positive decimal with a minimum six-digit width:
  1 becomes `NotBGG:000001`, 1000000 becomes `NotBGG:1000000`. Over-padding is rejected.
- `formatNotBggId` only formats an already allocated sequence. It does not allocate,
  reserve, authorize, or persist an ID. Forms cannot supply an identity.
- The current numeric contract stops at Number.MAX_SAFE_INTEGER. The SQL draft uses
  the same cap rather than losing precision inside SQLite's wider integer range.
- Future route: `/games/notbgg/000001` (English counterpart under `/en`). No route is
  created in D1. No linking or canonical-display resolution is performed by adapters.

## Editable data

`NotBggEditableFields` contains every V1.2 editable field. Create requires name/type;
other omitted fields become null (unknown scalar) or [] (no recorded list entries).
Update is partial input validated against the complete current editable value and
returns a complete, normalized next value without mutating its input. Empty updates
and explicit undefined are rejected. JSON/plain objects only; unknown keys rejected.

System fields are exclusively part of `NotBggGame`: internal gameId, notBggId,
source, createdAt/updatedAt, revision, archivedAt, linkStatus, linkedBggId/linkedAt,
primarySource. They cannot appear in create/update bodies, even when null.
Expected revision must be passed separately as a write precondition in D2.

Validation limits (application policy, not BGG API limits):

| Field | Rule |
|---|---|
| name | Required trimmed text, <=300 UTF-16 code units |
| type | boardgame / boardgameexpansion / boardgameaccessory |
| yearPublished | null or integer 1..9999 |
| minAge | null or integer 0..200; zero means from birth, not unknown |
| minPlayers/maxPlayers | null or integer 1..1000; known min <= known max |
| minPlaytime/maxPlaytime | null or integer 1..100000 minutes; min <= max |
| recommendedPlayers | null or unique positive integer list within known bounds |
| description / editorNotes / contents | null or <=50000 / 10000 / 20000 code units |
| names, publication and taxonomy lists | <=100 entries, each <=300; trimmed/NFC, case-insensitive deduplication |
| URLs | Absolute HTTP(S), no credentials, <=2048 after normalization |
| referenceUrls | <=50 entries, normalized and deduplicated |
| relatedGameIds | <=100 strict GameRef entries, deduplicated by full source key |
| accessoryCategories | Unique selection from upgrade/playmat/storage/promo/sleeves/miniatures/tokens/other |

No numeric coercion, zero-as-missing, NaN, infinity, sparse arrays, fake taxonomy IDs,
BGG statistics or BGG official relation fields are accepted. Optional blank text and
single blank URL become null; empty list entries are rejected.

Accessories require player counts, times and recommendedPlayers to be null. These
values are rejected rather than silently dropped. Accessory-specific fields must be
empty/null for base games and expansions. A type change must explicitly clear fields
that no longer apply, evaluated against the current state. minAge can still apply to
an accessory; categories and target lists may be empty during initial cataloging.

Descriptions/contents are inert strings, not trusted HTML. A future renderer must
escape or sanitize them. URLs are NOT fetched by this module. Existence, archive
eligibility, self-links and database referential integrity need the D2 repository
(the draft also forbids self-relations). Category and target changes must be recorded
in the same revision snapshot as editable scalar changes.

## Public view model

- Source reference, stable key, localized BGG name, type, nullable factual data,
  publication/taxonomy terms, source-labelled player advice, image choices and URL.
- BGG taxonomy retains real numeric BGG IDs. Custom taxonomy has source/name only.
- BGG community best-player counts and editor recommendations have different tags.
- The BGG-only `bgg` branch retains the original statistics, rankings, raw relations
  and evidence without reinterpretation. NotBGG always projects bgg=null, including
  when its system metadata records a confirmed BGG link.
- BGG unknown numeric sentinels project to null; original BGG data remains intact.
- Images use full image for detail, thumbnail first for catalog, then full-image
  fallback when distinct. The existing renderer owns lazy loading/error handling.
- Accessories project play=null and advice=null. No new source is fed into BGG
  expansion counts, signals, official relation indexes or translation dictionaries.
- editorNotes, revision audit, collection metadata and private actor data are excluded.
- This full detail VM must not be embedded wholesale into future catalog payloads:
  D4 must retain the C-stage compact payload/no descriptions behavior.

## Persistence draft and D2 prerequisites

- `notbgg_ids`: independent AUTOINCREMENT reservation ledger, unique request key and
  payload hash, immutable rows. First allocation is 1, gaps allowed. Commit reservation
  before exposing a number; retain unused committed reservations. Never use MAX+1,
  reset sqlite_sequence, INSERT OR REPLACE, or accept a client-supplied sequence.
- `notbgg_games`: scalar fields and validated JSON name/taxonomy arrays; immutable
  source and v2_games.id reference; revision increments; soft archive only. NotBGG
  publication year lives here: do not force it into v2_games' 1800..2200 constraint.
- `notbgg_game_revisions`: append-only full source snapshots with revision and actor.
- `notbgg_accessory_categories`: multiselect join; type guards and deduplication.
- `site_game_relations`: separate manual accessory_for edges using stable internal
  IDs. Target may be BGG or registered NotBGG. No official BGG relation writes.
  Existing v2_game_relations/collection tables are neither rewritten nor relabelled.
- `notbgg_bgg_links`: pending/linked/revoked records. One live pending-or-linked row
  per NotBGG and at most one active link per BGG ID. Candidate IDs need not already
  be registered; confirmation requires the matching BGG v2 identity. Confirming
  identity does not itself select BGG as primary: default is notbgg, explicit admin
  choice is a separate service command and audit event.
- `notbgg_link_events`: append-only proposal, confirmation, primary-source choice
  and revocation history. Revoked mapping rows are immutable; relinking creates a
  new proposal. Original NotBGG/collection references never move.
- `NotBggLinkStatus` is the current projection: unlinked (including revoked-only
  history), pending or linked. linkedBggId/linkedAt expose only a confirmed active
  target. No active link means primarySource=notbgg. source always remains notbgg.

D2 must implement authorization, trusted actor propagation, idempotency/hash
conflicts, atomic creation/revision/events, optimistic concurrency, source/target
existence/archive checks, link-state projection and explicit primary-source commands.
Atomic batches must check conditional-update outcomes, not merely lack of SQL errors.
There is no database repository or allocator implementation in D1.

Before promoting the draft, verify foreign keys/triggers/partial indexes and JSON
validation using an explicitly authorized isolated database, test concurrent creation,
retries, rollback, permanent reservations, archive, one-to-one conflicts and revocation.
JSON element types/limits and URL protocols are enforced by the application validator;
SQL checks defend scalar ranges, JSON shape, source identity and relationship rules.

Official references:
- https://www.sqlite.org/autoinc.html (no reuse of committed automatic IDs; gaps allowed)
- https://developers.cloudflare.com/d1/worker-api/d1-database/ (batch atomicity)
