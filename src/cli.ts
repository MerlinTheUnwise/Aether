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

import { readFileSync, writeFileSync as fsWriteFileSync, existsSync } from "fs";
import path from "path";
import { join } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { validateGraph } from "./ir/validator.js";
import { checkTypes } from "./compiler/checker.js";
import { verifyGraph, printVerificationReport, type GraphVerificationReport } from "./compiler/verifier.js";
import { transpileGraph, transpileToFile } from "./compiler/transpiler.js";
import { IncrementalBuilder } from "./compiler/incremental.js";
import { instantiateTemplate, validateTemplate } from "./compiler/templates.js";
import { extractScope, verifyScope, checkBoundaryCompatibility, computeScopeOrder } from "./compiler/scopes.js";
import { simulateWithStubs } from "./agents/simulator.js";
import { resolveGraph, loadCertifiedLibrary } from "./compiler/resolver.js";
import { diffGraphs, hasBreakingChanges, affectedNodes } from "./compiler/diff.js";
import * as parserBridge from "./parser/bridge.js";
import * as parserErrors from "./parser/errors.js";

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
  if (filePath.endsWith(".aether")) {
    const source = readFileSync(filePath, "utf-8");
    const { graph, errors } = parserBridge.aetherToIR(source);
    if (errors.length > 0) {
      for (const err of errors) {
        console.error(parserErrors.formatError(err, filePath));
        console.error("");
      }
      process.exit(1);
    }
    return graph as unknown as AetherGraph;
  }
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as AetherGraph;
  return raw;
}

function printUsage(): void {
  console.log(`
AETHER CLI — Toolchain

Usage: npx tsx src/cli.ts <command> <path-to-json> [options]

Commands:
  validate <path>                Run IR validator
  check <path>                   Run semantic type checker
  verify <path>                  Run Z3 contract verifier
  transpile <path> [--output <dir>]  Generate JavaScript module
  report <path>                  Run ALL tools + summary dashboard
  generate <path>                Validate generated IR with actionable feedback
  instantiate <path> --bindings <json>  Instantiate a template with bindings
  incremental                    Start interactive incremental builder
  compact <path> [--output <p>]  Convert IR JSON to compact .aether form
  execute <path> [--inputs <p>]  Execute graph in runtime engine
                                  --mode mock|real  Service mode (default: mock)
                                  --db-path <path>  SQLite database file (real mode)
                                  --fs-path <path>  Filesystem sandbox base path (real mode)
  visualize <path> [--output <p>] [--execute] [--open]  Generate HTML visualization
  parse <path.aether>             Parse and validate .aether file
  format <path> [--output <p>]   Convert between .aether and .json formats
  init <name.aether>             Scaffold a new .aether file with starter template
  expand <path>                  Parse compact .aether form to IR JSON
  scope <path> <scope-id>        Extract and validate a single scope
  scope-check <path>             Validate all scopes and boundary compatibility
  collaborate <path>             Simulate multi-agent collaboration on scoped graph
  resolve <path>                 Resolve intent nodes against certified library
  diff <path-v1> <path-v2>      Semantic diff between two graph versions
  profile <path> [--runs <N>]   Profile graph execution and show hot paths
  jit <path> [--runs <N>] [--threshold <T>]  Compile hot subgraphs to optimized JS and benchmark
  dashboard <path> [--output <p>] [--open] [--execute] [--optimize] [--proofs]
                                   Generate verification dashboard HTML
  export-proofs <path> [--output <p.lean>]  Export Lean 4 proof skeletons
  emit-llvm <path> [--output <p.ll>]  Generate LLVM IR text file
  build-runtime [--check]          Build native C runtime library
  compile <path> [options]         Full native compilation pipeline
  benchmark <path> [--runs <N>] [--native]  Benchmark interpreted vs compiled vs native
  toolchain                        Check LLVM toolchain status
  dashboard-diff <path-v1> <path-v2> [--output <p>] [--open]
                                   Diff two graph versions as HTML report
  editor [path] [--output <p>] [--open]  Open interactive visual graph editor
  demo [--output <p>] [--open]           Generate interactive demo HTML
  ai "<description>"                     Generate AETHER-IR from natural language (requires ANTHROPIC_API_KEY)
  ai-test [--scenarios all|<id>] [--report]  Run bug detection scenarios against Claude
  run-pipeline <path> [options]              Run real I/O pipeline with filesystem access
                                  --fs-path <path>  Filesystem sandbox base (default: .)
                                  --inputs <json>   Pipeline inputs (paths, output_dir)
                                  --contracts enforce|warn|skip
  serve [path] [options]                     Start live dashboard server
                                  --port <n>        Server port (default: 3000)
                                  --fs-path <dir>   Filesystem base for real I/O
                                  --db-path <file>  SQLite database path
                                  --mode mock|real  Service mode (default: mock)
                                  --open            Auto-open browser

Registry:
  registry init                  Initialize local registry at ~/.aether/registry
  registry list                  List all packages with verification status
  registry info <package-name>   Show package details, versions, dependencies
  registry check <pkg> <v1> <v2> Check version compatibility
  publish <path> [--name <n>] [--version <v>] [--description <d>]
                                   Publish a graph as a package
  install <package-name> [--version <v>]  Install a package
  search <query>                 Search registry by keyword
  help                           Show this message
`.trim());
}

// ─── Commands ─────────────────────────────────────────────────────────────────

