# 011: Closing the three production gaps flagged in Stage 9

## Status

Accepted

## Context

Stage 9's threat model and compliance checklist each flagged open gaps. This follow-up
closes the three that don't require external credentials/tooling to close for real:
no audit log for security-sensitive dashboard actions, no per-merchant rate limiting,
and no incident-response runbook.

## Decisions

### Audit log

- **New `AuditLog` model, append-only by construction**: `AuditLogService` exposes
  `record` and `listForMerchant` only — no update, no delete, anywhere in the
  application code. An audit trail a privileged actor could edit isn't one.
- **Records actor, merchant, action, timestamp, resource, old/new values, IP, and
  user-agent**, exactly as asked. Two actor shapes: `actorId`/`actorEmail` when the
  actor is an authenticated `MerchantUser` (every action after bootstrap), and
  `actorApiKeyPrefix` (never the secret) for the one action — owner bootstrap — that
  happens before any `MerchantUser` exists, where the merchant's API key itself is the
  proof of identity.
- **Wired into the three places asked for and one more in the same spirit**: COD risk
  config updates (old and new config captured), dashboard-user invitations (attributing
  the inviting owner), owner bootstrap, and API key rotation (the new key's _prefix_
  only — the `AuditLog.newValue` JSON column never contains a secret).
- **Queryable from the dashboard**: `GET /dashboard/audit-logs` (optionally filtered by
  `action`), open to any authenticated role — knowing _that_ something changed is
  useful for ops/readonly reviewers too, and nothing sensitive is in the recorded values
  to restrict further.
- **Why old/new values are computed in the controller, not the service**: the
  `GET /dashboard/cod-risk-config` call that fetches "before" happens for free as a
  side effect of the controller already having access to `DashboardService`, without
  needing a separate "load the previous row" step inside `upsertForMerchant` itself —
  keeps the service's existing, already-tested merge logic (decision 006) untouched.

### Per-merchant rate limiting

- **Keyed by a hash of the presented API key, not the resolved `merchantId`**: this
  needs no database lookup of its own. `ApiKeyGuard`'s own authentication check already
  does that lookup independently; keying the rate limiter the same way would mean every
  request pays for two DB round trips (one to rate-limit, one to authenticate) instead
  of one. Since every merchant's key is unique, this is operationally per-merchant
  despite not being keyed by the resolved id — the only edge case is a few-second
  overlap across a key rotation, where the old and new key briefly have independent
  buckets, not worth solving for the gain.
- **Registered as a global guard (`APP_GUARD`)**, not attached per-controller: it runs
  on every request regardless of route, but no-ops immediately for any request with no
  `x-api-key` header (shopper-facing and dashboard routes are untouched — they have
  their own limits, or none needed yet). This also makes it order-independent relative
  to `ApiKeyGuard` — global guards run before controller-level ones in Nest, so this
  guard cannot depend on `ApiKeyGuard` having already resolved `merchantId`, and by
  design it doesn't need to.
- **Configurable by category**: `"general"` (default, 300/window), `"cod-risk"`
  (60/window — this is the deliberately more expensive scoring path benchmarked under
  load in decision 010), and `"payments"` (120/window), each a separate env var
  (`RATE_LIMIT_*_PER_WINDOW`) with a shared configurable window
  (`RATE_LIMIT_WINDOW_SECONDS`, default 60s). A route opts into a non-default category
  via `@RateLimitCategoryTag(...)`; everything else falls back to `"general"`.
- **Fixed-window counter in Redis** (`INCR` + `EXPIRE` on first increment) — the
  simplest correct implementation; a sliding window would be more precise at the
  boundary but isn't worth the complexity for a guardrail against runaway/compromised
  keys rather than a billing-grade quota system.
- **Returns a real `429`** with `Retry-After`, `X-RateLimit-Limit`, and
  `X-RateLimit-Remaining` headers — not a generic error, and not silently dropped.
- **Defaults sized to never trip on legitimate single-merchant test/dev traffic**: the
  existing test suite's heaviest single-merchant sequence (payment e2e: 8 calls;
  cod-risk e2e: 4 calls) is nowhere near the 120/60-per-window defaults — proven by the
  full suite passing unchanged (244/244) after this guard went global. The dedicated
  rate-limit test (`merchant-rate-limit.e2e.test.ts`) overrides `CONFIG` with
  deliberately tiny limits (3/2/2) to exercise the real 429 path in a handful of
  requests rather than hundreds, without weakening the real defaults.

### Incident response runbook

- **`docs/incident-response-runbook.md`**: detection, containment, investigation,
  evidence preservation, notification/escalation, recovery, post-incident review, and a
  DPDP-specific section — every section the task asked for.
- **Every legal claim is explicitly deferred to counsel**, marked
  **⚠ REQUIRES LEGAL COUNSEL** wherever the runbook would otherwise need to state what
  DPDP legally requires (notification deadline, required content, whether a given event
  qualifies as a reportable breach at all) — this runbook describes operational
  procedure and escalation paths, never a legal determination.
- **Written to reference this system's actual, specific mechanisms** (the new audit
  log as the first place to look during investigation, the Stage 9 backup/restore
  drill's exact `pg_dump` mechanism for evidence preservation, the structured logger's
  existing redaction as a reason exported logs are already safer to share) rather than
  generic incident-response boilerplate that wouldn't actually help someone responding
  to a real incident in this specific codebase.
- **Explicitly says what it has not yet been validated against**: no tabletop exercise
  has been run, no alerting exists (named as the single biggest gap in Section 1), and
  no real legal/communications contacts exist yet to fill in the Roles section. A
  runbook nobody has rehearsed is a draft, not a tested procedure, and this one says so.

## What this does not change

- Real alerting/monitoring still doesn't exist — the runbook names this as the gap it
  is rather than papering over it with a document that implies detection is solved.
- No tabletop exercise has been run against the runbook.
- `CHECKOUT_BASE_URL`, the Terraform skeleton, and the other Stage 7/9 placeholders are
  unaffected by this follow-up — still exactly as placeholder as decisions 008 and 010
  describe.
