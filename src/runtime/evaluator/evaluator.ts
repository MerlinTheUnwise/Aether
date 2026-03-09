// Expression Evaluator for AETHER contract expressions
// Walks the AST and produces a result — never silently passes

import { ASTNode } from "./parser.js";

export interface EvalContext {
  variables: Record<string, any>;
  functions: Record<string, Function>;
}

export interface EvalResult {
  value: any;
  success: boolean;
  warnings: string[];
  error?: string;
}

export const builtinFunctions: Record<string, Function> = {
  length: (x: any) => x?.length ?? 0,
  is_sorted: (list: any[]) => {
    if (!Array.isArray(list)) return false;
    for (let i = 1; i < list.length; i++) {
      if (list[i] < list[i - 1]) return false;
    }
    return true;
  },
  has_duplicates: (list: any[]) => {
    if (!Array.isArray(list)) return false;
    return new Set(list).size !== list.length;
  },
  is_lowercase: (s: string) => typeof s === "string" && s === s.toLowerCase(),
  is_trimmed: (s: string) => typeof s === "string" && s === s.trim(),
  is_empty: (x: any) => Array.isArray(x) ? x.length === 0 : !x,
  sum: (list: number[]) => Array.isArray(list) ? list.reduce((a, b) => a + b, 0) : 0,
  min: (list: number[]) => Array.isArray(list) && list.length > 0 ? Math.min(...list) : 0,
  max: (list: number[]) => Array.isArray(list) && list.length > 0 ? Math.max(...list) : 0,
  count: (list: any[]) => Array.isArray(list) ? list.length : 0,
  unique: (list: any[]) => Array.isArray(list) ? [...new Set(list)] : [],
  contains: (haystack: string, needle: string) => typeof haystack === "string" && haystack.includes(needle),
  includes: (list: any, elem: any) => {
    if (Array.isArray(list)) return list.includes(elem);
    if (typeof list === "string") return list.includes(elem);
    return false;
  },
};

export function evaluate(ast: ASTNode, context: EvalContext): EvalResult {
  const warnings: string[] = [];

  function eval_(node: ASTNode): any {
    switch (node.type) {
      case "literal":
        return node.value;

      case "empty_set":
        return [];

      case "identifier":
        return resolveIdentifier(node.name, context.variables, warnings);

      case "property_access": {
        const obj = eval_(node.object);
        if (obj === undefined || obj === null) {
          throw new EvalError_(`Cannot access property "${node.property}" of ${obj}`);
        }
        return resolveProperty(obj, node.property);
      }

      case "comparison": {
        const left = eval_(node.left);
        const right = eval_(node.right);
        return compare(node.op, left, right);
      }

      case "chained_comparison": {
        for (const comp of node.comparisons) {
          const left = eval_(comp.left);
          const right = eval_(comp.right);
          if (!compare(comp.op, left, right)) return false;
        }
        return true;
      }

      case "logical": {
        if (node.op === "and") {
          const left = eval_(node.left);
          if (!left) return false; // short-circuit
          return !!eval_(node.right);
        }
        if (node.op === "or") {
          const left = eval_(node.left);
          if (left) return true; // short-circuit
          return !!eval_(node.right);
        }
        if (node.op === "implies") {
          const left = eval_(node.left);
          if (!left) return true; // false → anything = true
          return !!eval_(node.right);
        }
        throw new EvalError_(`Unknown logical op: ${node.op}`);
      }

      case "not":
        return !eval_(node.operand);

      case "membership": {
        const element = eval_(node.element);
        const collection = eval_(node.collection);
        if (!Array.isArray(collection)) {
          throw new EvalError_(`Membership check requires array, got ${typeof collection}`);
        }
        const found = collection.some(item => deepEqual(item, element));
        return node.negated ? !found : found;
      }

      case "subset": {
        const left = eval_(node.left);
        const right = eval_(node.right);
        if (!Array.isArray(left) || !Array.isArray(right)) {
          throw new EvalError_(`Subset check requires arrays`);
        }
        return left.every(item => right.some(r => deepEqual(r, item)));
      }

      case "intersection": {
        const left = eval_(node.left);
        const right = eval_(node.right);
        if (!Array.isArray(left) || !Array.isArray(right)) {
          throw new EvalError_(`Intersection requires arrays`);
        }
        return left.filter(item => right.some(r => deepEqual(r, item)));
      }

      case "forall": {
        const collection = eval_(node.collection);
        if (!Array.isArray(collection)) {
          throw new EvalError_(`∀ requires array, got ${typeof collection}`);
        }
        for (const item of collection) {
          const childCtx: EvalContext = {
            variables: { ...context.variables, [node.variable]: item },
            functions: context.functions,
          };
          const result = evaluate(node.predicate, childCtx);
          if (!result.success) throw new EvalError_(result.error ?? "Quantifier predicate failed");
          if (!result.value) return false;
        }
        return true;
      }

      case "exists": {
        const collection = eval_(node.collection);
        if (!Array.isArray(collection)) {
          throw new EvalError_(`∃ requires array, got ${typeof collection}`);
        }
        for (const item of collection) {
          const childCtx: EvalContext = {
            variables: { ...context.variables, [node.variable]: item },
            functions: context.functions,
          };
          const result = evaluate(node.predicate, childCtx);
          if (!result.success) throw new EvalError_(result.error ?? "Quantifier predicate failed");
          if (result.value) return true;
        }
        return false;
      }

      case "array_literal":
        return node.elements.map(e => eval_(e));

      case "function_call": {
        const fn = context.functions[node.name];
        if (!fn) {
          warnings.push(`Unknown function: ${node.name}`);
          throw new EvalError_(`Unknown function: ${node.name}`);
        }
        const args = node.args.map(a => eval_(a));
        return fn(...args);
      }

      case "binary_op": {
        const left = eval_(node.left);
        const right = eval_(node.right);
        if (node.op === "+") {
          if (typeof left === "number" && typeof right === "number") return left + right;
          if (typeof left === "string" && typeof right === "string") return left + right;
          throw new EvalError_(`Cannot add ${typeof left} and ${typeof right}`);
        }
        if (node.op === "-") {
          if (typeof left !== "number" || typeof right !== "number") throw new EvalError_(`Cannot subtract non-numbers`);
          return left - right;
        }
        if (node.op === "*") {
          if (typeof left !== "number" || typeof right !== "number") throw new EvalError_(`Cannot multiply non-numbers`);
          return left * right;
        }
        if (node.op === "/") {
          if (typeof left !== "number" || typeof right !== "number") throw new EvalError_(`Cannot divide non-numbers`);
          if (right === 0) throw new EvalError_(`Division by zero`);
          return left / right;
        }
        throw new EvalError_(`Unknown binary op: ${node.op}`);
      }

      case "unary_op": {
        if (node.op === "-") {
          const operand = eval_(node.operand);
          if (typeof operand !== "number") throw new EvalError_(`Cannot negate non-number`);
          return -operand;
        }
        throw new EvalError_(`Unknown unary op: ${node.op}`);
      }

      default:
        throw new EvalError_(`Unknown AST node type: ${(node as any).type}`);
    }
  }

  try {
    const value = eval_(ast);
    return { value, success: true, warnings };
  } catch (e) {
    if (e instanceof EvalError_) {
      return { value: undefined, success: false, warnings, error: e.message };
    }
    return { value: undefined, success: false, warnings, error: String(e) };
  }
}

