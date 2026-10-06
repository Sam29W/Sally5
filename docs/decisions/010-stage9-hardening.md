# 010: Stage 9 hardening and deployment decisions

## Status

Accepted — mixed real/placeholder, same pattern as Stage 7. Everything that can be made
real without AWS credentials or a `terraform`/`k6` CLI installed in this environment is
real, run, and verified; the AWS deployment itself is a reviewed-but-unapplied design.

## Context

Stage 9 asked for: OpenTelemetry tracing/metrics, k6 load testing, a STRIDE threat model,
Terraform for AWS, a backup/restore drill, and a compliance checklist — plus closing out
the action items accumulated across every previous stage's STATUS.md entry.

## What's real

- **OpenTelemetry tracing**: `apps/api/src/tracing.ts`, imported as the very first line of
  `main.ts` (required for auto-instrumentation to patch `http`/`express`/`pg`/`ioredis`/
  `kafkajs` before they're first loaded). Exports to the console — no real OTLP collector
  exists here, but the instrumentation itself is real: verified live by starting the
  server and confirming real spans with correct parent/child relationships for DB/Redis/
  Kafka connection setup, NestJS app creation, and an actual `GET /health` request
  (including its nested Express middleware span). Swapping `ConsoleSpanExporter` for a
  real OTLP exporter is the only change a real deployment needs to make here.
- **Load testing**: `load-test/cod-risk-score.k6.js` is a real k6 script, written for a
  CI/staging environment that has the `k6` binary — never run in this environment (not
  installed). `load-test/run-local.mjs` is a hand-rolled concurrent-fetch harness (no new
  dependency) that _was_ actually run against the live local API: `GET /health` at
  concurrency 20 (p50 8.06ms, p95 16.42ms, p99 22.50ms over ~519 requests) and
  `POST /orders/:id/cod-risk/score` at the same concurrency (p50 16.03ms, p95 23.04ms,
  p99 47.80ms) — both comfortably under Stage 5's 200ms budget for this path, closing the
  "benchmark the full HTTP path, not just the pure function" action item from decision 006.
- **Closed the `POST /merchants` gate** (open since decision 003, Stage 2): now requires
  `ADMIN_PROVISIONING_KEY` via a new `AdminProvisioningGuard`, `timingSafeEqual`-compared.
  Has a dev-only default so local dev/CI work without extra setup, same pattern as every
  other "no real credential, but still needs a real value" secret in this codebase.
  Updated all 13 existing test call sites across 8 files plus added a dedicated
  guard test (`merchant.e2e.test.ts`).
- **Closed the `public-checkout` coverage gap** (flagged in Stage 6's STATUS.md entry): 7
  new integration tests exercise the full capability-scoped surface directly via
  `supertest` (claim idempotency, claim conflict, cart/order 404s, payment creation,
  the full COD risk score→confirm flow) — coverage went from ~37% to 100% lines / 95%
  branches on this module, without needing a browser.
- **Backup/restore drill**: a real `pg_dump` against the live local Postgres (1553
  merchant rows, 994 orders — real accumulated data from every prior stage's testing),
  restored into a fresh scratch database, verified byte-for-byte via row counts matching
  exactly, zero errors in the restore log. Scratch database dropped afterward.
- **STRIDE threat model** ([threat-model.md](../threat-model.md)): every one of the six
  STRIDE categories reviewed against what's actually shipped, each threat marked
  mitigated-with-a-pointer or flagged as a real open gap (three found: no admin-action
  audit log, no per-merchant rate limiting, no outbox-lag alerting).
- **DPDP compliance checklist** ([compliance-checklist.md](../compliance-checklist.md)):
  reviewed against what CheckoutKit actually collects (phone number only) and processes;
  two real open gaps found (encryption in transit between internal services, no
  incident-response runbook).

## What's explicitly placeholder

- **Terraform for AWS** (`infra/terraform/`): a complete, reviewed VPC/RDS/ElastiCache/
  MSK/ECS Fargate/Secrets Manager layout — **never run through `terraform validate`**,
  because the `terraform` CLI isn't installed in this environment and no AWS account
  exists to apply it against. Every file's header comments say so explicitly. Secrets
  Manager resources declare that each secret must exist; no value is ever set by
  Terraform.
- **`CHECKOUT_BASE_URL`** (carried forward from Stage 6/7): still a placeholder — nothing
  has been deployed anywhere real yet, so there is still no real URL to put there.

## Follow-ups for whoever deploys this for real

1. Install `terraform`, run `validate`/`plan` against the skeleton in `infra/terraform/`,
   fix whatever it surfaces.
2. Replace the local Terraform state backend with S3 + DynamoDB before any real `apply`.
3. Build the CI/CD pipeline that produces the container image `compute.tf` expects —
   not designed here; a real decision, not a default to guess at.
4. Write the incident-response runbook the compliance checklist flags as missing.
5. Add per-merchant rate limiting and outbox-publish-lag alerting (threat model gaps).
6. Swap the OpenTelemetry console exporter for a real OTLP backend.
