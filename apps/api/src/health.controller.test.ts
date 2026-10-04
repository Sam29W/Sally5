import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { requestIdMiddleware, REQUEST_ID_HEADER } from "./request-id.middleware.js";

describe("HealthController", () => {
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

  it("GET /health returns ok status with a request id", async () => {
    const server = app.getHttpServer();
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.timestamp).toBe("string");
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("echoes back a caller-supplied request id end-to-end through the real app", async () => {
    const res = await request(app.getHttpServer())
      .get("/health")
      .set(REQUEST_ID_HEADER, "test-request-id-42");
    expect(res.headers[REQUEST_ID_HEADER]).toBe("test-request-id-42");
  });
});
