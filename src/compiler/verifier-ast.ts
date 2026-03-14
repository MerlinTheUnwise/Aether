/**
 * AST-to-Z3 Translator for AETHER contract expressions
 *
 * Walks the runtime evaluator's AST and builds Z3 expressions instead of
 * evaluating values. This ensures the Z3 verifier and runtime evaluator
 * parse expressions identically — no divergence.
 *
 * Supports:
 * - Quantifiers (∀, ∃) via bounded unrolling or Z3 ForAll/Exists
 * - Set operations (∈, ∉, ∩, ⊆) via Z3 array theory
 * - Property predicates (list.distinct, list.is_sorted, list.length)
 * - String predicates as boolean constants (is_lowercase, is_trimmed)
 * - Arithmetic, comparisons, logical connectives, implications
 */

import { tokenize } from "../runtime/evaluator/lexer.js";
import { parse, ASTNode } from "../runtime/evaluator/parser.js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Z3Context = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Z3Expr = any;

export interface Z3TranslationResult {
  expr: Z3Expr | null;
  variables: Map<string, Z3Expr>;
  listArrays: Map<string, { array: Z3Expr; length: Z3Expr }>;
  unsupported?: string;
}

interface TranslationContext {
  ctx: Z3Context;
  /** Named Z3 variables (scalars) */
  variables: Map<string, Z3Expr>;
  /** Z3 array + length for list-typed ports */
  listArrays: Map<string, { array: Z3Expr; length: Z3Expr }>;
  /** Type annotations from node ports */
  annotations: Map<string, TypeAnnotation>;
  /** Counter for generating unique variable names */
  counter: { value: number };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a contract expression string into an AST using the runtime evaluator's
 * lexer + parser, then translate the AST to a Z3 expression.
 */
export function translateExpression(
  expression: string,
  ctx: Z3Context,
  annotations: Map<string, TypeAnnotation>,
  existingVars?: Map<string, Z3Expr>,
  existingArrays?: Map<string, { array: Z3Expr; length: Z3Expr }>
): Z3TranslationResult {
  // Parse using the runtime evaluator's pipeline
  const tokens = tokenize(expression);
  const { ast, errors } = parse(tokens);

  if (errors.length > 0) {
    return {
      expr: null,
      variables: existingVars ?? new Map(),
      listArrays: existingArrays ?? new Map(),
      unsupported: `Parse error: ${errors[0].message}`,
    };
  }

  const tctx: TranslationContext = {
    ctx,
    variables: existingVars ?? new Map(),
    listArrays: existingArrays ?? new Map(),
    annotations,
    counter: { value: 0 },
  };

  try {
    const z3Expr = astToZ3(ast, tctx);
    if (z3Expr === null) {
      return {
        expr: null,
        variables: tctx.variables,
        listArrays: tctx.listArrays,
        unsupported: `Could not translate: ${expression}`,
      };
    }
    return {
      expr: z3Expr,
      variables: tctx.variables,
      listArrays: tctx.listArrays,
    };
  } catch (e) {
    return {
      expr: null,
      variables: tctx.variables,
      listArrays: tctx.listArrays,
      unsupported: `Translation error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Parse an expression to AST only (for parity testing).
 */
export function parseToAST(expression: string): { ast: ASTNode; errors: string[] } {
  const tokens = tokenize(expression);
  const { ast, errors } = parse(tokens);
  return { ast, errors: errors.map(e => e.message) };
}

// ─── AST to Z3 Translation ──────────────────────────────────────────────────

function astToZ3(node: ASTNode, tctx: TranslationContext): Z3Expr | null {
  const { ctx } = tctx;

  switch (node.type) {
    case "literal": {
      if (typeof node.value === "number") {
        return Number.isInteger(node.value)
          ? ctx.Int.val(node.value)
          : ctx.Real.val(node.value);
      }
      if (typeof node.value === "boolean") {
        return ctx.Bool.val(node.value);
      }
      if (typeof node.value === "string") {
        // Model strings as integer constants (string theory is fragile in z3-solver WASM)
        return getOrCreateStringConst(node.value, tctx);
      }
      return null;
    }

    case "identifier": {
      return getOrCreateVariable(node.name, tctx);
    }

    case "property_access": {
      return translatePropertyAccess(node, tctx);
    }

    case "comparison": {
      return translateComparison(node.op, node.left, node.right, tctx);
    }

    case "chained_comparison": {
      // AND of all pairwise comparisons
      const parts: Z3Expr[] = [];
      for (const comp of node.comparisons) {
        const z3Comp = translateComparison(comp.op, comp.left, comp.right, tctx);
        if (!z3Comp) return null;
        parts.push(z3Comp);
      }
      if (parts.length === 0) return null;
      if (parts.length === 1) return parts[0];
      return ctx.And(...parts);
    }

    case "logical": {
      const left = astToZ3(node.left, tctx);
      const right = astToZ3(node.right, tctx);
      if (!left || !right) return null;
      if (node.op === "and") return ctx.And(left, right);
      if (node.op === "or") return ctx.Or(left, right);
      if (node.op === "implies") return ctx.Implies(left, right);
      return null;
    }

    case "not": {
      const inner = astToZ3(node.operand, tctx);
      if (!inner) return null;
      return ctx.Not(inner);
    }

    case "membership": {
      return translateMembership(node, tctx);
    }

    case "subset": {
      return translateSubset(node, tctx);
    }

    case "intersection": {
      // Intersection itself returns a list — but in contracts it's usually
      // compared: `a ∩ b = ∅` or `a ∩ b ≠ ∅`. We need a parent comparison.
      // Return a special marker that the comparison handler recognizes.
      // If we hit intersection standalone, we can't translate it to a bool.
      return null;
    }

    case "empty_set": {
      // This is compared against intersection results — handled in comparison
      return null;
    }

    case "forall": {
      return translateQuantifier(node, true, tctx);
    }

    case "exists": {
      return translateQuantifier(node, false, tctx);
    }

    case "array_literal": {
      // Can't translate array literal to a single Z3 expression
      // (used in membership/comparison contexts which handle them specially)
      return null;
    }

    case "function_call": {
      return translateFunctionCall(node, tctx);
    }

    case "method_call": {
      // Translate obj.method(args) → function_call(obj, ...args)
      // e.g., html_body.contains("Hello") → contains(html_body, "Hello")
      return translateFunctionCall(
        { type: "function_call", name: (node as any).method, args: [(node as any).object, ...(node as any).args] },
        tctx
      );
    }

    case "binary_op": {
      const left = astToZ3(node.left, tctx);
      const right = astToZ3(node.right, tctx);
      if (!left || !right) return null;
      try {
        if (node.op === "+") return ctx.Add(left, right);
        if (node.op === "-") return ctx.Sub(left, right);
        if (node.op === "*") return ctx.Mul(left, right);
        if (node.op === "/") return ctx.Div(left, right);
      } catch {
        return null;
      }
      return null;
    }

    case "unary_op": {
      if (node.op === "-") {
        const operand = astToZ3(node.operand, tctx);
        if (!operand) return null;
        try {
          return ctx.Sub(ctx.Int.val(0), operand);
        } catch {
          return null;
        }
      }
      return null;
    }

    default:
      return null;
  }
}

// ─── Property Access ─────────────────────────────────────────────────────────

function translatePropertyAccess(
  node: { type: "property_access"; object: ASTNode; property: string },
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;
  const prop = node.property;

  // Resolve the object name for variable lookups
  const objName = resolveObjectName(node.object);

  if (prop === "length") {
    // list.length → Z3 Int constant
    if (objName) {
      const listInfo = getOrCreateListArray(objName, tctx);
      return listInfo.length;
    }
    // Fallback to named variable
    const name = objName ? `${objName}_length` : `_anon_length_${tctx.counter.value++}`;
    return getOrCreateIntVariable(name, tctx);
  }

  if (prop === "size") {
    // Alias for length
    if (objName) {
      const listInfo = getOrCreateListArray(objName, tctx);
      return listInfo.length;
    }
    const name = objName ? `${objName}_size` : `_anon_size_${tctx.counter.value++}`;
    return getOrCreateIntVariable(name, tctx);
  }

  if (prop === "distinct" || prop === "is_distinct") {
    // list.distinct → ForAll i,j in range: i≠j → list[i] ≠ list[j]
    if (objName) {
      return translateDistinct(objName, tctx);
    }
    // Model as boolean constant
    const boolName = objName ? `${objName}_distinct` : `_anon_distinct_${tctx.counter.value++}`;
    return getOrCreateBoolVariable(boolName, tctx);
  }

  if (prop === "is_sorted") {
    if (objName) {
      return translateIsSorted(objName, tctx);
    }
    const boolName = objName ? `${objName}_is_sorted` : `_anon_sorted_${tctx.counter.value++}`;
    return getOrCreateBoolVariable(boolName, tctx);
  }

  if (prop === "has_duplicates") {
    // !distinct
    if (objName) {
      const distinct = translateDistinct(objName, tctx);
      if (distinct) return ctx.Not(distinct);
    }
    const boolName = objName ? `${objName}_has_duplicates` : `_anon_has_dupes_${tctx.counter.value++}`;
    return getOrCreateBoolVariable(boolName, tctx);
  }

  if (prop === "is_lowercase" || prop === "is_trimmed" || prop === "is_empty") {
    // Model string properties as boolean Z3 constants
    const boolName = objName ? `${objName}_${prop}` : `_anon_${prop}_${tctx.counter.value++}`;
    return getOrCreateBoolVariable(boolName, tctx);
  }

  // General property: model as a variable
  const varName = objName ? `${objName}_${prop}` : `_prop_${prop}_${tctx.counter.value++}`;
  return getOrCreateVariable(varName, tctx);
}

function resolveObjectName(node: ASTNode): string | null {
  if (node.type === "identifier") return node.name;
  if (node.type === "property_access") {
    const parent = resolveObjectName(node.object);
    return parent ? `${parent}_${node.property}` : null;
  }
  return null;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

function translateComparison(
  op: string,
  left: ASTNode,
  right: ASTNode,
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;

  // Special case: intersection comparison (a ∩ b = ∅ or a ∩ b ≠ ∅)
  if (left.type === "intersection" && right.type === "empty_set") {
    return translateIntersectionEmpty(left, op, tctx);
  }
  if (right.type === "intersection" && left.type === "empty_set") {
    return translateIntersectionEmpty(right, op, tctx);
  }

  // Special case: function call intersection(a, b) != empty
  if (left.type === "function_call" && left.name === "intersection" && left.args.length === 2) {
    if (right.type === "identifier" && right.name === "empty") {
      return translateIntersectionFuncEmpty(left.args[0], left.args[1], op, tctx);
    }
    if (right.type === "empty_set") {
      return translateIntersectionFuncEmpty(left.args[0], left.args[1], op, tctx);
    }
  }

  // Special case: membership in array literal (x ∈ [a, b, c] written as x = "a" || ...)
  // handled by membership node type

  const l = astToZ3(left, tctx);
  const r = astToZ3(right, tctx);
  if (!l || !r) return null;

  try {
    const normOp = normalizeOp(op);
    switch (normOp) {
      case "<": return ctx.LT(l, r);
      case ">": return ctx.GT(l, r);
      case "<=": return ctx.LE(l, r);
      case ">=": return ctx.GE(l, r);
      case "=": return ctx.Eq(l, r);
      case "!=": return ctx.Not(ctx.Eq(l, r));
      default: return null;
    }
  } catch {
    // Sort mismatch
    return null;
  }
}

function normalizeOp(op: string): string {
  if (op === "≠") return "!=";
  if (op === "≤") return "<=";
  if (op === "≥") return ">=";
  if (op === "==") return "=";
  return op;
}

// ─── Membership ──────────────────────────────────────────────────────────────

function translateMembership(
  node: { type: "membership"; element: ASTNode; collection: ASTNode; negated: boolean },
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;

  // If collection is an array literal, unroll into OR of equalities
  if (node.collection.type === "array_literal") {
    const elem = astToZ3(node.element, tctx);
    if (!elem) return null;

    const elems = node.collection.elements;
    if (elems.length === 0) {
      return node.negated ? ctx.Bool.val(true) : ctx.Bool.val(false);
    }

    const eqParts: Z3Expr[] = [];
    for (const e of elems) {
      const z3e = astToZ3(e, tctx);
      if (!z3e) return null;
      try {
        eqParts.push(ctx.Eq(elem, z3e));
      } catch {
        return null;
      }
    }

    const membership = eqParts.length === 1 ? eqParts[0] : ctx.Or(...eqParts);
    return node.negated ? ctx.Not(membership) : membership;
  }

  // If collection is an identifier (variable list), use array theory
  const collName = resolveObjectName(node.collection);
  if (collName) {
    const elem = astToZ3(node.element, tctx);
    if (!elem) return null;

    const listInfo = getOrCreateListArray(collName, tctx);
    const memExpr = buildArrayMembership(elem, listInfo.array, listInfo.length, tctx);
    if (!memExpr) return null;

    return node.negated ? ctx.Not(memExpr) : memExpr;
  }

  return null;
}

// ─── Subset ──────────────────────────────────────────────────────────────────

function translateSubset(
  node: { type: "subset"; left: ASTNode; right: ASTNode },
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;
  const leftName = resolveObjectName(node.left);
  const rightName = resolveObjectName(node.right);

  if (leftName && rightName) {
    const leftList = getOrCreateListArray(leftName, tctx);
    const rightList = getOrCreateListArray(rightName, tctx);

    // ∀i: 0 ≤ i < leftLen → ∃j: 0 ≤ j < rightLen ∧ left[i] = right[j]
    // Use bounded unrolling with a reasonable bound (default 5)
    const bound = getBound(leftName, tctx, 5);

    const parts: Z3Expr[] = [];
    for (let idx = 0; idx < bound; idx++) {
      const elemI = leftList.array.select(ctx.Int.val(idx));
      const memExpr = buildArrayMembership(elemI, rightList.array, rightList.length, tctx);
      if (!memExpr) return null;
      // Only assert for indices within the actual length
      const inBounds = ctx.And(ctx.GE(ctx.Int.val(idx), ctx.Int.val(0)), ctx.LT(ctx.Int.val(idx), leftList.length));
      parts.push(ctx.Implies(inBounds, memExpr));
    }

    if (parts.length === 0) return ctx.Bool.val(true);
    if (parts.length === 1) return parts[0];
    return ctx.And(...parts);
  }

  // If left is an array literal
  if (node.left.type === "array_literal" && rightName) {
    const rightList = getOrCreateListArray(rightName, tctx);
    const parts: Z3Expr[] = [];
    for (const elem of node.left.elements) {
      const z3Elem = astToZ3(elem, tctx);
      if (!z3Elem) return null;
      const mem = buildArrayMembership(z3Elem, rightList.array, rightList.length, tctx);
      if (!mem) return null;
      parts.push(mem);
    }
    if (parts.length === 0) return ctx.Bool.val(true);
    if (parts.length === 1) return parts[0];
    return ctx.And(...parts);
  }

  return null;
}

// ─── Intersection ────────────────────────────────────────────────────────────

function translateIntersectionEmpty(
  intNode: { type: "intersection"; left: ASTNode; right: ASTNode },
  op: string,
  tctx: TranslationContext
): Z3Expr | null {
  return translateIntersectionFuncEmpty(intNode.left, intNode.right, op, tctx);
}

function translateIntersectionFuncEmpty(
  leftAST: ASTNode,
  rightAST: ASTNode,
  op: string,
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;
  const leftName = resolveObjectName(leftAST);
  const rightName = resolveObjectName(rightAST);

  if (!leftName || !rightName) return null;

  const leftList = getOrCreateListArray(leftName, tctx);
  const rightList = getOrCreateListArray(rightName, tctx);

  // a ∩ b = ∅ means: ∀i: 0≤i<lenA → a[i] ∉ b
  // Use bounded unrolling
  const bound = getBound(leftName, tctx, 5);
  const parts: Z3Expr[] = [];

  for (let idx = 0; idx < bound; idx++) {
    const elemI = leftList.array.select(ctx.Int.val(idx));
    const memInB = buildArrayMembership(elemI, rightList.array, rightList.length, tctx);
    if (!memInB) return null;
    const inBounds = ctx.LT(ctx.Int.val(idx), leftList.length);
    parts.push(ctx.Implies(inBounds, ctx.Not(memInB)));
  }

  const disjoint = parts.length === 0
    ? ctx.Bool.val(true)
    : parts.length === 1
      ? parts[0]
      : ctx.And(...parts);

  const normOp = normalizeOp(op);
  if (normOp === "=" || normOp === "==") return disjoint;
  if (normOp === "!=" || normOp === "≠") return ctx.Not(disjoint);

  return null;
}

// ─── Quantifiers ─────────────────────────────────────────────────────────────

function translateQuantifier(
  node: { variable: string; collection: ASTNode; predicate: ASTNode },
  isUniversal: boolean,
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;

  // If collection is an array literal, unroll
  if (node.collection.type === "array_literal") {
    return translateQuantifierLiteral(node, isUniversal, tctx);
  }

  // Collection is a variable (list) — use bounded unrolling with array theory
  const collName = resolveObjectName(node.collection);
  if (!collName) return null;

  const listInfo = getOrCreateListArray(collName, tctx);
  const bound = getBound(collName, tctx, 5);

  const parts: Z3Expr[] = [];
  for (let idx = 0; idx < bound; idx++) {
    const elemExpr = listInfo.array.select(ctx.Int.val(idx));
    const inBounds = ctx.And(
      ctx.GE(ctx.Int.val(idx), ctx.Int.val(0)),
      ctx.LT(ctx.Int.val(idx), listInfo.length)
    );

    // Create a child context with the quantifier variable bound to array element
    const savedVar = tctx.variables.get(node.variable);
    tctx.variables.set(node.variable, elemExpr);

    const pred = astToZ3(node.predicate, tctx);

    // Restore
    if (savedVar !== undefined) {
      tctx.variables.set(node.variable, savedVar);
    } else {
      tctx.variables.delete(node.variable);
    }

    if (!pred) return null;

    if (isUniversal) {
      // ∀: inBounds → pred
      parts.push(ctx.Implies(inBounds, pred));
    } else {
      // ∃: inBounds ∧ pred
      parts.push(ctx.And(inBounds, pred));
    }
  }

  if (parts.length === 0) {
    return ctx.Bool.val(isUniversal ? true : false);
  }

  if (isUniversal) {
    return parts.length === 1 ? parts[0] : ctx.And(...parts);
  } else {
    return parts.length === 1 ? parts[0] : ctx.Or(...parts);
  }
}

function translateQuantifierLiteral(
  node: { variable: string; collection: ASTNode; predicate: ASTNode },
  isUniversal: boolean,
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;
  if (node.collection.type !== "array_literal") return null;

  const elements = node.collection.elements;
  if (elements.length === 0) {
    return ctx.Bool.val(isUniversal ? true : false);
  }

  const parts: Z3Expr[] = [];
  for (const elem of elements) {
    const elemExpr = astToZ3(elem, tctx);
    if (!elemExpr) return null;

    // Bind quantifier variable
    const savedVar = tctx.variables.get(node.variable);
    tctx.variables.set(node.variable, elemExpr);

    const pred = astToZ3(node.predicate, tctx);

    if (savedVar !== undefined) {
      tctx.variables.set(node.variable, savedVar);
    } else {
      tctx.variables.delete(node.variable);
    }

    if (!pred) return null;
    parts.push(pred);
  }

  if (isUniversal) {
    return parts.length === 1 ? parts[0] : ctx.And(...parts);
  } else {
    return parts.length === 1 ? parts[0] : ctx.Or(...parts);
  }
}

// ─── Function Calls ──────────────────────────────────────────────────────────

function translateFunctionCall(
  node: { type: "function_call"; name: string; args: ASTNode[] },
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;

  // intersection(a, b) — returns null (must be in comparison context)
  if (node.name === "intersection" && node.args.length === 2) {
    return null;
  }

  // is_sorted(list)
  if (node.name === "is_sorted" && node.args.length === 1) {
    const listName = resolveObjectName(node.args[0]);
    if (listName) return translateIsSorted(listName, tctx);
    return getOrCreateBoolVariable(`is_sorted_${tctx.counter.value++}`, tctx);
  }

  // has_duplicates(list) → !distinct
  if (node.name === "has_duplicates" && node.args.length === 1) {
    const listName = resolveObjectName(node.args[0]);
    if (listName) {
      const d = translateDistinct(listName, tctx);
      return d ? ctx.Not(d) : null;
    }
  }

  // is_lowercase(s), is_trimmed(s)
  if ((node.name === "is_lowercase" || node.name === "is_trimmed") && node.args.length === 1) {
    const argName = resolveObjectName(node.args[0]);
    const boolName = argName ? `${argName}_${node.name}` : `${node.name}_${tctx.counter.value++}`;
    return getOrCreateBoolVariable(boolName, tctx);
  }

  // length(x), count(x)
  if ((node.name === "length" || node.name === "count") && node.args.length === 1) {
    const argName = resolveObjectName(node.args[0]);
    if (argName) {
      const listInfo = getOrCreateListArray(argName, tctx);
      return listInfo.length;
    }
  }

  // sum(list) — model as an int constant (can't compute arbitrary sums)
  if (node.name === "sum" && node.args.length === 1) {
    const argName = resolveObjectName(node.args[0]);
    const varName = argName ? `${argName}_sum` : `sum_${tctx.counter.value++}`;
    return getOrCreateIntVariable(varName, tctx);
  }

  // min(list), max(list)
  if ((node.name === "min" || node.name === "max") && node.args.length === 1) {
    const argName = resolveObjectName(node.args[0]);
    const varName = argName ? `${argName}_${node.name}` : `${node.name}_${tctx.counter.value++}`;
    return getOrCreateIntVariable(varName, tctx);
  }

  // contains(haystack, needle), includes(list, elem)
  if ((node.name === "contains" || node.name === "includes") && node.args.length === 2) {
    const boolName = `${node.name}_${tctx.counter.value++}`;
    return getOrCreateBoolVariable(boolName, tctx);
  }

  // forall(variable, collection, predicate) — old function-call style
  if (node.name === "forall" && node.args.length === 3) {
    return translateForallFunc(node.args, tctx);
  }

  // Default: model as an uninterpreted boolean constant
  const boolName = `fn_${node.name}_${tctx.counter.value++}`;
  return getOrCreateBoolVariable(boolName, tctx);
}

/**
 * Handle old-style forall(p, recommended, p not_in purchases) calls.
 * The lexer/parser may parse this as a function call with identifiers.
 */
function translateForallFunc(
  args: ASTNode[],
  tctx: TranslationContext
): Z3Expr | null {
  // forall(variable_name, collection, predicate_expr)
  // Args[0] = identifier (bound variable)
  // Args[1] = identifier (collection)
  // Args[2] = predicate expression (may contain the bound variable)
  if (args[0].type !== "identifier") return null;
  const variable = args[0].name;

  return translateQuantifier(
    { variable, collection: args[1], predicate: args[2] },
    true,
    tctx
  );
}

// ─── Property Predicates ─────────────────────────────────────────────────────

function translateDistinct(listName: string, tctx: TranslationContext): Z3Expr | null {
  const { ctx } = tctx;
  const listInfo = getOrCreateListArray(listName, tctx);
  const bound = getBound(listName, tctx, 5);

  // For bounded lists: And over all i<j pairs: list[i] ≠ list[j] (when both in bounds)
  const parts: Z3Expr[] = [];
  for (let i = 0; i < bound; i++) {
    for (let j = i + 1; j < bound; j++) {
      const elemI = listInfo.array.select(ctx.Int.val(i));
      const elemJ = listInfo.array.select(ctx.Int.val(j));
      const bothInBounds = ctx.And(
        ctx.LT(ctx.Int.val(i), listInfo.length),
        ctx.LT(ctx.Int.val(j), listInfo.length)
      );
      parts.push(ctx.Implies(bothInBounds, ctx.Not(ctx.Eq(elemI, elemJ))));
    }
  }

  if (parts.length === 0) return ctx.Bool.val(true);
  if (parts.length === 1) return parts[0];
  return ctx.And(...parts);
}

function translateIsSorted(listName: string, tctx: TranslationContext): Z3Expr | null {
  const { ctx } = tctx;
  const listInfo = getOrCreateListArray(listName, tctx);
  const bound = getBound(listName, tctx, 5);

  // And(list[0] <= list[1], list[1] <= list[2], ...) when both in bounds
  const parts: Z3Expr[] = [];
  for (let i = 0; i < bound - 1; i++) {
    const elemI = listInfo.array.select(ctx.Int.val(i));
    const elemJ = listInfo.array.select(ctx.Int.val(i + 1));
    const bothInBounds = ctx.And(
      ctx.LT(ctx.Int.val(i), listInfo.length),
      ctx.LT(ctx.Int.val(i + 1), listInfo.length)
    );
    parts.push(ctx.Implies(bothInBounds, ctx.LE(elemI, elemJ)));
  }

  if (parts.length === 0) return ctx.Bool.val(true);
  if (parts.length === 1) return parts[0];
  return ctx.And(...parts);
}

// ─── Array Theory Helpers ────────────────────────────────────────────────────

function buildArrayMembership(
  element: Z3Expr,
  array: Z3Expr,
  length: Z3Expr,
  tctx: TranslationContext
): Z3Expr | null {
  const { ctx } = tctx;

  // ∃i: 0 ≤ i < length ∧ array[i] = element
  // Bounded unrolling with default bound
  const bound = 5;
  const parts: Z3Expr[] = [];

  for (let idx = 0; idx < bound; idx++) {
    try {
      const elemAtIdx = array.select(ctx.Int.val(idx));
      const inBounds = ctx.LT(ctx.Int.val(idx), length);
      parts.push(ctx.And(inBounds, ctx.Eq(elemAtIdx, element)));
    } catch {
      return null;
    }
  }

  if (parts.length === 0) return ctx.Bool.val(false);
  if (parts.length === 1) return parts[0];
  return ctx.Or(...parts);
}

function getOrCreateListArray(
  name: string,
  tctx: TranslationContext
): { array: Z3Expr; length: Z3Expr } {
  const existing = tctx.listArrays.get(name);
  if (existing) return existing;

  const { ctx } = tctx;
  const arraySort = ctx.Array.sort(ctx.Int.sort(), ctx.Int.sort());
  const array = ctx.Const(name + "_arr", arraySort);
  const length = ctx.Int.const(name + "_length");

  const info = { array, length };
  tctx.listArrays.set(name, info);
  return info;
}

function getBound(listName: string, tctx: TranslationContext, defaultBound: number): number {
  // Check annotations for range info
  const ann = tctx.annotations.get(listName);
  if (ann?.range) {
    return Math.min(ann.range[1], 5); // Cap at 5 to avoid explosion
  }
  if (ann?.constraint) {
    // Try to extract "size in N..M" bounds
    const match = ann.constraint.match(/size\s+in\s+(\d+)\.\.(\d+)/);
    if (match) {
      return Math.min(parseInt(match[2], 10), 5);
    }
  }
  return defaultBound;
}

// ─── Variable Helpers ────────────────────────────────────────────────────────

function getOrCreateVariable(name: string, tctx: TranslationContext): Z3Expr {
  const existing = tctx.variables.get(name);
  if (existing) return existing;

  const { ctx } = tctx;
  // Infer type from annotations
  const ann = tctx.annotations.get(name);
  let z3Var: Z3Expr;

  if (ann) {
    const t = ann.type;
    if (t === "Bool" || t === "Boolean") {
      z3Var = ctx.Bool.const(name);
    } else if (t === "Float64" || t === "Float32" || t === "Float") {
      z3Var = ctx.Real.const(name);
    } else if (t === "String") {
      z3Var = ctx.Int.const(name); // Model strings as ints
    } else if (t.startsWith("List") || t.startsWith("Array") || t.startsWith("Set")) {
      // For list-typed variables, return the length (most common use)
      const listInfo = getOrCreateListArray(name, tctx);
      tctx.variables.set(name, listInfo.length);
      return listInfo.length;
    } else {
      z3Var = ctx.Int.const(name);
    }
  } else {
    z3Var = ctx.Int.const(name);
  }

  tctx.variables.set(name, z3Var);
  return z3Var;
}

function getOrCreateIntVariable(name: string, tctx: TranslationContext): Z3Expr {
  const existing = tctx.variables.get(name);
  if (existing) return existing;
  const z3Var = tctx.ctx.Int.const(name);
  tctx.variables.set(name, z3Var);
  return z3Var;
}

function getOrCreateBoolVariable(name: string, tctx: TranslationContext): Z3Expr {
  const existing = tctx.variables.get(name);
  if (existing) return existing;
  const z3Var = tctx.ctx.Bool.const(name);
  tctx.variables.set(name, z3Var);
  return z3Var;
}

/** Map string literals to unique integer constants for Z3 equality comparison */
const stringLiteralMap = new Map<string, number>();
let nextStringId = 1000;

function getOrCreateStringConst(value: string, tctx: TranslationContext): Z3Expr {
  if (!stringLiteralMap.has(value)) {
    stringLiteralMap.set(value, nextStringId++);
  }
  return tctx.ctx.Int.val(stringLiteralMap.get(value)!);
}
