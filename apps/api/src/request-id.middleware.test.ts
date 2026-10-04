import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER, requestIdMiddleware } from "./request-id.middleware.js";

function buildApp() {
  const app = express();
  app.use(requestIdMiddleware);
  app.get("/echo", (req, res) => {
    res.json({ headerSeenByHandler: req.headers[REQUEST_ID_HEADER] });
  });
  return app;
}

describe("requestIdMiddleware", () => {
  it("generates a request id when none is supplied", async () => {
    const res = await request(buildApp()).get("/echo");
    const id = res.headers[REQUEST_ID_HEADER];
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(res.body.headerSeenByHandler).toBe(id);
  });

  it("echoes back a caller-supplied request id instead of generating one", async () => {
    const res = await request(buildApp()).get("/echo").set(REQUEST_ID_HEADER, "caller-id-123");
    expect(res.headers[REQUEST_ID_HEADER]).toBe("caller-id-123");
    expect(res.body.headerSeenByHandler).toBe("caller-id-123");
  });

  it("generates a fresh id for an empty supplied header", async () => {
    const res = await request(buildApp()).get("/echo").set(REQUEST_ID_HEADER, "");
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
