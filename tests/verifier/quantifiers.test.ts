/**
 * Tests for Z3 quantifier support (∀, ∃)
 * Phase 6 Session 2 — Deliverable 7
 */
import { describe, it, expect } from "vitest";
import { verifyNode, getZ3 } from "../../src/compiler/verifier.js";

function makeNode(
  contract: { pre?: string[]; post?: string[] },
  opts: {
    id?: string;
    inPorts?: Record<string, { type: string }>;
    outPorts?: Record<string, { type: string }>;
    adversarial_check?: { break_if: string[] };
  } = {}
) {
  return {
    id: opts.id ?? "test_node",
    in: opts.inPorts ?? { x: { type: "Int" } },
    out: opts.outPorts ?? { result: { type: "Int" } },
    contract,
    effects: [],
    pure: true,
    adversarial_check: opts.adversarial_check,
  };
}

describe("Z3 Quantifier Support", () => {
  describe("Universal quantifier (∀)", () => {
    it("∀x ∈ [1,2,3]: x > 0 — Z3 proves (all positive)", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∀x ∈ [1, 2, 3]: x > 0"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("∀x ∈ [1,-2,3]: x > 0 — Z3 finds counterexample (-2)", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∀x ∈ [1, -2, 3]: x > 0"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("failed");
    }, 30000);

    it("∀x ∈ [2,4,6]: x > 1 — Z3 proves", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∀x ∈ [2, 4, 6]: x > 1"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("∀x ∈ [10, 20, 30]: x >= 10 — verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∀x ∈ [10, 20, 30]: x >= 10"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("forall with variable collection uses bounded array theory", async () => {
      const z3 = await getZ3();
      const node = makeNode(
        {
          pre: ["list.length > 0"],
          post: ["∀x ∈ list: x > 0"],
        },
        { inPorts: { list: { type: "List<Int>" } } }
      );
      const result = await verifyNode(node as any, z3);
      // With unbounded list, Z3 can't prove all elements > 0 — should be failed
      expect(["failed", "timeout"]).toContain(result.postconditions[0].status);
    }, 30000);
  });

  describe("Existential quantifier (∃)", () => {
    it("∃x ∈ [1,2,3]: x > 2 — Z3 proves (3 exists)", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∃x ∈ [1, 2, 3]: x > 2"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("∃x ∈ [1,2,3]: x > 5 — Z3 disproves", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∃x ∈ [1, 2, 3]: x > 5"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("failed");
    }, 30000);

    it("∃x ∈ [1,2,3]: x = 2 — Z3 proves (2 exists)", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∃x ∈ [1, 2, 3]: x = 2"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("∃x ∈ []: x > 0 — empty collection, false", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∃x ∈ []: x > 0"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("failed");
    }, 30000);
  });

  describe("Quantifier with membership predicates", () => {
    it("∀p ∈ [1,2]: p ∉ [3,4] — disjoint sets, verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∀p ∈ [1, 2]: p ∉ [3, 4]"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("∀p ∈ [1,2,3]: p ∉ [2,4] — overlapping, failed", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["∀p ∈ [1, 2, 3]: p ∉ [2, 4]"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("failed");
    }, 30000);
  });
});
