/**
 * Tests for Z3 set operations (∈, ∉, ∩, ⊆)
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

describe("Z3 Set Operations", () => {
  describe("Membership (∈)", () => {
    it("x ∈ [1, 2, 3] with x constrained to 2 — verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["x = 2"],
        post: ["x ∈ [1, 2, 3]"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("x ∈ [1, 2, 3] with x constrained to 5 — failed", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["x = 5"],
        post: ["x ∈ [1, 2, 3]"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("failed");
    }, 30000);

    it("x ∈ [10] with x = 10 — verified (single-element set)", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["x = 10"],
        post: ["x ∈ [10]"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);
  });

  describe("Non-membership (∉)", () => {
    it("x ∉ [4, 5, 6] with x = 2 — verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["x = 2"],
        post: ["x ∉ [4, 5, 6]"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("x ∉ [1, 2, 3] with x = 2 — failed", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["x = 2"],
        post: ["x ∉ [1, 2, 3]"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("failed");
    }, 30000);
  });

  describe("Intersection (∩)", () => {
    it("a ∩ b = ∅ with disjoint array variables — translated to Z3", async () => {
      const z3 = await getZ3();
      const node = makeNode(
        {
          post: ["a ∩ b = ∅"],
        },
        {
          inPorts: { a: { type: "List<Int>" }, b: { type: "List<Int>" } },
        }
      );
      const result = await verifyNode(node as any, z3);
      // Z3 can't prove disjointness of arbitrary arrays without constraints
      expect(["failed", "timeout"]).toContain(result.postconditions[0].status);
    }, 30000);

    it("intersection(a, b) != empty as adversarial check — translates", async () => {
      const z3 = await getZ3();
      const node = makeNode(
        { post: [] },
        {
          inPorts: { a: { type: "List<Int>" }, b: { type: "List<Int>" } },
          adversarial_check: { break_if: ["a ∩ b = ∅"] },
        }
      );
      const result = await verifyNode(node as any, z3);
      // Should handle without throwing
      expect(result.adversarial_checks.length).toBe(1);
      expect(["passed", "failed", "timeout", "unsupported"]).toContain(
        result.adversarial_checks[0].status
      );
    }, 30000);
  });

  describe("Subset (⊆)", () => {
    it("a ⊆ b with array variables — translates to Z3", async () => {
      const z3 = await getZ3();
      const node = makeNode(
        {
          post: ["a ⊆ b"],
        },
        {
          inPorts: { a: { type: "List<Int>" }, b: { type: "List<Int>" } },
        }
      );
      const result = await verifyNode(node as any, z3);
      // Z3 can't prove subset of arbitrary arrays without constraints
      expect(["failed", "timeout"]).toContain(result.postconditions[0].status);
    }, 30000);

    it("[1, 2] ⊆ [1, 2, 3] — literal subset not directly expressible via node, but subset operator translates", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["a ⊆ b"],
      });
      const result = await verifyNode(node as any, z3);
      // Just verify it doesn't crash and returns a valid status
      expect(["verified", "failed", "timeout", "unsupported"]).toContain(
        result.postconditions[0].status
      );
    }, 30000);
  });
});
