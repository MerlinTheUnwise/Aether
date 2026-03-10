/**
 * Tests for Z3 property predicates (list.distinct, list.is_sorted, list.length)
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
  } = {}
) {
  return {
    id: opts.id ?? "test_node",
    in: opts.inPorts ?? { list: { type: "List<Int>" } },
    out: opts.outPorts ?? { result: { type: "List<Int>" } },
    contract,
    effects: [],
    pure: true,
  };
}

describe("Z3 Property Predicates", () => {
  describe("list.distinct", () => {
    it("list.distinct translates to Z3 pairwise inequality", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["list.distinct"],
      });
      const result = await verifyNode(node as any, z3);
      // Without constraints on the list, Z3 can't prove distinctness
      expect(["failed", "timeout"]).toContain(result.postconditions[0].status);
    }, 30000);

    it("list.distinct with constrained distinct elements — verified", async () => {
      const z3 = await getZ3();
      // Use the translator directly to test the expression translates
      const node = makeNode({
        post: ["list.distinct"],
        pre: ["list.distinct"],  // Assert as precondition, verify as postcondition
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);
  });

  describe("list.is_sorted", () => {
    it("list.is_sorted translates to Z3 pairwise ordering", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        post: ["list.is_sorted"],
      });
      const result = await verifyNode(node as any, z3);
      // Without constraints, Z3 can't prove sorted
      expect(["failed", "timeout"]).toContain(result.postconditions[0].status);
    }, 30000);

    it("list.is_sorted with sorted precondition — verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["list.is_sorted"],
        post: ["list.is_sorted"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);
  });

  describe("list.length", () => {
    it("list.length > 0 — translates and verifies with precondition", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["list.length > 0"],
        post: ["list.length >= 1"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("list.length >= 0 — always true (integers)", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["list.length >= 0"],
        post: ["list.length >= 0"],
      });
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("list.size works as alias for list.length", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["list.size > 5"],
        post: ["list.size >= 5"],
      });
      const result = await verifyNode(node as any, z3);
      // size is modeled as the same length variable
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);
  });

  describe("list.has_duplicates", () => {
    it("list.has_duplicates is negation of distinct", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        pre: ["list.distinct"],
        // If distinct is true, has_duplicates should be false
        post: ["list.has_duplicates"],
      });
      const result = await verifyNode(node as any, z3);
      // distinct → ¬has_duplicates → postcondition (has_duplicates) is false → failed
      expect(result.postconditions[0].status).toBe("failed");
    }, 30000);
  });

  describe("String properties", () => {
    it("x.is_lowercase modeled as boolean constant", async () => {
      const z3 = await getZ3();
      const node = makeNode(
        {
          pre: ["x.is_lowercase"],
          post: ["x.is_lowercase"],
        },
        { inPorts: { x: { type: "String" } } }
      );
      const result = await verifyNode(node as any, z3);
      // Boolean constant asserted true in pre, verified in post
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);

    it("x.is_trimmed modeled as boolean constant", async () => {
      const z3 = await getZ3();
      const node = makeNode(
        {
          pre: ["x.is_trimmed"],
          post: ["x.is_trimmed"],
        },
        { inPorts: { x: { type: "String" } } }
      );
      const result = await verifyNode(node as any, z3);
      expect(result.postconditions[0].status).toBe("verified");
    }, 30000);
  });
});
