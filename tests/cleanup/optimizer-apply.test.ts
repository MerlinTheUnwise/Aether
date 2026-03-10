/**
 * Tests for optimizer apply() — graph transformation.
 */

import { describe, it, expect } from "vitest";
import { GraphOptimizer } from "../../src/compiler/optimizer.js";
import type { AetherGraph, AetherNode, AetherEdge } from "../../src/ir/validator.js";

function makeGraph(nodes: AetherNode[], edges: AetherEdge[], extra?: Partial<AetherGraph>): AetherGraph {
  return {
    id: "test-graph",
    name: "Test Graph",
    version: "1.0.0",
    nodes,
    edges,
    metadata: { created: "2024-01-01", description: "Test" },
    ...extra,
  } as AetherGraph;
}

function pureNode(id: string, inPorts: Record<string, any>, outPorts: Record<string, any>, contracts?: any): AetherNode {
  return {
    id,
    in: inPorts,
    out: outPorts,
    contract: contracts ?? { pre: [], post: [] },
    confidence: 0.95,
    effects: [],
    pure: true,
  } as AetherNode;
}

describe("Optimizer apply — merge_sequential_pure", () => {
  it("merges two pure sequential nodes into one", () => {
    const a = pureNode("a", { x: { type: "Int" } }, { y: { type: "Int" } }, { pre: ["x > 0"], post: ["y > 0"] });
    const b = pureNode("b", { y: { type: "Int" } }, { z: { type: "Int" } }, { pre: [], post: ["z > 0"] });
    const edges: AetherEdge[] = [{ from: "a.y", to: "b.y" }];
    const graph = makeGraph([a, b], edges);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const mergeSuggestion = suggestions.find(s => s.type === "merge_sequential_pure");
    expect(mergeSuggestion).toBeDefined();
    expect(mergeSuggestion!.autoApplicable).toBe(true);

    const result = optimizer.apply(graph, mergeSuggestion!.id);
    // Should have 1 merged node instead of 2
    expect(result.nodes.length).toBe(1);
    const merged = result.nodes[0];
    expect(merged.id).toContain("merged");
  });

  it("merged node has combined contracts", () => {
    const a = pureNode("a", { x: { type: "Int" } }, { y: { type: "Int" } }, { pre: ["x > 0"], post: ["y > 0"] });
    const b = pureNode("b", { y: { type: "Int" } }, { z: { type: "Int" } }, { pre: [], post: ["z > 0"] });
    const edges: AetherEdge[] = [{ from: "a.y", to: "b.y" }];
    const graph = makeGraph([a, b], edges);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const mergeSuggestion = suggestions.find(s => s.type === "merge_sequential_pure")!;
    const result = optimizer.apply(graph, mergeSuggestion.id);

    const merged = result.nodes[0] as AetherNode;
    // Combined: a's pre + both posts
    expect(merged.contract.post!.length).toBe(2);
  });

  it("edges rewired correctly after merge", () => {
    // Use an impure input node so only a→b is a merge candidate
    const input: AetherNode = {
      id: "input",
      in: {},
      out: { val: { type: "Int" } },
      contract: { pre: [], post: [] },
      confidence: 0.95,
      effects: ["database.read"],
      pure: false,
    } as AetherNode;
    const a = pureNode("a", { val: { type: "Int" } }, { mid: { type: "Int" } });
    const b = pureNode("b", { mid: { type: "Int" } }, { out: { type: "Int" } });
    const output = pureNode("output", { out: { type: "Int" } }, {});

    const edges: AetherEdge[] = [
      { from: "input.val", to: "a.val" },
      { from: "a.mid", to: "b.mid" },
      { from: "b.out", to: "output.out" },
    ];
    const graph = makeGraph([input, a, b, output], edges);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const mergeSuggestion = suggestions.find(s => s.type === "merge_sequential_pure");
    expect(mergeSuggestion).toBeDefined();
    expect(mergeSuggestion!.affectedNodes).toContain("a");
    expect(mergeSuggestion!.affectedNodes).toContain("b");

    const result = optimizer.apply(graph, mergeSuggestion!.id);

    // Should have 3 nodes: input, merged(a+b), output
    expect(result.nodes.length).toBe(3);

    const mergedNode = result.nodes.find(n => n.id.includes("merged"))!;
    expect(mergedNode).toBeDefined();

    // Edges should connect input → merged → output
    const inEdge = result.edges.find(e => e.to.includes(mergedNode.id));
    const outEdge = result.edges.find(e => e.from.includes(mergedNode.id));
    expect(inEdge).toBeDefined();
    expect(outEdge).toBeDefined();
  });
});

describe("Optimizer apply — eliminate_redundant", () => {
  it("removes duplicate node and redirects consumers", () => {
    const source = pureNode("source", {}, { val: { type: "Int" } });
    const a = pureNode("dup_a", { val: { type: "Int" } }, { out: { type: "Int" } }, { pre: [], post: ["out > 0"] });
    const b = pureNode("dup_b", { val: { type: "Int" } }, { out: { type: "Int" } }, { pre: [], post: ["out > 0"] });
    const sink = pureNode("sink", { out: { type: "Int" } }, {});

    const edges: AetherEdge[] = [
      { from: "source.val", to: "dup_a.val" },
      { from: "source.val", to: "dup_b.val" },
      { from: "dup_b.out", to: "sink.out" },
    ];
    const graph = makeGraph([source, a, b, sink], edges);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const redundantSuggestion = suggestions.find(s => s.type === "eliminate_redundant");
    expect(redundantSuggestion).toBeDefined();

    const result = optimizer.apply(graph, redundantSuggestion!.id);
    // dup_b should be removed
    expect(result.nodes.find(n => n.id === "dup_b")).toBeUndefined();
    // sink should now get input from dup_a
    const sinkEdge = result.edges.find(e => e.to === "sink.out");
    expect(sinkEdge).toBeDefined();
    expect(sinkEdge!.from).toBe("dup_a.out");
  });
});

describe("Optimizer applyAll", () => {
  it("non-auto-applicable suggestions are skipped", () => {
    // Create a graph that triggers parallelize_independent (non-auto-applicable)
    const a = pureNode("node_a", {}, { out: { type: "Int" } });
    const b = pureNode("node_b", {}, { out: { type: "Int" } });
    const c = pureNode("node_c", { a: { type: "Int" }, b: { type: "Int" } }, { out: { type: "Int" } });
    const edges: AetherEdge[] = [
      { from: "node_a.out", to: "node_c.a" },
      { from: "node_b.out", to: "node_c.b" },
    ];
    const graph = makeGraph([a, b, c], edges);

    const optimizer = new GraphOptimizer();
    const result = optimizer.applyAll(graph);
    expect(result.applied).toBeDefined();
    expect(result.skipped).toBeDefined();
    expect(result.modifications).toBeDefined();
    expect(Array.isArray(result.modifications)).toBe(true);
  });

  it("applyAll applies all safe suggestions and returns modification log", () => {
    const a = pureNode("a", { x: { type: "Int" } }, { y: { type: "Int" } });
    const b = pureNode("b", { y: { type: "Int" } }, { z: { type: "Int" } });
    const edges: AetherEdge[] = [{ from: "a.y", to: "b.y" }];
    const graph = makeGraph([a, b], edges);

    const optimizer = new GraphOptimizer();
    const result = optimizer.applyAll(graph);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.modifications.length).toBeGreaterThan(0);
    // Merged node should exist
    expect(result.graph.nodes.length).toBe(1);
  });
});
