import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@app/config";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";

const ADMIN_KEY = loadConfig().ADMIN_PROVISIONING_KEY;

describe("POST /merchants admin provisioning gate (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects merchant creation with no admin provisioning key", async () => {
    await request(app.getHttpServer())
      .post("/merchants")
      .send({ name: `Gate Test ${randomUUID()}` })
      .expect(401);
  });

  it("rejects merchant creation with the wrong admin provisioning key", async () => {
    await request(app.getHttpServer())
      .post("/merchants")
      .set("x-admin-provisioning-key", "definitely-not-the-real-key")
      .send({ name: `Gate Test ${randomUUID()}` })
      .expect(401);
  });

  it("creates a merchant when the correct admin provisioning key is presented", async () => {
    const res = await request(app.getHttpServer())
      .post("/merchants")
      .set("x-admin-provisioning-key", ADMIN_KEY)
      .send({ name: `Gate Test ${randomUUID()}` })
      .expect(201);
    expect(res.body.merchantId).toBeTruthy();
    expect(res.body.apiKey).toBeTruthy();
  });
});
