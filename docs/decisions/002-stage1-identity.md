# 002: Stage 1 identity decisions

## Status

Accepted

## Context

Stage 1 added phone-OTP login, JWT access tokens, rotating refresh tokens with reuse
detection, and an encrypted shopper profile. A few implementation choices and known gaps
are recorded here.

## Decisions

- **Phone encryption:** AES-256-GCM (`PHONE_ENCRYPTION_KEY`, 32-byte hex) for the
  recoverable value, HMAC-SHA256 (`PHONE_HASH_KEY`) for a separate deterministic lookup
  hash — a leaked encryption key alone can't be used to search by phone, and vice versa.
- **Refresh tokens** are opaque `<rowId>.<secret>` strings; only `sha256(secret)` is stored
  (`RefreshToken.tokenHash`), never the token itself. Reuse of an already-rotated token
  revokes the entire `SessionFamily`, satisfying the Stage 1 "reuse detection revokes the
  session family" acceptance criterion.
- **OTP storage** lives in Redis only (never Postgres): single-use (deleted on successful
  verify), capped attempts (`OTP_MAX_ATTEMPTS`, default 5 → 429), a resend cooldown, and
  per-phone/per-IP hourly counters — all enforced in `OtpService`.
- **SMS delivery** is the Stage 0-promised console/dev driver (`ConsoleSmsProvider`); it
  logs through the same redacting logger as everything else, so the OTP never appears in
  plaintext even in dev logs.
- **Vitest + NestJS decorator metadata:** `tsx`/esbuild (used for `dev`) does not emit
  TypeScript's `design:type` metadata, which both Nest's by-type DI and
  `class-validator`'s `forbidNonWhitelisted` whitelist check depend on. Under plain
  `tsx`-transformed tests this silently broke DI (constructor params resolved to
  `undefined`) and skipped whitelist validation. Fixed two ways: (1) every constructor
  injection in `apps/api` now uses an explicit `@Inject(Token)`, which works regardless of
  metadata emission; (2) `apps/api/vitest.config.ts` uses `unplugin-swc` (`.swcrc` with
  `decoratorMetadata: true`) so the test transform matches `tsc`'s behavior for anything
  that still depends on it.

## Known gaps carried forward

- **Refresh-token rotation and OTP verification are not fully race-safe.** Both do a
  read-then-write against their store (Postgres for refresh tokens, Redis for OTP state)
  without a transaction/lock, so two near-simultaneous requests with the same token/code
  could theoretically both pass the check before either write lands. Low real-world risk at
  this stage (no production traffic yet); revisit with `SELECT ... FOR UPDATE` on
  `RefreshToken` and a Redis `WATCH`/Lua-script compare-and-delete for OTP verify as part of
  Stage 9 hardening / load testing.
- **Client IP for OTP rate limiting** (`req.ip`) is read directly from Express with no
  `trust proxy` configuration. Fine for local dev; must be revisited once this sits behind a
  load balancer (Stage 9), or the per-IP limit is trivially bypassable/always-wrong.
- **No protected-route guard yet** — `TokenService.verifyAccessToken()` exists but nothing
  calls it from a Nest guard, since Stage 1 has no endpoints that require a logged-in
  shopper. Wire a real `AuthGuard` when Stage 2/3 add endpoints that need one.
