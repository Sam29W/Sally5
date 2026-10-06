import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { requestIdMiddleware } from "../request-id.middleware.js";

describe("Webhook tenant isolation (e2e)", () => {
  let app: INestApplication;
  let apiKeyA: string;
  let apiKeyB: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(requestIdMiddleware);
    await app.init();

    const server = app.getHttpServer();
    const merchantA = await request(server)
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Merchant A ${Date.now()}` });
    const merchantB = await request(server)
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Merchant B ${Date.now()}` });
    apiKeyA = merchantA.body.apiKey;
    apiKeyB = merchantB.body.apiKey;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates a merchant with a usable API key", async () => {
    expect(apiKeyA).toBeTruthy();
    expect(apiKeyA).not.toBe(apiKeyB);
  });

  it("rejects requests with no API key or an invalid one", async () => {
    const server = app.getHttpServer();
    await request(server).get("/webhooks").expect(401);
    await request(server).get("/webhooks").set("x-api-key", "bogus.key").expect(401);
  });

  it("lets a merchant register and list only its own webhook endpoints", async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post("/webhooks")
      .set("x-api-key", apiKeyA)
      .send({ url: "https://a.example.com/hook" })
      .expect(201);
    expect(created.body.signingSecret).toBeTruthy();

    const listA = await request(server).get("/webhooks").set("x-api-key", apiKeyA).expect(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].id).toBe(created.body.id);

    const listB = await request(server).get("/webhooks").set("x-api-key", apiKeyB).expect(200);
    expect(listB.body).toHaveLength(0);
  });

  it("prevents a merchant from deleting another merchant's webhook endpoint", async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post("/webhooks")
      .set("x-api-key", apiKeyA)
      .send({ url: "https://a.example.com/hook-2" })
      .expect(201);

    // Merchant B, holding a valid key for a DIFFERENT merchant, cannot delete A's endpoint.
    await request(server)
      .delete(`/webhooks/${created.body.id}`)
      .set("x-api-key", apiKeyB)
      .expect(404);

    // It still exists for A.
    const listA = await request(server).get("/webhooks").set("x-api-key", apiKeyA).expect(200);
    expect(listA.body.some((w: { id: string }) => w.id === created.body.id)).toBe(true);

    // A can delete its own.
    await request(server)
      .delete(`/webhooks/${created.body.id}`)
      .set("x-api-key", apiKeyA)
      .expect(204);
  });

  it("rotating an API key immediately revokes the old one", async () => {
    const server = app.getHttpServer();
    const merchant = await request(server)
      .post("/merchants")
      .set("x-admin-provisioning-key", "dev-only-admin-provisioning-key")
      .send({ name: `Merchant Rotate ${Date.now()}` });
    const originalKey = merchant.body.apiKey;

    await request(server).get("/webhooks").set("x-api-key", originalKey).expect(200);

    const rotated = await request(server)
      .post("/merchants/api-keys/rotate")
      .set("x-api-key", originalKey)
      .expect(201);
    const newKey = rotated.body.apiKey;

    await request(server).get("/webhooks").set("x-api-key", originalKey).expect(401);
    await request(server).get("/webhooks").set("x-api-key", newKey).expect(200);
  });
});
