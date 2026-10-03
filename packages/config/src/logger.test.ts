import { describe, expect, it } from "vitest";
import { redactPII } from "./logger.js";

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
