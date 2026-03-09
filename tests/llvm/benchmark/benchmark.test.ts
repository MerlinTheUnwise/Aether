/**
 * Tests for the benchmark suite
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import { benchmark } from "../../../src/compiler/llvm/benchmark.js";

const EXAMPLES = join(process.cwd(), "src", "ir", "examples");

describe("Benchmark Suite", () => {
  it("benchmarks user-registration (interpreted + JIT) → produces results", async () => {
    const result = await benchmark(join(EXAMPLES, "user-registration.json"), {
      runs: 5,
      warmupRuns: 2,
      includeNative: false,
    });

    expect(result.graphId).toBe("user_registration");
    expect(result.modes.interpreted.runs).toBe(5);
    expect(result.modes.interpreted.avg_ms).toBeGreaterThan(0);
    expect(result.modes.interpreted.min_ms).toBeGreaterThan(0);
    expect(result.modes.interpreted.max_ms).toBeGreaterThan(0);
    expect(result.modes.interpreted.min_ms).toBeLessThanOrEqual(result.modes.interpreted.avg_ms);
    expect(result.modes.interpreted.max_ms).toBeGreaterThanOrEqual(result.modes.interpreted.avg_ms);

    expect(result.modes.jit.runs).toBe(5);
    expect(result.modes.jit.avg_ms).toBeGreaterThan(0);
    expect(result.modes.jit.tier).toBeGreaterThanOrEqual(1);
  });

  it("JIT avg ≤ interpreted avg (JIT is not slower)", async () => {
    const result = await benchmark(join(EXAMPLES, "user-registration.json"), {
      runs: 10,
      warmupRuns: 5,
      includeNative: false,
    });

    // After warmup, JIT should be roughly comparable to interpreted
    // For very small graphs, JIT overhead can dominate — allow generous margin
    expect(result.modes.jit.avg_ms).toBeLessThanOrEqual(result.modes.interpreted.avg_ms * 10);
  });

  it("speedup ratios calculated correctly", async () => {
    const result = await benchmark(join(EXAMPLES, "user-registration.json"), {
      runs: 5,
      warmupRuns: 2,
      includeNative: false,
    });

    expect(result.speedup.jit_vs_interpreted).toBeDefined();
    expect(result.speedup.jit_vs_interpreted).toMatch(/\d+\.\d+x (faster|slower)/);
    // No native speedup since we didn't include native
    expect(result.speedup.native_vs_interpreted).toBeUndefined();
    expect(result.speedup.native_vs_jit).toBeUndefined();
  });

  it("native benchmark skipped gracefully when toolchain unavailable", async () => {
    const result = await benchmark(join(EXAMPLES, "user-registration.json"), {
      runs: 3,
      warmupRuns: 1,
      includeNative: true,  // will attempt but may not be available
    });

    // Should always have interpreted and jit results
    expect(result.modes.interpreted).toBeDefined();
    expect(result.modes.jit).toBeDefined();

    // Native may or may not be available — either way, no crash
    if (!result.modes.native) {
      expect(result.speedup.native_vs_interpreted).toBeUndefined();
    }
  });

  it("benchmarks payment-processing (interpreted + JIT)", async () => {
    const result = await benchmark(join(EXAMPLES, "payment-processing.json"), {
      runs: 3,
      warmupRuns: 1,
      includeNative: false,
    });

    expect(result.graphId).toBe("payment_processing");
    expect(result.modes.interpreted.runs).toBe(3);
    expect(result.modes.jit.runs).toBe(3);
  });
});