class EvalError_ extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalError";
  }
}

function resolveIdentifier(name: string, variables: Record<string, any>, warnings: string[]): any {
  if (name in variables) {
    return variables[name];
  }
  // Check dotted path (identifiers don't contain dots after lexer, but check nested)
  throw new EvalError_(`Undefined variable: ${name}`);
}

function resolveProperty(obj: any, property: string): any {
  // Built-in property accessors
  if (property === "length") {
    if (typeof obj === "string" || Array.isArray(obj)) return obj.length;
    return obj?.length;
  }
  if (property === "is_lowercase") {
    if (typeof obj === "string") return obj === obj.toLowerCase();
    return false;
  }
  if (property === "is_trimmed") {
    if (typeof obj === "string") return obj === obj.trim();
    return false;
  }
  if (property === "distinct") {
    if (Array.isArray(obj)) return new Set(obj).size === obj.length;
    return false;
  }
  if (property === "is_sorted") {
    if (Array.isArray(obj)) {
      for (let i = 1; i < obj.length; i++) {
        if (obj[i] < obj[i - 1]) return false;
      }
      return true;
    }
    return false;
  }
  if (property === "has_duplicates") {
    if (Array.isArray(obj)) return new Set(obj).size !== obj.length;
    return false;
  }

  // Standard property access
  if (obj !== null && obj !== undefined && property in obj) {
    return obj[property];
  }
  return undefined;
}

function compare(op: string, left: any, right: any): boolean {
  // Handle empty set comparison (right is empty array from empty_set node)
  if (op === "=") {
    if (Array.isArray(left) && Array.isArray(right)) return deepEqual(left, right);
    // eslint-disable-next-line eqeqeq
    return left == right || left === right;
  }
  if (op === "≠") {
    if (Array.isArray(left) && Array.isArray(right)) return !deepEqual(left, right);
    // eslint-disable-next-line eqeqeq
    return left != right && left !== right;
  }
  if (op === "<") return left < right;
  if (op === ">") return left > right;
  if (op === "≤") return left <= right;
  if (op === "≥") return left >= right;
  return false;
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}
