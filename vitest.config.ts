import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "https://shiftflow.local/",
      },
    },
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    // Dexie/fake-indexeddb tests are stateful. A single worker keeps the suite
    // deterministic on Windows and prevents the default worker pool from
    // hanging during teardown.
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
