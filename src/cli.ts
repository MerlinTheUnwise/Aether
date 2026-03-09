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
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { validateGraph } from "./ir/validator.js";
import { checkTypes } from "./compiler/checker.js";
import { verifyGraph, type GraphVerificationReport } from "./compiler/verifier.js";
import { transpileGraph, transpileToFile } from "./compiler/transpiler.js";
import { IncrementalBuilder } from "./compiler/incremental.js";

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
AETHER CLI — Phase 1 Toolchain

Usage: npx tsx src/cli.ts <command> <path-to-json> [options]

Commands:
  validate <path>                Run IR validator
  check <path>                   Run semantic type checker
  verify <path>                  Run Z3 contract verifier
  transpile <path> [--output <dir>]  Generate JavaScript module
  report <path>                  Run ALL tools + summary dashboard
  generate <path>                Validate AI-generated IR with actionable feedback
  incremental                    Start interactive incremental builder
  compact <path> [--output <p>]  Convert IR JSON to compact .aether form
  execute <path> [--inputs <p>]  Execute graph in runtime engine
  visualize <path> [--output <p>] [--execute] [--open]  Generate HTML visualization
  expand <path>                  Parse compact .aether form to IR JSON
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

export interface ReportResult {
  graphId: string;
  schemaValid: boolean;
  typesValid: boolean;
  verificationPct: number;
  executionResult?: {
    waves: number;
    confidence: number;
    effects: string[];
    oversightNodes: string[];
  };
  visualizationFile?: string;
  failedStage?: string;
}

async function cmdReport(filePath: string, outputDir: string): Promise<ReportResult> {
  const graph = loadGraph(filePath);
  const sep = "═══════════════════════════════════════════════════";
  const result: ReportResult = {
    graphId: graph.id,
    schemaValid: false,
    typesValid: false,
    verificationPct: 0,
  };

  console.log(sep);
  console.log(`AETHER Report: ${graph.id} (v${graph.version})`);
  console.log(sep);

  // 1. Validate
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
  const valResult = validateGraph(raw);
  if (valResult.valid) {
    result.schemaValid = true;
    console.log(`Schema:         ✓ valid`);
    console.log(`DAG:            ✓ acyclic (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
  } else {
    console.log(`Schema:         ✗ invalid`);
    valResult.errors.forEach(e => console.log(`                • ${e}`));
    result.failedStage = "schema";
    console.log(`Execution:      — skipped`);
    console.log(`Visualization:  — skipped`);
    console.log(sep);
    return result;
  }

  // 2. Type check
  const checkResult = checkTypes(graph as any);
  if (checkResult.compatible) {
    result.typesValid = true;
    console.log(`Types:          ✓ ${graph.edges.length}/${graph.edges.length} edges compatible`);
  } else {
    console.log(`Types:          ✗ ${checkResult.errors.length} error(s)`);
    checkResult.errors.forEach(e => console.log(`                • ${e.message}`));
    result.failedStage = "types";
    console.log(`Execution:      — skipped`);
    console.log(`Visualization:  — skipped`);
    console.log(sep);
    return result;
  }

  // 3. Verify
  const verifyReport = await verifyGraph(graph as any);
  const verifiedTotal = verifyReport.nodes_verified + verifyReport.nodes_failed;
  result.verificationPct = verifyReport.verification_percentage;
  console.log(`Verification:   ${verifyReport.nodes_verified}/${verifiedTotal} nodes verified (${verifyReport.verification_percentage}%)`);
  if (verifyReport.nodes_unsupported > 0) {
    console.log(`                ${verifyReport.nodes_unsupported}/${verifyReport.results.length} unsupported expressions`);
  }

  // 4. Execute (stub mode)
  try {
    const { execute } = await import("./runtime/executor.js");
    const execResult = await execute({
      graph: graph as any,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });

    const uniqueEffects = [...new Set(execResult.effectsPerformed)];
    const oversightNodes = execResult.executionLog
      .filter(e => !e.skipped && e.confidence < 0.85)
      .map(e => `${e.nodeId} (confidence ${e.confidence.toFixed(2)})`);

    result.executionResult = {
      waves: execResult.waves,
      confidence: execResult.confidence,
      effects: uniqueEffects,
      oversightNodes,
    };

    console.log(`Execution:      ✓ ${execResult.nodesExecuted + execResult.nodesSkipped} nodes in ${execResult.waves} waves (stub mode)`);
    console.log(`                Final confidence: ${execResult.confidence.toFixed(2)}`);
    if (uniqueEffects.length > 0) {
      console.log(`                Effects: ${uniqueEffects.join(", ")}`);
    }
    if (oversightNodes.length > 0) {
      console.log(`                Oversight needed: ${oversightNodes.join(", ")}`);
    }

    // 5. Visualize
    try {
      const { generateVisualization } = await import("./visualizer/generate.js");
      const { writeFileSync } = await import("fs");

      const html = generateVisualization(graph as any, execResult);
      const vizFile = join(outputDir === "." ? "" : outputDir, `${graph.id}.html`).replace(/^[/\\]/, "");
      const vizPath = vizFile || `${graph.id}.html`;
      writeFileSync(vizPath, html, "utf-8");
      result.visualizationFile = vizPath;
      console.log(`Visualization:  ✓ ${vizPath} generated`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`Visualization:  ✗ ${msg}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`Execution:      ✗ ${msg}`);
    result.failedStage = "execution";
    console.log(`Visualization:  — skipped`);
  }

  console.log(sep);
  return result;
}

