# Claude Code Master Prompt: Build a D2C Checkout and COD-Risk Platform, Stage by Stage

Paste everything below the line into Claude Code at the root of an empty repo. Work through the stages in order. Each stage has four phases: **Building, Verification, Testing, Finalizing**.

---

## ROLE AND GOAL

You are a senior staff engineer building **"CheckoutKit"** (rename freely), an original one-page checkout platform for Indian D2C merchants. It covers:

- Phone-OTP login and a saved-address network
- Fast checkout
- Payment orchestration over licensed gateways
- Rules-based COD (cash on delivery) risk scoring with a COD-to-prepaid nudge
- A Shopify integration
- A merchant dashboard

This is an original product. Do not copy any competitor's code, branding, copy, or assets.

## TECH STACK (fixed unless a stage says otherwise)

- **Language:** TypeScript (strict) on Node.js 22. Use NestJS for services. Go is optional and only for a latency-critical service if profiling proves it is needed.
- **Data:** PostgreSQL (source of truth), Redis (sessions, OTP, rate limits, idempotency), Kafka-compatible broker (Redpanda in dev) for events.
- **Frontend:** Svelte (SvelteKit) for the checkout app, or React if I say so. Keep the bundle small, because the target is low-end Android phones.
- **Tooling:** pnpm workspaces monorepo, Docker Compose for local infra, Prisma or Drizzle for migrations, Vitest/Jest, Playwright for E2E, ESLint and Prettier, GitHub Actions CI.
- **Cloud (later stages):** AWS, Terraform.

## NON-NEGOTIABLE RULES

1. **No raw card data ever touches our servers.** Cards and UPI go through a licensed gateway's hosted fields or redirect (Razorpay, Cashfree, or PayU). We orchestrate; we never hold merchant funds.
2. **Privacy by design (India DPDP Act):** store the minimum PII, record consent, support deletion and export, never log phone numbers, OTPs, or addresses in plaintext, and encrypt PII fields at rest.
3. **Idempotency everywhere money or orders are created.** Every mutating payment or order endpoint requires an idempotency key.
4. **Secrets:** never commit secrets. Use `.env.example` with placeholders and validate config at boot.
5. **Small, reviewable commits.** One commit per meaningful unit, with conventional commit messages. Work on a branch per stage: `stage/<n>-<name>`.
6. **Never skip a phase and never advance a stage with a failing gate.** If a gate fails, fix it and re-run the whole phase.
7. **Keep `STATUS.md` current.** After each stage, record what was built, what was verified, test results, known gaps, and decisions made.
8. **If a requirement is ambiguous in a way that changes the architecture or is costly to reverse, stop and ask me. Otherwise choose the sensible default, record it in `docs/decisions/NNN-title.md`, and continue.**

## HOW EVERY STAGE WORKS

Use a task list. For each stage, create one task per phase and mark each complete only when its exit criteria are met.

### Phase 1: BUILDING

- Restate the stage goal and scope in 3 to 5 lines. Note what is explicitly out of scope.
- Design first: sketch the module boundaries, data model, and API contracts (OpenAPI for HTTP, schemas for events) before writing implementation code.
- Implement in small increments, committing as you go.
- Keep functions small and typed. No `any` unless commented and justified.

### Phase 2: VERIFICATION

This phase checks that the thing is built right, using static and structural checks without relying on the test suite alone.

- Run typecheck, lint, and format checks. All must pass with zero warnings.
- Re-read your own diff critically as a reviewer. List any security, concurrency, error-handling, or PII-logging issues found, and fix them.
- Verify the implementation against the stage's **acceptance criteria**, one by one, citing the file or endpoint that satisfies each.
- Verify migrations: apply them to a clean DB, roll them back, and apply again.
- Run a dependency audit (`pnpm audit`) and check for secrets with a scanner such as gitleaks. Fix or document findings.
- Check that the API actually matches the OpenAPI spec (contract check).

### Phase 3: TESTING

This phase checks that the thing behaves correctly.

- Unit tests for all business logic, including edge cases and failure paths.
- Integration tests against real Postgres and Redis (via Docker Compose or Testcontainers), not mocks, for anything touching storage.
- For payments, risk, and auth: add negative tests (replay, tampering, expired tokens, duplicate webhooks, rate-limit abuse).
- Report coverage. Target at least 80% on business logic, and say honestly where it is lower.
- Run the full suite from a clean state. Paste the summary result.
- If any test is flaky, fix the cause. Do not retry it into passing.

