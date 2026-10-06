import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";
import { applyBodyParsers } from "../body-parser.js";
import { GATEWAY_REGISTRY, type GatewayRegistry } from "./gateway-registry.provider.js";
import { FakeGateway } from "./gateways/fake-gateway.js";

describe("Payment orchestration (e2e)", () => {
  let app: NestExpressApplication;
  let fakeGateway: FakeGateway;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    applyBodyParsers(app);
    app.use(requestIdMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const registry = moduleRef.get<GatewayRegistry>(GATEWAY_REGISTRY);
    fakeGateway = registry.get("fake") as FakeGateway;

    const merchant = await request(app.getHttpServer())
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Payment Test Merchant ${Date.now()}` });
    apiKey = merchant.body.apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOrder(server: Parameters<typeof request>[0]): Promise<string> {
    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "A", name: "Widget", quantity: 1, unitPriceCents: 1000 }] })
      .expect(201);
    const order = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id })
      .expect(201);
    return order.body.id;
  }

  function webhookBody(eventId: string, event: string, gatewayPaymentId: string): Buffer {
    return Buffer.from(
      JSON.stringify({
        id: eventId,
        event,
        payload: { payment: { entity: { id: gatewayPaymentId } } },
      }),
    );
  }

  it("creates a payment against the fake gateway and moves the order to payment_pending", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);

    const payment = await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId, method: "upi" })
      .expect(201);
    expect(payment.body.gateway).toBe("fake");
    expect(payment.body.status).toBe("pending");

    const order = await request(server)
      .get(`/orders/${orderId}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(order.body.status).toBe("payment_pending");
  });

  it("a correctly signed payment.captured webhook marks the payment captured and the order paid", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);
    const payment = await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId })
      .expect(201);

    const body = webhookBody(randomUUID(), "payment.captured", payment.body.gatewayPaymentId);
    await request(server)
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", fakeGateway.sign(body))
      .send(body.toString("utf8"))
      .expect(200);

    const order = await request(server)
      .get(`/orders/${orderId}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(order.body.status).toBe("paid");
  });

  it("rejects a webhook with a tampered signature", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);
    const payment = await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId })
      .expect(201);

    const body = webhookBody(randomUUID(), "payment.captured", payment.body.gatewayPaymentId);
    await request(server)
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", "0".repeat(64))
      .send(body.toString("utf8"))
      .expect(401);

    // Tampering must not have had any side effect — the order is untouched.
    const order = await request(server)
      .get(`/orders/${orderId}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(order.body.status).toBe("payment_pending");
  });

  it("rejects a webhook with no signature header at all", async () => {
    const body = webhookBody(randomUUID(), "payment.captured", "fake_pay_whatever");
    await request(app.getHttpServer())
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .send(body.toString("utf8"))
      .expect(401);
  });

  it("a duplicate webhook delivery does not double-process (order transitions exactly once)", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);
    const payment = await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId })
      .expect(201);

    const eventId = randomUUID();
    const body = webhookBody(eventId, "payment.captured", payment.body.gatewayPaymentId);
    const signature = fakeGateway.sign(body);

    const first = await request(server)
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", signature)
      .send(body.toString("utf8"))
      .expect(200);
    expect(first.body.status).toBe("processed");

    // Exact same delivery, replayed (same event id) — must be a no-op, not an error and
    // not a second credit.
    const second = await request(server)
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", signature)
      .send(body.toString("utf8"))
      .expect(200);
    expect(second.body.status).toBe("duplicate");

    // Manually attempting to move the order backwards would fail if it had been
    // transitioned twice in a way that corrupted state; simplest direct proof: it's
    // "paid" exactly once and a second payment.captured for the same order didn't error
    // out trying to re-apply an illegal transition.
    const order = await request(server)
      .get(`/orders/${orderId}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(order.body.status).toBe("paid");
  });

  it("out-of-order delivery (failed after captured) does not downgrade an already-captured payment", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);
    const payment = await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId })
      .expect(201);

    const capturedBody = webhookBody(
      randomUUID(),
      "payment.captured",
      payment.body.gatewayPaymentId,
    );
    await request(server)
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", fakeGateway.sign(capturedBody))
      .send(capturedBody.toString("utf8"))
      .expect(200);

    // A late/out-of-order "failed" event for the same payment, now that it's already
    // captured, must not revert it.
    const failedBody = webhookBody(randomUUID(), "payment.failed", payment.body.gatewayPaymentId);
    await request(server)
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", fakeGateway.sign(failedBody))
      .send(failedBody.toString("utf8"))
      .expect(200);

    const order = await request(server)
      .get(`/orders/${orderId}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(order.body.status).toBe("paid");
  });

  it("refunds a captured payment against the fake gateway", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);
    const payment = await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId })
      .expect(201);

    const body = webhookBody(randomUUID(), "payment.captured", payment.body.gatewayPaymentId);
    await request(server)
      .post("/payments/webhook/fake")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", fakeGateway.sign(body))
      .send(body.toString("utf8"))
      .expect(200);

    const refunded = await request(server)
      .post(`/payments/${payment.body.id}/refund`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(refunded.body.status).toBe("refunded");
  });

  it("rejects refunding a payment that was never captured", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);
    const payment = await request(server)
      .post("/payments")
      .set("x-api-key", apiKey)
      .send({ orderId })
      .expect(201);

    await request(server)
      .post(`/payments/${payment.body.id}/refund`)
      .set("x-api-key", apiKey)
      .expect(409);
  });

  it("404s creating a payment for another merchant's order", async () => {
    const server = app.getHttpServer();
    const orderId = await createOrder(server);

    const other = await request(server)
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Other Payment Merchant ${Date.now()}` });
    await request(server)
      .post("/payments")
      .set("x-api-key", other.body.apiKey)
      .send({ orderId })
      .expect(404);
  });
});
