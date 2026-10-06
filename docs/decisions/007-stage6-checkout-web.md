# 007: Stage 6 checkout web app decisions

## Status

Accepted

## Context

Stage 6 added `apps/checkout-web`, a SvelteKit SPA embeddable on a merchant's storefront,
driving the shopper through phone verification, address capture, and payment (prepaid or
COD) against the Stage 1-5 API.

## Decisions

- **Capability-scoped public surface, not merchant-key auth**: the browser can never hold
  a merchant's secret API key, so `apps/api/src/public-checkout` exposes
  `GET /public/carts/:id`, `GET /public/orders/:id`,
  `POST /public/orders/:id/{payments,cod-risk-score,confirm-cod}` keyed by the
  unguessable UUID itself — the same trust model Stage 4's `RazorpayGateway` already uses
  by handing an `order_id` to the client. Every response is scoped to exactly the one
  order/cart named in the URL, never a list, never another merchant's or shopper's data.
- **A new `claim` endpoint, added after live-testing surfaced a real gap**: merchants
  create carts/orders anonymously (shopper identity isn't known until checkout), but
  `scoreCodRisk`/`confirmCod` need a `shopperId` on the order to look up the shopper's
  address. There was no way to attach the OTP-verified shopper to that pre-existing order.
  Added `OrderService.claimForShopper` and `POST /public/orders/:id/claim` (guarded by
  `AccessTokenGuard`, not the capability pattern — proving who the shopper is is exactly
  the one thing this route can't be capability-based about), called by checkout-web right
  after OTP verify succeeds. Idempotent for the same shopper; rejects a second shopper
  trying to claim an already-claimed order rather than silently reassigning it.
- **SPA with `adapter-static` + `fallback: "index.html"`, `ssr=false`/`prerender=false`**:
  this is a single page driven entirely by client-side fetches against per-shopper data —
  nothing here is static content worth prerendering, and it needs to be embeddable as a
  plain built JS bundle on any merchant's static storefront, not served by a Node runtime.
- **Bundle size**: measured ~38 KB gzipped for the full client bundle (`vite build` output,
  summing every shipped JS chunk, excluding manifest/CSS/sourcemaps) — comfortably under
  the 100 KB budget.
- **Two real bugs found only by driving the live flow, not by typecheck/lint/unit tests**:
  - `PublicCheckoutModule` used `AccessTokenGuard` without importing
    `AccessTokenGuardModule` (the module providing its `TokenService` dependency). Nest's
    DI failure during bootstrap hung the _entire_ app indefinitely — not just the new
    endpoint — silently failing 8 e2e test files (`app` stayed `undefined`, so every
    `afterAll(() => app.close())` threw). This is why "typecheck and unit tests pass" is
    not sufficient evidence a stage works; `pnpm test` plus a live walkthrough both caught
    something the other missed.
  - The OTP and pincode `<input pattern="[0-9]{6}">` attributes were silently mangled by
    Svelte's template syntax: `{6}` inside a bare string attribute is parsed as a Svelte
    expression, so the rendered DOM attribute became `pattern="[0-9]6"` — a regex that
    rejects any 6-digit code, blocking every OTP/pincode submission via native HTML5
    constraint validation with no visible error (the browser's own validation message
    isn't captured by `page.locator(...).innerText()`, which made this look like a hung
    network request during Playwright debugging rather than a validation block). Fixed by
    wrapping the pattern in a JS expression — `pattern={"[0-9]{6}"}` — so Svelte treats the
    braces as a string literal, not an interpolation.
- **OTP seeding for tests bypasses the SMS step entirely**: the real OTP is never
  observable outside the server process — `ConsoleSmsProvider` logs it, but the structured
  logger redacts anything OTP-shaped (`packages/config/src/logger.ts`'s `redactPII`), by
  design, so logs can never leak a live code. Playwright tests (`e2e/helpers.ts`) seed a
  known code directly into Redis using the same HMAC-phone-hash + SHA-256-code-hash scheme
  as `OtpService`, _after_ waiting for the real `/auth/otp/request` call to land — seeding
  before that landed was a real race in an earlier draft (the real request's random code
  would overwrite the seeded one a moment later, failing verification non-deterministically).

## Known gaps carried forward

- No embeddable loader/SDK script (modal or redirect wrapper) yet — the SvelteKit build
  output is usable directly as an iframe `src`, but the "one `<script>` tag" embed
  experience described in the master scope is not built.
- No Lighthouse run — no headless Chrome performance tooling was exercised in this
  environment; bundle size was verified directly instead.
