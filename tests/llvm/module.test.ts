import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { LLVMCodeGenerator, summarizeModule } from "../../src/compiler/llvm/codegen.js";

function loadGraph(name: string) {
  const path = `src/ir/examples/${name}.json`;
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("LLVM Module Generation", () => {
  const programs = ["user-registration", "product-recommendations", "customer-support-agent"];

  for (const name of programs) {
    describe(`Reference: ${name}`, () => {
      const graph = loadGraph(name);
      const gen = new LLVMCodeGenerator();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      it("contains define for each node", () => {
        const nodes = graph.nodes.filter((n: any) => !n.intent && !n.hole);
        for (const node of nodes) {
          const sid = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
          expect(text).toContain(`define void @aether_${sid}(%${sid}_out* sret(%${sid}_out) %sret_ptr, %${sid}_in* %inputs_ptr)`);
        }
      });

      it("contains struct definitions for all I/O types", () => {
        const nodes = graph.nodes.filter((n: any) => !n.intent && !n.hole);
        for (const node of nodes) {
          const sid = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
          expect(text).toContain(`%${sid}_in = type`);
          expect(text).toContain(`%${sid}_out = type`);
        }
      });

      it("contains @main function", () => {
        expect(text).toContain("define i32 @main()");
      });

      it("contains wave-ordered calls in main", () => {
        expect(text).toContain("; Wave 0");
        // At least 2 waves for these multi-node graphs
        expect(text).toContain("; Wave 1");
      });

      it("serialization produces valid text (no null/undefined leaks)", () => {
        expect(text).not.toContain("undefined");
        expect(text).not.toContain("[object Object]");
        // 'null' can appear in legitimate contexts (e.g., "!= null" in comments) but not as raw LLVM values
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.startsWith(";")) continue; // skip comments
          expect(line).not.toMatch(/\bnull\b/);
        }
      });

      it("summary reports correct node count", () => {
        const summary = summarizeModule(mod, text);
        const expectedNodes = graph.nodes.filter((n: any) => !n.intent && !n.hole).length;
        expect(summary.nodeCount).toBe(expectedNodes);
      });

      it("summary reports runtime dependencies", () => {
        const summary = summarizeModule(mod, text);
        expect(summary.runtimeDeps.length).toBeGreaterThan(0);
        expect(summary.runtimeDeps).toContain("aether_contract_violation");
      });
    });
  }
});
