import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { REDIS_CLIENT } from "../redis/redis.module.js";
import type { RateLimitCategory } from "./rate-limit-category.decorator.js";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window resets — used for the `Retry-After` header. */
  resetSeconds: number;
}

/**
 * Fixed-window counter in Redis, keyed by a hash of the *presented* API key, not
 * `merchantId` — this needs no DB lookup of its own (ApiKeyGuard's own auth check
 * already does that independently), so a rate-limit check never adds a database round
 * trip to a request that's about to fail auth anyway. Each merchant's key is unique, so
 * this is operationally per-merchant despite not being keyed by the resolved id; the only
 * edge case is a few-second overlap across a key rotation, where the old and new key
 * briefly have separate buckets — deliberately not worth solving for the gain.
 */
@Injectable()
export class MerchantRateLimiterService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private limitFor(category: RateLimitCategory): number {
    switch (category) {
      case "cod-risk":
        return this.config.RATE_LIMIT_COD_RISK_PER_WINDOW;
      case "payments":
        return this.config.RATE_LIMIT_PAYMENTS_PER_WINDOW;
      case "general":
      default:
        return this.config.RATE_LIMIT_GENERAL_PER_WINDOW;
    }
  }

  async checkAndIncrement(apiKey: string, category: RateLimitCategory): Promise<RateLimitResult> {
    const windowSeconds = this.config.RATE_LIMIT_WINDOW_SECONDS;
    const limit = this.limitFor(category);
    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const redisKey = `ratelimit:merchant:${keyHash}:${category}:${bucket}`;

    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, windowSeconds);
    }
    const ttl = await this.redis.ttl(redisKey);
    const resetSeconds = ttl > 0 ? ttl : windowSeconds;

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetSeconds,
    };
  }
}
