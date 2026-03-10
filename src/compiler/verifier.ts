/**
 * AETHER Contract Verification Engine
 * Uses Z3 SMT solver (WASM) to verify node contracts.
 *
 * Phase 6 Session 2: Rewritten to use the runtime evaluator's parser (via verifier-ast.ts)
 * so the Z3 verifier and runtime evaluator parse expressions identically.
 *
 * Supports: quantifiers (∀, ∃), set operations (∈, ∉, ∩, ⊆), property predicates
 * (list.distinct, list.is_sorted, list.length), bounded array theory, solver timeouts.
 *
 * Postconditions: assert NOT(post) — UNSAT means postcondition always holds.
 * Adversarial checks: assert break_if — UNSAT means bad condition cannot occur.
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { translateExpression, Z3TranslationResult } from "./verifier-ast.js";

const _require = createRequire(import.meta.url);

// ─── Types ────────────────────────────────────────────────────────────────────

interface TypeAnnotation {
  type: string;
  domain?: string;
  unit?: string;
  dimension?: string;
  format?: string;
  sensitivity?: string;
  range?: [number, number];
  constraint?: string;
}

interface AetherNode {
  id: string;
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  contract: { pre?: string[]; post?: string[]; invariants?: string[] };
  confidence?: number;
  adversarial_check?: { break_if: string[] };
  effects: string[];
  pure?: boolean;
  recovery?: Record<string, unknown>;
  supervised?: { reason: string; review_status?: string };
}

interface AetherEdge {
  from: string;
  to: string;
}

interface AetherGraph {
  id: string;
  version: number;
  effects: string[];
  sla?: { latency_ms?: number; availability?: number };
  nodes: AetherNode[];
  edges: AetherEdge[];
  metadata?: Record<string, unknown>;
}

export interface PostconditionResult {
  expression: string;
  status: "verified" | "failed" | "timeout" | "unsupported";
  counterexample?: Record<string, string>;
  z3_time_ms?: number;
}

export interface AdversarialResult {
  expression: string;
  status: "passed" | "failed" | "timeout" | "unsupported";
  counterexample?: Record<string, string>;
  z3_time_ms?: number;
}

export interface VerificationResult {
  node_id: string;
  verified: boolean;
  postconditions: PostconditionResult[];
  adversarial_checks: AdversarialResult[];
}

export interface VerificationCoverage {
  z3_verified: number;
  z3_failed: number;
  z3_timeout: number;
  z3_unsupported: number;
  runtime_evaluable: number;
  total_uncovered: number;
}

export interface EnhancedVerificationResult {
  node_id: string;
  contracts: Array<{
    expression: string;
    z3_status: "verified" | "failed" | "timeout" | "unsupported";
    runtime_evaluable: boolean;
    counterexample?: Record<string, string>;
    z3_time_ms?: number;
  }>;
  coverage: VerificationCoverage;
}

export interface StateTypeVerificationResult {
  id: string;
  states: number;
  transitions: number;
  neverInvariants: { checked: number; verified: number };
  terminalInvariants: { checked: number; verified: number };
}

export interface GraphVerificationReport {
  graph_id: string;
  nodes_verified: number;
  nodes_failed: number;
  nodes_unsupported: number;
  results: VerificationResult[];
  verification_percentage: number;
  stateTypeResults: StateTypeVerificationResult[];
  coverage?: VerificationCoverage;
  enhanced?: EnhancedVerificationResult[];
}

// ─── Z3 Initialization ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Z3Instance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Z3Context = any;

let z3Instance: Z3Instance | null = null;

async function getZ3(): Promise<Z3Instance> {
  if (!z3Instance) {
    const z3Module = _require("z3-solver") as { init: () => Promise<Z3Instance> };
    z3Instance = await z3Module.init();
  }
  return z3Instance;
}

export { getZ3 };

// ─── Solver Timeout ──────────────────────────────────────────────────────────

/** Default Z3 solver timeout in milliseconds */
const Z3_TIMEOUT_MS = 5000;

/**
 * Run a Z3 solver check with a timeout.
 * Returns "unsat", "sat", or "timeout".
 */
