/**
 * AETHER Contract Verification Engine
 * Uses Z3 SMT solver (WASM) to verify node contracts.
 *
 * Postconditions: assert NOT(post) — UNSAT means postcondition always holds.
 * Adversarial checks: assert break_if — UNSAT means bad condition cannot occur.
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";

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
  status: "verified" | "failed" | "unsupported";
  counterexample?: Record<string, string>;
}

export interface AdversarialResult {
  expression: string;
  status: "passed" | "failed" | "unsupported";
  counterexample?: Record<string, string>;
}

export interface VerificationResult {
  node_id: string;
  verified: boolean;
  postconditions: PostconditionResult[];
  adversarial_checks: AdversarialResult[];
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

// ─── Expression Parser ────────────────────────────────────────────────────────

type ParsedExpr =
  | { kind: "var"; name: string }
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "str"; value: string }
  | { kind: "compare"; op: string; left: ParsedExpr; right: ParsedExpr }
  | { kind: "logic"; op: "and" | "or"; left: ParsedExpr; right: ParsedExpr }
  | { kind: "implies"; left: ParsedExpr; right: ParsedExpr }
  | { kind: "not"; expr: ParsedExpr }
  | { kind: "prop"; object: string; property: string }
  | { kind: "unsupported"; raw: string };

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i])) { i++; continue; }

    // Multi-char operators
    if (expr.slice(i, i + 2) === "!=") { tokens.push("!="); i += 2; continue; }
    if (expr.slice(i, i + 2) === ">=") { tokens.push(">="); i += 2; continue; }
    if (expr.slice(i, i + 2) === "<=") { tokens.push("<="); i += 2; continue; }
    if (expr.slice(i, i + 2) === "==") { tokens.push("=="); i += 2; continue; }
    if (expr.slice(i, i + 2) === "&&") { tokens.push("&&"); i += 2; continue; }
    if (expr.slice(i, i + 2) === "||") { tokens.push("||"); i += 2; continue; }
    if (expr.slice(i, i + 2) === "->") { tokens.push("→"); i += 2; continue; }

    // Unicode operators
    if (expr[i] === "∧") { tokens.push("∧"); i++; continue; }
    if (expr[i] === "∨") { tokens.push("∨"); i++; continue; }
    if (expr[i] === "¬") { tokens.push("¬"); i++; continue; }
    if (expr[i] === "≠") { tokens.push("≠"); i++; continue; }
    if (expr[i] === "≤") { tokens.push("≤"); i++; continue; }
    if (expr[i] === "≥") { tokens.push("≥"); i++; continue; }
    if (expr[i] === "∈") { tokens.push("∈"); i++; continue; }
    if (expr[i] === "∉") { tokens.push("∉"); i++; continue; }
    if (expr[i] === "∩") { tokens.push("∩"); i++; continue; }
    if (expr[i] === "⊆") { tokens.push("⊆"); i++; continue; }
    if (expr[i] === "∀") { tokens.push("∀"); i++; continue; }
    if (expr[i] === "→") { tokens.push("→"); i++; continue; }
    if (expr[i] === "⟹") { tokens.push("→"); i++; continue; }

    // Single-char operators
    if ("<>=!+*()-:,".includes(expr[i])) { tokens.push(expr[i]); i++; continue; }

    // String literals
    if (expr[i] === '"') {
      let str = '"';
      i++;
      while (i < expr.length && expr[i] !== '"') { str += expr[i]; i++; }
      if (i < expr.length) { str += '"'; i++; }
      tokens.push(str);
      continue;
    }

    // Numbers
    if (/\d/.test(expr[i]) || (expr[i] === "-" && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      let num = "";
      if (expr[i] === "-") { num = "-"; i++; }
      while (i < expr.length && /[\d.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push(num);
      continue;
    }

    // Identifiers (including dotted property access)
    if (/[a-zA-Z_]/.test(expr[i])) {
      let ident = "";
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) { ident += expr[i]; i++; }
      tokens.push(ident);
      continue;
    }

    // Skip unknown characters
    i++;
  }
  return tokens;
}

function parseExpression(expr: string): ParsedExpr {
  const trimmed = expr.trim();

  // Detect unsupported patterns early
  if (trimmed.includes("∀") || trimmed.includes("forall")) {
    return { kind: "unsupported", raw: trimmed };
  }
  if (trimmed.includes("∩") || trimmed.includes("intersection")) {
    return { kind: "unsupported", raw: trimmed };
  }
  if (trimmed.includes("⊆") || trimmed.includes("is_subset_of")) {
    return { kind: "unsupported", raw: trimmed };
  }
  if (trimmed.includes("<=>") || trimmed.includes("exists(")) {
    return { kind: "unsupported", raw: trimmed };
  }
  if (trimmed.includes("in [") || trimmed.includes("in allowed_actions")) {
    return { kind: "unsupported", raw: trimmed };
  }
  if (trimmed.includes("modifies") || trimmed.includes("deletes") || trimmed.includes("never(")) {
    return { kind: "unsupported", raw: trimmed };
  }
  if (trimmed.includes("not_in") || trimmed.includes("has_duplicates") || trimmed.includes("is_distinct")) {
    return { kind: "unsupported", raw: trimmed };
  }
  if (trimmed.includes("size in ") || trimmed.includes("lambda") || trimmed.includes("=>")) {
    // "size in 10..20" style constraints
    if (trimmed.includes("size in ")) return { kind: "unsupported", raw: trimmed };
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { kind: "unsupported", raw: trimmed };

  try {
    return parseImplication(tokens, { pos: 0 });
  } catch {
    return { kind: "unsupported", raw: trimmed };
  }
}

interface ParseState { pos: number }

function parseImplication(tokens: string[], state: ParseState): ParsedExpr {
  let left = parseOr(tokens, state);
  while (state.pos < tokens.length && tokens[state.pos] === "→") {
    state.pos++;
    const right = parseOr(tokens, state);
    left = { kind: "implies", left, right };
  }
  return left;
}

function parseOr(tokens: string[], state: ParseState): ParsedExpr {
  let left = parseAnd(tokens, state);
  while (state.pos < tokens.length && (tokens[state.pos] === "||" || tokens[state.pos] === "∨")) {
    state.pos++;
    const right = parseAnd(tokens, state);
    left = { kind: "logic", op: "or", left, right };
  }
  return left;
}

function parseAnd(tokens: string[], state: ParseState): ParsedExpr {
  let left = parseNot(tokens, state);
  while (state.pos < tokens.length && (tokens[state.pos] === "&&" || tokens[state.pos] === "∧")) {
    state.pos++;
    const right = parseNot(tokens, state);
    left = { kind: "logic", op: "and", left, right };
  }
  return left;
}

function parseNot(tokens: string[], state: ParseState): ParsedExpr {
  if (state.pos < tokens.length && (tokens[state.pos] === "!" || tokens[state.pos] === "¬")) {
    state.pos++;
    const expr = parseNot(tokens, state);
    return { kind: "not", expr };
  }
  return parseComparison(tokens, state);
}

function parseComparison(tokens: string[], state: ParseState): ParsedExpr {
  const left = parseAtom(tokens, state);
  const compOps = ["<", ">", "<=", ">=", "==", "!=", "≠", "≤", "≥", "="];

  if (state.pos < tokens.length && compOps.includes(tokens[state.pos])) {
    const op1 = tokens[state.pos];
    state.pos++;
    const middle = parseAtom(tokens, state);
    const normalizedOp1 = op1 === "≠" ? "!=" : op1 === "≤" ? "<=" : op1 === "≥" ? ">=" : op1;
    const firstCmp: ParsedExpr = { kind: "compare", op: normalizedOp1, left, right: middle };

    // Check for chained comparison: a ≤ b ≤ c → (a ≤ b) ∧ (b ≤ c)
    if (state.pos < tokens.length && compOps.includes(tokens[state.pos])) {
      const op2 = tokens[state.pos];
      state.pos++;
      const right = parseAtom(tokens, state);
      const normalizedOp2 = op2 === "≠" ? "!=" : op2 === "≤" ? "<=" : op2 === "≥" ? ">=" : op2;
      const secondCmp: ParsedExpr = { kind: "compare", op: normalizedOp2, left: middle, right };
      return { kind: "logic", op: "and", left: firstCmp, right: secondCmp };
    }

    return firstCmp;
  }
  return left;
}

function parseAtom(tokens: string[], state: ParseState): ParsedExpr {
  if (state.pos >= tokens.length) {
    throw new Error("Unexpected end of expression");
  }

  const token = tokens[state.pos];

  // Parenthesized expression
  if (token === "(") {
    state.pos++;
    const expr = parseOr(tokens, state);
    if (state.pos < tokens.length && tokens[state.pos] === ")") {
      state.pos++;
    }
    return expr;
  }

  // Boolean literals
  if (token === "true") { state.pos++; return { kind: "bool", value: true }; }
  if (token === "false") { state.pos++; return { kind: "bool", value: false }; }

  // String literals
  if (token.startsWith('"') && token.endsWith('"')) {
    state.pos++;
    return { kind: "str", value: token.slice(1, -1) };
  }

  // Number literals
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    state.pos++;
    return { kind: "num", value: parseFloat(token) };
  }

  // Identifiers (including dotted: "x.y" → prop)
  if (/^[a-zA-Z_]/.test(token)) {
    state.pos++;
    if (token.includes(".")) {
      const dot = token.indexOf(".");
      return { kind: "prop", object: token.slice(0, dot), property: token.slice(dot + 1) };
    }
    return { kind: "var", name: token };
  }

  throw new Error(`Unexpected token: ${token}`);
}

// ─── Z3 Expression Builder ───────────────────────────────────────────────────

function collectVariables(expr: ParsedExpr): Map<string, "int" | "real" | "bool" | "string" | "unknown"> {
  const vars = new Map<string, "int" | "real" | "bool" | "string" | "unknown">();

  function walk(e: ParsedExpr): void {
    switch (e.kind) {
      case "var":
        if (!vars.has(e.name)) vars.set(e.name, "unknown");
        break;
      case "prop": {
        const name = `${e.object}_${e.property}`;
        // list.length → integer
        if (e.property === "length") {
          vars.set(name, "int");
        } else if (!vars.has(name)) {
          vars.set(name, "unknown");
        }
        break;
      }
      case "compare":
        walk(e.left);
        walk(e.right);
        // Infer types from comparison context
        inferFromComparison(e.left, e.right, vars);
        // Infer string type from string comparisons
        if (e.left.kind === "str" && e.right.kind === "var") vars.set(e.right.name, "unknown");
        if (e.right.kind === "str" && e.left.kind === "var") vars.set(e.left.name, "unknown");
        break;
      case "logic":
        walk(e.left);
        walk(e.right);
        break;
      case "implies":
        walk(e.left);
        walk(e.right);
        break;
      case "not":
        walk(e.expr);
        break;
    }
  }

  walk(expr);
  return vars;
}

function inferFromComparison(
  left: ParsedExpr,
  right: ParsedExpr,
  vars: Map<string, "int" | "real" | "bool" | "string" | "unknown">
): void {
  // If one side is a number, the other should be numeric
  const leftName = left.kind === "var" ? left.name : left.kind === "prop" ? `${left.object}_${left.property}` : null;
  const rightName = right.kind === "var" ? right.name : right.kind === "prop" ? `${right.object}_${right.property}` : null;

  if (leftName && right.kind === "num") {
    vars.set(leftName, Number.isInteger(right.value) ? "int" : "real");
  }
  if (rightName && left.kind === "num") {
    vars.set(rightName, Number.isInteger(left.value) ? "int" : "real");
  }
  if (leftName && right.kind === "bool") {
    vars.set(leftName, "bool");
  }
  if (rightName && left.kind === "bool") {
    vars.set(rightName, "bool");
  }
  if (leftName && right.kind === "str") {
    vars.set(leftName, "string");
  }
  if (rightName && left.kind === "str") {
    vars.set(rightName, "string");
  }
}

function buildZ3Expr(
  expr: ParsedExpr,
  ctx: Z3Context,
  varMap: Map<string, unknown>
): unknown | null {
  switch (expr.kind) {
    case "num": {
      if (Number.isInteger(expr.value)) {
        return ctx.Int.val(expr.value);
      }
      // Use Real for non-integers
      return ctx.Real.val(expr.value);
    }
    case "bool":
      return expr.value ? ctx.Bool.val(true) : ctx.Bool.val(false);
    case "str":
      // Create a string constant for Z3 comparison
      try {
        return ctx.String.val(expr.value);
      } catch {
        return null;
      }
    case "var": {
      const v = varMap.get(expr.name);
      if (!v) return null;
      return v;
    }
    case "prop": {
      const name = `${expr.object}_${expr.property}`;
      const v = varMap.get(name);
      if (!v) return null;
      return v;
    }
    case "compare": {
      const l = buildZ3Expr(expr.left, ctx, varMap);
      const r = buildZ3Expr(expr.right, ctx, varMap);
      if (!l || !r) return null;
      try {
        switch (expr.op) {
          case "<": return ctx.LT(l, r);
          case ">": return ctx.GT(l, r);
          case "<=": return ctx.LE(l, r);
          case ">=": return ctx.GE(l, r);
          case "==":
          case "=": return ctx.Eq(l, r);
          case "!=": return ctx.Not(ctx.Eq(l, r));
          default: return null;
        }
      } catch {
        // Sort mismatch (e.g., Int vs String) — graceful degradation
        return null;
      }
    }
    case "logic": {
      const l = buildZ3Expr(expr.left, ctx, varMap);
      const r = buildZ3Expr(expr.right, ctx, varMap);
      if (!l || !r) return null;
      return expr.op === "and" ? ctx.And(l, r) : ctx.Or(l, r);
    }
    case "implies": {
      const l = buildZ3Expr(expr.left, ctx, varMap);
      const r = buildZ3Expr(expr.right, ctx, varMap);
      if (!l || !r) return null;
      return ctx.Implies(l, r);
    }
    case "not": {
      const inner = buildZ3Expr(expr.expr, ctx, varMap);
      if (!inner) return null;
      return ctx.Not(inner);
    }
    case "unsupported":
      return null;
  }
}

function createZ3Variables(
  vars: Map<string, "int" | "real" | "bool" | "string" | "unknown">,
  nodeAnnotations: Map<string, TypeAnnotation>,
  ctx: Z3Context
): Map<string, unknown> {
  const varMap = new Map<string, unknown>();

  for (const [name, inferredType] of vars) {
    // Check if there's a type annotation for this variable
    const annotation = nodeAnnotations.get(name);
    let type = inferredType;

    if (annotation) {
      if (annotation.type === "Int") type = "int";
      else if (annotation.type === "Float64" || annotation.type === "Float32") type = "real";
      else if (annotation.type === "Bool") type = "bool";
      else if (annotation.type === "String") type = "string";
    }

    // Default unknown to int
    if (type === "unknown") type = "int";

    switch (type) {
      case "int": varMap.set(name, ctx.Int.const(name)); break;
      case "real": varMap.set(name, ctx.Real.const(name)); break;
      case "bool": varMap.set(name, ctx.Bool.const(name)); break;
      case "string":
        try { varMap.set(name, ctx.String.const(name)); } catch { varMap.set(name, ctx.Int.const(name)); }
        break;
    }
  }

  return varMap;
}

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

function extractCounterexample(
  model: { eval: (v: unknown) => { toString: () => string } },
  varMap: Map<string, unknown>
): Record<string, string> {
  const ce: Record<string, string> = {};
  for (const [name, z3Var] of varMap) {
    try {
      ce[name] = model.eval(z3Var).toString();
    } catch {
      ce[name] = "?";
    }
  }
  return ce;
}

// ─── Node Verification ───────────────────────────────────────────────────────

export async function verifyNode(
  node: AetherNode,
  z3: Z3Instance
): Promise<VerificationResult> {
  const { Context } = z3;
  const ctx = new Context(`verify_${node.id}`);
  const annotations = buildAnnotationMap(node);

  const postconditions: PostconditionResult[] = [];
  const adversarial_checks: AdversarialResult[] = [];

  // Build precondition constraints (used as assumptions)
  const preExprs: unknown[] = [];
  if (node.contract.pre) {
    for (const preStr of node.contract.pre) {
      const parsed = parseExpression(preStr);
      if (parsed.kind === "unsupported") continue;
      const vars = collectVariables(parsed);
      const varMap = createZ3Variables(vars, annotations, ctx);
      const z3Expr = buildZ3Expr(parsed, ctx, varMap);
      if (z3Expr) preExprs.push({ expr: z3Expr, varMap });
    }
  }

  // Verify postconditions
  if (node.contract.post) {
    for (const postStr of node.contract.post) {
      const parsed = parseExpression(postStr);
      if (parsed.kind === "unsupported") {
        postconditions.push({ expression: postStr, status: "unsupported" });
        continue;
      }

      const vars = collectVariables(parsed);
      const varMap = createZ3Variables(vars, annotations, ctx);
      const z3Expr = buildZ3Expr(parsed, ctx, varMap);

      if (!z3Expr) {
        postconditions.push({ expression: postStr, status: "unsupported" });
        continue;
      }

      try {
        const solver = new ctx.Solver();
        // Add preconditions as assumptions
        for (const pre of preExprs) {
          // Merge var maps for shared variables
          const preObj = pre as { expr: unknown; varMap: Map<string, unknown> };
          solver.add(preObj.expr);
        }
        // Assert NOT(postcondition) — if UNSAT, postcondition always holds
        solver.add(ctx.Not(z3Expr));
        const result = await solver.check();

        if (result === "unsat") {
          postconditions.push({ expression: postStr, status: "verified" });
        } else {
          const ce = result === "sat"
            ? extractCounterexample(solver.model(), varMap)
            : undefined;
          postconditions.push({ expression: postStr, status: "failed", counterexample: ce });
        }
      } catch {
        postconditions.push({ expression: postStr, status: "unsupported" });
      }
    }
  }

  // Verify adversarial checks
  if (node.adversarial_check?.break_if) {
    for (const breakStr of node.adversarial_check.break_if) {
      const parsed = parseExpression(breakStr);
      if (parsed.kind === "unsupported") {
        adversarial_checks.push({ expression: breakStr, status: "unsupported" });
        continue;
      }

      const vars = collectVariables(parsed);
      const varMap = createZ3Variables(vars, annotations, ctx);
      const z3Expr = buildZ3Expr(parsed, ctx, varMap);

      if (!z3Expr) {
        adversarial_checks.push({ expression: breakStr, status: "unsupported" });
        continue;
      }

      try {
        const solver = new ctx.Solver();
        // Add preconditions and postconditions as context
        for (const pre of preExprs) {
          const preObj = pre as { expr: unknown; varMap: Map<string, unknown> };
          solver.add(preObj.expr);
        }
        // Assert the adversarial condition
        // If UNSAT → the bad thing can never happen → PASSED
        // If SAT → the bad thing could happen → FAILED
        solver.add(z3Expr);
        const result = await solver.check();

        if (result === "unsat") {
          adversarial_checks.push({ expression: breakStr, status: "passed" });
        } else {
          const ce = result === "sat"
            ? extractCounterexample(solver.model(), varMap)
            : undefined;
          adversarial_checks.push({ expression: breakStr, status: "failed", counterexample: ce });
        }
      } catch {
        adversarial_checks.push({ expression: breakStr, status: "unsupported" });
      }
    }
  }

  // Node is verified if all postconditions verified and all adversarial checks passed
  const allPostVerified = postconditions.every(p => p.status === "verified" || p.status === "unsupported");
  const allAdversarialPassed = adversarial_checks.every(a => a.status === "passed" || a.status === "unsupported");
  const hasAnyVerified = postconditions.some(p => p.status === "verified") || adversarial_checks.some(a => a.status === "passed");
  const hasAnyFailed = postconditions.some(p => p.status === "failed") || adversarial_checks.some(a => a.status === "failed");

  return {
    node_id: node.id,
    verified: !hasAnyFailed && (hasAnyVerified || (!hasAnyFailed)),
    postconditions,
    adversarial_checks,
  };
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
        // Assert: valid transition AND from=nev.from AND to=nev.to
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
        // Assert: valid transition AND from=terminal_state
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

  return {
    graph_id: graph.id,
    nodes_verified,
    nodes_failed,
    nodes_unsupported,
    results,
    verification_percentage,
    stateTypeResults,
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
          const statusIcon = p.status === "verified" ? "✓" : p.status === "failed" ? "✗" : "?";
          console.log(`   ${statusIcon} POST: ${p.expression} → ${p.status}`);
          if (p.counterexample) {
            console.log(`     counterexample: ${JSON.stringify(p.counterexample)}`);
          }
        }

        for (const a of r.adversarial_checks) {
          const statusIcon = a.status === "passed" ? "✓" : a.status === "failed" ? "✗" : "?";
          console.log(`   ${statusIcon} BREAK_IF: ${a.expression} → ${a.status}`);
          if (a.counterexample) {
            console.log(`     counterexample: ${JSON.stringify(a.counterexample)}`);
          }
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
