# 006: Stage 5 COD risk engine decisions

## Status

Accepted

## Context

Stage 5 added a rules-based COD risk engine: deterministic, versioned, explainable, with
merchant-configurable thresholds and every decision persisted for audit.

## Decisions

- **Rules as small, independent pure functions** ([rules/](../../apps/api/src/cod-risk/rules)),
  not one large conditional block — each rule is its own file, its own unit test, and
  returns either `null` or `{ points, reason }`. The engine
  ([cod-risk-engine.ts](../../apps/api/src/cod-risk/cod-risk-engine.ts)) just sums whatever
  fires. Adding, removing, or reweighting a signal never requires touching any other rule.
- **Blocklist is a rule, not a special code path, but it still forces `action=block`**:
  `blocklistRule` returns enough points (100) to guarantee the "high" band on its own, and
  the engine checks specifically for its reason string to override the normal band→action
  mapping. This keeps it inside the same explainable "sum of triggered rules" model as
  everything else, while still being an unconditional override in practice.
- **Reasons are categorical, never the matched value**: every rule's reason string is a
  fixed, generic sentence ("merchant blocklist match", "delivery pincode has an elevated
  RTO history") — never the specific pincode, phone hash, or score that triggered it. This
  is what makes "the reasons shown to a merchant never expose another merchant's data" true
  by construction rather than by a runtime check: there is no merchant-specific value in
  the reason strings to leak in the first place.
- **Per-merchant config, not a shared global**: `CodRiskConfig` is a one-row-per-merchant
  table with sensible defaults (`DEFAULT_COD_RISK_CONFIG`) used whenever a merchant hasn't
  configured anything. A real bug caught while testing this: `UpdateCodRiskConfigDto`'s
  unset optional fields are own properties with value `undefined` under TypeScript's
  `useDefineForClassFields` class semantics, so a naive `{ ...current, ...partial }` merge
  silently overwrote every field the caller _didn't_ send with `undefined` — a second
  partial update would have reset the first one's changes. Fixed by only copying
  `partial`'s explicitly-defined keys onto `current`, proven live (two sequential `PUT`
  calls, each changing one field, both took effect).
- **Inputs are supplied, not computed internally**: `orderHour` and `recentOrderCount` are
  parameters, not `new Date()` / a DB query inside the pure `scoreCodRisk` function —
  `CodRiskService` (the one place that touches Postgres) gathers them and hands the engine
  a plain object. This is what makes the engine itself trivially unit-testable and
  genuinely deterministic rather than "deterministic except for the clock."
- **Latency**: measured, not assumed — 5,000 in-process calls, p95 = 0.0013ms (see
  [cod-risk-engine.benchmark.test.ts](../../apps/api/src/cod-risk/cod-risk-engine.benchmark.test.ts)).
  Comfortably under the 50ms budget, as expected for a pure function with no I/O; the real
  latency a production scoring _call_ experiences is dominated by `CodRiskService`'s DB
  reads (order/address/shopper/recent-order-count), which aren't part of this benchmark —
  noted as a gap below.

## Known gaps carried forward

- The 50ms budget was measured against the pure `scoreCodRisk` function only, not the full
  `POST /orders/:id/cod-risk/score` HTTP call (which does 3-4 DB reads first). A true
  end-to-end latency benchmark under load belongs in Stage 9.
- No automatic wiring into the order/checkout flow — scoring is a standalone endpoint the
  caller (eventually the checkout web app, Stage 6) invokes explicitly with a chosen
  `addressId`. Nothing in this stage's scope required the rules engine to run itself.
- The "feedback loop" is a bare recording endpoint (`CodRiskOutcome`), not a labeled
  dataset export or any model — explicitly out of scope per the master prompt ("a baseline
  model... should be clearly separated from the production rules path").
- Carrying forward unchanged: Stage 2's `POST /merchants` auth gate (decision 003).
