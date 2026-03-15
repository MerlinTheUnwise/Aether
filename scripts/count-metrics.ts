#!/usr/bin/env npx tsx
/**
 * count-metrics.ts — Programmatically counts all project metrics.
 * Run: npx tsx scripts/count-metrics.ts
 *
 * These are the authoritative numbers for README.md.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

export interface ProjectMetrics {
  tests: {
    itBlocks: number;
    describeBlocks: number;
    testFiles: number;
  };
  source: {
    files: number;
    lines: number;
    linesNoBlank: number;
  };
  z3: {
    totalPostconditions: number;
    z3Proved: number;
    z3Failed: number;
    z3Timeout: number;
    z3Unsupported: number;
    proofRate: string;
    nodesWithAxioms: number;
    nodesWithoutAxioms: number;
  };
  lean: {
    totalTheorems: number;
    fullyProved: number;
    sorry: number;
    proofRate: string;
    verifiedByLean: number;
  };
  programs: {
    total: number;
    withImplementations: number;
    withRealIO: number;
    aetherFiles: number;
  };
  cli: {
    commands: number;
  };
}

/** Recursively find all files matching an extension under a directory */
function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

/** Count regex matches across files */
function countMatches(files: string[], pattern: RegExp): number {
  let count = 0;
  for (const f of files) {
    const content = readFileSync(f, "utf-8");
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

/** Count total lines in files */
function countFileLines(files: string[], skipBlank = false): number {
  let total = 0;
  for (const f of files) {
    const lines = readFileSync(f, "utf-8").split("\n");
    if (skipBlank) {
      total += lines.filter(l => l.trim().length > 0).length;
    } else {
      total += lines.length;
    }
  }
  return total;
}

function countCliCommands(): number {
  const cli = readFileSync("src/cli.ts", "utf-8");
  const cases = cli.match(/^\s+case\s+"([^"]+)"/gm) || [];
  const commands = new Set<string>();
  const incrementalSubs = new Set([
    "add-node", "add-hole", "add-edge", "fill-hole",
    "remove-node", "status", "finalize", "quit", "exit",
  ]);

  for (const c of cases) {
    const match = c.match(/case\s+"([^"]+)"/);
    if (match) {
      const cmd = match[1];
      if (incrementalSubs.has(cmd)) continue;
      commands.add(cmd);
    }
  }
  return commands.size;
}

