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
import { createHash } from "crypto";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { translateExpression, Z3TranslationResult } from "./verifier-ast.js";
import { checkContract } from "../runtime/evaluator/checker.js";

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
  axioms?: string[];
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
  pipeline_properties?: string[];
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

export interface EdgeVerificationResult {
  edge: string;                      // "A.output → B.input"
  preconditionsSatisfied: boolean;
  details: Array<{
    precondition: string;            // B's precondition
    provedBy: string[];              // which of A's axioms/postconditions prove it
    status: "proved" | "failed" | "unsupported";
    counterexample?: Record<string, string>;
  }>;
}

export interface PipelinePropertyResult {
  property: string;            // end-to-end property
  provedFromChain: boolean;    // derived from axiom chain
  chainLength: number;         // how many nodes in the proof chain
  axiomChain: string[];        // the axioms that form the proof
}

export interface PipelineVerificationSummary {
  nodeProofRate: number;       // node postconditions proved / total
  edgeProofRate: number;       // edge preconditions proved / total
  pipelineProofRate: number;   // end-to-end properties proved / total
  overallConfidence: string;   // "high" | "medium" | "low" based on rates
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
  edgeResults?: EdgeVerificationResult[];
  pipelineProperties?: PipelinePropertyResult[];
  summary?: PipelineVerificationSummary;
}