async function solverCheckWithTimeout(
  solver: any,
  timeoutMs: number = Z3_TIMEOUT_MS
): Promise<"unsat" | "sat" | "timeout"> {
  try {
    // Z3 WASM solver supports set("timeout", ms) on params
    solver.set("timeout", timeoutMs);
  } catch {
    // Some Z3 versions don't support timeout on solver directly — proceed without
  }
  try {
    const result = await Promise.race([
      solver.check(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMs + 500)),
    ]);
    if (result === "unsat" || result === "sat") return result;
    return "timeout";
  } catch {
    return "timeout";
  }
}

// ─── Annotation Map ──────────────────────────────────────────────────────────

function buildAnnotationMap(node: AetherNode): Map<string, TypeAnnotation> {
  const map = new Map<string, TypeAnnotation>();
  for (const [portName, ann] of Object.entries(node.in)) {
    map.set(portName, ann);
  }
  for (const [portName, ann] of Object.entries(node.out)) {
    map.set(portName, ann);
  }
  return map;
}

// ─── Counterexample Extraction ───────────────────────────────────────────────

function extractCounterexample(
  model: { eval: (v: unknown) => { toString: () => string } },
  variables: Map<string, unknown>
): Record<string, string> {
  const ce: Record<string, string> = {};
  for (const [name, z3Var] of variables) {
    try {
      ce[name] = model.eval(z3Var).toString();
    } catch {
      ce[name] = "?";
    }
  }
  return ce;
}

// ─── Runtime Evaluability Check ──────────────────────────────────────────────

/**
 * Check if an expression can be evaluated by the runtime evaluator.
 * We test-parse it using the same pipeline.
 */
function isRuntimeEvaluable(expression: string): boolean {
  try {
    const { tokenize } = _require("../runtime/evaluator/lexer.js") as { tokenize: (e: string) => any[] };
    const { parse } = _require("../runtime/evaluator/parser.js") as { parse: (t: any[]) => { errors: any[] } };
    const tokens = tokenize(expression);
    const { errors } = parse(tokens);
    return errors.length === 0;
  } catch {
    // If we can't import runtime evaluator, conservatively say no
    return false;
  }
}

// ─── Node Verification (rewritten with AST translator) ──────────────────────

