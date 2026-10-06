# CheckoutKit STRIDE threat model

Covers the system as built through Stage 9. Each entry names the threat, the asset/flow
it targets, and — critically — whether it's already mitigated in the shipped code (with
a pointer to where) or is a real, open gap.

## Spoofing

| Threat                                                          | Mitigated?                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forging a merchant's identity to call merchant-scoped endpoints | **Yes** — `ApiKeyGuard` requires the merchant's own `x-api-key`; keys are SHA-256 hashed at rest, never recoverable from the DB ([api-key.guard.ts](../apps/api/src/merchant/api-key.guard.ts)).                                                   |
| Forging a shopper's identity via a stolen/guessed access token  | **Yes** — JWTs are signed (`JWT_ACCESS_SECRET`), short-lived, and `AccessTokenGuard` verifies the signature on every call.                                                                                                                         |
| Forging a dashboard user's identity                             | **Yes** — same pattern, separate secret (`JWT_DASHBOARD_SECRET`), so a shopper token can never be replayed as a dashboard token or vice versa.                                                                                                     |
| Spoofing a Shopify webhook delivery                             | **Yes** — `verifyWebhookHmac` checks the raw-body HMAC against `SHOPIFY_WEBHOOK_SECRET` before anything else runs ([shopify.controller.ts](../apps/api/src/shopify/shopify.controller.ts)).                                                        |
| Spoofing a payment-gateway webhook (fake capture/refund events) | **Yes** — same pattern, per-gateway signature verification ([webhook.controller.ts](../apps/api/src/payment/webhook.controller.ts)).                                                                                                               |
| Anyone minting a brand-new merchant (and its first API key)     | **Yes, as of Stage 9** — `POST /merchants` now requires `ADMIN_PROVISIONING_KEY` ([admin-provisioning.guard.ts](../apps/api/src/merchant/admin-provisioning.guard.ts)); this was the one previously-open gap flagged since Stage 2 (decision 003). |

## Tampering

| Threat                                                                         | Mitigated?                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modifying an order total/status client-side before it's trusted                | **Yes** — all pricing is computed server-side (`cart-quote.ts`); order state transitions are centrally validated (`order-state-machine.ts`), never trusted from a client-supplied field.   |
| Replaying or re-ordering an OTP verification request                           | **Yes** — OTP state is single-use (deleted on success) and the verify path is a single atomic Redis script, closing the TOCTOU window a naive check-then-delete would have.                |
| Tampering with a webhook payload after it's signed                             | **Yes** — signature covers the raw, unparsed body; re-serializing JSON would change bytes and fail verification by construction.                                                           |
| Tampering with the COD risk config to disable risk checks for one's own orders | **Partially** — writing the config is role-gated (owner/ops) behind dashboard auth, but there's no audit log of _who_ changed it or _when_, only the resulting config state. **Open gap.** |

## Repudiation

| Threat                                                                                             | Mitigated?                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| A merchant disputing a COD risk decision ("the system never flagged this order")                   | **Yes** — every scoring call persists a `CodRiskDecision` row with the exact inputs, rule version, score, and reasons (immutable audit trail). |
| A shopper disputing consent ("I never agreed to X")                                                | **Yes** — `ConsentRecord` rows are written on first login and are never deleted except via the shopper's own DPDP-style deletion request.      |
| No request-level audit log of _admin_ actions (merchant provisioning, dashboard-user role changes) | **Open gap** — these are gated but not logged with who/when beyond the DB row's own `createdAt`.                                               |

## Information disclosure

| Threat                                                                                   | Mitigated?                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reading another merchant's data via an endpoint that forgot to scope by `merchantId`     | **Mostly yes, proven by test** — every merchant-facing service method takes `merchantId` and filters by it; Stage 2/3/8 each include an explicit cross-tenant-isolation test (e.g. dashboard orders, webhook listing).                                                                                                   |
| Reading a shopper's raw phone number from the database or logs                           | **Yes** — phone is AES-256-GCM encrypted at rest, looked up only via a separate HMAC hash; the structured logger redacts anything phone- or OTP-shaped from free-text messages by regex, independent of field name.                                                                                                      |
| Leaking which emails are registered as dashboard users via login timing                  | **Yes** — `DashboardAuthService.login` always runs the password hash comparison, even against a throwaway hash for a nonexistent email, specifically to keep timing uniform.                                                                                                                                             |
| A COD-risk reason string leaking another merchant's blocklist data                       | **Yes, by construction** — every rule's reason is a fixed generic sentence, never the matched value (decision 006).                                                                                                                                                                                                      |
| Leaking a Shopify shop's Admin API access token                                          | **Yes** — encrypted at rest with its own dedicated key (`SHOPIFY_TOKEN_ENCRYPTION_KEY`), never logged.                                                                                                                                                                                                                   |
| OpenTelemetry spans capturing PII in attributes (e.g. a phone number in a URL or header) | **Open gap** — auto-instrumentation captures HTTP method/route/status by default, which is safe, but no explicit scrubbing rule exists if a future endpoint put PII in a URL param. Mitigation: don't put PII in URL params (already true everywhere today) and treat this as a standing constraint, not a one-time fix. |

## Denial of service

| Threat                                                                      | Mitigated?                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTP request flooding (brute-force enumeration or SMS-cost exhaustion)       | **Yes** — per-phone and per-IP hourly rate limits, plus a resend cooldown ([otp.service.ts](../apps/api/src/auth/otp.service.ts)).                                                                                                                  |
| OTP verify brute-forcing a 6-digit code                                     | **Yes** — max attempts before lockout, atomic check (no race to bypass the counter).                                                                                                                                                                |
| A single merchant's traffic spike starving other merchants (noisy neighbor) | **Open gap** — no per-merchant rate limiting exists anywhere; everything is per-IP or per-phone. A real production deployment serving many merchants on shared infrastructure needs this before it's safe.                                          |
| Outbox publisher falling behind under load, silently delaying order events  | **Partially** — the publisher retries every tick and never drops events, but there's no alerting on publish lag; an operator would only notice via the (currently nonexistent) dashboards this stage's OpenTelemetry wiring is a first step toward. |

## Elevation of privilege

| Threat                                                                             | Mitigated?                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A `readonly` dashboard user writing to the COD risk config or rotating API keys    | **Yes, proven by test** — `RequireRole` rejects with 403; Stage 8's e2e suite explicitly tests a readonly user hitting owner-gated routes.                                                                                                                                     |
| An `ops` user inviting new dashboard users (owner-only action)                     | **Yes, proven by test** — same mechanism.                                                                                                                                                                                                                                      |
| A shopper's access token being accepted on a dashboard-only or merchant-only route | **Yes, by construction** — three completely separate guard/secret pairs (`AccessTokenGuard`/`JWT_ACCESS_SECRET`, `DashboardAuthGuard`/`JWT_DASHBOARD_SECRET`, `ApiKeyGuard`/per-merchant key hash); none of the three verification paths can accept a token meant for another. |

## Summary of open gaps (not yet mitigated)

1. No audit log of _who_ changed the COD risk config or invited a dashboard user — only
   the resulting state is persisted.
2. No per-merchant rate limiting — a noisy-neighbor risk once multiple merchants share
   this infrastructure for real.
3. No active alerting on outbox publish lag.

None of these block the local/dev usage this project has been built and tested against;
all three are explicitly called out here so they aren't forgotten before any real
multi-tenant production deployment.