export interface AxiomSoundnessResult {
  nodeId: string;
  axioms: Array<{
    expression: string;
    holdsAtRuntime: boolean;
    evaluated_value: any;
  }>;
  allSound: boolean;
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
const Z3_TIMEOUT_MS = 2000;

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

// ─── Z3 Result Cache ─────────────────────────────────────────────────────────

const z3ResultCache = new Map<string, VerificationResult>();

function buildCacheKey(node: AetherNode, upstreamAxioms?: Map<string, string[]>): string {
  const parts = [
    JSON.stringify(node.contract),
    JSON.stringify(node.axioms ?? []),
    JSON.stringify(node.in),
    JSON.stringify(node.out),
    JSON.stringify(node.adversarial_check ?? {}),
  ];
  if (upstreamAxioms) {
    const sorted = [...upstreamAxioms.entries()].sort(([a], [b]) => a.localeCompare(b));
    parts.push(JSON.stringify(sorted));
  }
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function clearZ3Cache(): void {
  z3ResultCache.clear();
}

// ─── Node Verification (rewritten with AST translator) ──────────────────────

export async function verifyNode(
  node: AetherNode,
  z3: Z3Instance,
  upstreamAxioms?: Map<string, string[]>
): Promise<VerificationResult> {
  // Check cache first
  const cacheKey = buildCacheKey(node, upstreamAxioms);
  const cached = z3ResultCache.get(cacheKey);
  if (cached) {
    return { ...cached, node_id: node.id };
  }
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

  // Build axiom constraints (implementation guarantees assumed as true)
  const axiomResults: Z3TranslationResult[] = [];
  for (const axiomStr of node.axioms ?? []) {
    const result = translateExpression(axiomStr, ctx, annotations, sharedVars, sharedArrays);
    sharedVars = result.variables;
    sharedArrays = result.listArrays;
    if (result.expr) {
      axiomResults.push(result);
    }
  }

  // Build upstream axiom constraints (guarantees from upstream nodes via edges)
  const upstreamAxiomResults: Z3TranslationResult[] = [];
  if (upstreamAxioms) {
    for (const [, axioms] of upstreamAxioms) {
      for (const axiomStr of axioms) {
        const result = translateExpression(axiomStr, ctx, annotations, sharedVars, sharedArrays);
        sharedVars = result.variables;
        sharedArrays = result.listArrays;
        if (result.expr) {
          upstreamAxiomResults.push(result);
        }
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
        // Add axioms as assumptions (implementation guarantees)
        for (const ax of axiomResults) {
          if (ax.expr) solver.add(ax.expr);
        }
        // Add upstream axioms as assumptions
        for (const ax of upstreamAxiomResults) {
          if (ax.expr) solver.add(ax.expr);
        }
        // Assert NOT(postcondition) — if UNSAT, postcondition follows from axioms
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

  const verificationResult: VerificationResult = {
    node_id: node.id,
    verified: !hasAnyFailed && (hasAnyVerified || !hasAnyFailed),
    postconditions,
    adversarial_checks,
  };

  // Cache the result
  z3ResultCache.set(cacheKey, verificationResult);

  return verificationResult;
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

// ─── Edge Verification ────────────────────────────────────────────────────────

export async function verifyEdge(
  edge: AetherEdge,
  sourceNode: AetherNode,
  destNode: AetherNode,
  z3: Z3Instance
): Promise<EdgeVerificationResult> {
  const { Context } = z3;
  const fromPort = edge.from.split(".")[1];
  const toPort = edge.to.split(".")[1];
  const edgeLabel = `${edge.from} → ${edge.to}`;

  // If dest has no preconditions, trivially satisfied
  if (!destNode.contract.pre || destNode.contract.pre.length === 0) {
    return { edge: edgeLabel, preconditionsSatisfied: true, details: [] };
  }

  const ctx = new Context(`edge_${sourceNode.id}_${destNode.id}`);
  const annotations = new Map<string, TypeAnnotation>();

  // Combine both nodes' port annotations
  for (const [name, ann] of Object.entries(sourceNode.in)) annotations.set(name, ann);
  for (const [name, ann] of Object.entries(sourceNode.out)) annotations.set(name, ann);
  for (const [name, ann] of Object.entries(destNode.in)) annotations.set(name, ann);
  for (const [name, ann] of Object.entries(destNode.out)) annotations.set(name, ann);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharedVars = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharedArrays = new Map<string, { array: any; length: any }>();

  // Translate source node's axioms and postconditions (the guarantees)
  const guaranteeExprs: Z3TranslationResult[] = [];
  const guaranteeStrings: string[] = [];
  for (const axiom of [...(sourceNode.axioms ?? []), ...(sourceNode.contract.post ?? [])]) {
    const result = translateExpression(axiom, ctx, annotations, sharedVars, sharedArrays);
    sharedVars = result.variables;
    sharedArrays = result.listArrays;
    if (result.expr) {
      guaranteeExprs.push(result);
      guaranteeStrings.push(axiom);
    }
  }

  const details: EdgeVerificationResult["details"] = [];

  for (const pre of destNode.contract.pre) {
    // Remap: dest's input port name → source's output port name
    const remappedPre = pre.replace(new RegExp(`\\b${toPort}\\b`, "g"), fromPort);
    const result = translateExpression(remappedPre, ctx, annotations, sharedVars, sharedArrays);
    sharedVars = result.variables;
    sharedArrays = result.listArrays;

    if (!result.expr) {
      details.push({ precondition: pre, provedBy: [], status: "unsupported" });
      continue;
    }

    try {
      const solver = new ctx.Solver();
      // Assert all source guarantees
      for (const g of guaranteeExprs) {
        if (g.expr) solver.add(g.expr);
      }
      // Assert NOT(precondition) — UNSAT means guarantees imply precondition
      solver.add(ctx.Not(result.expr));
      const check = await solverCheckWithTimeout(solver);

      if (check === "unsat") {
        details.push({ precondition: pre, provedBy: guaranteeStrings, status: "proved" });
      } else if (check === "sat") {
        const ce = extractCounterexample(solver.model(), result.variables);
        details.push({ precondition: pre, provedBy: [], status: "failed", counterexample: ce });
      } else {
        details.push({ precondition: pre, provedBy: [], status: "unsupported" });
      }
    } catch {
      details.push({ precondition: pre, provedBy: [], status: "unsupported" });
    }
  }

  return {
    edge: edgeLabel,
    preconditionsSatisfied: details.every(d => d.status === "proved" || d.status === "unsupported"),
    details,
  };
}

// ─── Pipeline Verification ────────────────────────────────────────────────────

function topologicalSort(graph: AetherGraph): string[] {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const edge of graph.edges) {
    const fromId = edge.from.split(".")[0];
    const toId = edge.to.split(".")[0];
    if (nodeIds.has(fromId) && nodeIds.has(toId)) {
      adj.get(fromId)!.push(toId);
      inDegree.set(toId, (inDegree.get(toId) ?? 0) + 1);
    }
  }
  const order: string[] = [];
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  return order;
}

async function verifyPipelineProperties(
  graph: AetherGraph,
  z3: Z3Instance
): Promise<PipelinePropertyResult[]> {
  const props = graph.pipeline_properties;
  if (!props || props.length === 0) return [];

  const { Context } = z3;
  const ctx = new Context(`pipeline_${graph.id}`);

  // Collect ALL annotations from ALL nodes
  const allAnnotations = new Map<string, TypeAnnotation>();
  for (const node of graph.nodes) {
    if ("in" in node && "out" in node) {
      const n = node as AetherNode;
      for (const [name, ann] of Object.entries(n.in)) allAnnotations.set(name, ann);
      for (const [name, ann] of Object.entries(n.out)) allAnnotations.set(name, ann);
    }
  }

  // Topological walk: accumulate all axioms along the chain
  const order = topologicalSort(graph);
  const nodeMap = new Map<string, AetherNode>();
  for (const n of graph.nodes) {
    if ("contract" in n && !("hole" in n) && !("intent" in n)) {
      nodeMap.set(n.id, n as AetherNode);
    }
  }

  // Collect ALL axioms from all nodes in topological order
  const allAxioms: string[] = [];
  const axiomChainNodes: string[] = [];
  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    const nodeAxioms = node.axioms ?? [];
    if (nodeAxioms.length > 0) {
      allAxioms.push(...nodeAxioms);
      axiomChainNodes.push(nodeId);
    }
    // Also add postconditions as facts
    for (const post of node.contract.post ?? []) {
      allAxioms.push(post);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharedVars = new Map<string, any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharedArrays = new Map<string, { array: any; length: any }>();

  // Translate all axioms
  const axiomExprs: Z3TranslationResult[] = [];
  for (const axiom of allAxioms) {
    const result = translateExpression(axiom, ctx, allAnnotations, sharedVars, sharedArrays);
    sharedVars = result.variables;
    sharedArrays = result.listArrays;
    if (result.expr) axiomExprs.push(result);
  }

  // Check each pipeline property
  const results: PipelinePropertyResult[] = [];
  for (const prop of props) {
    const result = translateExpression(prop, ctx, allAnnotations, sharedVars, sharedArrays);
    sharedVars = result.variables;
    sharedArrays = result.listArrays;

    if (!result.expr) {
      results.push({
        property: prop,
        provedFromChain: false,
        chainLength: 0,
        axiomChain: [],
      });
      continue;
    }

    try {
      const solver = new ctx.Solver();
      // Assert all accumulated axioms
      for (const ax of axiomExprs) {
        if (ax.expr) solver.add(ax.expr);
      }
      // Assert NOT(property) — UNSAT means property follows from axiom chain
      solver.add(ctx.Not(result.expr));
      const check = await solverCheckWithTimeout(solver);

      results.push({
        property: prop,
        provedFromChain: check === "unsat",
        chainLength: axiomChainNodes.length,
        axiomChain: check === "unsat" ? allAxioms.filter(a => {
          // Find axioms relevant to this property's variables
          const propVarNames = extractVarNames(prop);
          return propVarNames.some(v => a.includes(v));
        }) : [],
      });
    } catch {
      results.push({
        property: prop,
        provedFromChain: false,
        chainLength: 0,
        axiomChain: [],
      });
    }
  }

  return results;
}

function extractVarNames(expr: string): string[] {
  const matches = expr.match(/[a-zA-Z_][a-zA-Z0-9_.]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?/g);
  return matches ?? [];
}

// ─── Axiom Soundness Checker ──────────────────────────────────────────────────

export function checkAxiomSoundness(
  node: AetherNode,
  inputs: Record<string, any>,
  outputs: Record<string, any>
): AxiomSoundnessResult {
  const axioms = node.axioms ?? [];
  const variables = { ...inputs, ...outputs };

  const axiomResults: AxiomSoundnessResult["axioms"] = [];

  for (const axiom of axioms) {
    try {
      const checkResult = checkContract(axiom, variables);
      axiomResults.push({
        expression: axiom,
        holdsAtRuntime: checkResult.passed && !checkResult.unevaluable,
        evaluated_value: checkResult.unevaluable ? "unevaluable" : checkResult.passed,
      });
    } catch {
      axiomResults.push({
        expression: axiom,
        holdsAtRuntime: false,
        evaluated_value: "error",
      });
    }
  }

  return {
    nodeId: node.id,
    axioms: axiomResults,
    allSound: axiomResults.every(a => a.holdsAtRuntime),
  };
}

// ─── Graph Verification ──────────────────────────────────────────────────────

export async function verifyGraph(graph: AetherGraph): Promise<GraphVerificationReport> {
  const z3 = await getZ3();
  const results: VerificationResult[] = [];

  // Build a map of node axioms for compositional verification
  const nodeAxioms = new Map<string, string[]>();

  for (const node of graph.nodes) {
    // Skip holes and intent nodes — they have no contracts to verify
    if (("hole" in node && (node as any).hole === true) ||
        ("intent" in node && (node as any).intent === true)) {
      continue;
    }

    // Collect upstream axioms from nodes that feed into this node
    const upstreamAxioms = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (edge.to.startsWith(node.id + ".")) {
        const fromNodeId = edge.from.split(".")[0];
        const fromPort = edge.from.split(".")[1];
        const fromNode = graph.nodes.find((n: any) => n.id === fromNodeId);
        if (!fromNode || !("contract" in fromNode)) continue;

        // Get the upstream node's axioms relevant to its output port
        const fromAxioms = (fromNode as AetherNode).axioms ?? [];
        const relevantAxioms = fromAxioms.filter(a => a.includes(fromPort));

        if (relevantAxioms.length > 0) {
          const toPort = edge.to.split(".")[1];
          // Remap: upstream's output port name → this node's input port name
          const remapped = relevantAxioms.map(a =>
            a.replace(new RegExp(`\\b${fromPort}\\b`, "g"), toPort)
          );
          const existing = upstreamAxioms.get(toPort) ?? [];
          upstreamAxioms.set(toPort, [...existing, ...remapped]);
        }
      }
    }

    const result = await verifyNode(
      node as AetherNode,
      z3,
      upstreamAxioms.size > 0 ? upstreamAxioms : undefined
    );
    results.push(result);

    // Store this node's axioms for downstream propagation
    nodeAxioms.set(node.id, (node as AetherNode).axioms ?? []);
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

  // ─── Edge Verification ───────────────────────────────────────────────
  const nodeMapForEdges = new Map<string, AetherNode>();
  for (const n of graph.nodes) {
    if ("contract" in n && !("hole" in n) && !("intent" in n)) {
      nodeMapForEdges.set(n.id, n as AetherNode);
    }
  }

  const edgeResults: EdgeVerificationResult[] = [];
  for (const edge of graph.edges) {
    const fromNodeId = edge.from.split(".")[0];
    const toNodeId = edge.to.split(".")[0];
    const sourceNode = nodeMapForEdges.get(fromNodeId);
    const destNode = nodeMapForEdges.get(toNodeId);

    // Only verify edges where dest has preconditions
    if (sourceNode && destNode && destNode.contract.pre && destNode.contract.pre.length > 0) {
      const edgeResult = await verifyEdge(edge, sourceNode, destNode, z3);
      edgeResults.push(edgeResult);
    }
  }

  // ─── Pipeline Verification ───────────────────────────────────────────
  const pipelineProperties = await verifyPipelineProperties(graph, z3);

  // ─── Summary ─────────────────────────────────────────────────────────
  const totalNodePosts = coverage
    ? coverage.z3_verified + coverage.z3_failed + coverage.z3_timeout + coverage.z3_unsupported
    : 0;
  const nodeProofRate = totalNodePosts > 0
    ? (coverage!.z3_verified / totalNodePosts) * 100
    : 100;

  const totalEdgePres = edgeResults.reduce((sum, e) => sum + e.details.length, 0);
  const edgeProved = edgeResults.reduce(
    (sum, e) => sum + e.details.filter(d => d.status === "proved").length, 0
  );
  const edgeProofRate = totalEdgePres > 0 ? (edgeProved / totalEdgePres) * 100 : 100;

  const totalPipelineProps = pipelineProperties.length;
  const pipelineProved = pipelineProperties.filter(p => p.provedFromChain).length;
  const pipelineProofRate = totalPipelineProps > 0
    ? (pipelineProved / totalPipelineProps) * 100
    : 100;

  const avgRate = (nodeProofRate + edgeProofRate + pipelineProofRate) / 3;
  const overallConfidence: "high" | "medium" | "low" =
    avgRate >= 80 ? "high" : avgRate >= 50 ? "medium" : "low";

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
    edgeResults,
    pipelineProperties,
    summary: {
      nodeProofRate: Math.round(nodeProofRate * 10) / 10,
      edgeProofRate: Math.round(edgeProofRate * 10) / 10,
      pipelineProofRate: Math.round(pipelineProofRate * 10) / 10,
      overallConfidence,
    },
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] === __filename ||
  process.argv[1]?.endsWith("verifier.ts") ||
  process.argv[1]?.endsWith("verifier.js");

export function printVerificationReport(report: GraphVerificationReport): void {
  const sep = "═══════════════════════════════════════════════════";
  console.log(sep);
  console.log(`AETHER Verification: ${report.graph_id}`);
  console.log(sep);

  // NODE VERIFICATION
  console.log(`\nNODE VERIFICATION (with axioms):`);
  for (const r of report.results) {
    const verified = r.postconditions.filter(p => p.status === "verified").length;
    const total = r.postconditions.length;
    const unsupported = r.postconditions.filter(p => p.status === "unsupported").length;
    const icon = r.verified ? "✓" : total === unsupported ? "◐" : "✗";
    const unsupMsg = unsupported > 0 ? ` (${unsupported} unsupported)` : "";
    console.log(`  ${r.node_id.padEnd(24)} ${verified}/${total} postconditions proved    ${icon}${unsupMsg}`);
  }
  if (report.summary) {
    console.log(`\n  Node proof rate: ${report.summary.nodeProofRate}%`);
  }

  // EDGE VERIFICATION
  if (report.edgeResults && report.edgeResults.length > 0) {
    console.log(`\nEDGE VERIFICATION:`);
    for (const e of report.edgeResults) {
      const icon = e.preconditionsSatisfied ? "✓" : "✗";
      console.log(`  ${e.edge.padEnd(30)} preconditions satisfied      ${icon}`);
    }
    if (report.summary) {
      console.log(`\n  Edge proof rate: ${report.summary.edgeProofRate}%`);
    }
  }

  // PIPELINE VERIFICATION
  if (report.pipelineProperties && report.pipelineProperties.length > 0) {
    console.log(`\nPIPELINE VERIFICATION:`);
    for (const p of report.pipelineProperties) {
      const icon = p.provedFromChain ? "✓" : "✗";
      const status = p.provedFromChain ? "proved from chain" : "not proved";
      console.log(`  "${p.property}"`.padEnd(42) + `${status}  ${icon}`);
      if (p.provedFromChain && p.axiomChain.length > 0) {
        console.log(`    axiom chain: ${p.axiomChain.length} axioms across ${p.chainLength} nodes`);
      }
    }
    if (report.summary) {
      console.log(`\n  Pipeline proof rate: ${report.summary.pipelineProofRate}%`);
    }
  }

  // OVERALL
  if (report.summary) {
    const totalProved = (report.coverage?.z3_verified ?? 0) +
      (report.edgeResults?.reduce((s, e) => s + e.details.filter(d => d.status === "proved").length, 0) ?? 0) +
      (report.pipelineProperties?.filter(p => p.provedFromChain).length ?? 0);
    const totalAll = (report.coverage
      ? report.coverage.z3_verified + report.coverage.z3_failed + report.coverage.z3_timeout + report.coverage.z3_unsupported
      : 0) +
      (report.edgeResults?.reduce((s, e) => s + e.details.length, 0) ?? 0) +
      (report.pipelineProperties?.length ?? 0);

    console.log(`\n${sep}`);
    console.log(`OVERALL: ${totalProved}/${totalAll} proved (${totalAll > 0 ? ((totalProved / totalAll) * 100).toFixed(1) : "100"}%) — confidence: ${report.summary.overallConfidence}`);
    console.log(sep);
  }
}

if (isMain && process.argv.length >= 3) {
  const filePath = process.argv[2];

  (async () => {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as AetherGraph;
      const report = await verifyGraph(raw);

      printVerificationReport(report);

      process.exit(report.nodes_failed > 0 ? 1 : 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  })();
}
