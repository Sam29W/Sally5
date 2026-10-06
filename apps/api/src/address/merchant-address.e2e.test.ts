import { Test } from "@nestjs/testing";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
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

describe("Merchant-facing shared address read is consent-gated (e2e)", () => {
  let app: INestApplication;
  const sms = new CapturingSmsProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(sms)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createMerchant(name: string): Promise<{ merchantId: string; apiKey: string }> {
    const res = await request(app.getHttpServer())
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name });
    return res.body;
  }

  async function loginShopper(): Promise<{ accessToken: string }> {
    const phone = `+9198877${Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, "0")}`;
    await request(app.getHttpServer()).post("/auth/otp/request").send({ phone }).expect(200);
    const otp = sms.lastOtp();
    const res = await request(app.getHttpServer())
      .post("/auth/otp/verify")
      .send({ phone, otp })
      .expect(200);
    return { accessToken: res.body.accessToken };
  }

  it("a merchant with no consent sees an empty list, not an error", async () => {
    const server = app.getHttpServer();
    const shopper = await loginShopper();
    await request(server)
      .post("/shopper/addresses")
      .set("Authorization", `Bearer ${shopper.accessToken}`)
      .send({ line1: "Consent St", city: "Mumbai", state: "Maharashtra", pincode: "400001" })
      .expect(201);
    const shopperId = await shopperIdFromAccessToken(server, shopper.accessToken);

    const { apiKey } = await createMerchant(`No Consent ${Date.now()}`);
    const res = await request(server)
      .get(`/merchants/shoppers/${shopperId}/addresses`)
      .set("x-api-key", apiKey)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it("a merchant can read an address only after the shopper grants consent, and no other merchant can", async () => {
    const server = app.getHttpServer();
    const shopper = await loginShopper();
    const shopperAuth = { Authorization: `Bearer ${shopper.accessToken}` };

    const addr = await request(server)
      .post("/shopper/addresses")
      .set(shopperAuth)
      .send({ line1: "Shared St", city: "Pune", state: "Maharashtra", pincode: "411001" })
      .expect(201);
    const shopperId = await shopperIdFromAccessToken(server, shopper.accessToken);

    const consented = await createMerchant(`Consented ${Date.now()}`);
    const notConsented = await createMerchant(`Not Consented ${Date.now()}`);

    // Before consent: neither merchant can see it.
    await request(server)
      .get(`/merchants/shoppers/${shopperId}/addresses`)
      .set("x-api-key", consented.apiKey)
      .expect(200)
      .then((res) => expect(res.body).toEqual([]));

    await request(server)
      .post(`/shopper/addresses/${addr.body.id}/share`)
      .set(shopperAuth)
      .send({ merchantId: consented.merchantId })
      .expect(201);

    const afterConsent = await request(server)
      .get(`/merchants/shoppers/${shopperId}/addresses`)
      .set("x-api-key", consented.apiKey)
      .expect(200);
    expect(afterConsent.body).toHaveLength(1);
    expect(afterConsent.body[0].id).toBe(addr.body.id);
    expect(afterConsent.body[0].line1).toBe("Shared St");

    // The merchant that was never granted consent still sees nothing, even though the
    // address now has at least one share — proving the gate is per-merchant, not global.
    const stillNothing = await request(server)
      .get(`/merchants/shoppers/${shopperId}/addresses`)
      .set("x-api-key", notConsented.apiKey)
      .expect(200);
    expect(stillNothing.body).toEqual([]);
  });

  it("requires a valid API key", async () => {
    await request(app.getHttpServer()).get("/merchants/shoppers/any-id/addresses").expect(401);
  });

  /** The export endpoint is the one place a shopperId is exposed to the shopper themselves
   * without a separate lookup table — reuse it here rather than adding a test-only route. */
  async function shopperIdFromAccessToken(
    server: Parameters<typeof request>[0],
    accessToken: string,
  ): Promise<string> {
    const res = await request(server)
      .get("/shopper/me/export")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    return res.body.id;
  }
});
