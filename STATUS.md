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

## Fixups before Stage 3 — SHIPPED (2026-10-03)

Requested explicitly before starting Stage 3: close the two Stage 1 race-safety gaps, wire
trust-proxy configuration, wire coverage reporting into every gate, and record the
Stage 9 admin-provisioning action item.

### What was built

- **Atomic OTP verify**: replaced `OtpService.verify`'s GET-then-SET with a single Redis
  Lua `EVAL` ([otp.service.ts](apps/api/src/auth/otp.service.ts)) — compare-hash,
  increment-attempts-or-lock, and delete-on-success all happen in one atomic script, closing
  the TOCTOU window two concurrent verify calls for the same code used to have.
- **Atomic refresh-token rotation**: replaced `TokenService.rotate`'s read-then-write with
  an atomic `updateMany({ where: { id, rotatedAt: null } })` claim
  ([token.service.ts](apps/api/src/auth/token.service.ts)) — Postgres row-level locking on
  the single `UPDATE ... WHERE` means only one of two concurrent rotations can ever win; the
  loser (and any later replay) is treated as reuse and revokes the family, same as before.
- **`TRUST_PROXY_HOPS`** env var (default `0` — safe, ignores `X-Forwarded-For` entirely) and
  a shared `applyTrustProxy()` helper ([trust-proxy.ts](apps/api/src/trust-proxy.ts)) used by
  both `main.ts` and tests, so production and test behavior can't drift apart.
- **Coverage**: `@vitest/coverage-v8` wired into `apps/api` and `packages/config`
  (`pnpm run test:coverage` at the root, per-package `test:coverage` scripts).
- Closed an incidental real gap found while wiring coverage: `requestIdMiddleware` was only
  ever applied in `main.ts`, never in any test's app bootstrap — so it was both 0% covered
  and never actually exercised end-to-end. Added a direct unit test
  ([request-id.middleware.test.ts](apps/api/src/request-id.middleware.test.ts)) and wired
  the middleware into every e2e test's bootstrap to match production composition.

### What was verified

- Typecheck, lint, format all clean.
- `pnpm audit` / `gitleaks`: unchanged from Stage 2 (no new dependencies with findings; no
  new secrets).

### Test results

- **Concurrency tests, both passed first try**: 5 parallel `OtpService.verify()` calls with
  the same correct code → exactly 1 succeeds, 4 rejected; 5 parallel
  `TokenService.rotate()` calls with the same token → exactly 1 succeeds, 4 rejected as
  reuse, and the family ends up revoked (even the "winning" rotation's new token stops
  working, since the race itself counts as reuse).
- **Trust-proxy tests** (`apps/api/src/trust-proxy.test.ts`, 4 tests, plain Express +
  supertest, no Nest/DB/Redis needed): with `hops=0` (default), spoofed
  `X-Forwarded-For` values are ignored and always resolve to the same real socket address
  — proving per-IP rate limiting can't be bypassed by header spoofing out of the box; with
  `hops=1`, distinct `X-Forwarded-For` values correctly resolve to distinct client IPs —
  proving it works as intended once actually deployed behind one real proxy.
- **Coverage, real numbers** (not asserted, measured):
  - `apps/api`: **94.15% statements / 92.63% branches / 98.09% functions** (business logic
    only — modules, DTOs, and `main.ts` excluded from the denominator as pure wiring).
    Lowest files: `auth.controller.ts` (84.93%, uncovered lines are a few defensive
    catch-all branches), `phone.util.ts` (71.42%, the uncovered lines are the
    non-`+`-prefixed/invalid-format branches of `normalizePhone` that no current caller
    exercises).
  - `packages/config`: **97.1% statements / 93.75% branches / 100% functions**.
  - Both comfortably clear the master prompt's ≥80% target; reported honestly rather than
    asserted.
- Full workspace suite (`pnpm run test`): **47/47** passing in `apps/api` (up from 37) +
  **11/11** in `packages/config` (up from 4) = **58/58** total, 0 flaky, run twice.

### Known gaps / follow-ups

- `phone.util.ts`'s invalid-format branches are untested because nothing currently calls
  `normalizePhone` with a malformed number in a way that reaches them through the public
  API (DTO validation catches most bad input first) — low priority, revisit if
  `normalizePhone` grows more callers.
- Carrying forward Stage 2's one remaining gap unchanged: no endpoint yet _reads_ a shared
  address — addressed next, in Stage 3 (see below).

### Decisions

No new decision record — this was a direct implementation of explicitly requested fixes,
not a judgment call.

## Stage 3: Cart sessions and the order domain — SHIPPED (2026-10-03)

### What was built

- Cart session API: `POST /carts` (merchant-scoped, computes a quote from line items — flat
  shipping with a free-shipping threshold, a stub 10%-off coupon, 18% tax), `GET /carts/:id`.
  Pure quote math in [cart-quote.ts](apps/api/src/cart/cart-quote.ts).
