/**
 * AETHER Runtime — Execution Profiler
 *
 * Tracks execution patterns to identify hot subgraphs worth JIT-compiling.
 * - Records per-node timing, confidence, and recovery events
 * - Detects hot paths (frequently-executed multi-wave chains)
 * - Generates JIT compilation recommendations
 */

import type { AetherGraph, AetherNode, AetherEdge } from "../ir/validator.js";
import type { ExecutionResult } from "./executor.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NodeProfile {
  nodeId: string;
  executionCount: number;
  totalTime_ms: number;
  avgTime_ms: number;
  maxTime_ms: number;
  minTime_ms: number;
  recoveryTriggerCount: number;
  confidenceHistory: number[];
  lastExecuted: number;
}

export interface HotPath {
  nodes: string[];
  executionCount: number;
  avgTotalTime_ms: number;
  wave_count: number;
}

export interface JITRecommendation {
  subgraph: string[];
  reason: string;
  estimatedSpeedup: string;
  priority: "high" | "medium" | "low";
}

export interface ExecutionProfile {
  graphId: string;
  totalExecutions: number;
  nodeProfiles: Map<string, NodeProfile>;
  hotPaths: HotPath[];
  recommendations: JITRecommendation[];
}

interface NodeExecutionEntry {
  nodeId: string;
  duration_ms: number;
  wave: number;
  confidence: number;
  recoveryTriggered: boolean;
}

interface GraphExecutionRecord {
  waveAssignments: Map<string, number>; // nodeId → wave
  totalTime_ms: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNode(n: { id: string; hole?: boolean }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true) && !("intent" in n && (n as any).intent === true);
}

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

// ─── ExecutionProfiler ───────────────────────────────────────────────────────

export class ExecutionProfiler {
  private graphId: string;
  private nodeProfiles: Map<string, NodeProfile> = new Map();
  private totalExecutions: number = 0;
  private executionRecords: GraphExecutionRecord[] = [];
  private currentWaveAssignments: Map<string, number> = new Map();
  private edges: AetherEdge[] = [];
  private nodeIds: Set<string> = new Set();

  constructor(graphId: string) {
    this.graphId = graphId;
  }

  /** Set graph edges for hot path analysis */
  setGraph(graph: AetherGraph): void {
    this.edges = graph.edges;
    for (const n of graph.nodes) {
      if (isNode(n)) this.nodeIds.add(n.id);
    }
  }

  /** Record a single node execution */
  recordNodeExecution(entry: NodeExecutionEntry): void {
    let profile = this.nodeProfiles.get(entry.nodeId);
    if (!profile) {
      profile = {
        nodeId: entry.nodeId,
        executionCount: 0,
        totalTime_ms: 0,
        avgTime_ms: 0,
        maxTime_ms: 0,
        minTime_ms: Infinity,
        recoveryTriggerCount: 0,
        confidenceHistory: [],
        lastExecuted: 0,
      };
      this.nodeProfiles.set(entry.nodeId, profile);
    }

    profile.executionCount++;
    profile.totalTime_ms += entry.duration_ms;
    profile.avgTime_ms = profile.totalTime_ms / profile.executionCount;
    profile.maxTime_ms = Math.max(profile.maxTime_ms, entry.duration_ms);
    profile.minTime_ms = Math.min(profile.minTime_ms, entry.duration_ms);
    if (entry.recoveryTriggered) profile.recoveryTriggerCount++;
    profile.confidenceHistory.push(entry.confidence);
    profile.lastExecuted = Date.now();

    this.currentWaveAssignments.set(entry.nodeId, entry.wave);
  }

  /** Record a full graph execution */
  recordGraphExecution(result: ExecutionResult): void {
    this.totalExecutions++;

    const waveAssignments = new Map<string, number>();
    for (const entry of result.executionLog) {
      waveAssignments.set(entry.nodeId, entry.wave);
    }

    this.executionRecords.push({
      waveAssignments,
      totalTime_ms: result.duration_ms,
    });

    this.currentWaveAssignments = new Map();
  }

