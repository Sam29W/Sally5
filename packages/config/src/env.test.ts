import { describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

const validEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:9092",
  PHONE_ENCRYPTION_KEY: "0".repeat(64),
  PHONE_HASH_KEY: "a".repeat(32),
  JWT_ACCESS_SECRET: "b".repeat(32),
  WEBHOOK_SECRET_ENCRYPTION_KEY: "1".repeat(64),
};

describe("loadConfig", () => {
  it("parses a minimal valid environment, applying defaults", () => {
    const config = loadConfig(validEnv);
    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(3000);
    expect(config.TRUST_PROXY_HOPS).toBe(0);
    expect(config.OTP_MAX_ATTEMPTS).toBe(5);
  });

  it("coerces numeric env vars from strings", () => {
    const config = loadConfig({ ...validEnv, PORT: "8080", TRUST_PROXY_HOPS: "2" });
    expect(config.PORT).toBe(8080);
    expect(config.TRUST_PROXY_HOPS).toBe(2);
  });

  it("throws a readable error when a required var is missing", () => {
    const rest = Object.fromEntries(
      Object.entries(validEnv).filter(([key]) => key !== "DATABASE_URL"),
    );
    expect(() => loadConfig(rest)).toThrow(/DATABASE_URL/);
  });

  it("throws when a key is the wrong length", () => {
    expect(() => loadConfig({ ...validEnv, PHONE_ENCRYPTION_KEY: "tooshort" })).toThrow(
      /PHONE_ENCRYPTION_KEY/,
    );
  });

  it("rejects a negative TRUST_PROXY_HOPS", () => {
    expect(() => loadConfig({ ...validEnv, TRUST_PROXY_HOPS: "-1" })).toThrow();
  });
});
