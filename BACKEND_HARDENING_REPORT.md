# Backend Hardening Report

## Executive Summary

The existing Express/Prisma architecture was preserved and hardened in place. Confirmed defects in article tags, public search, gallery serialization, lifecycle authorization, OTP handling, taxonomy transactions, cache TTLs, password reset links, environment/CORS configuration, and contact delivery configuration were corrected. A clean ESLint setup, 90 isolated tests, and 3 dedicated-database integration tests now protect the foundation.

Assessment: **READY WITH CONDITIONS** for Admin integration. Step 2 can begin. Before a production launch, a real supported OTP provider must be implemented/configured and the remaining Prisma CLI advisory must be resolved through a separately tested Prisma upgrade.

No operational database rows were mutated by automated tests. Read-only live probes were used against the operational database; all mutation-based integration cases ran only against the safely distinct `TEST_DATABASE_URL`, then removed their exact fixtures (verified residue count: zero).

## Baseline

- Branch: `fix/backend-production-hardening`
- Base commit: `8629719 feat(app): bootstrap API server and scheduled publishing`
- Node: `v24.15.0`
- npm: `11.12.1`
- Prisma schema: valid
- Operational migrations: 4 found; schema reported up to date
- Dedicated test database: configured, distinct from operational URL, migrations up to date
- Initial test setup: none
- Final test setup: Jest/Supertest unit/contract suites plus a guarded dedicated-database integration runner
- Initial lint state: script existed but ESLint configuration was missing
- Final lint state: zero warnings/errors

## Defects Addressed

### H-1 — Article tag persistence

Finding: Create/update called `syncTags` without its Prisma client argument.

Root cause: Call sites passed `(articleId, tags)` to a `(client, articleId, tags)` helper, causing the helper to return on `tagNames === undefined`.

Files changed: `src/services/articleService.js`, tag unit/integration tests.

Fix: Both call sites now pass the active transaction client. Normalization, duplicate/case de-duplication, relation replacement/removal, transaction atomicity, and returned tag names are covered.

Tests: create, update/replace, remove, duplicate/case variants, DTO tag response; real dedicated-database create/update/remove.

Verification: 90 isolated tests and 3 integration tests pass.

Status: **FIXED + TESTED**

### H-2 — Relevance search HTTP 500

Finding: `Prisma.sql` was placed inside `where.OR`, which Prisma rejects. A live probe also showed the operational database lacked the FULLTEXT index despite the migration being recorded as applied.

Root cause: Unsupported query composition plus schema/index drift.

Files changed: `src/controllers/publicController.js`, public search tests.

Fix: Relevance now uses supported, parameterized Prisma filters to fetch a bounded candidate set and deterministic in-process ranking. It no longer depends on optional FULLTEXT metadata. Category, public visibility, limit, empty results, maximum query length, and all sort modes are preserved.

Tests: relevance/newest/popular, category, limit, empty/zero results, punctuation/wildcards/quotes, Tamil Unicode, spaces, and 200/201-character boundaries. Real operational read-only probes and dedicated-database endpoint tests passed.

Verification: Live HTTP probes returned 200 for all sort/input cases; no raw user-composed SQL remains in this path.

Status: **FIXED + TESTED**

### H-3 — Gallery response crash

Finding: Gallery images were loaded without nested media while serialization dereferenced `gi.media.url`.

Root cause: Incomplete Prisma include.

Files changed: `src/controllers/publicController.js`, gallery contract/integration tests.

Fix: Gallery queries include `images.media`; the mapper defensively excludes a missing media relation and preserves database sort order.

Tests: empty, one/multiple, ordering, nullable cover, missing media, album filtering, and persisted populated gallery.

Status: **FIXED + TESTED**

### H-4 — Publication/RBAC bypass

Finding: Every lifecycle action required only `news.edit`, and initial published/scheduled creation required only `news.create`.

Root cause: Static route authorization did not account for requested action or initial status.

Files changed: `src/middleware/authenticate.js`, `src/routes/admin/index.js`, lifecycle/RBAC tests.

Fix: Added action-aware guards. Approve/reject require `news.approve`; publishing, unpublishing, scheduling, and schedule cancellation require `news.publish`; submit requires `news.edit`. Initial scheduled/published states require publish authority. Guards run before controller/service mutation.

Tests: all seven roles, extra per-user grants, Super Admin bypass, forged/unknown action handoff to validation, direct privileged initial states, allowed/denied matrix.

Status: **FIXED + TESTED**

### Lifecycle state machine

Finding: Invalid transitions were controlled, but schedule cancellation retained scheduling timestamps.

Root cause: Draft timestamp cleanup was limited to unpublish.

