/**
 * AETHER Tactic Generator
 * Maps contract expression patterns to Lean 4 tactic sequences that actually prove them.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TacticResult {
  provable: boolean;
  tactics: string[];          // Lean 4 tactic sequence
  confidence: "certain" | "likely" | "speculative";
  fallback?: string;          // sorry with explanation if not provable
}

export interface ProofContext {
  variables: Map<string, { type: string; constraints: string[] }>;
  hypotheses: string[];       // available premises (from preconditions)
  stateType?: string;         // if this is a state machine contract
}

export type TacticKind =
  | "omega"           // linear integer arithmetic
  | "tauto"           // propositional logic
  | "decide"          // finite decidable propositions
  | "exact"           // exact hypothesis match
  | "simp"            // simplification
  | "intro_cases"     // intro h; cases h (impossibility)
  | "intro_exact"     // intro + exact (implication)
  | "trivial"         // trivially true
  | "sorry";          // not provable automatically

// ─── Expression Classification ────────────────────────────────────────────────

interface ClassifiedExpression {
  kind: TacticKind;
  detail: string;
}

/**
 * Classify a contract expression to determine the best tactic.
 */
function classifyExpression(expr: string, ctx: ProofContext): ClassifiedExpression {
  const trimmed = expr.trim();

  // 1. Check if this is directly available as a hypothesis
  if (isHypothesisMatch(trimmed, ctx)) {
    return { kind: "exact", detail: `hypothesis match: ${trimmed}` };
  }

  // 2. Boolean equality: x == true, x == false
  if (/^\w+(\.\w+)*\s*==\s*true$/.test(trimmed) || /^\w+(\.\w+)*\s*==\s*false$/.test(trimmed)) {
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `boolean equality from hypothesis` };
    }
    return { kind: "decide", detail: `boolean equality` };
  }

  // 3. Simple field equality: a.x == b.x, output == input, etc.
  const eqMatch = trimmed.match(/^(\w+(?:\.\w+)*)\s*==\s*(\w+(?:\.\w+)*)$/);
  if (eqMatch) {
    const [, left, right] = eqMatch;
    // If both sides reference known variables and one appears in hypotheses
    if (isHypothesisMatch(trimmed, ctx) || isHypothesisMatch(`${left} = ${right}`, ctx)) {
      return { kind: "exact", detail: `equality from hypothesis` };
    }
    // Check if it's a trivial self-equality
    if (left === right) {
      return { kind: "trivial", detail: `self-equality` };
    }
    return { kind: "simp", detail: `field equality` };
  }

  // 4. != null checks (before arithmetic to avoid false positive on !=)
  if (/^\w+(\.\w+)*\s*!=\s*null$/.test(trimmed)) {
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `non-null from hypothesis` };
    }
    return { kind: "simp", detail: `non-null check` };
  }

  // 5. Linear integer arithmetic: x > 0, x >= 0, x <= y, a + b = c, etc.
  if (isLinearArithmetic(trimmed)) {
    // Check if we have matching hypothesis
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `arithmetic from hypothesis` };
    }
    return { kind: "omega", detail: `linear arithmetic` };
  }

  // 6. Property test: x.is_lowercase, x.is_trimmed
  if (/^\w+(\.\w+)*\.is_\w+$/.test(trimmed)) {
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `property from hypothesis` };
    }
    return { kind: "sorry", detail: `property test requires domain knowledge` };
  }

  // 6. String/length comparisons: x.length > 0, x.length >= 0
  if (/^\w+(\.\w+)*\.length\s*(>|>=|<|<=|==)\s*\d+$/.test(trimmed)) {
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `length from hypothesis` };
    }
    // length >= 0 is always true for natural numbers
    const lenGe0 = trimmed.match(/\.length\s*>=\s*0$/);
    if (lenGe0) {
      return { kind: "omega", detail: `length non-negative (always true)` };
    }
    return { kind: "omega", detail: `length arithmetic` };
  }

  // 7. Compound AND: a ∧ b, a && b
  if (trimmed.includes(" ∧ ") || trimmed.includes(" && ")) {
    return { kind: "tauto", detail: `conjunction` };
  }

  // 8. Compound OR: a ∨ b, a || b
  if (trimmed.includes(" ∨ ") || trimmed.includes(" || ")) {
    return { kind: "tauto", detail: `disjunction` };
  }

  // 9. Negation: ¬a, !a
  if (trimmed.startsWith("¬") || trimmed.startsWith("!")) {
    return { kind: "tauto", detail: `negation` };
  }

  // 10. Implication: a → b
  if (trimmed.includes(" → ")) {
    return { kind: "intro_exact", detail: `implication` };
  }

  // 11. Enum membership: status ∈ ["a", "b"]
  if (trimmed.includes(" ∈ ")) {
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `membership from hypothesis` };
    }
    return { kind: "decide", detail: `enum membership` };
  }

  // 12. Status equality: status == "value", status == value (unquoted)
  if (/^\w+(\.\w+)*\s*==\s*\w+$/.test(trimmed)) {
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `enum equality from hypothesis` };
    }
    return { kind: "simp", detail: `enum equality` };
  }

  // 14. Complex expressions (function calls, quantifiers, set ops)
  if (/exists\(|forall\(|is_subset_of|intersection\(|<=>|has_duplicates|is_distinct/.test(trimmed)) {
    return { kind: "sorry", detail: `complex expression requires manual proof: ${trimmed}` };
  }

  // 15. Arithmetic with multiplication (non-linear)
  if (/\*/.test(trimmed)) {
    return { kind: "sorry", detail: `non-linear arithmetic` };
  }

  // 16. Fall through — if it looks like a simple comparison, try omega
  if (/^[\w.]+\s*(>|>=|<|<=|==|!=)\s*[\w.]+$/.test(trimmed)) {
    if (isHypothesisMatch(trimmed, ctx)) {
      return { kind: "exact", detail: `comparison from hypothesis` };
    }
    return { kind: "omega", detail: `simple comparison` };
  }

  return { kind: "sorry", detail: `unrecognized pattern: ${trimmed}` };
}

// ─── Hypothesis Matching ──────────────────────────────────────────────────────

function normalizeExpr(expr: string): string {
  return expr.trim()
    .replace(/\s*==\s*/g, " = ")
    .replace(/\s+/g, " ");
}

function isHypothesisMatch(expr: string, ctx: ProofContext): boolean {
  const normalized = normalizeExpr(expr);
  for (const h of ctx.hypotheses) {
    if (normalizeExpr(h) === normalized) return true;
  }
  return false;
}

// ─── Arithmetic Detection ─────────────────────────────────────────────────────

function isLinearArithmetic(expr: string): boolean {
  // Matches: x > 0, x >= 0, x < 100, x <= y, a + b = c, etc.
  // But NOT: function calls, string ops, complex expressions
  if (/[()"]/.test(expr)) return false;
  if (/\.\w+\(/.test(expr)) return false; // method calls
  if (/\.is_\w+/.test(expr)) return false; // property tests
  if (/\.length/.test(expr)) return false; // handled separately

  // Must contain at least one arithmetic/comparison operator
  if (/(>|>=|<|<=|==|!=|\+|-)\s/.test(expr) || /\s(>|>=|<|<=|==|!=|\+|-)/.test(expr)) {
    // Should only contain identifiers, numbers, and arithmetic operators
    const cleaned = expr.replace(/[\w.]+/g, "").replace(/\s+/g, "").replace(/[><=!+\-]/g, "");
    return cleaned.length === 0;
  }

  return false;
}

// ─── Tactic Generation ───────────────────────────────────────────────────────

/**
 * Generate a Lean 4 tactic for a single contract expression.
 */
export function generateTactic(expr: string, context: ProofContext): TacticResult {
  const classified = classifyExpression(expr, context);

  switch (classified.kind) {
    case "omega":
      return {
        provable: true,
        tactics: ["omega"],
        confidence: "certain",
      };

    case "tauto":
      return {
        provable: true,
        tactics: ["tauto"],
        confidence: "certain",
      };

    case "decide":
      return {
        provable: true,
        tactics: ["decide"],
        confidence: "likely",
      };

    case "exact": {
      // Find the matching hypothesis name
      const hName = findHypothesisName(expr, context);
      return {
        provable: true,
        tactics: [hName ? `exact ${hName}` : "assumption"],
        confidence: "certain",
      };
    }

    case "simp":
      return {
        provable: true,
        tactics: ["simp"],
        confidence: "likely",
      };

    case "intro_cases":
      return {
        provable: true,
        tactics: ["intro h", "cases h"],
        confidence: "certain",
      };

    case "intro_exact":
      return {
        provable: true,
        tactics: ["intro h", "exact h"],
        confidence: "likely",
      };

    case "trivial":
      return {
        provable: true,
        tactics: ["rfl"],
        confidence: "certain",
      };

    case "sorry":
      return {
        provable: false,
        tactics: [],
        confidence: "speculative",
        fallback: `sorry /- ${classified.detail} -/`,
      };
  }
}

function findHypothesisName(expr: string, ctx: ProofContext): string | null {
  const normalized = normalizeExpr(expr);
  for (let i = 0; i < ctx.hypotheses.length; i++) {
    if (normalizeExpr(ctx.hypotheses[i]) === normalized) {
      return `h_pre_${i + 1}`;
    }
  }
  return null;
}

// ─── Compound Tactic Generation ───────────────────────────────────────────────

/**
 * Generate tactics for a list of postcondition expressions.
 * Returns individual results plus a combined tactic for the full conjunction.
 */
export function generateCompoundTactic(
  exprs: string[],
  context: ProofContext,
): { individual: TacticResult[]; combined: TacticResult } {
  const individual = exprs.map(e => generateTactic(e, context));

  const allProvable = individual.every(r => r.provable);

  if (!allProvable) {
    const unprovable = individual
      .map((r, i) => r.provable ? null : exprs[i])
      .filter(Boolean);
    return {
      individual,
      combined: {
        provable: false,
        tactics: [],
        confidence: "speculative",
        fallback: `sorry /- unprovable sub-goals: ${unprovable.join("; ")} -/`,
      },
    };
  }

  // All provable — determine if we can use a single tactic
  const tacticKinds = new Set(individual.flatMap(r => r.tactics));

  // If all use the same single tactic, use that
  if (individual.every(r => r.tactics.length === 1)) {
    const uniqueTactics = [...new Set(individual.map(r => r.tactics[0]))];
    if (uniqueTactics.length === 1) {
      return {
        individual,
        combined: {
          provable: true,
          tactics: uniqueTactics,
          confidence: individual.every(r => r.confidence === "certain") ? "certain" : "likely",
        },
      };
    }
  }

  // Mixed tactics — use constructor approach for conjunction
  // For n postconditions: ⟨proof₁, proof₂, ...⟩ or tactic sequence
  const tactics: string[] = [];
  if (individual.length > 1) {
    // Use `constructor` to split the conjunction, then apply each tactic
    for (let i = 0; i < individual.length; i++) {
      if (i < individual.length - 1) {
        tactics.push("constructor");
      }
      tactics.push(`· ${individual[i].tactics.join("; ")}`);
    }
  } else {
    tactics.push(...individual[0].tactics);
  }

  return {
    individual,
    combined: {
      provable: true,
      tactics,
      confidence: individual.every(r => r.confidence === "certain") ? "certain" : "likely",
    },
  };
}

// ─── Context Builder ──────────────────────────────────────────────────────────

/**
 * Build a ProofContext from node information.
 */
export function buildProofContext(
  inputTypes: Record<string, { type: string; [k: string]: any }>,
  outputTypes: Record<string, { type: string; [k: string]: any }>,
  preconditions: string[],
  stateType?: string,
): ProofContext {
  const variables = new Map<string, { type: string; constraints: string[] }>();

  for (const [name, ann] of Object.entries(inputTypes)) {
    const constraints: string[] = [];
    if ((ann as any).constraint) constraints.push((ann as any).constraint);
    if ((ann as any).range) constraints.push(`${(ann as any).range[0]} ≤ ${name} ∧ ${name} ≤ ${(ann as any).range[1]}`);
    variables.set(name, { type: ann.type, constraints });
  }

  for (const [name, ann] of Object.entries(outputTypes)) {
    const constraints: string[] = [];
    variables.set(name, { type: ann.type, constraints });
  }

  return {
    variables,
    hypotheses: [...preconditions],
    stateType,
  };
}

// ─── Required Imports ─────────────────────────────────────────────────────────

/**
 * Get the Lean imports required for the tactics used.
 */
export function getRequiredImports(tactics: TacticKind[]): string[] {
  const imports = new Set<string>();

  for (const t of tactics) {
    switch (t) {
      case "omega":
        imports.add("Mathlib.Tactic.Omega");
        break;
      case "tauto":
        imports.add("Mathlib.Tactic.Tauto");
        break;
      case "simp":
        // simp is built-in, but some lemmas may need imports
        break;
      case "decide":
        // decide is built-in
        break;
    }
  }

  return [...imports];
}
