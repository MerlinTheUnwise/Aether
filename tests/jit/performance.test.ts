import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execute } from "../../src/runtime/executor.js";
import { ExecutionProfiler } from "../../src/runtime/profiler.js";
import { JITCompiler } from "../../src/runtime/jit.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
}

// Reference programs to test (exclude v2/intent variants that need resolution)
const referencePrograms = [
  "user-registration",
  "payment-processing",
  "data-pipeline-etl",
  "customer-support-agent",
  "product-recommendations",
  "rate-limiter",
  "content-moderation-agent",
  "order-lifecycle",
];

function getNodeIds(graph: AetherGraph): string[] {
  return (graph as any).nodes
    .filter((n: any) => !n.hole && !n.intent)
    .map((n: any) => n.id);
}

describe("JIT Performance", () => {
  const RUNS = 20;

  for (const name of referencePrograms) {
    it(`${name}: profiling produces analysis after ${RUNS} runs`, async () => {
      const graph = loadExample(name);
      const profiler = new ExecutionProfiler(graph.id);
      profiler.setGraph(graph as any);

      for (let i = 0; i < RUNS; i++) {
        await execute({
          graph: graph as any,
          inputs: {},
          nodeImplementations: new Map(),
          confidenceThreshold: 0.7,
          jit: { compiler: undefined as any, profiler, autoCompile: false, compilationThreshold: 100 },
        });
      }

      const profile = profiler.analyze({ minExecutions: 10, minNodes: 2 });
      expect(profile.totalExecutions).toBe(RUNS);

      // All actual nodes should have profiles
      const nodeIds = getNodeIds(graph);
      for (const id of nodeIds) {
        const p = profile.nodeProfiles.get(id);
        expect(p, `missing profile for ${id}`).toBeDefined();
        expect(p!.executionCount).toBe(RUNS);
      }
    });
  }

  for (const name of referencePrograms) {
    it(`${name}: JIT compiled execution completes without errors`, async () => {
      const graph = loadExample(name);
      const nodeIds = getNodeIds(graph);

      if (nodeIds.length < 2) return; // Skip trivial graphs

      const compiler = new JITCompiler();
      const compiled = compiler.compile(graph as any, nodeIds);

      // Execute the compiled function
      const result = await compiled.fn(
        {},
        new Map(),
        { confidenceThreshold: 0.7 }
      );

      expect(result.outputs).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.log.length).toBeGreaterThan(0);
    });
  }

  it("compiled execution does not get slower on average", async () => {
    const graph = loadExample("user-registration");
    const nodeIds = getNodeIds(graph);

    // Interpreted runs
    let interpTotal = 0;
    for (let i = 0; i < RUNS; i++) {
      const result = await execute({
        graph: graph as any,
        inputs: {},
        nodeImplementations: new Map(),
        confidenceThreshold: 0.7,
      });
      interpTotal += result.duration_ms;
    }
    const interpAvg = interpTotal / RUNS;

    // JIT compiled runs
    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph as any, nodeIds);

    let jitTotal = 0;
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      await compiled.fn({}, new Map(), { confidenceThreshold: 0.7 });
      jitTotal += performance.now() - start;
    }
    const jitAvg = jitTotal / RUNS;

    // JIT should not be significantly slower (allow 3x margin for test environment variance)
    expect(jitAvg).toBeLessThan(interpAvg * 3 + 5);
  });
});
