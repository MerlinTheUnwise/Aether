/**
 * Tests for enhanced expression parser in AETHER verifier
 */
import { describe, it, expect } from "vitest";
import { verifyNode, getZ3 } from "../../src/compiler/verifier.js";

function makeNode(contract: { pre?: string[]; post?: string[] }, opts: {
  inPorts?: Record<string, { type: string }>;
  outPorts?: Record<string, { type: string }>;
} = {}) {
  return {
    id: "test_node",
    in: opts.inPorts ?? { x: { type: "Int" } },
    out: opts.outPorts ?? { result: { type: "Int" } },
    contract,
    effects: [],
    pure: true,
  };
}

describe("Enhanced Expression Parser", () => {
  it("chained comparison: 0 ≤ x ≤ 100", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      pre: ["0 ≤ x ≤ 100"],
      post: ["x >= 0"],
    });
    const result = await verifyNode(node, z3);
    // x >= 0 should be verified given 0 ≤ x ≤ 100
    const postResult = result.postconditions.find(p => p.expression === "x >= 0");
    expect(postResult).toBeDefined();
    expect(postResult!.status).toBe("verified");
  });

  it("chained comparison: 0 <= x <= 100 (ASCII form)", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      pre: ["0 <= x <= 100"],
      post: ["x >= 0"],
    });
    const result = await verifyNode(node, z3);
    const postResult = result.postconditions.find(p => p.expression === "x >= 0");
    expect(postResult).toBeDefined();
    expect(postResult!.status).toBe("verified");
  });

  it("implication: a → b", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      pre: ["x > 10"],
      post: ["x > 10 → x > 5"],
    }, { inPorts: { x: { type: "Int" } }, outPorts: { result: { type: "Bool" } } });
    const result = await verifyNode(node, z3);
    const postResult = result.postconditions.find(p => p.expression === "x > 10 → x > 5");
    expect(postResult).toBeDefined();
    // If x > 10, then x > 5 is always true — should be verified
    expect(postResult!.status).toBe("verified");
  });

  it("list.length > 0 parses as integer comparison", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      pre: ["list.length > 0"],
      post: ["list.length >= 1"],
    }, { inPorts: { list: { type: "List" } }, outPorts: { result: { type: "Bool" } } });
    const result = await verifyNode(node, z3);
    // list_length > 0 → list_length >= 1 should be verified
    const postResult = result.postconditions.find(p => p.expression === "list.length >= 1");
    expect(postResult).toBeDefined();
    expect(postResult!.status).toBe("verified");
  });

  it("string equality: status = \"active\" returns unsupported or verified gracefully", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      post: ["status = \"active\""],
    }, {
      inPorts: { status: { type: "String" } },
      outPorts: { result: { type: "String" } },
    });
    const result = await verifyNode(node, z3);
    // This should either be verified, failed, or unsupported — never throw
    const postResult = result.postconditions[0];
    expect(postResult).toBeDefined();
    expect(["verified", "failed", "unsupported"]).toContain(postResult.status);
  });

  it("graceful degradation: unsupported expressions don't throw", async () => {
    const z3 = await getZ3();
    const node = makeNode({
      post: ["∀x ∈ list: x > 0", "items ∩ excluded = ∅"],
    });
    const result = await verifyNode(node, z3);
    for (const p of result.postconditions) {
      expect(p.status).toBe("unsupported");
    }
  });
});
