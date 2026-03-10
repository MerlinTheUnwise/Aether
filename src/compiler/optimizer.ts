/**
 * AETHER Compiler — Graph Optimizer
 *
 * Static graph optimizer — analyzes graph structure and suggests optimizations
 * using 11 rule-based analysis passes. Does NOT modify the graph unless
 * explicitly asked via apply(). The human decides what to apply.
 *
 * Optimization types:
 * - merge_sequential_pure: merge pure nodes in strict sequence
 * - parallelize_independent: nodes in different waves with no dependency
 * - eliminate_redundant: duplicate computation detected
 * - strengthen_contract: contract weaker than what consumers assume
 * - add_missing_adversarial: confidence near threshold, no adversarial check
 * - cache_expensive_node: effectful node called repeatedly
 * - reduce_wave_count: restructure edges to reduce waves
 * - split_oversized_node: node has too many postconditions/inputs
 * - add_missing_recovery: effectful node with minimal recovery
 * - improve_confidence: confidence could be higher with minor changes
 * - scope_decomposition: large unscoped graph could benefit from scoping
 */

import type { AetherGraph, AetherNode, AetherEdge, TypeAnnotation } from "../ir/validator.js";
import type { ExecutionProfile, NodeProfile } from "../runtime/profiler.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OptimizationType =
  | "merge_sequential_pure"
  | "parallelize_independent"
  | "eliminate_redundant"
  | "strengthen_contract"
  | "add_missing_adversarial"
  | "cache_expensive_node"
  | "reduce_wave_count"
  | "split_oversized_node"
  | "add_missing_recovery"
  | "improve_confidence"
  | "scope_decomposition";

export interface OptimizationSuggestion {
  id: string;
  type: OptimizationType;
  priority: "high" | "medium" | "low";
  description: string;
  affectedNodes: string[];
  estimatedImpact: string;
  autoApplicable: boolean;
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

function computeWaves(graph: AetherGraph): string[][] {
  const nodes = graph.nodes.filter(n => isNode(n)) as AetherNode[];
  const nodeIds = new Set(nodes.map(n => n.id));
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of graph.edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to && nodeIds.has(from.nodeId) && nodeIds.has(to.nodeId) && from.nodeId !== to.nodeId) {
      if (!adj.get(from.nodeId)!.has(to.nodeId)) {
        adj.get(from.nodeId)!.add(to.nodeId);
        inDegree.set(to.nodeId, (inDegree.get(to.nodeId) ?? 0) + 1);
      }
    }
  }

  const waves: string[][] = [];
  const remaining = new Set(nodeIds);

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) wave.push(id);
    }
    if (wave.length === 0) break;
    waves.push(wave);
    for (const id of wave) {
      remaining.delete(id);
      for (const next of adj.get(id) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      }
    }
  }

  return waves;
}

/** Get all consumers of a node's outputs */
function getConsumers(nodeId: string, edges: AetherEdge[]): Set<string> {
  const consumers = new Set<string>();
  for (const edge of edges) {
    const from = parseEdgeRef(edge.from);
    if (from && from.nodeId === nodeId) {
      const to = parseEdgeRef(edge.to);
      if (to) consumers.add(to.nodeId);
    }
  }
  return consumers;
}

/** Get all producers feeding into a node */
function getProducers(nodeId: string, edges: AetherEdge[]): Set<string> {
  const producers = new Set<string>();
  for (const edge of edges) {
    const to = parseEdgeRef(edge.to);
    if (to && to.nodeId === nodeId) {
      const from = parseEdgeRef(edge.from);
      if (from) producers.add(from.nodeId);
    }
  }
  return producers;
}

// ─── GraphOptimizer ──────────────────────────────────────────────────────────

export class GraphOptimizer {
  private suggestionCounter = 0;