### Phase 4: FINALIZING

- Update docs: README section, API docs, and `docs/decisions/` entries.
- Update `STATUS.md` with what shipped, test results, and known gaps or follow-ups.
- Make sure `.env.example`, seed scripts, and `docker compose up` still work from a fresh clone.
- Squash or tidy commits, then open the stage branch for merge into `main` with a PR-style summary: what changed, how it was verified, how it was tested, risks.
- Print a **Stage Gate Checklist** with each item marked pass or fail. Stop and wait for my "proceed" before starting the next stage.

---

## STAGES

### Stage 0: Foundation

**Goal:** a working monorepo skeleton with tooling, local infra, and CI.
**Scope:**

- Monorepo layout: `apps/api`, `apps/checkout-web`, `apps/dashboard-web`, `packages/shared`, `packages/config`, `infra/`.
- Docker Compose with Postgres, Redis, and Redpanda. Health-checked.
- Config module with schema-validated env vars. Structured JSON logging with PII redaction. A request-ID middleware.
- GitHub Actions: install, lint, typecheck, test, build.

**Acceptance criteria:**

- `docker compose up` brings up all infra and `pnpm dev` starts the API with a `/health` endpoint.
- CI runs green on a trivial test.
- The logger redacts phone numbers and OTP-shaped values (tested).

### Stage 1: Identity (phone OTP) and shopper profile

**Goal:** passwordless login by phone number, with a shopper profile.
**Scope:**

- Endpoints: request OTP, verify OTP, refresh token, logout.
- OTP: 6 digits, 5-minute expiry, hashed in Redis, max 5 attempts, resend cooldown, per-phone and per-IP rate limits.
- An SMS provider interface with a dev/console driver. No real provider is wired yet.
- JWT access tokens (short-lived) plus rotating refresh tokens, with reuse detection.
- Shopper table with an encrypted phone and a deterministic hash for lookup. A consent record (purpose, timestamp, version).

**Acceptance criteria:**

- Brute force of OTP is blocked and tested.
- Replay of a used OTP fails. Reuse of a rotated refresh token revokes the session family.
- No plaintext phone number appears in the DB or in logs (verified by test).

### Stage 2: Merchants, API keys, and the address book

**Goal:** multi-tenant foundations and the shared address network.
**Scope:**

- Merchant model, API keys (hashed, prefix-visible, rotatable), and webhook endpoint registration with signing secrets.
- Tenant isolation: every query is scoped by merchant. Add automated tests that prove cross-tenant access fails.
- Shopper address book: CRUD, default address, pincode validation, and normalization. A shopper-level address can be reused across merchants only with that shopper's consent.
- An address quality score (complete, valid pincode, no junk tokens), computed as a pure function.

**Acceptance criteria:**

- Cross-tenant reads and writes are impossible, with tests proving it.
- A shopper can view, export, and delete their data.

### Stage 3: Cart sessions and the order domain

**Goal:** the order lifecycle without payments.
**Scope:**

- A cart session API (create from line items, apply a coupon stub, shipping and tax calculation stub).
- Order state machine: `created → payment_pending → paid | cod_confirmed → fulfilled → delivered | rto | cancelled`. Illegal transitions are rejected.
- Domain events published to Kafka with an outbox pattern so DB writes and events never diverge.
- Idempotent order creation via an idempotency key.

**Acceptance criteria:**

- Property or table tests cover every legal and illegal state transition.
- Killing the process between the DB write and the publish loses no events (outbox test).

### Stage 4: Payment orchestration

**Goal:** accept prepaid payments through one gateway, behind an interface that supports more.
**Scope:**

- A `PaymentGateway` interface: create payment, verify the signature, refund, and fetch status. Implement one real gateway in test/sandbox mode, plus a fake gateway for tests.
- A webhook receiver with signature verification, replay protection, and an idempotent handler. Duplicate and out-of-order webhooks must be safe.
- A reconciliation job that finds payments stuck in `pending` and resolves them by polling.
- Routing hook: choose a gateway by simple rules (method, amount). Failover is designed for but only stubbed.

**Acceptance criteria:**

