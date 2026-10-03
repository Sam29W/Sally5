# 001: Stage 0 foundational decisions

## Status
Accepted

## Context
Stage 0 required a working monorepo skeleton, local infra, config/logging, and CI. Several
implementation details were not specified in the master prompt and don't change architecture
or are cheap to reverse, so sensible defaults were chosen instead of blocking.

## Decisions
- **Project/package scope name:** `@checkoutkit/*`.
- **Logger:** `pino`, with a `redact` path list (`phone`, `phoneNumber`, `otp`, and nested
  variants) plus a `formatters.log` hook that regex-redacts phone-shaped and 6-digit
  OTP-shaped substrings anywhere in a log line (including free-text messages), not just
  known field names.
- **`apps/checkout-web` and `apps/dashboard-web`** are scaffolded as placeholder packages
  (package.json + README) in Stage 0 so the workspace graph and CI build/test/typecheck
  steps are real pipelines from day one. The actual SvelteKit apps are built in Stage 6 and
  Stage 8 respectively, per the master prompt's stage scope.
- **Local Postgres port:** the standard `5432` was already bound by unrelated Docker
  containers on this dev machine, so `infra/docker-compose.yml` maps Postgres to host port
  `55432`. This is a local dev-only mapping; `.env.example` reflects it.
- **`typescript-eslint` meta package** used instead of separate
  `@typescript-eslint/{parser,eslint-plugin}` packages — it's the officially recommended flat
  config entry point and avoids version-skew between the two.

## Known gaps carried forward
- `pnpm audit` reports residual low/moderate/high advisories in NestJS 10's transitive
  `express`/`body-parser`/`multer`/`path-to-regexp` dependency chain. These are not fixable
  without a NestJS major bump, which is out of scope for Stage 0. No critical findings
  remain (the one critical, in `vitest`, was fixed by bumping to `^3.2.6`).
- No `gitleaks` binary was available in this environment; a manual regex-based scan for
  credential-shaped literals was run instead and found nothing. Revisit wiring real
  `gitleaks` into CI in Stage 9 (hardening).