  /** Analyze a graph and return all suggestions */
  analyze(graph: AetherGraph, profile?: ExecutionProfile): OptimizationSuggestion[] {
    this.suggestionCounter = 0; // Reset counter for deterministic IDs
    const suggestions: OptimizationSuggestion[] = [];
    const nodes = graph.nodes.filter(n => isNode(n)) as AetherNode[];
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const waves = computeWaves(graph);

    // Build wave assignment map
    const nodeWave = new Map<string, number>();
    for (let i = 0; i < waves.length; i++) {
      for (const id of waves[i]) nodeWave.set(id, i);
    }

    // Build adjacency
    const adj = new Map<string, Set<string>>();
    const revAdj = new Map<string, Set<string>>();
    for (const id of nodeMap.keys()) {
      adj.set(id, new Set());
      revAdj.set(id, new Set());
    }
    for (const edge of graph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to && nodeMap.has(from.nodeId) && nodeMap.has(to.nodeId) && from.nodeId !== to.nodeId) {
        adj.get(from.nodeId)!.add(to.nodeId);
        revAdj.get(to.nodeId)!.add(from.nodeId);
      }
    }

    // 1. merge_sequential_pure
    suggestions.push(...this.checkMergeSequentialPure(nodes, nodeMap, adj, graph.edges, profile));

    // 2. parallelize_independent
    suggestions.push(...this.checkParallelizeIndependent(nodes, nodeMap, nodeWave, adj, revAdj));

    // 3. eliminate_redundant
    suggestions.push(...this.checkEliminateRedundant(nodes, nodeMap, graph.edges));

    // 4. add_missing_adversarial
    suggestions.push(...this.checkAddMissingAdversarial(nodes));

    // 5. split_oversized_node
    suggestions.push(...this.checkSplitOversizedNode(nodes));

    // 6. scope_decomposition
    suggestions.push(...this.checkScopeDecomposition(graph, nodes));

    // 7. cache_expensive_node
    suggestions.push(...this.checkCacheExpensiveNode(nodes, graph.edges, profile));

    // 8. add_missing_recovery
    suggestions.push(...this.checkAddMissingRecovery(nodes));

    // 9. reduce_wave_count
    suggestions.push(...this.checkReduceWaveCount(waves, adj, revAdj, profile));

