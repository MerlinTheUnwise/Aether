/**
 * Tests for verification coverage across all reference programs
 * Phase 6 Session 2 — Deliverable 7
 */
import { describe, it, expect } from "vitest";
import { verifyGraph } from "../../src/compiler/verifier.js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const EXAMPLES_DIR = join(process.cwd(), "src", "ir", "examples");

function loadGraph(filename: string) {
  const path = join(EXAMPLES_DIR, filename);
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("Verification Coverage Report", () => {
  it("verifies all reference programs and reports coverage", async () => {
    const files = readdirSync(EXAMPLES_DIR)
      .filter(f => f.endsWith(".json"))
      .filter(f => !f.includes("real-world")); // Skip real-world subdirectory

    let totalVerified = 0;
    let totalFailed = 0;
    let totalTimeout = 0;
    let totalUnsupported = 0;
    let totalContracts = 0;

    for (const file of files) {
      const graph = loadGraph(file);
      const report = await verifyGraph(graph);

      if (report.coverage) {
        totalVerified += report.coverage.z3_verified;
        totalFailed += report.coverage.z3_failed;
        totalTimeout += report.coverage.z3_timeout;
        totalUnsupported += report.coverage.z3_unsupported;
        totalContracts += report.coverage.z3_verified + report.coverage.z3_failed + report.coverage.z3_timeout + report.coverage.z3_unsupported;
      }
    }

    // Report the numbers
    console.log("\n═══ Coverage across all reference programs ═══");
    console.log(`Total contracts:    ${totalContracts}`);
    console.log(`Z3 verified:        ${totalVerified}`);
    console.log(`Z3 failed:          ${totalFailed}`);
    console.log(`Z3 timeout:         ${totalTimeout}`);
    console.log(`Z3 unsupported:     ${totalUnsupported}`);
    const unsupportedPct = totalContracts > 0
      ? Math.round((totalUnsupported / totalContracts) * 100)
      : 0;
    console.log(`Unsupported rate:   ${unsupportedPct}%`);

    // Target: unsupported should be < 20% of all contracts
    // (was ~40%+ before this session's changes)
    expect(totalContracts).toBeGreaterThan(0);
    expect(unsupportedPct).toBeLessThan(20);
  }, 120000);

  it("coverage report includes z3_time_ms for each contract", async () => {
    const graph = loadGraph("user-registration.json");
    const report = await verifyGraph(graph);

    // Check that enhanced results have timing data
    expect(report.enhanced).toBeDefined();
    if (report.enhanced && report.enhanced.length > 0) {
      for (const enh of report.enhanced) {
        for (const c of enh.contracts) {
          expect(c.z3_time_ms).toBeDefined();
          expect(typeof c.z3_time_ms).toBe("number");
        }
      }
    }
  }, 30000);

  it("coverage report has correct structure", async () => {
    const graph = loadGraph("product-recommendations.json");
    const report = await verifyGraph(graph);

    expect(report.coverage).toBeDefined();
    expect(typeof report.coverage!.z3_verified).toBe("number");
    expect(typeof report.coverage!.z3_failed).toBe("number");
    expect(typeof report.coverage!.z3_timeout).toBe("number");
    expect(typeof report.coverage!.z3_unsupported).toBe("number");
    expect(typeof report.coverage!.runtime_evaluable).toBe("number");
    expect(typeof report.coverage!.total_uncovered).toBe("number");

    // All counts should be non-negative
    expect(report.coverage!.z3_verified).toBeGreaterThanOrEqual(0);
    expect(report.coverage!.z3_failed).toBeGreaterThanOrEqual(0);
    expect(report.coverage!.z3_timeout).toBeGreaterThanOrEqual(0);
    expect(report.coverage!.z3_unsupported).toBeGreaterThanOrEqual(0);
  }, 30000);

  it("product-recommendations contracts are now mostly handled by Z3", async () => {
    const graph = loadGraph("product-recommendations.json");
    const report = await verifyGraph(graph);

    // product-recommendations has contracts like:
    // - forall(p, recommended, p not_in purchases)
    // - recommended.is_distinct
    // - recommended.size >= 10 && recommended.size <= 20
    // - intersection(recommended, purchases) != empty
    // - recommended.has_duplicates
    // These were ALL unsupported before. Now most should translate.
    const cov = report.coverage!;
    const total = cov.z3_verified + cov.z3_failed + cov.z3_timeout + cov.z3_unsupported;
    const handled = total - cov.z3_unsupported;

    console.log(`\nproduct-recommendations: ${handled}/${total} handled by Z3`);
    // At least half should now be handled
    expect(handled).toBeGreaterThan(total / 2);
  }, 30000);
});
