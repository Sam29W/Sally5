# 004: Stage 3 cart, order, and outbox decisions

## Status

Accepted

## Context

Stage 3 added cart sessions, the order domain with a state machine, idempotent order
creation, and an outbox pattern for domain events. It also closed the Stage 2 gap where
the `AddressShare` consent table existed but nothing read it.

## Decisions

- **State machine as data, not scattered conditionals**: `LEGAL_TRANSITIONS` in
  [order-state-machine.ts](../../apps/api/src/order/order-state-machine.ts) is the single
  source of truth for every legal order transition. `OrderService.transition` is the only
  caller; there is exactly one place that can get this wrong, and the table test
  ([order-state-machine.test.ts](../../apps/api/src/order/order-state-machine.test.ts))
  enumerates the full 8×8 status matrix rather than hand-picking illegal examples.
- **Idempotency** is scoped `(merchantId, idempotencyKey)` via a DB unique constraint,
  checked with a plain `findUnique` before creating — a retried call with the same key
  returns the original order. Two concurrent calls with the same _never-before-seen_ key
  can both pass that check and both attempt the insert; Postgres's unique constraint lets
  only one win, and `OrderService.createIdempotent` catches the loser's `P2002` violation
  and re-reads/returns the winner's row rather than erroring — so the race resolves to the
  same "return the existing order" behavior as a normal replay, proven by a concurrency
  test (5 parallel calls, same key, exactly one row created).
- **Outbox pattern**: every order-mutating write (`createIdempotent`, `transition`) inserts
  its event row in the _same_ `prisma.$transaction` as the order write. Publishing is a
  separate step (`OutboxService.publishPending`) that never touches the order table — it
  only reads unpublished `OutboxEvent` rows and marks them published after a successful
  Kafka send. This is what makes the "kill the process between write and publish" guarantee
  real rather than aspirational: the order write and event write either both land or neither
  does (single transaction), and publishing is independently retryable from whatever state
  the outbox table is in.
- **Redpanda's advertised address** was `redpanda:9092` (the in-compose-network hostname),
  which broke every kafkajs reconnect once the client had the broker's real metadata — it
  only worked for the very first connection. Fixed to advertise `localhost:9092`, since
  everything that talks to this dev stack (the API, tests) runs on the host, not inside the
  compose network.
- **Merchant-facing shared-address read** (`GET /merchants/shoppers/:shopperId/addresses`)
  returns an empty array for a merchant with no `AddressShare` row — never a 403/404 — so
  a merchant can't distinguish "shopper exists but hasn't shared" from "shopper doesn't
  exist." Same shape as the webhook/address ownership checks from Stage 2: the consent gate
  is enforced in the query itself (`shares: { some: { merchantId } }`), not as a
  post-fetch check.

- **Scheduled outbox publisher** ([outbox-publisher-scheduler.service.ts](../../apps/api/src/outbox/outbox-publisher-scheduler.service.ts)):
  a plain `setInterval`, not `@nestjs/schedule` — the interval period comes from
  `OUTBOX_PUBLISH_INTERVAL_MS`, a runtime env var, and `@Interval()`'s decorator argument is
  fixed at class-decoration time, so it can't read config. Started from `OnModuleInit`,
  stopped from `OnModuleDestroy`. A failed drain pass is logged and swallowed, not
  rethrown — nothing is lost either way (unpublished rows stay unpublished, already-published
  rows stay published), and the next tick just picks up where the failed one left off.
  Explicitly disabled when `NODE_ENV=test` so it can't race test assertions or
  double-publish into a shared Kafka topic while tests are driving `OutboxService` directly.
  Verified live: created a real order against a running instance, waited for the next
  scheduled tick, confirmed `published_at` was set with zero manual intervention.

## Known gaps carried forward

- Carrying forward unchanged: Stage 2's `POST /merchants` auth gate, Stage 1's `trust
proxy`/race-safety notes already fixed where explicitly requested — see decisions 002 and 003.
