import { describe, it, expect } from "vitest";
import { JITCompiler, TierManager } from "../../src/runtime/jit.js";
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
    pure: opts.pure,
    recovery: opts.recovery,
  };
}

function makeGraph(nodes: AetherNode[], edges: { from: string; to: string }[] = []): AetherGraph {
  return { id: "test", version: 1, effects: [], nodes, edges };
}

function makeProfile(totalExecutions: number, nodeIds: string[]): ExecutionProfile {
  const nodeProfiles = new Map<string, NodeProfile>();
  for (const id of nodeIds) {
    nodeProfiles.set(id, {
      nodeId: id,
      executionCount: totalExecutions,
      totalTime_ms: totalExecutions * 5,
      avgTime_ms: 5,
      maxTime_ms: 10,
      minTime_ms: 1,
      recoveryTriggerCount: 0,
      confidenceHistory: Array(totalExecutions).fill(0.95),
      lastExecuted: Date.now(),
    });
  }
  return {
    graphId: "test",
    totalExecutions,
    nodeProfiles,
    hotPaths: [],
    recommendations: [],
  };
}

describe("TierManager", () => {
  it("recommends Tier 0 for < 5 executions", () => {
    const tm = new TierManager();
    expect(tm.recommendTier([], 3)).toBe(0);
    expect(tm.recommendTier([], 0)).toBe(0);
    expect(tm.recommendTier([], 4)).toBe(0);
  });

  it("recommends Tier 1 for 5+ executions", () => {
    const tm = new TierManager();
    expect(tm.recommendTier([], 5)).toBe(1);
    expect(tm.recommendTier([], 10)).toBe(1);
    expect(tm.recommendTier([], 19)).toBe(1);
  });

  it("recommends Tier 2 for 20+ executions", () => {
    const tm = new TierManager();
    expect(tm.recommendTier([], 20)).toBe(2);
    expect(tm.recommendTier([], 100)).toBe(2);
  });

  it("promotes Tier 0 → Tier 1 → Tier 2", () => {
    const tm = new TierManager();
    const compiler = new JITCompiler();
    const n1 = makeNode("a", { out: { x: { type: "String" } }, pure: true });
    const n2 = makeNode("b", { in: { x: { type: "String" } }, out: { y: { type: "String" } }, pure: true });
    const graph = makeGraph([n1, n2], [{ from: "a.x", to: "b.x" }]);
    const hash = "test_subgraph";

    expect(tm.getTier(hash)).toBe(0);

    tm.promote(hash, compiler, graph, ["a", "b"]);
    expect(tm.getTier(hash)).toBe(1);

    tm.promote(hash, compiler, graph, ["a", "b"]);
    expect(tm.getTier(hash)).toBe(2);

    // Already at tier 2, no further promotion
    tm.promote(hash, compiler, graph, ["a", "b"]);
    expect(tm.getTier(hash)).toBe(2);
  });

  it("shouldPromote returns true when execution count crosses threshold", () => {
    const tm = new TierManager();
    const profile5 = makeProfile(5, ["a", "b"]);
    const profile20 = makeProfile(20, ["a", "b"]);

    expect(tm.shouldPromote("test", profile5)).toBe(true); // 0 → should be 1
    expect(tm.shouldPromote("test", profile20)).toBe(true); // 0 → should be 2
  });

  it("Tier 1 compilation produces function without Promise.all (sequential)", () => {
    const n1 = makeNode("a", { out: { x: { type: "String" } }, pure: true });
    const n2 = makeNode("b", {
      in: { x: { type: "String" } },
      out: { y: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph([n1, n2], [{ from: "a.x", to: "b.x" }]);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a", "b"], 1);

    expect(compiled.tier).toBe(1);
    expect(compiled.source).toContain("sequential");
    expect(compiled.source).not.toContain("Promise.all");
    expect(compiled.metadata.contractsInlined).toBe(0); // Tier 1 skips contract inlining
  });

  it("Tier 2 compilation produces function with Promise.all for parallel waves", () => {
    const n1 = makeNode("a", { out: { x: { type: "String" } }, pure: true });
    const n2 = makeNode("b", { out: { y: { type: "String" } }, pure: true });
    const n3 = makeNode("c", {
      in: { x: { type: "String" }, y: { type: "String" } },
      out: { z: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph(
      [n1, n2, n3],
      [{ from: "a.x", to: "c.x" }, { from: "b.y", to: "c.y" }]
    );

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a", "b", "c"], 2);

    expect(compiled.tier).toBe(2);
    expect(compiled.source).toContain("Promise.all");
  });

  it("Tier 1 and Tier 2 produce same outputs for same inputs", async () => {
    const n1 = makeNode("a", {
      in: { val: { type: "Int" } },
      out: { doubled: { type: "Int" } },
      pure: true,
    });
    const n2 = makeNode("b", {
      in: { doubled: { type: "Int" } },
      out: { result: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph([n1, n2], [{ from: "a.doubled", to: "b.doubled" }]);

    const compiler = new JITCompiler();
    const tier1 = compiler.compile(graph, ["a", "b"], 1);
    const tier2 = compiler.compile(graph, ["a", "b"], 2);

    const impls = new Map<string, any>();
    impls.set("a", async (inputs: any) => ({ doubled: (inputs.val ?? 5) * 2 }));
    impls.set("b", async (inputs: any) => ({ result: `Value is ${inputs.doubled}` }));

    const ctx = { confidenceThreshold: 0.7 };
    const result1 = await tier1.fn({ val: 5 }, impls, ctx);
    const result2 = await tier2.fn({ val: 5 }, impls, ctx);

    expect(result1.outputs.a.doubled).toBe(result2.outputs.a.doubled);
    expect(result1.outputs.b.result).toBe(result2.outputs.b.result);
  });

  it("deoptimization falls back to Tier 0", () => {
    const tm = new TierManager();
    const compiler = new JITCompiler();
    const n1 = makeNode("a");
    const graph = makeGraph([n1]);
    const hash = "deopt_test";

    tm.promote(hash, compiler, graph, ["a"]);
    expect(tm.getTier(hash)).toBe(1);

    tm.deoptimize(hash, "contract changed");
    expect(tm.getTier(hash)).toBe(0);
    expect(tm.getDeoptCount(hash)).toBe(1);
  });

  it("deoptimization blacklist: 3 deopts stays at Tier 0", () => {
    const tm = new TierManager();
    const compiler = new JITCompiler();
    const n1 = makeNode("a");
    const graph = makeGraph([n1]);
    const hash = "blacklist_test";

    // Deopt 3 times
    for (let i = 0; i < 3; i++) {
      tm.promote(hash, compiler, graph, ["a"]);
      tm.deoptimize(hash, `reason ${i}`);
    }

    expect(tm.isBlacklisted(hash)).toBe(true);
    expect(tm.getTier(hash)).toBe(0);

    // Promotion should be blocked
    tm.promote(hash, compiler, graph, ["a"]);
    expect(tm.getTier(hash)).toBe(0);

    // shouldPromote should return false
    const profile = makeProfile(100, ["a"]);
    expect(tm.shouldPromote(hash, profile)).toBe(false);
  });
});
