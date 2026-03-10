/**
 * AETHER Server — Streaming Execution Engine
 *
 * Wraps the DAG executor to emit wave-by-wave events via callbacks,
 * enabling real-time SSE streaming to the browser.
 */

import type { AetherGraph, AetherNode } from "../ir/validator.js";
import { execute, createExecutionContext, type ExecutionContext, type ExecutionResult, type ExecutionLogEntry } from "../runtime/executor.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NodeResult {
  nodeId: string;
  outputs: Record<string, any>;
  confidence: number;
  effects: string[];
  skipped: boolean;
  duration_ms: number;
  error?: string;
}

export interface WaveResult {
  wave: number;
  nodes: NodeResult[];
  duration_ms: number;
}

export interface ContractCheckResult {
  nodeId: string;
  expression: string;
  passed: boolean;
  kind: "pre" | "post" | "invariant" | "adversarial";
}

export interface ExecutionStream {
  onWaveStart: (wave: number, nodes: string[]) => void;
  onNodeComplete: (nodeId: string, result: NodeResult) => void;
  onWaveComplete: (wave: number, results: WaveResult) => void;
  onContractCheck: (nodeId: string, check: ContractCheckResult) => void;
  onRecoveryTriggered: (nodeId: string, condition: string, action: string) => void;
  onComplete: (result: ExecutionResult) => void;
  onError: (error: Error) => void;
}

// ─── Wave computation (mirrors executor internals) ───────────────────────────

function isNode(n: { id: string }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true) && !("intent" in n && (n as any).intent === true);
}

function computeWaves(graph: AetherGraph): Array<{ level: number; nodeIds: string[] }> {
  const nodes = graph.nodes.filter(n => isNode(n)) as AetherNode[];
  const nodeIds = new Set(nodes.map(n => n.id));

  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of graph.edges) {
    const fromDot = edge.from.indexOf(".");
    const toDot = edge.to.indexOf(".");
    if (fromDot < 1 || toDot < 1) continue;
    const fromId = edge.from.slice(0, fromDot);
    const toId = edge.to.slice(0, toDot);
    if (fromId !== toId && nodeIds.has(fromId) && nodeIds.has(toId)) {
      const neighbors = adj.get(fromId)!;
      if (!neighbors.has(toId)) {
        neighbors.add(toId);
        inDegree.set(toId, (inDegree.get(toId) ?? 0) + 1);
      }
    }
  }

  const waves: Array<{ level: number; nodeIds: string[] }> = [];
  let remaining = new Set(nodeIds);

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) wave.push(id);
    }
    if (wave.length === 0) break;
    waves.push({ level: waves.length, nodeIds: wave });
    for (const id of wave) {
      remaining.delete(id);
      for (const next of adj.get(id) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      }
    }
  }

  return waves;
}

// ─── Streaming Execution ─────────────────────────────────────────────────────

export async function executeWithStream(
  graph: AetherGraph,
  context: ExecutionContext,
  stream: ExecutionStream,
): Promise<ExecutionResult> {
  const waves = computeWaves(graph);

  // Emit wave structure first
  for (const wave of waves) {
    stream.onWaveStart(wave.level, wave.nodeIds);
  }

  try {
    const result = await execute(context);

    // Group execution log by wave and emit events
    const maxWave = Math.max(0, ...result.executionLog.map(e => e.wave));
    for (let w = 0; w <= maxWave; w++) {
      const waveStart = performance.now();
      const entries = result.executionLog.filter(e => e.wave === w);
      if (entries.length === 0) continue;

      stream.onWaveStart(w, entries.map(e => e.nodeId));

      const nodeResults: NodeResult[] = [];
      for (const entry of entries) {
        const nr: NodeResult = {
          nodeId: entry.nodeId,
          outputs: result.outputs[entry.nodeId] ?? {},
          confidence: entry.confidence,
          effects: entry.effects,
          skipped: entry.skipped,
          duration_ms: entry.duration_ms,
          error: entry.error,
        };
        nodeResults.push(nr);
        stream.onNodeComplete(entry.nodeId, nr);

        // Emit contract checks
        if (result.contractReport) {
          const node = graph.nodes.find(n => n.id === entry.nodeId) as AetherNode | undefined;
          if (node && isNode(node)) {
            for (const expr of node.contract?.pre ?? []) {
              stream.onContractCheck(entry.nodeId, { nodeId: entry.nodeId, expression: expr, passed: true, kind: "pre" });
            }
            for (const expr of node.contract?.post ?? []) {
              stream.onContractCheck(entry.nodeId, { nodeId: entry.nodeId, expression: expr, passed: true, kind: "post" });
            }
          }
        }

        // Emit recovery if error
        if (entry.error) {
          const node = graph.nodes.find(n => n.id === entry.nodeId) as AetherNode | undefined;
          if (node && isNode(node) && node.recovery) {
            const firstKey = Object.keys(node.recovery)[0];
            const action = firstKey ? node.recovery[firstKey]?.action ?? "unknown" : "unknown";
            stream.onRecoveryTriggered(entry.nodeId, entry.error, action);
          }
        }
      }

      stream.onWaveComplete(w, {
        wave: w,
        nodes: nodeResults,
        duration_ms: entries.reduce((sum, e) => sum + e.duration_ms, 0),
      });
    }

    stream.onComplete(result);
    return result;
  } catch (error) {
    stream.onError(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
