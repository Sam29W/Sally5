# 008: Stage 7 Shopify integration decisions

## Status

Accepted — heavily placeholder-scoped. No Shopify Partner account or dev store exists in
this environment, so the live OAuth install/callback round trip and real Admin API calls
have never been exercised against an actual shop. Everything that _can_ be made real
without those — the HMAC signature algorithms, the data model, the webhook handling
logic — is implemented and tested for real.

## Context

Stage 7 asked for: OAuth install flow, HMAC-verified webhooks, cart/order sync,
draft-order creation, and the mandatory uninstall/data-redaction webhooks.

## Decisions

- **HMAC verification is implemented exactly per Shopify's documented algorithms, and is
  the one piece unit-tested against known-good vectors rather than against a live
  store** ([shopify-hmac.util.ts](../../apps/api/src/shopify/shopify-hmac.util.ts)):
  - OAuth callback: drop `hmac`/`signature`, sort remaining query keys, join as
    `key=value&...`, HMAC-SHA256 hex digest with the app's API secret.
  - Webhook: HMAC-SHA256 base64 digest of the _raw_ request body with the webhook's
    shared secret — reuses Stage 4's raw-body-for-webhooks pattern
    ([body-parser.ts](../../apps/api/src/body-parser.ts)), extended to
    `/shopify/webhooks`.
  - Both use `timingSafeEqual`, never `===`, for the actual comparison.
- **Two different kinds of "credential" get different treatment**: `SHOPIFY_API_KEY` /
  `SHOPIFY_API_SECRET` are issued by Shopify when you register a Partner app — genuinely
  absent here, so they're optional env vars and the OAuth flow throws
  `ShopifyNotConfiguredError` (a clear 500, not a silent no-op) if anyone tries to use it
  without them. `SHOPIFY_WEBHOOK_SECRET` is different: it's a shared secret _we_ mint
  ourselves and paste into the Partner dashboard's webhook config — nothing stops it from
  having a real dev-only default (same pattern as `FAKE_GATEWAY_WEBHOOK_SECRET`), so the
  webhook signature path is fully testable even with zero real Shopify involvement.
- **One shop ↔ one merchant, 1:1, provisioned on first install**:
  `ShopifyOAuthService.completeInstall` creates a brand-new `Merchant` (and its first API
  key) the first time a `shopDomain` installs, and reuses the same merchant on a
  reinstall after a prior uninstall — matched on the unique `shopDomain`, never creating a
  second merchant for a shop that comes back.
- **Uninstall marks, never deletes**: `app/uninstalled` sets `uninstalledAt`, preserving
  the `ShopifyShop` row (and the merchant, its orders, everything) so a reinstall can
  resume cleanly and so there's an audit trail of install/uninstall history.
- **GDPR mandatory webhooks (`customers/data_request`, `customers/redact`,
  `shop/redact`) are accept-and-log no-ops**: CheckoutKit has no Shopify-sourced customer
  data anywhere — shoppers only exist via our own OTP flow keyed by phone, never by a
  Shopify customer id — so there is nothing to export or delete yet. If `orders/create`
  sync is ever actually implemented and starts storing Shopify customer references, this
  is exactly where a real redaction job belongs.
- **Access token encrypted at rest** with its own key
  (`SHOPIFY_TOKEN_ENCRYPTION_KEY`, AES-256-GCM via the same `AesGcmCrypto` class Stage
  1/4 already use) — never the Razorpay or webhook-secret key, so a leak of one key
  doesn't compromise the others' purpose.

## What's explicitly not real yet

- **The live OAuth round trip**: `exchangeCodeForToken`'s request shape to
  `https://{shop}/admin/oauth/access_token` is real Shopify API shape, unit-tested with a
  fake `fetch`, but has never hit an actual Shopify server — there's no Partner app to
  issue a real `code` against.
- **`orders/create` sync**: the webhook is accepted and signature-verified, but the
  handler is a log line, not a real mapping onto a CheckoutKit cart/order. Building that
  mapping without ever having seen a real Shopify order payload risks guessing the shape
  wrong; better to build it against Shopify's actual sandbox once one exists.
- **Draft-order creation**: no Admin API client call was written for this at all, for the
  same reason — nothing to validate the request/response shape against.
- **CSRF `state` round-trip**: `buildInstallUrl` generates a `state` nonce and the
  controller sets it as a cookie, but nothing on the callback side actually re-checks it
  against the cookie yet (there's no live install flow to prove that check against).

## Follow-ups for whoever picks this up with real Shopify credentials

1. Get a Partner account + dev store, set `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET`.
2. Run the install flow for real; fix whatever the real token-exchange response shape
   reveals that the fake-fetch test didn't catch.
3. Wire up the `state` cookie check on `/shopify/callback`.
4. Implement real `orders/create` → CheckoutKit cart/order sync and draft-order creation,
   now that a real payload shape is available to build against.
