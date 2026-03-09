/**
 * AETHER Implementations — Registry & Lookup
 *
 * Exports all core implementations with metadata.
 * Provides lookup by node ID pattern or type signature.
 */

import type { RegisteredImplementation } from "./types.js";
import { validateEmail, normalizeString, formatCheck, stringContains, stringTransform } from "./strings.js";
import { sortAscending, filterPredicate, deduplicate, aggregate, mapTransform, listOperations } from "./collections.js";
import { createRecord, mergeRecords, extractFields, validateRecord } from "./records.js";
import { calculate, compare, conditional } from "./arithmetic.js";

// ─── Implementation Registry ────────────────────────────────────────────────

const implementations: RegisteredImplementation[] = [
  // String operations
  {
    meta: {
      id: "validate_email",
      description: "Validate email format and normalize",
      inputTypes: { email: "String" },
      outputTypes: { valid: "Bool", normalized: "String" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: validateEmail,
  },
  {
    meta: {
      id: "normalize_string",
      description: "Lowercase and trim a string",
      inputTypes: { value: "String" },
      outputTypes: { normalized: "String" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: normalizeString,
  },
  {
    meta: {
      id: "format_check",
      description: "Validate a string against a known format",
      inputTypes: { value: "String", format: "String" },
      outputTypes: { valid: "Bool" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: formatCheck,
  },
  {
    meta: {
      id: "string_contains",
      description: "Check if a string contains a substring",
      inputTypes: { haystack: "String", needle: "String" },
      outputTypes: { found: "Bool" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: stringContains,
  },
  {
    meta: {
      id: "string_transform",
      description: "Transform a string (lowercase, uppercase, trim, reverse, slug)",
      inputTypes: { value: "String", operation: "String" },
      outputTypes: { result: "String" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: stringTransform,
  },

  // Collection operations
  {
    meta: {
      id: "sort_ascending",
      description: "Sort a collection in ascending order",
      inputTypes: { data: "List" },
      outputTypes: { sorted: "List" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: sortAscending,
  },
  {
    meta: {
      id: "filter_predicate",
      description: "Filter a list by a predicate condition",
      inputTypes: { data: "List", field: "String", operator: "String", value: "Any" },
      outputTypes: { filtered: "List" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: filterPredicate,
  },
  {
    meta: {
      id: "deduplicate",
      description: "Remove duplicate elements from a list",
      inputTypes: { data: "List" },
      outputTypes: { unique: "List" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: deduplicate,
  },
  {
    meta: {
      id: "aggregate",
      description: "Compute aggregations (sum, avg, min, max, count) on a list",
      inputTypes: { data: "List", operations: "List" },
      outputTypes: { result: "List" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: aggregate,
  },
  {
    meta: {
      id: "map_transform",
      description: "Transform each element in a list",
      inputTypes: { data: "List", transformations: "Record" },
      outputTypes: { mapped: "List" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: mapTransform,
  },
  {
    meta: {
      id: "list_operations",
      description: "Common list queries (length, first, last, reverse, flatten, take, skip)",
      inputTypes: { data: "List", operation: "String" },
      outputTypes: { result: "Any" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: listOperations,
  },

  // Record operations
  {
    meta: {
      id: "create_record",
      description: "Construct a record from fields with optional defaults",
      inputTypes: { fields: "Record" },
      outputTypes: { record: "Record" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: createRecord,
  },
  {
    meta: {
      id: "merge_records",
      description: "Deep merge two records with override priority",
      inputTypes: { base: "Record", override: "Record" },
      outputTypes: { merged: "Record" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: mergeRecords,
  },
  {
    meta: {
      id: "extract_fields",
      description: "Pick specific fields from a record",
      inputTypes: { record: "Record", fields: "List" },
      outputTypes: { extracted: "Record" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: extractFields,
  },
  {
    meta: {
      id: "validate_record",
      description: "Check a record against expected shape",
      inputTypes: { record: "Record", required_fields: "List" },
      outputTypes: { valid: "Bool", missing_fields: "List", type_errors: "List" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: validateRecord,
  },

  // Arithmetic/logic operations
  {
    meta: {
      id: "calculate",
      description: "Evaluate arithmetic expressions on numeric inputs",
      inputTypes: { values: "Record", expression: "String" },
      outputTypes: { result: "Number" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: calculate,
  },
  {
    meta: {
      id: "compare",
      description: "Compare two values with a typed result",
      inputTypes: { left: "Any", right: "Any", operator: "String" },
      outputTypes: { result: "Bool" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: compare,
  },
  {
    meta: {
      id: "conditional",
      description: "If/then/else logic",
      inputTypes: { condition: "Bool", if_true: "Any", if_false: "Any" },
      outputTypes: { result: "Any" },
      effects: [],
      pure: true,
      deterministic: true,
    },
    fn: conditional,
  },
];

// ─── Lookup Functions ────────────────────────────────────────────────────────

export function getCoreImplementations(): RegisteredImplementation[] {
  return [...implementations];
}

export function findImplementation(nodeId: string): RegisteredImplementation | null {
  // Exact match first
  const exact = implementations.find((impl) => impl.meta.id === nodeId);
  if (exact) return exact;

  // Pattern match: node ID contains the implementation ID (e.g., "scope_validate_email" matches "validate_email")
  const pattern = implementations.find((impl) => nodeId.includes(impl.meta.id));
  return pattern ?? null;
}

export function findBySignature(
  inputTypes: Record<string, string>,
  outputTypes: Record<string, string>,
): RegisteredImplementation[] {
  return implementations.filter((impl) => {
    // Check that all required input types are present
    for (const [name, type] of Object.entries(inputTypes)) {
      if (!(name in impl.meta.inputTypes)) return false;
      if (impl.meta.inputTypes[name] !== type && impl.meta.inputTypes[name] !== "Any") return false;
    }
    // Check that all required output types are present
    for (const [name, type] of Object.entries(outputTypes)) {
      if (!(name in impl.meta.outputTypes)) return false;
      if (impl.meta.outputTypes[name] !== type && impl.meta.outputTypes[name] !== "Any") return false;
    }
    return true;
  });
}

// Re-export types
export type { NodeImplementation, ImplementationContext, ImplementationMeta, RegisteredImplementation } from "./types.js";
