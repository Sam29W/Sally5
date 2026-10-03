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

async function loginAsFreshShopper(
  server: Parameters<typeof request>[0],
  sms: CapturingSmsProvider,
): Promise<{ accessToken: string }> {
  const phone = `+9199998${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0")}`;
  await request(server).post("/auth/otp/request").send({ phone }).expect(200);
  const otp = sms.lastOtp();
  const res = await request(server).post("/auth/otp/verify").send({ phone, otp }).expect(200);
  return { accessToken: res.body.accessToken };
}

describe("Address book and shopper data rights (e2e)", () => {
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

  it("rejects address requests without a bearer token", async () => {
    await request(app.getHttpServer()).get("/shopper/addresses").expect(401);
  });

  it("creates, lists, updates, defaults, and deletes an address", async () => {
    const server = app.getHttpServer();
    const { accessToken } = await loginAsFreshShopper(server, sms);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const created = await request(server)
      .post("/shopper/addresses")
      .set(auth)
      .send({
        line1: "221B Baker Colony Road",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      })
      .expect(201);
    expect(created.body.isDefault).toBe(true);
    expect(created.body.qualityScore).toBe(95);

    const second = await request(server)
      .post("/shopper/addresses")
      .set(auth)
      .send({ line1: "42 Second Street", city: "Pune", state: "Maharashtra", pincode: "411001" })
      .expect(201);
    expect(second.body.isDefault).toBe(false);

    const list = await request(server).get("/shopper/addresses").set(auth).expect(200);
    expect(list.body).toHaveLength(2);

    await request(server)
      .post(`/shopper/addresses/${second.body.id}/default`)
      .set(auth)
      .expect(201);
    const afterDefault = await request(server).get("/shopper/addresses").set(auth).expect(200);
    const first = afterDefault.body.find((a: { id: string }) => a.id === created.body.id);
    const sec = afterDefault.body.find((a: { id: string }) => a.id === second.body.id);
    expect(first.isDefault).toBe(false);
    expect(sec.isDefault).toBe(true);

    await request(server).delete(`/shopper/addresses/${created.body.id}`).set(auth).expect(204);
    const afterDelete = await request(server).get("/shopper/addresses").set(auth).expect(200);
    expect(afterDelete.body).toHaveLength(1);
  });

  it("rejects an invalid pincode with 400", async () => {
    const server = app.getHttpServer();
    const { accessToken } = await loginAsFreshShopper(server, sms);
    await request(server)
      .post("/shopper/addresses")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ line1: "Some Street", city: "City", state: "State", pincode: "12" })
      .expect(400);
  });

  it("prevents a shopper from reading, updating, or deleting another shopper's address", async () => {
    const server = app.getHttpServer();
    const shopperA = await loginAsFreshShopper(server, sms);
    const shopperB = await loginAsFreshShopper(server, sms);

    const addr = await request(server)
      .post("/shopper/addresses")
      .set("Authorization", `Bearer ${shopperA.accessToken}`)
      .send({ line1: "A's Street", city: "Delhi", state: "Delhi", pincode: "110001" })
      .expect(201);

    const bAuth = { Authorization: `Bearer ${shopperB.accessToken}` };
    await request(server)
      .patch(`/shopper/addresses/${addr.body.id}`)
      .set(bAuth)
      .send({ line1: "Hijacked", city: "Delhi", state: "Delhi", pincode: "110001" })
      .expect(404);
    await request(server).delete(`/shopper/addresses/${addr.body.id}`).set(bAuth).expect(404);
    await request(server).post(`/shopper/addresses/${addr.body.id}/default`).set(bAuth).expect(404);

    // Untouched for A.
    const listA = await request(server)
      .get("/shopper/addresses")
      .set("Authorization", `Bearer ${shopperA.accessToken}`)
      .expect(200);
    expect(listA.body.find((a: { id: string }) => a.id === addr.body.id).line1).toBe("A's Street");
  });

  it("exports and then deletes a shopper's data, including addresses and consents", async () => {
    const server = app.getHttpServer();
    const { accessToken } = await loginAsFreshShopper(server, sms);
    const auth = { Authorization: `Bearer ${accessToken}` };

    await request(server)
      .post("/shopper/addresses")
      .set(auth)
      .send({ line1: "Export Me Street", city: "Chennai", state: "Tamil Nadu", pincode: "600001" })
      .expect(201);

    const exported = await request(server).get("/shopper/me/export").set(auth).expect(200);
    expect(exported.body.phone).toMatch(/^\+91/);
    expect(exported.body.addresses).toHaveLength(1);
    expect(exported.body.consents.some((c: { purpose: string }) => c.purpose === "login")).toBe(
      true,
    );

    await request(server).delete("/shopper/me").set(auth).expect(204);

    // The shopper's own access token still verifies (JWT isn't DB-checked — it's stateless),
    // but every DB-backed record about them is gone: exporting now 404s.
    await request(server).get("/shopper/me/export").set(auth).expect(404);
  });
});
