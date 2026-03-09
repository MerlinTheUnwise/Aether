import { describe, it, expect } from "vitest";
import { ConfidenceEngine } from "../../src/runtime/confidence.js";
import type { AetherGraph, AetherNode } from "../../src/ir/validator.js";

function makeNode(id: string, confidence?: number, effects: string[] = []): AetherNode {
  return {
    id,
    in: {},
    out: {},
    contract: {},
    confidence,
    effects,
  };
}

function makeGraph(nodes: AetherNode[], edges: { from: string; to: string }[]): AetherGraph {
  return {
    id: "test",
    version: 1,
    effects: [],
    nodes,
    edges,
  };
}

describe("ConfidenceEngine", () => {
  it("single node: propagated = declared", () => {
    const graph = makeGraph([makeNode("a", 0.95)], []);
    const engine = new ConfidenceEngine(graph);

    const propagated = engine.propagate("a", new Map());
    expect(propagated).toBeCloseTo(0.95);
  });

  it("single node with no declared confidence defaults to 1.0", () => {
    const graph = makeGraph([makeNode("a")], []);
    const engine = new ConfidenceEngine(graph);

    const propagated = engine.propagate("a", new Map());
    expect(propagated).toBeCloseTo(1.0);
  });

  it("chain: A(0.99) -> B(0.95) -> C(0.90) propagates correctly", () => {
    const graph = makeGraph(
      [makeNode("a", 0.99), makeNode("b", 0.95), makeNode("c", 0.90)],
      [
        { from: "a.out", to: "b.in" },
        { from: "b.out", to: "c.in" },
      ]
    );
    const engine = new ConfidenceEngine(graph);

    // Wave 0: A
    const confA = engine.propagate("a", new Map());
    expect(confA).toBeCloseTo(0.99);

    // Wave 1: B (input from A)
    const confB = engine.propagate("b", new Map([["a", confA]]));
    expect(confB).toBeCloseTo(0.95 * 0.99); // 0.9405

    // Wave 2: C (input from B)
    const confC = engine.propagate("c", new Map([["b", confB]]));
    expect(confC).toBeCloseTo(0.90 * 0.9405); // 0.84645
  });

  it("parallel inputs: uses min confidence", () => {
    const nodeA = makeNode("a", 0.99);
    const nodeB = makeNode("b", 0.80);
    const nodeC = makeNode("c", 0.95);

    const graph = makeGraph(
      [nodeA, nodeB, nodeC],
      [
        { from: "a.out", to: "c.in1" },
        { from: "b.out", to: "c.in2" },
      ]
    );
    const engine = new ConfidenceEngine(graph);

    engine.propagate("a", new Map());
    engine.propagate("b", new Map());

    // C's input confidence should be min(0.99, 0.80) = 0.80
    const confC = engine.propagate("c", new Map([["a", 0.99], ["b", 0.80]]));
    expect(confC).toBeCloseTo(0.95 * 0.80); // 0.76
  });

  it("graph confidence = product along critical path", () => {
    // Linear chain: A -> B -> C (critical path = all three)
    const graph = makeGraph(
      [makeNode("a", 0.99), makeNode("b", 0.95), makeNode("c", 0.90)],
      [
        { from: "a.out", to: "b.in" },
        { from: "b.out", to: "c.in" },
      ]
    );
    const engine = new ConfidenceEngine(graph);

    const confA = engine.propagate("a", new Map());
    const confB = engine.propagate("b", new Map([["a", confA]]));
    const confC = engine.propagate("c", new Map([["b", confB]]));

    const graphConf = engine.getGraphConfidence();
    // Product of propagated along critical path: confA * confB * confC
    expect(graphConf).toBeCloseTo(confA * confB * confC);
  });

  it("oversight detection: node below threshold flagged", () => {
    const graph = makeGraph(
      [makeNode("a", 0.50)],
      []
    );
    const engine = new ConfidenceEngine(graph, 0.7);

    engine.propagate("a", new Map());
    expect(engine.requiresOversight("a")).toBe(true);
  });

  it("oversight detection: node above threshold not flagged", () => {
    const graph = makeGraph(
      [makeNode("a", 0.90)],
      []
    );
    const engine = new ConfidenceEngine(graph, 0.7);

    engine.propagate("a", new Map());
    expect(engine.requiresOversight("a")).toBe(false);
  });

  it("report includes all node confidences and oversight nodes", () => {
    const graph = makeGraph(
      [makeNode("a", 0.99), makeNode("b", 0.50)],
      [{ from: "a.out", to: "b.in" }]
    );
    const engine = new ConfidenceEngine(graph, 0.7);

    engine.propagate("a", new Map());
    engine.propagate("b", new Map([["a", 0.99]]));

    const report = engine.getReport();
    expect(report.nodeConfidences["a"].declared).toBe(0.99);
    expect(report.nodeConfidences["b"].declared).toBe(0.50);
    expect(report.nodeConfidences["b"].requiresOversight).toBe(true);
    expect(report.oversightNodes).toContain("b");
    expect(report.criticalPath.length).toBe(2);
  });
});
