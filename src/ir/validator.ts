/**
 * AETHER-IR Validator
 * Validates any JSON object as a legal AetherGraph.
 *
 * Rules (applied in order):
 *   1. JSON Schema validation (AJV)
 *   2. DAG check — Kahn's algorithm cycle detection
 *   3. Edge reference check — ports must exist on referenced nodes
 *   4. Port direction check — from→out port, to→in port
 *   5. Confidence rule — confidence < 0.85 requires adversarial_check
 *   6. Recovery rule — non-pure effectful nodes require recovery
 *   7. Supervised tracking — logged as warnings, not errors
 */

import { readFileSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  supervisedCount: number;
}

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

interface Contract {
  pre?: string[];
  post?: string[];
  invariants?: string[];
}

interface AdversarialCheck {
  break_if: string[];
}

interface RecoveryAction {
  action: string;
  params?: Record<string, unknown>;
}

interface SupervisedBlock {
  reason: string;
  review_status?: "pending" | "approved" | "rejected";
}

interface AetherNode {
  id: string;
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  contract: Contract;
  confidence?: number;
  adversarial_check?: AdversarialCheck;
  effects: string[];
  pure?: boolean;
  recovery?: Record<string, RecoveryAction>;
  supervised?: SupervisedBlock;
}

interface AetherEdge {
  from: string; // "node_id.port_name"
  to: string;   // "node_id.port_name"
}

interface AetherGraph {
  id: string;
  version: number;
  effects: string[];
  sla?: { latency_ms?: number; availability?: number };
  nodes: AetherNode[];
  edges: AetherEdge[];
  metadata?: {
    description?: string;
    safety_level?: "low" | "medium" | "high";
    human_oversight?: { required_when: string };
  };
}

// ─── Schema loading & AJV setup ───────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const _require = createRequire(import.meta.url);

// Load schema via CJS require (JSON native support)
const schema = _require(join(__dirname, "schema.json")) as object;

// Load AJV class via CJS require to avoid NodeNext ESM/CJS interop issues.
// AJV 8 is a CJS package; we define a minimal interface for what we need.
interface AjvErrorObject {
  instancePath: string;
  message?: string;
}
interface AjvValidateFunction {
  (data: unknown): boolean;
  errors?: AjvErrorObject[] | null;
}
interface AjvInstance {
  compile(schema: object): AjvValidateFunction;
}
interface AjvCtor {
  new (opts?: Record<string, unknown>): AjvInstance;
}

const ajvModule = _require("ajv") as { default?: AjvCtor } | AjvCtor;
const AjvClass: AjvCtor =
  typeof ajvModule === "function"
    ? (ajvModule as AjvCtor)
    : ((ajvModule as { default: AjvCtor }).default ?? (ajvModule as unknown as AjvCtor));
const ajv: AjvInstance = new AjvClass({ allErrors: true });

// ─── Validation logic ─────────────────────────────────────────────────────────

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

