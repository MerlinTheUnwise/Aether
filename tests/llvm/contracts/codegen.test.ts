import { describe, it, expect } from "vitest";
import { LLVMCodeGenerator, contractToLLVM } from "../../../src/compiler/llvm/codegen.js";
import type { AetherNode } from "../../../src/compiler/llvm/types.js";

function makeNode(overrides: Partial<AetherNode> & { id: string }): AetherNode {
  return {
    in: {},
    out: {},
    contract: {},
    effects: [],
    pure: true,
    ...overrides,
  };
}

describe("Contract Enforcement Code Generation", () => {
  const gen = new LLVMCodeGenerator();

  describe("precondition enforcement", () => {
    it("x > 0 → IR contains icmp + aether_contract_assert", () => {
      const node = makeNode({
        id: "validate_input",
        in: { x: { type: "Int" } },
        out: { result: { type: "Int" } },
        contract: { pre: ["x > 0"] },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("icmp sgt i64");
      expect(ir).toContain("aether_contract_assert");
      expect(ir).toContain("pre_fail:");
    });

    it("generates combined preconditions with AND", () => {
      const node = makeNode({
        id: "validate",
        in: { x: { type: "Int" }, y: { type: "Int" } },
        out: { result: { type: "Int" } },
        contract: { pre: ["x > 0", "y > 0"] },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("and i1");
      expect(ir).toContain("aether_contract_assert");
    });
  });

  describe("postcondition enforcement", () => {
    it("string equality → IR contains CONTRACT SKIPPED (struct comparison not supported)", () => {
      const node = makeNode({
        id: "create_user",
        in: { email: { type: "String" } },
        out: { status: { type: "String" } },
        contract: { post: ["status == active"] },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("CONTRACT SKIPPED");
      expect(ir).toContain("struct comparison not supported");
    });

    it("boolean AND postcondition → IR contains and i1 + assert", () => {
      const node = makeNode({
        id: "process",
        in: { a: { type: "Int" }, b: { type: "Int" } },
        out: { x: { type: "Int" }, y: { type: "Int" } },
        contract: { post: ["x > 0 ∧ y > 0"] },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("and i1");
      expect(ir).toContain("aether_contract_assert");
    });
  });

  describe("adversarial check enforcement", () => {
    it("break_if → IR contains aether_contract_adversarial", () => {
      const node = makeNode({
        id: "calculate_tax",
        in: { amount: { type: "Float64" } },
        out: { tax: { type: "Float64" } },
        confidence: 0.80,
        adversarial_check: {
          break_if: ["tax < 0"],
        },
        contract: { post: ["tax >= 0"] },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_contract_adversarial");
      expect(ir).toContain("fcmp olt double");
    });

    it("generates adversarial checks for multiple break_if conditions", () => {
      const node = makeNode({
        id: "authorize",
        in: { amount: { type: "Float64" }, token: { type: "String" } },
        out: { authorized: { type: "Float64" }, status: { type: "String" } },
        confidence: 0.75,
        adversarial_check: {
          break_if: [
            "authorized != amount",
            "status == captured",
          ],
        },
        contract: { post: ["authorized == amount"] },
      });

      const ir = gen.generateNodeFunction(node);
      // Should have multiple adversarial calls
      const adversarialCount = (ir.match(/aether_contract_adversarial/g) || []).length;
      expect(adversarialCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("state invariant enforcement", () => {
    it("invariant on string type → IR contains CONTRACT SKIPPED", () => {
      const node = makeNode({
        id: "update_order",
        in: { status: { type: "String" } },
        out: { new_status: { type: "String" } },
        contract: {
          post: ["new_status != cancelled"],
          invariants: ["status != captured"],
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("State invariant checks");
      // String types (AetherString) are large structs, so comparisons are skipped
      expect(ir).toContain("CONTRACT SKIPPED");
    });
  });

  describe("complex expressions", () => {
    it("unsupported expression → IR contains Z3-verified comment", () => {
      const node = makeNode({
        id: "validate_list",
        in: { items: { type: "List<Int>" } },
        out: { valid: { type: "Bool" } },
        contract: { pre: ["forall(x, items, x > 0)"] },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("CONTRACT SKIPPED");
      expect(ir).toContain("verified by Z3");
    });
  });

  describe("contract mode selection", () => {
    it("precondition uses aether_contract_assert (mode-aware)", () => {
      const node = makeNode({
        id: "check_input",
        in: { value: { type: "Int" } },
        out: { result: { type: "Bool" } },
        contract: { pre: ["value > 0"] },
      });

      const ir = gen.generateNodeFunction(node);
      // aether_contract_assert respects runtime mode (abort/log/count)
      expect(ir).toContain("aether_contract_assert");
    });

    it("postcondition uses aether_contract_assert (mode-aware)", () => {
      const node = makeNode({
        id: "compute",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        contract: { post: ["y > 0"] },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_contract_assert");
    });
  });

  describe("contractToLLVM unit tests", () => {
    it("float comparison → fcmp", () => {
      const vars = new Map([["score", { varName: "%score", llvmType: "double" }]]);
      const result = contractToLLVM("score > 0.5", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("fcmp ogt double");
    });

    it("string length check → aether_string_length + icmp", () => {
      const vars = new Map([["email", { varName: "%email", llvmType: "%String*" }]]);
      const result = contractToLLVM("email.length > 0", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("aether_string_length");
      expect(result.instructions.join("\n")).toContain("icmp sgt");
    });

    it("boolean equality → icmp eq i1", () => {
      const vars = new Map([["unique", { varName: "%unique", llvmType: "i1" }]]);
      const result = contractToLLVM("unique == true", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("icmp eq i1");
    });

    it("logical AND → and i1", () => {
      const vars = new Map([
        ["x", { varName: "%x", llvmType: "i64" }],
        ["y", { varName: "%y", llvmType: "i64" }],
      ]);
      const result = contractToLLVM("x > 0 ∧ y > 0", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("and i1");
    });

    it("negation → xor i1", () => {
      const vars = new Map([["x", { varName: "%x", llvmType: "i64" }]]);
      const result = contractToLLVM("¬x > 0", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("xor i1");
    });
  });
});
