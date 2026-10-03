import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { ConsoleSmsProvider } from "./console-sms.provider.js";

describe("ConsoleSmsProvider", () => {
  it("never writes a plaintext phone number or OTP to the log stream", async () => {
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const logger = pino(
      {
        formatters: {
          log(obj) {
            // Mirrors the redaction formatter wired in packages/config's createLogger.
            const redacted: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(obj)) {
              redacted[k] =
                typeof v === "string"
                  ? v
                      .replace(/\+?\d[\d\s-]{8,14}\d/g, "[REDACTED_PHONE]")
                      .replace(/\b\d{6}\b/g, "[REDACTED_OTP]")
                  : v;
            }
            return redacted;
          },
        },
      },
      sink,
    );

    const provider = new ConsoleSmsProvider(logger);
    await provider.send("+919876543210", "Your CheckoutKit OTP is 482913");

    const logged = chunks.join("");
    expect(logged).not.toContain("9876543210");
    expect(logged).not.toContain("482913");
    expect(logged).toContain("[REDACTED_PHONE]");
    expect(logged).toContain("[REDACTED_OTP]");
  });
});