// ─── Generate Command ─────────────────────────────────────────────────────────

interface GenerateStepResult {
  name: string;
  passed: boolean;
  details: string;
  errors: string[];
}

function detectCommonJsonErrors(raw: string): string[] {
  const hints: string[] = [];
  // Trailing commas
  if (/,\s*[}\]]/.test(raw)) {
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/,\s*$/.test(lines[i].trimEnd())) {
        const nextNonEmpty = lines.slice(i + 1).find(l => l.trim().length > 0);
        if (nextNonEmpty && /^\s*[}\]]/.test(nextNonEmpty)) {
          hints.push(`Line ${i + 1}: trailing comma before closing bracket/brace`);
        }
      }
    }
  }
  // Single quotes
  if (/'[^']*'\s*:/.test(raw) || /:\s*'[^']*'/.test(raw)) {
    hints.push("JSON requires double quotes, not single quotes");
  }
  // Unquoted keys
  if (/{\s*[a-zA-Z_]\w*\s*:/.test(raw)) {
    hints.push("JSON requires quoted keys — use \"key\" not key");
  }
  return hints;
}

export async function cmdGenerate(filePath: string): Promise<{ accepted: boolean; steps: GenerateStepResult[] }> {
  const sep = "═══════════════════════════════════════════";
  const steps: GenerateStepResult[] = [];
  let graphId = "(unknown)";

  // Step 1: JSON Parse
  let raw: string;
  let parsed: unknown;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ name: "JSON Parse", passed: false, details: "✗ file read error", errors: [`Cannot read file: ${msg}`] });
    printGenerateReport(graphId, steps, sep);
    return { accepted: false, steps };
  }

  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const errors = [`JSON parse error: ${msg}`];
    const hints = detectCommonJsonErrors(raw);
    errors.push(...hints);
    steps.push({ name: "JSON Parse", passed: false, details: "✗ invalid JSON", errors });
    printGenerateReport(graphId, steps, sep);
    return { accepted: false, steps };
  }

  steps.push({ name: "JSON Parse", passed: true, details: "✓ valid", errors: [] });

  // Step 2: Schema Validation
  const valResult = validateGraph(parsed);
  const graph = parsed as AetherGraph;
  graphId = graph.id || "(unknown)";

  if (valResult.valid) {
    steps.push({
      name: "Schema",
      passed: true,
      details: "✓ valid",
      errors: []
    });
  } else {
    // Group errors by node where possible
    const nodeErrors = new Map<string, string[]>();
    const otherErrors: string[] = [];
    for (const err of valResult.errors) {
      const nodeMatch = err.match(/Node "([^"]+)"/);
      if (nodeMatch) {
        const nodeId = nodeMatch[1];
        if (!nodeErrors.has(nodeId)) nodeErrors.set(nodeId, []);
        nodeErrors.get(nodeId)!.push(err);
      } else {
        otherErrors.push(err);
      }
    }

    const formatted: string[] = [...otherErrors];
    for (const [nodeId, errs] of nodeErrors) {
      for (const err of errs) {
        formatted.push(`[${nodeId}] ${err}`);
      }
    }

    steps.push({
      name: "Schema",
      passed: false,
      details: `✗ ${valResult.errors.length} error(s)`,
      errors: formatted
    });

    printGenerateReport(graphId, steps, sep);
    return { accepted: false, steps };
  }

  // Step 3: Structural Validation (warnings from validator)
  const supervisedInfo = valResult.supervisedCount > 0 ? `, ${valResult.supervisedCount} supervised` : "";
  steps.push({
    name: "Structure",
    passed: true,
    details: `✓ valid (${graph.nodes.length} nodes, ${graph.edges.length} edges${supervisedInfo})`,
    errors: []
  });

  // Step 4: Type Checking
  const checkResult = checkTypes(graph as any);
  if (checkResult.compatible) {
    steps.push({
      name: "Types",
      passed: true,
      details: `✓ ${graph.edges.length}/${graph.edges.length} edges compatible`,
      errors: []
    });
  } else {
    steps.push({
      name: "Types",
      passed: false,
      details: `✗ ${checkResult.errors.length} error(s)`,
      errors: checkResult.errors.map(e => `${e.edge}: ${e.message}`)
    });
  }

  // Step 5: Contract Verification
  const verifyReport = await verifyGraph(graph as any);
  const verifiedTotal = verifyReport.nodes_verified + verifyReport.nodes_failed;
  const verifyErrors: string[] = [];
  let verifyDetail = `${verifyReport.nodes_verified}/${verifiedTotal} nodes verified (${verifyReport.verification_percentage}%)`;
  if (verifyReport.nodes_unsupported > 0) {
    verifyDetail += `\n                ${verifyReport.nodes_unsupported}/${verifyReport.results.length} unsupported expressions`;
  }
  for (const r of verifyReport.results) {
    for (const p of r.postconditions) {
      if (p.status === "failed") {
        verifyErrors.push(`Node "${r.node_id}" postcondition failed: ${p.expression}`);
      }
    }
    for (const a of r.adversarial_checks) {
      if (a.status === "failed") {
        verifyErrors.push(`Node "${r.node_id}" adversarial check failed: ${a.expression}`);
      }
    }
  }

  steps.push({
    name: "Verification",
    passed: verifyReport.nodes_failed === 0,
    details: verifyDetail,
    errors: verifyErrors
  });

  // Step 6: Summary
  const allPassed = steps.every(s => s.passed);
  printGenerateReport(graphId, steps, sep);
  return { accepted: allPassed || (checkResult.compatible && valResult.valid), steps };
}

