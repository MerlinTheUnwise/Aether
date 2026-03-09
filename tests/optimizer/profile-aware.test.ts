import { describe, it, expect } from "vitest";
import { GraphOptimizer } from "../../src/compiler/optimizer.js";
import type { AetherGraph, AetherNode, TypeAnnotation } from "../../src/ir/validator.js";
import type { ExecutionProfile, NodeProfile } from "../../src/runtime/profiler.js";

function makeNode(
  id: string,
  opts: {
    in?: Record<string, TypeAnnotation>;
    out?: Record<string, TypeAnnotation>;
    confidence?: number;
    effects?: string[];
    pure?: boolean;
    contract?: { pre?: string[]; post?: string[] };
    recovery?: Record<string, { action: string; params?: Record<string, unknown> }>;
  } = {}
): AetherNode {
  return {
    id,
    in: opts.in ?? {},
    out: opts.out ?? { result: { type: "String" } },
    contract: opts.contract ?? {},
    confidence: opts.confidence,
    effects: opts.effects ?? [],
    pure: opts.pure ?? true,
    recovery: opts.recovery,
  };
}

function makeGraph(nodes: AetherNode[], edges: { from: string; to: string }[] = []): AetherGraph {
  return { id: "test", version: 1, effects: [], nodes, edges };
}

function makeNodeProfile(id: string, execCount: number, avgTime: number): NodeProfile {
  return {
    nodeId: id,
    executionCount: execCount,
    totalTime_ms: execCount * avgTime,
    avgTime_ms: avgTime,
    maxTime_ms: avgTime * 2,
    minTime_ms: avgTime * 0.5,
    recoveryTriggerCount: 0,
    confidenceHistory: Array(execCount).fill(0.95),
    lastExecuted: Date.now(),
  };
}

function makeProfile(nodeProfiles: NodeProfile[], totalExec: number): ExecutionProfile {
  const map = new Map<string, NodeProfile>();
  for (const np of nodeProfiles) map.set(np.nodeId, np);
  return {
    graphId: "test",
    totalExecutions: totalExec,
    nodeProfiles: map,
    hotPaths: [],
    recommendations: [],
  };
}

describe("GraphOptimizer — Profile-Aware Analysis", () => {
  it("with profile: cache suggestion includes execution count", () => {
    const a = makeNode("db_query", {
      effects: ["database.read"],
      pure: false,
      recovery: { timeout: { action: "retry" }, error: { action: "fallback" } },
    });
    const graph = makeGraph([a]);

    const profile = makeProfile(
      [makeNodeProfile("db_query", 50, 15.0)],
      50
    );

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph, profile);
    const cache = suggestions.find(s => s.type === "cache_expensive_node");

    expect(cache).toBeDefined();
    expect(cache!.estimatedImpact).toContain("50");
    expect(cache!.estimatedImpact).toContain("15.0ms");
  });

  it("with profile: merge suggestion includes estimated time savings", () => {
    const a = makeNode("a", {
      out: { x: { type: "String" } },
      pure: true,
    });
    const b = makeNode("b", {
      in: { x: { type: "String" } },
      out: { y: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph([a, b], [{ from: "a.x", to: "b.x" }]);

    const profile = makeProfile(
      [makeNodeProfile("a", 100, 5.0), makeNodeProfile("b", 100, 8.0)],
      100
    );

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph, profile);
    const merge = suggestions.find(s => s.type === "merge_sequential_pure");

    expect(merge).toBeDefined();
    expect(merge!.estimatedImpact).toContain("ms savings");
  });

  it("without profile: suggestions still work, just no timing estimates", () => {
    const a = makeNode("a", {
      out: { x: { type: "String" } },
      pure: true,
    });
    const b = makeNode("b", {
      in: { x: { type: "String" } },
      out: { y: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph([a, b], [{ from: "a.x", to: "b.x" }]);

    const optimizer = new GraphOptimizer();

    // Without profile
    const suggestionsNoProfile = optimizer.analyze(graph);
    const mergeNoProfile = suggestionsNoProfile.find(s => s.type === "merge_sequential_pure");
    expect(mergeNoProfile).toBeDefined();
    expect(mergeNoProfile!.estimatedImpact).not.toContain("ms savings");

    // With profile
    const profile = makeProfile(
      [makeNodeProfile("a", 50, 5.0), makeNodeProfile("b", 50, 8.0)],
      50
    );
    const suggestionsWithProfile = optimizer.analyze(graph, profile);
    const mergeWithProfile = suggestionsWithProfile.find(s => s.type === "merge_sequential_pure");
    expect(mergeWithProfile).toBeDefined();
    expect(mergeWithProfile!.estimatedImpact).toContain("ms savings");
  });

  it("with profile: cache suggestion without profile has generic impact", () => {
    const a = makeNode("api_call", {
      effects: ["network"],
      pure: false,
      recovery: { timeout: { action: "retry" }, error: { action: "fallback" } },
    });
    const graph = makeGraph([a]);

    const optimizer = new GraphOptimizer();

    // Without profile
    const suggestionsNoProfile = optimizer.analyze(graph);
    const cacheNoProfile = suggestionsNoProfile.find(s => s.type === "cache_expensive_node");
    expect(cacheNoProfile).toBeDefined();
    expect(cacheNoProfile!.estimatedImpact).toBe("Reduce redundant external calls");

    // With profile
    const profile = makeProfile(
      [makeNodeProfile("api_call", 30, 20.0)],
      30
    );
    const suggestionsWithProfile = optimizer.analyze(graph, profile);
    const cacheWithProfile = suggestionsWithProfile.find(s => s.type === "cache_expensive_node");
    expect(cacheWithProfile).toBeDefined();
    expect(cacheWithProfile!.estimatedImpact).toContain("30");
  });
});
