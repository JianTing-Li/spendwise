import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    // Transform Auth.js's extensionless Next.js imports in the offline test runtime.
    server: { deps: { inline: ["next-auth"] } },
  },
});
