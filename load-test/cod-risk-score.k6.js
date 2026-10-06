import http from "k6/http";
import { check } from "k6";

/**
 * Real k6 script, deliberately not run in this environment — no k6 binary is installed
 * here (see STATUS.md / decision 010). Kept as the real deliverable for a CI/staging
 * environment that does have k6; `load-test/run-local.mjs` in this same directory is
 * what actually produced the latency numbers recorded in STATUS.md, using a lightweight
 * hand-rolled concurrent-fetch harness instead.
 *
 * Usage once k6 is available:
 *   MERCHANT_API_KEY=... ORDER_ID=... ADDRESS_ID=... k6 run load-test/cod-risk-score.k6.js
 */
export const options = {
  scenarios: {
    cod_risk_score: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 20 },
        { duration: "30s", target: 50 },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<200"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const ORDER_ID = __ENV.ORDER_ID;
const ADDRESS_ID = __ENV.ADDRESS_ID;
const MERCHANT_API_KEY = __ENV.MERCHANT_API_KEY;

export default function () {
  const res = http.post(
    `${BASE_URL}/orders/${ORDER_ID}/cod-risk/score`,
    JSON.stringify({ addressId: ADDRESS_ID }),
    { headers: { "Content-Type": "application/json", "x-api-key": MERCHANT_API_KEY } },
  );
  check(res, {
    "status is 201": (r) => r.status === 201,
    "has a band": (r) => JSON.parse(r.body).band !== undefined,
  });
}
