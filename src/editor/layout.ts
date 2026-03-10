/**
 * AETHER Graph Editor — Auto-Layout Algorithm
 *
 * Computes topological wave positions for DAG nodes using Kahn's algorithm.
 * Nodes in the same wave are placed at the same vertical (or horizontal) level,
 * with edge-crossing minimization via barycenter ordering.
 */

import type { AetherGraph, AetherEdge } from "../ir/validator.js";

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  dimensions: { width: number; height: number };
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  horizontalGap?: number;
  verticalGap?: number;
  direction?: "top-down" | "left-right";
}

const DEFAULTS: Required<LayoutOptions> = {
  nodeWidth: 220,
  nodeHeight: 120,
  horizontalGap: 80,
  verticalGap: 60,
  direction: "top-down",
};

/**
 * Compute topological waves via Kahn's algorithm.
 * Returns array of waves, each containing node IDs that can execute in parallel.
 */
export function computeWaves(graph: AetherGraph): string[][] {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  if (nodeIds.size === 0) return [];

  // Build adjacency and in-degree maps
  const adj = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();
  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDeg.set(id, 0);
  }

  for (const edge of graph.edges) {
    const fromNode = edge.from.split(".")[0];
    const toNode = edge.to.split(".")[0];
    if (fromNode === toNode) continue;
    if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) continue;
    if (!adj.get(fromNode)!.has(toNode)) {
      adj.get(fromNode)!.add(toNode);
      inDeg.set(toNode, (inDeg.get(toNode) || 0) + 1);
    }
  }

  const waves: string[][] = [];
  const remaining = new Set(nodeIds);

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDeg.get(id) || 0) === 0) {
        wave.push(id);
      }
    }

    // If no zero in-degree nodes, break (cycle — shouldn't happen for valid DAGs)
    if (wave.length === 0) {
      // Add remaining nodes as final wave
      waves.push([...remaining]);
      break;
    }

    // Remove wave nodes and decrement successors
    for (const id of wave) {
      remaining.delete(id);
      for (const next of adj.get(id) || []) {
        inDeg.set(next, (inDeg.get(next) || 0) - 1);
      }
    }

    waves.push(wave);
  }

  return waves;
}

/**
 * Minimize edge crossings within a wave by sorting nodes
 * based on average position of their connected predecessors/successors.
 */
function minimizeCrossings(
  waves: string[][],
  graph: AetherGraph,
): string[][] {
  if (waves.length <= 1) return waves;

  // Build predecessor map: nodeId -> Set<predecessorNodeId>
  const preds = new Map<string, Set<string>>();
  for (const node of graph.nodes) preds.set(node.id, new Set());
  for (const edge of graph.edges) {
    const fromNode = edge.from.split(".")[0];
    const toNode = edge.to.split(".")[0];
    if (preds.has(toNode)) preds.get(toNode)!.add(fromNode);
  }

  // For each wave (after the first), sort by average x-position of predecessors in previous wave
  const result: string[][] = [waves[0]];
  for (let w = 1; w < waves.length; w++) {
    const prevPositions = new Map<string, number>();
    result[w - 1].forEach((id, i) => prevPositions.set(id, i));

    const sorted = [...waves[w]].sort((a, b) => {
      const avgA = averagePredPosition(a, preds, prevPositions);
      const avgB = averagePredPosition(b, preds, prevPositions);
      return avgA - avgB;
    });
    result.push(sorted);
  }

  return result;
}

function averagePredPosition(
  nodeId: string,
  preds: Map<string, Set<string>>,
  positions: Map<string, number>,
): number {
  const predSet = preds.get(nodeId);
  if (!predSet || predSet.size === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const p of predSet) {
    if (positions.has(p)) {
      sum += positions.get(p)!;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Layout a graph by computing wave positions for all nodes.
 */
export function layoutGraph(
  graph: AetherGraph,
  options?: LayoutOptions,
): LayoutResult {
  const opts = { ...DEFAULTS, ...options };
  const positions = new Map<string, { x: number; y: number }>();

  if (graph.nodes.length === 0) {
    return { positions, dimensions: { width: 0, height: 0 } };
  }

  const waves = computeWaves(graph);
  const orderedWaves = minimizeCrossings(waves, graph);

  let maxX = 0;
  let maxY = 0;

  for (let w = 0; w < orderedWaves.length; w++) {
    const wave = orderedWaves[w];
    const waveWidth = wave.length * opts.nodeWidth + (wave.length - 1) * opts.horizontalGap;

    for (let i = 0; i < wave.length; i++) {
      let x: number, y: number;

      if (opts.direction === "top-down") {
        // Center nodes horizontally within wave
        const startX = -waveWidth / 2 + opts.nodeWidth / 2;
        x = startX + i * (opts.nodeWidth + opts.horizontalGap);
        y = w * (opts.nodeHeight + opts.verticalGap);
      } else {
        // left-right: x by wave, y by position in wave
        const waveHeight = wave.length * opts.nodeHeight + (wave.length - 1) * opts.verticalGap;
        const startY = -waveHeight / 2 + opts.nodeHeight / 2;
        x = w * (opts.nodeWidth + opts.horizontalGap);
        y = startY + i * (opts.nodeHeight + opts.verticalGap);
      }

      positions.set(wave[i], { x, y });
      maxX = Math.max(maxX, x + opts.nodeWidth);
      maxY = Math.max(maxY, y + opts.nodeHeight);
    }
  }

  // Normalize: shift all positions so minimum is at padding
  const padding = 40;
  let minX = Infinity, minY = Infinity;
  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
  }
  for (const pos of positions.values()) {
    pos.x -= minX - padding;
    pos.y -= minY - padding;
  }

  const width = maxX - minX + opts.nodeWidth + padding * 2;
  const height = maxY - minY + opts.nodeHeight + padding * 2;

  return { positions, dimensions: { width, height } };
}
