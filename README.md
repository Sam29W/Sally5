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
# -> { "accessToken": "...", "refreshToken": "..." }

# Merchants and webhooks (see docs/api/merchants.openapi.yaml)
curl -X POST localhost:3000/merchants -H "Content-Type: application/json" \
  -d '{"name":"Acme"}'
# -> { "merchantId": "...", "apiKey": "<prefix>.<secret>" }
curl -X POST localhost:3000/webhooks -H "x-api-key: <apiKey>" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/hook"}'

# Shopper address book (see docs/api/shopper.openapi.yaml) — needs the accessToken above
curl -X POST localhost:3000/shopper/addresses -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"line1":"221B Baker Colony Road","city":"Mumbai","state":"Maharashtra","pincode":"400001"}'

# Cart and order flow (see docs/api/orders.openapi.yaml)
curl -X POST localhost:3000/carts -H "x-api-key: <apiKey>" -H "Content-Type: application/json" \
  -d '{"items":[{"sku":"A","name":"Widget","quantity":2,"unitPriceCents":1000}]}'
# -> { "id": "...", "subtotalCents": 2000, "totalCents": ... }
curl -X POST localhost:3000/orders -H "x-api-key: <apiKey>" -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" -d '{"cartSessionId":"<cartId>"}'
curl -X POST localhost:3000/orders/<orderId>/transition -H "x-api-key: <apiKey>" \
  -H "Content-Type: application/json" -d '{"to":"payment_pending"}'

# Payments (see docs/api/payments.openapi.yaml) — routes to the fake gateway unless real
# Razorpay sandbox keys are set (see "Payments" below)
curl -X POST localhost:3000/payments -H "x-api-key: <apiKey>" -H "Content-Type: application/json" \
  -d '{"orderId":"<orderId>","method":"upi"}'

# COD risk scoring (see docs/api/cod-risk.openapi.yaml)
curl -X POST localhost:3000/orders/<orderId>/cod-risk/score -H "x-api-key: <apiKey>" \
  -H "Content-Type: application/json" -d '{"addressId":"<addressId>"}'
# -> { "score": 0, "band": "low", "action": "allow", "reasons": [], "ruleVersion": "v1" }
```

### Payments

Every test runs against an in-memory fake gateway — no sandbox credentials are required to
develop or test this project. To enable the real Razorpay sandbox gateway, set in `.env`:

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

Generate these from the [Razorpay dashboard](https://dashboard.razorpay.com) in **Test
Mode**: `Settings → API Keys → Generate Test Key` for the first two, and
`Settings → Webhooks → Add New Webhook` (test mode) for the webhook secret. If any of the
three are missing, `POST /payments` falls back to the fake gateway automatically — nothing
breaks, it just never talks to a real sandbox.

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