- Tampered webhook signatures are rejected. Duplicate webhooks do not double-credit an order.
- No card data is stored. Hosted fields or a redirect flow only (assert in review).
- A refund flow works against the fake gateway and the sandbox.

### Stage 5: COD risk engine

**Goal:** score COD orders and act on the score.
**Scope:**

- A rules engine (pure, versioned, explainable). Signals: new vs repeat phone, order value, pincode RTO history, address quality score, time of day, order velocity, and a merchant-defined blocklist.
- Output: `{ score, band: low|medium|high, reasons[], action }` with an action of allow, verify (OTP or call), nudge to prepaid with a configurable incentive, or block.
- Merchant-configurable thresholds. Every decision is persisted with its inputs, rule version, and reasons for audit.
- A feedback loop: record delivered vs RTO outcomes to build a labeled dataset. A baseline model notebook or script is optional and should be clearly separated from the production rules path.

**Acceptance criteria:**

- Each rule has unit tests. The decision is deterministic for the same input and version.
- Latency budget: p95 under 50 ms for a scoring call at the local benchmark. Report the number.
- The reasons shown to a merchant never expose another merchant's data.

### Stage 6: Checkout web app

**Goal:** a fast, accessible one-page checkout.
**Scope:**

- Flow: phone → OTP → saved address select or add → payment method (UPI, card via the gateway's hosted UI, COD if allowed by risk) → confirmation.
- Mobile-first, with keyboard and screen-reader support. Handle slow networks with skeleton states and retries.
- Embeddable: loadable as a modal or redirect via a small JS SDK.
- Performance budget: JS under 100 KB gzipped for the main flow. Report the actual size.

**Acceptance criteria:**

- Playwright E2E covers: a new shopper paying prepaid, a returning shopper with a saved address, a high-risk COD order getting nudged, and an OTP failure path.
- Lighthouse performance and accessibility scores are reported, and fixes are made for any below 90.

### Stage 7: Shopify integration

**Goal:** connect a real store.
**Scope:**

- Check the current Shopify docs for what checkout customization is allowed on the plan in question, and record the findings in `docs/decisions/`. Do not assume Plus-only features are available.
- A Shopify app with OAuth install, an HMAC-verified webhook handler, and cart and order sync both ways.
- Draft-order or equivalent creation on payment success, with a mapping table of our orders to Shopify orders.
- Uninstall and data-redaction webhooks handled (GDPR/DPDP-style).

**Acceptance criteria:**

- Install, order sync, and uninstall work against a Shopify development store. Document the setup steps.
- Failed syncs are retried with backoff and visible in the dashboard.

### Stage 8: Merchant dashboard

**Goal:** merchants can operate and understand their checkout.
**Scope:**

- Auth for merchant users with roles (owner, ops, read-only).
- Pages: orders, payments, COD risk decisions with reasons, risk threshold settings, API keys and webhooks, sync health.
- Metrics: conversion funnel, prepaid share, RTO rate, with correct date-range and timezone handling (IST).

**Acceptance criteria:**

- Role permissions are enforced on the server, with tests (the UI is not a security boundary).
- Dashboard numbers reconcile with the raw order data in a test fixture.

### Stage 9: Hardening, observability, and deployment

**Goal:** production readiness.
**Scope:**

- OpenTelemetry tracing, metrics (RED), dashboards, and alerts. Structured audit logs.
- Load test the checkout and scoring paths (k6). Find and fix the top bottlenecks. Report before and after numbers.
- Threat model (STRIDE) for auth, payments, and webhooks. Fix or accept each finding in writing.
- Terraform for AWS (VPC, managed Postgres, Redis, a Kafka-compatible service, container service), secrets in a secrets manager, and migrations run in the deploy pipeline.
- Backups and a tested restore. A runbook for the top 5 incidents.
- Compliance checklist: DPDP consent, retention, deletion, and the payment-aggregator licensing position (we orchestrate through licensed gateways and do not hold funds).

**Acceptance criteria:**

- A staging deploy from CI works, with a smoke test post-deploy.
- Load test targets are met and recorded. The restore drill is documented.

---

## WHAT TO DO NOW

1. Read this whole prompt, then reply with a short plan: the repo layout, any questions that block Stage 0, and the assumptions you will make.
2. Begin **Stage 0**, run all four phases, then print the Stage Gate Checklist and stop for my "proceed".