  /** Analyze execution patterns */
  analyze(threshold?: {
    minExecutions?: number;
    minAvgTime_ms?: number;
    minNodes?: number;
  }): ExecutionProfile {
    const minExec = threshold?.minExecutions ?? 10;
    const minAvg = threshold?.minAvgTime_ms ?? 5;
    const minNodes = threshold?.minNodes ?? 2;

    const hotPaths = this.detectHotPaths(minExec, minNodes);
    const recommendations = this.generateRecommendations(hotPaths, minExec, minAvg, minNodes);

    return {
      graphId: this.graphId,
      totalExecutions: this.totalExecutions,
      nodeProfiles: new Map(this.nodeProfiles),
      hotPaths,
      recommendations,
    };
  }

  /** Get JIT recommendations */
  getRecommendations(): JITRecommendation[] {
    const profile = this.analyze();
    return profile.recommendations;
  }

  /** Reset all profiling data */
  reset(): void {
    this.nodeProfiles.clear();
    this.totalExecutions = 0;
    this.executionRecords = [];
    this.currentWaveAssignments.clear();
  }

  /** Export profile data as JSON */
  export(): string {
    const data = {
      graphId: this.graphId,
      totalExecutions: this.totalExecutions,
      nodeProfiles: Object.fromEntries(this.nodeProfiles),
      executionRecords: this.executionRecords.map(r => ({
        waveAssignments: Object.fromEntries(r.waveAssignments),
        totalTime_ms: r.totalTime_ms,
      })),
      edges: this.edges,
      nodeIds: [...this.nodeIds],
    };
    return JSON.stringify(data);
  }

  /** Import profile data */
  static import(data: string): ExecutionProfiler {
    const parsed = JSON.parse(data);
    const profiler = new ExecutionProfiler(parsed.graphId);
    profiler.totalExecutions = parsed.totalExecutions;
    profiler.edges = parsed.edges ?? [];
    profiler.nodeIds = new Set(parsed.nodeIds ?? []);

    for (const [id, profile] of Object.entries(parsed.nodeProfiles)) {
      profiler.nodeProfiles.set(id, profile as NodeProfile);
    }

    for (const rec of parsed.executionRecords ?? []) {
      profiler.executionRecords.push({
        waveAssignments: new Map(Object.entries(rec.waveAssignments).map(([k, v]) => [k, v as number])),
        totalTime_ms: rec.totalTime_ms,
      });
    }

    return profiler;
  }

  // ─── Hot Path Detection ──────────────────────────────────────────────────

  private detectHotPaths(minExecutions: number, minNodes: number): HotPath[] {
    if (this.executionRecords.length === 0) return [];

    // Build adjacency from edges
    const adj = new Map<string, Set<string>>();
    const nodeIdsInProfile = new Set(this.nodeProfiles.keys());

    for (const edge of this.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to && nodeIdsInProfile.has(from.nodeId) && nodeIdsInProfile.has(to.nodeId)) {
        if (!adj.has(from.nodeId)) adj.set(from.nodeId, new Set());
        adj.get(from.nodeId)!.add(to.nodeId);
      }
    }

    // Find all paths where every node has been executed >= minExecutions
    const hotNodes = new Set<string>();
    for (const [id, profile] of this.nodeProfiles) {
      if (profile.executionCount >= minExecutions) {
        hotNodes.add(id);
      }
    }

    // Find paths via DFS from each hot source node
    const allPaths: string[][] = [];
    const sources = [...hotNodes].filter(id => {
      // Sources: nodes with no hot predecessors in this graph
      for (const edge of this.edges) {
        const from = parseEdgeRef(edge.from);
        const to = parseEdgeRef(edge.to);
        if (to && to.nodeId === id && from && hotNodes.has(from.nodeId)) {
          return false;
        }
      }
      return true;
    });

    for (const source of sources) {
      this.dfsPath(source, [source], adj, hotNodes, allPaths);
    }

    // Filter by minNodes and convert to HotPath
    const hotPaths: HotPath[] = [];
    const seen = new Set<string>();

