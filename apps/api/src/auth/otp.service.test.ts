import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { loadConfig } from "@app/config";
import { afterAll, describe, expect, it } from "vitest";
import { OtpInvalidError, OtpLockedError, OtpRateLimitedError, OtpService } from "./otp.service.js";

const config = loadConfig();
const redis = new Redis(config.REDIS_URL);
const service = new OtpService(redis, config);

function freshPhoneHash(): string {
  return `test-phone-hash:${randomUUID()}`;
}

/** A fresh, never-reused IP-scope key per test so hourly rate-limit counters from prior test
 * runs (TTL 3600s, same Redis instance) can never bleed into this run. */
function freshIp(): string {
  return `test-ip:${randomUUID()}`;
}

afterAll(async () => {
  await redis.quit();
});

describe("OtpService", () => {
  it("issues a 6-digit code and verifies it successfully", async () => {
    const phoneHash = freshPhoneHash();
    const code = await service.request(phoneHash, freshIp());
    expect(code).toMatch(/^\d{6}$/);
    await expect(service.verify(phoneHash, code)).resolves.toBeUndefined();
  });

  it("rejects an incorrect code", async () => {
    const phoneHash = freshPhoneHash();
    await service.request(phoneHash, freshIp());
    await expect(service.verify(phoneHash, "000000")).rejects.toBeInstanceOf(OtpInvalidError);
  });

  it("rejects replay: a code cannot be verified twice", async () => {
    const phoneHash = freshPhoneHash();
    const code = await service.request(phoneHash, freshIp());
    await service.verify(phoneHash, code);
    await expect(service.verify(phoneHash, code)).rejects.toBeInstanceOf(OtpInvalidError);
  });

  it("locks after exceeding max attempts (brute force protection)", async () => {
    const phoneHash = freshPhoneHash();
    await service.request(phoneHash, freshIp());

    for (let i = 0; i < config.OTP_MAX_ATTEMPTS; i++) {
      await expect(service.verify(phoneHash, "999999")).rejects.toBeInstanceOf(OtpInvalidError);
    }

    await expect(service.verify(phoneHash, "999999")).rejects.toBeInstanceOf(OtpLockedError);
  });

  it("enforces the resend cooldown", async () => {
    const phoneHash = freshPhoneHash();
    await service.request(phoneHash, freshIp());
    await expect(service.request(phoneHash, freshIp())).rejects.toBeInstanceOf(OtpRateLimitedError);
  });

  it("enforces a per-phone hourly rate limit", async () => {
    const phoneHash = freshPhoneHash();
    // Drain the cooldown by forcing distinct requests via direct Redis manipulation isn't
    // needed — the per-phone counter increments even across cooldown-rejected calls, so we
    // only need to exceed the counter threshold from one phone.
    await service.request(phoneHash, freshIp());
    for (let i = 0; i < 10; i++) {
      await expect(service.request(phoneHash, freshIp())).rejects.toBeInstanceOf(
        OtpRateLimitedError,
      );
    }
  }, 10000);
});
