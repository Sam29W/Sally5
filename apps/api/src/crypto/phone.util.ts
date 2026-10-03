const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Strips whitespace/punctuation and defaults a bare 10-digit number to +91 (India). */
export function normalizePhone(input: string): string {
  const trimmed = input.trim().replace(/[\s-()]/g, "");
  const candidate = trimmed.startsWith("+")
    ? trimmed
    : trimmed.length === 10
      ? `+91${trimmed}`
      : `+${trimmed}`;
  if (!E164_PATTERN.test(candidate)) {
    throw new Error("Phone number must be a valid E.164 number");
  }
  return candidate;
}
