# Incident response and data breach runbook

**This document is operational guidance, not legal advice.** Sections marked
**⚠ REQUIRES LEGAL COUNSEL** describe decisions that must be made by, or in direct
consultation with, qualified legal counsel (and, for DPDP matters, counsel familiar with
Indian data protection law specifically). Nothing here should be read as a legal
determination of whether a given event _is_ a reportable breach, what the applicable
deadlines are, or what language a notification must use — those are legal judgments
that depend on facts this document cannot anticipate.

This runbook assumes the system as actually built through Stage 9: a NestJS API
(`apps/api`), Postgres/Redis/Redpanda infrastructure, two SvelteKit frontends
(`apps/checkout-web`, `apps/dashboard-web`), and the audit-log/rate-limiting additions in
this stage. It has not been exercised against a real incident — it is a reviewed design,
not a drilled procedure, pending a real tabletop exercise (see "Before this is relied
upon" at the end).

## 1. Detection

How an incident would actually be noticed today, and the real gaps in that:

- **What exists**: structured logging (pino, with phone/OTP redaction) on every request;
  OpenTelemetry tracing (console-exported only — see decision 010); the new audit log
  (this stage) for dashboard-side security-sensitive actions; database-level constraints
  and application-level tenant scoping that make most cross-tenant leaks structurally
  impossible rather than merely monitored.
- **What does not exist**: no alerting system, no anomaly detection, no SIEM, no on-call
  rotation. Today, detection relies on one of: a merchant reporting something wrong, a
  developer noticing during unrelated work, or a scheduled manual review of the audit
  log. **This is the single biggest gap in actually operating this runbook for real** —
  everything below assumes someone has already noticed _something_, and this system
  currently has no automated way to make that happen reliably.
- **Immediate action on suspicion of an incident**: do not wait for certainty. Move to
  Section 2 (Containment) on reasonable suspicion, not confirmed proof — delay to
  "make sure" is itself a containment failure if the suspicion is correct.

### Signals worth treating as a possible incident

- Unexpected `audit_logs` entries (an action nobody on the team remembers taking,
  especially `api_key.rotate`, `merchant_user.invite`, or `cod_risk_config.update`).
- A spike in `429` responses from the new per-merchant rate limiter, especially sustained
  across multiple windows (points at a compromised or runaway merchant API key — note
  that the opposite, a _total absence_ of legitimate traffic from a merchant who should
  be active, is also worth investigating).
- Database rows that shouldn't exist (e.g. a `MerchantUser` with a role/email nobody
  recognizes) or that are missing (e.g. a large unexplained drop in `Order` or `Shopper`
  row counts).
- A payment gateway webhook signature failure rate above zero in production (any failure
  here is either an attacker probing the endpoint, or a genuine gateway-side
  misconfiguration — both warrant investigation).
- Anything reported directly by a merchant, a shopper, or a security researcher.

## 2. Containment

Immediate, reversible-where-possible actions to stop ongoing harm, roughly in order of
how disruptive they are — start with the least disruptive action that actually stops the
bleeding:

1. **Revoke the specific credential**, if the incident is scoped to one: rotate the
   affected merchant's API key (`POST /dashboard/api-keys/rotate`, or directly via
   `MerchantService.rotateApiKey` if the dashboard itself is compromised), or force-expire
   a specific shopper's session family (`SessionFamily.revokedAt`), or disable a specific
   dashboard user. All of these are **surgical** — they stop one actor without affecting
   anyone else.
2. **Disable the Shopify integration for one shop**, if the incident involves a
   compromised Shopify Admin API token: mark that `ShopifyShop` uninstalled
   (`uninstalledAt`) and the token effectively unusable going forward; a real rotation
   would also need to revoke the token on Shopify's side via their API or dashboard.
3. **Tighten rate limits**, if the incident is a volumetric attack from one or more
   merchant keys: temporarily lower `RATE_LIMIT_*_PER_WINDOW` env vars and redeploy, or
   (faster, no redeploy) block the specific API key's hash at the infrastructure/WAF
   layer if one exists in the real deployment.
