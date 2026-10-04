import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { applyTrustProxy } from "./trust-proxy.js";

function buildApp(hops: number) {
  const app = express();
  applyTrustProxy(app, hops);
  app.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe("applyTrustProxy", () => {
  it("ignores X-Forwarded-For by default (hops=0) — the safe default", async () => {
    const app = buildApp(0);
    const res = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.5");
    expect(res.body.ip).not.toBe("203.0.113.5");
  });

  it("spoofing a different X-Forwarded-For per request still resolves to the same real IP when hops=0", async () => {
    const app = buildApp(0);
    const res1 = await request(app).get("/ip").set("X-Forwarded-For", "1.1.1.1");
    const res2 = await request(app).get("/ip").set("X-Forwarded-For", "2.2.2.2");
    // Both requests come from the same test socket — proving the header was ignored for
    // deriving req.ip, which is exactly what per-IP rate limiting depends on to not be
    // trivially bypassable by an attacker who can set arbitrary headers.
    expect(res1.body.ip).toBe(res2.body.ip);
  });

  it("trusts X-Forwarded-For when configured for exactly one proxy hop (hops=1)", async () => {
    const app = buildApp(1);
    const res = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.5");
    expect(res.body.ip).toBe("203.0.113.5");
  });

  it("with hops=1, distinct X-Forwarded-For values resolve to distinct client IPs", async () => {
    const app = buildApp(1);
    const res1 = await request(app).get("/ip").set("X-Forwarded-For", "203.0.113.5");
    const res2 = await request(app).get("/ip").set("X-Forwarded-For", "198.51.100.7");
    expect(res1.body.ip).not.toBe(res2.body.ip);
  });
});
