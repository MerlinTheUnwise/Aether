/**
 * Tests: Contract Enforcement Modes
 */

import { describe, it, expect } from "vitest";
import { execute, ContractViolation } from "../../src/runtime/executor.js";
import { ImplementationRegistry } from "../../src/implementations/registry.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function makeGraph(post: string[]): AetherGraph {
  return {
    id: "test",
    version: 1,
    effects: [],
    nodes: [{
      id: "node_a",
      in: { x: { type: "Int" } },
      out: { y: { type: "Int" } },
      contract: { post },
      effects: [],
    }],
    edges: [],
  } as any;
}

function makeCtx(graph: AetherGraph, contractMode: "enforce" | "warn" | "skip") {
  const registry = new ImplementationRegistry();
  registry.override("node_a", async () => ({ y: 5 }));
  return {
    graph,
    inputs: { x: 1 },
    nodeImplementations: new Map(),
    confidenceThreshold: 0.7,
    registry,
    contractMode,
  };
}

describe("Contract Enforcement Modes", () => {
  it("enforce: violations throw ContractViolation", async () => {
    const graph = makeGraph(["y > 100"]); // y=5, fails
    await expect(execute(makeCtx(graph, "enforce"))).rejects.toThrow(ContractViolation);
  });

  it("warn: violations logged but execution continues", async () => {
    const graph = makeGraph(["y > 100"]); // y=5, fails
    const result = await execute(makeCtx(graph, "warn"));
    expect(result.nodesExecuted).toBe(1);
    expect(result.outputs["node_a"].y).toBe(5);
  });

  it("skip: no contract checking at all", async () => {
    const graph = makeGraph(["y > 100"]); // y=5, would fail
    const result = await execute(makeCtx(graph, "skip"));
    expect(result.nodesExecuted).toBe(1);
    expect(result.outputs["node_a"].y).toBe(5);
  });

  it("enforce: passing contracts succeed", async () => {
    const graph = makeGraph(["y > 0"]); // y=5, passes
    const result = await execute(makeCtx(graph, "enforce"));
    expect(result.nodesExecuted).toBe(1);
    expect(result.outputs["node_a"].y).toBe(5);
  });

  it("contract report has correct counts", async () => {
    const graph = makeGraph(["y > 0", "y > 2"]); // both pass
    const result = await execute(makeCtx(graph, "enforce"));
    expect(result.contractReport).toBeDefined();
    expect(result.contractReport!.totalChecked).toBeGreaterThanOrEqual(2);
    expect(result.contractReport!.passed).toBeGreaterThanOrEqual(2);
    expect(result.contractReport!.violated).toBe(0);
  });
});
