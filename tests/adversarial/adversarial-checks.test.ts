/**
 * Contract verification tests using Z3 SMT solver.
 */

import { describe, it, expect } from "vitest";
import { verifyNode, verifyGraph, getZ3 } from "../../src/compiler/verifier.js";

// Helper to build a minimal node
function makeNode(overrides: Record<string, unknown>) {
  return {
    id: "test_node",
    in: {},
    out: {},
    contract: {},
    effects: [],
    pure: true,
    ...overrides,
  };
}

// ─── Z3 initialization ───────────────────────────────────────────────────────

describe("Z3 initialization", () => {
  it("getZ3() returns successfully and can create basic expressions", async () => {
    const z3 = await getZ3();
    expect(z3).toBeDefined();
    expect(z3.Context).toBeDefined();

    const ctx = new z3.Context("init_test");
    const x = ctx.Int.const("x");
    expect(x).toBeDefined();

    const solver = new ctx.Solver();
    solver.add(ctx.GT(x, ctx.Int.val(0)));
    const result = await solver.check();
    expect(result).toBe("sat");
  }, 30000);
});

// ─── Postcondition tests ──────────────────────────────────────────────────────

describe("Postcondition verification", () => {
  it("verifies a simple postcondition (result > 0) with supporting precondition", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      id: "positive_result",
      in: { x: { type: "Int" } },
      out: { result: { type: "Int" } },
      contract: {
        pre: ["result > 0"],
        post: ["result > 0"],
      },
    });

    const result = await verifyNode(node as any, z3);
    expect(result.node_id).toBe("positive_result");
    expect(result.postconditions.length).toBe(1);
    expect(result.postconditions[0].status).toBe("verified");
  }, 30000);

  it("detects contradictory postconditions (x > 0 AND x < 0)", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      id: "contradictory",
      out: { x: { type: "Int" } },
      contract: {
        post: ["x > 0 && x < 0"],
      },
    });

    const result = await verifyNode(node as any, z3);
    // x > 0 AND x < 0 can never be true, so NOT(post) is always true → SAT → FAILED
    // Wait — actually the logic: assert NOT(x > 0 && x < 0). NOT of a contradiction is
    // always true, so this is SAT. That means the postcondition "fails" verification
    // because Z3 found a counterexample where the postcondition doesn't hold.
    // But actually — the postcondition IS a contradiction (never true), so it cannot
    // always hold. The verifier correctly reports it as failed.
    expect(result.postconditions.length).toBe(1);
    expect(result.postconditions[0].status).toBe("failed");
    expect(result.postconditions[0].counterexample).toBeDefined();
  }, 30000);
});

// ─── Adversarial check tests ─────────────────────────────────────────────────

describe("Adversarial check verification", () => {
  it("PASSES when break_if condition is UNSAT (tax < 0 with tax >= 0 precondition)", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      id: "tax_safe",
      in: { tax: { type: "Int" } },
      contract: {
        pre: ["tax >= 0"],
      },
      adversarial_check: {
        break_if: ["tax < 0"],
      },
    });

    const result = await verifyNode(node as any, z3);
    expect(result.adversarial_checks.length).toBe(1);
    expect(result.adversarial_checks[0].status).toBe("passed");
    expect(result.verified).toBe(true);
  }, 30000);

  it("FAILS when break_if condition is SAT (result > 100 with no upper bound)", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      id: "unbounded",
      out: { result: { type: "Int" } },
      adversarial_check: {
        break_if: ["result > 100"],
      },
    });

    const result = await verifyNode(node as any, z3);
    expect(result.adversarial_checks.length).toBe(1);
    expect(result.adversarial_checks[0].status).toBe("failed");
    expect(result.adversarial_checks[0].counterexample).toBeDefined();
    expect(result.verified).toBe(false);
  }, 30000);
});

// ─── Graceful degradation ────────────────────────────────────────────────────

describe("Graceful degradation", () => {
  it("returns 'unsupported' for lambda/complex expressions, no thrown error", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      id: "unsupported_node",
      contract: {
        post: ["∀x ∈ list: x > 0"],
      },
      adversarial_check: {
        break_if: ["intersection(a, b) != empty"],
      },
    });

    const result = await verifyNode(node as any, z3);
    // Should not throw — returns results with "unsupported"
    expect(result.postconditions.length).toBe(1);
    expect(result.postconditions[0].status).toBe("unsupported");
    expect(result.adversarial_checks.length).toBe(1);
    expect(result.adversarial_checks[0].status).toBe("unsupported");
    expect(result.verified).toBe(true); // no failures, just unsupported
  }, 30000);
});

// ─── Graph-level verification ────────────────────────────────────────────────

describe("Graph verification report", () => {
  it("produces a report with correct counts", async () => {
    const graph = {
      id: "test_graph",
      version: 1,
      effects: [],
      nodes: [
        makeNode({
          id: "good_node",
          in: { x: { type: "Int" } },
          contract: { pre: ["x > 0"], post: ["x > 0"] },
        }),
        makeNode({
          id: "bad_node",
          out: { y: { type: "Int" } },
          adversarial_check: { break_if: ["y > 100"] },
        }),
      ],
      edges: [],
    };

    const report = await verifyGraph(graph as any);
    expect(report.graph_id).toBe("test_graph");
    expect(report.nodes_verified).toBe(1);
    expect(report.nodes_failed).toBe(1);
    expect(report.results.length).toBe(2);
    expect(report.verification_percentage).toBe(50);
  }, 30000);
});
