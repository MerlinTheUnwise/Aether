import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync } from "fs";
import { generateProofExport } from "../../src/proofs/generate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

const allPrograms = readdirSync(examplesDir)
  .filter(f => f.endsWith(".json"))
  .map(f => f.replace(".json", ""));

function loadGraph(name: string): any {
  return JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
}

describe("All Programs Proof Export", () => {
  for (const name of allPrograms) {
    describe(`Reference: ${name}`, () => {
      it("generates non-empty Lean file", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        expect(result.source.length).toBeGreaterThan(100);
        expect(result.filename).toBe(`${graph.id}.lean`);
      });

      it("does not throw during generation", () => {
        const graph = loadGraph(name);
        expect(() => generateProofExport(graph)).not.toThrow();
      });

      it("has consistent metadata counts", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        const m = result.metadata;
        expect(m.nodesExported).toBeGreaterThanOrEqual(0);
        expect(m.theoremsGenerated).toBeGreaterThanOrEqual(0);
        // theorems = fully_proved + sketches + obligations
        // sketches = theoremsGenerated - fullyProved - sorryCount
        expect(m.fullyProved + m.sorryCount).toBeLessThanOrEqual(m.theoremsGenerated);
        expect(m.fullyProved).toBeGreaterThanOrEqual(0);
        expect(m.sorryCount).toBeGreaterThanOrEqual(0);
      });

      it("contains AETHER Proof Certificate header", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        expect(result.source).toContain("AETHER Proof Certificate");
      });

      it("contains verification summary", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        expect(result.source).toContain("Verification Report:");
      });
    });
  }
});
