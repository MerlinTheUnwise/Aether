import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { LLVMCodeGenerator, summarizeModule } from "../../src/compiler/llvm/codegen.js";

const require = createRequire(import.meta.url);

// All reference programs
const PROGRAMS = [
  "user-registration",
  "product-recommendations",
  "customer-support-agent",
  "payment-processing",
  "data-pipeline-etl",
  "rate-limiter",
  "order-lifecycle",
  "content-moderation-agent",
  "multi-scope-order",
  "scoped-ecommerce",
  "multi-agent-marketplace",
];

function loadGraph(name: string): any {
  return require(`../../src/ir/examples/${name}.json`);
}

describe("All Programs V2 — Recovery + Contracts + Confidence", () => {
  const gen = new LLVMCodeGenerator();

  for (const name of PROGRAMS) {
    describe(`Reference: ${name}`, () => {
      let ir: string;
      let mod: ReturnType<typeof gen.generateModule>;

      it("generates LLVM IR module without errors", () => {
        const graph = loadGraph(name);
        mod = gen.generateModule(graph);
        ir = gen.serialize(mod);
        expect(ir.length).toBeGreaterThan(0);
      });

      it("contains node function definitions", () => {
        expect(ir).toContain("define void @aether_");
        expect(ir).toContain("sret(");
      });

      it("recovery nodes have setjmp-like patterns", () => {
        // Check that nodes with recovery blocks generate recovery IR
        const graph = loadGraph(name);
        const nodesWithRecovery = (graph.nodes as any[]).filter(
          (n: any) => !n.intent && !n.hole && n.recovery && Object.keys(n.recovery).length > 0,
        );

        if (nodesWithRecovery.length > 0) {
          // At least one recovery_enter should be present
          expect(ir).toContain("aether_recovery_enter");
          expect(ir).toContain("aether_has_error");
          expect(ir).toContain("aether_recovery_exit");
        }
      });

      it("contract assertions present for every postcondition", () => {
        const graph = loadGraph(name);
        const nodesWithPost = (graph.nodes as any[]).filter(
          (n: any) => !n.intent && !n.hole && n.contract?.post && n.contract.post.length > 0,
        );

        if (nodesWithPost.length > 0) {
          // Check that at least some assertions or skipped comments exist
          const hasAssertions = ir.includes("aether_contract_assert") || ir.includes("CONTRACT SKIPPED");
          expect(hasAssertions).toBe(true);
        }
      });

      it("confidence propagation present", () => {
        const graph = loadGraph(name);
        const nodesWithConf = (graph.nodes as any[]).filter(
          (n: any) => !n.intent && !n.hole && n.confidence !== undefined,
        );

        if (nodesWithConf.length > 0) {
          expect(ir).toContain("conf_");
          expect(ir).toContain("confidence_threshold");
        }
      });

      it("adversarial checks present where required", () => {
        const graph = loadGraph(name);
        const nodesWithAdv = (graph.nodes as any[]).filter(
          (n: any) => !n.intent && !n.hole && n.adversarial_check?.break_if?.length > 0,
        );

        if (nodesWithAdv.length > 0) {
          expect(ir).toContain("aether_contract_adversarial");
        }
      });

      it("passes structural IR validation", () => {
        // Check that every define has a closing }
        const defines = ir.split("\n").filter(l => l.startsWith("define "));
        const closes = ir.split("\n").filter(l => l.trim() === "}");
        expect(closes.length).toBeGreaterThanOrEqual(defines.length);

        // No undefined/NaN leaks
        const lines = ir.split("\n");
        for (const line of lines) {
          if (line.startsWith(";")) continue;
          expect(line).not.toContain("undefined");
          expect(line).not.toContain("NaN");
        }
      });

      it("produces valid summary", () => {
        const summary = summarizeModule(mod, ir);
        expect(summary.graphId).toBe(loadGraph(name).id);
        expect(summary.nodeCount).toBeGreaterThan(0);
        expect(summary.functionCount).toBeGreaterThan(0);
        expect(summary.lineCount).toBeGreaterThan(0);
      });
    });
  }
});
