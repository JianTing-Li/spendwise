import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100" },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    env: {
      PGLITE_DATA_DIR: ".data/e2e",
      INVESTIGATOR_MODE: "stub",
      DATABASE_MODE: "local",
    },
    timeout: 120000,
  },
});
