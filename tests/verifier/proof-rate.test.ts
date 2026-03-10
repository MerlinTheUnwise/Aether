/**
 * Tests for overall proof rate across all reference programs.
 * Verifies that axiom-based verification achieves >30% proof rate.
 */

import { describe, it, expect } from "vitest";
import { verifyGraph, getZ3 } from "../../src/compiler/verifier.js";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const examplesDir = join(process.cwd(), "src", "ir", "examples");
const realWorldDir = join(examplesDir, "real-world");

async function collectProofStats() {
  const stats = {
    totalPostconditions: 0,
    proved: 0,
    failed: 0,
    timeout: 0,
    unsupported: 0,
  };

  const jsonFiles = readdirSync(examplesDir).filter(f => f.endsWith(".json"));
  let realWorldFiles: string[] = [];
  try {
    realWorldFiles = readdirSync(realWorldDir).filter(f => f.endsWith(".json"));
  } catch {}

  const allFiles = [
    ...jsonFiles.map(f => join(examplesDir, f)),
    ...realWorldFiles.map(f => join(realWorldDir, f)),
  ];

  for (const filePath of allFiles) {
    const graph = JSON.parse(readFileSync(filePath, "utf-8"));
    const report = await verifyGraph(graph);

    if (report.coverage) {
      stats.proved += report.coverage.z3_verified;
      stats.failed += report.coverage.z3_failed;
      stats.timeout += report.coverage.z3_timeout;
      stats.unsupported += report.coverage.z3_unsupported;
      stats.totalPostconditions +=
        report.coverage.z3_verified +
        report.coverage.z3_failed +
        report.coverage.z3_timeout +
        report.coverage.z3_unsupported;
    }
  }

  return stats;
}

describe("Proof rate with axioms", () => {
  it("proof rate with axioms > 30%", async () => {
    const stats = await collectProofStats();
    const proofRate = stats.totalPostconditions > 0
      ? (stats.proved / stats.totalPostconditions) * 100
      : 0;

    console.log(`\n═══ Proof Rate Summary ═══`);
    console.log(`Total postconditions: ${stats.totalPostconditions}`);
    console.log(`Proved (UNSAT):       ${stats.proved} (${proofRate.toFixed(1)}%)`);
    console.log(`Failed (SAT):         ${stats.failed}`);
    console.log(`Timeout:              ${stats.timeout}`);
    console.log(`Unsupported:          ${stats.unsupported}`);

    expect(proofRate).toBeGreaterThan(30);
  }, 120000);

  it("total postconditions count is consistent", async () => {
    const stats = await collectProofStats();
    // We know there are ~113 postconditions across all programs
    expect(stats.totalPostconditions).toBeGreaterThanOrEqual(100);
  }, 120000);
});
