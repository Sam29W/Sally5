import pino from "pino";

// Matches E.164-ish phone numbers and bare 10-15 digit runs (how phone numbers show up in free text).
const PHONE_PATTERN = /\+?\d[\d\s-]{8,14}\d/g;
// OTPs in this system are always exactly 6 digits (see Stage 1 spec).
const OTP_PATTERN = /\b\d{6}\b/g;

export function redactPII(value: string): string {
  return value.replace(PHONE_PATTERN, "[REDACTED_PHONE]").replace(OTP_PATTERN, "[REDACTED_OTP]");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactPII(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    out[key] = redactValue(val);
  }
  return out;
}

export interface CreateLoggerOptions {
  level: string;
  name?: string;
}

export function createLogger(options: CreateLoggerOptions) {
  return pino({
    name: options.name ?? "checkoutkit",
    level: options.level,
    redact: {
      paths: ["phone", "phoneNumber", "otp", "*.phone", "*.phoneNumber", "*.otp"],
      censor: "[REDACTED]",
    },
    formatters: {
      log(obj) {
        return redactObject(obj);
      },
    },
  });
}
