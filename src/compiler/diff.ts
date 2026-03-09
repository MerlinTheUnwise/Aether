/**
 * AETHER Semantic Diff Engine
 * Computes meaningful structural and semantic differences between two versions
 * of an AETHER graph — not textual diff, but graph-aware change detection.
 */

import type {
  AetherGraph,
  AetherNode,
  AetherEdge,
  TypeAnnotation,
} from "../ir/validator.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphChange =
  | { type: "node_added"; node_id: string; details: any }
  | { type: "node_removed"; node_id: string }
  | { type: "node_modified"; node_id: string; field: string; from: any; to: any }
  | { type: "edge_added"; from: string; to: string }
  | { type: "edge_removed"; from: string; to: string }
  | { type: "contract_changed"; node_id: string; contract_type: string; from: string; to: string }
  | { type: "confidence_changed"; node_id: string; from: number; to: number }
  | { type: "effect_added"; node_id: string; effect: string }
  | { type: "effect_removed"; node_id: string; effect: string }
  | { type: "type_changed"; location: string; from: TypeAnnotation; to: TypeAnnotation };

export interface DiffImpact {
  contracts_changed: number;
  types_changed: number;
  effects_changed: number;
  confidence_changed: number;
  nodes_added: number;
  nodes_removed: number;
  breaking_changes: string[];
  verification_needed: string[];
}