Fix: Every transition to draft clears `publishedAt`; cancel-schedule also clears `publishDate` and `publishTime`.

Tests: all declared valid transitions, invalid source/action combinations, no mutation on conflict, and schedule timestamp cleanup.

Status: **FIXED + TESTED**

### H-6 — Password reset URL and session revocation

Finding: Email linked to a POST-only API URL. Reset session revocation also escaped the intended Prisma transaction.

Root cause: API base URL was used instead of the Admin frontend origin; an async token helper wrapped a Prisma operation before the transaction array.

Files changed: `src/services/authService.js`, `src/services/tokenService.js`, password-reset tests.

Fix: URL is built from `ADMIN_FRONTEND_ORIGIN` with `URL/searchParams` encoding. Password update, token consumption, and refresh-session revocation now share one interactive transaction client.

Tests: URL target/encoding, enumeration resistance, expiry, used token, atomic success, refresh revocation.

Status: **FIXED + TESTED**

### H-7 / M-2 — OTP errors, limiter, attempts, expiry, and provider boundary

Finding: Nonexistent `tooManyRequests` calls produced TypeErrors; OTP routes used the generic auth limiter; attempts were hardcoded; provider selection always fell back to console behavior.

Root cause: API helper/config drift and ineffective provider selection.

Files changed: `src/services/readerAuthService.js`, `src/routes/public/index.js`, `src/config/env.js`, `src/utils/apiError.js`, OTP tests.

Fix: Standardized on `ApiErrors.tooMany`, preserved specific OTP codes, applied `otpLimiter`, consumed validated expiry/attempt settings, and added explicit provider selection. Unsupported providers fail clearly; console/dev are refused in production; real OTP values cannot be logged in production.

Tests: allowed/throttled request, wrong code, increment, configured max, locked, expired, consumed/missing, correct/consumed, unsupported provider, controlled 4xx responses.

Status: **FIXED + TESTED** (external production SMS delivery is intentionally not implemented)

### H-9 — Taxonomy transaction

Finding: Category create/update opened a transaction but child synchronization used global Prisma.

Root cause: Helper did not accept a database client.

Files changed: `src/controllers/taxonomyController.js`, taxonomy transaction tests.

Fix: Every child lookup/create/count/delete receives and uses the supplied transaction client. Child failures propagate so the enclosing transaction rolls back.

Tests: parsing, create/remove child operations, supplied-client assertions, and failure propagation.

Status: **FIXED + TESTED**

### M-1 — Cache TTL units

Finding: Cache accepted seconds while weather/market passed millisecond expressions, extending entries for days.

Root cause: Ambiguous caller units.

Files changed: `src/utils/cache.js`, weather/market providers, cache tests.

Fix: Cache explicitly accepts `ttlSeconds`; provider callers use validated `WEATHER_CACHE_TTL_SECONDS` and `MARKET_CACHE_TTL_SECONDS`. Invalid TTLs throw.

Tests: fake-timer expiry boundary and invalid values.

Status: **FIXED + TESTED**

### Environment, CORS, and contact mail

Finding: Reader JWT variables were unvalidated, CORS omitted its own safe defaults unless explicitly set, and contact mail used sender identity as recipient.

Fix: Added validated reader JWT, extra-origin, contact-recipient, OTP/cache settings; CORS always constructs a de-duplicated allowlist from validated origins; contact uses `CONTACT_RECIPIENT`. Credentialed CORS remains restricted.

Tests: default configured origins, no-origin/server calls, allowed Admin origin, rejected unknown origin, credentials/headers.

Status: **FIXED + TESTED**

### ApiError consistency

Finding: Reader/OTP/upload call sites supplied specific codes that helpers discarded or treated as details; password-change custom text was discarded.

Fix: Helpers now accept intentional custom codes/messages while preserving the existing envelope.

Tests: controlled rate-limit envelope and OTP/auth error codes.

Status: **FIXED + TESTED**

### Upload validation

Finding: Existing architecture was sound and required regression protection.

Fix: No storage redesign. Added coverage for magic bytes, MIME/extension spoofing, image/PDF compatibility, size limits, path containment, thumbnail/DB record behavior, deletion, and missing media. Tests mock storage or use buffers and never write to the operational upload directory.

Status: **ALREADY FIXED BEFORE TASK + TESTED**

## RBAC Matrix

| Role | Create/edit/submit | Approve/reject | Publish/schedule/unpublish/cancel |
| --- | --- | --- | --- |
| `super_admin` | Allowed | Allowed | Allowed |
| `admin` | Allowed | Denied | Allowed |
| `editor` | Allowed | Allowed | Allowed |
| `reporter` | Allowed | Denied | Denied |
| `moderator` | Denied | Denied | Denied |
| `content_manager` | Allowed | Denied | Denied |
| `advertisement_manager` | Denied | Denied | Denied |