    return suggestions;
  }

  /** Apply a specific auto-applicable suggestion, returning modified graph */
  apply(graph: AetherGraph, suggestionId: string): AetherGraph {
    const suggestions = this.analyze(graph);
    const suggestion = suggestions.find(s => s.id === suggestionId);
    if (!suggestion) throw new Error(`Suggestion "${suggestionId}" not found`);
    if (!suggestion.autoApplicable) throw new Error(`Suggestion "${suggestionId}" is not auto-applicable`);

    const clone: AetherGraph = JSON.parse(JSON.stringify(graph));

    switch (suggestion.type) {
      case "merge_sequential_pure":
        return this.applyMerge(clone, suggestion);
      case "eliminate_redundant":
        return this.applyEliminate(clone, suggestion);
      default:
        throw new Error(`Cannot auto-apply "${suggestion.type}"`);
    }
  }

  /** Apply all auto-applicable suggestions */
  applyAll(graph: AetherGraph): { graph: AetherGraph; applied: string[]; skipped: string[]; modifications: string[] } {
    let current: AetherGraph = JSON.parse(JSON.stringify(graph));
    const applied: string[] = [];
    const skipped: string[] = [];
    const modifications: string[] = [];

    // Analyze once, apply all auto-applicable ones in order
    const suggestions = this.analyze(current);
    for (const s of suggestions) {
      if (s.autoApplicable) {
        try {
          current = this.apply(current, s.id);
          applied.push(s.id);
          modifications.push(`Applied ${s.type}: ${s.description}`);
        } catch (e) {
          skipped.push(s.id);
          modifications.push(`Skipped ${s.id}: ${(e as Error).message}`);
        }
      } else {
        skipped.push(s.id);
      }
    }

    return { graph: current, applied, skipped, modifications };
  }

  // ─── Analysis Rules ─────────────────────────────────────────────────────

  private nextId(type: string): string {
    return `opt_${type}_${++this.suggestionCounter}`;
  }

  private checkMergeSequentialPure(
    nodes: AetherNode[],
    nodeMap: Map<string, AetherNode>,
    adj: Map<string, Set<string>>,
    edges: AetherEdge[],
    profile?: ExecutionProfile,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    for (const node of nodes) {
      if (!node.pure) continue;
      const consumers = adj.get(node.id);
      if (!consumers || consumers.size !== 1) continue;

      const targetId = [...consumers][0];
      const target = nodeMap.get(targetId);
      if (!target || !target.pure) continue;

      // Check that node has no other consumers
      const allConsumers = getConsumers(node.id, edges);
      if (allConsumers.size !== 1) continue;

      let impact = "Reduce wave count by 1, fewer function calls";
      if (profile) {
        const p1 = profile.nodeProfiles.get(node.id);
        const p2 = profile.nodeProfiles.get(targetId);
        if (p1 && p2) {
          const savings = Math.min(p1.avgTime_ms, p2.avgTime_ms) * 0.3;
          impact = `~${savings.toFixed(1)}ms savings per execution`;
        }
      }

      suggestions.push({
        id: this.nextId("merge"),
        type: "merge_sequential_pure",
        priority: "high",
        description: `Merge pure nodes "${node.id}" → "${targetId}" (strict sequence, no external consumers)`,
        affectedNodes: [node.id, targetId],
        estimatedImpact: impact,
        autoApplicable: true,
      });
    }

    return suggestions;
  }

  private checkParallelizeIndependent(
    nodes: AetherNode[],
    nodeMap: Map<string, AetherNode>,
    nodeWave: Map<string, number>,
    adj: Map<string, Set<string>>,
    revAdj: Map<string, Set<string>>,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const checked = new Set<string>();

    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id >= b.id) continue;
        const key = `${a.id}:${b.id}`;
        if (checked.has(key)) continue;
        checked.add(key);

        const waveA = nodeWave.get(a.id) ?? -1;
        const waveB = nodeWave.get(b.id) ?? -1;
        if (waveA === waveB) continue; // already parallel

        // Check no data dependency in either direction
        const hasDep = this.hasTransitiveDep(a.id, b.id, adj) || this.hasTransitiveDep(b.id, a.id, adj);
        if (hasDep) continue;

        suggestions.push({
          id: this.nextId("parallel"),
          type: "parallelize_independent",
          priority: "medium",
          description: `"${a.id}" (wave ${waveA}) and "${b.id}" (wave ${waveB}) have no dependency — could be parallel`,
          affectedNodes: [a.id, b.id],
          estimatedImpact: "May reduce total wave count",
          autoApplicable: false,
        });
      }
    }

    return suggestions;
  }

  private hasTransitiveDep(from: string, to: string, adj: Map<string, Set<string>>): boolean {
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of adj.get(current) ?? []) {
        queue.push(next);
      }
    }
    return false;
  }

  private checkEliminateRedundant(
    nodes: AetherNode[],
    nodeMap: Map<string, AetherNode>,
    edges: AetherEdge[],
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const checked = new Set<string>();

    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id >= b.id) continue;
        const key = `${a.id}:${b.id}`;
        if (checked.has(key)) continue;
        checked.add(key);

        // Check if nodes have same inputs, same outputs, and same contracts
        if (JSON.stringify(a.in) !== JSON.stringify(b.in)) continue;
        if (JSON.stringify(a.out) !== JSON.stringify(b.out)) continue;
        if (JSON.stringify(a.contract) !== JSON.stringify(b.contract)) continue;
        if (JSON.stringify(a.effects) !== JSON.stringify(b.effects)) continue;

        // Check same input sources
        const aProducers = getProducers(a.id, edges);
        const bProducers = getProducers(b.id, edges);
        if (aProducers.size !== bProducers.size) continue;
        let sameInputs = true;
        for (const p of aProducers) {
          if (!bProducers.has(p)) { sameInputs = false; break; }
        }
        if (!sameInputs) continue;

        suggestions.push({
          id: this.nextId("redundant"),
          type: "eliminate_redundant",
          priority: "high",
          description: `"${a.id}" and "${b.id}" have identical contracts, inputs, and outputs — "${b.id}" is redundant`,
          affectedNodes: [a.id, b.id],
          estimatedImpact: "Eliminate duplicate computation",
          autoApplicable: true,
        });
      }
    }

    return suggestions;
  }

  private checkAddMissingAdversarial(nodes: AetherNode[]): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    for (const node of nodes) {
      const conf = node.confidence ?? 1.0;
      if (conf >= 0.85 && conf <= 0.90) {
        const nodeAny = node as any;
        const hasAdversarial = nodeAny.adversarial_check &&
          nodeAny.adversarial_check.break_if &&
          nodeAny.adversarial_check.break_if.length > 0;

        if (!hasAdversarial) {
          suggestions.push({
            id: this.nextId("adversarial"),
            type: "add_missing_adversarial",
            priority: "medium",
            description: `"${node.id}" has confidence ${conf.toFixed(2)} (near threshold) without adversarial check`,
            affectedNodes: [node.id],
            estimatedImpact: "Better error detection, improved robustness",
            autoApplicable: false,
          });
        }
      }
    }

    return suggestions;
  }

  private checkSplitOversizedNode(nodes: AetherNode[]): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    for (const node of nodes) {
      const postCount = node.contract.post?.length ?? 0;
      const inputCount = Object.keys(node.in).length;

      if (postCount > 5 || inputCount > 4) {
        const reason = postCount > 5
          ? `${postCount} postconditions`
          : `${inputCount} input ports`;

        suggestions.push({
          id: this.nextId("split"),
          type: "split_oversized_node",
          priority: "medium",
          description: `"${node.id}" has ${reason} — consider decomposing`,
          affectedNodes: [node.id],
          estimatedImpact: "Improved modularity and testability",
          autoApplicable: false,
        });
      }
    }

    return suggestions;
  }

  private checkScopeDecomposition(graph: AetherGraph, nodes: AetherNode[]): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const scopes = (graph as any).scopes as any[] | undefined;

    if (nodes.length >= 10 && (!scopes || scopes.length === 0)) {
      // Suggest logical groupings based on effect clusters
      const effectGroups = new Map<string, string[]>();
      for (const node of nodes) {
        const effectKey = node.effects.length > 0 ? node.effects.sort().join(",") : "pure";
        if (!effectGroups.has(effectKey)) effectGroups.set(effectKey, []);
        effectGroups.get(effectKey)!.push(node.id);
      }

      const groupNames = [...effectGroups.keys()].map(k => k === "pure" ? "pure" : k.split(",")[0]);

      suggestions.push({
        id: this.nextId("scope"),
        type: "scope_decomposition",
        priority: "low",
        description: `Graph has ${nodes.length} nodes and no scopes — could group by: [${groupNames.join(", ")}]`,
        affectedNodes: nodes.map(n => n.id),
        estimatedImpact: "Better modularity and agent collaboration",
        autoApplicable: false,
      });
    }

    return suggestions;
  }

  private checkCacheExpensiveNode(
    nodes: AetherNode[],
    edges: AetherEdge[],
    profile?: ExecutionProfile,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    for (const node of nodes) {
      if (node.pure) continue;
      const hasExpensiveEffect = node.effects.some(e =>
        e.includes("database.read") || e.includes("network") || e.includes("api")
      );
      if (!hasExpensiveEffect) continue;

      let impact = "Reduce redundant external calls";
      if (profile) {
        const np = profile.nodeProfiles.get(node.id);
        if (np && np.executionCount > 1) {
          impact = `Called ${np.executionCount} times, avg ${np.avgTime_ms.toFixed(1)}ms — cache could save ~${((np.executionCount - 1) * np.avgTime_ms).toFixed(0)}ms`;
        }
      }

      suggestions.push({
        id: this.nextId("cache"),
        type: "cache_expensive_node",
        priority: "medium",
        description: `"${node.id}" has expensive effects (${node.effects.join(", ")}) — consider caching`,
        affectedNodes: [node.id],
        estimatedImpact: impact,
        autoApplicable: false,
      });
    }

    return suggestions;
  }

  private checkAddMissingRecovery(nodes: AetherNode[]): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    for (const node of nodes) {
      if (node.pure) continue;
      if (node.effects.length === 0) continue;

      const recoveryKeys = node.recovery ? Object.keys(node.recovery) : [];
      if (recoveryKeys.length <= 1) {
        suggestions.push({
          id: this.nextId("recovery"),
          type: "add_missing_recovery",
          priority: "low",
          description: `"${node.id}" has ${node.effects.length} effect(s) but only ${recoveryKeys.length} recovery handler(s)`,
          affectedNodes: [node.id],
          estimatedImpact: "Improved resilience",
          autoApplicable: false,
        });
      }
    }

    return suggestions;
  }

  private checkReduceWaveCount(
    waves: string[][],
    adj: Map<string, Set<string>>,
    revAdj: Map<string, Set<string>>,
    profile?: ExecutionProfile,
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    if (waves.length <= 2) return suggestions;

    // Check if any single-node waves could be merged with adjacent waves
    for (let i = 1; i < waves.length; i++) {
      if (waves[i].length === 1) {
        const nodeId = waves[i][0];
        const producers = revAdj.get(nodeId) ?? new Set();

        // Check if all producers are in wave i-2 or earlier (not i-1)
        let canMerge = true;
        for (const prod of producers) {
          const prodWave = waves.findIndex(w => w.includes(prod));
          if (prodWave === i - 1) { canMerge = false; break; }
        }

        if (canMerge && producers.size > 0) {
          let impact = "Reduce wave count by 1";
          if (profile) {
            const np = profile.nodeProfiles.get(nodeId);
            if (np) {
              impact = `Could save ~${(np.avgTime_ms * 0.2).toFixed(1)}ms per execution`;
            }
          }

          suggestions.push({
            id: this.nextId("waves"),
            type: "reduce_wave_count",
            priority: "low",
            description: `"${nodeId}" could potentially be moved to an earlier wave`,
            affectedNodes: [nodeId],
            estimatedImpact: impact,
            autoApplicable: false,
          });
        }
      }
    }

    return suggestions;
  }

  // ─── Apply Logic ────────────────────────────────────────────────────────

  private applyMerge(graph: AetherGraph, suggestion: OptimizationSuggestion): AetherGraph {
    const [sourceId, targetId] = suggestion.affectedNodes;
    const sourceNode = graph.nodes.find(n => isNode(n) && n.id === sourceId) as AetherNode | undefined;
    const targetNode = graph.nodes.find(n => isNode(n) && n.id === targetId) as AetherNode | undefined;
    if (!sourceNode || !targetNode) return graph;

    // Create merged node
    const mergedId = `${sourceId}_${targetId}_merged`;
    const mergedNode: AetherNode = {
      id: mergedId,
      in: { ...sourceNode.in },
      out: { ...targetNode.out },
      contract: {
        pre: [...(sourceNode.contract.pre ?? [])],
        post: [...(sourceNode.contract.post ?? []), ...(targetNode.contract.post ?? [])],
      },
      confidence: Math.min(sourceNode.confidence ?? 1, targetNode.confidence ?? 1),
      effects: [...new Set([...sourceNode.effects, ...targetNode.effects])],
      pure: sourceNode.pure && targetNode.pure,
    };

    // Replace nodes
    graph.nodes = graph.nodes.filter(n => n.id !== sourceId && n.id !== targetId);
    graph.nodes.push(mergedNode);

    // Update edges: redirect edges pointing to source or from target
    graph.edges = graph.edges
      .filter(e => {
        // Remove internal edge between source and target
        const from = parseEdgeRef(e.from);
        const to = parseEdgeRef(e.to);
        if (from && to && from.nodeId === sourceId && to.nodeId === targetId) return false;
        return true;
      })
      .map(e => {
        let newFrom = e.from;
        let newTo = e.to;
        const from = parseEdgeRef(e.from);
        const to = parseEdgeRef(e.to);

        // Redirect edges from source → merged
        if (from && from.nodeId === sourceId) {
          newFrom = `${mergedId}.${from.portName}`;
        }
        // Redirect edges from target → merged
        if (from && from.nodeId === targetId) {
          newFrom = `${mergedId}.${from.portName}`;
        }
        // Redirect edges to source → merged
        if (to && to.nodeId === sourceId) {
          newTo = `${mergedId}.${to.portName}`;
        }
        // Redirect edges to target → merged
        if (to && to.nodeId === targetId) {
          newTo = `${mergedId}.${to.portName}`;
        }

        return { from: newFrom, to: newTo };
      });

    return graph;
  }

  private applyEliminate(graph: AetherGraph, suggestion: OptimizationSuggestion): AetherGraph {
    const [keepId, removeId] = suggestion.affectedNodes;

    // Remove the redundant node
    graph.nodes = graph.nodes.filter(n => n.id !== removeId);

    // Redirect edges that pointed to the removed node's outputs
    graph.edges = graph.edges
      .filter(e => {
        // Remove edges feeding into the removed node
        const to = parseEdgeRef(e.to);
        if (to && to.nodeId === removeId) return false;
        return true;
      })
      .map(e => {
        // Redirect edges from removed node to kept node
        const from = parseEdgeRef(e.from);
        if (from && from.nodeId === removeId) {
          return { from: `${keepId}.${from.portName}`, to: e.to };
        }
        return e;
      });

    return graph;
  }
}
