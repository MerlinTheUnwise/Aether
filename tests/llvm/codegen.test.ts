import { describe, it, expect } from "vitest";
import { LLVMCodeGenerator, contractToLLVM } from "../../src/compiler/llvm/codegen.js";
import type { AetherNode } from "../../src/compiler/llvm/types.js";

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

describe("LLVM Code Generator", () => {
  describe("Contract → LLVM IR", () => {
    it("x > 0 → icmp sgt", () => {
      const vars = new Map([["x", { varName: "%x", llvmType: "i64" }]]);
      const result = contractToLLVM("x > 0", vars, { value: 0 });
      expect(result.supported).toBe(true);
      const ir = result.instructions.join("\n");
      expect(ir).toContain("icmp sgt i64");
    });

    it("a == b → icmp eq", () => {
      const vars = new Map([
        ["a", { varName: "%a", llvmType: "i64" }],
        ["b", { varName: "%b", llvmType: "i64" }],
      ]);
      const result = contractToLLVM("a == b", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("icmp eq");
    });

    it("a ∧ b → and i1", () => {
      const vars = new Map([
        ["a", { varName: "%a", llvmType: "i1" }],
        ["b", { varName: "%b", llvmType: "i1" }],
      ]);
      const result = contractToLLVM("a > 0 ∧ b > 0", vars, { value: 0 });
      // If both a and b are i1, the sub-contracts may not resolve, but the ∧ should be handled
      expect(result.instructions.join("\n")).toContain("and i1");
    });

    it("a ∨ b → or i1", () => {
      const vars = new Map([
        ["a", { varName: "%a", llvmType: "i1" }],
        ["b", { varName: "%b", llvmType: "i1" }],
      ]);
      const result = contractToLLVM("a > 0 ∨ b > 0", vars, { value: 0 });
      expect(result.instructions.join("\n")).toContain("or i1");
    });

    it("¬a → xor i1", () => {
      const vars = new Map([["a", { varName: "%a", llvmType: "i1" }]]);
      const result = contractToLLVM("¬a > 0", vars, { value: 0 });
      expect(result.instructions.join("\n")).toContain("xor i1");
    });

    it("unsupported contract → skip comment", () => {
      const vars = new Map<string, { varName: string; llvmType: string }>();
      const result = contractToLLVM("forall(p, list, p > 0)", vars, { value: 0 });
      expect(result.supported).toBe(false);
      expect(result.instructions.join("\n")).toContain("CONTRACT SKIPPED");
      expect(result.instructions.join("\n")).toContain("Z3");
    });

    it("x.length > 0 → string_length call + icmp", () => {
      const vars = new Map([["x", { varName: "%x", llvmType: "%String*" }]]);
      const result = contractToLLVM("x.length > 0", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("aether_string_length");
      expect(result.instructions.join("\n")).toContain("icmp sgt");
    });

    it("x.is_lowercase → string property call", () => {
      const vars = new Map([["x", { varName: "%x", llvmType: "%String*" }]]);
      const result = contractToLLVM("x.is_lowercase", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("aether_string_is_lowercase");
    });

    it("float comparison → fcmp", () => {
      const vars = new Map([["score", { varName: "%score", llvmType: "double" }]]);
      const result = contractToLLVM("score > 0.5", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("fcmp ogt double");
    });

    it("boolean comparison → icmp with 1/0", () => {
      const vars = new Map([["unique", { varName: "%unique", llvmType: "i1" }]]);
      const result = contractToLLVM("unique == true", vars, { value: 0 });
      expect(result.supported).toBe(true);
      expect(result.instructions.join("\n")).toContain("icmp eq i1");
    });
  });

  describe("Node function generation", () => {
    it("generates valid LLVM function for pure node", () => {
      const gen = new LLVMCodeGenerator();
      const node = makeNode({
        id: "add_numbers",
        in: { a: { type: "Int" }, b: { type: "Int" } },
        out: { sum: { type: "Int" } },
        contract: { pre: ["a > 0"], post: ["sum > 0"] },
        pure: true,
        confidence: 0.99,
      });
      const ir = gen.generateNodeFunction(node);

      expect(ir).toContain("define %add_numbers_out @aether_add_numbers");
      expect(ir).toContain("extractvalue");
      expect(ir).toContain("ret %add_numbers_out");
      expect(ir).toContain("icmp sgt"); // a > 0 precondition
    });

    it("generates function with precondition branch", () => {
      const gen = new LLVMCodeGenerator();
      const node = makeNode({
        id: "validate",
        in: { email: { type: "String" } },
        out: { valid: { type: "Bool" } },
        contract: { pre: ["email.length > 0"] },
      });
      const ir = gen.generateNodeFunction(node);

      expect(ir).toContain("br i1");
      expect(ir).toContain("pre_fail:");
      expect(ir).toContain("aether_contract_violation");
      expect(ir).toContain("unreachable");
      expect(ir).toContain("body:");
    });

    it("generates function with postcondition check", () => {
      const gen = new LLVMCodeGenerator();
      const node = makeNode({
        id: "normalize",
        in: { text: { type: "String" } },
        out: { normalized: { type: "String" } },
        contract: { post: ["normalized.is_lowercase"] },
      });
      const ir = gen.generateNodeFunction(node);

      expect(ir).toContain("post_fail:");
      expect(ir).toContain("done:");
    });

    it("effectful node generates same function structure", () => {
      const gen = new LLVMCodeGenerator();
      const node = makeNode({
        id: "write_db",
        in: { data: { type: "String" } },
        out: { success: { type: "Bool" } },
        effects: ["database.write"],
        pure: false,
      });
      const ir = gen.generateNodeFunction(node);

      expect(ir).toContain("define %write_db_out @aether_write_db");
      expect(ir).toContain("; Pure: false");
    });

    it("loads implementation function pointer", () => {
      const gen = new LLVMCodeGenerator();
      const node = makeNode({
        id: "process",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
      });
      const ir = gen.generateNodeFunction(node);

      expect(ir).toContain("@impl_process");
      expect(ir).toContain("load");
      expect(ir).toContain("call");
    });

    it("skips unsupported contracts with Z3 comment", () => {
      const gen = new LLVMCodeGenerator();
      const node = makeNode({
        id: "recommend",
        in: { items: { type: "List<Int>" } },
        out: { result: { type: "List<Int>" } },
        contract: { post: ["forall(p, result, p > 0)"] },
      });
      const ir = gen.generateNodeFunction(node);

      expect(ir).toContain("CONTRACT SKIPPED");
      expect(ir).toContain("Z3");
    });
  });

  describe("Module generation", () => {
    it("generates complete module for simple graph", () => {
      const gen = new LLVMCodeGenerator();
      const graph = {
        id: "test_graph",
        version: 1,
        effects: [],
        nodes: [
          makeNode({
            id: "a",
            in: { x: { type: "Int" } },
            out: { y: { type: "Int" } },
          }),
          makeNode({
            id: "b",
            in: { y: { type: "Int" } },
            out: { z: { type: "Int" } },
          }),
        ],
        edges: [{ from: "a.y", to: "b.y" }],
      };

      const mod = gen.generateModule(graph);

      expect(mod.name).toBe("test_graph");
      expect(mod.structs.length).toBeGreaterThan(0);
      expect(mod.functions.length).toBeGreaterThanOrEqual(3); // a, b, main
      expect(mod.declarations.length).toBeGreaterThan(0);
    });

    it("serializes module to valid text", () => {
      const gen = new LLVMCodeGenerator();
      const graph = {
        id: "serial_test",
        version: 1,
        effects: [],
        nodes: [
          makeNode({
            id: "n1",
            in: { x: { type: "Int" } },
            out: { y: { type: "Int" } },
          }),
        ],
        edges: [],
      };

      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      expect(text).toContain("; ModuleID = 'serial_test'");
      expect(text).toContain("define");
      expect(text).toContain("@main");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
    });
  });
});