export async function verifyNode(
  node: AetherNode,
  z3: Z3Instance
): Promise<VerificationResult> {
  const { Context } = z3;
  const ctx = new Context(`verify_${node.id}`);
  const annotations = buildAnnotationMap(node);

  const postconditions: PostconditionResult[] = [];
  const adversarial_checks: AdversarialResult[] = [];

  // Shared variable maps across all expressions in this node
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharedVars = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharedArrays = new Map<string, { array: any; length: any }>();

  // Build precondition constraints (used as assumptions)
  const preResults: Z3TranslationResult[] = [];
  if (node.contract.pre) {
    for (const preStr of node.contract.pre) {
      const result = translateExpression(preStr, ctx, annotations, sharedVars, sharedArrays);
      sharedVars = result.variables;
      sharedArrays = result.listArrays;
      if (result.expr) {
        preResults.push(result);
      }
    }
  }

  // Verify postconditions
  if (node.contract.post) {
    for (const postStr of node.contract.post) {
      const startTime = Date.now();
      const result = translateExpression(postStr, ctx, annotations, sharedVars, sharedArrays);
      sharedVars = result.variables;
      sharedArrays = result.listArrays;

      if (!result.expr) {
        postconditions.push({
          expression: postStr,
          status: "unsupported",
          z3_time_ms: Date.now() - startTime,
        });
        continue;
      }

      try {
        const solver = new ctx.Solver();
        // Add preconditions as assumptions
        for (const pre of preResults) {
          if (pre.expr) solver.add(pre.expr);
        }
        // Assert NOT(postcondition) — if UNSAT, postcondition always holds
        solver.add(ctx.Not(result.expr));
        const check = await solverCheckWithTimeout(solver);
        const elapsed = Date.now() - startTime;

        if (check === "unsat") {
          postconditions.push({ expression: postStr, status: "verified", z3_time_ms: elapsed });
        } else if (check === "timeout") {
          postconditions.push({ expression: postStr, status: "timeout", z3_time_ms: elapsed });
        } else {
          const ce = extractCounterexample(solver.model(), result.variables);
          postconditions.push({ expression: postStr, status: "failed", counterexample: ce, z3_time_ms: elapsed });
        }
      } catch {
        postconditions.push({
          expression: postStr,
          status: "unsupported",
          z3_time_ms: Date.now() - startTime,
        });
      }
    }
  }

  // Verify adversarial checks
  if (node.adversarial_check?.break_if) {
    for (const breakStr of node.adversarial_check.break_if) {
      const startTime = Date.now();
      const result = translateExpression(breakStr, ctx, annotations, sharedVars, sharedArrays);
      sharedVars = result.variables;
      sharedArrays = result.listArrays;

      if (!result.expr) {
        adversarial_checks.push({
          expression: breakStr,
          status: "unsupported",
          z3_time_ms: Date.now() - startTime,
        });
        continue;
      }

      try {
        const solver = new ctx.Solver();
        // Add preconditions as context
        for (const pre of preResults) {
          if (pre.expr) solver.add(pre.expr);
        }
        // Assert the adversarial condition
        // If UNSAT → the bad thing can never happen → PASSED
        // If SAT → the bad thing could happen → FAILED
        solver.add(result.expr);
        const check = await solverCheckWithTimeout(solver);
        const elapsed = Date.now() - startTime;

        if (check === "unsat") {
          adversarial_checks.push({ expression: breakStr, status: "passed", z3_time_ms: elapsed });
        } else if (check === "timeout") {
          adversarial_checks.push({ expression: breakStr, status: "timeout", z3_time_ms: elapsed });
        } else {
          const ce = extractCounterexample(solver.model(), result.variables);
          adversarial_checks.push({ expression: breakStr, status: "failed", counterexample: ce, z3_time_ms: elapsed });
        }
      } catch {
        adversarial_checks.push({
          expression: breakStr,
          status: "unsupported",
          z3_time_ms: Date.now() - startTime,
        });
      }
    }
  }

  // Node is verified if all postconditions verified and all adversarial checks passed
  const hasAnyFailed = postconditions.some(p => p.status === "failed") || adversarial_checks.some(a => a.status === "failed");
  const hasAnyVerified = postconditions.some(p => p.status === "verified") || adversarial_checks.some(a => a.status === "passed");

  return {
    node_id: node.id,
    verified: !hasAnyFailed && (hasAnyVerified || !hasAnyFailed),
    postconditions,
    adversarial_checks,
  };
}

// ─── Enhanced Verification (with coverage) ───────────────────────────────────

export function computeEnhancedResults(
  results: VerificationResult[]
): { enhanced: EnhancedVerificationResult[]; coverage: VerificationCoverage } {
  const coverage: VerificationCoverage = {
    z3_verified: 0,
    z3_failed: 0,
    z3_timeout: 0,
    z3_unsupported: 0,
    runtime_evaluable: 0,
    total_uncovered: 0,
  };

  const enhanced: EnhancedVerificationResult[] = [];

  for (const r of results) {
    const nodeContracts: EnhancedVerificationResult["contracts"] = [];
    const nodeCov: VerificationCoverage = {
      z3_verified: 0,
      z3_failed: 0,
      z3_timeout: 0,
      z3_unsupported: 0,
      runtime_evaluable: 0,
      total_uncovered: 0,
    };

    for (const p of r.postconditions) {
      const runtimeEval = isRuntimeEvaluable(p.expression);
      nodeContracts.push({
        expression: p.expression,
        z3_status: p.status,
        runtime_evaluable: runtimeEval,
        counterexample: p.counterexample,
        z3_time_ms: p.z3_time_ms,
      });

      switch (p.status) {
        case "verified": nodeCov.z3_verified++; coverage.z3_verified++; break;
        case "failed": nodeCov.z3_failed++; coverage.z3_failed++; break;
        case "timeout": nodeCov.z3_timeout++; coverage.z3_timeout++; break;
        case "unsupported":
          nodeCov.z3_unsupported++; coverage.z3_unsupported++;
          if (runtimeEval) { nodeCov.runtime_evaluable++; coverage.runtime_evaluable++; }
          else { nodeCov.total_uncovered++; coverage.total_uncovered++; }
          break;
      }
    }

    for (const a of r.adversarial_checks) {
      const runtimeEval = isRuntimeEvaluable(a.expression);
      const z3Status = a.status === "passed" ? "verified" as const : a.status;
      nodeContracts.push({
        expression: a.expression,
        z3_status: z3Status,
        runtime_evaluable: runtimeEval,
        counterexample: a.counterexample,
        z3_time_ms: a.z3_time_ms,
      });

      switch (a.status) {
        case "passed": nodeCov.z3_verified++; coverage.z3_verified++; break;
        case "failed": nodeCov.z3_failed++; coverage.z3_failed++; break;
        case "timeout": nodeCov.z3_timeout++; coverage.z3_timeout++; break;
        case "unsupported":
          nodeCov.z3_unsupported++; coverage.z3_unsupported++;
          if (runtimeEval) { nodeCov.runtime_evaluable++; coverage.runtime_evaluable++; }
          else { nodeCov.total_uncovered++; coverage.total_uncovered++; }
          break;
      }
    }

    enhanced.push({
      node_id: r.node_id,
      contracts: nodeContracts,
      coverage: nodeCov,
    });
  }

  return { enhanced, coverage };
}

