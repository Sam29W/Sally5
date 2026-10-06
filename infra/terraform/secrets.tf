# One Secrets Manager secret per AppConfig field this app actually requires — values are
# never set here (see README.md); this is only the declaration that the secret must
# exist. Keeping this list in sync with packages/config/src/env.ts is a manual process
# for now — worth automating (generate this file from the Zod schema) if this project
# ever gets real AWS usage.
locals {
  app_secret_names = [
    "DATABASE_URL",
    "REDIS_URL",
    "KAFKA_BROKERS",
    "PHONE_ENCRYPTION_KEY",
    "PHONE_HASH_KEY",
    "JWT_ACCESS_SECRET",
    "JWT_DASHBOARD_SECRET",
    "WEBHOOK_SECRET_ENCRYPTION_KEY",
    "SHOPIFY_TOKEN_ENCRYPTION_KEY",
    "ADMIN_PROVISIONING_KEY",
  ]
}

resource "aws_secretsmanager_secret" "app" {
  for_each = toset(local.app_secret_names)
  name     = "${local.name_prefix}/${each.value}"
  tags     = local.common_tags
}