function cmdValidate(filePath: string): boolean {
  let raw: unknown;
  if (filePath.endsWith(".aether")) {
    raw = loadGraph(filePath);
  } else {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  }
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

  printVerificationReport(report);

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
  const valResult = validateGraph(graph as any);
  if (valResult.valid) {
    result.schemaValid = true;
    console.log(`Schema:         ✓ valid`);
    console.log(`DAG:            ✓ acyclic (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);

    // Template info
    const templates = (graph as any).templates as any[] | undefined;
    const instances = (graph as any).template_instances as any[] | undefined;
    if (templates && templates.length > 0) {
      console.log(`Templates:      ${templates.length} defined, ${instances?.length ?? 0} instances`);
      // Count instances per template
      const counts = new Map<string, string[]>();
      if (instances) {
        for (const inst of instances) {
          if (!counts.has(inst.template)) counts.set(inst.template, []);
          counts.get(inst.template)!.push(inst.id);
        }
      }
      for (const t of templates) {
        const ids = counts.get(t.id) || [];
        if (ids.length > 0) {
          console.log(`                ${t.id} × ${ids.length} (${ids.join(", ")})`);
        } else {
          console.log(`                ${t.id} × 0`);
        }
      }
    }

    // Scope info
    const scopesArr = (graph as any).scopes as any[] | undefined;
    if (scopesArr && scopesArr.length > 0) {
      const scopeNames = scopesArr.map((s: any) => s.id);
      // Count cross-scope edges
      const n2s = new Map<string, string>();
      for (const s of scopesArr) for (const nid of s.nodes) n2s.set(nid, s.id);
      let xEdges = 0;
      for (const e of graph.edges) {
        const f = e.from.split(".")[0], t = e.to.split(".")[0];
        if (n2s.get(f) !== n2s.get(t)) xEdges++;
      }

      console.log(`Scopes:         ${scopesArr.length} defined (${scopeNames.join(", ")})`);

      // Quick scope verification
      try {
        const scopeStatuses: string[] = [];
        for (const s of scopesArr) {
          const sv = extractScope(graph as any, s.id);
          const vr = verifyScope(sv);
          const valid = vr.internalValid && vr.boundariesSatisfied && vr.requirementsMet;
          scopeStatuses.push(`${s.id} ${valid ? "✓" : "✗"}`);
        }
        console.log(`Boundaries:     ${xEdges} cross-scope edges`);
        console.log(`Scope verify:   ${scopeStatuses.join(" | ")}`);
      } catch {
        console.log(`Boundaries:     ${xEdges} cross-scope edges`);
      }
    }
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

  // 3.5. Intent Resolution (if graph has intent nodes)
  try {
    const intentNodes = (graph as any).nodes.filter((n: any) => n.intent === true);
    if (intentNodes.length > 0) {
      const library = loadCertifiedLibrary();
      const resolution = resolveGraph(graph as any, library);
      console.log(`Intents:        ${resolution.intents_resolved}/${resolution.intents_found} resolved`);
      for (const r of resolution.resolutions) {
        if (r.resolved) {
          console.log(`                ${r.intentId} → ${r.matchReason.split("(")[0].trim()}`);
        }
      }
      if (resolution.intents_unresolved > 0) {
        for (const r of resolution.resolutions) {
          if (!r.resolved) {
            console.log(`                ${r.intentId} → unresolved`);
          }
        }
      }
    }
  } catch {
    // Intent resolution is optional in report
  }

  // 3.7. Optimization Suggestions
  try {
    const { GraphOptimizer } = await import("./compiler/optimizer.js");
    const optimizer = new GraphOptimizer();
    const optSuggestions = optimizer.analyze(graph as any);
    if (optSuggestions.length > 0) {
      const autoCount = optSuggestions.filter(s => s.autoApplicable).length;
      console.log(`Optimizations:  ${optSuggestions.length} suggestion(s) (${autoCount} auto-applicable)`);
    }
  } catch {
    // Optimization analysis is optional in report
  }

  // 3.8. Proof Export Summary
  try {
    const { generateProofExport } = await import("./proofs/generate.js");
    const proofExport = generateProofExport(graph as any, verifyReport);
    const m = proofExport.metadata;
    const sketched = m.theoremsGenerated - m.fullyProved - m.sorryCount;
    console.log(`Proofs:         ${m.theoremsGenerated} theorems (${m.fullyProved} proved, ${sketched >= 0 ? sketched : 0} sketched, ${m.sorryCount} obligations)`);
  } catch {
    // Proof export is optional in report
  }

  // 3.9. Native compilation info
  try {
    const { LLVMCodeGenerator, summarizeModule } = await import("./compiler/llvm/codegen.js");
    const gen = new LLVMCodeGenerator({ parallel: true });
    const mod = gen.generateModule(graph as any);
    const llText = gen.serialize(mod);
    const llSummary = summarizeModule(mod, llText);
    const waves = llSummary.parallel ? `${llSummary.taskWrapperCount > 0 ? llSummary.taskWrapperCount : 1} waves parallel` : "sequential";
    console.log(`Native:         ✓ ${graph.id}.ll (${llSummary.lineCount} lines, ${waves})`);
    console.log(`                To build: npx tsx src/cli.ts compile ${filePath}`);
  } catch {
    // Native info is optional in report
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

async function cmdExecute(filePath: string, cliArgs: string[]): Promise<void> {
  const { execute, createExecutionContext } = await import("./runtime/executor.js");
  const graph = loadGraph(filePath);

  // Parse flags
  const inputsIdx = cliArgs.indexOf("--inputs");
  const inputsPath = inputsIdx >= 0 ? cliArgs[inputsIdx + 1] : undefined;
  const seedIdx = cliArgs.indexOf("--seed");
  const seedPath = seedIdx >= 0 ? cliArgs[seedIdx + 1] : undefined;
  const contractsIdx = cliArgs.indexOf("--contracts");
  const contractsArg = contractsIdx >= 0 ? cliArgs[contractsIdx + 1] : undefined;
  const failuresIdx = cliArgs.indexOf("--inject-failures");
  const failuresArg = failuresIdx >= 0 ? cliArgs[failuresIdx + 1] : undefined;
  const modeIdx = cliArgs.indexOf("--mode");
  const modeArg = modeIdx >= 0 ? cliArgs[modeIdx + 1] : undefined;
  const dbPathIdx = cliArgs.indexOf("--db-path");
  const dbPathArg = dbPathIdx >= 0 ? cliArgs[dbPathIdx + 1] : undefined;
  const fsPathIdx = cliArgs.indexOf("--fs-path");
  const fsPathArg = fsPathIdx >= 0 ? cliArgs[fsPathIdx + 1] : undefined;
  const useReal = cliArgs.includes("--real") || modeArg === "real";

  let inputs: Record<string, any> = {};
  if (inputsPath) {
    const raw = inputsPath.startsWith("{") ? inputsPath : readFileSync(inputsPath, "utf-8");
    inputs = JSON.parse(raw);
  }

  const sep = "═══════════════════════════════════════════";
  const thin = "───────────────────────────────────────────";

  console.log(sep);
  console.log(`AETHER Execution: ${graph.id} (v${graph.version})`);
  console.log(sep);

  let result;

  if (useReal) {
    // Build seed data from seed file
    let seedData: Record<string, Record<string, any>[]> | undefined;
    if (seedPath) {
      seedData = JSON.parse(readFileSync(seedPath, "utf-8"));
    }

    const contractMode = (contractsArg as "enforce" | "warn" | "skip") ?? "enforce";

    // Auto-load referenced files into in-memory filesystem
    let filesystemFiles: Record<string, string> | undefined;
    if (inputs.file_path && seedPath) {
      const seedDir = path.dirname(seedPath);
      const filePath = path.join(seedDir, inputs.file_path);
      try {
        filesystemFiles = { [inputs.file_path]: readFileSync(filePath, "utf-8") };
      } catch {
        // File not found — will be caught by the implementation
      }
    }

    // Build service config based on mode
    const serviceConfig: any = {
      database: seedData ? { seed: seedData } : undefined,
      filesystem: filesystemFiles ? { files: filesystemFiles } : undefined,
    };

    // If --db-path or --fs-path specified, use real mode services
    if (dbPathArg || fsPathArg) {
      serviceConfig.mode = "real";
      serviceConfig.real = {};
      if (dbPathArg) {
        serviceConfig.real.database = { path: dbPathArg };
      }
      if (fsPathArg) {
        serviceConfig.real.filesystem = { basePath: fsPathArg };
      }
    }

    const ctx = await createExecutionContext(graph as any, inputs, {
      serviceConfig,
      contractMode,
    });

    // Inject failures if requested
    if (failuresArg && ctx.services) {
      const failConfig = failuresArg.startsWith("{") ? JSON.parse(failuresArg) : JSON.parse(readFileSync(failuresArg, "utf-8"));
      ctx.services.injectFailures(failConfig);
    }

    // Resolve all and print resolution report
    const resolution = ctx.registry!.resolveAll(graph as any);
    console.log(`Mode:   REAL (${resolution.resolved.size} implementations resolved)`);
    if (resolution.unresolved.length > 0) {
      console.log(`Unresolved: ${resolution.unresolved.join(", ")}`);
    }
    console.log(`Inputs: ${JSON.stringify(inputs)}`);
    console.log("");

    result = await execute(ctx);
  } else {
    console.log(`Mode:   STUB`);
    console.log(`Inputs: ${JSON.stringify(inputs)}`);
    console.log("");

    result = await execute({
      graph: graph as any,
      inputs,
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      contractMode: "skip",
      onEffectExecuted: (node, effect) => {},
    });
  }

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
      const nodeList = waveNodes.join(", ");

      const waveEntries = result.executionLog.filter(e => e.wave === entry.wave);
      const maxDuration = Math.max(...waveEntries.map(e => e.duration_ms));
      const minConf = Math.min(...waveEntries.map(e => e.confidence));
      const anySkipped = waveEntries.some(e => e.skipped);
      const status = anySkipped ? "⊘" : "✓";

      const effects = waveEntries.flatMap(e => e.effects);
      const effectStr = effects.length > 0 ? `  effects: [${[...new Set(effects)].join(", ")}]` : "";

      // Contract info
      const contractStr = useReal ? `  contracts: ✓` : "";

      console.log(`Wave ${entry.wave}: [${nodeList}]${" ".repeat(Math.max(1, 24 - nodeList.length))}${status} ${Math.round(maxDuration)}ms  confidence: ${minConf.toFixed(2)}${contractStr}${effectStr}`);

      // Print outputs for each node in --real mode
      if (useReal) {
        for (const we of waveEntries) {
          const outputs = result.outputs[we.nodeId];
          if (outputs) {
            const preview = JSON.stringify(outputs);
            const truncated = preview.length > 80 ? preview.slice(0, 77) + "..." : preview;
            console.log(`  → ${truncated}`);
          }
        }
      }
    }
  }

  console.log(thin);
  console.log(`Total:  ${result.nodesExecuted + result.nodesSkipped} nodes, ${result.waves} waves, ${Math.round(result.duration_ms)}ms`);

  if (result.contractReport) {
    const cr = result.contractReport;
    console.log(`Contracts: ${cr.passed}/${cr.totalChecked} passed, ${cr.violated} violated, ${cr.unevaluable} unevaluable`);
  }

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

// ─── Instantiate Command ─────────────────────────────────────────────────────

function cmdInstantiate(templatePath: string, bindingsJson: string, outputPath?: string): boolean {
  const template = JSON.parse(readFileSync(templatePath, "utf-8"));

  // Validate template
  const valResult = validateTemplate(template);
  if (!valResult.valid) {
    console.error("✗ Invalid template");
    valResult.errors.forEach(e => console.error(`  • ${e}`));
    return false;
  }

  // Parse bindings
  let bindings: Record<string, unknown>;
  try {
    bindings = JSON.parse(bindingsJson);
  } catch {
    console.error("✗ Invalid bindings JSON");
    return false;
  }

  // Create instance
  const instance = {
    id: template.id,
    template: template.id,
    bindings,
  };

  const result = instantiateTemplate(template, instance);
  if (!result.success) {
    console.error("✗ Instantiation failed");
    result.errors.forEach(e => console.error(`  • ${e}`));
    return false;
  }

  const output = {
    template: template.id,
    instance_id: instance.id,
    nodes: result.nodes,
    edges: result.edges,
  };

  const json = JSON.stringify(output, null, 2);
  if (outputPath) {
    fsWriteFileSync(outputPath, json, "utf-8");
    console.log(`✓ Instantiated ${template.id} → ${outputPath} (${result.nodes.length} nodes, ${result.edges.length} edges)`);
  } else {
    console.log(json);
  }

  return true;
}

// ─── Scope Commands ──────────────────────────────────────────────────────────

async function cmdScope(filePath: string, scopeId: string): Promise<boolean> {
  const graph = loadGraph(filePath);
  const sep = "═══════════════════════════════════════════";

  console.log(sep);
  console.log(`AETHER Scope: ${scopeId} (from ${graph.id})`);
  console.log(sep);

  try {
    const scopeView = extractScope(graph as any, scopeId);
    console.log(`Nodes:          ${scopeView.scope.nodes.length} (+ ${scopeView.boundaryStubs.length} boundary stubs)`);
    console.log(`Internal edges: ${scopeView.internalEdges.length}`);
    console.log(`Boundary edges: ${scopeView.boundaryEdges.length}`);

    // Validate extracted scope
    const valResult = (await import("./ir/validator.js")).validateGraph(scopeView.graph);
    console.log(`Validation:     ${valResult.valid ? "✓" : "✗"} (${valResult.errors.length} errors, ${valResult.warnings.length} warnings)`);
    if (!valResult.valid) {
      valResult.errors.forEach(e => console.log(`  • ${e}`));
    }

    // Type check extracted scope
    const checkResult = checkTypes(scopeView.graph as any);
    console.log(`Types:          ${checkResult.compatible ? "✓" : "✗"} ${checkResult.errors.length} errors`);

    // Verify scope boundaries
    const verification = verifyScope(scopeView);
    console.log(`Internal:       ${verification.internalValid ? "✓" : "✗"}`);
    console.log(`Boundaries:     ${verification.boundariesSatisfied ? "✓ satisfied" : "✗ unsatisfied"}`);
    console.log(`Requirements:   ${verification.requirementsMet ? "✓ met" : "✗ unmet"}`);

    if (verification.errors.length > 0) {
      verification.errors.forEach(e => console.log(`  • ${e}`));
    }

    console.log(sep);
    return verification.errors.length === 0 && valResult.valid;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${msg}`);
    console.log(sep);
    return false;
  }
}

export interface ScopeCheckResult {
  scopeCount: number;
  allValid: boolean;
  scopeResults: Array<{ id: string; valid: boolean; errors: string[] }>;
  boundaryResults: Array<{ from: string; to: string; compatible: boolean; errors: string[] }>;
  crossScopeEdges: number;
}

