/**
 * State Type Schema & Validator Tests
 */

import { describe, it, expect } from "vitest";
import { validateGraph } from "../../src/ir/validator.js";

function makeGraph(overrides: Record<string, any> = {}): any {
  return {
    id: "test_state_types",
    version: 1,
    effects: [],
    nodes: [
      {
        id: "node_a",
        in: { input: { type: "String" } },
        out: { status: { type: "String", state_type: "TestLifecycle" } },
        contract: { post: ["status == \"active\""] },
        effects: [],
        pure: true,
      },
      {
        id: "node_b",
        in: { status: { type: "String", state_type: "TestLifecycle" } },
        out: { result: { type: "String", state_type: "TestLifecycle" } },
        contract: {},
        effects: [],
        pure: true,
      },
    ],
    edges: [{ from: "node_a.status", to: "node_b.status" }],
    state_types: [
      {
        id: "TestLifecycle",
        states: ["active", "inactive", "archived"],
        transitions: [
          { from: "active", to: "inactive", when: "deactivated" },
          { from: "inactive", to: "active", when: "reactivated" },
          { from: "inactive", to: "archived", when: "archived" },
        ],
        invariants: {
          never: [{ from: "archived", to: "active" }],
          terminal: ["archived"],
          initial: "active",
        },
      },
    ],
    ...overrides,
  };
}

describe("State Type Schema Validation", () => {
  it("valid state type passes validation", () => {
    const result = validateGraph(makeGraph());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("duplicate states → error", () => {
    const graph = makeGraph({
      state_types: [
        {
          id: "Dup",
          states: ["a", "b", "a"],
          transitions: [{ from: "a", to: "b", when: "go" }],
        },
      ],
    });
    // Also remove state_type refs from ports since "Dup" != "TestLifecycle"
    graph.nodes[0].out.status = { type: "String", state_type: "Dup" };
    graph.nodes[1].in.status = { type: "String", state_type: "Dup" };
    graph.nodes[1].out.result = { type: "String", state_type: "Dup" };
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("duplicate state"))).toBe(true);
  });

  it("transition referencing undeclared state → error", () => {
    const graph = makeGraph({
      state_types: [
        {
          id: "Bad",
          states: ["a", "b"],
          transitions: [{ from: "a", to: "c", when: "go" }],
        },
      ],
    });
    graph.nodes[0].out.status = { type: "String", state_type: "Bad" };
    graph.nodes[1].in.status = { type: "String", state_type: "Bad" };
    graph.nodes[1].out.result = { type: "String", state_type: "Bad" };
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("undeclared state"))).toBe(true);
  });

  it("never-invariant violated by existing transition → error", () => {
    const graph = makeGraph({
      state_types: [
        {
          id: "NeverViolated",
          states: ["x", "y"],
          transitions: [{ from: "x", to: "y", when: "go" }],
          invariants: { never: [{ from: "x", to: "y" }] },
        },
      ],
    });
    graph.nodes[0].out.status = { type: "String", state_type: "NeverViolated" };
    graph.nodes[1].in.status = { type: "String", state_type: "NeverViolated" };
    graph.nodes[1].out.result = { type: "String", state_type: "NeverViolated" };
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("never-invariant"))).toBe(true);
  });

  it("terminal state has outgoing transition → error", () => {
    const graph = makeGraph({
      state_types: [
        {
          id: "TerminalViolated",
          states: ["a", "b", "c"],
          transitions: [
            { from: "a", to: "b", when: "go" },
            { from: "b", to: "c", when: "finish" },
          ],
          invariants: { terminal: ["b"] },
        },
      ],
    });
    graph.nodes[0].out.status = { type: "String", state_type: "TerminalViolated" };
    graph.nodes[1].in.status = { type: "String", state_type: "TerminalViolated" };
    graph.nodes[1].out.result = { type: "String", state_type: "TerminalViolated" };
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("terminal state"))).toBe(true);
  });

  it("port referencing undeclared state_type → error", () => {
    const graph = makeGraph();
    // Remove state_types but keep port references
    graph.state_types = [];
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("state_type"))).toBe(true);
  });

  it("unreachable state produces warning", () => {
    const graph = makeGraph({
      state_types: [
        {
          id: "Unreachable",
          states: ["start", "middle", "island"],
          transitions: [{ from: "start", to: "middle", when: "go" }],
          invariants: { initial: "start" },
        },
      ],
    });
    graph.nodes[0].out.status = { type: "String", state_type: "Unreachable" };
    graph.nodes[1].in.status = { type: "String", state_type: "Unreachable" };
    graph.nodes[1].out.result = { type: "String", state_type: "Unreachable" };
    const result = validateGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w: string) => w.includes("not reachable"))).toBe(true);
  });

  it("initial state must be a declared state", () => {
    const graph = makeGraph({
      state_types: [
        {
          id: "BadInitial",
          states: ["a", "b"],
          transitions: [{ from: "a", to: "b", when: "go" }],
          invariants: { initial: "nonexistent" },
        },
      ],
    });
    graph.nodes[0].out.status = { type: "String", state_type: "BadInitial" };
    graph.nodes[1].in.status = { type: "String", state_type: "BadInitial" };
    graph.nodes[1].out.result = { type: "String", state_type: "BadInitial" };
    const result = validateGraph(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("initial state"))).toBe(true);
  });
});
