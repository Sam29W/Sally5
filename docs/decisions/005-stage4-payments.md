# 005: Stage 4 payment orchestration decisions

## Status

Accepted

## Context

Stage 4 added payment orchestration behind a `PaymentGateway` interface, with Razorpay as
the one real (sandbox) gateway and an in-memory fake used for every test, per explicit
instruction. A webhook receiver verifies signatures over the raw body, dedups deliveries,
and a reconciliation job polls payments stuck in `pending`.

## Decisions

- **Gateway choice**: Razorpay, picked by the user over Cashfree/PayU for being the most
  common choice for Indian D2C with the most-documented sandbox/test mode.
- **No card data anywhere**: `PaymentGateway.createPayment` only ever accepts
  `{ orderId, amountCents, currency }`; the `Payment` table only stores `gatewayPaymentId`
  (an opaque reference) and `amountCents`. For Razorpay specifically, we create an _order_
  server-side and return its id; the shopper's browser then collects payment via
  Razorpay's Checkout.js directly against Razorpay's servers — raw card/UPI details never
  transit our backend. Verified by grepping the entire payment module for
  card/PAN/CVV-shaped field names: zero matches.
- **Real sandbox credentials are env-var-only, all optional**: `RAZORPAY_KEY_ID`,
  `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. `gatewayRegistryProvider`
  ([gateway-registry.provider.ts](../../apps/api/src/payment/gateway-registry.provider.ts))
  only instantiates `RazorpayGateway` when all three are present; the fake gateway is
  always registered. No test environment sets the Razorpay vars, so every test — and the
  routing rule's fallback — exercises the fake gateway exclusively, confirmed live: a
  payment created against a server with no Razorpay keys set routed to `"fake"`
  automatically.
- **Routing is upfront fallback, not runtime failover**: `selectGateway`
  ([payment-routing.ts](../../apps/api/src/payment/payment-routing.ts)) is a pure function
  that picks the first available gateway from a per-method preference list
  (`["razorpay", "fake"]` for every method right now). This satisfies "designed for
  failover" — the preference list and fallback-when-unavailable logic exist — but real
  failover (catching a _failed_ call to the primary gateway mid-flight and retrying
  against the secondary) is intentionally not implemented, as the stage scope says to stub
  it.
- **Webhook raw-body handling**: signature verification needs byte-exact access to what
  the gateway signed, so `/payments/webhook/*` gets `express.raw()` instead of Nest's
  default `express.json()` — wired via a single branching middleware
  ([body-parser.ts](../../apps/api/src/body-parser.ts)) shared by `main.ts` and tests, so
  production and test behavior can't diverge. `app.use()`-level body parsing, not Nest's
  built-in `bodyParser` option, since Nest's default only supports one global parser.
- **Webhook idempotency is one transaction, not two checks**: the dedup insert
  (`ProcessedWebhookEvent`), the `Payment` status update, and the resulting `Order`
  transition + outbox event all happen inside a single `prisma.$transaction` in
  `PaymentService.processWebhook`. Recording "this event was received" separately from
  "and its effects were applied" would create a window where a crash between the two
  turns a legitimate retry into a silently-dropped update forever (the retry would see the
  dedup row and skip re-applying effects that never actually happened). A duplicate
  delivery (unique-constraint violation on the dedup insert) is caught and reported as
  `"duplicate"` — a 200, not an error.
- **Out-of-order webhook delivery is handled by the order state machine, not special-cased
  in `PaymentService`**: a late `payment.failed` for an already-`captured` payment is
  simply ignored (`payment.status === "pending"` guard before applying any transition), so
  it can never un-capture a payment or move an order backwards. This reuses Stage 3's
  `isLegalTransition` rather than adding new conditional logic.

## Known gaps carried forward

- `RazorpayGateway` and the Razorpay branch of `gatewayRegistryProvider` are intentionally
  untested (per the "fake gateway for all tests" instruction) — coverage on those two files
  is low (23% and 62% respectively) and that's expected, not a quality gap. The signature
  verification logic itself (`Razorpay.validateWebhookSignature`) is the SDK's own code,
  not ours, so there's nothing there to unit test without real credentials.
- Refunds don't cascade to `Order` status — a refunded payment leaves the order wherever it
  was (e.g. still `delivered`). Real-world refund-driven order-status changes (e.g. a
  `refunded` order status, partial refunds, RTO-triggered refunds) are more complex than
  Stage 4's scope and are deferred.
- No endpoint lists a merchant's payments or exposes `GET /payments/:id` directly — only
  create/refund, since nothing in this stage's acceptance criteria needed a read path
  beyond what the webhook/reconciliation flows already use internally.
- Carrying forward unchanged: Stage 2's `POST /merchants` auth gate (decision 003); Stage
  1's non-blocking notes (decision 002); Stage 3's reconciliation-style scheduler pattern
  reused here for `ReconciliationScheduler`.
