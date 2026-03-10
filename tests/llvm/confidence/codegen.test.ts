import { describe, it, expect } from "vitest";
import { LLVMCodeGenerator } from "../../../src/compiler/llvm/codegen.js";
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

describe("Confidence Gate Code Generation", () => {
  const gen = new LLVMCodeGenerator();

  describe("confidence propagation", () => {
    it("generates fmul + aether_confidence_set", () => {
      const node = makeNode({
        id: "analyze_data",
        in: { data: { type: "String" } },
        out: { result: { type: "String" } },
        confidence: 0.85,
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("fmul double");
      expect(ir).toContain("aether_confidence_set");
      expect(ir).toContain("0.85");
    });

    it("propagates confidence using input confidence", () => {
      const node = makeNode({
        id: "process",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        confidence: 0.95,
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_confidence_get");
      expect(ir).toContain("fmul double");
      expect(ir).toContain("aether_confidence_set");
    });
  });

  describe("confidence gate", () => {
    it("generates fcmp + branch to skip/execute", () => {
      const node = makeNode({
        id: "risky_node",
        in: { input: { type: "String" } },
        out: { output: { type: "String" } },
        confidence: 0.80,
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("fcmp ogt double");
      expect(ir).toContain("gate_check_");
      expect(ir).toContain("execute_node_");
      expect(ir).toContain("skip_node_");
    });

    it("branches to skip_node when confidence below threshold", () => {
      const node = makeNode({
        id: "uncertain",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        confidence: 0.60,
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("skip_node_");
      expect(ir).toContain("br i1 %gate_check_");
    });
  });

  describe("skipped node", () => {
    it("generates aether_log_skip call", () => {
      const node = makeNode({
        id: "low_conf_node",
        in: { data: { type: "String" } },
        out: { result: { type: "Bool" } },
        confidence: 0.50,
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_log_skip");
      expect(ir).toContain("skip_node_");
    });
  });

  describe("no confidence annotation", () => {
    it("does not generate confidence gate when confidence is undefined", () => {
      const node = makeNode({
        id: "simple_node",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        // confidence: undefined (not set)
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).not.toContain("gate_check_");
      expect(ir).not.toContain("skip_node_");
      expect(ir).not.toContain("aether_log_skip");
      expect(ir).not.toContain("execute_node_");
    });
  });

  describe("confidence with threshold", () => {
    it("compares against 0.7 threshold", () => {
      const node = makeNode({
        id: "gated_node",
        in: { input: { type: "String" } },
        out: { output: { type: "Bool" } },
        confidence: 0.90,
      });

      const ir = gen.generateNodeFunction(node);
      // The gate checks if propagated confidence > 0.7
      expect(ir).toContain("fcmp ogt double");
      expect(ir).toContain("0.7");
    });
  });

  describe("module-level confidence", () => {
    it("generates confidence globals for all nodes", () => {
      const graph = {
        id: "test_graph",
        version: 1,
        effects: [],
        nodes: [
          makeNode({ id: "node_a", in: { x: { type: "Int" } }, out: { y: { type: "Int" } }, confidence: 0.95 }),
          makeNode({ id: "node_b", in: { y: { type: "Int" } }, out: { z: { type: "Int" } }, confidence: 0.80 }),
        ],
        edges: [{ from: "node_a.y", to: "node_b.y" }],
      };

      const mod = gen.generateModule(graph);
      const serialized = gen.serialize(mod);
      expect(serialized).toContain("@conf_node_a");
      expect(serialized).toContain("@conf_node_b");
      expect(serialized).toContain("confidence_threshold");
    });
  });
});
