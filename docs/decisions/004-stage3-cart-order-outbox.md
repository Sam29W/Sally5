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

## Known gaps carried forward

- **No scheduled outbox publisher yet** — `OutboxService.publishPending()` is called
  directly in tests but nothing invokes it on a timer or via Postgres `LISTEN`/`NOTIFY` in
  the running app. Needs a lightweight poller (or a proper CDC/Debezium setup) before this
  is useful in a real deployment — tracked for Stage 9.
- Carrying forward unchanged: Stage 2's `POST /merchants` auth gate, Stage 1's `trust
proxy`/race-safety notes already fixed where explicitly requested — see decisions 002 and 003.
