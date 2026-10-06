import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.CHECKOUT_WEB_BASE_URL ?? "http://localhost:4173",
    trace: "retain-on-failure",
  },
});
