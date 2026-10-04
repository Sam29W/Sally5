import { loadConfig } from "@app/config";
import { describe, expect, it, vi } from "vitest";
import { ReconciliationScheduler } from "./reconciliation-scheduler.service.js";
import type { ReconciliationService } from "./reconciliation.service.js";

const config = loadConfig();

function fakeReconciliationService(impl: () => Promise<number>): ReconciliationService {
  return { reconcilePending: impl } as unknown as ReconciliationService;
}

describe("ReconciliationScheduler", () => {
  it("runOnce delegates to reconcilePending and returns its count", async () => {
    const service = fakeReconciliationService(async () => 3);
    const scheduler = new ReconciliationScheduler(service, config);
    expect(await scheduler.runOnce()).toBe(3);
  });

  it("runOnce swallows a failure and returns 0 instead of throwing", async () => {
    const service = fakeReconciliationService(async () => {
      throw new Error("db unreachable");
    });
    const scheduler = new ReconciliationScheduler(service, config);
    await expect(scheduler.runOnce()).resolves.toBe(0);
  });

  it("start() schedules recurring runs; stop() cancels them; both are idempotent", () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => 0);
    const service = fakeReconciliationService(run);
    const scheduler = new ReconciliationScheduler(service, {
      ...config,
      RECONCILIATION_INTERVAL_MS: 100,
    });

    expect(() => scheduler.stop()).not.toThrow();
    scheduler.start();
    scheduler.start(); // no-op, not a second timer
    vi.advanceTimersByTime(250);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);

    scheduler.stop();
    scheduler.stop(); // no-op
    const callsAtStop = run.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(run.mock.calls.length).toBe(callsAtStop);

    vi.useRealTimers();
  });

  it("onModuleInit does not start a timer when NODE_ENV=test", () => {
    const service = fakeReconciliationService(async () => 0);
    const scheduler = new ReconciliationScheduler(service, { ...config, NODE_ENV: "test" });
    scheduler.onModuleInit();
    expect(() => scheduler.onModuleDestroy()).not.toThrow();
  });
});
