import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Buffers of different length would throw inside timingSafeEqual, and the length
  // mismatch itself is not secret, so it's fine to short-circuit on it.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the `hmac` query parameter Shopify appends to every OAuth install/callback
 * redirect. Per Shopify's documented algorithm: drop `hmac` and `signature`, sort the
 * remaining keys, join as `key=value` pairs with `&`, HMAC-SHA256 that string with the
 * app's API secret, and compare the hex digest — never a plain `===`, since that leaks
 * timing information about how many leading bytes matched.
 */
export function verifyOAuthCallbackHmac(query: Record<string, string>, apiSecret: string): boolean {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  void signature;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("&");
  const expected = createHmac("sha256", apiSecret).update(message).digest("hex");
  return safeEqual(expected, hmac);
}

/**
 * Verifies the `X-Shopify-Hmac-Sha256` header on an inbound webhook: base64 HMAC-SHA256
 * of the exact raw request body (must be the untouched bytes — re-serializing parsed JSON
 * can reorder keys or change whitespace and silently break this) using the webhook's
 * shared secret.
 */
export function verifyWebhookHmac(
  rawBody: Buffer | string,
  hmacHeader: string | undefined,
  webhookSecret: string,
): boolean {
  if (!hmacHeader) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("base64");
  return safeEqual(expected, hmacHeader);
}
