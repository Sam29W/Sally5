import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { loadConfig } from "@app/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";
import { CONFIG } from "../config.provider.js";

const ADMIN_KEY = loadConfig().ADMIN_PROVISIONING_KEY;

/** A tiny "general" limit (3/window) so these tests trip it in a handful of requests
 * instead of hundreds — the limiter's logic is identical regardless of the configured
 * number, so this is a faithful test of the real thing, not a mock. */
describe("Merchant rate limiting (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const realConfig = loadConfig();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG)
      .useValue({
        ...realConfig,
        RATE_LIMIT_WINDOW_SECONDS: 60,
        RATE_LIMIT_GENERAL_PER_WINDOW: 3,
        RATE_LIMIT_COD_RISK_PER_WINDOW: 2,
        RATE_LIMIT_PAYMENTS_PER_WINDOW: 2,
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function freshMerchantApiKey(): Promise<string> {
    const merchant = await request(app.getHttpServer())
      .post("/merchants")
      .set("x-admin-provisioning-key", ADMIN_KEY)
      .send({ name: `Rate Limit Test ${randomUUID()}` });
    return merchant.body.apiKey as string;
  }

  it("allows requests under the general limit, then returns 429 with Retry-After once exceeded", async () => {
    const apiKey = await freshMerchantApiKey();
    const server = app.getHttpServer();

    // Limit is 3/window for /webhooks (a plain "general" category route).
    await request(server).get("/webhooks").set("x-api-key", apiKey).expect(200);
    await request(server).get("/webhooks").set("x-api-key", apiKey).expect(200);
    await request(server).get("/webhooks").set("x-api-key", apiKey).expect(200);

    const limited = await request(server).get("/webhooks").set("x-api-key", apiKey).expect(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(limited.body.message).toMatch(/rate limit/i);
  });

  it("tracks each merchant's own API key independently — one merchant's traffic never throttles another", async () => {
    const server = app.getHttpServer();
    const apiKeyA = await freshMerchantApiKey();
    const apiKeyB = await freshMerchantApiKey();

    await request(server).get("/webhooks").set("x-api-key", apiKeyA).expect(200);
    await request(server).get("/webhooks").set("x-api-key", apiKeyA).expect(200);
    await request(server).get("/webhooks").set("x-api-key", apiKeyA).expect(200);
    await request(server).get("/webhooks").set("x-api-key", apiKeyA).expect(429);

    // Merchant B is completely unaffected by merchant A having just been throttled.
    await request(server).get("/webhooks").set("x-api-key", apiKeyB).expect(200);
  });

  it("enforces a separate, independently configured limit for the cod-risk category", async () => {
    const server = app.getHttpServer();
    const apiKey = await freshMerchantApiKey();

    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "A", name: "Widget", quantity: 1, unitPriceCents: 1000 }] });
    const order = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id });
    // cod-risk limit is 2/window — two scoring calls succeed (404 is fine, it's still a
    // real round trip through the guard+service; a missing address shouldn't prevent the
    // rate limiter itself from being exercised), the third is throttled.
    const randomAddressId = randomUUID();
    await request(server)
      .post(`/orders/${order.body.id}/cod-risk/score`)
      .set("x-api-key", apiKey)
      .send({ addressId: randomAddressId });
    await request(server)
      .post(`/orders/${order.body.id}/cod-risk/score`)
      .set("x-api-key", apiKey)
      .send({ addressId: randomAddressId });
    const third = await request(server)
      .post(`/orders/${order.body.id}/cod-risk/score`)
      .set("x-api-key", apiKey)
      .send({ addressId: randomAddressId })
      .expect(429);
    expect(third.body.message).toMatch(/cod-risk/i);
  });

  it("does not rate-limit requests with no x-api-key header at all", async () => {
    await request(app.getHttpServer()).get("/health").expect(200);
    await request(app.getHttpServer()).get("/health").expect(200);
    await request(app.getHttpServer()).get("/health").expect(200);
    await request(app.getHttpServer()).get("/health").expect(200);
  });
});
