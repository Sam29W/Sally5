# STATUS

## Stage 0: Foundation — SHIPPED (2026-10-03)

### What was built

- pnpm workspace monorepo: `apps/api`, `apps/checkout-web` (placeholder), `apps/dashboard-web`
  (placeholder), `packages/shared`, `packages/config`.
- `infra/docker-compose.yml`: health-checked Postgres 16, Redis 7, Redpanda (Kafka-compatible).
- `packages/config`: `loadConfig()` (Zod-validated env schema, fails fast on boot with a
  readable error) and `createLogger()` (pino, redacts phone/OTP-shaped values by field name
  and by regex over free-text log messages).
- `apps/api`: NestJS app with a request-id middleware (honors inbound `x-request-id`, else
  generates a UUID) and a `GET /health` endpoint.
- GitHub Actions CI (`.github/workflows/ci.yml`): install → lint → format → typecheck → test
  → build.
- `.env.example`, root ESLint flat config + Prettier, base `tsconfig`.

### What was verified

- Typecheck, lint (`--max-warnings=0`), and format checks all pass clean.
- `pnpm run build` compiles every workspace package.
- `pnpm audit`: 1 critical (vitest, CVE in its UI server) found and fixed by bumping to
  `^3.2.6`. 21 residual low/moderate/high advisories remain, all transitive inside NestJS
  10's `express` dependency chain — tracked as a known gap, see
  [`docs/decisions/001-stage0-foundations.md`](docs/decisions/001-stage0-foundations.md).
- `gitleaks` installed, run for real against the working tree and full git history: no
  leaks found. Wired into CI (`gitleaks/gitleaks-action@v2`) and enforced locally via a
  husky `pre-commit` hook (`gitleaks protect --staged`).
- End-to-end smoke test: brought up `docker compose`, started the built API against it,
  confirmed `GET /health` returns `200 {"status":"ok",...}` with an `x-request-id` header.

### Test results

- `packages/config`: 4/4 tests pass (`redactPII` — phone redaction, OTP redaction, mixed,
  and negative/untouched-text cases).
- `apps/api`: 1/1 test passes (`GET /health` returns `200` with `status: "ok"`).
- Full suite (`pnpm run test`): 5/5 passing, 0 flaky.

### Known gaps / follow-ups

- `apps/checkout-web` and `apps/dashboard-web` are placeholder packages only — real
  SvelteKit apps land in Stage 6 and Stage 8.
- Residual non-critical `pnpm audit` findings in NestJS 10's transitive deps — revisit on a
  future NestJS major bump.
- Local Postgres is mapped to host port `55432` (not `5432`) to avoid clashing with other
  unrelated Docker containers already running on this dev machine — see decision 001.
- Package scope is the neutral `@app/*` pending a final product name — see decision 001.

### Decisions

- [`docs/decisions/001-stage0-foundations.md`](docs/decisions/001-stage0-foundations.md)

## Stage 1: Identity (phone OTP) and shopper profile — SHIPPED (2026-10-03)

### What was built

- `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`,
  `POST /auth/logout` (contract: [`docs/api/auth.openapi.yaml`](docs/api/auth.openapi.yaml)).
- `OtpService`: 6-digit codes in Redis only, 5-minute TTL, max 5 attempts (429 lockout),
  30s resend cooldown, per-phone and per-IP hourly rate limits, single-use (deleted on
  success — replay-proof).
- `TokenService`: short-lived JWT access tokens; rotating opaque refresh tokens
  (`SessionFamily`/`RefreshToken` in Postgres via Prisma). Reusing an already-rotated
  refresh token revokes the entire session family.
- `ShopperService`: find-or-create by phone, AES-256-GCM-encrypted phone at rest
  (`PHONE_ENCRYPTION_KEY`) plus a separate HMAC-SHA256 lookup hash
  (`PHONE_HASH_KEY`) — the plaintext phone is never persisted. Consent recorded
  (`purpose: "login"`) on first login.
- `ConsoleSmsProvider`: dev/test-only SMS driver behind an `SmsProvider` interface; no real
  gateway wired yet (per stage scope).
- Prisma schema + migration (`prisma/migrations/20261003092155_init`) for `shoppers`,
  `consent_records`, `session_families`, `refresh_tokens`.

### What was verified

- Typecheck, lint, format all clean across the workspace.
- Self-review fix: the OpenAPI contract said OTP lockout is `429`; the controller
  originally returned `401` for both invalid and locked OTP. Fixed the controller to match
  the documented contract (locked → 429, invalid → 401) and added a regression test.
- Migrations: applied (`migrate dev`), reset/rolled back (`migrate reset --force`), and
  reapplied (`migrate deploy`) against a live Postgres — all clean.
- `pnpm audit`: no new findings beyond Stage 0's documented NestJS-transitive set (21,
  unchanged).
- `gitleaks` run for real against the working tree: one true finding (a high-entropy
  placeholder key in `.env.example`) — allowlisted with a comment explaining it's an
  intentional non-secret template, not a leak. Zero findings after.
- Found and fixed a real NestJS+Vitest pitfall: `tsx`/esbuild doesn't emit TypeScript's
  `design:type` decorator metadata, which silently broke Nest's by-type dependency
  injection (constructor params resolved to `undefined`) and skipped
  `class-validator`'s `forbidNonWhitelisted` check under test. Fixed with explicit
  `@Inject(Token)` everywhere plus `unplugin-swc` in `apps/api/vitest.config.ts`. See
  [`docs/decisions/002-stage1-identity.md`](docs/decisions/002-stage1-identity.md).