    for (const path of allPaths) {
      if (path.length < minNodes) continue;

      const key = path.join(",");
      if (seen.has(key)) continue;
      seen.add(key);

      // Calculate wave count from last execution record
      const lastRecord = this.executionRecords[this.executionRecords.length - 1];
      const waves = new Set<number>();
      for (const nodeId of path) {
        const wave = lastRecord?.waveAssignments.get(nodeId);
        if (wave !== undefined) waves.add(wave);
      }

      // Only recommend if crossing >= 2 waves
      if (waves.size < 2) continue;

      // Calculate avg total time for this path
      const avgTime = path.reduce((sum, id) => {
        const p = this.nodeProfiles.get(id);
        return sum + (p?.avgTime_ms ?? 0);
      }, 0);

      const minExecCount = Math.min(
        ...path.map(id => this.nodeProfiles.get(id)?.executionCount ?? 0)
      );

      hotPaths.push({
        nodes: path,
        executionCount: minExecCount,
        avgTotalTime_ms: avgTime,
        wave_count: waves.size,
      });
    }

    // Sort by score: executions × avgTime × nodeCount
    hotPaths.sort((a, b) => {
      const scoreA = a.executionCount * a.avgTotalTime_ms * a.nodes.length;
      const scoreB = b.executionCount * b.avgTotalTime_ms * b.nodes.length;
      return scoreB - scoreA;
    });

    // Merge overlapping paths
    return this.mergeOverlapping(hotPaths);
  }

  private dfsPath(
    current: string,
    path: string[],
    adj: Map<string, Set<string>>,
    hotNodes: Set<string>,
    results: string[][]
  ): void {
    const neighbors = adj.get(current);
    let extended = false;

    if (neighbors) {
      for (const next of neighbors) {
        if (hotNodes.has(next) && !path.includes(next)) {
          path.push(next);
          this.dfsPath(next, path, adj, hotNodes, results);
          path.pop();
          extended = true;
        }
      }
    }

    if (!extended && path.length >= 2) {
      results.push([...path]);
    }
  }

  private mergeOverlapping(paths: HotPath[]): HotPath[] {
    if (paths.length <= 1) return paths;

    const merged: HotPath[] = [];
    const used = new Set<number>();

    for (let i = 0; i < paths.length; i++) {
      if (used.has(i)) continue;

      let current = paths[i];
      used.add(i);

      for (let j = i + 1; j < paths.length; j++) {
        if (used.has(j)) continue;

        const overlap = paths[j].nodes.filter(n => current.nodes.includes(n));
        if (overlap.length > 0) {
          // Merge: union of node sets
          const mergedNodes = [...new Set([...current.nodes, ...paths[j].nodes])];
          current = {
            nodes: mergedNodes,
            executionCount: Math.min(current.executionCount, paths[j].executionCount),
            avgTotalTime_ms: current.avgTotalTime_ms + paths[j].avgTotalTime_ms - overlap.reduce((s, id) => s + (this.nodeProfiles.get(id)?.avgTime_ms ?? 0), 0),
            wave_count: Math.max(current.wave_count, paths[j].wave_count),
          };
          used.add(j);
        }
      }

      merged.push(current);
    }

    return merged;
  }

  private generateRecommendations(
    hotPaths: HotPath[],
    minExec: number,
    minAvg: number,
    minNodes: number
  ): JITRecommendation[] {
    const recommendations: JITRecommendation[] = [];

    for (const path of hotPaths) {
      if (path.nodes.length < minNodes) continue;

      const priority: "high" | "medium" | "low" =
        path.executionCount >= 100 ? "high" :
        path.executionCount >= 50 ? "medium" : "low";

      const overhead = path.wave_count > 1 ? `${path.wave_count} waves → 1 function` : "inline optimization";
      const speedupPercent = Math.min(90, Math.round(((path.wave_count - 1) / path.wave_count) * 60 + 10));

      recommendations.push({
        subgraph: path.nodes,
        reason: `executed ${path.executionCount}+ times, avg ${path.avgTotalTime_ms.toFixed(1)}ms, ${overhead}`,
        estimatedSpeedup: `~${speedupPercent}% reduction in overhead`,
        priority,
      });
    }

    return recommendations;
  }
}
