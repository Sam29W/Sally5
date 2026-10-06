# CheckoutKit AWS infrastructure (Terraform)

**Status: written, never applied.** No AWS account/credentials exist in the environment
this was built in, and the `terraform` CLI itself isn't installed here either — so this
has had `terraform validate`/`plan`/`apply` run against it **zero times**. Treat every
file in this directory as a reviewed design, not a tested one. See
`docs/decisions/010-stage9-hardening.md` for the full reasoning and the checklist of what
to do before this is ever run for real.

## Layout

- `main.tf` — provider, backend placeholder, and module wiring.
- `network.tf` — VPC, public/private subnets across 2 AZs, NAT.
- `database.tf` — RDS Postgres (multi-AZ optional via variable), parameter group with
  the settings this app actually needs (no exotic extensions).
- `cache.tf` — ElastiCache Redis (single-node for cost; a real prod deployment should
  size this from actual load, not a guess).
- `messaging.tf` — MSK (managed Kafka) — sized minimally; CheckoutKit's outbox pattern
  only needs one small topic, not a large cluster.
- `compute.tf` — ECS Fargate service running `apps/api`'s container, behind an ALB.
- `secrets.tf` — every secret this app's `AppConfig` schema requires, as
  `aws_secretsmanager_secret` resources — **values are never set here**; this file only
  declares that the secrets must exist, matching `packages/config/src/env.ts` field for
  field.
- `variables.tf`, `outputs.tf` — standard Terraform plumbing.

## What's deliberately NOT here

- Static frontend hosting for `apps/checkout-web` / `apps/dashboard-web` (S3 + CloudFront
  is the obvious shape, but there's no real domain/cert to attach them to yet).
- Any CI/CD pipeline to actually build and push the container image this ECS service
  expects — that's a separate, real decision (CodePipeline vs. GitHub Actions vs.
  something else) that shouldn't be guessed at here.
- Any actual secret _values_ — Secrets Manager resources are declared, populated by
  whoever runs this for real, never by Terraform state.

## Before this is ever applied for real

1. Install `terraform` and run `terraform validate` — this has never been done.
2. Replace the local `backend "local"` block in `main.tf` with real remote state
   (S3 + DynamoDB lock table) — local state is only acceptable for the `validate`/`plan`
   dry run this was written for.
3. Review every instance size / storage size against real expected load — everything
   here is a conservative, cheap default, not a capacity-planned number.
4. Decide on the frontend hosting + CI/CD pieces called out above.