### Test results

- 20/20 tests in `apps/api` pass: OTP brute-force lockout, replay rejection, resend
  cooldown, per-phone rate limiting, refresh-token rotation, refresh-token reuse → session
  family revoked, tampered/malformed refresh token rejection, logout revocation, whitelist
  validation (400 on unknown fields), full HTTP-level login→refresh→logout flow, and a
  direct proof the shopper table never stores a plaintext phone number.
- `ConsoleSmsProvider` test proves the SMS "send" path never writes a plaintext phone or
  OTP to the log stream.
- Full workspace suite (`pnpm run test`): 24/24 passing, 0 flaky, run twice with identical
  results.
- Coverage is qualitative here (no coverage tool wired yet) but every acceptance-criterion
  path (brute force, replay, reuse → family revocation, no-plaintext-phone) has a direct
  test — flagged as a gap below.

### Known gaps / follow-ups

- No coverage report tool wired in yet (target ≥80% on business logic per the master
  prompt) — add `@vitest/coverage-v8` and report real numbers in a later stage rather than
  asserting a percentage without a tool to back it.
- Refresh-token rotation and OTP verification are not fully race-safe under concurrent
  requests with the same token/code — see decision 002 for the fix plan (DB row lock /
  Redis compare-and-delete), deferred to Stage 9 hardening.
- `req.ip`-based per-IP rate limiting has no `trust proxy` configuration — fine for local
  dev, must be revisited once this runs behind a load balancer.
- No route is protected by `TokenService.verifyAccessToken()` yet — there's nothing to
  protect until Stage 2/3 add shopper-facing endpoints.

### Decisions

- [`docs/decisions/002-stage1-identity.md`](docs/decisions/002-stage1-identity.md)

## Stage 2: Merchants, API keys, and the address book — SHIPPED (2026-10-03)

### What was built

- Merchant multi-tenancy: `POST /merchants` (bootstrap, no auth gate — see decision 003),
  `POST /merchants/api-keys/rotate` (old key revoked immediately). `ApiKeyGuard` resolves
  `x-api-key` → `merchantId` for every merchant-scoped route.
- Webhook endpoints: `POST /webhooks`, `GET /webhooks`, `DELETE /webhooks/:id` — every query
  is scoped to the authenticated merchant; cross-tenant access returns `404`.
- Shopper address book: `POST/GET /shopper/addresses`, `PATCH/DELETE /shopper/addresses/:id`,
  `POST /shopper/addresses/:id/default`, `POST /shopper/addresses/:id/share` (consent to
  reuse across merchants). Pincode validation/normalization
  ([pincode.util.ts](apps/api/src/address/pincode.util.ts)) and a pure address-quality score
  ([address-quality.ts](apps/api/src/address/address-quality.ts)). This closes the Stage 1
  gap of `TokenService.verifyAccessToken()` having no guard wired to it —
  `AccessTokenGuard` now protects every shopper-facing route.
- Shopper data rights: `GET /shopper/me/export` (full profile + consents + addresses),
  `DELETE /shopper/me` (cascading erasure).
- Contracts: [`docs/api/merchants.openapi.yaml`](docs/api/merchants.openapi.yaml),
  [`docs/api/shopper.openapi.yaml`](docs/api/shopper.openapi.yaml).
- Migration `20261003110701_merchants_webhooks_addresses` for `merchants`, `api_keys`,
  `webhook_endpoints`, `addresses`, `address_shares`.

### What was verified

- Typecheck, lint, format all clean.
- Migrations: applied, reset/rolled back, reapplied against live Postgres — clean, no drift.
- `pnpm audit`: no new findings (21, unchanged from Stage 1).
- `gitleaks`: two true findings, both in the local `.env` only (never committed, gitignored)
  — zero findings in anything tracked by git.
- Self-review of every new Prisma query confirmed tenant/owner scoping is enforced before
  any read, update, or delete (see decision 003) — not just at the guard layer.
- End-to-end smoke test against the live stack: created a merchant, got a usable API key,
  confirmed `/health` still responds.

### Test results

- 37/37 tests in `apps/api` pass (up from 20), run twice with identical results:
  - Cross-tenant isolation: a merchant cannot list, see, or delete another merchant's
    webhook endpoints (`404`, not `403` — existence isn't leaked); API key rotation
    immediately invalidates the old key.
  - Address ownership: a shopper cannot read, update, default, or delete another shopper's
    address (`404`).
  - Address CRUD: create/list/default-switching/delete, invalid-pincode rejection (`400`),
    deterministic quality scoring (unit tests, no I/O).
  - Shopper data rights: full export round-trips an address and the Stage 1 login consent;
    delete cascades so a subsequent export correctly `404`s.
- Full workspace suite (`pnpm run test`): 41/41 passing, 0 flaky.

### Known gaps / follow-ups

- `POST /merchants` has no auth gate (can't, since it mints the first key) — needs an
  admin-only provisioning flow before real merchants onboard. See decision 003.
- No endpoint yet reads a shared address on the merchant side — the `AddressShare` consent
  table exists but nothing consumes it until Stage 3's checkout flow needs it.
- Coverage-% tooling still not wired in (carried over from Stage 1).
- Stage 1's race-safety and `trust proxy` gaps are unchanged — see decision 002.

### Decisions

- [`docs/decisions/003-stage2-tenancy-addresses.md`](docs/decisions/003-stage2-tenancy-addresses.md)