function detectCycle(nodes: AetherNode[], edges: AetherEdge[]): string | null {
  // Build adjacency list: nodeId → set of nodeIds it points to
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    // Only consider edges between known nodes
    if (from && to && nodeIds.has(from.nodeId) && nodeIds.has(to.nodeId)) {
      if (from.nodeId !== to.nodeId) {
        const neighbors = adj.get(from.nodeId)!;
        if (!neighbors.has(to.nodeId)) {
          neighbors.add(to.nodeId);
          inDegree.set(to.nodeId, (inDegree.get(to.nodeId) ?? 0) + 1);
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (visited < nodeIds.size) {
    return "Graph contains a cycle — AETHER-IR must be a DAG";
  }
  return null;
}

export function validateGraph(graph: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let supervisedCount = 0;

  // ── Rule 1: JSON Schema validation ──────────────────────────────────────────
  const validate = ajv.compile(schema);
  const schemaValid = validate(graph);
  if (!schemaValid && validate.errors) {
    for (const err of validate.errors) {
      const path = err.instancePath || "(root)";
      errors.push(`Schema: ${path} — ${err.message ?? "unknown error"}`);
    }
    // Cannot proceed with structural checks on invalid shape
    return { valid: false, errors, warnings, supervisedCount };
  }

  // Safe cast after schema validation
  const g = graph as AetherGraph;

  // ── Rule 2: DAG check ────────────────────────────────────────────────────────
  const cycleErr = detectCycle(g.nodes, g.edges);
  if (cycleErr) errors.push(cycleErr);

  // ── Build lookup maps ────────────────────────────────────────────────────────
  const nodeMap = new Map<string, AetherNode>();
  const seenNodeIds = new Set<string>();
  for (const node of g.nodes) {
    if (seenNodeIds.has(node.id)) {
      errors.push(`Duplicate node id: "${node.id}"`);
    }
    seenNodeIds.add(node.id);
    nodeMap.set(node.id, node);
  }

  // ── Rule 3 & 7: Edge reference check + port direction check ─────────────────
  for (const edge of g.edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);

    if (!from) {
      errors.push(`Edge from="${edge.from}" is not a valid "node_id.port_name" reference`);
    } else {
      const fromNode = nodeMap.get(from.nodeId);
      if (!fromNode) {
        errors.push(`Edge from="${edge.from}" references unknown node "${from.nodeId}"`);
      } else {
        // Rule 7: from must be an OUT port
        if (!(from.portName in fromNode.out)) {
          if (from.portName in fromNode.in) {
            errors.push(
              `Edge from="${edge.from}" references an IN port — "from" must reference an OUT port`
            );
          } else {
            errors.push(
              `Edge from="${edge.from}" references unknown port "${from.portName}" on node "${from.nodeId}"`
            );
          }
        }
      }
    }

    if (!to) {
      errors.push(`Edge to="${edge.to}" is not a valid "node_id.port_name" reference`);
    } else {
      const toNode = nodeMap.get(to.nodeId);
      if (!toNode) {
        errors.push(`Edge to="${edge.to}" references unknown node "${to.nodeId}"`);
      } else {
        // Rule 7: to must be an IN port
        if (!(to.portName in toNode.in)) {
          if (to.portName in toNode.out) {
            errors.push(
              `Edge to="${edge.to}" references an OUT port — "to" must reference an IN port`
            );
          } else {
            errors.push(
              `Edge to="${edge.to}" references unknown port "${to.portName}" on node "${to.nodeId}"`
            );
          }
        }
      }
    }
  }

  // ── Rules 4, 5, 6 per node ───────────────────────────────────────────────────
  for (const node of g.nodes) {
    // Rule 5: confidence < 0.85 requires adversarial_check
    if (node.confidence !== undefined && node.confidence < 0.85) {
      if (!node.adversarial_check || node.adversarial_check.break_if.length === 0) {
        errors.push(
          `Node "${node.id}": confidence=${node.confidence} is below 0.85 but has no adversarial_check with break_if entries`
        );
      }
    }

    // Rule 6: non-pure effectful nodes require recovery
    const isEffectful = node.effects.length > 0 && node.pure !== true;
    if (isEffectful && !node.recovery) {
      errors.push(
        `Node "${node.id}": has effects [${node.effects.join(", ")}] but no recovery block (add recovery or set pure: true)`
      );
    }

    // Rule 7 (supervised): log as warnings
    if (node.supervised) {
      supervisedCount++;
      warnings.push(
        `Node "${node.id}" is supervised (unverified): ${node.supervised.reason}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    supervisedCount,
  };
}

// ─── CLI entry point ───────────────────────────────────────────────────────────

const isMain = process.argv[1] === __filename ||
  process.argv[1]?.endsWith("validator.ts") ||
  process.argv[1]?.endsWith("validator.js");

if (isMain && process.argv.length >= 3) {
  const filePath = process.argv[2];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    const result = validateGraph(raw);

    if (result.valid) {
      console.log(`✓  ${filePath}`);
      if (result.supervisedCount > 0) {
        console.log(`   Supervised nodes: ${result.supervisedCount}`);
      }
      if (result.warnings.length > 0) {
        result.warnings.forEach((w) => console.log(`   ⚠  ${w}`));
      }
    } else {
      console.error(`✗  ${filePath}`);
      result.errors.forEach((e) => console.error(`   • ${e}`));
      process.exit(1);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error reading or parsing file: ${msg}`);
    process.exit(1);
  }
}