- Order domain: `POST /orders` (idempotent per `(merchantId, Idempotency-Key)`),
  `GET /orders/:id`, `POST /orders/:id/transition`. The legal-transition table lives in one
  place, [order-state-machine.ts](apps/api/src/order/order-state-machine.ts):
  `created → payment_pending → paid | cod_confirmed → fulfilled → delivered | rto`, plus
  `cancelled` from `created` or `payment_pending`; `delivered`/`rto`/`cancelled` are terminal.
- Outbox pattern: every order-mutating write inserts its event row in the same
  `prisma.$transaction` as the order write (never a separate Kafka call in that path).
  `OutboxService.publishPending()` is the only thing that talks to Kafka, reading
  unpublished rows and marking them published after a successful send — this is what makes
  the write and the event unable to diverge even across a crash (see decision 004).
- Closed the Stage 2 gap: `GET /merchants/shoppers/:shopperId/addresses` — a merchant sees
  only addresses explicitly shared with it via `AddressShare`; an empty array otherwise,
  never an error that would leak the shopper's existence.
- Contract: [`docs/api/orders.openapi.yaml`](docs/api/orders.openapi.yaml).
- Migration `20261003130231_cart_order_outbox` for `cart_sessions`, `orders`,
  `outbox_events`.

### What was verified

- Typecheck, lint, format all clean.
- Migrations: applied, reset/rolled back, reapplied against live Postgres — clean, all 3
  migrations replay cleanly from scratch.
- `pnpm audit`: no new findings from `kafkajs` (21, unchanged).
- `gitleaks`: only the local, gitignored `.env` flagged — nothing in git.
- Found and fixed two real bugs during verification, not just gaps:
  1. The order-transition endpoint defaulted to Nest's `201` for POST; fixed to `200` to
     match the documented contract (same class of mismatch caught in Stage 1).
  2. Redpanda was advertising its in-compose-network hostname (`redpanda:9092`) to clients,
     which broke every kafkajs reconnect after the first — fixed to advertise `localhost`,
     since nothing that talks to this dev stack runs inside the compose network.
- Found and fixed a real idempotency race while writing the concurrency test for it: two
  concurrent `POST /orders` calls with the same brand-new idempotency key could both pass
  the pre-check and race to insert; the loser now catches the unique-constraint violation
  and returns the winner's order instead of erroring. See decision 004.

### Test results

- **Order state machine**: 66 table-driven tests — every legal transition in the 8×8 status
  matrix allowed, every one of the remaining 56 pairs rejected, terminal states proven to
  have zero legal outgoing transitions.
- **Cart quote**: 7 pure-function tests (subtotal, flat shipping, free-shipping threshold,
  coupon case-insensitivity, unrecognized coupon, tax-on-discounted-subtotal, determinism).
- **Idempotent order creation**: sequential replay returns the same order; **5 parallel
  calls with the same never-before-seen key create exactly 1 order** (the race-safety fix
  above, proven, not just claimed).
- **Outbox durability**: an event written but never published survives and is still
  deliverable on a later `publishPending()` call (the literal "kill the process between
  write and publish" scenario, proven against real Postgres); repeated `publishPending()`
  calls don't resend already-published events; an event is shown actually arriving on the
  real Redpanda topic with the right shape via a live consumer.
- **Consent-gated shared-address read** (explicitly requested): a merchant with no consent
  sees `[]`; after the shopper grants consent via `POST /shopper/addresses/:id/share`, that
  merchant — and only that merchant — can read the address; a second, never-granted
  merchant still sees `[]` even though the address now has a share for someone else.
- Full workspace suite (`pnpm run test`): **149/149** passing (138 in `apps/api`, up from
  47 before Stage 3's fixups + 91 new; 11 unchanged in `packages/config`), 0 flaky, run
  twice.
- Coverage: `apps/api` **97.17% statements / 94.3% branches / 100% functions**;
  `src/cart` and `src/order` are both 100%. `packages/config` unchanged at 97.1%.

### Known gaps / follow-ups

- No scheduled outbox publisher yet — `publishPending()` is only ever called directly (by
  tests). Needs a lightweight poller or real CDC before this matters in a deployed
  environment. Added to the Stage 9 action items below.
- Carrying forward unchanged: Stage 2's `POST /merchants` auth gate (decision 003); Stage
  1's remaining non-blocking notes (decision 002).

### Decisions

- [`docs/decisions/004-stage3-cart-order-outbox.md`](docs/decisions/004-stage3-cart-order-outbox.md)

## Action items for later stages

Tracked here so they don't get lost between stages:

- **Stage 9 (hardening)**: gate `POST /merchants` behind admin provisioning (currently
  unauthenticated by necessity — it mints the first API key — see decision 003). Must be
  closed before any real merchant onboarding.
- **Stage 9 (hardening)**: revisit refresh-token/OTP-verify behavior under real load
  (the race-safety fix above closes the correctness gap; load testing should confirm no
  new contention bottleneck was introduced by the atomic claim pattern).
- **Stage 9 (hardening)**: wire a real scheduled outbox publisher (timer-based poll or
  Postgres `LISTEN`/`NOTIFY`-triggered) — Stage 3 proved the write-side durability
  guarantee but nothing currently calls `publishPending()` outside of tests.
