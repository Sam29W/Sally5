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

describe("Auth flow (e2e)", () => {
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

  function freshPhone(): string {
    return `+9199999${Math.floor(Math.random() * 100000)
      .toString()
      .padStart(5, "0")}`;
  }

  it("completes request-otp -> verify -> refresh -> logout", async () => {
    const server = app.getHttpServer();
    const phone = freshPhone();

    await request(server).post("/auth/otp/request").send({ phone }).expect(200);
    const otp = sms.lastOtp();

    const verifyRes = await request(server)
      .post("/auth/otp/verify")
      .send({ phone, otp })
      .expect(200);
    const { accessToken, refreshToken } = verifyRes.body;
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    // A used OTP cannot be replayed.
    await request(server).post("/auth/otp/verify").send({ phone, otp }).expect(401);

    const refreshRes = await request(server)
      .post("/auth/refresh")
      .send({ refreshToken })
      .expect(200);
    const rotatedRefreshToken = refreshRes.body.refreshToken;
    expect(rotatedRefreshToken).not.toBe(refreshToken);

    // Reusing the original (already-rotated) refresh token must fail and kill the session.
    await request(server).post("/auth/refresh").send({ refreshToken }).expect(401);
    await request(server)
      .post("/auth/refresh")
      .send({ refreshToken: rotatedRefreshToken })
      .expect(401);
  });

  it("rejects an incorrect OTP and enforces the resend cooldown", async () => {
    const server = app.getHttpServer();
    const phone = freshPhone();

    await request(server).post("/auth/otp/request").send({ phone }).expect(200);
    await request(server).post("/auth/otp/verify").send({ phone, otp: "000000" }).expect(401);
    await request(server).post("/auth/otp/request").send({ phone }).expect(429);
  });

  it("locks out with 429 after exceeding max verify attempts", async () => {
    const server = app.getHttpServer();
    const phone = freshPhone();

    await request(server).post("/auth/otp/request").send({ phone }).expect(200);
    for (let i = 0; i < 5; i++) {
      await request(server).post("/auth/otp/verify").send({ phone, otp: "000000" }).expect(401);
    }
    await request(server).post("/auth/otp/verify").send({ phone, otp: "000000" }).expect(429);
  });

  it("rejects malformed refresh tokens with 401", async () => {
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: "not-a-real-token" })
      .expect(401);
  });

  it("rejects requests with unknown fields (whitelist validation)", async () => {
    await request(app.getHttpServer())
      .post("/auth/otp/request")
      .send({ phone: freshPhone(), extra: "field" })
      .expect(400);
  });

  it("logout revokes the session so refresh then fails", async () => {
    const server = app.getHttpServer();
    const phone = freshPhone();

    await request(server).post("/auth/otp/request").send({ phone }).expect(200);
    const otp = sms.lastOtp();
    const { body: pair } = await request(server)
      .post("/auth/otp/verify")
      .send({ phone, otp })
      .expect(200);

    await request(server)
      .post("/auth/logout")
      .send({ refreshToken: pair.refreshToken })
      .expect(204);
    await request(server)
      .post("/auth/refresh")
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
  });
});
