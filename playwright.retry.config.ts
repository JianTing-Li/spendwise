import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", testMatch: "retry.spec.ts", workers: 1,
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: { command: "npm run dev -- --port 3100", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 120000,
    // The exported real investigator remains explicitly unavailable (INT-01).
    // This exercises honest failures and user-click retry with zero model calls.
    env: { PGLITE_DATA_DIR: ".data/e2e-retry", INVESTIGATOR_MODE: "real", DATABASE_MODE: "local" } },
});
