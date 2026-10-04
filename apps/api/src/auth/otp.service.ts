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

enum VerifyOutcome {
  Expired = "0",
  Locked = "1",
  Mismatch = "2",
  Success = "3",
}

// Redis executes a single EVAL atomically (single-threaded), so this closes the TOCTOU
// window a plain GET-then-SET verify would have under concurrent requests with the same
// code: two parallel calls can no longer both observe "not yet locked/used" and both act
// on it. All three outcomes (lock, mismatch+increment, success+delete) happen in one step.
const VERIFY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return '${VerifyOutcome.Expired}' end
local state = cjson.decode(raw)
if state.attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return '${VerifyOutcome.Locked}'
end
if state.codeHash ~= ARGV[1] then
  state.attempts = state.attempts + 1
  local ttl = redis.call('TTL', KEYS[1])
  if ttl < 1 then ttl = 1 end
  redis.call('SET', KEYS[1], cjson.encode(state), 'EX', ttl)
  return '${VerifyOutcome.Mismatch}'
end
redis.call('DEL', KEYS[1])
return '${VerifyOutcome.Success}'
`;

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

  /** Verifies `code` for `phoneHash`. Throws on mismatch, expiry, reuse, or too many attempts.
   * Atomic (see VERIFY_SCRIPT) — safe under concurrent verify calls for the same phone. */
  async verify(phoneHash: string, code: string): Promise<void> {
    const key = otpStateKey(phoneHash);
    const candidateHash = this.hashOtp(code, phoneHash);

    const outcome = (await this.redis.eval(
      VERIFY_SCRIPT,
      1,
      key,
      candidateHash,
      this.config.OTP_MAX_ATTEMPTS,
    )) as VerifyOutcome;

    switch (outcome) {
      case VerifyOutcome.Expired:
        throw new OtpInvalidError("OTP expired or not requested");
      case VerifyOutcome.Locked:
        throw new OtpLockedError("Too many failed attempts — request a new OTP");
      case VerifyOutcome.Mismatch:
        throw new OtpInvalidError("Incorrect OTP");
      case VerifyOutcome.Success:
        return;
    }
  }
}