function printGenerateReport(graphId: string, steps: GenerateStepResult[], sep: string): void {
  console.log(sep);
  console.log(`AETHER Generation Report: ${graphId}`);
  console.log(sep);

  for (const step of steps) {
    const pad = 16 - step.name.length;
    const padding = " ".repeat(Math.max(1, pad));
    console.log(`${step.name}:${padding}${step.details}`);

    for (const err of step.errors) {
      console.log(`  → ${err}`);
    }
  }

  console.log(sep);
  const allPassed = steps.every(s => s.passed);
  const hasSchemaOrStructErrors = steps.some(s => !s.passed && (s.name === "Schema" || s.name === "JSON Parse" || s.name === "Structure"));

  if (hasSchemaOrStructErrors) {
    const totalErrors = steps.reduce((sum, s) => sum + s.errors.length, 0);
    console.log(`STATUS: REJECTED — fix ${totalErrors} error(s) and re-validate`);
  } else if (allPassed) {
    console.log(`STATUS: ACCEPTED — graph is valid and verified`);
  } else {
    console.log(`STATUS: ACCEPTED — graph is valid and partially verified`);
  }
  console.log(sep);
}

// ─── Incremental Command ──────────────────────────────────────────────────────

async function cmdIncremental(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const builder = new IncrementalBuilder("incremental_graph");

  console.log("AETHER Incremental Builder");
  console.log("═══════════════════════════");
  console.log("Commands: add-node <path>, add-hole <path>, add-edge <from> <to>,");
  console.log("          fill-hole <id> <path>, remove-node <id>, status, finalize, quit");
  console.log();

  const prompt = (): Promise<string> =>
    new Promise((resolve) => rl.question("> ", resolve));

  let running = true;
  while (running) {
    const line = await prompt();
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];

    try {
      switch (cmd) {
        case "add-node": {
          const data = JSON.parse(readFileSync(parts[1], "utf-8"));
          const result = await builder.addNode(data);
          if (result.accepted) {
            const pure = result.validation.recovery_rule === "pass" ? "pure" : "effectful";
            console.log(`  ✓ Node "${result.node_id}" accepted (schema ✓, contracts ${result.validation.contracts}, ${pure})`);
          } else {
            console.log(`  ✗ Node "${result.node_id}" rejected`);
            result.errors.forEach(e => console.log(`    • ${e}`));
          }
          break;
        }
        case "add-hole": {
          const data = JSON.parse(readFileSync(parts[1], "utf-8"));
          const result = builder.addHole(data);
          if (result.accepted) {
            console.log(`  ◯ Hole "${result.hole_id}" registered`);
          } else {
            console.log(`  ✗ Hole rejected`);
            result.errors.forEach(e => console.log(`    • ${e}`));
          }
          break;
        }
        case "add-edge": {
          const result = builder.addEdge({ from: parts[1], to: parts[2] });
          if (result.accepted) {
            console.log(`  ✓ Edge accepted (${result.edge})`);
          } else {
            console.log(`  ✗ Edge rejected`);
            result.errors.forEach(e => console.log(`    • ${e}`));
          }
          break;
        }
        case "fill-hole": {
          const data = JSON.parse(readFileSync(parts[2], "utf-8"));
          const result = await builder.fillHole(parts[1], data);
          if (result.accepted) {
            console.log(`  ✓ Hole "${result.node_id}" filled — contracts satisfied`);
          } else {
            console.log(`  ✗ Fill rejected`);
            result.errors.forEach(e => console.log(`    • ${e}`));
          }
          break;
        }
        case "remove-node": {
          const result = builder.removeNode(parts[1]);
          if (result.removed) {
            console.log(`  ✓ Removed "${parts[1]}"`);
          } else {
            result.errors.forEach(e => console.log(`  ✗ ${e}`));
          }
          break;
        }
        case "status": {
          const report = builder.getReport();
          console.log(`  Nodes: ${report.verified_count}/${report.verified_count + report.hole_count} verified, ${report.hole_count} hole(s) remaining`);
          console.log(`  Edges: ${report.edges.length} connected`);
          console.log(`  Completeness: ${Math.round(report.completeness * 100)}%`);
          break;
        }
        case "finalize": {
          const result = builder.finalize();
          if (result.valid) {
            const graph = builder.getGraph();
            console.log(`  ✓ Graph finalized: ${graph.nodes.length} nodes, ${graph.edges.length} edges, 100% complete`);
          } else {
            console.log(`  ✗ Cannot finalize`);
            result.errors.forEach(e => console.log(`    • ${e}`));
          }
          break;
        }
        case "quit":
        case "exit":
          running = false;
          break;
        default:
          if (cmd) console.log(`  Unknown command: ${cmd}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  Error: ${msg}`);
    }
  }

  rl.close();
}

