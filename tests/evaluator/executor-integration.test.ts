import { describe, it, expect } from "vitest";
import { execute, ContractViolation, AdversarialViolation, type NodeFunction } from "../../src/runtime/executor.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function makeGraph(nodes: any[], edges: any[] = []): AetherGraph {
  return {
    id: "test-graph",
    name: "Test Graph",
    version: "1.0.0",
    nodes,
    edges,
    effects: [],
    metadata: { description: "Test", created: "2024-01-01", author: "test" },
  } as unknown as AetherGraph;
}

describe("Executor Integration — Contract Evaluator", () => {
  it("execute node with real implementation, passing contracts → contracts: passed", async () => {
    const graph = makeGraph([{
      id: "add",
      in: { x: { type: "Int" } },
      out: { result: { type: "Int" } },
      contract: { pre: ["x > 0"], post: ["result > 0"] },
      effects: [],
    }]);

    const result = await execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map([
        ["add", async (inputs: any) => ({ result: inputs.x + 10 })],
      ]),
      confidenceThreshold: 0,
    });

    expect(result.nodesExecuted).toBe(1);
    expect(result.contractReport).toBeDefined();
    expect(result.contractReport!.violated).toBe(0);
  });

  it("execute node with failing postcondition → ContractViolation thrown", async () => {
    const graph = makeGraph([{
      id: "bad",
      in: { x: { type: "Int" } },
      out: { result: { type: "Int" } },
      contract: { pre: [], post: ["result > 100"] },
      effects: [],
    }]);

    await expect(execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map([
        ["bad", async (inputs: any) => ({ result: 1 })],
      ]),
      confidenceThreshold: 0,
    })).rejects.toThrow(ContractViolation);
  });

  it("execute node with adversarial trigger → AdversarialViolation thrown", async () => {
    const graph = makeGraph([{
      id: "risky",
      in: { x: { type: "Int" } },
      out: { result: { type: "Int" } },
      contract: { pre: [], post: [] },
      confidence: 0.7,
      adversarial_check: { break_if: ["result > 100"] },
      effects: [],
    }]);

    await expect(execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map([
        ["risky", async () => ({ result: 200 })],
      ]),
      confidenceThreshold: 0,
    })).rejects.toThrow(AdversarialViolation);
  });

  it("stub mode → contracts reported as skipped", async () => {
    const graph = makeGraph([{
      id: "stub_node",
      in: { x: { type: "Int" } },
      out: { result: { type: "Int" } },
      contract: { pre: ["x > 0"], post: ["result > 0"] },
      effects: [],
    }]);

    const result = await execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map(), // no implementations = stub mode
      confidenceThreshold: 0,
    });

    expect(result.contractReport).toBeDefined();
    expect(result.contractReport!.warnings.some(w => w.includes("SKIPPED"))).toBe(true);
  });

  it("ExecutionResult includes contractReport with correct counts", async () => {
    const graph = makeGraph([{
      id: "node1",
      in: { x: { type: "Int" } },
      out: { y: { type: "Int" } },
      contract: { pre: ["x > 0"], post: ["y > 0", "y ≥ x"] },
      effects: [],
    }]);

    const result = await execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map([
        ["node1", async (inputs: any) => ({ y: inputs.x * 2 })],
      ]),
      confidenceThreshold: 0,
    });

    expect(result.contractReport).toBeDefined();
    expect(result.contractReport!.totalChecked).toBe(3); // 1 pre + 2 post
    expect(result.contractReport!.passed).toBe(3);
    expect(result.contractReport!.violated).toBe(0);
    expect(result.contractReport!.unevaluable).toBe(0);
  });

  it("unevaluable contracts cause ContractViolation (never silent pass)", async () => {
    const graph = makeGraph([{
      id: "node1",
      in: { x: { type: "Int" } },
      out: { y: { type: "Int" } },
      contract: { pre: [], post: ["y > 0", "unknown_var > 0"] },
      effects: [],
    }]);

    // Unevaluable contracts are now hard failures — the evaluator returns false
    await expect(execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map([
        ["node1", async () => ({ y: 10 })],
      ]),
      confidenceThreshold: 0,
    })).rejects.toThrow(ContractViolation);
  });

  it("multi-node graph tracks all contracts", async () => {
    const graph = makeGraph(
      [
        {
          id: "a",
          in: { x: { type: "Int" } },
          out: { mid: { type: "Int" } },
          contract: { pre: ["x > 0"], post: ["mid > 0"] },
          effects: [],
        },
        {
          id: "b",
          in: { mid: { type: "Int" } },
          out: { y: { type: "Int" } },
          contract: { pre: ["mid > 0"], post: ["y > 0"] },
          effects: [],
        },
      ],
      [{ from: "a.mid", to: "b.mid" }]
    );

    const result = await execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map<string, NodeFunction>([
        ["a", async (inputs: any) => ({ mid: inputs.x + 1 })],
        ["b", async (inputs: any) => ({ y: inputs.mid * 2 })],
      ]),
      confidenceThreshold: 0,
    });

    expect(result.contractReport!.totalChecked).toBe(4); // 2 pre + 2 post
    expect(result.contractReport!.passed).toBe(4);
  });
});
