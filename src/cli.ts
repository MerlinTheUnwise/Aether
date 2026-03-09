#!/usr/bin/env node
/**
 * AETHER CLI — unified command-line interface
 *
 * Commands:
 *   validate <path>         Run IR validator
 *   check <path>            Run semantic type checker
 *   verify <path>           Run Z3 contract verifier
 *   transpile <path> [--output <dir>]  Generate JavaScript
 *   report <path>           Run ALL tools + summary dashboard
 *   help                    Show usage
 */

import { readFileSync } from "fs";
import { join } from "path";
import { validateGraph } from "./ir/validator.js";
import { checkTypes } from "./compiler/checker.js";
import { verifyGraph, type GraphVerificationReport } from "./compiler/verifier.js";
import { transpileGraph, transpileToFile } from "./compiler/transpiler.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AetherGraph {
  id: string;
  version: number;
  nodes: { id: string }[];
  edges: { from: string; to: string }[];
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadGraph(filePath: string): AetherGraph {
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as AetherGraph;
  return raw;
}

function printUsage(): void {
  console.log(`
AETHER CLI — Phase 0 Toolchain

Usage: npx ts-node src/cli.ts <command> <path-to-json> [options]

Commands:
  validate <path>                Run IR validator
  check <path>                   Run semantic type checker
  verify <path>                  Run Z3 contract verifier
  transpile <path> [--output <dir>]  Generate JavaScript module
  report <path>                  Run ALL tools + summary dashboard
  help                           Show this message
`.trim());
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdValidate(filePath: string): boolean {
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
  const result = validateGraph(raw);
  const graph = raw as AetherGraph;

  if (result.valid) {
    console.log(`✓ Valid AETHER graph: ${graph.id} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
    if (result.warnings.length > 0) {
      result.warnings.forEach(w => console.log(`  ⚠  ${w}`));
    }
    return true;
  } else {
    console.error(`✗ Invalid AETHER graph`);
    result.errors.forEach(e => console.error(`  • ${e}`));
    return false;
  }
}

function cmdCheck(filePath: string): boolean {
  const graph = loadGraph(filePath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = checkTypes(graph as any);

  if (result.compatible) {
    console.log(`✓ Type check passed: ${result.errors.length} errors, ${result.warnings.length} warnings`);
  } else {
    console.error(`✗ Type check failed`);
    for (const e of result.errors) {
      console.error(`  • [${e.code}] ${e.edge}: ${e.message}`);
    }
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(`  ⚠  [${w.code}] ${w.edge}: ${w.message}`);
    }
  }

  return result.compatible;
}

async function cmdVerify(filePath: string): Promise<GraphVerificationReport> {
  const graph = loadGraph(filePath);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const report = await verifyGraph(graph as any);

  console.log(`Verification: ${report.nodes_verified}/${report.nodes_verified + report.nodes_failed} nodes verified (${report.verification_percentage}%)`);
  if (report.nodes_unsupported > 0) {
    console.log(`             ${report.nodes_unsupported}/${report.results.length} unsupported expressions`);
  }

  return report;
}

function cmdTranspile(filePath: string, outputDir: string): string | null {
  const graph = loadGraph(filePath);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outFile = join(outputDir, `${graph.id}.generated.js`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transpileToFile(graph as any, outFile);
    console.log(`✓ Transpiled → ${outFile}`);
    return outFile;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`✗ Transpile failed: ${msg}`);
    return null;
  }
}

async function cmdReport(filePath: string, outputDir: string): Promise<void> {
  const graph = loadGraph(filePath);
  const sep = "═══════════════════════════════════════";

  console.log(sep);
  console.log(`AETHER Report: ${graph.id} (v${graph.version})`);
  console.log(sep);

  // 1. Validate
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
  const valResult = validateGraph(raw);
  if (valResult.valid) {
    console.log(`Schema:       ✓ valid`);
    console.log(`DAG:          ✓ acyclic (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
  } else {
    console.log(`Schema:       ✗ invalid`);
    valResult.errors.forEach(e => console.log(`              • ${e}`));
    console.log(sep);
    process.exit(1);
  }

  // 2. Type check
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checkResult = checkTypes(graph as any);
  if (checkResult.compatible) {
    console.log(`Types:        ✓ ${graph.edges.length}/${graph.edges.length} edges compatible`);
  } else {
    console.log(`Types:        ✗ ${checkResult.errors.length} error(s)`);
    checkResult.errors.forEach(e => console.log(`              • ${e.message}`));
  }

  // 3. Verify
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verifyReport = await verifyGraph(graph as any);
  const verifiedTotal = verifyReport.nodes_verified + verifyReport.nodes_failed;
  console.log(`Verification: ${verifyReport.nodes_verified}/${verifiedTotal} nodes verified (${verifyReport.verification_percentage}%)`);
  if (verifyReport.nodes_unsupported > 0) {
    console.log(`              ${verifyReport.nodes_unsupported}/${verifyReport.results.length} unsupported expressions`);
  }

  // 4. Transpile
  try {
    const outFile = join(outputDir, `${graph.id}.generated.js`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transpileToFile(graph as any, outFile);
    console.log(`Transpiled:   ✓ ${graph.id}.generated.js`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`Transpiled:   ✗ ${msg}`);
  }

  console.log(sep);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];
const filePath = args[1];

// Parse --output flag
const outputIdx = args.indexOf("--output");
const outputDir = outputIdx >= 0 && args[outputIdx + 1] ? args[outputIdx + 1] : ".";

if (!command || command === "help") {
  printUsage();
  process.exit(0);
}

if (!filePath) {
  console.error("Error: missing <path-to-json> argument");
  printUsage();
  process.exit(1);
}

(async () => {
  try {
    switch (command) {
      case "validate":
        if (!cmdValidate(filePath)) process.exit(1);
        break;

      case "check":
        if (!cmdCheck(filePath)) process.exit(1);
        break;

      case "verify":
        await cmdVerify(filePath);
        break;

      case "transpile":
        if (!cmdTranspile(filePath, outputDir)) process.exit(1);
        break;

      case "report":
        await cmdReport(filePath, outputDir);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
})();
