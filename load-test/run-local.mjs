#!/usr/bin/env node
// Lightweight concurrent-fetch load harness — no new dependency, runs against whatever
// API is already listening on BASE_URL. Written because k6 isn't installed in this
// environment (see cod-risk-score.k6.js and docs/decisions/010-stage9-hardening.md);
// this is what actually produced the numbers in STATUS.md's Stage 9 entry.
//
// Usage: node load-test/run-local.mjs [concurrency] [totalRequests]

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN_KEY = process.env.ADMIN_PROVISIONING_KEY ?? "dev-only-admin-provisioning-key";
const CONCURRENCY = Number(process.argv[2] ?? 20);
const TOTAL = Number(process.argv[3] ?? 500);

async function json(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function setup() {
  const merchant = await json("/merchants", {
    method: "POST",
    headers: { "x-admin-provisioning-key": ADMIN_KEY },
    body: JSON.stringify({ name: `Load Test ${Date.now()}` }),
  });
  const cart = await json("/carts", {
    method: "POST",
    headers: { "x-api-key": merchant.apiKey },
    body: JSON.stringify({
      items: [{ sku: "LOAD", name: "Load Item", quantity: 1, unitPriceCents: 1000 }],
    }),
  });
  const order = await json("/orders", {
    method: "POST",
    headers: { "x-api-key": merchant.apiKey, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ cartSessionId: cart.id }),
  });
  return { apiKey: merchant.apiKey, orderId: order.id };
}

async function runBatch(fn, concurrency, total) {
  const durations = [];
  let completed = 0;
  let failed = 0;

  async function worker() {
    while (completed + failed < total) {
      const idx = completed + failed;
      if (idx >= total) return;
      const start = performance.now();
      try {
        await fn();
        durations.push(performance.now() - start);
        completed++;
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  durations.sort((a, b) => a - b);
  return { completed, failed, durations };
}

async function main() {
  console.log(`Setting up fixtures against ${BASE_URL}...`);
  const { apiKey, orderId } = await setup();

  console.log(`\nGET /health — concurrency=${CONCURRENCY}, total=${TOTAL}`);
  const health = await runBatch(() => json("/health"), CONCURRENCY, TOTAL);
  report(health);

  console.log(
    `\nPOST /orders/:id/cod-risk/score (no address, expected 404 — still exercises the real DB round trip) — concurrency=${CONCURRENCY}, total=${TOTAL}`,
  );
  const risk = await runBatch(
    () =>
      fetch(`${BASE_URL}/orders/${orderId}/cod-risk/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ addressId: crypto.randomUUID() }),
      }),
    CONCURRENCY,
    TOTAL,
  );
  report(risk);
}

function report({ completed, failed, durations }) {
  if (durations.length === 0) {
    console.log("  no successful requests");
    return;
  }
  console.log(
    `  completed=${completed} failed=${failed} p50=${percentile(durations, 50).toFixed(2)}ms ` +
      `p95=${percentile(durations, 95).toFixed(2)}ms p99=${percentile(durations, 99).toFixed(2)}ms ` +
      `max=${durations[durations.length - 1].toFixed(2)}ms`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
