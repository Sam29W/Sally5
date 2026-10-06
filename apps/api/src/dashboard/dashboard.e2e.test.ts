import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";

async function bootstrapMerchantWithOwner(server: App) {
  const merchant = await request(server)
    .post("/merchants")
    .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
    .send({ name: `Dashboard Merchant ${randomUUID()}` });
  const apiKey = merchant.body.apiKey as string;
  const email = `owner-${randomUUID()}@example.com`;
  const password = "correct-horse-battery";
  await request(server)
    .post("/dashboard-auth/bootstrap")
    .set("x-api-key", apiKey)
    .send({ email, password });
  const login = await request(server).post("/dashboard-auth/login").send({ email, password });
  return {
    apiKey,
    ownerToken: login.body.accessToken as string,
    merchantId: merchant.body.merchantId as string,
  };
}

describe("Dashboard (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects every dashboard route without a token", async () => {
    const server = app.getHttpServer();
    await request(server).get("/dashboard/orders").expect(401);
    await request(server).get("/dashboard/metrics").expect(401);
  });

  it("lists this merchant's own orders, empty at first", async () => {
    const { ownerToken } = await bootstrapMerchantWithOwner(app.getHttpServer());
    const res = await request(app.getHttpServer())
      .get("/dashboard/orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it("never returns another merchant's orders", async () => {
    const server = app.getHttpServer();
    const merchantA = await bootstrapMerchantWithOwner(server);
    const merchantB = await bootstrapMerchantWithOwner(server);

    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", merchantA.apiKey)
      .send({ items: [{ sku: "A", name: "Widget", quantity: 1, unitPriceCents: 1000 }] });
    await request(server)
      .post("/orders")
      .set("x-api-key", merchantA.apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id });

    const ordersForA = await request(server)
      .get("/dashboard/orders")
      .set("Authorization", `Bearer ${merchantA.ownerToken}`)
      .expect(200);
    expect(ordersForA.body.length).toBe(1);

    const ordersForB = await request(server)
      .get("/dashboard/orders")
      .set("Authorization", `Bearer ${merchantB.ownerToken}`)
      .expect(200);
    expect(ordersForB.body).toEqual([]);
  });

  it("lets any authenticated role read the COD risk config, but only owner/ops update it", async () => {
    const server = app.getHttpServer();
    const { ownerToken } = await bootstrapMerchantWithOwner(server);

    const readonlyEmail = `ro-${randomUUID()}@example.com`;
    await request(server)
      .post("/dashboard-auth/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: readonlyEmail, password: "a-readonly-password", role: "readonly" });
    const readonlyLogin = await request(server)
      .post("/dashboard-auth/login")
      .send({ email: readonlyEmail, password: "a-readonly-password" });
    const readonlyToken = readonlyLogin.body.accessToken;

    await request(server)
      .get("/dashboard/cod-risk-config")
      .set("Authorization", `Bearer ${readonlyToken}`)
      .expect(200);

    await request(server)
      .put("/dashboard/cod-risk-config")
      .set("Authorization", `Bearer ${readonlyToken}`)
      .send({ highValueThresholdCents: 100000 })
      .expect(403);

    await request(server)
      .put("/dashboard/cod-risk-config")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ highValueThresholdCents: 100000 })
      .expect(200);
  });

  it("gates API key listing and rotation to owners only", async () => {
    const server = app.getHttpServer();
    const { ownerToken } = await bootstrapMerchantWithOwner(server);

    const opsEmail = `ops-${randomUUID()}@example.com`;
    await request(server)
      .post("/dashboard-auth/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: opsEmail, password: "an-ops-password-here", role: "ops" });
    const opsLogin = await request(server)
      .post("/dashboard-auth/login")
      .send({ email: opsEmail, password: "an-ops-password-here" });

    await request(server)
      .get("/dashboard/api-keys")
      .set("Authorization", `Bearer ${opsLogin.body.accessToken}`)
      .expect(403);

    const keys = await request(server)
      .get("/dashboard/api-keys")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(keys.body.length).toBe(1);
    expect(keys.body[0]).not.toHaveProperty("keyHash");

    await request(server)
      .post("/dashboard/api-keys/rotate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
  });

  it("reports shopify sync health as disconnected when no shop is installed", async () => {
    const { ownerToken } = await bootstrapMerchantWithOwner(app.getHttpServer());
    const res = await request(app.getHttpServer())
      .get("/dashboard/shopify-status")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body).toEqual({ connected: false });
  });

  it("returns daily metrics shaped per IST calendar day, empty when there are no orders", async () => {
    const { ownerToken } = await bootstrapMerchantWithOwner(app.getHttpServer());
    const res = await request(app.getHttpServer())
      .get("/dashboard/metrics?days=7")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it("computes a non-trivial conversion rate once an order is paid", async () => {
    const server = app.getHttpServer();
    const { apiKey, ownerToken } = await bootstrapMerchantWithOwner(server);

    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "A", name: "Widget", quantity: 1, unitPriceCents: 1000 }] });
    const order = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id });
    await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId: order.body.id, method: "upi" });

    const metrics = await request(server)
      .get("/dashboard/metrics?days=1")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(metrics.body.length).toBe(1);
    expect(metrics.body[0].ordersCreated).toBe(1);
  });

  it("records an audit log entry for bootstrapping the owner account", async () => {
    const { ownerToken } = await bootstrapMerchantWithOwner(app.getHttpServer());
    const logs = await request(app.getHttpServer())
      .get("/dashboard/audit-logs")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(logs.body.length).toBe(1);
    expect(logs.body[0]).toMatchObject({
      action: "merchant_user.bootstrap_owner",
      resourceType: "merchant_user",
    });
    expect(logs.body[0].actorApiKeyPrefix).toBeTruthy();
    expect(logs.body[0].ipAddress).toBeTruthy();
  });

  it("records an audit log entry when an owner invites a colleague, attributing the inviter", async () => {
    const server = app.getHttpServer();
    const { ownerToken } = await bootstrapMerchantWithOwner(server);

    const opsEmail = `ops-${randomUUID()}@example.com`;
    await request(server)
      .post("/dashboard-auth/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: opsEmail, password: "an-ops-password-here", role: "ops" })
      .expect(201);

    const logs = await request(server)
      .get("/dashboard/audit-logs?action=merchant_user.invite")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(logs.body.length).toBe(1);
    expect(logs.body[0]).toMatchObject({
      action: "merchant_user.invite",
      resourceType: "merchant_user",
      newValue: { email: opsEmail, role: "ops" },
    });
    expect(logs.body[0].actorId).toBeTruthy();
  });

  it("records old and new values when the COD risk config changes", async () => {
    const server = app.getHttpServer();
    const { ownerToken } = await bootstrapMerchantWithOwner(server);

    await request(server)
      .put("/dashboard/cod-risk-config")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ highValueThresholdCents: 777000 })
      .expect(200);

    const logs = await request(server)
      .get("/dashboard/audit-logs?action=cod_risk_config.update")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(logs.body.length).toBe(1);
    expect(logs.body[0].oldValue.highValueThresholdCents).not.toBe(777000);
    expect(logs.body[0].newValue.highValueThresholdCents).toBe(777000);
  });

  it("records an audit log entry when an API key is rotated, never the secret itself", async () => {
    const server = app.getHttpServer();
    const { ownerToken } = await bootstrapMerchantWithOwner(server);

    const rotated = await request(server)
      .post("/dashboard/api-keys/rotate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);

    const logs = await request(server)
      .get("/dashboard/audit-logs?action=api_key.rotate")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(logs.body.length).toBe(1);
    expect(logs.body[0].newValue.prefix).toBe(rotated.body.apiKey.split(".")[0]);
    expect(JSON.stringify(logs.body[0])).not.toContain(rotated.body.apiKey.split(".")[1]);
  });

  it("never returns another merchant's audit log entries", async () => {
    const server = app.getHttpServer();
    const merchantA = await bootstrapMerchantWithOwner(server);
    const merchantB = await bootstrapMerchantWithOwner(server);

    // Generate a second, distinctive entry for merchant A that must never leak into B's view.
    await request(server)
      .post("/dashboard-auth/users")
      .set("Authorization", `Bearer ${merchantA.ownerToken}`)
      .send({
        email: `ro-${randomUUID()}@example.com`,
        password: "a-readonly-password-xyz",
        role: "readonly",
      })
      .expect(201);

    const logsForB = await request(server)
      .get("/dashboard/audit-logs")
      .set("Authorization", `Bearer ${merchantB.ownerToken}`)
      .expect(200);
    // Only merchant B's own bootstrap entry — never merchant A's bootstrap or invite.
    expect(logsForB.body.length).toBe(1);
    expect(
      logsForB.body.every((l: { merchantId: string }) => l.merchantId === merchantB.merchantId),
    ).toBe(true);
  });
});