Extra per-user permissions such as `news:publish` are additive and honored. Inactive users are denied during authentication before RBAC.

## Test Results

- `npm run lint`: passed, zero warnings/errors
- `npm test`: passed
  - isolated unit/contract: 16 suites, 90 tests
  - dedicated-database integration: 1 suite, 3 cross-layer tests
  - total: 17 suites, 93 tests
- Operational read-only search/gallery probes: passed after the search fallback correction
- Test fixture cleanup: verified zero matching category/reporter/article/gallery/media residue
- `npx prisma validate`: passed
- `npx prisma migrate status`: 4 migrations; operational schema reported up to date
- Dedicated test DB migration status: up to date
- Runtime API checks for upgraded `node-cron`, `sharp`, and `nodemailer`: passed

## API Contract Baseline

See `docs/API_CONTRACT_BASELINE.md`.

## Environment Changes

Names only:

- `JWT_READER_SECRET`
- `JWT_READER_EXPIRES_IN`
- `EXTRA_CORS_ORIGINS`
- `CONTACT_RECIPIENT`
- Existing validated/used settings confirmed: `ADMIN_FRONTEND_ORIGIN`, `PUBLIC_FRONTEND_ORIGIN`, `OTP_PROVIDER`, `OTP_EXPIRY_MINUTES`, `OTP_MAX_ATTEMPTS`, `WEATHER_CACHE_TTL_SECONDS`, `MARKET_CACHE_TTL_SECONDS`, `TEST_DATABASE_URL`

No `.env` file was changed and no values are included here.

## Dependencies Added/Removed

Added development dependencies:

- `jest`: one maintained CommonJS-compatible regression framework.
- `supertest`: HTTP contract testing without binding a production listener.

Targeted runtime security upgrades:

- `nodemailer` to `^9.0.5`
- `sharp` to `^0.35.3`
- `node-cron` to `^4.6.0`

These upgrades removed four high/two moderate audit findings from runtime dependencies. No broad framework/ORM upgrade was performed.

## Remaining Backend Risks

1. `npm audit` still reports three high findings in the Prisma development CLI/config dependency chain (`prisma` → `@prisma/config` → `deepmerge-ts`). Runtime `@prisma/client` is not identified in that chain. The available resolution requires a separately tested Prisma major-line change; this was intentionally deferred.
2. Operational index metadata contains no FULLTEXT index even though the raw migration is recorded as applied. Search no longer depends on it, but migration drift should be reconciled in a planned, non-destructive DBA change before relying on FULLTEXT performance.
3. Relevance ranking is bounded to at most 200 matching candidates. This is predictable and safe for current scale; larger datasets may need a verified search index or external search service later.
4. This build intentionally has no production SMS implementation. Production startup rejects console/dev or unknown OTP providers. A real provider must be implemented and verified before production reader OTP is enabled.
5. SMTP/SMS delivery cannot be end-to-end verified without external provider credentials; service boundaries and failure behavior are tested.

None of these conditions blocks development of real Admin authentication/API infrastructure in Step 2. Items 1, 2, and 4 must be resolved or explicitly accepted before production launch.

## Deferred Work

- Admin Panel integration, reset page, API client, refresh interceptor, forms, and permission UI.
- Public Frontend API replacement, rendering, reader-auth UI, SEO, comments, breaking ticker, and gallery UI.
- New paid SMS provider integration.
- Object/cloud storage migration.
- Global pagination normalization and supporting-resource contract redesign.
- Prisma major upgrade and operational FULLTEXT index reconciliation.

## Production Security Sanity Check

- Helmet remains active.
- Credentialed CORS is restricted to validated configured origins.
- Global/auth/OTP/search/content/contact/comment/refresh rate limiters remain active.
- JSON/form body limits remain 2 MB.
- Admin and reader password verification remains Argon2id.
- Refresh tokens remain opaque, hashed, rotated, httpOnly, SameSite=Strict, and Secure in production.
- Article HTML sanitization remains server-side.
- Upload content/size/path validation remains active.
- JWT, refresh, reset, credential, and production OTP values are not logged.
- Search contains no user-concatenated raw SQL.
- RBAC remains server-side; inactive Admin users are rejected.
- Production internal errors do not expose Prisma details or stacks.

## Production Readiness

**READY WITH CONDITIONS**

The backend is sufficiently stable and contract-tested to begin Step 2 Admin integration. Production deployment remains conditional on a supported SMS provider (if reader OTP is enabled), Prisma advisory resolution/acceptance, and operational index-drift reconciliation. No deployment was performed.