// ─── Execute Command ─────────────────────────────────────────────────────────

async function cmdExecute(filePath: string, inputsPath?: string): Promise<void> {
  const { execute } = await import("./runtime/executor.js");
  const graph = loadGraph(filePath);

  let inputs: Record<string, any> = {};
  if (inputsPath) {
    inputs = JSON.parse(readFileSync(inputsPath, "utf-8"));
  }

  const sep = "═══════════════════════════════════════════";
  const thin = "───────────────────────────────────────────";

  console.log(sep);
  console.log(`AETHER Execution: ${graph.id} (v${graph.version})`);
  console.log(sep);

  const result = await execute({
    graph: graph as any,
    inputs,
    nodeImplementations: new Map(),
    confidenceThreshold: 0.7,
    onEffectExecuted: (node, effect) => {
      // Effects logged in execution log
    },
  });

  // Print wave-by-wave log
  let currentWave = -1;
  for (const entry of result.executionLog) {
    if (entry.wave !== currentWave) {
      currentWave = entry.wave;
    }
    const waveNodes = result.executionLog
      .filter(e => e.wave === entry.wave)
      .map(e => e.nodeId);

    // Only print once per wave
    if (waveNodes[0] === entry.nodeId) {
      const nodeList = waveNodes.map(id => {
        const e = result.executionLog.find(x => x.nodeId === id)!;
        const status = e.skipped ? "⊘" : "✓";
        return id;
      }).join(", ");

      const waveEntries = result.executionLog.filter(e => e.wave === entry.wave);
      const maxDuration = Math.max(...waveEntries.map(e => e.duration_ms));
      const minConf = Math.min(...waveEntries.map(e => e.confidence));
      const anySkipped = waveEntries.some(e => e.skipped);
      const status = anySkipped ? "⊘" : "✓";

      console.log(`Wave ${entry.wave}: [${nodeList}]${" ".repeat(Math.max(1, 24 - nodeList.length))}${status} ${Math.round(maxDuration)}ms  confidence: ${minConf.toFixed(2)}`);
    }
  }

  console.log(thin);
  console.log(`Total:  ${result.nodesExecuted + result.nodesSkipped} nodes, ${result.waves} waves, ${Math.round(result.duration_ms)}ms`);
  console.log(`Final confidence: ${result.confidence.toFixed(2)}`);

  if (result.effectsPerformed.length > 0) {
    const unique = [...new Set(result.effectsPerformed)];
    console.log(`Effects: ${unique.join(", ")}`);
  }

  if (result.nodesSkipped > 0) {
    console.log(`Skipped: ${result.nodesSkipped} node(s) (below confidence threshold)`);
  }

  console.log(sep);
}

