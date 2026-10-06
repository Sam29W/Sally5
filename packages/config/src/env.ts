import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  KAFKA_BROKERS: z.string().min(1),
  // 32-byte key, hex-encoded (64 hex chars), for AES-256-GCM phone encryption at rest.
  PHONE_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "must be 64 hex chars (32 bytes)"),
  // HMAC-SHA256 key for deterministic phone lookup hashing — kept separate from the
  // encryption key so leaking one doesn't compromise the other's purpose.
  PHONE_HASH_KEY: z.string().min(32),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Deliberately a different secret from JWT_ACCESS_SECRET (shopper tokens) — a merchant
  // dashboard login token must never verify as a valid shopper token, or vice versa.
  JWT_DASHBOARD_SECRET: z.string().min(32),
  JWT_DASHBOARD_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
  // 32-byte key, hex-encoded, for AES-256-GCM encryption of webhook signing secrets at rest.
  WEBHOOK_SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 64 hex chars (32 bytes)"),
  // Number of reverse-proxy hops Express should trust when deriving the client IP from
  // X-Forwarded-For. 0 (default) means "no proxy" — req.ip is always the real socket
  // address and X-Forwarded-For is ignored, so it can't be spoofed to bypass per-IP rate
  // limiting. Set to the real hop count only once this sits behind a load balancer.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
  // How often the background job drains unpublished outbox rows to Kafka. Disabled
  // (never runs) in NODE_ENV=test — tests call OutboxService.publishPending() directly so
  // they aren't racing a background timer.
  OUTBOX_PUBLISH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // HMAC secret for the in-memory fake payment gateway used by every test — not a real
  // credential, just needs to be present so signature verification has something to key
  // off of.
  FAKE_GATEWAY_WEBHOOK_SECRET: z.string().min(16).default("dev-only-fake-gateway-secret-key"),
  // Gates POST /merchants — minting the first API key for a new merchant is the one
  // operation in this whole API that can't require an API key (it doesn't exist yet), so
  // it's gated by this shared operator secret instead. Has a dev-only default so local
  // dev/tests work out of the box; a real deployment must override it.
  ADMIN_PROVISIONING_KEY: z.string().min(16).default("dev-only-admin-provisioning-key"),
  // Real sandbox credentials — all optional. The Razorpay gateway is only instantiated
  // when all three are present; until then, payment creation/refund/reconciliation against
  // "razorpay" simply isn't available, but nothing at boot requires them (the fake gateway
  // covers every test).
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  CHECKOUT_BASE_URL: z.string().default("http://localhost:5173"),
  // How often the reconciliation job polls payments stuck in `pending`.
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  RECONCILIATION_STALE_AFTER_MS: z.coerce.number().int().positive().default(300000),
  // Real Shopify Partner app credentials — all optional, same pattern as the Razorpay
  // keys above. No Partner account/dev store exists in this environment, so the OAuth
  // install/callback flow and live Admin API calls are unexercised; the HMAC
  // verification logic they depend on is unit-tested against known-good vectors instead.
  // 32-byte key, hex-encoded, for AES-256-GCM encryption of the Shopify access token at
  // rest — required even without real Shopify credentials, since it protects whatever
  // token value ends up stored.
  SHOPIFY_TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 64 hex chars (32 bytes)"),
  SHOPIFY_API_KEY: z.string().optional(),
  SHOPIFY_API_SECRET: z.string().optional(),
  // Unlike API_KEY/SECRET above, this one isn't a Shopify-issued credential — it's a
  // shared secret *we* mint and paste into the Partner dashboard's webhook config, so it
  // can have a real dev-only default and be exercised by tests even without a live app.
  SHOPIFY_WEBHOOK_SECRET: z.string().min(16).default("dev-only-shopify-webhook-secret-key"),
  SHOPIFY_SCOPES: z.string().default("read_orders,write_draft_orders"),
  SHOPIFY_APP_URL: z.string().default("http://localhost:3000"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
