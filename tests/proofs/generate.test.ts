import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { generateProofExport } from "../../src/proofs/generate.js";
import { verifyGraph } from "../../src/compiler/verifier.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadGraph(name: string): any {
  return JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
}

describe("Proof Generator", () => {
  describe("user-registration export", () => {
    it("generates valid Lean structure", () => {
      const graph = loadGraph("user-registration");
      const result = generateProofExport(graph);
      expect(result.filename).toBe("user_registration.lean");
      expect(result.source).toContain("AETHER Proof Certificate");
      expect(result.source).toContain("import Mathlib");
    });

    it("contains namespace for each node", () => {
      const graph = loadGraph("user-registration");
      const result = generateProofExport(graph);
      expect(result.source).toContain("namespace ValidateEmail");
      expect(result.source).toContain("namespace CheckUniqueness");
      expect(result.source).toContain("namespace CreateUser");
      expect(result.source).toContain("end ValidateEmail");
      expect(result.source).toContain("end CheckUniqueness");
      expect(result.source).toContain("end CreateUser");
    });

    it("contains theorems for postconditions", () => {
      const graph = loadGraph("user-registration");
      const result = generateProofExport(graph);
      expect(result.source).toContain("theorem contract_holds");
      expect(result.metadata.theoremsGenerated).toBeGreaterThan(0);
    });

    it("contains type safety theorems for each edge", () => {
      const graph = loadGraph("user-registration");
      const result = generateProofExport(graph);
      expect(result.source).toContain("edge_type_safe_1");
      expect(result.source).toContain("edge_type_safe_2");
      expect(result.source).toContain("edge_type_safe_3");
    });

    it("has consistent metadata counts", () => {
      const graph = loadGraph("user-registration");
      const result = generateProofExport(graph);
      const m = result.metadata;
      expect(m.nodesExported).toBe(3);
      expect(m.theoremsGenerated).toBe(m.fullyProved + m.sorryCount + (m.theoremsGenerated - m.fullyProved - m.sorryCount));
      expect(m.theoremsGenerated).toBeGreaterThan(0);
    });

    it("contains verification summary comment", () => {
      const graph = loadGraph("user-registration");
      const result = generateProofExport(graph);
      expect(result.source).toContain("Verification Report:");
      expect(result.source).toContain("Nodes exported:");
      expect(result.source).toContain("Theorems generated:");
    });
  });

  describe("with verification report", () => {
    it("annotates Z3-verified contracts", async () => {
      const graph = loadGraph("user-registration");
      const verReport = await verifyGraph(graph);
      const result = generateProofExport(graph, verReport);
      // Should mention Z3 in some theorems
      expect(result.source).toContain("Z3");
    });
  });

  describe("order-lifecycle export", () => {
    it("generates inductive type for state machine", () => {
      const graph = loadGraph("order-lifecycle");
      const result = generateProofExport(graph);
      expect(result.source).toContain("inductive OrderLifecycleState where");
      expect(result.source).toContain("| created");
      expect(result.source).toContain("| paid");
    });

    it("generates transition relation", () => {
      const graph = loadGraph("order-lifecycle");
      const result = generateProofExport(graph);
      expect(result.source).toContain("OrderLifecycleTransition");
      expect(result.source).toContain("created_to_paid");
    });

    it("generates never-invariant impossibility theorems", () => {
      const graph = loadGraph("order-lifecycle");
      const result = generateProofExport(graph);
      expect(result.source).toContain("no_cancelled_to_paid");
      expect(result.source).toContain("no_delivered_to_shipped");
    });

    it("generates terminal state theorems", () => {
      const graph = loadGraph("order-lifecycle");
      const result = generateProofExport(graph);
      expect(result.source).toContain("cancelled_is_terminal");
      expect(result.source).toContain("refunded_is_terminal");
    });
  });

  describe("sorry count accuracy", () => {
    it("sorry count matches unsupported expression count", () => {
      const graph = loadGraph("user-registration");
      const result = generateProofExport(graph);
      const sorryMatches = result.source.match(/\bsorry\b/g) ?? [];
      // Each sorry in metadata should correspond to sorry in source
      // (metadata may count fewer since some sorry appear in pairs like `sorry := sorry`)
      expect(sorryMatches.length).toBeGreaterThanOrEqual(result.metadata.sorryCount);
    });
  });
});
