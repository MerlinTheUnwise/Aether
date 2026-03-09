/**
 * AETHER Implementations — Record/Object Operations
 *
 * Real record manipulation: creation, deep merge, field extraction,
 * and shape validation.
 */

import type { NodeImplementation } from "./types.js";

// ─── Create Record ───────────────────────────────────────────────────────────

export const createRecord: NodeImplementation = async (inputs) => {
  const fields = inputs.fields as Record<string, any> ?? {};
  const defaults = inputs.defaults as Record<string, any> ?? {};

  const record: Record<string, any> = { ...defaults, ...fields };
  return { record };
};

// ─── Merge Records (deep) ────────────────────────────────────────────────────

function deepMerge(base: any, override: any): any {
  if (
    typeof base !== "object" || base === null ||
    typeof override !== "object" || override === null ||
    Array.isArray(base) || Array.isArray(override)
  ) {
    return override;
  }

  const result: Record<string, any> = { ...base };
  for (const key of Object.keys(override)) {
    if (key in result && typeof result[key] === "object" && typeof override[key] === "object" &&
        !Array.isArray(result[key]) && !Array.isArray(override[key]) &&
        result[key] !== null && override[key] !== null) {
      result[key] = deepMerge(result[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

export const mergeRecords: NodeImplementation = async (inputs) => {
  const base = inputs.base as Record<string, any> ?? {};
  const override = inputs.override as Record<string, any> ?? {};

  return { merged: deepMerge(base, override) };
};

// ─── Extract Fields ──────────────────────────────────────────────────────────

export const extractFields: NodeImplementation = async (inputs) => {
  const record = inputs.record as Record<string, any> ?? {};
  const fields = inputs.fields as string[] ?? [];

  const extracted: Record<string, any> = {};
  for (const f of fields) {
    if (f in record) {
      extracted[f] = record[f];
    }
  }

  return { extracted };
};

// ─── Validate Record ─────────────────────────────────────────────────────────

const TYPE_CHECKS: Record<string, (v: any) => boolean> = {
  string: (v) => typeof v === "string",
  String: (v) => typeof v === "string",
  number: (v) => typeof v === "number",
  Number: (v) => typeof v === "number",
  boolean: (v) => typeof v === "boolean",
  Bool: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  Record: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  List: (v) => Array.isArray(v),
};

export const validateRecord: NodeImplementation = async (inputs) => {
  const record = inputs.record as Record<string, any> ?? {};
  const requiredFields = inputs.required_fields as string[] ?? [];
  const fieldTypes = inputs.field_types as Record<string, string> | undefined;

  const missingFields: string[] = [];
  const typeErrors: string[] = [];

  for (const f of requiredFields) {
    if (!(f in record)) {
      missingFields.push(f);
    }
  }

  if (fieldTypes) {
    for (const [f, expectedType] of Object.entries(fieldTypes)) {
      if (f in record) {
        const check = TYPE_CHECKS[expectedType];
        if (check && !check(record[f])) {
          typeErrors.push(`${f}: expected ${expectedType}, got ${typeof record[f]}`);
        }
      }
    }
  }

  return {
    valid: missingFields.length === 0 && typeErrors.length === 0,
    missing_fields: missingFields,
    type_errors: typeErrors,
  };
};