4. **Take the affected service fully offline**, only if narrower containment isn't
   possible or isn't fast enough: this is the most disruptive option and affects every
   merchant and shopper, not just the ones involved in the incident — use only when the
   alternative is worse (e.g. active, ongoing data exfiltration that narrower
   containment can't stop in time).
5. **Preserve evidence _before_ any destructive remediation** — see Section 4. A
   `pg_dump` of current state, a copy of relevant logs, and a note of exactly what
   containment action was taken and when, should happen before rotating keys or taking
   anything offline, if time allows without materially increasing harm.

Document every containment action taken, with a timestamp, as it happens — not
reconstructed afterward. This record is both an operational necessity (so the team knows
current state) and likely required for Section 6's notification.

## 3. Investigation

Goal: establish scope (what data, how many records, which merchants/shoppers, over what
time window) and root cause (how did this happen, is it still happening).

- **Start from the audit log** (`AuditLog` table / `GET /dashboard/audit-logs`) for
  anything involving dashboard actions — it records actor, merchant, action, timestamp,
  old/new values, IP, and user-agent for every COD-risk-config change and dashboard-user
  invitation (and bootstrap, and API-key rotation) as of this stage. This is often the
  fastest way to establish a timeline for a dashboard-side incident.
- **Check `CodRiskDecision` and outbox event rows** for a timeline of order-related
  events — these are already an append-only audit trail by design (decision 006), not
  something added for incident response specifically, but useful for it.
- **Check webhook signature verification failures** in logs — a burst of these is
  evidence of probing, even unsuccessful probing, and is worth timestamping for the
  timeline even if nothing succeeded.
- **Determine the blast radius precisely**: because of this system's tenant isolation
  design, most queries can answer "exactly which merchant(s)/shopper(s) were affected"
  directly rather than needing to infer it — e.g. every `Order`, `Payment`, and
  `CodRiskDecision` row carries its `merchantId`; every `Address` and `ConsentRecord`
  carries its `shopperId`. Use this to avoid over- or under-reporting scope later.
- **Determine whether the incident is ongoing**: if containment (Section 2) was
  incomplete, investigation continues in parallel with further containment, not after it.

## 4. Evidence preservation

- **Database snapshot**: `pg_dump` the live database to a timestamped file _before_ any
  further remediation changes data (the same mechanism proven in Stage 9's
  backup/restore drill — see decision 010). Store it somewhere the incident responders
  control, not the primary database's own backup rotation (which may itself be in
  scope if the incident involves infrastructure compromise).
- **Logs**: export the relevant time window's application logs before any log rotation
  or retention policy could delete them. Note that the structured logger already redacts
  phone/OTP-shaped values — this is a feature for evidence preservation too, since it
  means exported logs are safer to share with a wider incident-response group without a
  separate redaction pass.
- **Audit log export**: export the relevant `AuditLog` rows (and any `CodRiskDecision`,
  outbox, or webhook-delivery records) covering the incident window — these tables are
  append-only in application code, but a database-level compromise could still alter them
  directly, so note in the evidence record whether the export was taken from the primary
  database or a point-in-time-restored copy.
- **Chain of custody**: note who took each piece of evidence, when, and how (exact
  command run, exact file produced, its checksum). **⚠ REQUIRES LEGAL COUNSEL** if this
  incident may lead to regulatory action or litigation — evidence handling requirements
  in that case go beyond what this runbook specifies, and counsel should be looped in
  before evidence collection, not after.

## 5. Notification and escalation

**⚠ REQUIRES LEGAL COUNSEL for every item in this section.** This runbook describes
_who to loop in and how fast_, not what must legally be said, to whom, or by what
deadline — those determinations depend on facts, applicable law, and professional
judgment this document cannot substitute for.

### Internal escalation (can happen without waiting for legal sign-off)

1. Whoever detects or suspects an incident notifies the team lead/on-call immediately.
2. The team lead decides whether to engage legal counsel — the default should be "yes,
   early" rather than waiting for certainty that notification will be required; counsel
   engaged early can advise on investigation and containment too, not just notification.
3. For anything touching shopper personal data (phone numbers, addresses, consent
   records) or payment-adjacent data, legal counsel should be engaged **immediately**,
   not after investigation concludes — DPDP's "as soon as possible" standard for breach
   notification (see below) means the clock may already be running.

### External notification — DPDP Act, 2023 context

