/**
 * AETHER Implementations — String Operations
 *
 * Real string manipulation functions: validation, normalization, format checks,
 * substring search, and transformations.
 */

import type { NodeImplementation } from "./types.js";

// ─── Email Validation ────────────────────────────────────────────────────────

export const validateEmail: NodeImplementation = async (inputs) => {
  const email = String(inputs.email ?? "");
  const normalized = email.toLowerCase().trim();

  // Basic structural check: local@domain.tld
  const atIndex = normalized.indexOf("@");
  if (atIndex < 1) return { valid: false, normalized };

  const domain = normalized.slice(atIndex + 1);
  if (!domain || !domain.includes(".")) return { valid: false, normalized };

  const dotIndex = domain.lastIndexOf(".");
  const tld = domain.slice(dotIndex + 1);
  if (tld.length < 2) return { valid: false, normalized };

  // No consecutive dots, no leading/trailing dots in local part
  const local = normalized.slice(0, atIndex);
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { valid: false, normalized };
  }

  return { valid: true, normalized };
};

// ─── String Normalization ────────────────────────────────────────────────────

export const normalizeString: NodeImplementation = async (inputs) => {
  const value = String(inputs.value ?? "");
  return { normalized: value.toLowerCase().trim() };
};

// ─── Format Check ────────────────────────────────────────────────────────────

const FORMAT_PATTERNS: Record<string, { pattern: RegExp; description: string }> = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    description: "email address",
  },
  uuid: {
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    description: "UUID",
  },
  uuid_v4: {
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    description: "UUID v4",
  },
  jwt: {
    pattern: /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    description: "JWT token",
  },
};

export const formatCheck: NodeImplementation = async (inputs) => {
  const value = String(inputs.value ?? "");
  const format = String(inputs.format ?? "");

  const spec = FORMAT_PATTERNS[format];
  if (!spec) {
    return { valid: false, error: `Unknown format: ${format}` };
  }

  const valid = spec.pattern.test(value);
  return valid ? { valid: true } : { valid: false, error: `Value does not match ${spec.description} format` };
};

// ─── String Contains ─────────────────────────────────────────────────────────

export const stringContains: NodeImplementation = async (inputs) => {
  const haystack = String(inputs.haystack ?? "");
  const needle = String(inputs.needle ?? "");
  return { found: haystack.includes(needle) };
};

// ─── String Transform ────────────────────────────────────────────────────────

export const stringTransform: NodeImplementation = async (inputs) => {
  const value = String(inputs.value ?? "");
  const operation = String(inputs.operation ?? "");

  switch (operation) {
    case "lowercase":
      return { result: value.toLowerCase() };
    case "uppercase":
      return { result: value.toUpperCase() };
    case "trim":
      return { result: value.trim() };
    case "reverse":
      return { result: [...value].reverse().join("") };
    case "slug":
      return {
        result: value
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/[\s_]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, ""),
      };
    default:
      throw new Error(`Unknown string operation: ${operation}`);
  }
};
