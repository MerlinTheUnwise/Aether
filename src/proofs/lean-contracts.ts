/**
 * AETHER Contract Translator
 * Translates AETHER contract expressions to Lean 4 propositions.
 */

import type { TypeAnnotation } from "../ir/validator.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContractContext {
  nodeId: string;
  inputTypes: Record<string, TypeAnnotation>;
  outputTypes: Record<string, TypeAnnotation>;
  variables: string[];
}

export interface TranslationResult {
  lean: string;
  supported: boolean;
  original: string;
}

// ─── Expression Translation ──────────────────────────────────────────────────

/**
 * Translates an AETHER contract expression to Lean 4 syntax.
 * Most operators map directly. Unsupported expressions produce `sorry`.
 */
export function contractToLean(expression: string, context: ContractContext): TranslationResult {
  const trimmed = expression.trim();

  // Try translation
  try {
    const lean = translateExpression(trimmed, context);
    return { lean, supported: true, original: trimmed };
  } catch {
    // Unsupported expression → sorry with comment
    return {
      lean: `sorry /- AETHER: ${trimmed} -/`,
      supported: false,
      original: trimmed,
    };
  }
}

function translateExpression(expr: string, context: ContractContext): string {
  // Universal quantifier: ∀x ∈ list: P(x) → ∀ x ∈ list, P x
  const forallMatch = expr.match(/^∀\s*(\w+)\s*∈\s*(\w+):\s*(.+)$/);
  if (forallMatch) {
    const [, varName, listName, body] = forallMatch;
    const leanBody = translateExpression(body, context);
    return `∀ ${varName} ∈ ${listName}, ${leanBody}`;
  }

  // Implication: a → b
  if (expr.includes(" → ")) {
    const parts = splitOnOperator(expr, " → ");
    if (parts.length === 2) {
      return `${translateExpression(parts[0], context)} → ${translateExpression(parts[1], context)}`;
    }
  }

  // Biconditional: a <=> b → a ↔ b
  if (expr.includes(" <=> ")) {
    const parts = splitOnOperator(expr, " <=> ");
    if (parts.length === 2) {
      return `${translateExpression(parts[0], context)} ↔ ${translateExpression(parts[1], context)}`;
    }
  }

  // Logical OR: a ∨ b
  if (expr.includes(" ∨ ")) {
    const parts = splitOnOperator(expr, " ∨ ");
    return parts.map(p => translateExpression(p, context)).join(" ∨ ");
  }

  // Logical AND: a ∧ b
  if (expr.includes(" ∧ ")) {
    const parts = splitOnOperator(expr, " ∧ ");
    return parts.map(p => translateExpression(p, context)).join(" ∧ ");
  }

  // Negation: ¬a
  if (expr.startsWith("¬")) {
    return `¬${translateExpression(expr.slice(1).trim(), context)}`;
  }

  // Set operations: ⊆, ∩
  if (expr.includes(" ⊆ ")) {
    const parts = splitOnOperator(expr, " ⊆ ");
    if (parts.length === 2) return `${parts[0].trim()} ⊆ ${parts[1].trim()}`;
  }
  if (expr.includes(" ∩ ")) {
    const parts = splitOnOperator(expr, " ∩ ");
    if (parts.length === 2) return `${parts[0].trim()} ∩ ${parts[1].trim()}`;
  }

  // Membership: a ∈ list, a ∉ list
  if (expr.includes(" ∈ ")) {
    const parts = splitOnOperator(expr, " ∈ ");
    if (parts.length === 2) return `${parts[0].trim()} ∈ ${parts[1].trim()}`;
  }
  if (expr.includes(" ∉ ")) {
    const parts = splitOnOperator(expr, " ∉ ");
    if (parts.length === 2) return `${parts[0].trim()} ∉ ${parts[1].trim()}`;
  }

  // Comparison operators: ≤, ≥, ≠, <, >, =
  for (const op of [" ≤ ", " ≥ ", " ≠ ", " < ", " > "]) {
    if (expr.includes(op)) {
      const parts = splitOnOperator(expr, op);
      if (parts.length === 2) {
        return `${translateAtom(parts[0], context)}${op}${translateAtom(parts[1], context)}`;
      }
    }
  }

  // Equality with == → = in Lean
  if (expr.includes(" == ")) {
    const parts = splitOnOperator(expr, " == ");
    if (parts.length === 2) {
      return `${translateAtom(parts[0], context)} = ${translateAtom(parts[1], context)}`;
    }
  }

  // Simple equality: a = b
  if (expr.includes(" = ") && !expr.includes(" == ")) {
    const eqIdx = expr.indexOf(" = ");
    // Make sure it's not part of ≤, ≥, ≠, or ==
    if (eqIdx > 0) {
      const before = expr[eqIdx - 1];
      if (before !== "!" && before !== "<" && before !== ">" && before !== "=") {
        const left = expr.slice(0, eqIdx);
        const right = expr.slice(eqIdx + 3);
        return `${translateAtom(left, context)} = ${translateAtom(right, context)}`;
      }
    }
  }

  // Function calls and complex expressions — check if it's a simple atom
  const atom = translateAtom(expr, context);
  if (atom !== expr || isSimpleExpression(expr)) {
    return atom;
  }

  // Unsupported
  throw new Error(`Unsupported expression: ${expr}`);
}

function translateAtom(expr: string, context: ContractContext): string {
  const trimmed = expr.trim();

  // Quoted string literal: "foo" → "foo"
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }

  // Number literal
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  // Boolean
  if (trimmed === "true" || trimmed === "false") {
    return trimmed;
  }

  // Negation of function call: !exists(...)
  if (trimmed.startsWith("!")) {
    return `¬${translateAtom(trimmed.slice(1), context)}`;
  }

  // Simple identifiers and field access: x, x.y, x.y.z
  if (/^[a-zA-Z_][\w]*(\.\w+)*$/.test(trimmed)) {
    return trimmed;
  }

  // Property access with method: x.length, x.is_lowercase etc.
  if (/^[a-zA-Z_][\w]*\.\w+$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed;
}

function isSimpleExpression(expr: string): boolean {
  // Allow simple identifiers, field access, numbers, booleans
  return /^[a-zA-Z_][\w]*(\.\w+)*$/.test(expr.trim()) ||
    /^-?\d+(\.\d+)?$/.test(expr.trim()) ||
    expr.trim() === "true" || expr.trim() === "false";
}

function splitOnOperator(expr: string, op: string): string[] {
  // Simple split — doesn't handle nested parens yet
  const idx = expr.indexOf(op);
  if (idx === -1) return [expr];
  return [expr.slice(0, idx), expr.slice(idx + op.length)];
}

// ─── Contract Section Generator ──────────────────────────────────────────────

export interface ContractSection {
  preconditions: TranslationResult[];
  postconditions: TranslationResult[];
  invariants: TranslationResult[];
}

export function translateContractSection(
  contract: { pre?: string[]; post?: string[]; invariants?: string[] },
  context: ContractContext,
): ContractSection {
  return {
    preconditions: (contract.pre ?? []).map(e => contractToLean(e, context)),
    postconditions: (contract.post ?? []).map(e => contractToLean(e, context)),
    invariants: (contract.invariants ?? []).map(e => contractToLean(e, context)),
  };
}