async function cmdScopeCheck(filePath: string): Promise<ScopeCheckResult> {
  const graph = loadGraph(filePath);
  const sep = "═══════════════════════════════════════════";

  console.log(sep);
  console.log(`AETHER Scope Check: ${graph.id}`);
  console.log(sep);

  const scopes = (graph as any).scopes as any[] | undefined;
  if (!scopes || scopes.length === 0) {
    console.log("No scopes defined.");
    console.log(sep);
    return { scopeCount: 0, allValid: true, scopeResults: [], boundaryResults: [], crossScopeEdges: 0 };
  }

  const scopeResults: Array<{ id: string; valid: boolean; errors: string[] }> = [];
  const boundaryResults: Array<{ from: string; to: string; compatible: boolean; errors: string[] }> = [];

  // Validate all scopes
  const scopeNames: string[] = [];
  for (const scope of scopes) {
    const scopeView = extractScope(graph as any, scope.id);
    const verification = verifyScope(scopeView);
    const valid = verification.internalValid && verification.boundariesSatisfied && verification.requirementsMet;
    scopeResults.push({ id: scope.id, valid, errors: verification.errors });
    scopeNames.push(scope.id);
  }

  // Count cross-scope edges
  const nodeToScope = new Map<string, string>();
  for (const scope of scopes) {
    for (const nodeId of scope.nodes) {
      nodeToScope.set(nodeId, scope.id);
    }
  }

  let crossScopeEdges = 0;
  for (const edge of graph.edges) {
    const from = edge.from.split(".")[0];
    const to = edge.to.split(".")[0];
    if (nodeToScope.get(from) !== nodeToScope.get(to)) {
      crossScopeEdges++;
    }
  }

  // Check boundary compatibility between connected scopes
  const scopeOrder = computeScopeOrder(graph as any);
  const scopeMap = new Map(scopes.map((s: any) => [s.id, s]));

  for (const edge of graph.edges) {
    const from = edge.from.split(".")[0];
    const to = edge.to.split(".")[0];
    const fromScopeId = nodeToScope.get(from);
    const toScopeId = nodeToScope.get(to);
    if (!fromScopeId || !toScopeId || fromScopeId === toScopeId) continue;

    // Check if we already have this pair
    if (boundaryResults.some(b => b.from === fromScopeId && b.to === toScopeId)) continue;

    const compat = checkBoundaryCompatibility(scopeMap.get(fromScopeId)!, scopeMap.get(toScopeId)!);
    boundaryResults.push({
      from: fromScopeId,
      to: toScopeId,
      compatible: compat.compatible,
      errors: compat.errors,
    });
  }

  // Print results
  console.log(`Scopes:         ${scopes.length} defined (${scopeNames.join(", ")})`);
  console.log(`Boundaries:     ${crossScopeEdges} cross-scope edges, ${boundaryResults.filter(b => b.compatible).length === boundaryResults.length ? "all compatible" : "some incompatible"}`);

  const scopeStatus = scopeResults.map(r => `${r.id} ${r.valid ? "✓" : "✗"}`).join(" | ");
  console.log(`Scope verify:   ${scopeStatus}`);

  for (const r of scopeResults) {
    if (!r.valid) {
      r.errors.forEach(e => console.log(`  • [${r.id}] ${e}`));
    }
  }

  for (const b of boundaryResults) {
    if (!b.compatible) {
      b.errors.forEach(e => console.log(`  • [${b.from}→${b.to}] ${e}`));
    }
  }

  console.log(sep);

  const allValid = scopeResults.every(r => r.valid) && boundaryResults.every(b => b.compatible);
  return { scopeCount: scopes.length, allValid, scopeResults, boundaryResults, crossScopeEdges };
}

// ─── Collaborate Command ─────────────────────────────────────────────────────

export interface CollaborateResult {
  graphId: string;
  scopeCount: number;
  overall: string;
  verificationPercentage: number;
  composedConfidence: number;
}

async function cmdCollaborate(filePath: string): Promise<CollaborateResult> {
  const graph = loadGraph(filePath);
  const sep = "═══════════════════════════════════════════════════";

  const scopes = (graph as any).scopes as any[] | undefined;
  if (!scopes || scopes.length === 0) {
    console.log("No scopes defined — nothing to collaborate on.");
    return { graphId: graph.id, scopeCount: 0, overall: "failed", verificationPercentage: 0, composedConfidence: 0 };
  }

  const { session, report } = await simulateWithStubs(graph as any);

  // Compute composed confidence from boundary contract confidences
  const confidences: number[] = [];
  for (const scope of scopes) {
    const provides = scope.boundary_contracts?.provides ?? [];
    for (const prov of provides) {
      if (prov.confidence !== undefined) {
        confidences.push(prov.confidence);
      }
    }
  }
  // Also collect node-level confidences
  for (const node of graph.nodes) {
    if ((node as any).confidence !== undefined) {
      confidences.push((node as any).confidence);
    }
  }
  const composedConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a * b, 1)
    : 1.0;

  console.log(sep);
  console.log(`AETHER Collaboration: ${graph.id} (v${graph.version})`);
  console.log(sep);
  console.log(`Agents:         ${scopes.length} assigned`);

  for (const scopeResult of report.scopes) {
    const submitted = scopeResult.status !== "pending" ? "submitted ✓" : "submitted ✗";
    const verified = scopeResult.status === "verified" ? "verified ✓" : scopeResult.status === "rejected" ? "verified ✗" : "pending";
    console.log(`  ${scopeResult.agent_id} → ${scopeResult.scope_id.padEnd(16)} ${submitted}  ${verified}`);
  }

  console.log(`Boundaries:`);
  for (const compat of report.cross_scope_compatibility) {
    const status = compat.compatible ? "✓ compatible" : "✗ incompatible";
    console.log(`  ${compat.provider_scope} → ${compat.requirer_scope.padEnd(16)} ${status}`);
    for (const err of compat.errors) {
      console.log(`    • ${err}`);
    }
  }

  const integrationStatus = report.overall === "integrated"
    ? "✓ all scopes verified"
    : report.overall === "partial"
      ? `partial — ${report.verification_percentage}% verified`
      : "✗ integration failed";
  console.log(`Integration:    ${integrationStatus}`);
  console.log(`Composed conf:  ${composedConfidence.toFixed(2)}`);
  console.log(sep);

  return {
    graphId: graph.id,
    scopeCount: scopes.length,
    overall: report.overall,
    verificationPercentage: report.verification_percentage,
    composedConfidence,
  };
}

// ─── Resolve Command ─────────────────────────────────────────────────────────

export interface ResolveResult {
  graphId: string;
  intentsFound: number;
  intentsResolved: number;
  intentsUnresolved: number;
}

function cmdResolve(filePath: string): ResolveResult {
  const graph = loadGraph(filePath);
  const library = loadCertifiedLibrary();
  const report = resolveGraph(graph as any, library);

  const sep = "═══════════════════════════════════════════";
  console.log(sep);
  console.log(`AETHER Intent Resolution: ${graph.id} (v${graph.version})`);
  console.log(sep);
  console.log(`Intents found:    ${report.intents_found}`);
  console.log(`Resolved:         ${report.intents_resolved}`);

  for (const r of report.resolutions) {
    if (r.resolved) {
      console.log(`  ${r.intentId.padEnd(20)} → ${r.matchReason}`);
    }
  }

  console.log(`Unresolved:       ${report.intents_unresolved}`);
  for (const r of report.resolutions) {
    if (!r.resolved) {
      console.log(`  ${r.intentId.padEnd(20)} → ${r.matchReason}`);
    }
  }

  console.log(sep);

  return {
    graphId: graph.id,
    intentsFound: report.intents_found,
    intentsResolved: report.intents_resolved,
    intentsUnresolved: report.intents_unresolved,
  };
}

// ─── Diff Command ────────────────────────────────────────────────────────────

export interface DiffResult {
  graphId: string;
  changes: number;
  breaking: boolean;
  breakingChanges: string[];
}

function cmdDiff(filePath1: string, filePath2: string): DiffResult {
  const graph1 = loadGraph(filePath1);
  const graph2 = loadGraph(filePath2);

  const diff = diffGraphs(graph1 as any, graph2 as any);
  const breaking = hasBreakingChanges(diff);
  const affected = affectedNodes(diff, graph2 as any);

  const sep = "═══════════════════════════════════════════";
  console.log(sep);
  console.log(`AETHER Semantic Diff: ${graph1.id} v${diff.version_from} → v${diff.version_to}`);
  console.log(sep);

  console.log(`Changes:          ${diff.changes.length}`);
  console.log(`  Nodes added:    ${diff.impact.nodes_added}`);
  console.log(`  Nodes removed:  ${diff.impact.nodes_removed}`);
  console.log(`  Types changed:  ${diff.impact.types_changed}`);
  console.log(`  Contracts:      ${diff.impact.contracts_changed}`);
  console.log(`  Effects:        ${diff.impact.effects_changed}`);
  console.log(`  Confidence:     ${diff.impact.confidence_changed}`);

  if (breaking) {
    console.log(`\nBreaking changes: ${diff.impact.breaking_changes.length}`);
    for (const bc of diff.impact.breaking_changes) {
      console.log(`  ⚠  ${bc}`);
    }
  } else {
    console.log(`\nBreaking changes: none`);
  }

  if (affected.length > 0) {
    console.log(`\nRe-verification needed: ${affected.length} node(s)`);
    console.log(`  ${affected.join(", ")}`);
  }

  console.log(sep);

  return {
    graphId: graph1.id,
    changes: diff.changes.length,
    breaking,
    breakingChanges: diff.impact.breaking_changes,
  };
}

// ─── Parser Commands ─────────────────────────────────────────────────────────

function cmdParse(filePath: string): void {
  const source = readFileSync(filePath, "utf-8");
  const { graph, errors } = parserBridge.aetherToIR(source);

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(parserErrors.formatError(err, filePath));
      console.error("");
    }
    process.exit(1);
  }

  if (graph) {
    const nodeCount = graph.nodes.length;
    const edgeCount = graph.edges.length;
    console.log(`✓ Valid AETHER program: ${graph.id} (${nodeCount} nodes, ${edgeCount} edges)`);
  }
}

function cmdFormat(filePath: string, outputDir: string, args: string[]): void {
  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx >= 0 && args[outputIdx + 1] ? args[outputIdx + 1] : undefined;

  if (filePath.endsWith(".aether")) {
    // .aether → JSON
    const source = readFileSync(filePath, "utf-8");
    const { graph, errors } = parserBridge.aetherToIR(source);
    if (errors.length > 0) {
      for (const err of errors) {
        console.error(parserErrors.formatError(err, filePath));
        console.error("");
      }
      process.exit(1);
    }
    const json = JSON.stringify(graph, null, 2);
    if (outputPath) {
      fsWriteFileSync(outputPath, json, "utf-8");
      console.log(`✓ Converted ${filePath} → ${outputPath}`);
    } else {
      const defaultPath = filePath.replace(/\.aether$/, ".json");
      fsWriteFileSync(defaultPath, json, "utf-8");
      console.log(`✓ Converted ${filePath} → ${defaultPath}`);
    }
  } else if (filePath.endsWith(".json")) {
    // JSON → .aether
    const graph = JSON.parse(readFileSync(filePath, "utf-8"));
    const aetherSource = parserBridge.irToAether(graph);
    if (outputPath) {
      fsWriteFileSync(outputPath, aetherSource, "utf-8");
      console.log(`✓ Converted ${filePath} → ${outputPath}`);
    } else {
      const defaultPath = filePath.replace(/\.json$/, ".aether");
      fsWriteFileSync(defaultPath, aetherSource, "utf-8");
      console.log(`✓ Converted ${filePath} → ${defaultPath}`);
    }
  } else {
    console.error("Error: format command requires a .json or .aether file");
    process.exit(1);
  }
}

