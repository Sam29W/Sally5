import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyOAuthCallbackHmac, verifyWebhookHmac } from "./shopify-hmac.util.js";

describe("verifyOAuthCallbackHmac", () => {
  const apiSecret = "test-api-secret";

  function sign(params: Record<string, string>): string {
    const message = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
    return createHmac("sha256", apiSecret).update(message).digest("hex");
  }

  it("accepts a correctly signed callback", () => {
    const params = {
      shop: "example.myshopify.com",
      code: "abc123",
      state: "nonce1",
      timestamp: "1700000000",
    };
    const hmac = sign(params);
    expect(verifyOAuthCallbackHmac({ ...params, hmac }, apiSecret)).toBe(true);
  });

  it("ignores the hmac and signature params themselves when computing the message", () => {
    const params = { shop: "example.myshopify.com", code: "abc123" };
    const hmac = sign(params);
    // A legacy `signature` param (deprecated by Shopify but still sometimes present)
    // must not affect the result either way.
    expect(verifyOAuthCallbackHmac({ ...params, hmac, signature: "irrelevant" }, apiSecret)).toBe(
      true,
    );
  });

  it("rejects a tampered query param", () => {
    const params = { shop: "example.myshopify.com", code: "abc123" };
    const hmac = sign(params);
    expect(verifyOAuthCallbackHmac({ ...params, code: "tampered", hmac }, apiSecret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const params = { shop: "example.myshopify.com", code: "abc123" };
    const hmac = sign(params);
    expect(verifyOAuthCallbackHmac({ ...params, hmac }, "wrong-secret")).toBe(false);
  });

  it("rejects a missing hmac param", () => {
    expect(verifyOAuthCallbackHmac({ shop: "example.myshopify.com" }, apiSecret)).toBe(false);
  });
});

describe("verifyWebhookHmac", () => {
  const secret = "test-webhook-secret";

  it("accepts a correctly signed raw body", () => {
    const body = Buffer.from(JSON.stringify({ id: 1, order_number: 1001 }));
    const hmac = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyWebhookHmac(body, hmac, secret)).toBe(true);
  });

  it("rejects a tampered body against an otherwise-valid signature", () => {
    const body = Buffer.from(JSON.stringify({ id: 1 }));
    const hmac = createHmac("sha256", secret).update(body).digest("base64");
    const tampered = Buffer.from(JSON.stringify({ id: 2 }));
    expect(verifyWebhookHmac(tampered, hmac, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = Buffer.from(JSON.stringify({ id: 1 }));
    const hmac = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyWebhookHmac(body, hmac, "wrong-secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookHmac(Buffer.from("{}"), undefined, secret)).toBe(false);
  });
});
