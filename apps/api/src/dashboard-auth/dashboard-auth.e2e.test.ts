import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";

describe("Dashboard auth (e2e)", () => {
  let app: INestApplication;
  let apiKey: string;

  async function freshMerchantApiKey(): Promise<string> {
    const merchant = await request(app.getHttpServer())
      .post("/merchants")
      .send({ name: `Dashboard Auth Merchant ${randomUUID()}` });
    return merchant.body.apiKey;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    apiKey = await freshMerchantApiKey();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects bootstrap without a valid API key", async () => {
    await request(app.getHttpServer())
      .post("/dashboard-auth/bootstrap")
      .send({ email: `owner-${randomUUID()}@example.com`, password: "correct-horse-battery" })
      .expect(401);
  });

  it("bootstraps the first owner, then rejects a second bootstrap for the same merchant", async () => {
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/dashboard-auth/bootstrap")
      .set("x-api-key", apiKey)
      .send({ email, password: "correct-horse-battery" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/dashboard-auth/bootstrap")
      .set("x-api-key", apiKey)
      .send({ email: `second-${randomUUID()}@example.com`, password: "correct-horse-battery" })
      .expect(409);
  });

  it("logs the owner in and returns their profile via /me", async () => {
    const freshKey = await freshMerchantApiKey();
    const email = `owner-${randomUUID()}@example.com`;
    const password = "correct-horse-battery";
    await request(app.getHttpServer())
      .post("/dashboard-auth/bootstrap")
      .set("x-api-key", freshKey)
      .send({ email, password })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post("/dashboard-auth/login")
      .send({ email, password })
      .expect(201);
    expect(login.body.accessToken).toBeTruthy();

    const me = await request(app.getHttpServer())
      .get("/dashboard-auth/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email, role: "owner" });
  });

  it("rejects login with the wrong password", async () => {
    const freshKey = await freshMerchantApiKey();
    const email = `owner-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/dashboard-auth/bootstrap")
      .set("x-api-key", freshKey)
      .send({ email, password: "correct-horse-battery" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/dashboard-auth/login")
      .send({ email, password: "wrong-password-entirely" })
      .expect(401);
  });

  it("lets an owner invite an ops user, who can then log in with their own role", async () => {
    const freshKey = await freshMerchantApiKey();
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const ownerPassword = "correct-horse-battery";
    await request(app.getHttpServer())
      .post("/dashboard-auth/bootstrap")
      .set("x-api-key", freshKey)
      .send({ email: ownerEmail, password: ownerPassword })
      .expect(201);
    const ownerLogin = await request(app.getHttpServer())
      .post("/dashboard-auth/login")
      .send({ email: ownerEmail, password: ownerPassword });
    const ownerToken = ownerLogin.body.accessToken;

    const opsEmail = `ops-${randomUUID()}@example.com`;
    const opsPassword = "another-strong-password";
    await request(app.getHttpServer())
      .post("/dashboard-auth/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: opsEmail, password: opsPassword, role: "ops" })
      .expect(201);

    const opsLogin = await request(app.getHttpServer())
      .post("/dashboard-auth/login")
      .send({ email: opsEmail, password: opsPassword })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get("/dashboard-auth/me")
      .set("Authorization", `Bearer ${opsLogin.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: opsEmail, role: "ops" });
  });

  it("rejects a non-owner inviting another user", async () => {
    const freshKey = await freshMerchantApiKey();
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const ownerPassword = "correct-horse-battery";
    await request(app.getHttpServer())
      .post("/dashboard-auth/bootstrap")
      .set("x-api-key", freshKey)
      .send({ email: ownerEmail, password: ownerPassword })
      .expect(201);
    const ownerLogin = await request(app.getHttpServer())
      .post("/dashboard-auth/login")
      .send({ email: ownerEmail, password: ownerPassword });

    const readonlyEmail = `ro-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/dashboard-auth/users")
      .set("Authorization", `Bearer ${ownerLogin.body.accessToken}`)
      .send({ email: readonlyEmail, password: "yet-another-password", role: "readonly" })
      .expect(201);
    const readonlyLogin = await request(app.getHttpServer())
      .post("/dashboard-auth/login")
      .send({ email: readonlyEmail, password: "yet-another-password" });

    await request(app.getHttpServer())
      .post("/dashboard-auth/users")
      .set("Authorization", `Bearer ${readonlyLogin.body.accessToken}`)
      .send({
        email: `blocked-${randomUUID()}@example.com`,
        password: "irrelevant-pw",
        role: "ops",
      })
      .expect(403);
  });

  it("rejects a request with no bearer token and one with a garbage token", async () => {
    await request(app.getHttpServer()).get("/dashboard-auth/me").expect(401);
    await request(app.getHttpServer())
      .get("/dashboard-auth/me")
      .set("Authorization", "Bearer not-a-real-token")
      .expect(401);
  });
});