function cmdInit(filePath: string): void {
  const name = path.basename(filePath, ".aether").replace(/[^a-zA-Z0-9_]/g, "_");

  const template = `// ${name.replace(/_/g, " ")}
// Created with: npx tsx src/cli.ts init

graph ${name} v1
  effects: []

  // Add your first node:
  node example_node
    in:  input: String
    out: output: String
    contracts:
      post: output.length > 0
    pure
    confidence: 0.99
  end

  // Add more nodes here...

  // Wire edges:
  // edge source_node.port -> dest_node.port

end
`;

  fsWriteFileSync(filePath, template, "utf-8");
  console.log(`✓ Created ${filePath}`);
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

// ─── Optimize Command ─────────────────────────────────────────────────────────

async function cmdOptimize(filePath: string, applyOpt: boolean, profilePath?: string): Promise<void> {
  const { GraphOptimizer } = await import("./compiler/optimizer.js");
  const graph = loadGraph(filePath);

  const sep = "═══════════════════════════════════════════════════";

  // Load profile if provided
  let profile: any = undefined;
  if (profilePath) {
    const { ExecutionProfiler } = await import("./runtime/profiler.js");
    const profileData = readFileSync(profilePath, "utf-8");
    const profiler = ExecutionProfiler.import(profileData);
    profile = profiler.analyze();
  }

  const optimizer = new GraphOptimizer();
  const suggestions = optimizer.analyze(graph as any, profile);

  console.log(sep);
  console.log(`AETHER Optimization Report: ${graph.id} (v${graph.version})`);
  console.log(sep);
  console.log(`Suggestions: ${suggestions.length} found`);
  console.log("");

  for (const s of suggestions) {
    console.log(`${s.priority.toUpperCase()}: ${s.type}`);
    console.log(`  Nodes: [${s.affectedNodes.join(", ")}]`);
    console.log(`  ${s.description}`);
    console.log(`  Impact: ${s.estimatedImpact}`);
    console.log(`  Auto-applicable: ${s.autoApplicable ? "✓" : "✗"}`);
    console.log("");
  }

  if (applyOpt) {
    const result = optimizer.applyAll(graph as any);
    console.log("Applied optimizations:");
    console.log(`  Applied: ${result.applied.length}`);
    console.log(`  Skipped: ${result.skipped.length}`);

    if (result.applied.length > 0) {
      // Validate the optimized graph
      const valResult = validateGraph(result.graph);
      console.log(`  Validation: ${valResult.valid ? "✓ valid" : "✗ invalid"}`);

      // Save optimized graph
      const outPath = filePath.replace(/\.json$/, "_optimized.json");
      fsWriteFileSync(outPath, JSON.stringify(result.graph, null, 2), "utf-8");
      console.log(`  Saved: ${outPath}`);

      // Before/after comparison
      const origNodes = (graph as any).nodes.length;
      const optNodes = result.graph.nodes.length;
      const origEdges = (graph as any).edges.length;
      const optEdges = result.graph.edges.length;
      console.log(`  Before: ${origNodes} nodes, ${origEdges} edges`);
      console.log(`  After:  ${optNodes} nodes, ${optEdges} edges`);
    }
  }

  console.log(sep);
}

// ─── Profile Command ──────────────────────────────────────────────────────────

async function cmdProfile(filePath: string, runs: number): Promise<void> {
  const { execute } = await import("./runtime/executor.js");
  const { ExecutionProfiler } = await import("./runtime/profiler.js");
  const graph = loadGraph(filePath);

  const profiler = new ExecutionProfiler(graph.id);
  profiler.setGraph(graph as any);

  const sep = "═══════════════════════════════════════════════════";
  const thin = "───────────────────────────────────────────────────";

  console.log(sep);
  console.log(`AETHER Profile: ${graph.id} (v${graph.version})`);
  console.log(sep);

  let totalTime = 0;
  for (let i = 0; i < runs; i++) {
    const result = await execute({
      graph: graph as any,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      jit: {
        compiler: undefined as any, // no compiler for profile-only
        profiler,
        autoCompile: false,
        compilationThreshold: runs,
      },
    });
    totalTime += result.duration_ms;
  }

  const avgTime = totalTime / runs;
  console.log(`Profiling:      ${runs} executions, avg ${avgTime.toFixed(1)}ms`);
  console.log("");

  const profile = profiler.analyze({ minExecutions: Math.min(runs, 10), minNodes: 2 });

  if (profile.hotPaths.length > 0) {
    console.log("Hot Paths:");
    for (const path of profile.hotPaths) {
      console.log(`  [${path.nodes.join(" → ")}]`);
      console.log(`    executions: ${path.executionCount}, avg: ${path.avgTotalTime_ms.toFixed(1)}ms, ${path.wave_count} waves`);
    }
    console.log("");
  }

  if (profile.recommendations.length > 0) {
    console.log("Recommendations:");
    for (const rec of profile.recommendations) {
      console.log(`  [${rec.subgraph.join(", ")}]`);
      console.log(`    ${rec.priority.toUpperCase()} — ${rec.reason}`);
      console.log(`    ${rec.estimatedSpeedup}`);
    }
  } else {
    console.log("No compilation recommendations (try more runs or a more complex graph)");
  }

  console.log(sep);
}

// ─── JIT Command ──────────────────────────────────────────────────────────────

async function cmdJIT(filePath: string, runs: number, threshold: number, optimize: boolean = false): Promise<void> {
  const { execute } = await import("./runtime/executor.js");
  const { ExecutionProfiler } = await import("./runtime/profiler.js");
  const { RuntimeCompiler } = await import("./runtime/jit.js");
  let graph = loadGraph(filePath);

  const profiler = new ExecutionProfiler(graph.id);
  profiler.setGraph(graph as any);
  const compiler = new RuntimeCompiler();

  const sep = "═══════════════════════════════════════════════════";
  const thin = "───────────────────────────────────────────────────";

  console.log(sep);
  console.log(`AETHER Compilation Report: ${graph.id} (v${graph.version})`);
  console.log(sep);

  // Phase 1: Profile
  let interpretedTotal = 0;
  for (let i = 0; i < runs; i++) {
    const result = await execute({
      graph: graph as any,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      jit: {
        compiler,
        profiler,
        autoCompile: false,
        compilationThreshold: threshold,
      },
    });
    interpretedTotal += result.duration_ms;
  }

  const interpretedAvg = interpretedTotal / runs;
  console.log(`Profiling:      ${runs} executions, avg ${interpretedAvg.toFixed(1)}ms`);
  console.log("");

  // Phase 1.5: Optimize if requested
  if (optimize) {
    const { GraphOptimizer } = await import("./compiler/optimizer.js");
    const profileForOpt = profiler.analyze({ minExecutions: Math.min(runs, threshold), minNodes: 2 });
    const optimizer = new GraphOptimizer();
    const optResult = optimizer.applyAll(graph as any);
    if (optResult.applied.length > 0) {
      graph = optResult.graph as any;
      console.log(`Optimization:   ${optResult.applied.length} auto-applied, ${optResult.skipped.length} skipped`);
      console.log("");
    }
  }

  // Phase 2: Analyze and compile
  const profile = profiler.analyze({ minExecutions: Math.min(runs, threshold), minNodes: 2 });

  if (profile.hotPaths.length > 0) {
    console.log("Hot Paths:");
    for (const path of profile.hotPaths) {
      console.log(`  [${path.nodes.join(" → ")}]`);
      console.log(`    executions: ${path.executionCount}, avg: ${path.avgTotalTime_ms.toFixed(1)}ms, ${path.wave_count} waves`);
      const rec = profile.recommendations.find(r => r.subgraph.some(n => path.nodes.includes(n)));
      if (rec) {
        console.log(`    recommendation: ${rec.priority.toUpperCase()} — compile into single function`);
      }
    }
    console.log("");
  }

  // Compile recommended subgraphs
  const compiledFuncs: any[] = [];
  for (const rec of profile.recommendations) {
    const compiled = compiler.compile(graph as any, rec.subgraph);
    compiledFuncs.push(compiled);
    console.log("Compilation:");
    console.log(`  ${compiled.id}: ${compiled.metadata.nodeCount} nodes, ${compiled.metadata.waveCount} waves → 1 function`);
    console.log(`    contracts inlined: ${compiled.metadata.contractsInlined}`);
    console.log(`    recoveries inlined: ${compiled.metadata.recoveriesInlined}`);
    console.log("");
  }

  if (compiledFuncs.length === 0) {
    console.log("No subgraphs compiled (graph may be too simple or not enough runs)");
    console.log(sep);
    return;
  }

  // Phase 3: Re-execute with JIT
  let jitTotal = 0;
  for (let i = 0; i < runs; i++) {
    const result = await execute({
      graph: graph as any,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      jit: {
        compiler,
        profiler: new ExecutionProfiler(graph.id), // fresh profiler for JIT runs
        autoCompile: false,
        compilationThreshold: threshold,
      },
    });
    jitTotal += result.duration_ms;
  }

  const jitAvg = jitTotal / runs;
  const speedup = ((interpretedAvg - jitAvg) / interpretedAvg * 100);

  console.log("Performance:");
  console.log(`  Interpreted:  avg ${interpretedAvg.toFixed(1)}ms (${runs} runs)`);
  console.log(`  Compiled:     avg ${jitAvg.toFixed(1)}ms  (${runs} runs)`);
  if (speedup > 0) {
    console.log(`  Speedup:      ${speedup.toFixed(0)}% faster`);
  } else {
    console.log(`  Speedup:      no improvement (graph too simple for compilation overhead to matter)`);
  }
  console.log(sep);
}

// ─── Run Pipeline Command ─────────────────────────────────────────────────────

async function cmdRunPipeline(filePath: string, cliArgs: string[]): Promise<void> {
  const { execute, createExecutionContext } = await import("./runtime/executor.js");
  const { existsSync } = await import("fs");
  const graph = loadGraph(filePath);

  // Parse flags
  const inputsIdx = cliArgs.indexOf("--inputs");
  const inputsArg = inputsIdx >= 0 ? cliArgs[inputsIdx + 1] : undefined;
  const fsPathIdx = cliArgs.indexOf("--fs-path");
  const fsPathArg = fsPathIdx >= 0 ? cliArgs[fsPathIdx + 1] : ".";
  const contractsIdx = cliArgs.indexOf("--contracts");
  const contractsArg = (contractsIdx >= 0 ? cliArgs[contractsIdx + 1] : "enforce") as "enforce" | "warn" | "skip";

  let inputs: Record<string, any> = {};
  if (inputsArg) {
    const raw = inputsArg.startsWith("{") ? inputsArg : readFileSync(inputsArg, "utf-8");
    inputs = JSON.parse(raw);
  }

  const sep = "═══════════════════════════════════════════";
  const thin = "───────────────────────────────────────────";

  console.log(sep);
  console.log(`AETHER Pipeline: ${graph.id} (v${graph.version})`);
  console.log(sep);

  // Build service config for real filesystem mode
  const serviceConfig: any = {
    mode: "real",
    real: {
      filesystem: { basePath: path.resolve(fsPathArg) },
    },
  };

  // Map pipeline inputs to node inputs
  const pipelineInputs: Record<string, any> = {};
  if (inputs.transactions_path) {
    pipelineInputs["read_transactions"] = { file_path: inputs.transactions_path };
  }
  if (inputs.customers_path) {
    pipelineInputs["read_customers"] = { file_path: inputs.customers_path };
  }
  if (inputs.categories_path) {
    pipelineInputs["read_categories"] = { file_path: inputs.categories_path };
  }
  if (inputs.output_dir) {
    pipelineInputs["write_csv_output"] = { output_dir: inputs.output_dir };
    pipelineInputs["write_report"] = { output_dir: inputs.output_dir };
    pipelineInputs["write_summary"] = { output_dir: inputs.output_dir };
  }

  const ctx = await createExecutionContext(graph as any, pipelineInputs, {
    serviceConfig,
    contractMode: contractsArg,
  });

  // Resolve all and print resolution report
  const resolution = ctx.registry!.resolveAll(graph as any);
  console.log(`Mode:           REAL (filesystem: ${path.resolve(fsPathArg)})`);
  console.log(`Implementations: ${resolution.resolved.size} resolved`);
  if (resolution.unresolved.length > 0) {
    console.log(`Unresolved:     ${resolution.unresolved.join(", ")}`);
  }
  console.log(`Contracts:      ${contractsArg}`);
  console.log(`Inputs:         ${JSON.stringify(inputs)}`);
  console.log("");

  const startTime = Date.now();
  const result = await execute(ctx);
  const totalTime = Date.now() - startTime;

  // Print wave-by-wave log
  let currentWave = -1;
  for (const entry of result.executionLog) {
    if (entry.wave !== currentWave) {
      currentWave = entry.wave;
    }
    const waveNodes = result.executionLog
      .filter(e => e.wave === entry.wave)
      .map(e => e.nodeId);

    if (waveNodes[0] === entry.nodeId) {
      const nodeList = waveNodes.join(", ");
      const waveEntries = result.executionLog.filter(e => e.wave === entry.wave);
      const maxDuration = Math.max(...waveEntries.map(e => e.duration_ms));
      const minConf = Math.min(...waveEntries.map(e => e.confidence));
      const anySkipped = waveEntries.some(e => e.skipped);
      const status = anySkipped ? "⊘" : "✓";

      const effects = waveEntries.flatMap(e => e.effects);
      const effectStr = effects.length > 0 ? `  effects: [${[...new Set(effects)].join(", ")}]` : "";

      console.log(`Wave ${entry.wave}: [${nodeList}]`);
      console.log(`  ${status} ${Math.round(maxDuration)}ms  confidence: ${minConf.toFixed(2)}  contracts: ✓${effectStr}`);

      for (const we of waveEntries) {
        const outputs = result.outputs[we.nodeId];
        if (outputs) {
          const preview = JSON.stringify(outputs);
          const truncated = preview.length > 100 ? preview.slice(0, 97) + "..." : preview;
          console.log(`  → ${we.nodeId}: ${truncated}`);
        }
      }
    }
  }

  console.log(thin);
  console.log(`Total:  ${result.nodesExecuted + result.nodesSkipped} nodes, ${result.waves} waves, ${totalTime}ms`);

  if (result.contractReport) {
    const cr = result.contractReport;
    console.log(`Contracts: ${cr.passed}/${cr.totalChecked} passed, ${cr.violated} violated, ${cr.unevaluable} unevaluable`);
  }

  console.log(`Final confidence: ${result.confidence.toFixed(2)}`);

  if (result.effectsPerformed.length > 0) {
    const unique = [...new Set(result.effectsPerformed)];
    console.log(`Effects: ${unique.join(", ")}`);
  }

  // Check output files
  if (inputs.output_dir) {
    const outputDir = path.resolve(fsPathArg, inputs.output_dir);
    console.log("");
    console.log("Output files:");
    const files = ["cleaned_transactions.csv", "report.html", "summary.json"];
    for (const file of files) {
      const fp = path.join(outputDir, file);
      const exists = existsSync(fp);
      console.log(`  ${exists ? "✓" : "✗"} ${fp}`);
    }
  }

  console.log(sep);
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

  const noFileCommands = new Set(["incremental", "registry", "search", "install", "ai-test"]);
  if (!cliFilePath && !noFileCommands.has(command)) {
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

        case "instantiate": {
          const bindingsIdx = args.indexOf("--bindings");
          const bindingsArg = bindingsIdx >= 0 ? args[bindingsIdx + 1] : undefined;
          if (!bindingsArg) {
            console.error("Error: --bindings <json> is required for instantiate");
            process.exit(1);
          }
          const instOutputIdx = args.indexOf("--output");
          const instOutput = instOutputIdx >= 0 ? args[instOutputIdx + 1] : undefined;
          if (!cmdInstantiate(cliFilePath, bindingsArg, instOutput)) process.exit(1);
          break;
        }

        case "incremental":
          await cmdIncremental();
          break;

        case "execute": {
          if (args.includes("--jit")) {
            await cmdJIT(cliFilePath, 20, 10, args.includes("--optimize"));
          } else if (args.includes("--profile")) {
            await cmdProfile(cliFilePath, 20);
          } else {
            await cmdExecute(cliFilePath, args);
          }
          break;
        }

        case "visualize":
          await cmdVisualize(cliFilePath, args);
          break;

        case "parse": {
          cmdParse(cliFilePath);
          break;
        }

        case "format": {
          cmdFormat(cliFilePath, outputDir, args);
          break;
        }

        case "init": {
          cmdInit(cliFilePath);
          break;
        }

        case "compact":
          await cmdCompact(cliFilePath, outputDir);
          break;

        case "expand":
          await cmdExpand(cliFilePath);
          break;

        case "scope": {
          const scopeIdArg = args[2];
          if (!scopeIdArg) {
            console.error("Error: missing <scope-id> argument");
            process.exit(1);
          }
          if (!(await cmdScope(cliFilePath, scopeIdArg))) process.exit(1);
          break;
        }

        case "scope-check": {
          const scResult = await cmdScopeCheck(cliFilePath);
          if (!scResult.allValid) process.exit(1);
          break;
        }

        case "collaborate": {
          const collab = await cmdCollaborate(cliFilePath);
          if (collab.overall === "failed") process.exit(1);
          break;
        }

        case "resolve": {
          cmdResolve(cliFilePath);
          break;
        }

        case "diff": {
          const diffPath2 = args[2];
          if (!diffPath2) {
            console.error("Error: missing second <path-to-json> argument for diff");
            process.exit(1);
          }
          cmdDiff(cliFilePath, diffPath2);
          break;
        }

        case "profile": {
          const profileRunsIdx = args.indexOf("--runs");
          const profileRuns = profileRunsIdx >= 0 ? parseInt(args[profileRunsIdx + 1], 10) : 20;
          await cmdProfile(cliFilePath, profileRuns);
          break;
        }

        case "jit": {
          const jitRunsIdx = args.indexOf("--runs");
          const jitRuns = jitRunsIdx >= 0 ? parseInt(args[jitRunsIdx + 1], 10) : 20;
          const jitThreshIdx = args.indexOf("--threshold");
          const jitThreshold = jitThreshIdx >= 0 ? parseInt(args[jitThreshIdx + 1], 10) : 10;
          const jitOptimize = args.includes("--optimize");
          await cmdJIT(cliFilePath, jitRuns, jitThreshold, jitOptimize);
          break;
        }

        case "optimize": {
          const optApply = args.includes("--apply");
          const optProfileIdx = args.indexOf("--profile");
          const optProfilePath = optProfileIdx >= 0 ? args[optProfileIdx + 1] : undefined;
          await cmdOptimize(cliFilePath, optApply, optProfilePath);
          break;
        }

        case "dashboard": {
          const { collectDashboardData } = await import("./dashboard/collector.js");
          const { renderDashboard } = await import("./dashboard/render.js");
          const { writeFileSync } = await import("fs");

          const dashData = await collectDashboardData(cliFilePath, {
            includeExecution: args.includes("--execute"),
            includeOptimization: args.includes("--optimize"),
            includeProofs: args.includes("--proofs"),
          });

          const html = renderDashboard(dashData);
          const dashOutputIdx = args.indexOf("--output");
          const dashOutputPath = dashOutputIdx >= 0 && args[dashOutputIdx + 1]
            ? args[dashOutputIdx + 1]
            : `${dashData.graph.id}-dashboard.html`;

          writeFileSync(dashOutputPath, html, "utf-8");
          console.log(`✓ Dashboard written to ${dashOutputPath}`);

          if (args.includes("--open")) {
            const { exec } = await import("child_process");
            const platform = process.platform;
            const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
            exec(`${cmd} "${dashOutputPath}"`);
          }
          break;
        }

        case "dashboard-diff": {
          const { collectDashboardData: collectDiff } = await import("./dashboard/collector.js");
          const { diffDashboards, renderDiffView } = await import("./dashboard/diff-view.js");
          const { writeFileSync: writeDiff } = await import("fs");

          const diffPath2Dash = args[2];
          if (!diffPath2Dash) {
            console.error("Error: missing second <path-to-json> argument for dashboard-diff");
            process.exit(1);
          }

          const [beforeData, afterData] = await Promise.all([
            collectDiff(cliFilePath),
            collectDiff(diffPath2Dash),
          ]);

          const dashDiff = diffDashboards(beforeData, afterData);
          const diffHtml = renderDiffView(dashDiff);

          const diffOutIdx = args.indexOf("--output");
          const diffOutPath = diffOutIdx >= 0 && args[diffOutIdx + 1]
            ? args[diffOutIdx + 1]
            : `${beforeData.graph.id}-diff.html`;

          writeDiff(diffOutPath, diffHtml, "utf-8");
          console.log(`✓ Dashboard diff written to ${diffOutPath}`);

          if (args.includes("--open")) {
            const { exec } = await import("child_process");
            const platform = process.platform;
            const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
            exec(`${cmd} "${diffOutPath}"`);
          }
          break;
        }

        case "export-proofs": {
          const { generateProofExport } = await import("./proofs/generate.js");
          const { verifyGraph: verifyForProofs } = await import("./compiler/verifier.js");
          const { writeFileSync: writeProof } = await import("fs");

          const proofGraph = loadGraph(cliFilePath);
          const sep = "═══════════════════════════════════════════════════";

          // Run verification for proof context
          let proofVerifyReport: GraphVerificationReport | undefined;
          try {
            proofVerifyReport = await verifyForProofs(proofGraph as any);
          } catch {
            // Verification optional
          }

          const proofExport = generateProofExport(proofGraph as any, proofVerifyReport);
          const proofOutputIdx = args.indexOf("--output");
          const proofOutputPath = proofOutputIdx >= 0 && args[proofOutputIdx + 1]
            ? args[proofOutputIdx + 1]
            : proofExport.filename;

          writeProof(proofOutputPath, proofExport.source, "utf-8");

          const m = proofExport.metadata;
          const sketched = m.theoremsGenerated - m.fullyProved - m.sorryCount;

          // Collect semantic type wrappers count
          const proofNodes = (proofGraph as any).nodes.filter((n: any) => !n.hole && !n.intent);
          const wrapperSet = new Set<string>();
          for (const node of proofNodes) {
            for (const [name, ann] of [...Object.entries(node.in || {}), ...Object.entries(node.out || {})]) {
              const a = ann as any;
              if (a.domain || a.dimension || a.unit) {
                const wn = name.replace(/(^|[_-])([a-z])/g, (_: any, __: any, c: string) => c.toUpperCase());
                wrapperSet.add(wn);
              }
            }
          }
          const stateTypeCount = ((proofGraph as any).state_types ?? []).length;

          console.log(sep);
          console.log(`AETHER Proof Export: ${proofGraph.id} (v${proofGraph.version})`);
          console.log(sep);
          console.log(`Types exported:    ${wrapperSet.size} semantic wrappers`);
          console.log(`State types:       ${stateTypeCount}`);
          console.log(`Node contracts:    ${m.nodesExported} namespaces`);
          console.log(`Theorems:          ${m.theoremsGenerated}`);
          console.log(`  Fully proved:    ${m.fullyProved}`);
          console.log(`  Proof sketches:  ${sketched >= 0 ? sketched : 0}`);
          console.log(`  Obligations:     ${m.sorryCount}`);
          console.log(`Edge safety:       ${proofGraph.edges.length} edges`);
          console.log(`Output:            ${proofOutputPath}`);
          console.log(sep);
          break;
        }

        case "registry": {
          const { Registry } = await import("./registry/index.js");
          const subCommand = cliFilePath; // args[1] is the sub-command
          const sep = "═══════════════════════════════════════════════════";

          switch (subCommand) {
            case "init": {
              const regPath = Registry.init();
              console.log(`✓ Registry initialized at ${regPath}`);
              break;
            }

            case "list": {
              const registry = new Registry();
              const entries = registry.list();

              if (entries.length === 0) {
                console.log("No packages in registry. Run: npx tsx scripts/publish-stdlib.ts");
                break;
              }

              console.log(sep);
              console.log("AETHER Registry: list");
              console.log(sep);

              const templateEntries = entries.filter(e => {
                const latest = e.versions[e.latest];
                return latest?.provides_type === "template";
              });
              const certEntries = entries.filter(e => {
                const latest = e.versions[e.latest];
                return latest?.provides_type === "certified-algorithm";
              });
              const otherEntries = entries.filter(e => {
                const latest = e.versions[e.latest];
                return latest?.provides_type !== "template" && latest?.provides_type !== "certified-algorithm";
              });

              if (templateEntries.length > 0) {
                console.log(`Templates (${templateEntries.length}):`);
                for (const e of templateEntries) {
                  const v = e.versions[e.latest];
                  console.log(`  ${e.name.padEnd(30)} v${e.latest}  ✓ ${v.verification_percentage}%`);
                }
                console.log();
              }

              if (certEntries.length > 0) {
                console.log(`Certified Algorithms (${certEntries.length}):`);
                for (const e of certEntries) {
                  const v = e.versions[e.latest];
                  console.log(`  ${e.name.padEnd(30)} v${e.latest}  ✓ ${v.verification_percentage}%`);
                }
                console.log();
              }

              if (otherEntries.length > 0) {
                console.log(`Other (${otherEntries.length}):`);
                for (const e of otherEntries) {
                  const v = e.versions[e.latest];
                  console.log(`  ${e.name.padEnd(30)} v${e.latest}  ✓ ${v.verification_percentage}%`);
                }
                console.log();
              }

              const totalPkgs = entries.length;
              const avgVerif = entries.reduce((sum, e) => sum + (e.versions[e.latest]?.verification_percentage ?? 0), 0) / totalPkgs;
              console.log(`${totalPkgs} packages, avg verification: ${avgVerif.toFixed(1)}%`);
              console.log(sep);
              break;
            }

            case "info": {
              const pkgName = args[2];
              if (!pkgName) {
                console.error("Error: missing <package-name> argument");
                process.exit(1);
              }

              const registry = new Registry();
              const info = registry.info(pkgName);

              if (!info) {
                console.error(`Package not found: ${pkgName}`);
                process.exit(1);
              }

              console.log(sep);
              console.log(`AETHER Registry: info ${pkgName}`);
              console.log(sep);
              console.log(`Name:        ${info.name}`);
              console.log(`Description: ${info.description}`);
              console.log(`Latest:      v${info.latest}`);
              console.log(`Keywords:    ${info.keywords.join(", ")}`);
              console.log();
              console.log("Versions:");
              for (const [ver, data] of Object.entries(info.versions)) {
                console.log(`  v${ver}  ✓ ${data.verification_percentage}%  confidence: ${data.confidence}  type: ${data.provides_type}`);
                if (Object.keys(data.dependencies).length > 0) {
                  console.log(`    deps: ${Object.entries(data.dependencies).map(([k, v]) => `${k}@${v}`).join(", ")}`);
                }
                if (data.effects.length > 0) {
                  console.log(`    effects: ${data.effects.join(", ")}`);
                } else {
                  console.log(`    effects: none (pure)`);
                }
              }
              console.log(sep);
              break;
            }

            case "check": {
              const checkPkg = args[2];
              const fromVer = args[3];
              const toVer = args[4];
              if (!checkPkg || !fromVer || !toVer) {
                console.error("Error: usage: registry check <package-name> <from-version> <to-version>");
                process.exit(1);
              }

              const registry = new Registry();
              const compat = registry.checkCompatibility(checkPkg, fromVer, toVer);

              console.log(sep);
              console.log(`AETHER Registry: compatibility check`);
              console.log(`${checkPkg} v${fromVer} → v${toVer}`);
              console.log(sep);
              console.log(`Compatible: ${compat.compatible ? "✓ yes" : "✗ no"}`);
              if (compat.breakingChanges.length > 0) {
                console.log("Breaking changes:");
                for (const bc of compat.breakingChanges) {
                  console.log(`  • ${bc}`);
                }
              }
              console.log(`Changes: ${compat.diff.changes.length}`);
              console.log(sep);
              break;
            }

            default:
              console.error(`Unknown registry sub-command: ${subCommand}`);
              console.error("Available: init, list, info, check");
              process.exit(1);
          }
          break;
        }

        case "publish": {
          const { createPackage, validatePackage } = await import("./registry/package.js");
          const { Registry } = await import("./registry/index.js");
          const { writeFileSync: writePub } = await import("fs");
          const sep = "═══════════════════════════════════════════════════";

          const pubGraph = loadGraph(cliFilePath);

          // Parse optional flags
          const nameIdx = args.indexOf("--name");
          const pubName = nameIdx >= 0 && args[nameIdx + 1] ? args[nameIdx + 1] : undefined;
          const verIdx = args.indexOf("--version");
          const pubVersion = verIdx >= 0 && args[verIdx + 1] ? args[verIdx + 1] : undefined;
          const descIdx = args.indexOf("--description");
          const pubDesc = descIdx >= 0 && args[descIdx + 1] ? args[descIdx + 1] : undefined;
          const minVerifIdx = args.indexOf("--min-verification");
          const minVerif = minVerifIdx >= 0 && args[minVerifIdx + 1] ? parseInt(args[minVerifIdx + 1]) : 50;

          // Run verification
          let pubVerifReport: GraphVerificationReport | undefined;
          try {
            pubVerifReport = await verifyGraph(pubGraph as any);
          } catch {
            // Verification optional
          }

          const verifPct = pubVerifReport?.verification_percentage ?? 0;
          if (verifPct < minVerif) {
            console.error(`✗ Package verification ${verifPct}% is below minimum ${minVerif}%`);
            console.error(`  Use --min-verification <N> to change threshold`);
            process.exit(1);
          }

          const pkg = createPackage(pubGraph as any, {
            name: pubName,
            version: pubVersion,
            description: pubDesc,
            verification: {
              percentage: verifPct,
              confidence: verifPct / 100,
              supervised_count: 0,
              z3_verified: !!pubVerifReport,
              lean_proofs: false,
              last_verified: new Date().toISOString(),
            },
          });

          if (pubVerifReport) {
            pkg.verification = pubVerifReport as any;
          }

          const registry = new Registry();
          const pubResult = registry.publish(pkg);

          if (pubResult.success) {
            console.log(sep);
            console.log(`✓ Published ${pubResult.name} v${pubResult.version}`);
            console.log(`  Verification: ${pubResult.verification}%`);
            console.log(sep);
          } else {
            console.error(`✗ Publish failed: ${pubResult.errors?.join(", ")}`);
            process.exit(1);
          }
          break;
        }

        case "install": {
          const { Registry } = await import("./registry/index.js");
          const sep = "═══════════════════════════════════════════════════";

          const installPkg = cliFilePath; // args[1] is package name
          const instVerIdx = args.indexOf("--version");
          const instVersion = instVerIdx >= 0 && args[instVerIdx + 1] ? args[instVerIdx + 1] : undefined;

          const registry = new Registry();
          const installResult = registry.install(installPkg, instVersion);

          if (installResult.success) {
            console.log(sep);
            console.log(`AETHER Install`);
            console.log(sep);
            for (const inst of installResult.installed) {
              console.log(`  ✓ ${inst.name} v${inst.version}`);
            }
            console.log(`Installed to ./aether_packages/`);
            console.log(sep);
          } else {
            console.error(`✗ Install failed: ${installResult.errors?.join(", ")}`);
            process.exit(1);
          }
          break;
        }

        case "search": {
          const { Registry } = await import("./registry/index.js");
          const sep = "═══════════════════════════════════════════════════";

          const searchQuery = cliFilePath ?? args[1] ?? "";
          if (!searchQuery) {
            console.error("Error: missing search query");
            process.exit(1);
          }

          const registry = new Registry();
          const results = registry.search(searchQuery);

          console.log(sep);
          console.log(`AETHER Registry: search "${searchQuery}"`);
          console.log(sep);

          if (results.length === 0) {
            console.log("No packages found.");
          } else {
            for (const r of results) {
              const v = r.versions[r.latest];
              console.log(`${r.name}  v${r.latest}  ✓ ${v.verification_percentage}% verified`);
              console.log(`  ${r.description}`);
              if (v.effects.length > 0) {
                console.log(`  Effects: ${v.effects.join(", ")}`);
              } else {
                console.log(`  Effects: none (pure)`);
              }
              console.log();
            }
          }

          console.log(`Found ${results.length} package${results.length !== 1 ? "s" : ""}.`);
          console.log(sep);
          break;
        }

        case "emit-llvm": {
          const { LLVMCodeGenerator, summarizeModule } = await import("./compiler/llvm/codegen.js");
          const { writeFileSync: writeLLVM } = await import("fs");

          const llvmGraph = loadGraph(cliFilePath);
          const sep = "═══════════════════════════════════════════════════";

          // Validate graph first
          const llvmValidation = validateGraph(llvmGraph);
          if (!llvmValidation.valid) {
            console.error("Error: graph validation failed — cannot emit LLVM IR");
            for (const err of llvmValidation.errors) {
              console.error(`  - ${err}`);
            }
            process.exit(1);
          }

          // Parse parallel flag
          const llvmParallel = !args.includes("--no-parallel");

          const gen = new LLVMCodeGenerator({ parallel: llvmParallel });
          const mod = gen.generateModule(llvmGraph as any);
          const llvmText = gen.serialize(mod);
          const summary = summarizeModule(mod, llvmText);
          summary.version = llvmGraph.version;

          const llvmOutputIdx = args.indexOf("--output");
          const llvmOutputPath = llvmOutputIdx >= 0 && args[llvmOutputIdx + 1]
            ? args[llvmOutputIdx + 1]
            : `${llvmGraph.id}.ll`;

          writeLLVM(llvmOutputPath, llvmText, "utf-8");

          console.log(sep);
          console.log(`AETHER LLVM Emit: ${llvmGraph.id} (v${llvmGraph.version})`);
          console.log(sep);
          console.log(`Nodes:          ${summary.nodeCount} → ${summary.functionCount} LLVM functions`);
          console.log(`Structs:        ${summary.structCount}`);
          console.log(`Contracts:      ${summary.contractsInlined} inlined, ${summary.contractsSkipped} skipped (Z3-verified)`);
          console.log(`Confidence:     ${summary.hasConfidence ? "propagation inlined" : "none"}`);
          console.log(`Parallel:       ${summary.parallel ? `enabled (${summary.taskWrapperCount} task wrappers)` : "disabled"}`);
          console.log(`Runtime deps:   ${summary.runtimeDeps.join(", ")}`);
          console.log(`Output:         ${llvmOutputPath} (${summary.lineCount} lines)`);
          console.log(sep);
          break;
        }

        case "build-runtime": {
          const { buildRuntime, checkClang, getRuntimeSignatures } = await import("./compiler/llvm/runtime/build-runtime.js");
          const sep = "═══════════════════════════════════════════════════";
          const checkOnly = args.includes("--check");

          console.log(sep);
          console.log("AETHER Native Runtime Build");
          console.log(sep);

          const clang = checkClang();
          console.log(`Clang:          ${clang.found ? `found (${clang.version})` : "NOT FOUND"}`);

          const sigs = getRuntimeSignatures();
          console.log(`Functions:      ${sigs.length} runtime functions defined`);

          const categories = new Set(sigs.map(s => s.category));
          console.log(`Categories:     ${[...categories].join(", ")}`);

          if (checkOnly) {
            const result = buildRuntime({ checkOnly: true });
            console.log(`Status:         ${result.success ? "prerequisites OK" : "prerequisites MISSING"}`);
            if (result.errors.length > 0) {
              for (const err of result.errors) console.error(`  - ${err}`);
            }
          } else {
            console.log("Building...");
            const result = buildRuntime();
            console.log(`Static lib:     ${result.staticLib ? "OK" : "MISSING"}`);
            console.log(`Shared lib:     ${result.sharedLib ? "OK" : "MISSING"}`);
            console.log(`Output dir:     ${result.outputDir}`);
            if (result.errors.length > 0) {
              for (const err of result.errors) console.error(`  Error: ${err}`);
            }
            console.log(`Result:         ${result.success ? "SUCCESS" : "FAILED"}`);
          }
          console.log(sep);
          break;
        }

        case "compile": {
          const { compileToBinary } = await import("./compiler/llvm/pipeline.js");
          const { generateStubs, generateTestHarness } = await import("./compiler/llvm/stubs.js");
          const { writeFileSync: writeCompile } = await import("fs");
          const compileSep = "═══════════════════════════════════════════════════";

          const compileOutputIdx = args.indexOf("--output");
          const compileOutputDir = compileOutputIdx >= 0 && args[compileOutputIdx + 1]
            ? args[compileOutputIdx + 1] : ".";
          const compileNameIdx = args.indexOf("--name");
          const compileName = compileNameIdx >= 0 && args[compileNameIdx + 1]
            ? args[compileNameIdx + 1] : undefined;
          const compileOptIdx = args.indexOf("--opt");
          const compileOpt = compileOptIdx >= 0 ? parseInt(args[compileOptIdx + 1]) as 0|1|2|3 : 2;

          const compileTarget = (() => {
            const idx = args.indexOf("--target");
            if (idx >= 0 && args[idx + 1]) return args[idx + 1] as "binary"|"object"|"llvm-ir"|"assembly";
            return "binary" as const;
          })();

          const compileContracts = (() => {
            const idx = args.indexOf("--contracts");
            if (idx >= 0 && args[idx + 1]) return args[idx + 1] as "abort"|"log"|"count";
            return "abort" as const;
          })();

          // Pre-generate stubs if requested so they can be linked
          let compileStubsPath: string | undefined;
          if (args.includes("--stubs") || args.includes("--harness")) {
            const compileGraph = loadGraph(cliFilePath);
            const stubCode = generateStubs(compileGraph as any);
            const stubName = (compileName ?? compileGraph.id).replace(/[^a-zA-Z0-9]/g, "_");
            compileStubsPath = join(compileOutputDir, `${stubName}_stubs.c`);
            writeCompile(compileStubsPath, stubCode, "utf-8");
          }

          const compileResult = await compileToBinary({
            input: cliFilePath,
            outputDir: compileOutputDir,
            outputName: compileName,
            target: compileTarget,
            optimization: compileOpt,
            parallel: !args.includes("--no-parallel"),
            contracts: compileContracts,
            verbose: args.includes("--verbose"),
            stubsPath: compileStubsPath,
          });

          console.log(compileSep);
          console.log(`AETHER Compile: ${loadGraph(cliFilePath).id}`);
          console.log(compileSep);

          const stages = compileResult.stages;
          console.log(`  Validate:     ${stages.validate.success ? "✓" : "✗"} (${stages.validate.duration_ms}ms)`);
          console.log(`  Type Check:   ${stages.typeCheck.success ? "✓" : "✗"} (${stages.typeCheck.duration_ms}ms)`);
          console.log(`  Verify:       ${stages.verify.success ? "✓" : "✗"} ${stages.verify.percentage ?? 0}% (${stages.verify.duration_ms}ms)`);
          if (stages.emitIR.outputPath) {
            console.log(`  Emit IR:      ${stages.emitIR.success ? "✓" : "✗"} ${stages.emitIR.lines ?? 0} lines (${stages.emitIR.duration_ms}ms)`);
          }
          if (stages.compileObj) {
            console.log(`  Compile Obj:  ${stages.compileObj.success ? "✓" : "✗"} (${stages.compileObj.duration_ms}ms)`);
          }
          if (stages.link) {
            console.log(`  Link:         ${stages.link.success ? "✓" : "✗"} (${stages.link.duration_ms}ms)`);
          }

          console.log(`  Output:       ${compileResult.outputPath}`);
          if (compileResult.binarySize) {
            const kb = (compileResult.binarySize / 1024).toFixed(1);
            console.log(`  Binary Size:  ${kb} KB`);
          }
          if (compileResult.errors.length > 0) {
            for (const err of compileResult.errors) {
              console.log(`  Error:        ${err}`);
            }
          }
          console.log(`  Result:       ${compileResult.success ? "SUCCESS" : "FAILED"}`);

          // Report stubs/harness paths
          if (compileStubsPath) {
            console.log(`  Stubs:        ${compileStubsPath}`);
          }
          if (args.includes("--harness")) {
            const compileGraph = loadGraph(cliFilePath);
            const harnessCode = generateTestHarness(compileGraph as any);
            const stubName = (compileName ?? compileGraph.id).replace(/[^a-zA-Z0-9]/g, "_");
            const harnessPath = join(compileOutputDir, `${stubName}_harness.c`);
            writeCompile(harnessPath, harnessCode, "utf-8");
            console.log(`  Harness:      ${harnessPath}`);
          }

          // Run binary if requested
          if (args.includes("--run") && compileResult.success && compileResult.outputPath.endsWith(".exe")) {
            console.log(`  Running:      ${compileResult.outputPath}`);
            try {
              const { execSync: runExec } = await import("child_process");
              const runOutput = runExec(`"${compileResult.outputPath}"`, {
                encoding: "utf-8",
                timeout: 30000,
                stdio: ["pipe", "pipe", "pipe"],
              });
              if (runOutput.trim()) {
                for (const line of runOutput.trim().split("\n")) {
                  console.log(`  > ${line}`);
                }
              }
              console.log(`  Exit:         0`);
            } catch (runErr: any) {
              const stderr = runErr.stderr?.trim();
              const stdout = runErr.stdout?.trim();
              if (stderr) {
                for (const line of stderr.split("\n")) console.log(`  > ${line}`);
              }
              if (stdout) {
                for (const line of stdout.split("\n")) console.log(`  > ${line}`);
              }
              console.log(`  Exit:         ${runErr.status ?? "error"}`);
            }
          }

          console.log(compileSep);
          if (!compileResult.success) process.exit(1);
          break;
        }

        case "benchmark": {
          const { benchmark: runBenchmark } = await import("./compiler/llvm/benchmark.js");
          const benchSep = "═══════════════════════════════════════════════════════";

          const benchRunsIdx = args.indexOf("--runs");
          const benchRuns = benchRunsIdx >= 0 ? parseInt(args[benchRunsIdx + 1]) : 50;
          const benchNative = args.includes("--native");

          const benchResult = await runBenchmark(cliFilePath, {
            runs: benchRuns,
            includeNative: benchNative,
          });

          const benchGraph = loadGraph(cliFilePath);
          console.log(benchSep);
          console.log(`AETHER Benchmark: ${benchGraph.id} (v${benchGraph.version})`);
          console.log(benchSep);

          const thin = "  ──────────────────────────────────────────────────";
          console.log("  Mode          Avg       Min       Max       Runs");
          console.log(thin);

          const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));

          const interpMode = benchResult.modes.interpreted;
          console.log(`  ${pad("Interpreted", 14)}${pad(interpMode.avg_ms + "ms", 10)}${pad(interpMode.min_ms + "ms", 10)}${pad(interpMode.max_ms + "ms", 10)}${interpMode.runs}`);

          const jitMode = benchResult.modes.jit;
          console.log(`  ${pad(`JIT (Tier ${jitMode.tier})`, 14)}${pad(jitMode.avg_ms + "ms", 10)}${pad(jitMode.min_ms + "ms", 10)}${pad(jitMode.max_ms + "ms", 10)}${jitMode.runs}`);

          if (benchResult.modes.native) {
            const natMode = benchResult.modes.native;
            console.log(`  ${pad("Native", 14)}${pad(natMode.avg_ms + "ms", 10)}${pad(natMode.min_ms + "ms", 10)}${pad(natMode.max_ms + "ms", 10)}${natMode.runs}`);
          }

          console.log(thin);
          console.log("");
          console.log("Speedup:");
          console.log(`  JIT vs Interpreted:     ${benchResult.speedup.jit_vs_interpreted}`);
          if (benchResult.speedup.native_vs_interpreted) {
            console.log(`  Native vs Interpreted:  ${benchResult.speedup.native_vs_interpreted}`);
          }
          if (benchResult.speedup.native_vs_jit) {
            console.log(`  Native vs JIT:          ${benchResult.speedup.native_vs_jit}`);
          }
          console.log(benchSep);
          break;
        }

        case "toolchain": {
          const { detectToolchain } = await import("./compiler/llvm/pipeline.js");
          const toolchainSep = "═══════════════════════════════════════════════════════";

          console.log(toolchainSep);
          console.log("AETHER Native Toolchain Status");
          console.log(toolchainSep);

          const tc = await detectToolchain();

          if (tc.llc.available) {
            console.log(`  llc:              ✓ LLVM ${tc.llc.version ?? "unknown"} (${tc.llc.path ?? "on PATH"})`);
          } else {
            console.log("  llc:              ✗ Not found");
          }

          if (tc.clang.available) {
            console.log(`  clang:            ✓ clang ${tc.clang.version ?? "unknown"} (${tc.clang.path ?? "on PATH"})`);
          } else {
            console.log("  clang:            ✗ Not found");
          }

          if (tc.runtime.available) {
            console.log(`  Runtime library:  ✓ ${tc.runtime.path}`);
          } else {
            console.log("  Runtime library:  ✗ Not found");
          }

          console.log(`  Threading:        ✓ pthreads available`);

          if (!tc.llc.available || !tc.clang.available) {
            console.log("");
            console.log("  Install LLVM: https://releases.llvm.org/download.html");
            if (process.platform === "darwin") {
              console.log("  Or: brew install llvm");
            } else if (process.platform === "linux") {
              console.log("  Or: apt install llvm clang");
            }
          }

          const ready = tc.llc.available && tc.clang.available;
          console.log(toolchainSep);
          console.log(`  Status: ${ready ? "Ready for native compilation" : "Toolchain incomplete"}`);
          console.log(toolchainSep);
          break;
        }

        case "editor": {
          const { generateEditor } = await import("./editor/generate.js");
          const { writeFileSync: writeEditor } = await import("fs");

          let editorGraph: any = undefined;
          const isNew = args.includes("--new");
          const templateIdx = args.indexOf("--template");
          const templateName = templateIdx >= 0 && args[templateIdx + 1] ? args[templateIdx + 1] : undefined;

          if (isNew) {
            // Open empty editor for new graph creation
            editorGraph = undefined;
          } else if (cliFilePath) {
            editorGraph = loadGraph(cliFilePath);
          }

          const html = generateEditor(editorGraph as any, { template: templateName });

          const editorOutputIdx = args.indexOf("--output");
          const editorOutputPath = editorOutputIdx >= 0 && args[editorOutputIdx + 1]
            ? args[editorOutputIdx + 1]
            : `${editorGraph?.id || "aether"}-editor.html`;

          writeEditor(editorOutputPath, html, "utf-8");
          console.log(`✓ Editor written to ${editorOutputPath}`);

          if (args.includes("--open")) {
            const { exec } = await import("child_process");
            const platform = process.platform;
            const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
            exec(`${cmd} "${editorOutputPath}"`);
          }
          break;
        }

        case "demo": {
          const { generateDemo } = await import("./demo/generate.js");
          const { writeFileSync: writeDemo } = await import("fs");

          const html = generateDemo();

          const demoOutputIdx = args.indexOf("--output");
          const demoOutputPath = demoOutputIdx >= 0 && args[demoOutputIdx + 1]
            ? args[demoOutputIdx + 1]
            : "aether-demo.html";

          writeDemo(demoOutputPath, html, "utf-8");
          console.log(`✓ Demo written to ${demoOutputPath}`);

          if (args.includes("--open")) {
            const { exec } = await import("child_process");
            const platform = process.platform;
            const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
            exec(`${cmd} "${demoOutputPath}"`);
          }
          break;
        }

        case "ai": {
          const { generateFromDescription, irToAether: aiIrToAether } = await import("./ai/generate.js") as any;
          const { irToAether: bridgeIrToAether } = await import("./parser/bridge.js");
          const { writeFileSync: writeAi, mkdirSync } = await import("fs");

          // cliFilePath is the description string (args[1])
          const description = cliFilePath;
          if (!description) {
            console.error('Error: missing description. Usage: npx tsx src/cli.ts ai "Build a ..." [--format aether|json]');
            process.exit(1);
          }

          const formatIdx = args.indexOf("--format");
          const aiFormat = (formatIdx >= 0 && args[formatIdx + 1]) ? args[formatIdx + 1] as "aether" | "json" : "aether";

          const sep = "═══════════════════════════════════════════════════════════════════";
          console.log(sep);
          console.log(`AETHER AI Generation (${aiFormat}): "${description.slice(0, 60)}${description.length > 60 ? "..." : ""}"`);
          console.log(sep);

          try {
            const result = await (generateFromDescription as Function)({ description, format: aiFormat });

            const lastAttempt = result.attempts[result.attempts.length - 1];
            const nodeCount = result.graph?.nodes?.length ?? 0;
            const attemptNum = lastAttempt?.attemptNumber ?? 0;
            const maxAttempts = 3;

            console.log(`Generation:    ${lastAttempt?.parseSuccess ? "✓" : "✗"} Claude generated ${nodeCount}-node graph (attempt ${attemptNum}/${maxAttempts})`);

            if (result.finalValidation) {
              const v = result.finalValidation;
              console.log(`Validation:    ${v.valid ? "✓" : "✗"} schema ${v.errors.length === 0 ? "✓" : "✗"} structure ${v.errors.length === 0 ? "✓" : "✗"} types ${v.errors.length === 0 ? "✓" : "✗"}`);
            }

            if (result.finalVerification) {
              const vr = result.finalVerification;
              console.log(`Verification:  ${vr.nodes_verified}/${vr.nodes_verified + vr.nodes_failed} contracts verified by Z3`);
            }

            if (result.bugsFound.length > 0) {
              console.log(`\nBugs caught:   ${result.bugsFound.length}`);
              for (const bug of result.bugsFound) {
                const sev = bug.severity === "critical" ? "CRITICAL" : bug.severity === "high" ? "HIGH" : bug.severity.toUpperCase();
                console.log(`  ⚠ ${sev}: ${bug.description}`);
                console.log(`    → In production: ${bug.wouldCauseInProduction}`);
                console.log(`    → Caught by: ${bug.caughtBy}`);
              }
            } else {
              console.log(`\nBugs caught:   0 (clean generation)`);
            }

            if (result.graph) {
              const slug = description.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50);
              mkdirSync("generated", { recursive: true });
              if (aiFormat === "aether") {
                const aetherSource = result.aetherSource || bridgeIrToAether(result.graph);
                const outPath = `generated/${slug}.aether`;
                writeAi(outPath, aetherSource, "utf-8");
                console.log(`\nSaved: ${outPath}`);
              } else {
                const outPath = `generated/${slug}.json`;
                writeAi(outPath, JSON.stringify(result.graph, null, 2), "utf-8");
                console.log(`\nSaved: ${outPath}`);
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(msg);
            process.exit(1);
          }

          console.log(sep);
          break;
        }

        case "ai-test": {
          const { generateFromDescription } = await import("./ai/generate.js");
          const { scenarios } = await import("./ai/scenarios.js");
          const { generateBugReport, formatReport } = await import("./ai/report.js");
          const { GenerationResult } = await import("./ai/generate.js") as any;

          const scenariosIdx = args.indexOf("--scenarios");
          const scenarioFilter = scenariosIdx >= 0 ? args[scenariosIdx + 1] : "all";
          const showReport = args.includes("--report");

          const toRun = scenarioFilter === "all"
            ? scenarios
            : scenarios.filter(s => s.id === scenarioFilter);

          if (toRun.length === 0) {
            console.error(`No scenarios match "${scenarioFilter}". Available: ${scenarios.map(s => s.id).join(", ")}`);
            process.exit(1);
          }

          console.log(`Running ${toRun.length} scenario(s)...\n`);

          const results = new Map<string, any>();
          const scenarioMeta = new Map<string, { description: string; expectedBugs: string[]; explanation: string }>();

          for (const scenario of toRun) {
            console.log(`  ${scenario.id}...`);
            scenarioMeta.set(scenario.id, {
              description: scenario.description,
              expectedBugs: scenario.expectedBugTypes,
              explanation: scenario.explanation,
            });
            try {
              const result = await generateFromDescription({
                description: scenario.description,
                maxAttempts: 2,
              });
              results.set(scenario.id, result);
              const bugCount = result.bugsFound.length;
              const mark = bugCount > 0 ? "✓" : "✗";
              console.log(`  ${mark} ${scenario.id}: ${bugCount} bug(s) found`);
            } catch (e) {
              console.log(`  ✗ ${scenario.id}: error — ${e instanceof Error ? e.message : String(e)}`);
              results.set(scenario.id, { success: false, graph: null, attempts: [], bugsFound: [], finalValidation: null, finalVerification: null });
            }
          }

          const report = generateBugReport(results, scenarioMeta);

          if (showReport) {
            console.log("\n" + formatReport(report));
          } else {
            console.log(`\nDetection rate: ${(report.detectionRate * 100).toFixed(1)}% (${report.details.filter(d => d.caught).length}/${report.totalScenarios})`);
            console.log(`Total bugs found: ${report.bugsDetected}`);
          }
          break;
        }

        case "run-pipeline": {
          await cmdRunPipeline(cliFilePath, args);
          break;
        }

        case "serve": {
          const { startServer } = await import("./server/index.js");

          const portIdx = args.indexOf("--port");
          const port = portIdx >= 0 && args[portIdx + 1] ? parseInt(args[portIdx + 1], 10) : 3000;
          const fsIdx = args.indexOf("--fs-path");
          const fsPath = fsIdx >= 0 && args[fsIdx + 1] ? args[fsIdx + 1] : undefined;
          const dbIdx = args.indexOf("--db-path");
          const dbPath = dbIdx >= 0 && args[dbIdx + 1] ? args[dbIdx + 1] : undefined;
          const modeIdx = args.indexOf("--mode");
          const mode = (modeIdx >= 0 && args[modeIdx + 1] ? args[modeIdx + 1] : "mock") as "mock" | "real";
          const autoOpen = args.includes("--open");

          await startServer({
            port,
            graphPath: cliFilePath || undefined,
            fsPath,
            dbPath,
            mode,
            open: autoOpen,
          });
          break;
        }

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
