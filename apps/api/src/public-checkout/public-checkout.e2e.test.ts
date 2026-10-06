import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@app/config";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";
import { SMS_PROVIDER, type SmsProvider } from "../sms/sms-provider.js";

const ADMIN_KEY = loadConfig().ADMIN_PROVISIONING_KEY;

class CapturingSmsProvider implements SmsProvider {
  lastMessage = "";

  async send(_phone: string, message: string): Promise<void> {
    this.lastMessage = message;
  }

  lastOtp(): string {
    const match = /\d{6}/.exec(this.lastMessage);
    if (!match) throw new Error("no OTP captured");
    return match[0];
  }
}

function freshPhone(): string {
  return `+9199998${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0")}`;
}

describe("Public checkout surface (e2e)", () => {
  let app: INestApplication;
  const sms = new CapturingSmsProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setupMerchantCartOrder(server: import("supertest/types.js").App) {
    const merchant = await request(server)
      .post("/merchants")
      .set("x-admin-provisioning-key", ADMIN_KEY)
      .send({ name: `Public Checkout Test ${randomUUID()}` });
    const apiKey = merchant.body.apiKey as string;
    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({ items: [{ sku: "A", name: "Widget", quantity: 1, unitPriceCents: 1000 }] });
    const order = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id });
    return { apiKey, cartId: cart.body.id as string, orderId: order.body.id as string };
  }

  async function verifiedShopperToken(server: import("supertest/types.js").App): Promise<string> {
    const phone = freshPhone();
    await request(server).post("/auth/otp/request").send({ phone });
    const otp = sms.lastOtp();
    const verify = await request(server).post("/auth/otp/verify").send({ phone, otp });
    return verify.body.accessToken as string;
  }

  it("404s for a cart/order id that doesn't exist", async () => {
    const server = app.getHttpServer();
    await request(server).get(`/public/carts/${randomUUID()}`).expect(404);
    await request(server).get(`/public/orders/${randomUUID()}`).expect(404);
  });

  it("returns the cart and order by id, scoped to exactly that one id", async () => {
    const server = app.getHttpServer();
    const { cartId, orderId } = await setupMerchantCartOrder(server);

    const cart = await request(server).get(`/public/carts/${cartId}`).expect(200);
    expect(cart.body.id).toBe(cartId);
    expect(cart.body.totalCents).toBeGreaterThan(0);

    const order = await request(server).get(`/public/orders/${orderId}`).expect(200);
    expect(order.body).toMatchObject({ id: orderId, status: "created" });
  });

  it("rejects claim without a shopper access token", async () => {
    const server = app.getHttpServer();
    const { orderId } = await setupMerchantCartOrder(server);
    await request(server).post(`/public/orders/${orderId}/claim`).expect(401);
  });

  it("claims an order for the verified shopper, idempotently", async () => {
    const server = app.getHttpServer();
    const { orderId } = await setupMerchantCartOrder(server);
    const token = await verifiedShopperToken(server);

    const first = await request(server)
      .post(`/public/orders/${orderId}/claim`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(first.body.id).toBe(orderId);

    // Same shopper claiming again is a no-op, not an error.
    await request(server)
      .post(`/public/orders/${orderId}/claim`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
  });

  it("rejects a second, different shopper claiming an already-claimed order", async () => {
    const server = app.getHttpServer();
    const { orderId } = await setupMerchantCartOrder(server);
    const firstToken = await verifiedShopperToken(server);
    const secondToken = await verifiedShopperToken(server);

    await request(server)
      .post(`/public/orders/${orderId}/claim`)
      .set("Authorization", `Bearer ${firstToken}`)
      .expect(201);

    await request(server)
      .post(`/public/orders/${orderId}/claim`)
      .set("Authorization", `Bearer ${secondToken}`)
      .expect(409);
  });

  it("creates a prepaid payment for an order via the public surface", async () => {
    const server = app.getHttpServer();
    const { orderId } = await setupMerchantCartOrder(server);

    const res = await request(server)
      .post(`/public/orders/${orderId}/payments`)
      .send({ method: "upi" })
      .expect(201);
    expect(res.body.gateway).toBe("fake");
    expect(res.body.status).toBe("pending");
  });

  it("scores COD risk and confirms COD, end to end, via the public surface", async () => {
    const server = app.getHttpServer();
    const { apiKey, orderId } = await setupMerchantCartOrder(server);
    const token = await verifiedShopperToken(server);

    await request(server)
      .post(`/public/orders/${orderId}/claim`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const address = await request(server)
      .post("/shopper/addresses")
      .set("Authorization", `Bearer ${token}`)
      .send({ line1: "221B Baker Street", city: "Mumbai", state: "MH", pincode: "400001" })
      .expect(201);

    const risk = await request(server)
      .post(`/public/orders/${orderId}/cod-risk-score`)
      .send({ addressId: address.body.id })
      .expect(201);
    expect(risk.body).toHaveProperty("band");
    expect(risk.body).toHaveProperty("action");

    const confirmed = await request(server)
      .post(`/public/orders/${orderId}/confirm-cod`)
      .expect(201);
    expect(confirmed.body.status).toBe("cod_confirmed");

    // The merchant-facing view agrees with what the public surface just did.
    const merchantView = await request(server)
      .get(`/orders/${orderId}`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(merchantView.body.status).toBe("cod_confirmed");
  });
});
