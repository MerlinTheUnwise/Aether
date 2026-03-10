#!/usr/bin/env npx tsx
/**
 * AETHER End-to-End Compile & Run Script
 *
 * Usage: npx tsx scripts/compile-and-run.ts <graph.json> [--output <dir>] [--contracts <mode>] [--run]
 *
 * Compiles an AETHER-IR graph all the way to a native binary with stubs,
 * then optionally runs the binary and reports the result.
 */

import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, basename } from "path";
import { compileToBinary, detectToolchain } from "../src/compiler/llvm/pipeline.js";
import { generateStubs, generateTestHarness } from "../src/compiler/llvm/stubs.js";
import { writeFileSync } from "fs";

// ─── CLI Parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`
AETHER Compile & Run
====================

Usage: npx tsx scripts/compile-and-run.ts <graph.json> [options]

Options:
  --output <dir>      Output directory (default: test-output)
  --contracts <mode>  Contract mode: abort | log | count (default: count)
  --run               Execute the binary after compilation
  --harness           Also generate a test harness
  --verbose           Show detailed compilation output
  --help, -h          Show this help
`);
  process.exit(0);
}

const inputFile = args.find(a => a.endsWith(".json"));
if (!inputFile || !existsSync(inputFile)) {
  console.error(`Error: Input file not found: ${inputFile ?? "(none)"}`);
  process.exit(1);
}

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}

const outputDir = getArg("--output") ?? "test-output";
const contracts = (getArg("--contracts") ?? "count") as "abort" | "log" | "count";
const shouldRun = args.includes("--run");
const shouldHarness = args.includes("--harness");
const verbose = args.includes("--verbose");

// ─── Execution ────────────────────────────────────────────────────────────────

async function main() {
  // Ensure output dir exists
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Check toolchain
  console.log("Checking toolchain...");
  const toolchain = await detectToolchain();
  if (!toolchain.clang.available) {
    console.error("ERROR: clang not found. Install LLVM: https://releases.llvm.org/download.html");
    process.exit(1);
  }
  console.log(`  clang: ${toolchain.clang.version ?? "available"}`);
  if (toolchain.llc.available) console.log(`  llc:   ${toolchain.llc.version ?? "available"}`);

  // Load graph for stub generation
  const { readFileSync } = await import("fs");
  const graphJson = JSON.parse(readFileSync(inputFile, "utf-8"));
  const graphName = graphJson.id ?? basename(inputFile, ".json");
  const safeName = graphName.replace(/[^a-zA-Z0-9]/g, "_");

  // Generate stubs
  console.log("Generating stubs...");
  const stubCode = generateStubs(graphJson);
  const stubPath = join(outputDir, `${safeName}_stubs.c`);
  writeFileSync(stubPath, stubCode, "utf-8");
  console.log(`  Stubs: ${stubPath}`);

  if (shouldHarness) {
    const harnessCode = generateTestHarness(graphJson);
    const harnessPath = join(outputDir, `${safeName}_harness.c`);
    writeFileSync(harnessPath, harnessCode, "utf-8");
    console.log(`  Harness: ${harnessPath}`);
  }

  // Compile
  console.log("\nCompiling...");
  const result = await compileToBinary({
    input: inputFile,
    outputDir,
    outputName: graphName,
    target: "binary",
    optimization: 2,
    parallel: true,
    contracts,
    verbose,
    stubsPath: stubPath,
  });

  // Report
  const sep = "═".repeat(55);
  console.log(`\n${sep}`);
  console.log(`AETHER E2E: ${graphName}`);
  console.log(sep);

  const s = result.stages;
  console.log(`  Validate:     ${s.validate.success ? "✓" : "✗"} (${s.validate.duration_ms}ms)`);
  console.log(`  Type Check:   ${s.typeCheck.success ? "✓" : "✗"} (${s.typeCheck.duration_ms}ms)`);
  console.log(`  Verify:       ${s.verify.success ? "✓" : "✗"} ${s.verify.percentage ?? 0}% (${s.verify.duration_ms}ms)`);
  if (s.emitIR.outputPath) {
    console.log(`  Emit IR:      ${s.emitIR.success ? "✓" : "✗"} ${s.emitIR.lines ?? 0} lines (${s.emitIR.duration_ms}ms)`);
  }
  if (s.compileObj) {
    console.log(`  Compile Obj:  ${s.compileObj.success ? "✓" : "✗"} (${s.compileObj.duration_ms}ms)`);
  }
  if (s.link) {
    console.log(`  Link:         ${s.link.success ? "✓" : "✗"} (${s.link.duration_ms}ms)`);
  }
  console.log(`  Output:       ${result.outputPath}`);
  if (result.binarySize) {
    console.log(`  Binary Size:  ${(result.binarySize / 1024).toFixed(1)} KB`);
  }
  if (result.errors.length > 0) {
    for (const err of result.errors) console.log(`  Error:        ${err}`);
  }
  console.log(`  Result:       ${result.success ? "SUCCESS" : "FAILED"}`);

  if (!result.success) {
    console.log(sep);
    process.exit(1);
  }

  // Run if requested
  if (shouldRun && result.success) {
    console.log(`\n  Running ${result.outputPath}...`);
    console.log("  " + "─".repeat(50));
    try {
      const output = execSync(`"${result.outputPath}"`, {
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (output.trim()) console.log("  " + output.trim().split("\n").join("\n  "));
    } catch (e: any) {
      const stderr = e.stderr?.trim();
      const stdout = e.stdout?.trim();
      if (stderr) console.log("  " + stderr.split("\n").join("\n  "));
      if (stdout) console.log("  " + stdout.split("\n").join("\n  "));
      console.log(`  Exit code: ${e.status ?? "unknown"}`);
    }
    console.log("  " + "─".repeat(50));
  }

  console.log(sep);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
