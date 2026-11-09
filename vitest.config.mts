import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    alias: { "server-only": new URL("./tests/helpers/server-only.ts", import.meta.url).pathname },
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    // Transform Auth.js's extensionless Next.js imports in the offline test runtime.
    server: { deps: { inline: ["next-auth"] } },
  },
});
