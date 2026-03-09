/**
 * AETHER Semantic Type Checker
 * Walks every edge in an AetherGraph and verifies that source port TypeAnnotation
 * is compatible with destination port TypeAnnotation.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

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
  confidence?: number;
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

export interface CheckError {
  edge: string;
  code: "DIMENSION_MISMATCH" | "DOMAIN_MISMATCH" | "SENSITIVITY_VIOLATION" | "BASE_TYPE_MISMATCH";
  message: string;
}

export interface CheckWarning {
  edge: string;
  code: "UNIT_MISMATCH" | "CONSTRAINT_WARNING";
  message: string;
  suggestion?: string;
}

export interface CheckResult {
  compatible: boolean;
  errors: CheckError[];
  warnings: CheckWarning[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

/** Base types that are considered equivalent for compatibility */
const numericTypes = new Set(["Int", "Float64", "Float32", "Number"]);

function baseTypesCompatible(fromType: string, toType: string): boolean {
  if (fromType === toType) return true;
  // Numeric types are coercible between each other
  if (numericTypes.has(fromType) && numericTypes.has(toType)) return true;
  return false;
}

// ─── Core check ───────────────────────────────────────────────────────────────

function checkEdge(
  fromAnnotation: TypeAnnotation,
  toAnnotation: TypeAnnotation,
  edgeLabel: string
): { errors: CheckError[]; warnings: CheckWarning[] } {
  const errors: CheckError[] = [];
  const warnings: CheckWarning[] = [];

  // Base type mismatch — check first since other checks are meaningless if types differ
  if (!baseTypesCompatible(fromAnnotation.type, toAnnotation.type)) {
    errors.push({
      edge: edgeLabel,
      code: "BASE_TYPE_MISMATCH",
      message: `base type mismatch: ${fromAnnotation.type} → ${toAnnotation.type}`,
    });
    return { errors, warnings }; // no point checking annotations on incompatible base types
  }

  // Dimension mismatch
  if (
    fromAnnotation.dimension !== undefined &&
    toAnnotation.dimension !== undefined &&
    fromAnnotation.dimension !== toAnnotation.dimension
  ) {
    errors.push({
      edge: edgeLabel,
      code: "DIMENSION_MISMATCH",
      message: `dimension mismatch: ${fromAnnotation.dimension} → ${toAnnotation.dimension}`,
    });
  }

  // Unit mismatch (only relevant when dimensions match or aren't specified)
  if (
    fromAnnotation.unit !== undefined &&
    toAnnotation.unit !== undefined &&
    fromAnnotation.unit !== toAnnotation.unit
  ) {
    // Only warn if dimensions are compatible (both same or at least one undefined)
    const dimensionsOk =
      fromAnnotation.dimension === undefined ||
      toAnnotation.dimension === undefined ||
      fromAnnotation.dimension === toAnnotation.dimension;

    if (dimensionsOk) {
      warnings.push({
        edge: edgeLabel,
        code: "UNIT_MISMATCH",
        message: `unit mismatch: ${fromAnnotation.unit} → ${toAnnotation.unit} (auto-convert available)`,
        suggestion: `auto-convert ${fromAnnotation.unit} → ${toAnnotation.unit}`,
      });
    }
  }

  // Domain mismatch
  if (
    fromAnnotation.domain !== undefined &&
    toAnnotation.domain !== undefined &&
    fromAnnotation.domain !== toAnnotation.domain
  ) {
    errors.push({
      edge: edgeLabel,
      code: "DOMAIN_MISMATCH",
      message: `domain mismatch: ${fromAnnotation.domain} → ${toAnnotation.domain}`,
    });
  }

  // Sensitivity escalation: pii → public is a hard error
  if (fromAnnotation.sensitivity === "pii" && toAnnotation.sensitivity === "public") {
    errors.push({
      edge: edgeLabel,
      code: "SENSITIVITY_VIOLATION",
      message: `sensitivity violation: pii data flowing to public scope`,
    });
  }

  // Constraint check
  if (toAnnotation.constraint !== undefined) {
    // If source has a confidence value, check if it satisfies the constraint
    if (fromAnnotation.confidence !== undefined) {
      const constraintMatch = toAnnotation.constraint.match(/^([><=!]+)\s*([\d.]+)$/);
      if (constraintMatch) {
        const op = constraintMatch[1];
        const threshold = parseFloat(constraintMatch[2]);
        const val = fromAnnotation.confidence;
        let satisfied = true;
        if (op === ">" && !(val > threshold)) satisfied = false;
        if (op === ">=" && !(val >= threshold)) satisfied = false;
        if (op === "<" && !(val < threshold)) satisfied = false;
        if (op === "<=" && !(val <= threshold)) satisfied = false;

        if (!satisfied) {
          warnings.push({
            edge: edgeLabel,
            code: "CONSTRAINT_WARNING",
            message: `constraint "${toAnnotation.constraint}" may not be satisfied (source confidence: ${val})`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function checkTypes(graph: AetherGraph): CheckResult {
  const allErrors: CheckError[] = [];
  const allWarnings: CheckWarning[] = [];

  const nodeMap = new Map<string, AetherNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  for (const edge of graph.edges) {
    const fromRef = parseEdgeRef(edge.from);
    const toRef = parseEdgeRef(edge.to);

    if (!fromRef || !toRef) continue; // structural validation is the validator's job

    const fromNode = nodeMap.get(fromRef.nodeId);
    const toNode = nodeMap.get(toRef.nodeId);
    if (!fromNode || !toNode) continue;

    const fromAnnotation = fromNode.out[fromRef.portName];
    const toAnnotation = toNode.in[toRef.portName];
    if (!fromAnnotation || !toAnnotation) continue;

    const edgeLabel = `${edge.from} → ${edge.to}`;
    const result = checkEdge(fromAnnotation, toAnnotation, edgeLabel);
    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);
  }

  return {
    compatible: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] === __filename ||
  process.argv[1]?.endsWith("checker.ts") ||
  process.argv[1]?.endsWith("checker.js");

if (isMain && process.argv.length >= 3) {
  const filePath = process.argv[2];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as AetherGraph;
    const result = checkTypes(raw);

    if (result.compatible) {
      console.log(`✓  Type check passed: ${filePath}`);
    } else {
      console.error(`✗  Type check failed: ${filePath}`);
    }

    if (result.errors.length > 0) {
      console.error(`   Errors (${result.errors.length}):`);
      for (const e of result.errors) {
        console.error(`   • [${e.code}] ${e.edge}: ${e.message}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log(`   Warnings (${result.warnings.length}):`);
      for (const w of result.warnings) {
        console.log(`   ⚠  [${w.code}] ${w.edge}: ${w.message}`);
        if (w.suggestion) console.log(`      → ${w.suggestion}`);
      }
    }

    if (!result.compatible) process.exit(1);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}
