# 009: Stage 8 merchant dashboard decisions

## Status

Accepted

## Context

Stage 8 asked for: merchant user auth with roles (owner/ops/read-only), dashboard pages for
orders/payments/COD-risk decisions/threshold settings/API keys/webhooks/sync health, and
conversion/RTO metrics with IST timezone handling.

## Decisions

- **A new auth system, not a reuse of OTP or the merchant API key**: dashboard users are
  humans logging in with email+password, which is neither the shopper's phone-OTP flow nor
  the merchant's machine-to-machine API key. New `MerchantUser` model
  (`email`, `passwordHash`, `role` enum), new JWT secret
  (`JWT_DASHBOARD_SECRET`, deliberately different from `JWT_ACCESS_SECRET`) so a shopper
  token and a dashboard token can never be confused for each other even if someone tried.
- **Bootstrapping the first owner reuses the merchant's own API key as proof of
  ownership**: there's no admin backchannel to provision the first human user, so
  `POST /dashboard-auth/bootstrap` is guarded by `ApiKeyGuard` — only someone who already
  holds the merchant's secret key can create the first (and only ever first) owner
  account. A second bootstrap attempt is a `409`, not a silent reset. Every subsequent
  user (ops/readonly colleagues) is invited by an existing owner via email+password,
  never touching the API key again.
- **Passwords hashed with `scrypt` (Node's built-in, no new dependency)**: same pattern as
  every other crypto primitive in this codebase (`AesGcmCrypto`, phone hashing) — no
  `bcrypt`/`argon2` package needed. Stored as `salt:hash` hex, compared with
  `timingSafeEqual`. Login always runs `verifyPassword` even when the email doesn't
  exist (against a throwaway hash) specifically so a wrong-password response and a
  no-such-email response take the same amount of time — otherwise the timing difference
  leaks which emails are registered.
- **Role gating is least-privilege by route, not a blanket "owner can do everything,
  everyone else read-only"**: orders/payments/COD-risk-decisions/COD-risk-config-read/
  Shopify-sync-status are open to any authenticated role (useful day-to-day information
  for ops and read-only reviewers alike); COD-risk-config _writes_ need owner or ops;
  API keys (list and rotate) and webhook endpoint listing are owner-only, since they're
  the most sensitive, security-adjacent surfaces.
- **Metrics are IST calendar-day buckets, computed with a fixed UTC+5:30 offset
  shift, not a timezone library**: IST has no DST, so "add 5h30m then read the UTC date
  parts" is the entire algorithm (`metrics.util.ts`'s `istDateKey`) — pulling in a
  timezone library for one fixed, no-DST offset would be solving a harder problem than
  the one that actually exists.
- **`apps/dashboard-web`**: a second SvelteKit SPA, built the same way as Stage 6's
  `checkout-web` (adapter-static, `ssr=false`), since the pattern already proved out:
  login/bootstrap screen, then a tabbed single page (orders, metrics, COD risk config,
  API keys, webhooks, Shopify sync) driven by the dashboard JWT. The dashboard token is
  kept in `sessionStorage`, not `localStorage` — it does not need to survive a browser
  restart, and a shorter-lived credential scope is a smaller blast radius if the device
  is shared.

## Bugs found live-testing this stage (not caught by the test suite)

- **API key rotation initially rendered `[object Object]`**: `MerchantService.rotateApiKey`
  returns a bare string; Nest serializes a bare string controller return value as
  `text/html`, not JSON, which the frontend's `res.json()` call then failed to parse
  sensibly. Fixed by having `DashboardService.rotateApiKey` wrap it as `{ apiKey }`,
  matching the shape `POST /merchants` already returns elsewhere.
- **Saving the COD risk config from the dashboard form 400'd with "property ruleVersion
  should not exist"**: the GET response for the risk config includes read-only fields
  (`ruleVersion`, blocklists) the update DTO's `forbidNonWhitelisted` rejects. The fetched
  object was being sent back whole on save. Fixed by only sending the four fields the form
  actually edits.
- **A genuinely confusing third bug turned out not to be a code bug at all**: after fixing
  the two above, the browser kept sending the _old_, broken request bodies even though the
  built JS on disk was already correct. Cause: `vite preview` loads its static file set
  into memory at process startup rather than re-reading the build directory per request —
  a stale, never-killed preview process from an earlier rebuild kept serving an old bundle
  under a filename that no longer existed on disk. The fix for local manual testing is
  procedural, not a code change: kill and restart the preview process after every
  rebuild, don't assume it's a live-reloading dev server.

## Known gaps / follow-ups

- No merchant-identity verification beyond "holds the API key" for bootstrap — acceptable
  since the API key is already the merchant's one proof of identity everywhere else in
  this system (see decision 003's note on `POST /merchants` itself being ungated).
- No "forgot password" flow — out of scope for this stage; a real deployment would need
  one before onboarding real merchants.
- No pagination on the dashboard list endpoints beyond a `limit` query param (max 200) —
  fine for this stage's scope, would need real pagination at larger order volumes.
