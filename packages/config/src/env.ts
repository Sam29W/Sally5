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
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
  // 32-byte key, hex-encoded, for AES-256-GCM encryption of webhook signing secrets at rest.
  WEBHOOK_SECRET_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 64 hex chars (32 bytes)"),
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
