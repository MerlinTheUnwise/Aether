/**
 * AETHER Implementations — Collection Operations
 *
 * Real collection manipulation: sort, filter, deduplicate, aggregate,
 * map/transform, and common list queries.
 */

import type { NodeImplementation } from "./types.js";

// ─── Sort Ascending ──────────────────────────────────────────────────────────

export const sortAscending: NodeImplementation = async (inputs) => {
  const data = Array.isArray(inputs.data) ? [...inputs.data] : [];
  const key = inputs.key as string | undefined;

  data.sort((a, b) => {
    const va = key ? a?.[key] : a;
    const vb = key ? b?.[key] : b;
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });

  return { sorted: data };
};

// ─── Filter Predicate ────────────────────────────────────────────────────────

export const filterPredicate: NodeImplementation = async (inputs) => {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  const field = inputs.field as string;
  const operator = inputs.operator as string;
  const value = inputs.value;

  const filtered = data.filter((item) => {
    const v = field ? item?.[field] : item;
    switch (operator) {
      case "=":
      case "==":
        return v === value;
      case "!=":
        return v !== value;
      case ">":
        return v > value;
      case "<":
        return v < value;
      case ">=":
        return v >= value;
      case "<=":
        return v <= value;
      case "in":
        return Array.isArray(value) && value.includes(v);
      case "not_in":
        return Array.isArray(value) && !value.includes(v);
      default:
        throw new Error(`Unknown filter operator: ${operator}`);
    }
  });

  return { filtered };
};

// ─── Deduplicate ─────────────────────────────────────────────────────────────

export const deduplicate: NodeImplementation = async (inputs) => {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  const key = inputs.key as string | undefined;

  const seen = new Set<any>();
  const unique: any[] = [];

  for (const item of data) {
    const k = key ? item?.[key] : item;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(item);
    }
  }

  return { unique };
};

// ─── Aggregate ───────────────────────────────────────────────────────────────

export const aggregate: NodeImplementation = async (inputs) => {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  const operations = inputs.operations as Array<{
    field: string;
    function: string;
    as: string;
  }>;
  const groupBy = inputs.group_by as string[] | undefined;

  // Group the data
  const groups = new Map<string, any[]>();
  if (groupBy && groupBy.length > 0) {
    for (const item of data) {
      const groupKey = groupBy.map((k) => String(item?.[k] ?? "")).join("|");
      const group = groups.get(groupKey) ?? [];
      group.push(item);
      groups.set(groupKey, group);
    }
  } else {
    groups.set("__all__", data);
  }

  // Compute aggregations per group
  const result: any[] = [];
  for (const [, groupData] of groups) {
    const record: Record<string, any> = {};

    // Include group keys
    if (groupBy && groupBy.length > 0 && groupData.length > 0) {
      for (const k of groupBy) {
        record[k] = groupData[0]?.[k];
      }
    }

    for (const op of operations) {
      const values = groupData.map((item) => item?.[op.field]).filter((v) => v !== undefined && v !== null);
      const nums = values.map(Number).filter((n) => !isNaN(n));

      switch (op.function) {
        case "sum":
          record[op.as] = nums.reduce((a, b) => a + b, 0);
          break;
        case "avg":
          record[op.as] = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
          break;
        case "min":
          record[op.as] = nums.length > 0 ? Math.min(...nums) : 0;
          break;
        case "max":
          record[op.as] = nums.length > 0 ? Math.max(...nums) : 0;
          break;
        case "count":
          record[op.as] = values.length;
          break;
        default:
          throw new Error(`Unknown aggregate function: ${op.function}`);
      }
    }

    result.push(record);
  }

  return { result };
};

// ─── Map Transform ───────────────────────────────────────────────────────────

export const mapTransform: NodeImplementation = async (inputs) => {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  const transformations = inputs.transformations as Record<string, string>;

  const mapped = data.map((item) => {
    const out: Record<string, any> = {};
    for (const [outField, expr] of Object.entries(transformations)) {
      // Simple field reference or expression evaluation
      if (typeof item === "object" && item !== null && expr in item) {
        out[outField] = item[expr];
      } else {
        // Try evaluating as a simple expression with item fields as variables
        try {
          const keys = typeof item === "object" && item !== null ? Object.keys(item) : [];
          const vals = keys.map((k) => item[k]);
          const fn = new Function(...keys, `return (${expr});`);
          out[outField] = fn(...vals);
        } catch {
          out[outField] = expr; // Fallback: treat as literal
        }
      }
    }
    return out;
  });

  return { mapped };
};

// ─── List Operations ─────────────────────────────────────────────────────────

export const listOperations: NodeImplementation = async (inputs) => {
  const data = Array.isArray(inputs.data) ? inputs.data : [];
  const operation = inputs.operation as string;
  const count = inputs.count as number | undefined;

  switch (operation) {
    case "length":
      return { result: data.length };
    case "first":
      return { result: data.length > 0 ? data[0] : null };
    case "last":
      return { result: data.length > 0 ? data[data.length - 1] : null };
    case "reverse":
      return { result: [...data].reverse() };
    case "flatten":
      return { result: data.flat() };
    case "take":
      return { result: data.slice(0, count ?? 0) };
    case "skip":
      return { result: data.slice(count ?? 0) };
    default:
      throw new Error(`Unknown list operation: ${operation}`);
  }
};
