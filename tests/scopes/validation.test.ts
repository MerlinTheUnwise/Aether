/**
 * Scope Validation Tests
 */

import { describe, it, expect } from "vitest";
import { validateGraph } from "../../src/ir/validator.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function makeBaseScopedGraph(): AetherGraph {
  return {
    id: "test_scoped",
    version: 1,
    effects: ["database.read"],
    nodes: [
      {
        id: "node_a",
        in: { x: { type: "String" } },
        out: { y: { type: "String" } },
        contract: { post: ["y.length > 0"] },
        pure: true,
        effects: [],
      },
      {
        id: "node_b",
        in: { y: { type: "String" } },
        out: { z: { type: "String" } },
        contract: { post: ["z.length > 0"] },
        effects: ["database.read"],
        recovery: { fail: { action: "retry", params: { count: 2 } } },
      },
    ],
    edges: [{ from: "node_a.y", to: "node_b.y" }],
    scopes: [
      {
        id: "scope_a",
        nodes: ["node_a"],
        boundary_contracts: {
          provides: [
            {
              name: "a_output",
              in: {},
              out: { y: { type: "String" } },
            },
          ],
          requires: [],
        },
      },
      {
        id: "scope_b",
        nodes: ["node_b"],
        boundary_contracts: {
          requires: [
            {
              name: "a_output",
              in: { y: { type: "String" } },
              out: {},
            },
          ],
          provides: [],
        },
      },
    ],
  };
}

describe("Scope Validation", () => {
  it("graph with valid scopes passes validation", () => {
    const graph = makeBaseScopedGraph();
    const result = validateGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("node in zero scopes → error", () => {
    const graph = makeBaseScopedGraph();
    // Remove node_b from scope_b
    graph.scopes![1].nodes = [];
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("node_b") && e.includes("not assigned to any scope"))).toBe(true);
  });

  it("node in multiple scopes → error", () => {
    const graph = makeBaseScopedGraph();
    // Add node_a to scope_b as well
    graph.scopes![1].nodes.push("node_a");
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("node_a") && e.includes("multiple scopes"))).toBe(true);
  });

  it("cross-scope edge without boundary contract → error", () => {
    const graph = makeBaseScopedGraph();
    // Remove provides from scope_a
    graph.scopes![0].boundary_contracts!.provides = [];
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("no matching provides contract"))).toBe(true);
  });

  it("cross-scope edge without requires contract → error", () => {
    const graph = makeBaseScopedGraph();
    // Remove requires from scope_b
    graph.scopes![1].boundary_contracts!.requires = [];
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("no matching requires contract"))).toBe(true);
  });

  it("internal edge (same scope) needs no boundary contract → pass", () => {
    const graph: AetherGraph = {
      id: "test_internal",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "n1",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: {},
          pure: true,
          effects: [],
        },
        {
          id: "n2",
          in: { y: { type: "String" } },
          out: { z: { type: "String" } },
          contract: {},
          pure: true,
          effects: [],
        },
      ],
      edges: [{ from: "n1.y", to: "n2.y" }],
      scopes: [
        {
          id: "single",
          nodes: ["n1", "n2"],
          boundary_contracts: { provides: [], requires: [] },
        },
      ],
    };
    const result = validateGraph(graph);
    expect(result.valid).toBe(true);
  });

  it("scope references unknown node → error", () => {
    const graph = makeBaseScopedGraph();
    graph.scopes![0].nodes.push("nonexistent");
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("nonexistent") && e.includes("unknown node"))).toBe(true);
  });

  it("disconnected scope nodes → warning", () => {
    const graph: AetherGraph = {
      id: "test_disconnected",
      version: 1,
      effects: [],
      nodes: [
        { id: "n1", in: {}, out: { x: { type: "String" } }, contract: {}, pure: true, effects: [] },
        { id: "n2", in: {}, out: { y: { type: "String" } }, contract: {}, pure: true, effects: [] },
      ],
      edges: [],
      scopes: [
        {
          id: "disconnected",
          nodes: ["n1", "n2"],
        },
      ],
    };
    const result = validateGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("disconnected") && w.includes("not form a connected"))).toBe(true);
  });
});
