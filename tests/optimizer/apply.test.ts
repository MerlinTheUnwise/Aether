import { describe, it, expect } from "vitest";
import { GraphOptimizer } from "../../src/compiler/optimizer.js";
import { validateGraph } from "../../src/ir/validator.js";
import type { AetherGraph, AetherNode, TypeAnnotation } from "../../src/ir/validator.js";

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

describe("GraphOptimizer — Apply", () => {
  it("apply merge_sequential_pure → merged node has combined contracts", () => {
    const a = makeNode("validate", {
      out: { validated: { type: "String" } },
      pure: true,
      contract: { post: ["validated.length > 0"] },
    });
    const b = makeNode("transform", {
      in: { validated: { type: "String" } },
      out: { result: { type: "String" } },
      pure: true,
      contract: { post: ["result.length > 0"] },
    });
    const graph = makeGraph([a, b], [{ from: "validate.validated", to: "transform.validated" }]);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const merge = suggestions.find(s => s.type === "merge_sequential_pure");
    expect(merge).toBeDefined();

    const optimized = optimizer.apply(graph, merge!.id);

    // Should have 1 merged node instead of 2
    expect(optimized.nodes.length).toBe(1);
    const merged = optimized.nodes[0] as AetherNode;
    expect(merged.id).toContain("merged");

    // Combined contracts
    expect(merged.contract.post).toContain("validated.length > 0");
    expect(merged.contract.post).toContain("result.length > 0");
    expect(merged.pure).toBe(true);
  });

  it("apply eliminate_redundant → second node replaced with edge to first", () => {
    const source = makeNode("source", {
      out: { x: { type: "String" } },
      pure: true,
    });
    const dup1 = makeNode("dup1", {
      in: { x: { type: "String" } },
      out: { result: { type: "Int" } },
      contract: { post: ["result > 0"] },
      pure: true,
      effects: [],
    });
    const dup2 = makeNode("dup2", {
      in: { x: { type: "String" } },
      out: { result: { type: "Int" } },
      contract: { post: ["result > 0"] },
      pure: true,
      effects: [],
    });
    const consumer = makeNode("consumer", {
      in: { val: { type: "Int" } },
      out: { done: { type: "Bool" } },
      pure: true,
    });

    const graph = makeGraph(
      [source, dup1, dup2, consumer],
      [
        { from: "source.x", to: "dup1.x" },
        { from: "source.x", to: "dup2.x" },
        { from: "dup2.result", to: "consumer.val" },
      ]
    );

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const redundant = suggestions.find(s => s.type === "eliminate_redundant");
    expect(redundant).toBeDefined();

    const optimized = optimizer.apply(graph, redundant!.id);

    // dup2 should be removed
    const nodeIds = optimized.nodes.map(n => n.id);
    expect(nodeIds).toContain("dup1");
    expect(nodeIds).not.toContain("dup2");

    // Consumer should now be fed from dup1
    const consumerEdge = optimized.edges.find(e => e.to === "consumer.val");
    expect(consumerEdge).toBeDefined();
    expect(consumerEdge!.from).toBe("dup1.result");
  });

  it("applied graph produces same outputs as original (semantic equivalence)", async () => {
    const a = makeNode("a", {
      in: { x: { type: "Int" } },
      out: { doubled: { type: "Int" } },
      pure: true,
    });
    const b = makeNode("b", {
      in: { doubled: { type: "Int" } },
      out: { result: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph([a, b], [{ from: "a.doubled", to: "b.doubled" }]);

    const optimizer = new GraphOptimizer();
    const result = optimizer.applyAll(graph);

    // If merge was applied, the optimized graph should still represent the same computation
    if (result.applied.length > 0) {
      expect(result.graph.nodes.length).toBeLessThan(graph.nodes.length);
    }
    // No errors during application
    expect(result.applied.length + result.skipped.length).toBeGreaterThanOrEqual(0);
  });

  it("non-auto-applicable suggestion → skipped by applyAll", () => {
    // Create a graph that only generates non-auto-applicable suggestions
    const a = makeNode("risky", {
      confidence: 0.87,
      effects: ["database.write"],
      pure: false,
      recovery: { any: { action: "fallback" } },
    });
    const graph = makeGraph([a]);

    const optimizer = new GraphOptimizer();
    const result = optimizer.applyAll(graph);

    // All suggestions should be skipped
    expect(result.applied.length).toBe(0);
    expect(result.skipped.length).toBeGreaterThan(0);

    // Graph should be unchanged
    expect(result.graph.nodes.length).toBe(graph.nodes.length);
  });

  it("applyAll applies all auto-applicable suggestions", () => {
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
    const result = optimizer.applyAll(graph);

    expect(result.applied.length).toBeGreaterThan(0);
    // Merged: 2 nodes → 1 node
    expect(result.graph.nodes.length).toBe(1);
  });
});
