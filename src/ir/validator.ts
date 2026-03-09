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
import { instantiateTemplate, validateTemplate } from "../compiler/templates.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  supervisedCount: number;
  holeCount: number;
  completeness: number;
}

export interface TypeAnnotation {
  type: string;
  domain?: string;
  unit?: string;
  dimension?: string;
  format?: string;
  sensitivity?: string;
  range?: [number, number];
  constraint?: string;
  state_type?: string;
}

export interface StateTransition {
  from: string;
  to: string;
  when: string;
}

export interface StateTypeInvariants {
  never?: Array<{ from: string; to: string }>;
  terminal?: string[];
  initial?: string;
}

export interface StateType {
  id: string;
  states: string[];
  transitions: StateTransition[];
  invariants?: StateTypeInvariants;
}

export interface Contract {
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

export interface AetherNode {
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

export interface AetherHole {
  id: string;
  hole: true;
  must_satisfy: {
    in: Record<string, TypeAnnotation>;
    out: Record<string, TypeAnnotation>;
    effects?: string[];
    contract?: Contract;
  };
}

export interface IntentNode {
  id: string;
  intent: true;
  ensure: string[];
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  effects?: string[];
  constraints?: {
    time_complexity?: string;
    space_complexity?: string;
    latency_ms?: number;
    deterministic?: boolean;
  };
  confidence?: number;
}

export interface AetherEdge {
  from: string; // "node_id.port_name"
  to: string;   // "node_id.port_name"
}

export interface AetherTemplateParameter {
  name: string;
  kind: "type" | "value" | "effect" | "node_id";
  constraint?: string;
}

export interface AetherTemplate {
  id: string;
  description?: string;
  parameters: AetherTemplateParameter[];
  nodes: AetherNode[];
  edges: AetherEdge[];
  exposed_inputs?: Record<string, string>;
  exposed_outputs?: Record<string, string>;
}

export interface AetherTemplateInstance {
  id: string;
  template: string;
  bindings: Record<string, unknown>;
}

export interface BoundaryContract {
  name: string;
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  contract?: Contract;
  effects?: string[];
  confidence?: number;
}

export interface Scope {
  id: string;
  description?: string;
  nodes: string[];
  boundary_contracts?: {
    requires?: BoundaryContract[];
    provides?: BoundaryContract[];
  };
}

export interface AetherGraph {
  id: string;
  version: number;
  effects: string[];
  partial?: boolean;
  sla?: { latency_ms?: number; availability?: number };
  nodes: (AetherNode | AetherHole | IntentNode)[];
  edges: AetherEdge[];
  state_types?: StateType[];
  templates?: AetherTemplate[];
  template_instances?: AetherTemplateInstance[];
  scopes?: Scope[];
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isHole(node: AetherNode | AetherHole | IntentNode): node is AetherHole {
  return "hole" in node && (node as AetherHole).hole === true;
}

function isIntent(node: AetherNode | AetherHole | IntentNode): node is IntentNode {
  return "intent" in node && (node as IntentNode).intent === true;
}

// ─── Validation logic ─────────────────────────────────────────────────────────

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

function detectCycle(nodes: (AetherNode | AetherHole | IntentNode)[], edges: AetherEdge[]): string | null {
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
  let holeCount = 0;

  // ── Rule 1: JSON Schema validation ──────────────────────────────────────────
  const validate = ajv.compile(schema);
  const schemaValid = validate(graph);
  if (!schemaValid && validate.errors) {
    for (const err of validate.errors) {
      const path = err.instancePath || "(root)";
      errors.push(`Schema: ${path} — ${err.message ?? "unknown error"}`);
    }
    // Cannot proceed with structural checks on invalid shape
    return { valid: false, errors, warnings, supervisedCount, holeCount: 0, completeness: 0 };
  }

  // Safe cast after schema validation
  const g = graph as AetherGraph;
  const isPartial = g.partial === true;

  // ── Rule 2: DAG check ────────────────────────────────────────────────────────
  const cycleErr = detectCycle(g.nodes, g.edges);
  if (cycleErr) errors.push(cycleErr);

  // ── Build lookup maps ────────────────────────────────────────────────────────
  const nodeMap = new Map<string, AetherNode | AetherHole | IntentNode>();
  const holeSet = new Set<string>();
  const seenNodeIds = new Set<string>();
  for (const node of g.nodes) {
    if (seenNodeIds.has(node.id)) {
      errors.push(`Duplicate node id: "${node.id}"`);
    }
    seenNodeIds.add(node.id);
    nodeMap.set(node.id, node);
    if (isHole(node)) {
      holeCount++;
      holeSet.add(node.id);
    }
  }

  // ── Hole check: holes only allowed in partial graphs ────────────────────────
  if (!isPartial && holeCount > 0) {
    errors.push("partial graph contains holes but partial flag is false");
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
      } else if (isHole(fromNode)) {
        // Edge referencing a hole's port — valid in partial, check port exists on must_satisfy
        if (!(from.portName in fromNode.must_satisfy.out)) {
          if (isPartial) {
            warnings.push(`Edge from="${edge.from}" references unknown port "${from.portName}" on hole "${from.nodeId}"`);
          } else {
            errors.push(`Edge from="${edge.from}" references unknown port "${from.portName}" on hole "${from.nodeId}"`);
          }
        }
      } else if (isIntent(fromNode)) {
        // IntentNode has out ports directly
        if (!(from.portName in fromNode.out)) {
          errors.push(
            `Edge from="${edge.from}" references unknown port "${from.portName}" on intent node "${from.nodeId}"`
          );
        }
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
      } else if (isHole(toNode)) {
        // Edge referencing a hole's port — valid in partial, check port exists on must_satisfy
        if (!(to.portName in toNode.must_satisfy.in)) {
          if (isPartial) {
            warnings.push(`Edge to="${edge.to}" references unknown port "${to.portName}" on hole "${to.nodeId}"`);
          } else {
            errors.push(`Edge to="${edge.to}" references unknown port "${to.portName}" on hole "${to.nodeId}"`);
          }
        }
      } else if (isIntent(toNode)) {
        // IntentNode has in ports directly
        if (!(to.portName in toNode.in)) {
          errors.push(
            `Edge to="${edge.to}" references unknown port "${to.portName}" on intent node "${to.nodeId}"`
          );
        }
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

  // ── Rules 4, 5, 6 per node (skip holes) ──────────────────────────────────────
  for (const node of g.nodes) {
    if (isHole(node)) continue; // Holes skip all content validation
    if (isIntent(node)) continue; // IntentNodes skip content validation (resolved later)

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

  // ── State type validation ────────────────────────────────────────────────────
  if (g.state_types && g.state_types.length > 0) {
    const stateTypeMap = new Map<string, StateType>();

    for (const st of g.state_types) {
      // State uniqueness
      const stateSet = new Set<string>();
      for (const s of st.states) {
        if (stateSet.has(s)) {
          errors.push(`StateType "${st.id}": duplicate state "${s}"`);
        }
        stateSet.add(s);
      }

      // Transition validity: from/to must reference declared states
      for (const t of st.transitions) {
        if (!stateSet.has(t.from)) {
          errors.push(`StateType "${st.id}": transition references undeclared state "${t.from}"`);
        }
        if (!stateSet.has(t.to)) {
          errors.push(`StateType "${st.id}": transition references undeclared state "${t.to}"`);
        }
      }

      if (st.invariants) {
        // Never-transition check
        if (st.invariants.never) {
          for (const nev of st.invariants.never) {
            for (const t of st.transitions) {
              if (t.from === nev.from && t.to === nev.to) {
                errors.push(`StateType "${st.id}": transition ${t.from}→${t.to} violates never-invariant`);
              }
            }
          }
        }

        // Terminal check: terminal states must not appear as 'from' in any transition
        if (st.invariants.terminal) {
          const terminalSet = new Set(st.invariants.terminal);
          for (const t of st.transitions) {
            if (terminalSet.has(t.from)) {
              errors.push(`StateType "${st.id}": terminal state "${t.from}" has outgoing transition to "${t.to}"`);
            }
          }
        }

        // Initial state check
        if (st.invariants.initial !== undefined) {
          if (!stateSet.has(st.invariants.initial)) {
            errors.push(`StateType "${st.id}": initial state "${st.invariants.initial}" is not a declared state`);
          }
        }

        // Reachability check (warning only)
        if (st.invariants.initial !== undefined && stateSet.has(st.invariants.initial)) {
          const reachable = new Set<string>();
          const queue = [st.invariants.initial];
          reachable.add(st.invariants.initial);
          while (queue.length > 0) {
            const current = queue.shift()!;
            for (const t of st.transitions) {
              if (t.from === current && !reachable.has(t.to)) {
                reachable.add(t.to);
                queue.push(t.to);
              }
            }
          }
          for (const s of st.states) {
            if (s !== st.invariants.initial && !reachable.has(s)) {
              warnings.push(`StateType "${st.id}": state "${s}" is not reachable from initial state "${st.invariants.initial}"`);
            }
          }
        }
      }

      stateTypeMap.set(st.id, st);
    }

    // Port reference check: state_type on TypeAnnotation must reference declared state type
    for (const node of g.nodes) {
      if (isHole(node)) continue;
      const ports = { ...node.in, ...node.out };
      for (const [portName, ann] of Object.entries(ports)) {
        if (ann.state_type && !stateTypeMap.has(ann.state_type)) {
          errors.push(`Node "${node.id}" port "${portName}": references undeclared state_type "${ann.state_type}"`);
        }
      }
    }
  } else {
    // No state_types declared — check no ports reference state_type
    for (const node of g.nodes) {
      if (isHole(node)) continue;
      const ports = { ...node.in, ...node.out };
      for (const [portName, ann] of Object.entries(ports)) {
        if (ann.state_type) {
          errors.push(`Node "${node.id}" port "${portName}": references state_type "${ann.state_type}" but no state_types declared in graph`);
        }
      }
    }
  }

  // ── Template instantiation validation ──────────────────────────────────────
  if (g.templates && g.templates.length > 0) {
    for (const t of g.templates) {
      const tResult = validateTemplate(t);
      for (const err of tResult.errors) {
        errors.push(`Template "${t.id}": ${err}`);
      }
      for (const w of tResult.warnings) {
        warnings.push(`Template "${t.id}": ${w}`);
      }
    }
  }

  if (g.template_instances && g.template_instances.length > 0) {
    const templateMap = new Map<string, AetherTemplate>();
    if (g.templates) {
      for (const t of g.templates) {
        templateMap.set(t.id, t);
      }
    }

    const existingNodeIds = new Set(g.nodes.map(n => n.id));

    for (const inst of g.template_instances) {
      const template = templateMap.get(inst.template);
      if (!template) {
        errors.push(`Template instance "${inst.id}": references unknown template "${inst.template}"`);
        continue;
      }

      const result = instantiateTemplate(template, inst, existingNodeIds);
      if (!result.success) {
        for (const err of result.errors) {
          errors.push(`Template instance "${inst.id}": ${err}`);
        }
      }
      for (const w of result.warnings) {
        warnings.push(`Template instance "${inst.id}": ${w}`);
      }
    }
  }

  // ── Scope validation ────────────────────────────────────────────────────────
  if (g.scopes && g.scopes.length > 0) {
    const allNodeIds = new Set(g.nodes.map(n => n.id));
    const nodeToScope = new Map<string, string>();

    // Check scope node references and coverage
    for (const scope of g.scopes) {
      for (const nodeId of scope.nodes) {
        if (!allNodeIds.has(nodeId)) {
          errors.push(`Scope "${scope.id}": references unknown node "${nodeId}"`);
          continue;
        }
        if (nodeToScope.has(nodeId)) {
          errors.push(`Node "${nodeId}" belongs to multiple scopes: "${nodeToScope.get(nodeId)}" and "${scope.id}"`);
        } else {
          nodeToScope.set(nodeId, scope.id);
        }
      }
    }

    // Every node must belong to exactly one scope
    for (const nodeId of allNodeIds) {
      if (!nodeToScope.has(nodeId)) {
        errors.push(`Node "${nodeId}" is not assigned to any scope`);
      }
    }

    // Scope connectivity check (warning if disconnected)
    for (const scope of g.scopes) {
      const scopeNodeSet = new Set(scope.nodes.filter(id => allNodeIds.has(id)));
      if (scopeNodeSet.size <= 1) continue;

      // Build undirected adjacency within scope
      const adj = new Map<string, Set<string>>();
      for (const id of scopeNodeSet) adj.set(id, new Set());
      for (const edge of g.edges) {
        const from = parseEdgeRef(edge.from);
        const to = parseEdgeRef(edge.to);
        if (from && to && scopeNodeSet.has(from.nodeId) && scopeNodeSet.has(to.nodeId)) {
          adj.get(from.nodeId)!.add(to.nodeId);
          adj.get(to.nodeId)!.add(from.nodeId);
        }
      }

      // BFS connectivity
      const visited = new Set<string>();
      const queue = [scopeNodeSet.values().next().value as string];
      visited.add(queue[0]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const neighbor of adj.get(current) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      if (visited.size < scopeNodeSet.size) {
        warnings.push(`Scope "${scope.id}": nodes do not form a connected subgraph`);
      }
    }

    // Boundary contract coverage: every cross-scope edge needs coverage
    for (const edge of g.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (!from || !to) continue;

      const fromScope = nodeToScope.get(from.nodeId);
      const toScope = nodeToScope.get(to.nodeId);
      if (!fromScope || !toScope || fromScope === toScope) continue;

      // Cross-scope edge — check boundary contracts
      const sourceScope = g.scopes.find(s => s.id === fromScope);
      const destScope = g.scopes.find(s => s.id === toScope);

      const hasProvides = sourceScope?.boundary_contracts?.provides?.some(
        c => c.out && Object.keys(c.out).some(k => {
          const fromNode = nodeMap.get(from.nodeId);
          if (!fromNode || isHole(fromNode)) return false;
          const fromType = fromNode.out[from.portName];
          return fromType && c.out[k] && c.out[k].type === fromType.type;
        })
      );

      const hasRequires = destScope?.boundary_contracts?.requires?.some(
        c => c.in && Object.keys(c.in).some(k => {
          const toNode = nodeMap.get(to.nodeId);
          if (!toNode || isHole(toNode)) return false;
          const toType = toNode.in[to.portName];
          return toType && c.in[k] && c.in[k].type === toType.type;
        })
      );

      if (!hasProvides) {
        errors.push(`Cross-scope edge ${edge.from} → ${edge.to}: source scope "${fromScope}" has no matching provides contract`);
      }
      if (!hasRequires) {
        errors.push(`Cross-scope edge ${edge.from} → ${edge.to}: destination scope "${toScope}" has no matching requires contract`);
      }
    }
  }

  const verifiedNodes = g.nodes.length - holeCount;
  const completeness = g.nodes.length > 0 ? verifiedNodes / g.nodes.length : 1;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    supervisedCount,
    holeCount,
    completeness,
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
