import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ExecutionProfiler } from "../../src/runtime/profiler.js";
import { execute, type ExecutionContext } from "../../src/runtime/executor.js";
import type { AetherGraph, AetherNode, TypeAnnotation } from "../../src/ir/validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
}

function makeNode(
  id: string,
  opts: {
    in?: Record<string, TypeAnnotation>;
    out?: Record<string, TypeAnnotation>;
    confidence?: number;
    effects?: string[];
    pure?: boolean;
    contract?: { pre?: string[]; post?: string[] };
  } = {}
): AetherNode {
  return {
    id,
    in: opts.in ?? {},
    out: opts.out ?? { result: { type: "String" } },
    contract: opts.contract ?? {},
    confidence: opts.confidence,
    effects: opts.effects ?? [],
    pure: opts.pure,
  };
}

function makeGraph(nodes: AetherNode[], edges: { from: string; to: string }[] = []): AetherGraph {
  return { id: "test", version: 1, effects: [], nodes, edges };
}

describe("ExecutionProfiler", () => {
  it("records 10 executions with correct counts and timings", async () => {
    const graph = loadExample("user-registration");
    const profiler = new ExecutionProfiler(graph.id);
    profiler.setGraph(graph as any);

    for (let i = 0; i < 10; i++) {
      const result = await execute({
        graph: graph as any,
        inputs: {},
        nodeImplementations: new Map(),
        confidenceThreshold: 0.7,
        jit: { compiler: undefined as any, profiler, autoCompile: false, compilationThreshold: 100 },
      });
    }

    const profile = profiler.analyze({ minExecutions: 5 });
    expect(profile.totalExecutions).toBe(10);
    expect(profile.graphId).toBe("user_registration");

    for (const [, nodeProfile] of profile.nodeProfiles) {
      expect(nodeProfile.executionCount).toBe(10);
      expect(nodeProfile.avgTime_ms).toBeGreaterThanOrEqual(0);
      expect(nodeProfile.totalTime_ms).toBeGreaterThanOrEqual(0);
      expect(nodeProfile.maxTime_ms).toBeGreaterThanOrEqual(nodeProfile.minTime_ms);
    }
  });

  it("detects hot path in linear chain crossing multiple waves", async () => {
    const graph = loadExample("user-registration");
    const profiler = new ExecutionProfiler(graph.id);
    profiler.setGraph(graph as any);

    for (let i = 0; i < 15; i++) {
      await execute({
        graph: graph as any,
        inputs: {},
        nodeImplementations: new Map(),
        confidenceThreshold: 0.7,
        jit: { compiler: undefined as any, profiler, autoCompile: false, compilationThreshold: 100 },
      });
    }

    const profile = profiler.analyze({ minExecutions: 10, minNodes: 2 });
    expect(profile.hotPaths.length).toBeGreaterThanOrEqual(1);

    // The chain validate_email → check_uniqueness → create_user should be detected
    const pathNodes = profile.hotPaths.flatMap(p => p.nodes);
    expect(pathNodes).toContain("validate_email");
  });

  it("does not recommend single-wave parallel nodes", () => {
    // Two parallel nodes in the same wave
    const n1 = makeNode("a", { out: { x: { type: "String" } } });
    const n2 = makeNode("b", { out: { y: { type: "String" } } });
    const graph = makeGraph([n1, n2]);

    const profiler = new ExecutionProfiler("test");
    profiler.setGraph(graph);

    for (let i = 0; i < 20; i++) {
      profiler.recordNodeExecution({ nodeId: "a", duration_ms: 5, wave: 0, confidence: 1.0, recoveryTriggered: false });
      profiler.recordNodeExecution({ nodeId: "b", duration_ms: 5, wave: 0, confidence: 1.0, recoveryTriggered: false });
      profiler.recordGraphExecution({
        outputs: {}, confidence: 1, executionLog: [
          { nodeId: "a", wave: 0, duration_ms: 5, confidence: 1, skipped: false, effects: [] },
          { nodeId: "b", wave: 0, duration_ms: 5, confidence: 1, skipped: false, effects: [] },
        ],
        effectsPerformed: [], nodesExecuted: 2, nodesSkipped: 0, duration_ms: 10, waves: 1,
      });
    }

    const profile = profiler.analyze({ minExecutions: 10, minNodes: 2 });
    // Same-wave parallel nodes should NOT be recommended (already parallel, only 1 wave)
    expect(profile.hotPaths.length).toBe(0);
  });

  it("filters below minExecutions threshold", async () => {
    const graph = loadExample("user-registration");
    const profiler = new ExecutionProfiler(graph.id);
    profiler.setGraph(graph as any);

    // Only 3 executions — below default threshold of 10
    for (let i = 0; i < 3; i++) {
      await execute({
        graph: graph as any,
        inputs: {},
        nodeImplementations: new Map(),
        confidenceThreshold: 0.7,
        jit: { compiler: undefined as any, profiler, autoCompile: false, compilationThreshold: 100 },
      });
    }

    const profile = profiler.analyze({ minExecutions: 10 });
    expect(profile.recommendations.length).toBe(0);
  });

  it("export/import round-trip preserves data", async () => {
    const graph = loadExample("user-registration");
    const profiler = new ExecutionProfiler(graph.id);
    profiler.setGraph(graph as any);

    for (let i = 0; i < 5; i++) {
      await execute({
        graph: graph as any,
        inputs: {},
        nodeImplementations: new Map(),
        confidenceThreshold: 0.7,
        jit: { compiler: undefined as any, profiler, autoCompile: false, compilationThreshold: 100 },
      });
    }

    const exported = profiler.export();
    const imported = ExecutionProfiler.import(exported);
    const reExported = imported.export();

    const original = JSON.parse(exported);
    const roundTrip = JSON.parse(reExported);

    expect(roundTrip.graphId).toBe(original.graphId);
    expect(roundTrip.totalExecutions).toBe(original.totalExecutions);
    expect(Object.keys(roundTrip.nodeProfiles).length).toBe(Object.keys(original.nodeProfiles).length);
  });

  it("zero executions produces empty profile", () => {
    const profiler = new ExecutionProfiler("empty");
    const profile = profiler.analyze();

    expect(profile.totalExecutions).toBe(0);
    expect(profile.nodeProfiles.size).toBe(0);
    expect(profile.hotPaths.length).toBe(0);
    expect(profile.recommendations.length).toBe(0);
  });
});
