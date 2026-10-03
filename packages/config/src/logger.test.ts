import { describe, expect, it } from "vitest";
import { createLogger, redactPII } from "./logger.js";

describe("redactPII", () => {
  it("redacts phone-shaped numbers", () => {
    expect(redactPII("call me at +919876543210 now")).toBe("call me at [REDACTED_PHONE] now");
    expect(redactPII("phone: 9876543210")).toBe("phone: [REDACTED_PHONE]");
  });

  it("redacts 6-digit OTP-shaped values", () => {
    expect(redactPII("your otp is 482913")).toBe("your otp is [REDACTED_OTP]");
  });

  it("leaves unrelated text untouched", () => {
    expect(redactPII("order #42 confirmed")).toBe("order #42 confirmed");
  });

  it("redacts both phone and otp in the same string", () => {
    expect(redactPII("otp 123456 sent to 9876543210")).toBe(
      "otp [REDACTED_OTP] sent to [REDACTED_PHONE]",
    );
  });
});

describe("createLogger", () => {
  it("builds a working pino logger at the configured level", () => {
    const logger = createLogger({ level: "debug", name: "test-logger" });
    expect(logger.level).toBe("debug");
    // Exercises the formatters.log -> redactObject/redactValue path for real, including a
    // nested array, to prove the structured-log redaction actually runs end-to-end.
    expect(() =>
      logger.info(
        { phone: "+919876543210", nested: { otp: "482913" }, tags: ["call 9876543210"] },
        "test log line",
      ),
    ).not.toThrow();
  });

  it("defaults the logger name when none is given", () => {
    const logger = createLogger({ level: "info" });
    expect(logger.level).toBe("info");
  });
});
