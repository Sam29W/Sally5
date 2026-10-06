import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";

describe("Cart and order flow (e2e)", () => {
  let app: INestApplication;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();

    const merchant = await request(app.getHttpServer())
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Order Test Merchant ${Date.now()}` });
    apiKey = merchant.body.apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a cart with a computed quote, and can fetch it back by id", async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "A", name: "Widget", quantity: 2, unitPriceCents: 1000 }] })
      .expect(201);
    expect(res.body.subtotalCents).toBe(2000);
    expect(res.body.totalCents).toBeGreaterThan(res.body.subtotalCents);

    const fetched = await request(server)
      .get(`/carts/${res.body.id}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(fetched.body.id).toBe(res.body.id);
  });

  it("404s fetching a cart that doesn't exist, and 404s another merchant's cart", async () => {
    const server = app.getHttpServer();
    await request(server)
      .get("/carts/00000000-0000-0000-0000-000000000000")
      .set("x-api-key", apiKey)
      .expect(404);

    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "Z", name: "Isolated", quantity: 1, unitPriceCents: 100 }] })
      .expect(201);
    const otherMerchant = await request(server)
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Other Cart Merchant ${Date.now()}` });

    await request(server)
      .get(`/carts/${cart.body.id}`)
      .set("x-api-key", otherMerchant.body.apiKey)
      .expect(404);
  });

  it("creates an order from a cart idempotently via the Idempotency-Key header", async () => {
    const server = app.getHttpServer();
    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "B", name: "Gadget", quantity: 1, unitPriceCents: 5000 }] })
      .expect(201);

    const idempotencyKey = randomUUID();
    const first = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", idempotencyKey)
      .send({ cartSessionId: cart.body.id })
      .expect(201);
    expect(first.body.status).toBe("created");

    const second = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", idempotencyKey)
      .send({ cartSessionId: cart.body.id })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const fetched = await request(server)
      .get(`/orders/${first.body.id}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(fetched.body.id).toBe(first.body.id);
  });

  it("404s fetching another merchant's order", async () => {
    const server = app.getHttpServer();
    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "E", name: "Thing", quantity: 1, unitPriceCents: 100 }] })
      .expect(201);
    const order = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id })
      .expect(201);

    const otherMerchant = await request(server)
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Other Order Merchant ${Date.now()}` });
    await request(server)
      .get(`/orders/${order.body.id}`)
      .set("x-api-key", otherMerchant.body.apiKey)
      .expect(404);
  });

  it("requires an Idempotency-Key header", async () => {
    const server = app.getHttpServer();
    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "C", name: "Thing", quantity: 1, unitPriceCents: 100 }] })
      .expect(201);

    await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .send({ cartSessionId: cart.body.id })
      .expect(400);
  });

  it("walks an order through its full legal lifecycle and rejects an illegal jump", async () => {
    const server = app.getHttpServer();
    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "D", name: "Thing", quantity: 1, unitPriceCents: 100 }] })
      .expect(201);
    const order = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id })
      .expect(201);

    await request(server)
      .post(`/orders/${order.body.id}/transition`)
      .set("x-api-key", apiKey)
      .send({ to: "delivered" })
      .expect(409);

    await request(server)
      .post(`/orders/${order.body.id}/transition`)
      .set("x-api-key", apiKey)
      .send({ to: "payment_pending" })
      .expect(200);
    await request(server)
      .post(`/orders/${order.body.id}/transition`)
      .set("x-api-key", apiKey)
      .send({ to: "paid" })
      .expect(200);
    await request(server)
      .post(`/orders/${order.body.id}/transition`)
      .set("x-api-key", apiKey)
      .send({ to: "fulfilled" })
      .expect(200);
    const delivered = await request(server)
      .post(`/orders/${order.body.id}/transition`)
      .set("x-api-key", apiKey)
      .send({ to: "delivered" })
      .expect(200);
    expect(delivered.body.status).toBe("delivered");

    // Terminal — nothing is legal from here.
    await request(server)
      .post(`/orders/${order.body.id}/transition`)
      .set("x-api-key", apiKey)
      .send({ to: "rto" })
      .expect(409);
  });
});