// ─── Visualize Command ───────────────────────────────────────────────────────

async function cmdVisualize(filePath: string, args: string[]): Promise<string | null> {
  const { generateVisualization } = await import("./visualizer/generate.js");
  const { writeFileSync } = await import("fs");
  const graph = loadGraph(filePath);

  let executionResult: any = undefined;
  if (args.includes("--execute")) {
    const { execute } = await import("./runtime/executor.js");
    executionResult = await execute({
      graph: graph as any,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });
  }

  const html = generateVisualization(graph as any, executionResult);

  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 && args[outputIdx + 1]
    ? args[outputIdx + 1]
    : `${graph.id}.html`;

  writeFileSync(outputPath, html, "utf-8");
  console.log(`✓ Visualization written to ${outputPath}`);

  if (args.includes("--open")) {
    const { exec } = await import("child_process");
    const platform = process.platform;
    const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
    exec(`${cmd} "${outputPath}"`);
  }

  return outputPath;
}

// ─── Compact/Expand Commands ─────────────────────────────────────────────────

async function cmdCompact(filePath: string, outputDir: string): Promise<void> {
  // Lazy import to avoid circular deps
  const { emitCompact } = await import("./compiler/compact.js");
  const graph = loadGraph(filePath);
  const compact = emitCompact(graph as any);

  const outputIdx = process.argv.indexOf("--output");
  if (outputIdx >= 0 && process.argv[outputIdx + 1]) {
    const { writeFileSync } = await import("fs");
    writeFileSync(process.argv[outputIdx + 1], compact, "utf-8");
    console.log(`✓ Compact form written to ${process.argv[outputIdx + 1]}`);
  } else {
    console.log(compact);
  }
}

async function cmdExpand(filePath: string): Promise<void> {
  const { parseCompact } = await import("./compiler/compact.js");
  const source = readFileSync(filePath, "utf-8");
  const graph = parseCompact(source);
  console.log(JSON.stringify(graph, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const __cliFilename = fileURLToPath(import.meta.url);
const __isCliMain = process.argv[1] === __cliFilename ||
  process.argv[1]?.endsWith("cli.ts") ||
  process.argv[1]?.endsWith("cli.js");

if (__isCliMain) {
  const args = process.argv.slice(2);
  const command = args[0];
  const cliFilePath = args[1];

  // Parse --output flag
  const outputIdx = args.indexOf("--output");
  const outputDir = outputIdx >= 0 && args[outputIdx + 1] ? args[outputIdx + 1] : ".";

  if (!command || command === "help") {
    printUsage();
    process.exit(0);
  }

  if (!cliFilePath && command !== "incremental") {
    console.error("Error: missing <path-to-json> argument");
    printUsage();
    process.exit(1);
  }

  (async () => {
    try {
      switch (command) {
        case "validate":
          if (!cmdValidate(cliFilePath)) process.exit(1);
          break;

        case "check":
          if (!cmdCheck(cliFilePath)) process.exit(1);
          break;

        case "verify":
          await cmdVerify(cliFilePath);
          break;

        case "transpile":
          if (!cmdTranspile(cliFilePath, outputDir)) process.exit(1);
          break;

        case "report":
          await cmdReport(cliFilePath, outputDir);
          break;

        case "generate": {
          const genResult = await cmdGenerate(cliFilePath);
          if (!genResult.accepted) process.exit(1);
          break;
        }

        case "incremental":
          await cmdIncremental();
          break;

        case "execute": {
          const inputsIdx = args.indexOf("--inputs");
          const inputsFile = inputsIdx >= 0 ? args[inputsIdx + 1] : undefined;
          await cmdExecute(cliFilePath, inputsFile);
          break;
        }

        case "visualize":
          await cmdVisualize(cliFilePath, args);
          break;

        case "compact":
          await cmdCompact(cliFilePath, outputDir);
          break;

        case "expand":
          await cmdExpand(cliFilePath);
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
}
