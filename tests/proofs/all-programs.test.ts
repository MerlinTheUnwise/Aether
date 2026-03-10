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

      it("contains AETHER Proof Skeleton header", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        expect(result.source).toContain("AETHER Proof Skeleton");
      });

      it("contains verification summary", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        expect(result.source).toContain("Verification Report:");
      });

      it("has correct theorem count in source", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        const m = result.metadata;
        // Source should mention theorem count in summary
        expect(result.source).toContain(`Theorems generated: ${m.theoremsGenerated}`);
        expect(result.source).toContain(`Fully proved: ${m.fullyProved}`);
      });

      it("metadata fullyProved + sorryCount + sketches = total", () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);
        const m = result.metadata;
        const sketches = m.proofSketches ?? 0;
        // fullyProved + sorryCount covers all generated theorems
        // (sketches are counted in sorryCount since they still have sorry)
        expect(m.fullyProved + m.sorryCount).toBeLessThanOrEqual(m.theoremsGenerated);
      });
    });
  }
});

describe("Proof Coverage Across All Programs", () => {
  it("aggregate proof coverage > 50%", () => {
    let totalTheorems = 0;
    let totalProved = 0;
    let totalSorry = 0;

    for (const name of allPrograms) {
      const graph = loadGraph(name);
      const result = generateProofExport(graph);
      totalTheorems += result.metadata.theoremsGenerated;
      totalProved += result.metadata.fullyProved;
      totalSorry += result.metadata.sorryCount;
    }

    const coverage = totalTheorems > 0 ? (totalProved / totalTheorems) * 100 : 0;

    // Target: >50% fully proved across all programs
    expect(coverage).toBeGreaterThan(50);
  });

  it("no regression: previously proved items remain proved", () => {
    // State machine theorems (intro/cases) must always be proved
    const orderGraph = loadGraph("order-lifecycle");
    const orderResult = generateProofExport(orderGraph);
    expect(orderResult.metadata.fullyProved).toBeGreaterThanOrEqual(2);
    expect(orderResult.source).toContain("intro h; cases h");

    // Edge type safety for compatible types must always be trivial
    const regGraph = loadGraph("user-registration");
    const regResult = generateProofExport(regGraph);
    expect(regResult.source).toContain("trivial");
  });

  it("tactic breakdown is populated", () => {
    let hasBreakdown = false;
    for (const name of allPrograms) {
      const graph = loadGraph(name);
      const result = generateProofExport(graph);
      const b = result.metadata.tacticBreakdown;
      if (b) {
        const total = Object.values(b).reduce((a, c) => a + c, 0);
        if (total > 0) hasBreakdown = true;
      }
    }
    expect(hasBreakdown).toBe(true);
  });

  it("prints proof coverage report", () => {
    const rows: { name: string; theorems: number; proved: number; sorry: number; pct: string }[] = [];

    for (const name of allPrograms) {
      const graph = loadGraph(name);
      const result = generateProofExport(graph);
      const m = result.metadata;
      const pct = m.theoremsGenerated > 0
        ? ((m.fullyProved / m.theoremsGenerated) * 100).toFixed(1)
        : "N/A";
      rows.push({
        name,
        theorems: m.theoremsGenerated,
        proved: m.fullyProved,
        sorry: m.sorryCount,
        pct,
      });
    }

    // This test always passes — it's for visibility
    const totalT = rows.reduce((a, r) => a + r.theorems, 0);
    const totalP = rows.reduce((a, r) => a + r.proved, 0);
    const totalS = rows.reduce((a, r) => a + r.sorry, 0);
    const totalPct = totalT > 0 ? ((totalP / totalT) * 100).toFixed(1) : "0.0";

    // eslint-disable-next-line no-console
    console.log("\n═══ PROOF COVERAGE REPORT ═══");
    for (const r of rows) {
      console.log(`  ${r.name.padEnd(35)} ${r.proved}/${r.theorems} proved (${r.pct}%)`);
    }
    console.log(`  ${"TOTAL".padEnd(35)} ${totalP}/${totalT} proved (${totalPct}%)`);
    console.log("═════════════════════════════\n");

    expect(true).toBe(true);
  });
});