export interface SemanticDiff {
  graph_id: string;
  version_from: number;
  version_to: number;
  changes: GraphChange[];
  impact: DiffImpact;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function edgeKey(e: AetherEdge): string {
  return `${e.from}->${e.to}`;
}

function getNodePorts(node: any): { in: Record<string, TypeAnnotation>; out: Record<string, TypeAnnotation> } {
  if ("hole" in node && node.hole) {
    return { in: node.must_satisfy?.in ?? {}, out: node.must_satisfy?.out ?? {} };
  }
  if ("intent" in node && node.intent) {
    return { in: node.in ?? {}, out: node.out ?? {} };
  }
  return { in: node.in ?? {}, out: node.out ?? {} };
}

function getNodeEffects(node: any): string[] {
  if ("hole" in node && node.hole) return node.must_satisfy?.effects ?? [];
  return node.effects ?? [];
}

function getNodeConfidence(node: any): number | undefined {
  return node.confidence;
}

function getNodeContract(node: any): { pre?: string[]; post?: string[]; invariants?: string[] } {
  if ("hole" in node && node.hole) return node.must_satisfy?.contract ?? {};
  if ("intent" in node && node.intent) return {};
  return node.contract ?? {};
}

function typeAnnotationsEqual(a: TypeAnnotation, b: TypeAnnotation): boolean {
  return a.type === b.type
    && a.domain === b.domain
    && a.dimension === b.dimension
    && a.unit === b.unit
    && a.format === b.format
    && a.sensitivity === b.sensitivity;
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

// ─── Core Diff ───────────────────────────────────────────────────────────────

export function diffGraphs(before: AetherGraph, after: AetherGraph): SemanticDiff {
  const changes: GraphChange[] = [];
  const breaking: string[] = [];
  const verificationNeeded: string[] = [];

  let contractsChanged = 0;
  let typesChanged = 0;
  let effectsChanged = 0;
  let confidenceChanged = 0;
  let nodesAdded = 0;
  let nodesRemoved = 0;

  // Build node maps
  const beforeNodes = new Map<string, any>();
  const afterNodes = new Map<string, any>();
  for (const n of before.nodes) beforeNodes.set(n.id, n);
  for (const n of after.nodes) afterNodes.set(n.id, n);

  // Detect added/removed nodes
  for (const [id, node] of afterNodes) {
    if (!beforeNodes.has(id)) {
      changes.push({ type: "node_added", node_id: id, details: node });
      nodesAdded++;
    }
  }

  for (const [id] of beforeNodes) {
    if (!afterNodes.has(id)) {
      changes.push({ type: "node_removed", node_id: id });
      nodesRemoved++;
      breaking.push(`Node "${id}" removed`);
      verificationNeeded.push(id);
    }
  }

  // Detect modifications on shared nodes
  for (const [id, beforeNode] of beforeNodes) {
    const afterNode = afterNodes.get(id);
    if (!afterNode) continue;

    // Compare ports (types)
    const beforePorts = getNodePorts(beforeNode);
    const afterPorts = getNodePorts(afterNode);

    // Check output port changes (breaking if removed or type changed)
    for (const [port, beforeType] of Object.entries(beforePorts.out)) {
      const afterType = afterPorts.out[port];
      if (!afterType) {
        changes.push({ type: "type_changed", location: `${id}.out.${port}`, from: beforeType, to: { type: "(removed)" } });
        typesChanged++;
        breaking.push(`Output port "${id}.${port}" removed`);
        verificationNeeded.push(id);
      } else if (!typeAnnotationsEqual(beforeType, afterType)) {
        changes.push({ type: "type_changed", location: `${id}.out.${port}`, from: beforeType, to: afterType });
        typesChanged++;
        breaking.push(`Output type changed on "${id}.${port}": ${beforeType.type} → ${afterType.type}`);
        verificationNeeded.push(id);
      }
    }

    // Check for new output ports (non-breaking)
    for (const [port, afterType] of Object.entries(afterPorts.out)) {
      if (!beforePorts.out[port]) {
        changes.push({ type: "type_changed", location: `${id}.out.${port}`, from: { type: "(added)" }, to: afterType });
        typesChanged++;
      }
    }

    // Check input port changes
    for (const [port, beforeType] of Object.entries(beforePorts.in)) {
      const afterType = afterPorts.in[port];
      if (!afterType) {
        changes.push({ type: "type_changed", location: `${id}.in.${port}`, from: beforeType, to: { type: "(removed)" } });
        typesChanged++;
        verificationNeeded.push(id);
      } else if (!typeAnnotationsEqual(beforeType, afterType)) {
        changes.push({ type: "type_changed", location: `${id}.in.${port}`, from: beforeType, to: afterType });
        typesChanged++;
        verificationNeeded.push(id);
      }
    }

    // Compare effects
    const beforeEffects = new Set(getNodeEffects(beforeNode));
    const afterEffects = new Set(getNodeEffects(afterNode));

    for (const effect of afterEffects) {
      if (!beforeEffects.has(effect)) {
        changes.push({ type: "effect_added", node_id: id, effect });
        effectsChanged++;
        breaking.push(`Effect "${effect}" added to "${id}"`);
        verificationNeeded.push(id);
      }
    }

    for (const effect of beforeEffects) {
      if (!afterEffects.has(effect)) {
        changes.push({ type: "effect_removed", node_id: id, effect });
        effectsChanged++;
        verificationNeeded.push(id);
      }
    }

    // Compare confidence
    const beforeConf = getNodeConfidence(beforeNode);
    const afterConf = getNodeConfidence(afterNode);
    if (beforeConf !== undefined && afterConf !== undefined && beforeConf !== afterConf) {
      changes.push({ type: "confidence_changed", node_id: id, from: beforeConf, to: afterConf });
      confidenceChanged++;
      if (afterConf < beforeConf) {
        breaking.push(`Confidence lowered on "${id}": ${beforeConf} → ${afterConf}`);
      }
      verificationNeeded.push(id);
    } else if (beforeConf !== undefined && afterConf === undefined) {
      changes.push({ type: "confidence_changed", node_id: id, from: beforeConf, to: 1.0 });
      confidenceChanged++;
    } else if (beforeConf === undefined && afterConf !== undefined) {
      changes.push({ type: "confidence_changed", node_id: id, from: 1.0, to: afterConf });
      confidenceChanged++;
      if (afterConf < 1.0) {
        verificationNeeded.push(id);
      }
    }

    // Compare contracts
    const beforeContract = getNodeContract(beforeNode);
    const afterContract = getNodeContract(afterNode);

    // Check postconditions (weakening is breaking)
    if (!arraysEqual(beforeContract.post, afterContract.post)) {
      const beforePosts = new Set(beforeContract.post ?? []);
      const afterPosts = new Set(afterContract.post ?? []);

      for (const post of beforePosts) {
        if (!afterPosts.has(post)) {
          changes.push({ type: "contract_changed", node_id: id, contract_type: "post", from: post, to: "(removed)" });
          contractsChanged++;
          breaking.push(`Postcondition weakened on "${id}": removed "${post}"`);
          verificationNeeded.push(id);
        }
      }
      for (const post of afterPosts) {
        if (!beforePosts.has(post)) {
          changes.push({ type: "contract_changed", node_id: id, contract_type: "post", from: "(added)", to: post });
          contractsChanged++;
          verificationNeeded.push(id);
        }
      }
    }

    if (!arraysEqual(beforeContract.pre, afterContract.pre)) {
      const beforePres = new Set(beforeContract.pre ?? []);
      const afterPres = new Set(afterContract.pre ?? []);

      for (const pre of afterPres) {
        if (!beforePres.has(pre)) {
          changes.push({ type: "contract_changed", node_id: id, contract_type: "pre", from: "(added)", to: pre });
          contractsChanged++;
          verificationNeeded.push(id);
        }
      }
      for (const pre of beforePres) {
        if (!afterPres.has(pre)) {
          changes.push({ type: "contract_changed", node_id: id, contract_type: "pre", from: pre, to: "(removed)" });
          contractsChanged++;
          verificationNeeded.push(id);
        }
      }
    }

    // Compare recovery (removal is breaking)
    const beforeRecovery = (beforeNode as any).recovery;
    const afterRecovery = (afterNode as any).recovery;
    if (beforeRecovery && !afterRecovery) {
      changes.push({ type: "node_modified", node_id: id, field: "recovery", from: "present", to: "removed" });
      breaking.push(`Recovery removed from "${id}"`);
      verificationNeeded.push(id);
    }
  }

  // Detect edge changes
  const beforeEdges = new Set(before.edges.map(edgeKey));
  const afterEdges = new Set(after.edges.map(edgeKey));

  for (const edge of after.edges) {
    if (!beforeEdges.has(edgeKey(edge))) {
      changes.push({ type: "edge_added", from: edge.from, to: edge.to });
    }
  }

  for (const edge of before.edges) {
    if (!afterEdges.has(edgeKey(edge))) {
      changes.push({ type: "edge_removed", from: edge.from, to: edge.to });
    }
  }

  return {
    graph_id: before.id,
    version_from: before.version,
    version_to: after.version,
    changes,
    impact: {
      contracts_changed: contractsChanged,
      types_changed: typesChanged,
      effects_changed: effectsChanged,
      confidence_changed: confidenceChanged,
      nodes_added: nodesAdded,
      nodes_removed: nodesRemoved,
      breaking_changes: [...new Set(breaking)],
      verification_needed: [...new Set(verificationNeeded)],
    },
  };
}

// ─── Breaking Change Detection ───────────────────────────────────────────────

export function hasBreakingChanges(diff: SemanticDiff): boolean {
  return diff.impact.breaking_changes.length > 0;
}

// ─── Affected Nodes ──────────────────────────────────────────────────────────

export function affectedNodes(diff: SemanticDiff, graph: AetherGraph): string[] {
  const affected = new Set(diff.impact.verification_needed);

  // Build adjacency map for downstream propagation
  const downstream = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const fromNode = edge.from.split(".")[0];
    const toNode = edge.to.split(".")[0];
    if (!downstream.has(fromNode)) downstream.set(fromNode, new Set());
    downstream.get(fromNode)!.add(toNode);
  }

  // BFS to find all downstream nodes from changed nodes
  const queue = [...affected];
  const visited = new Set(queue);

  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of downstream.get(node) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        affected.add(next);
        queue.push(next);
      }
    }
  }

  return [...affected];
}
