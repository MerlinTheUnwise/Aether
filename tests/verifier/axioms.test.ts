/**
 * Tests for axiom-based Z3 verification.
 * Axioms are implementation guarantees that Z3 assumes as true,
 * enabling it to prove postconditions.
 */

import { describe, it, expect } from "vitest";
import { verifyNode, getZ3 } from "../../src/compiler/verifier.js";

function makeNode(overrides: Record<string, any>) {
  return {
    id: "test_node",
    in: {},
    out: {},
    contract: { post: [] },
    effects: [],
    ...overrides,
  };
}

describe("Axiom-based verification", () => {
  it("node with matching axiom and postcondition → VERIFIED (UNSAT)", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      out: { x: { type: "Bool" } },
      axioms: ["x = true"],
      contract: { post: ["x == true"] },
    });

    const result = await verifyNode(node, z3);
    expect(result.postconditions[0].status).toBe("verified");
  });

  it("node without axioms → FAILED (SAT) for non-trivial postcondition", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      out: { x: { type: "Bool" } },
      contract: { post: ["x == true"] },
    });

    const result = await verifyNode(node, z3);
    expect(result.postconditions[0].status).toBe("failed");
  });

  it("multiple axioms prove multiple postconditions", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      out: {
        status: { type: "String" },
        count: { type: "Int" },
      },
      axioms: ["status = active", "count > 0"],
      contract: { post: ["status == active", "count > 0"] },
    });

    const result = await verifyNode(node, z3);
    expect(result.postconditions).toHaveLength(2);
    expect(result.postconditions[0].status).toBe("verified");
    expect(result.postconditions[1].status).toBe("verified");
  });

  it("axiom that does NOT imply postcondition → FAILED with counterexample", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      out: { x: { type: "Int" }, y: { type: "Int" } },
      axioms: ["x > 0"],
      contract: { post: ["y > 0"] },
    });

    const result = await verifyNode(node, z3);
    expect(result.postconditions[0].status).toBe("failed");
    expect(result.postconditions[0].counterexample).toBeDefined();
  });

  it("axioms work with preconditions combined", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      in: { amount: { type: "Float64" } },
      out: { validated_amount: { type: "Float64" }, status: { type: "String" } },
      axioms: ["validated_amount = amount", "status = created"],
      contract: {
        pre: ["amount > 0"],
        post: ["validated_amount == amount", "status == created"],
      },
    });

    const result = await verifyNode(node, z3);
    expect(result.postconditions[0].status).toBe("verified");
    expect(result.postconditions[1].status).toBe("verified");
  });

  it("upstream axioms propagated via edge → downstream postcondition proved", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      id: "downstream",
      in: { value: { type: "Int" } },
      out: { result: { type: "Int" } },
      axioms: ["result = value"],
      contract: { post: ["result > 0"] },
    });

    // Upstream axiom says value > 0
    const upstreamAxioms = new Map<string, string[]>();
    upstreamAxioms.set("value", ["value > 0"]);

    const result = await verifyNode(node, z3, upstreamAxioms);
    expect(result.postconditions[0].status).toBe("verified");
  });

  it("boolean axioms prove boolean postconditions", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      out: {
        normalized: { type: "String" },
      },
      axioms: [
        "normalized.is_lowercase = true",
        "normalized.is_trimmed = true",
      ],
      contract: {
        post: ["normalized.is_lowercase", "normalized.is_trimmed"],
      },
    });

    const result = await verifyNode(node, z3);
    expect(result.postconditions[0].status).toBe("verified");
    expect(result.postconditions[1].status).toBe("verified");
  });

  it("numeric inequality axiom proves inequality postcondition", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      out: { count: { type: "Int" } },
      axioms: ["count >= 0"],
      contract: { post: ["count >= 0"] },
    });

    const result = await verifyNode(node, z3);
    expect(result.postconditions[0].status).toBe("verified");
  });
});