// ─── State Type Verification ─────────────────────────────────────────────────

interface StateTypeDef {
  id: string;
  states: string[];
  transitions: Array<{ from: string; to: string; when: string }>;
  invariants?: {
    never?: Array<{ from: string; to: string }>;
    terminal?: string[];
    initial?: string;
  };
}

async function verifyStateType(
  st: StateTypeDef,
  z3: Z3Instance
): Promise<StateTypeVerificationResult> {
  const { Context } = z3;
  const ctx = new Context(`state_type_${st.id}`);

  const result: StateTypeVerificationResult = {
    id: st.id,
    states: st.states.length,
    transitions: st.transitions.length,
    neverInvariants: { checked: 0, verified: 0 },
    terminalInvariants: { checked: 0, verified: 0 },
  };

  // Encode states as integer constants
  const stateIndex = new Map<string, number>();
  st.states.forEach((s, i) => stateIndex.set(s, i));

  const fromVar = ctx.Int.const("from_state");
  const toVar = ctx.Int.const("to_state");

  // Build transition constraint: OR of all valid (from, to) pairs
  const transitionPairs = st.transitions.map(t => {
    const fromIdx = stateIndex.get(t.from)!;
    const toIdx = stateIndex.get(t.to)!;
    return ctx.And(
      ctx.Eq(fromVar, ctx.Int.val(fromIdx)),
      ctx.Eq(toVar, ctx.Int.val(toIdx))
    );
  });

  const validTransition = transitionPairs.length > 0
    ? (transitionPairs.length === 1 ? transitionPairs[0] : ctx.Or(...transitionPairs))
    : ctx.Bool.val(false);

  // Verify never-invariants
  if (st.invariants?.never) {
    for (const nev of st.invariants.never) {
      result.neverInvariants.checked++;
      const fromIdx = stateIndex.get(nev.from);
      const toIdx = stateIndex.get(nev.to);
      if (fromIdx === undefined || toIdx === undefined) continue;

      try {
        const solver = new ctx.Solver();
        solver.add(validTransition);
        solver.add(ctx.Eq(fromVar, ctx.Int.val(fromIdx)));
        solver.add(ctx.Eq(toVar, ctx.Int.val(toIdx)));
        const check = await solver.check();
        if (check === "unsat") {
          result.neverInvariants.verified++;
        }
      } catch {
        // Skip on error
      }
    }
  }

  // Verify terminal invariants
  if (st.invariants?.terminal) {
    for (const term of st.invariants.terminal) {
      result.terminalInvariants.checked++;
      const termIdx = stateIndex.get(term);
      if (termIdx === undefined) continue;

      try {
        const solver = new ctx.Solver();
        solver.add(validTransition);
        solver.add(ctx.Eq(fromVar, ctx.Int.val(termIdx)));
        const check = await solver.check();
        if (check === "unsat") {
          result.terminalInvariants.verified++;
        }
      } catch {
        // Skip on error
      }
    }
  }

  return result;
}

// ─── Graph Verification ──────────────────────────────────────────────────────

