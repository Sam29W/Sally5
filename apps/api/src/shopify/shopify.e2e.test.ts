import { createHmac, randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@app/config";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";
import { applyBodyParsers } from "../body-parser.js";
import { PrismaService } from "../prisma/prisma.service.js";

const WEBHOOK_SECRET = loadConfig().SHOPIFY_WEBHOOK_SECRET;

function signWebhook(body: Buffer): string {
  return createHmac("sha256", WEBHOOK_SECRET).update(body).digest("base64");
}

describe("Shopify integration (e2e)", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    applyBodyParsers(app);
    app.use(requestIdMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects /shopify/install without a shop query param", async () => {
    await request(app.getHttpServer()).get("/shopify/install").expect(400);
  });

  it("rejects a webhook with no signature header", async () => {
    const body = Buffer.from(JSON.stringify({ id: 1 }));
    await request(app.getHttpServer())
      .post("/shopify/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Topic", "app/uninstalled")
      .set("X-Shopify-Shop-Domain", "example.myshopify.com")
      .send(body.toString("utf8"))
      .expect(401);
  });

  it("rejects a webhook with a tampered body against a stale signature", async () => {
    const body = Buffer.from(JSON.stringify({ id: 1 }));
    const signature = signWebhook(body);
    const tampered = Buffer.from(JSON.stringify({ id: 2 }));
    await request(app.getHttpServer())
      .post("/shopify/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", signature)
      .set("X-Shopify-Topic", "app/uninstalled")
      .set("X-Shopify-Shop-Domain", "example.myshopify.com")
      .send(tampered.toString("utf8"))
      .expect(401);
  });

  it("accepts a correctly signed app/uninstalled webhook and marks the shop uninstalled", async () => {
    const server = app.getHttpServer();
    const merchant = await request(server)
      .post("/merchants")
      .send({ name: `Shopify Test Merchant ${randomUUID()}` });

    // Simulate a prior install by going straight through the Prisma layer the OAuth
    // callback would otherwise populate — the controller test only needs a row to exist.
    const prisma = app.get(PrismaService);
    const shopDomain = `e2e-${randomUUID()}.myshopify.com`;
    await prisma.shopifyShop.create({
      data: {
        shopDomain,
        merchantId: merchant.body.merchantId,
        accessTokenEncrypted: "irrelevant-for-this-test",
        scopes: "read_orders",
      },
    });

    const body = Buffer.from(JSON.stringify({ id: 1 }));
    const signature = signWebhook(body);
    await request(server)
      .post("/shopify/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", signature)
      .set("X-Shopify-Topic", "app/uninstalled")
      .set("X-Shopify-Shop-Domain", shopDomain)
      .send(body.toString("utf8"))
      .expect(200);

    const shop = await prisma.shopifyShop.findUnique({ where: { shopDomain } });
    expect(shop?.uninstalledAt).not.toBeNull();
  });

  it("accepts the mandatory GDPR webhooks as no-ops", async () => {
    for (const topic of ["customers/data_request", "customers/redact", "shop/redact"]) {
      const body = Buffer.from(JSON.stringify({ shop_id: 1 }));
      const signature = signWebhook(body);
      await request(app.getHttpServer())
        .post("/shopify/webhooks")
        .set("Content-Type", "application/json")
        .set("X-Shopify-Hmac-Sha256", signature)
        .set("X-Shopify-Topic", topic)
        .set("X-Shopify-Shop-Domain", "example.myshopify.com")
        .send(body.toString("utf8"))
        .expect(200);
    }
  });
});
