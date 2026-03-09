/**
 * AETHER Implementations — Arithmetic/Logic Operations
 *
 * Real computation: expression evaluation, comparison, and conditional logic.
 */

import type { NodeImplementation } from "./types.js";

// ─── Calculate ───────────────────────────────────────────────────────────────

export const calculate: NodeImplementation = async (inputs) => {
  const values = inputs.values as Record<string, number> ?? {};
  const expression = String(inputs.expression ?? "");

  // Build a safe evaluator using the provided variable names and values
  const keys = Object.keys(values);
  const vals = keys.map((k) => values[k]);

  // Validate expression only contains safe characters
  const safeExpr = expression.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, ""); // strip identifiers
  if (/[^0-9+\-*/%().&|^~<>=!?\s,]/.test(safeExpr)) {
    throw new Error(`Unsafe expression: ${expression}`);
  }

  try {
    const fn = new Function(...keys, `"use strict"; return (${expression});`);
    const result = fn(...vals);
    if (typeof result !== "number" || !isFinite(result)) {
      throw new Error(`Expression did not produce a finite number: ${result}`);
    }
    return { result };
  } catch (e: any) {
    throw new Error(`Failed to evaluate expression "${expression}": ${e.message}`);
  }
};

// ─── Compare ─────────────────────────────────────────────────────────────────

export const compare: NodeImplementation = async (inputs) => {
  const left = inputs.left;
  const right = inputs.right;
  const operator = String(inputs.operator ?? "");

  let result: boolean;
  switch (operator) {
    case "=":
    case "==":
      result = left === right;
      break;
    case "!=":
      result = left !== right;
      break;
    case ">":
      result = left > right;
      break;
    case "<":
      result = left < right;
      break;
    case ">=":
      result = left >= right;
      break;
    case "<=":
      result = left <= right;
      break;
    default:
      throw new Error(`Unknown comparison operator: ${operator}`);
  }

  return { result };
};

// ─── Conditional ─────────────────────────────────────────────────────────────

export const conditional: NodeImplementation = async (inputs) => {
  const condition = Boolean(inputs.condition);
  return { result: condition ? inputs.if_true : inputs.if_false };
};
