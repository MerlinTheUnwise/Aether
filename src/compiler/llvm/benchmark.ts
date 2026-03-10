/**
 * AETHER Benchmark Suite
 *
 * Compares performance across three execution modes:
 * - Interpreted (graph executor in stub mode)
 * - Compiled (executor with runtime compilation enabled)
 * - Native (compiled binary, if toolchain available)
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { execute, type ExecutionContext } from "../../runtime/executor.js";
import { ExecutionProfiler } from "../../runtime/profiler.js";
import { RuntimeCompiler } from "../../runtime/jit.js";
import { detectToolchain, compileToBinary } from "./pipeline.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModeResult {
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  runs: number;
}

export interface BenchmarkResult {
  graphId: string;
  modes: {
    interpreted: ModeResult;
    jit: ModeResult & { tier: number };
    native?: ModeResult;
  };
  speedup: {
    jit_vs_interpreted: string;
    native_vs_interpreted?: string;
    native_vs_jit?: string;
  };
}

interface BenchmarkOptions {
  runs?: number;                   // default: 50
  warmupRuns?: number;             // default: 5
  includeNative?: boolean;         // default: true if toolchain available
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeStats(times: number[]): { avg: number; min: number; max: number } {
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    avg: Math.round(avg * 100) / 100,
    min: Math.round(sorted[0] * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

function formatSpeedup(baseline: number, faster: number): string {
  if (faster <= 0 || baseline <= 0) return "N/A";
  const ratio = baseline / faster;
  if (ratio >= 1) {
    return `${ratio.toFixed(1)}x faster`;
  } else {
    return `${(1 / ratio).toFixed(1)}x slower`;
  }
}

// ─── Benchmark ────────────────────────────────────────────────────────────────

export async function benchmark(
  graphPath: string,
  options?: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const runs = options?.runs ?? 50;
  const warmupRuns = options?.warmupRuns ?? 5;

  const graphJson = JSON.parse(readFileSync(graphPath, "utf-8"));
  const graphId = graphJson.id ?? "unknown";

  // ── Interpreted mode ──
  const interpTimes: number[] = [];

  const makeContext = (): ExecutionContext => ({
    graph: graphJson,
    inputs: {},
    nodeImplementations: new Map(),
    confidenceThreshold: 0.7,
  });

  // Warmup
  for (let i = 0; i < warmupRuns; i++) {
    await execute(makeContext());
  }

  // Measure
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await execute(makeContext());
    interpTimes.push(performance.now() - start);
  }

  const interpStats = computeStats(interpTimes);
  const interpreted: ModeResult = { avg_ms: interpStats.avg, min_ms: interpStats.min, max_ms: interpStats.max, runs };

  // ── JIT mode ──
  const jitTimes: number[] = [];
  let jitTier = 0;

  // JIT warmup: profile + compile
  const profiler = new ExecutionProfiler(graphId);
  const jitCompiler = new RuntimeCompiler();

  for (let i = 0; i < warmupRuns; i++) {
    const ctx = makeContext();
    ctx.jit = { compiler: jitCompiler, profiler, autoCompile: true, compilationThreshold: 3 };
    await execute(ctx);
  }

  // Measure JIT
  for (let i = 0; i < runs; i++) {
    const ctx = makeContext();
    ctx.jit = { compiler: jitCompiler, profiler, autoCompile: true, compilationThreshold: 3 };
    const start = performance.now();
    await execute(ctx);
    jitTimes.push(performance.now() - start);
  }

  // Determine tier from compiled functions
  const jitStats2 = jitCompiler.getStats();
  jitTier = jitStats2.cached > 0 ? 2 : 1;

  const jitStats = computeStats(jitTimes);
  const jit: ModeResult & { tier: number } = { avg_ms: jitStats.avg, min_ms: jitStats.min, max_ms: jitStats.max, runs, tier: jitTier };

  // ── Native mode (optional) ──
  let nativeResult: ModeResult | undefined;
  const includeNative = options?.includeNative ?? true;

  if (includeNative) {
    const toolchain = await detectToolchain();
    if (toolchain.llc.available && toolchain.clang.available && toolchain.runtime.available) {
      try {
        const compResult = await compileToBinary({
          input: graphPath,
          outputDir: ".",
          target: "binary",
          optimization: 2,
        });

        if (compResult.success && compResult.outputPath) {
          const nativeTimes: number[] = [];

          // Warmup native
          for (let i = 0; i < warmupRuns; i++) {
            try {
              execSync(`"${compResult.outputPath}"`, { timeout: 10000 });
            } catch { /* binary may exit non-zero in stub mode */ }
          }

          // Measure native
          for (let i = 0; i < runs; i++) {
            const start = performance.now();
            try {
              execSync(`"${compResult.outputPath}"`, { timeout: 10000 });
            } catch { /* ok */ }
            nativeTimes.push(performance.now() - start);
          }

          const nativeStats = computeStats(nativeTimes);
          nativeResult = { avg_ms: nativeStats.avg, min_ms: nativeStats.min, max_ms: nativeStats.max, runs };
        }
      } catch { /* native benchmark not available */ }
    }
  }

  // ── Compute speedups ──
  const speedup: BenchmarkResult["speedup"] = {
    jit_vs_interpreted: formatSpeedup(interpStats.avg, jitStats.avg),
  };

  if (nativeResult) {
    speedup.native_vs_interpreted = formatSpeedup(interpStats.avg, nativeResult.avg_ms);
    speedup.native_vs_jit = formatSpeedup(jitStats.avg, nativeResult.avg_ms);
  }

  return {
    graphId,
    modes: {
      interpreted,
      jit,
      native: nativeResult,
    },
    speedup,
  };
}
