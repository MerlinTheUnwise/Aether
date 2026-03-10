import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    // Z3-heavy tests: forked processes to isolate WASM memory
    test: {
      name: "z3",
      pool: "forks",
      poolOptions: {
        forks: {
          maxForks: 2,
          minForks: 1,
        },
      },
      testTimeout: 60_000,
      include: [
        "tests/verifier/**/*.test.ts",
        "tests/adversarial/**/*.test.ts",
        "tests/dashboard/collector.test.ts",
        "tests/dashboard/diff.test.ts",
        "tests/integration/full-report.test.ts",
        "tests/integration/full-pipeline.test.ts",
        "tests/state-types/verifier.test.ts",
      ],
    },
  },
  {
    // All other tests: threads for speed
    test: {
      name: "unit",
      pool: "threads",
      poolOptions: {
        threads: {
          maxThreads: 4,
          minThreads: 1,
        },
      },
      testTimeout: 30_000,
      include: ["tests/**/*.test.ts"],
      exclude: [
        "tests/verifier/**/*.test.ts",
        "tests/adversarial/**/*.test.ts",
        "tests/dashboard/collector.test.ts",
        "tests/dashboard/diff.test.ts",
        "tests/integration/full-report.test.ts",
        "tests/integration/full-pipeline.test.ts",
        "tests/state-types/verifier.test.ts",
      ],
    },
  },
]);
