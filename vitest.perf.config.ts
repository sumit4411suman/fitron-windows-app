import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// npm run perf:local runs perf/seed.perf.ts with this: the app's own services build the performance dataset, in the
// same environment as the tests (aliases, server-only), into a data folder of its own. Not part of npm test.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url)),
    },
  },
  test: { include: ["perf/**/*.perf.ts"], testTimeout: 1_800_000, hookTimeout: 1_800_000, fileParallelism: false },
});
