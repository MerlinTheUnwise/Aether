import { describe, it, expect } from "vitest";
import { generateConfidenceGlobals, generateConfidenceCode, generateConfidenceResultStruct } from "../../src/compiler/llvm/confidence.js";
import type { AetherNode } from "../../src/compiler/llvm/types.js";

function makeNode(overrides: Partial<AetherNode> & { id: string }): AetherNode {
  return {
    in: {}, out: {}, contract: {}, effects: [], pure: true,
    ...overrides,
  };
}

describe("LLVM Confidence Tracking", () => {
  describe("Confidence globals", () => {
    it("generates per-node confidence global", () => {
      const nodes = [makeNode({ id: "validate", confidence: 0.99 })];
      const globals = generateConfidenceGlobals(nodes);
      expect(globals.some(g => g.includes("@conf_validate") && g.includes("0.99"))).toBe(true);
    });

    it("generates threshold global", () => {
      const nodes = [makeNode({ id: "n" })];
      const globals = generateConfidenceGlobals(nodes);
      expect(globals.some(g => g.includes("@confidence_threshold") && g.includes("0.7"))).toBe(true);
    });

    it("defaults to 1.0 confidence when unspecified", () => {
      const nodes = [makeNode({ id: "n" })];
      const globals = generateConfidenceGlobals(nodes);
      expect(globals.some(g => g.includes("@conf_n") && g.includes("1.0"))).toBe(true);
    });

    it("generates globals for multiple nodes", () => {
      const nodes = [
        makeNode({ id: "a", confidence: 0.95 }),
        makeNode({ id: "b", confidence: 0.80 }),
      ];
      const globals = generateConfidenceGlobals(nodes);
      expect(globals.some(g => g.includes("@conf_a"))).toBe(true);
      expect(globals.some(g => g.includes("@conf_b"))).toBe(true);
    });
  });

  describe("Confidence code generation", () => {
    it("generates fmul multiplication instruction", () => {
      const node = makeNode({ id: "validate", confidence: 0.99 });
      const code = generateConfidenceCode(node, "validate");
      expect(code).not.toBeNull();
      expect(code).toContain("fmul double");
    });

    it("generates fcmp threshold comparison", () => {
      const node = makeNode({ id: "check", confidence: 0.85 });
      const code = generateConfidenceCode(node, "check");
      expect(code).toContain("fcmp olt double");
    });

    it("stores oversight boolean result", () => {
      const node = makeNode({ id: "decide", confidence: 0.75 });
      const code = generateConfidenceCode(node, "decide");
      expect(code).toContain("needs_oversight_decide");
    });

    it("loads node confidence from global", () => {
      const node = makeNode({ id: "process", confidence: 0.90 });
      const code = generateConfidenceCode(node, "process");
      expect(code).toContain("load double, double* @conf_process");
    });

    it("calls min_confidence runtime helper", () => {
      const node = makeNode({ id: "merge", confidence: 0.80 });
      const code = generateConfidenceCode(node, "merge");
      expect(code).toContain("aether_min_confidence");
    });
  });

  describe("Confidence result struct", () => {
    it("generates struct pairing output with confidence", () => {
      const s = generateConfidenceResultStruct("validate_email");
      expect(s).toContain("%validate_email_result_with_conf = type");
      expect(s).toContain("%validate_email_out");
      expect(s).toContain("%ConfidenceValue");
    });
  });
});