export async function countMetrics(): Promise<ProjectMetrics> {
  const root = process.cwd();

  // Tests
  const testTsFiles = findFiles(join(root, "tests"), ".ts");
  const itPattern = /\bit\s*\(/g;
  const describePattern = /\bdescribe\s*\(/g;
  const itBlocks = countMatches(testTsFiles, itPattern);
  const describeBlocks = countMatches(testTsFiles, describePattern);
  const testFiles = testTsFiles.filter(f => f.endsWith(".test.ts")).length;

  // Source
  const srcTsFiles = findFiles(join(root, "src"), ".ts");
  const sourceFiles = srcTsFiles.length;
  const sourceLines = countFileLines(srcTsFiles);
  const sourceLinesNoBlank = countFileLines(srcTsFiles, true);

  // Z3
  let z3 = {
    totalPostconditions: 0,
    z3Proved: 0,
    z3Failed: 0,
    z3Timeout: 0,
    z3Unsupported: 0,
    proofRate: "0%",
    nodesWithAxioms: 0,
    nodesWithoutAxioms: 0,
  };

  try {
    const { verifyGraph } = await import("../src/compiler/verifier.js");
    const examplesDir = join(root, "src", "ir", "examples");
    const jsonFiles = readdirSync(examplesDir).filter(f => f.endsWith(".json"));

    for (const file of jsonFiles) {
      const graph = JSON.parse(readFileSync(join(examplesDir, file), "utf-8"));

      // Count nodes with/without axioms
      for (const node of graph.nodes ?? []) {
        if (node.hole || node.intent) continue;
        if (node.axioms && node.axioms.length > 0) {
          z3.nodesWithAxioms++;
        } else {
          z3.nodesWithoutAxioms++;
        }
      }

      const report = await verifyGraph(graph);
      if (report.coverage) {
        z3.z3Proved += report.coverage.z3_verified;
        z3.z3Failed += report.coverage.z3_failed;
        z3.z3Timeout += report.coverage.z3_timeout;
        z3.z3Unsupported += report.coverage.z3_unsupported;
        z3.totalPostconditions +=
          report.coverage.z3_verified +
          report.coverage.z3_failed +
          report.coverage.z3_timeout +
          report.coverage.z3_unsupported;
      }
    }
    z3.proofRate =
      z3.totalPostconditions > 0
        ? ((z3.z3Proved / z3.totalPostconditions) * 100).toFixed(1) + "%"
        : "0%";
  } catch (e) {
    console.error("Z3 counting failed (requires z3-solver):", (e as Error).message);
  }

  // Lean
  let lean = {
    totalTheorems: 0,
    fullyProved: 0,
    sorry: 0,
    proofRate: "0%",
    verifiedByLean: 0,
  };

  try {
    const { generateLeanProofs } = await import("../src/proofs/generate.js");
    const examplesDir = join(root, "src", "ir", "examples");
    const jsonFiles = readdirSync(examplesDir).filter(f => f.endsWith(".json"));

    for (const file of jsonFiles) {
      const graph = JSON.parse(readFileSync(join(examplesDir, file), "utf-8"));
      try {
        const leanCode = generateLeanProofs(graph);
        const parts = leanCode.split(/(?=theorem\s+)/);
        for (const part of parts) {
          if (!part.startsWith("theorem")) continue;
          if (part.includes("sorry")) lean.sorry++;
          else lean.fullyProved++;
        }
      } catch {
        // Some programs may not generate valid Lean
      }
    }
    lean.totalTheorems = lean.fullyProved + lean.sorry;
    lean.proofRate =
      lean.totalTheorems > 0
        ? ((lean.fullyProved / lean.totalTheorems) * 100).toFixed(1) + "%"
        : "0%";
  } catch (e) {
    console.error("Lean counting failed:", (e as Error).message);
  }

  // Programs
  const examplesDir = join(root, "src", "ir", "examples");
  const jsonPrograms = readdirSync(examplesDir).filter(f => f.endsWith(".json"));
  const realWorldDir = join(examplesDir, "real-world");
  let realWorldJsons = 0;
  try {
    realWorldJsons = readdirSync(realWorldDir).filter(f => f.endsWith(".json")).length;
  } catch {}
  const totalPrograms = jsonPrograms.length + realWorldJsons;

  const aetherFilesCount = readdirSync(examplesDir).filter(f => f.endsWith(".aether")).length;
  let realWorldAether = 0;
  try {
    realWorldAether = readdirSync(realWorldDir).filter(f => f.endsWith(".aether")).length;
  } catch {}
  const totalAether = aetherFilesCount + realWorldAether;

  const implDir = join(root, "src", "implementations", "programs");
  let implCount = 0;
  try {
    implCount = readdirSync(implDir).filter(
      f => f.endsWith(".ts") && f !== "index.ts"
    ).length;
  } catch {}

  // CLI
  const cliCommands = countCliCommands();

  return {
    tests: { itBlocks, describeBlocks, testFiles },
    source: { files: sourceFiles, lines: sourceLines, linesNoBlank: sourceLinesNoBlank },
    z3,
    lean,
    programs: {
      total: totalPrograms,
      withImplementations: implCount,
      withRealIO: 0, // All I/O is in-memory simulation
      aetherFiles: totalAether,
    },
    cli: { commands: cliCommands },
  };
}

// Run if executed directly
const isMain = process.argv[1]?.includes("count-metrics");
if (isMain) {
  countMetrics().then(metrics => {
    console.log("\n══════════════════════════════════════════");
    console.log("  AETHER — Verified Project Metrics");
    console.log("══════════════════════════════════════════\n");

    console.log("TESTS");
    console.log(`  it() blocks:      ${metrics.tests.itBlocks}`);
    console.log(`  describe blocks:  ${metrics.tests.describeBlocks}`);
    console.log(`  test files:       ${metrics.tests.testFiles}`);

    console.log("\nSOURCE");
    console.log(`  .ts files:        ${metrics.source.files}`);
    console.log(`  total lines:      ${metrics.source.lines.toLocaleString()}`);
    console.log(`  non-blank lines:  ${metrics.source.linesNoBlank.toLocaleString()}`);

    console.log("\nZ3 VERIFICATION (with axioms)");
    console.log(`  total postconditions: ${metrics.z3.totalPostconditions}`);
    console.log(`  proved (UNSAT):       ${metrics.z3.z3Proved}`);
    console.log(`  failed (SAT):         ${metrics.z3.z3Failed}`);
    console.log(`  timeout:              ${metrics.z3.z3Timeout}`);
    console.log(`  unsupported:          ${metrics.z3.z3Unsupported}`);
    console.log(`  proof rate:           ${metrics.z3.proofRate}`);
    console.log(`  nodes with axioms:    ${metrics.z3.nodesWithAxioms}`);
    console.log(`  nodes without axioms: ${metrics.z3.nodesWithoutAxioms}`);

    console.log("\nLEAN 4 EXPORT");
    console.log(`  total theorems:       ${metrics.lean.totalTheorems}`);
    console.log(`  fully proved:         ${metrics.lean.fullyProved}`);
    console.log(`  sorry placeholders:   ${metrics.lean.sorry}`);
    console.log(`  proof rate:           ${metrics.lean.proofRate}`);
    console.log(`  verified by lean4:    ${metrics.lean.verifiedByLean}`);

    console.log("\nPROGRAMS");
    console.log(`  total:                ${metrics.programs.total}`);
    console.log(`  with implementations: ${metrics.programs.withImplementations}`);
    console.log(`  with real I/O:        ${metrics.programs.withRealIO}`);
    console.log(`  .aether files:        ${metrics.programs.aetherFiles}`);

    console.log("\nCLI");
    console.log(`  commands:             ${metrics.cli.commands}`);

    console.log("\n══════════════════════════════════════════\n");
  });
}
