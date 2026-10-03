# 003: Stage 2 tenancy and address-book decisions

## Status

Accepted

## Context

Stage 2 added merchant multi-tenancy (API keys, webhook endpoints) and the shopper-owned
address book, plus DPDP-style self-service export/delete.

## Decisions

- **API keys** follow the same pattern as refresh tokens (Stage 1): opaque
  `<prefix>.<secret>`, only `sha256(secret)` stored, the full secret shown exactly once at
  creation/rotation. The `prefix` is kept in the clear so a merchant can tell keys apart in
  a list without the API ever being able to show the secret again.
- **Tenant isolation** is enforced at the query layer, not just the guard: every
  `WebhookEndpoint` read/write filters or `deleteMany`-matches on `merchantId` pulled from
  `ApiKeyGuard`, and a cross-tenant delete attempt returns `404` (not `403`) so a merchant
  can't even learn that another merchant's resource ID exists. Same pattern for `Address`
  via `shopperId` and `AccessTokenGuard`.
- **Webhook signing secrets** are encrypted (AES-256-GCM), not hashed — unlike API keys and
  refresh tokens, the server needs the plaintext back to compute the outgoing HMAC
  signature when it later delivers a webhook. Extracted the AES-GCM logic out of
  `PhoneCrypto` into a shared `AesGcmCrypto` helper ([aes-gcm.ts](../../apps/api/src/crypto/aes-gcm.ts))
  so both phone and webhook-secret encryption share one reviewed implementation with
  separate keys (`PHONE_ENCRYPTION_KEY` vs `WEBHOOK_SECRET_ENCRYPTION_KEY`).
- **`POST /merchants` has no auth gate.** Bootstrapping the very first API key for a new
  merchant can't require an API key. Acceptable for this stage (no production merchants
  exist yet); flagged below as something that needs an admin gate before going live.
- **Address sharing across merchants** is modeled as an explicit `AddressShare` join row
  created only via `POST /shopper/addresses/:id/share` with a `merchantId` the shopper
  names — a merchant can never read a shopper's address without that explicit grant (no
  such read path exists yet in this stage; the join table is in place for Stage 3+ to use).
- **DPDP erasure** (`DELETE /shopper/me`) relies on `onDelete: Cascade` across
  `ConsentRecord`, `Address`, `AddressShare`, `SessionFamily`, and `RefreshToken` — one
  `prisma.shopper.delete` removes everything in one statement, so there's no risk of a
  partial deletion leaving orphaned PII.

## Known gaps carried forward

- **`POST /merchants` is unauthenticated** — fine for dev/bootstrap, but before any real
  merchant onboarding this needs an admin-only gate (e.g. an internal API key or manual
  provisioning flow). Revisit in Stage 8 (merchant dashboard) or Stage 9 (hardening).
- **No endpoint yet lets a merchant _read_ a shared address** — the consent/join table
  exists but nothing consumes it. That lands naturally in Stage 3 (cart/order) once a
  merchant-facing checkout flow needs to prefill a returning shopper's address.
- Carrying forward Stage 1's gaps unchanged: refresh/OTP race-safety, `trust proxy`
  configuration — see [decision 002](002-stage1-identity.md).
