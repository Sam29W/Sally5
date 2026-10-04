import { randomInt } from "node:crypto";
import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { AppConfig } from "@app/config";
import { CONFIG } from "../config.provider.js";
import { REDIS_CLIENT } from "../redis/redis.module.js";

export class OtpRateLimitedError extends Error {}
export class OtpLockedError extends Error {}
export class OtpInvalidError extends Error {}

function otpStateKey(phoneHash: string): string {
  return `otp:state:${phoneHash}`;
}

function rateLimitKey(scope: string, id: string): string {
  return `otp:ratelimit:${scope}:${id}`;
}

interface OtpState {
  codeHash: string;
  attempts: number;
  createdAt: number;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private hashOtp(code: string, phoneHash: string): string {
    // Salted with the phone hash so two shoppers never collide on the same OTP digest.
    return createHash("sha256").update(`${phoneHash}:${code}`).digest("hex");
  }

  /**
   * Issues a new OTP for `phoneHash`, enforcing per-phone and per-IP rate limits plus a
   * resend cooldown. Returns the plaintext code (caller is responsible for delivery and
   * must never log it).
   */
  async request(phoneHash: string, clientIp: string): Promise<string> {
    const perPhoneKey = rateLimitKey("phone", phoneHash);
    const perIpKey = rateLimitKey("ip", clientIp);

    const [phoneCount, ipCount] = await Promise.all([
      this.redis.incr(perPhoneKey),
      this.redis.incr(perIpKey),
    ]);
    if (phoneCount === 1) await this.redis.expire(perPhoneKey, 3600);
    if (ipCount === 1) await this.redis.expire(perIpKey, 3600);

    if (phoneCount > 10 || ipCount > 30) {
      throw new OtpRateLimitedError("Too many OTP requests — try again later");
    }

    const existingRaw = await this.redis.get(otpStateKey(phoneHash));
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as OtpState;
      const ageSeconds = (Date.now() - existing.createdAt) / 1000;
      if (ageSeconds < this.config.OTP_RESEND_COOLDOWN_SECONDS) {
        throw new OtpRateLimitedError("Resend cooldown active");
      }
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const state: OtpState = {
      codeHash: this.hashOtp(code, phoneHash),
      attempts: 0,
      createdAt: Date.now(),
    };
    await this.redis.set(
      otpStateKey(phoneHash),
      JSON.stringify(state),
      "EX",
      this.config.OTP_TTL_SECONDS,
    );
    return code;
  }

  /** Verifies `code` for `phoneHash`. Throws on mismatch, expiry, reuse, or too many attempts. */
  async verify(phoneHash: string, code: string): Promise<void> {
    const key = otpStateKey(phoneHash);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new OtpInvalidError("OTP expired or not requested");
    }
    const state = JSON.parse(raw) as OtpState;

    if (state.attempts >= this.config.OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new OtpLockedError("Too many failed attempts — request a new OTP");
    }

    const candidateHash = this.hashOtp(code, phoneHash);
    if (candidateHash !== state.codeHash) {
      state.attempts += 1;
      const ttl = await this.redis.ttl(key);
      await this.redis.set(key, JSON.stringify(state), "EX", ttl > 0 ? ttl : 1);
      throw new OtpInvalidError("Incorrect OTP");
    }

    // Single use: delete immediately on success so a captured/replayed code can never verify again.
    await this.redis.del(key);
  }
}
