import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";
import { SMS_PROVIDER, type SmsProvider } from "../sms/sms-provider.js";

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

describe("COD risk engine (e2e)", () => {
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

  async function createMerchant(name: string): Promise<{ merchantId: string; apiKey: string }> {
    const res = await request(app.getHttpServer()).post("/merchants").send({ name });
    return res.body;
  }

  async function loginShopper(server: Parameters<typeof request>[0]): Promise<string> {
    const phone = `+9199991${Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, "0")}`;
    await request(server).post("/auth/otp/request").send({ phone }).expect(200);
    const otp = sms.lastOtp();
    const res = await request(server).post("/auth/otp/verify").send({ phone, otp }).expect(200);
    return res.body.accessToken;
  }

  async function setUpOrderWithAddress(
    server: Parameters<typeof request>[0],
    apiKey: string,
    opts: { unitPriceCents?: number; pincode?: string; line1?: string } = {},
  ): Promise<{ orderId: string; addressId: string }> {
    const accessToken = await loginShopper(server);
    const addr = await request(server)
      .post("/shopper/addresses")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        line1: opts.line1 ?? "221B Baker Colony Road",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: opts.pincode ?? "400001",
      })
      .expect(201);

    // The shopper has to log in via the merchant's own checkout to attach shopperId to a
    // cart; simplest path here: create the cart/order directly (shopperId is optional at
    // creation), then attach via a second address share isn't needed — instead we drive
    // shopperId through the cart body directly.
    const shopperExport = await request(server)
      .get("/shopper/me/export")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const shopperId = shopperExport.body.id;

    const cart = await request(server)
      .post("/carts")
      .set("x-api-key", apiKey)
      .send({
        shopperId,
        items: [
          { sku: "A", name: "Widget", quantity: 1, unitPriceCents: opts.unitPriceCents ?? 1000 },
        ],
      })
      .expect(201);
    const order = await request(server)
      .post("/orders")
      .set("x-api-key", apiKey)
      .set("Idempotency-Key", randomUUID())
      .send({ cartSessionId: cart.body.id })
      .expect(201);

    return { orderId: order.body.id, addressId: addr.body.id };
  }

  it("scores a clean order as low risk and persists the decision for audit", async () => {
    const server = app.getHttpServer();
    const { apiKey } = await createMerchant(`COD Risk Test ${Date.now()}`);
    const { orderId, addressId } = await setUpOrderWithAddress(server, apiKey);

    const scored = await request(server)
      .post(`/orders/${orderId}/cod-risk/score`)
      .set("x-api-key", apiKey)
      .send({ addressId })
      .expect(201);
    expect(scored.body.band).toBe("low");
    expect(scored.body.action).toBe("allow");

    const history = await request(server)
      .get(`/orders/${orderId}/cod-risk`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].band).toBe("low");
  });

  it("respects a merchant's own configured blocklist and forces block", async () => {
    const server = app.getHttpServer();
    const { apiKey } = await createMerchant(`COD Risk Blocklist ${Date.now()}`);
    const { orderId, addressId } = await setUpOrderWithAddress(server, apiKey, {
      pincode: "560001",
    });

    await request(server)
      .put("/merchants/cod-risk-config")
      .set("x-api-key", apiKey)
      .send({ blockedPincodes: ["560001"] })
      .expect(200);

    const scored = await request(server)
      .post(`/orders/${orderId}/cod-risk/score`)
      .set("x-api-key", apiKey)
      .send({ addressId })
      .expect(201);
    expect(scored.body.action).toBe("block");
    expect(scored.body.reasons).toContain("merchant blocklist match");
  });

  it("merchant A's blocklist has zero effect on merchant B's scoring of the same pincode", async () => {
    const server = app.getHttpServer();
    const merchantA = await createMerchant(`COD Risk A ${Date.now()}`);
    const merchantB = await createMerchant(`COD Risk B ${Date.now()}`);

    await request(server)
      .put("/merchants/cod-risk-config")
      .set("x-api-key", merchantA.apiKey)
      .send({ blockedPincodes: ["110001"] })
      .expect(200);

    const { orderId, addressId } = await setUpOrderWithAddress(server, merchantB.apiKey, {
      pincode: "110001",
    });
    const scored = await request(server)
      .post(`/orders/${orderId}/cod-risk/score`)
      .set("x-api-key", merchantB.apiKey)
      .send({ addressId })
      .expect(201);

    // Not blocked — merchant B never configured this pincode as blocked, and merchant A's
    // config is never consulted for merchant B's orders.
    expect(scored.body.action).not.toBe("block");
    expect(scored.body.reasons).not.toContain("merchant blocklist match");
  });

  it("404s scoring another merchant's order", async () => {
    const server = app.getHttpServer();
    const owner = await createMerchant(`COD Risk Owner ${Date.now()}`);
    const intruder = await createMerchant(`COD Risk Intruder ${Date.now()}`);
    const { orderId, addressId } = await setUpOrderWithAddress(server, owner.apiKey);

    await request(server)
      .post(`/orders/${orderId}/cod-risk/score`)
      .set("x-api-key", intruder.apiKey)
      .send({ addressId })
      .expect(404);
  });

  it("records a delivered/RTO outcome for an order", async () => {
    const server = app.getHttpServer();
    const { apiKey } = await createMerchant(`COD Risk Outcome ${Date.now()}`);
    const { orderId } = await setUpOrderWithAddress(server, apiKey);

    await request(server)
      .post(`/orders/${orderId}/cod-risk/outcome`)
      .set("x-api-key", apiKey)
      .send({ delivered: false })
      .expect(201);
  });

  it("GET/PUT merchants/cod-risk-config round-trips a partial update", async () => {
    const server = app.getHttpServer();
    const { apiKey } = await createMerchant(`COD Risk Config ${Date.now()}`);

    const before = await request(server)
      .get("/merchants/cod-risk-config")
      .set("x-api-key", apiKey)
      .expect(200);
    expect(before.body.velocityThreshold).toBe(3);

    await request(server)
      .put("/merchants/cod-risk-config")
      .set("x-api-key", apiKey)
      .send({ velocityThreshold: 7 })
      .expect(200);

    const after = await request(server)
      .get("/merchants/cod-risk-config")
      .set("x-api-key", apiKey)
      .expect(200);
    expect(after.body.velocityThreshold).toBe(7);
  });
});