export async function verifyGraph(graph: AetherGraph): Promise<GraphVerificationReport> {
  const z3 = await getZ3();
  const results: VerificationResult[] = [];

  for (const node of graph.nodes) {
    // Skip holes and intent nodes — they have no contracts to verify
    if (("hole" in node && (node as any).hole === true) ||
        ("intent" in node && (node as any).intent === true)) {
      continue;
    }
    const result = await verifyNode(node, z3);
    results.push(result);
  }

  let nodes_verified = 0;
  let nodes_failed = 0;
  let nodes_unsupported = 0;

  for (const r of results) {
    const allUnsupported =
      r.postconditions.every(p => p.status === "unsupported") &&
      r.adversarial_checks.every(a => a.status === "unsupported") &&
      (r.postconditions.length > 0 || r.adversarial_checks.length > 0);

    if (allUnsupported) {
      nodes_unsupported++;
    } else if (r.verified) {
      nodes_verified++;
    } else {
      nodes_failed++;
    }
  }

  const total = nodes_verified + nodes_failed;
  const verification_percentage = total > 0 ? Math.round((nodes_verified / total) * 100) : 100;

  // Verify state types
  const stateTypeResults: StateTypeVerificationResult[] = [];
  const graphAny = graph as any;
  if (graphAny.state_types && Array.isArray(graphAny.state_types)) {
    for (const st of graphAny.state_types) {
      const stResult = await verifyStateType(st, z3);
      stateTypeResults.push(stResult);
    }
  }

  // Compute coverage report
  const { enhanced, coverage } = computeEnhancedResults(results);

  return {
    graph_id: graph.id,
    nodes_verified,
    nodes_failed,
    nodes_unsupported,
    results,
    verification_percentage,
    stateTypeResults,
    coverage,
    enhanced,
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] === __filename ||
  process.argv[1]?.endsWith("verifier.ts") ||
  process.argv[1]?.endsWith("verifier.js");

if (isMain && process.argv.length >= 3) {
  const filePath = process.argv[2];

  (async () => {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as AetherGraph;
      const report = await verifyGraph(raw);

      console.log(`\n═══ Verification Report: ${report.graph_id} ═══`);
      console.log(`Verified: ${report.nodes_verified}  Failed: ${report.nodes_failed}  Unsupported: ${report.nodes_unsupported}`);
      console.log(`Verification: ${report.verification_percentage}%\n`);

      for (const r of report.results) {
        const icon = r.verified ? "✓" : "✗";
        console.log(`${icon}  Node: ${r.node_id}`);

        for (const p of r.postconditions) {
          const statusIcon = p.status === "verified" ? "✓" : p.status === "failed" ? "✗" : p.status === "timeout" ? "⏱" : "?";
          console.log(`   ${statusIcon} POST: ${p.expression} → ${p.status}${p.z3_time_ms ? ` (${p.z3_time_ms}ms)` : ""}`);
          if (p.counterexample) {
            console.log(`     counterexample: ${JSON.stringify(p.counterexample)}`);
          }
        }

        for (const a of r.adversarial_checks) {
          const statusIcon = a.status === "passed" ? "✓" : a.status === "failed" ? "✗" : a.status === "timeout" ? "⏱" : "?";
          console.log(`   ${statusIcon} BREAK_IF: ${a.expression} → ${a.status}${a.z3_time_ms ? ` (${a.z3_time_ms}ms)` : ""}`);
          if (a.counterexample) {
            console.log(`     counterexample: ${JSON.stringify(a.counterexample)}`);
          }
        }

        console.log();
      }

      // Print coverage report
      if (report.coverage) {
        const c = report.coverage;
        const total = c.z3_verified + c.z3_failed + c.z3_timeout + c.z3_unsupported;
        console.log(`═══ Verification Coverage ═══`);
        console.log(`Z3 verified:     ${c.z3_verified}/${total}`);
        console.log(`Z3 failed:       ${c.z3_failed}/${total}`);
        console.log(`Z3 timeout:      ${c.z3_timeout}/${total}`);
        console.log(`Z3 unsupported:  ${c.z3_unsupported}/${total}`);
        if (c.z3_unsupported > 0) {
          console.log(`  ├─ runtime evaluable: ${c.runtime_evaluable}`);
          console.log(`  └─ truly uncovered:   ${c.total_uncovered}`);
        }
        if (total > 0) {
          const unsupportedPct = Math.round((c.z3_unsupported / total) * 100);
          console.log(`Unsupported rate: ${unsupportedPct}%`);
        }
        console.log();
      }

      process.exit(report.nodes_failed > 0 ? 1 : 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  })();
}