India's DPDP Act requires notifying the Data Protection Board of India and affected data
principals in the event of a "personal data breach," using language ("as soon as
possible") that does not specify a fixed number of hours/days the way GDPR's 72-hour
rule does. **What exactly satisfies "as soon as possible," what must be included in the
notification, and whether a given event legally qualifies as a "personal data breach"
under the Act are all determinations for legal counsel, not this runbook.** Do not draft
or send an external notification without counsel review.

What this runbook _can_ say without overstepping into legal judgment: the shopper
personal data this system holds is narrow (phone number, address, consent records — see
the compliance checklist for the full inventory) and every table carries enough
structure (via `shopperId`/`merchantId` scoping) to answer "exactly whose data was
involved" quickly once investigation identifies the affected rows — that answer is a
large part of what any notification will need, legal-language questions aside.

### Merchant notification

Merchants are business counterparties, not DPDP "data principals," but a breach
affecting their orders, payment data, or API credentials likely has contractual
notification obligations of its own (whatever agreement exists between CheckoutKit and
each merchant). **⚠ REQUIRES LEGAL COUNSEL** to confirm what those obligations actually
are — no such agreement exists to review in this codebase/environment.

## 6. Recovery

- Confirm containment actually stopped the incident (re-check the signals from Section 1
  that originally indicated it) before beginning recovery — recovering into an still-live
  incident just repeats the cycle.
- **Credential rotation**: rotate every credential that was in scope — merchant API
  keys, dashboard user passwords (force a reset, don't just rely on the user changing it
  voluntarily), JWT secrets (`JWT_ACCESS_SECRET`/`JWT_DASHBOARD_SECRET` — rotating these
  invalidates _every_ active session of that type, a blunt but effective tool), and any
  third-party credential (Razorpay, Shopify) that may have been exposed.
- **Restore from the pre-incident backup only if data integrity (not just
  confidentiality) was affected** — for a pure confidentiality breach (data read but not
  altered), restoring from backup is unnecessary and would lose legitimate activity since
  the snapshot. Decide this explicitly; don't restore reflexively.
- **Verify the root cause is actually fixed**, not just the immediate symptom — if the
  incident involved a vulnerability (e.g. a missing auth check), confirm the fix is
  deployed and covered by a regression test before considering the incident closed.
- **Re-enable anything disabled during containment** (rotated keys delivered securely to
  their rightful owners, Shopify re-installed if it was disabled, rate limits restored
  to normal values) once the above is confirmed.

## 7. Post-incident review

Conduct this within a few business days of recovery, while details are still fresh, with
everyone who was involved in detection/containment/investigation/recovery:

- **Timeline**: reconstruct exactly what happened and when, from detection through
  recovery, using the evidence preserved in Section 4.
- **Root cause**: not just "what broke" but "why did our existing safeguards not prevent
  or catch this sooner" — if this incident revealed a gap the STRIDE threat model
  (`docs/threat-model.md`) didn't anticipate, add it there.
- **What worked / what didn't** in the response itself, not just the original
  vulnerability — e.g. "detection took too long because nothing paged anyone" is itself
  an actionable finding (and, as of this runbook, an already-known gap: no alerting
  exists yet).
- **Action items, each with an owner and a target date** — not a general "we should
  improve monitoring" but specific, assigned work.
- **Update this runbook** if the review reveals it was unclear, incomplete, or wrong
  about something — a runbook that doesn't improve after every real use of it will drift
  out of sync with the system it's supposed to cover.

## Roles (fill in before this is relied upon for real)

This runbook currently has no named owners because no real operational team exists yet
in this environment. Before relying on this for a real deployment, fill in:

- **Incident commander** (coordinates the response, makes the call on containment vs.
  availability trade-offs):
- **Technical lead** (drives investigation/containment/recovery):
- **Legal counsel contact** (for every item marked ⚠ above):
- **Communications owner** (if merchant/shopper-facing communication is needed, drafts
  go through legal counsel first per Section 5):

## Before this is relied upon

1. **Run a tabletop exercise** — walk through a realistic scenario (e.g. "a merchant's
   API key was found on a public GitHub repo") against this runbook with the actual team
   that would respond, and fix whatever the exercise reveals is missing or unclear. This
   has not been done; this runbook is a reviewed design, not a drilled procedure.
2. **Wire up actual alerting** (Section 1's biggest named gap) — without it, "detection"
   in this runbook depends entirely on someone noticing manually.
3. **Get the legal relationships this runbook assumes exist actually in place**: a named
   counsel contact, and clarity on what merchant agreements say about breach
   notification — neither exists yet in this environment.
4. **Confirm the backup/restore mechanics this runbook's Recovery section assumes**
   still work against whatever the real production infrastructure ends up being (the
   drill in decision 010 was run against local Docker Compose Postgres, not a real
   managed database).
