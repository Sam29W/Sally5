# CheckoutKit

An original one-page checkout platform for Indian D2C merchants: phone-OTP login and a saved
address network, fast checkout, payment orchestration over licensed gateways, rules-based
COD-risk scoring with a COD-to-prepaid nudge, a Shopify integration, and a merchant dashboard.

## Monorepo layout

- `apps/api` — NestJS backend.
- `apps/checkout-web` — SvelteKit checkout app (placeholder until Stage 6).
- `apps/dashboard-web` — SvelteKit merchant dashboard (placeholder until Stage 8).
- `packages/shared` — shared types and utilities.
- `packages/config` — env schema validation and the structured, PII-redacting logger.
- `infra/docker-compose.yml` — local Postgres, Redis, and Redpanda (Kafka-compatible).
- `docs/decisions/` — architecture decision records.
- `docs/api/` — OpenAPI contracts per domain (e.g. `auth.openapi.yaml`).

## Getting started

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm install
pnpm run build
pnpm --filter @app/api run dev
curl localhost:3000/health

# Phone-OTP login (see docs/api/auth.openapi.yaml for the full contract)
curl -X POST localhost:3000/auth/otp/request -H "Content-Type: application/json" \
  -d '{"phone":"+919876543210"}'
# OTP is printed to the API's log output (console SMS driver, redacted-aware)
curl -X POST localhost:3000/auth/otp/verify -H "Content-Type: application/json" \
  -d '{"phone":"+919876543210","otp":"123456"}'
```

### Running database migrations

```bash
cd apps/api
npx prisma migrate dev     # create + apply a migration locally
npx prisma migrate deploy  # apply pending migrations (CI/prod)
```

## Workspace scripts

- `pnpm run lint` — ESLint, zero warnings allowed.
- `pnpm run format` — Prettier check (`format:write` to fix).
- `pnpm run typecheck` — TypeScript project-wide, `--noEmit`.
- `pnpm run test` — unit/integration tests per package.
- `pnpm run build` — compile every package/app.
- `pnpm run secrets:scan` — full-history gitleaks scan (also enforced pre-commit and in CI
  on staged/pushed changes).

## Status

See [`STATUS.md`](STATUS.md) for what has shipped, stage by stage.
