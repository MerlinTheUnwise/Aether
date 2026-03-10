import { defineConfig } from "vitest/config";

// Base config — workspace projects in vitest.workspace.ts override this.
// This file provides defaults for direct `vitest run <file>` invocations.
export default defineConfig({
  test: {
    pool: "threads",
    poolOptions: {
      threads: {
        maxThreads: 2,
        minThreads: 1,
      },
    },
    testTimeout: 30_000,
  },
});
