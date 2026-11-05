# NotBGG D3 administration

This phase adds protected management UI/APIs only. Public /games, /collection, BGG
cache/parser/official relation semantics and all migrations are unchanged.
No remote/production D1 has been queried, written or migrated; no deployment occurred.

## Routes

- /admin/notbgg: bounded list, name/full-ID query, previous/next cursor pages,
  optional archived rows. Cards show ID/name/type/categories/timestamps/revision/state.
- /admin/notbgg/new: complete V1.2 editable form.
- /admin/notbgg/000001: original source edit, read-only system metadata, archive
  confirmation and paginated read-only revision snapshots (actor/time/operation).
- The existing dashboard links to the management list. ?lang=en selects English;
  Traditional Chinese is the default. Admin routes stay inside the existing /admin
  Access policy rather than creating a separate unprotected localized namespace.

| API | Method | Body/query |
|---|---|---|
| /api/admin/notbgg | GET | q,limit=20 (max100),after,includeArchived |
| /api/admin/notbgg | POST | D1 editable fields; Idempotency-Key header |
| /api/admin/notbgg/NotBGG%3A000001 | GET | none |
| same record path | PATCH | {expectedRevision,changes} |
| record path/archive | POST | {expectedRevision} |
| record path/history | GET | afterRevision,limit=20 (max100) |

No DELETE, restore, image upload, public write or BGG mapping workflow is exposed.
All writes and reference lookups go through NotBggRepository. No API executes SQL.

## Authentication and request security

Middleware recognizes normalized/encoded admin paths and protects every new page.
Each API independently verifies Cf-Access-Jwt-Assertion, even without middleware.
The existing /api/admin/auth-check endpoint also independently verifies Access.
The shared jose verifier validates RS256 signature/JWKS, issuer, audience, expiry,
required exp/iat/sub/email and the existing allowed ADMIN_EMAIL identity. The trusted
subject supplies the revision actor and scopes the opaque idempotency key. Body actor,
email, ID, timestamps, link state and other noneditable fields are rejected.

New NotBGG routes NEVER use the legacy LOCAL_ADMIN_DEV exemption, even with DEV,
localhost and that binding enabled. There is no new test identity bypass. Test keys,
JWT generation, JWKS transport mocking and injected local bindings exist only under
tests/. No tokens, keys, claims or raw database errors are logged.

POST/PATCH require exact request Origin matching the URL origin,
X-NotBGG-Request: 1, and no cross-site/same-site Fetch Metadata. No CORS permission is
granted. Non-JSON bodies get 415. Declared AND streamed bytes are capped at 256 KiB;
invalid JSON/UTF-8, >32 object fields, >8 nesting depth or >5000 JSON nodes are rejected.
Responses use no-store/nosniff/noindex. Management pages prohibit framing and use a
restricted referrer policy. Descriptions/notes/history use escaped text/textContent,
never user-supplied HTML. Forms remain disabled without JavaScript.

Status mapping: 401 missing/invalid token; 403 identity/Origin denied; 400 validation,
ID/query/JSON errors; 404 absent record; 405 unsupported method; 409 revision,
archive/idempotency conflicts; 413 body size; 415 media type; 429 configured limiter
rejection; 500 generic storage/service failure; 503 absent D1 binding. There is no
fallback to another database, JSON file or cache when DB is absent.

**Distributed rate limiting is NOT configured or production-verified.** The API
supports an optional NOTBGG_WRITE_LIMITER native Cloudflare binding and returns 429
with Retry-After when denied. A deployment owner must explicitly configure its
namespace, quota/period and Access policies before production acceptance. No per-isolate
in-memory map is presented as global rate limiting. Missing limiter does not pretend
to enforce a quota; authorization, Origin and per-request limits still apply.

## Forms and source semantics

All V1.2 fields are present; optional numeric blanks become null. Lists use lines,
recommendations comma/space-separated integers. Image/reference fields use validated
HTTP(S) URLs only; no image download/upload pipeline is added.

Accessories require at least one of the eight categories at this management boundary
(D1/D2 still permit an empty category list for earlier source drafts). Players/times
and recommended counts are hidden and must be null for accessories. Type switches
with incompatible populated fields ask before clearing; cancellation preserves values.
Switching away also asks before clearing accessory-only data.

Related games use strict serialized GameRef: BGG:205637 or NotBGG:000001. New targets
must already exist in the internal registry and custom targets must be active. An
unknown cached-but-unregistered BGG ID is reported, never auto-imported or invented.
Existing unchanged references are preserved. Manual edges never enter BGG official
expansion arrays. Repository additions are limited to query, paged history and target
existence validation; no migration change was needed.

Save freezes the form while pending and keeps one creation key for retries. Successful
creation shows the allocated ID and changes the same form into editing that record.
409 retains input and offers explicit reload; no automatic overwrite/retry occurs.
An edit page with failed initial loading cannot fall through to creation. Archive
requires confirmation and expectedRevision, retains ID/history/collection references,
and makes the form read-only. Unsaved navigation uses beforeunload after user input.

Authenticated detail responses explicitly split admin (full source) and public
(existing sanitized VM) projections; this does NOT create a public endpoint. List
summaries omit editor notes. All revision snapshots and actors remain admin-only.

## Verification and remaining production acceptance

- Signed JWT security/API tests use disposable local Miniflare D1 and fake public
  JWKS transport, while running the real signature/claim verifier.
- Actual middleware is bundled with test-only bindings; LOCAL_ADMIN_DEV=true cannot
  authorize any new page/API. Encoded admin paths are included.
- Local browser tests render the actual Astro component/CSS/controller and call the
  real API handler with signed tokens and isolated D1. Desktop/mobile, type-confirm
  cancellation, required categories, mixed references, double submit, revision
  conflicts/reload, read-only history, archive, search/pagination, keyboard focus,
  beforeunload, read failure and no-JS safety are exercised. External requests blocked.
- C-stage and A-2/A-3 unit/component regressions are retained.

Production Access policy/JWKS availability, real administrator login, native limiter
quota, real-domain Origin behavior, remote migration state and production writes are
NOT TESTED. Do not deploy or apply a remote migration as part of this phase.

Before D4, confirm public canonical/deduplication behavior, archive visibility and
which NotBGG fields may enter the compact public payload. Public data integration and
complete NotBGG→BGG link commands remain separate future work.

## Changed files

Modified: src/lib/auth/cloudflare-access.ts, src/middleware.ts,
src/lib/notbgg-repository.ts, src/pages/admin/index.astro,
src/pages/api/admin/auth-check.ts.

Added:
- src/lib/auth/admin-request.ts
- src/lib/notbgg-admin-api.ts
- src/lib/notbgg-admin-controller.ts
- src/lib/notbgg-admin-fields.ts
- src/components/NotBggAdmin.astro
- src/pages/admin/notbgg/index.astro
- src/pages/admin/notbgg/new.astro
- src/pages/admin/notbgg/[id].astro
- src/pages/api/admin/notbgg/index.ts
- src/pages/api/admin/notbgg/[id].ts
- src/pages/api/admin/notbgg/[id]/archive.ts
- src/pages/api/admin/notbgg/[id]/history.ts
- tests/helpers/notbgg-access-fixture.ts
- tests/helpers/notbgg-admin-preview.ts
- tests/notbgg-admin-api.test.ts
- tests/notbgg-middleware.test.ts
- tests/notbgg-admin-browser.cjs
- docs/notbgg-d3-admin.md
