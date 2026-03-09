/**
 * AETHER Runtime — Confidence Propagation Engine
 *
 * Propagates confidence through the DAG:
 *   propagated(node) = node.confidence * min(input_confidences)
 *
 * Wave 0 nodes (no inputs): propagated = node.confidence (or 1.0)
 * Graph confidence = product along critical path (longest by node count).
 */

import type { AetherGraph, AetherNode, AetherEdge } from "../ir/validator.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConfidenceReport {
  nodeConfidences: Record<string, {
    declared: number;
    propagated: number;
    requiresOversight: boolean;
  }>;
  graphConfidence: number;
  oversightNodes: string[];
  criticalPath: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNode(n: { id: string; hole?: boolean }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true);
}

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

/** Build adjacency: nodeId → set of predecessor nodeIds */
function buildPredecessors(edges: AetherEdge[]): Map<string, Set<string>> {
  const preds = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to && from.nodeId !== to.nodeId) {
      if (!preds.has(to.nodeId)) preds.set(to.nodeId, new Set());
      preds.get(to.nodeId)!.add(from.nodeId);
    }
  }
  return preds;
}

/** Build successors: nodeId → set of successor nodeIds */
function buildSuccessors(edges: AetherEdge[]): Map<string, Set<string>> {
  const succs = new Map<string, Set<string>>();
  for (const edge of edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to && from.nodeId !== to.nodeId) {
      if (!succs.has(from.nodeId)) succs.set(from.nodeId, new Set());
      succs.get(from.nodeId)!.add(to.nodeId);
    }
  }
  return succs;
}

/** Find critical path — longest path by node count, using propagated confidences */
function findCriticalPath(
  nodeIds: string[],
  succs: Map<string, Set<string>>,
  preds: Map<string, Set<string>>,
  propagated: Map<string, number>
): string[] {
  // Topological order via Kahn's
  const inDeg = new Map<string, number>();
  for (const id of nodeIds) inDeg.set(id, 0);
  for (const [, targets] of succs) {
    for (const t of targets) {
      inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  const topoOrder: string[] = [];
  const tempInDeg = new Map(inDeg);
  const q = [...queue];
  while (q.length > 0) {
    const node = q.shift()!;
    topoOrder.push(node);
    for (const next of succs.get(node) ?? []) {
      const newDeg = (tempInDeg.get(next) ?? 0) - 1;
      tempInDeg.set(next, newDeg);
      if (newDeg === 0) q.push(next);
    }
  }

  // DP: longest path by node count
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const id of topoOrder) {
    dist.set(id, 1);
    prev.set(id, null);
  }

  for (const node of topoOrder) {
    const currentDist = dist.get(node)!;
    for (const next of succs.get(node) ?? []) {
      if (currentDist + 1 > (dist.get(next) ?? 1)) {
        dist.set(next, currentDist + 1);
        prev.set(next, node);
      }
    }
  }

  // Find the end node with longest distance
  let endNode = topoOrder[0];
  let maxDist = 0;
  for (const [id, d] of dist) {
    if (d > maxDist) {
      maxDist = d;
      endNode = id;
    }
  }

  // Trace back
  const path: string[] = [];
  let cur: string | null = endNode;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }

  return path;
}

// ─── ConfidenceEngine ────────────────────────────────────────────────────────

export class ConfidenceEngine {
  private nodeConfidences: Map<string, number> = new Map();
  private propagatedConfidences: Map<string, number> = new Map();
  private oversightRequired: Set<string> = new Set();
  private threshold: number;
  private graph: AetherGraph;

  constructor(graph: AetherGraph, threshold: number = 0.7) {
    this.graph = graph;
    this.threshold = threshold;

    // Record declared confidences
    for (const node of graph.nodes) {
      if (isNode(node)) {
        this.nodeConfidences.set(node.id, node.confidence ?? 1.0);
      }
    }
  }

  /** Propagate confidence for a node given its input confidences */
  propagate(nodeId: string, inputConfidences: Map<string, number>): number {
    const declared = this.nodeConfidences.get(nodeId) ?? 1.0;
    let minInput = 1.0;

    if (inputConfidences.size > 0) {
      for (const c of inputConfidences.values()) {
        if (c < minInput) minInput = c;
      }
    }

    const propagated = declared * minInput;
    this.propagatedConfidences.set(nodeId, propagated);

    if (propagated < this.threshold) {
      this.oversightRequired.add(nodeId);
    }

    return propagated;
  }

  /** Check if a node requires oversight */
  requiresOversight(nodeId: string): boolean {
    return this.oversightRequired.has(nodeId);
  }

  /** Compute graph-level confidence = product of propagated along critical path */
  getGraphConfidence(): number {
    const nodeIds = this.graph.nodes.filter(n => isNode(n)).map(n => n.id);
    if (nodeIds.length === 0) return 1.0;

    const succs = buildSuccessors(this.graph.edges);
    const preds = buildPredecessors(this.graph.edges);
    const path = findCriticalPath(nodeIds, succs, preds, this.propagatedConfidences);

    let confidence = 1.0;
    for (const nodeId of path) {
      confidence *= this.propagatedConfidences.get(nodeId) ?? this.nodeConfidences.get(nodeId) ?? 1.0;
    }
    return confidence;
  }

  /** Full report */
  getReport(): ConfidenceReport {
    const nodeIds = this.graph.nodes.filter(n => isNode(n)).map(n => n.id);
    const succs = buildSuccessors(this.graph.edges);
    const preds = buildPredecessors(this.graph.edges);
    const criticalPath = findCriticalPath(nodeIds, succs, preds, this.propagatedConfidences);

    const nodeConfidences: Record<string, { declared: number; propagated: number; requiresOversight: boolean }> = {};
    for (const id of nodeIds) {
      nodeConfidences[id] = {
        declared: this.nodeConfidences.get(id) ?? 1.0,
        propagated: this.propagatedConfidences.get(id) ?? this.nodeConfidences.get(id) ?? 1.0,
        requiresOversight: this.oversightRequired.has(id),
      };
    }

    return {
      nodeConfidences,
      graphConfidence: this.getGraphConfidence(),
      oversightNodes: [...this.oversightRequired],
      criticalPath,
    };
  }
}
