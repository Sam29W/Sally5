# India DPDP Act compliance checklist

A working checklist against India's Digital Personal Data Protection Act (DPDP), 2023,
covering what CheckoutKit collects and processes about shoppers (the only individuals
whose personal data this system handles — merchants are businesses, not "data
principals" under the Act). Each item says what's actually implemented, with a pointer,
or is flagged as an open gap.

## Data minimization

- [x] **Phone number is the only shopper PII collected** — no name, no email, no address
      is required to create a shopper identity (`Shopper` model: just `phoneEncrypted` +
      `phoneHash`). Address data is only collected if/when the shopper adds one for
      delivery, and is tied to the shopper, not inferred or purchased from a third party.
- [x] **No Shopify-sourced customer data is stored** — Stage 7's integration deliberately
      doesn't sync Shopify customer records (decision 008), so there's no second,
      unmanaged copy of personal data to account for.

## Consent

- [x] **Consent is recorded, not assumed** — `ConsentRecord` rows are written with a
      `purpose` and `version` on first login ([shopper.service.ts](../apps/api/src/shopper/shopper.service.ts)), giving
      a concrete, queryable answer to "did this shopper consent, and to what version of
      what policy" rather than an implicit "they used the app so they must have agreed."
- [ ] **Granular, purpose-specific consent for secondary uses** (e.g. marketing
      communications, if this product ever adds them) — not built, because no such
      secondary use exists yet. Must be added _before_ any feature that would need it, not
      retrofitted after.

## Right to access and erasure (the DPDP "data principal rights")

- [x] **Shopper-initiated data export** — `GET /shopper/me/export` returns the shopper's
      own profile (phone decrypted for their own eyes only), consents, and addresses —
      the full DPDP-style export, scoped so it can never return anyone else's data.
- [x] **Shopper-initiated deletion** — `DELETE /shopper/me` removes the shopper and
      cascades to their addresses, consents, and sessions (DB-level `onDelete: Cascade`,
      not an application-level loop that could miss a table).
- [x] **Address-sharing consent is itself revocable** — an `AddressShare` row only exists
      once a shopper explicitly grants it; there's no implicit sharing across merchants.

## Data security (DPDP's "reasonable security safeguards" requirement)

- [x] **Encryption at rest for every piece of raw PII**: phone (AES-256-GCM,
      `PHONE_ENCRYPTION_KEY`), Shopify access tokens (separate key,
      `SHOPIFY_TOKEN_ENCRYPTION_KEY`), outbound webhook signing secrets (separate key,
      `WEBHOOK_SECRET_ENCRYPTION_KEY`) — three independent keys, so a leak of one never
      compromises another's purpose.
- [x] **No raw card/UPI data ever touches this system** — payment is handled entirely by
      the gateway's own hosted-fields/redirect flow; CheckoutKit only ever sees a gateway's
      own opaque payment id, never a PAN or UPI handle.
- [x] **Structured-log redaction**: the logger redacts anything phone- or OTP-shaped from
      free-text log messages by regex (field-name-independent), proven by a direct test
      (`logger.test.ts`).
- [x] **Passwords (dashboard users) hashed, never stored or logged in recoverable form**
      (`scrypt`, Stage 8).
- [ ] **Encryption in transit between internal services** (API ↔ Postgres/Redis/Kafka) —
      not configured; this environment's local Docker Compose setup runs everything
      unencrypted on a trusted Docker network, which is fine for local dev but must be
      revisited (TLS for Postgres/Redis, MSK's `encryption_in_transit` — already declared
      in the Terraform skeleton, see `infra/terraform/messaging.tf`) before any real
      production deployment.

## Breach notification readiness

- [ ] **No incident-response runbook exists yet** — DPDP requires notifying the Data
      Protection Board and affected individuals "as soon as possible" after a breach; there
      is currently no documented process for _detecting_ one (no alerting is wired up —
      see the threat model's open gaps) let alone responding to it. **Real gap**, flagged
      for whoever operates this in production.

## Data localization

- [x] **No cross-border data transfer by default** — nothing in this codebase calls an
      external API with shopper PII (the Shopify integration never syncs customer data;
      Razorpay only ever receives what it needs to process a payment, which is standard
      practice for any India-based payment flow and not something CheckoutKit controls).
- [ ] **No explicit region pinning for where data is actually hosted** — the Terraform
      skeleton defaults to `ap-south-1` (Mumbai) for exactly this reason, but since nothing
      has been deployed, this is a stated intent, not a verified fact.

## Summary

Of the above, the two real open gaps worth prioritizing before any real deployment are:
**encryption in transit for internal service-to-service traffic**, and **an actual
incident-response/breach-notification runbook**. Everything else that DPDP meaningfully
touches for a phone-number-only, no-card-data system is already implemented and, where
practical, directly tested.
