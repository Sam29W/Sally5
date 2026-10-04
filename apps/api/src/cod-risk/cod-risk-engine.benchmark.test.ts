import { describe, expect, it } from "vitest";
import { scoreCodRisk } from "./cod-risk-engine.js";
import { DEFAULT_COD_RISK_CONFIG, type CodRiskInput } from "./cod-risk-types.js";

/**
 * Stage 5's acceptance criterion: "latency budget p95 under 50ms for a scoring call at
 * the local benchmark. Report the number." This is the report — a pure in-process call
 * with no I/O, so it's expected to clear 50ms by orders of magnitude; the point is to
 * actually measure and print it rather than assume.
 */
describe("scoreCodRisk latency benchmark", () => {
  it("p95 is comfortably under the 50ms budget", () => {
    const config = {
      ...DEFAULT_COD_RISK_CONFIG,
      highRtoPincodes: ["400001", "110001"],
      blockedPincodes: ["560001"],
      blockedPhoneHashes: ["hash_x"],
    };
    const input: CodRiskInput = {
      phoneHash: "hash_benchmark",
      isNewPhone: false,
      orderValueCents: 250000,
      pincode: "400001",
      addressQualityScore: 65,
      orderHour: 13,
      recentOrderCount: 2,
    };

    const samples: number[] = [];
    const iterations = 5000;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      scoreCodRisk(input, config);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(iterations * 0.5)]!;
    const p95 = samples[Math.floor(iterations * 0.95)]!;
    const p99 = samples[Math.floor(iterations * 0.99)]!;

    console.log(
      `scoreCodRisk latency over ${iterations} calls: p50=${p50.toFixed(4)}ms p95=${p95.toFixed(4)}ms p99=${p99.toFixed(4)}ms`,
    );

    expect(p95).toBeLessThan(50);
  });
});
