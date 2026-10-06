import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Redis from "ioredis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The repo-root `.env` is the single source of truth for every stage's local infra —
 * reused here rather than duplicating secrets into a second e2e-only env file. */
function loadRepoEnv(): Record<string, string> {
  const raw = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

const repoEnv = loadRepoEnv();

export const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

function hashPhone(phone: string): string {
  return createHmac("sha256", repoEnv.PHONE_HASH_KEY).update(phone).digest("hex");
}

/** Mirrors OtpService's own hash — see apps/api/src/auth/otp.service.ts. */
function hashOtp(code: string, phoneHash: string): string {
  return createHash("sha256").update(`${phoneHash}:${code}`).digest("hex");
}

/**
 * Seeds a known OTP for `phone` directly into Redis, bypassing the SMS step entirely —
 * the real OTP is never observable outside the server process (console-sms logs it, but
 * the structured logger redacts anything OTP-shaped; see packages/config/src/logger.ts).
 * This is the same technique used to drive the live checkout flow manually during Stage 6
 * verification. Call *after* hitting /auth/otp/request so the resend-cooldown state this
 * overwrites is the real one, not a stale leftover.
 */
export async function seedOtp(phone: string, code = "123456"): Promise<void> {
  const redis = new Redis(repoEnv.REDIS_URL);
  const phoneHash = hashPhone(phone);
  const codeHash = hashOtp(code, phoneHash);
  await redis.set(
    `otp:state:${phoneHash}`,
    JSON.stringify({ codeHash, attempts: 0, createdAt: Date.now() }),
    "EX",
    300,
  );
  await redis.quit();
}

export async function clearOtpState(phone: string): Promise<void> {
  const redis = new Redis(repoEnv.REDIS_URL);
  const phoneHash = hashPhone(phone);
  await redis.del(`otp:state:${phoneHash}`);
  await redis.del(`otp:ratelimit:phone:${phoneHash}`);
  await redis.quit();
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export interface Merchant {
  merchantId: string;
  apiKey: string;
}

export async function createMerchant(name: string): Promise<Merchant> {
  return api<Merchant>("/merchants", { method: "POST", body: JSON.stringify({ name }) });
}

export interface CartSession {
  id: string;
  totalCents: number;
}

export async function createCart(
  apiKey: string,
  items: Array<{ sku: string; name: string; quantity: number; unitPriceCents: number }>,
): Promise<CartSession> {
  return api<CartSession>("/carts", {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: JSON.stringify({ items }),
  });
}

export interface Order {
  id: string;
  status: string;
  totalCents: number;
}

export async function createOrder(apiKey: string, cartSessionId: string): Promise<Order> {
  return api<Order>("/orders", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ cartSessionId }),
  });
}

export async function updateCodRiskConfig(
  apiKey: string,
  config: { highRtoPincodes?: string[]; lowAddressQualityThreshold?: number },
): Promise<void> {
  await api("/merchants/cod-risk-config", {
    method: "PUT",
    headers: { "x-api-key": apiKey },
    body: JSON.stringify(config),
  });
}

export function uniquePhone(): string {
  // Last 9 digits random, kept within a valid-looking Indian mobile range.
  const suffix = Math.floor(100000000 + Math.random() * 800000000);
  return `+91${suffix}`;
}
