import { describe, it, expect } from "vitest";
import { diffGraphs, hasBreakingChanges } from "../../src/compiler/diff.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function makeGraph(overrides: Partial<AetherGraph> = {}): AetherGraph {
  return {
    id: "test",
    version: 1,
    effects: [],
    nodes: [
      {
        id: "a",
        in: { x: { type: "String" } },
        out: { y: { type: "String" } },
        contract: { post: ["output.y != null"] },
        effects: [],
        pure: true,
      },
    ],
    edges: [],
    ...overrides,
  } as AetherGraph;
}

describe("Semantic Diff", () => {
  it("identical graphs produce empty diff", () => {
    const g1 = makeGraph();
    const g2 = makeGraph();
    const diff = diffGraphs(g1, g2);
    expect(diff.changes.length).toBe(0);
    expect(diff.impact.nodes_added).toBe(0);
    expect(diff.impact.nodes_removed).toBe(0);
  });

  it("detects node added", () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: [
        ...(makeGraph().nodes),
        {
          id: "b",
          in: { x: { type: "String" } },
          out: { z: { type: "String" } },
          contract: {},
          effects: [],
          pure: true,
        } as any,
      ],
    });

    const diff = diffGraphs(g1, g2);
    expect(diff.impact.nodes_added).toBe(1);
    const added = diff.changes.find(c => c.type === "node_added");
    expect(added).toBeDefined();
    expect((added as any).node_id).toBe("b");
  });

  it("detects node removed", () => {
    const g1 = makeGraph({
      nodes: [
        ...(makeGraph().nodes),
        {
          id: "b",
          in: {},
          out: { z: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        } as any,
      ],
    });
    const g2 = makeGraph();

    const diff = diffGraphs(g1, g2);
    expect(diff.impact.nodes_removed).toBe(1);
    const removed = diff.changes.find(c => c.type === "node_removed");
    expect(removed).toBeDefined();
    expect((removed as any).node_id).toBe("b");
  });

  it("detects contract changed with old/new values", () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: { post: ["output.y.length > 0"] },
          effects: [],
          pure: true,
        } as any,
      ],
    });

    const diff = diffGraphs(g1, g2);
    expect(diff.impact.contracts_changed).toBeGreaterThan(0);
    const contractChange = diff.changes.find(c => c.type === "contract_changed");
    expect(contractChange).toBeDefined();
  });

  it("detects confidence changed", () => {
    const g1 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: {},
          effects: [],
          pure: true,
          confidence: 0.95,
        } as any,
      ],
    });
    const g2 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: {},
          effects: [],
          pure: true,
          confidence: 0.8,
        } as any,
      ],
    });

    const diff = diffGraphs(g1, g2);
    expect(diff.impact.confidence_changed).toBe(1);
    const confChange = diff.changes.find(c => c.type === "confidence_changed");
    expect(confChange).toBeDefined();
    expect((confChange as any).from).toBe(0.95);
    expect((confChange as any).to).toBe(0.8);
  });

  it("detects effect added", () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: { post: ["output.y != null"] },
          effects: ["logging"],
          recovery: { log_fail: { action: "fallback" } },
        } as any,
      ],
    });

    const diff = diffGraphs(g1, g2);
    expect(diff.impact.effects_changed).toBe(1);
    const effectAdd = diff.changes.find(c => c.type === "effect_added");
    expect(effectAdd).toBeDefined();
    expect((effectAdd as any).effect).toBe("logging");
  });

  it("detects type changed on output port", () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "Int" } },
          contract: { post: ["output.y != null"] },
          effects: [],
          pure: true,
        } as any,
      ],
    });

    const diff = diffGraphs(g1, g2);
    expect(diff.impact.types_changed).toBeGreaterThan(0);
    const typeChange = diff.changes.find(c => c.type === "type_changed");
    expect(typeChange).toBeDefined();
  });

  it("removing output port is a breaking change", () => {
    const g1 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" }, z: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        } as any,
      ],
    });
    const g2 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: {},
          effects: [],
          pure: true,
        } as any,
      ],
    });

    const diff = diffGraphs(g1, g2);
    expect(hasBreakingChanges(diff)).toBe(true);
    expect(diff.impact.breaking_changes.some(bc => bc.includes("removed"))).toBe(true);
  });

  it("adding output port is not breaking", () => {
    const g1 = makeGraph();
    const g2 = makeGraph({
      nodes: [
        {
          id: "a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" }, z: { type: "Int" } },
          contract: { post: ["output.y != null"] },
          effects: [],
          pure: true,
        } as any,
      ],
    });

    const diff = diffGraphs(g1, g2);
    // Adding an output port should NOT be breaking
    const breakingAboutZ = diff.impact.breaking_changes.filter(bc => bc.includes(".z"));
    expect(breakingAboutZ.length).toBe(0);
  });

  it("detects edge added and removed", () => {
    const g1 = makeGraph({
      edges: [{ from: "a.y", to: "b.x" }],
    });
    const g2 = makeGraph({
      edges: [{ from: "a.y", to: "c.x" }],
    });

    const diff = diffGraphs(g1, g2);
    const edgeAdded = diff.changes.find(c => c.type === "edge_added");
    const edgeRemoved = diff.changes.find(c => c.type === "edge_removed");
    expect(edgeAdded).toBeDefined();
    expect(edgeRemoved).toBeDefined();
  });
});
