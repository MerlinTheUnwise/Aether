/**
 * AETHER Runtime — Runtime Code Generator
 *
 * Compiles hot subgraphs into optimized JavaScript functions. Eliminates:
 * - Graph traversal overhead
 * - Dynamic input gathering via map lookups
 * - Wave scheduling overhead (flattened into sequential blocks)
 * - Confidence computation as method calls (inlined as arithmetic)
 * - Effect tracking as method calls (inlined as direct callbacks)
 * - Recovery dispatch (inlined as try/catch with specific conditions)
 *
 * Tiered compilation:
 * - Tier 0: Interpreted (no compilation)
 * - Tier 1: Quick compile (sequential, no contract inlining)
 * - Tier 2: Full compile (parallel waves, contracts/recovery inlined)
 */

import type { AetherGraph, AetherNode, AetherEdge, TypeAnnotation } from "../ir/validator.js";
import type { ExecutionProfile, NodeProfile } from "./profiler.js";
import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CompiledGraphFunction = (
  inputs: Record<string, any>,
  implementations: Map<string, (inputs: Record<string, any>) => Promise<Record<string, any>>>,
  context: { confidenceThreshold: number; onOversight?: Function; onEffect?: Function }
) => Promise<{
  outputs: Record<string, any>;
  confidence: number;
  effects: string[];
  log: string[];
}>;

export interface CompiledFunction {
  id: string;
  sourceNodes: string[];
  fn: CompiledGraphFunction;
  compiledAt: number;
  source: string;
  tier: 1 | 2;
  metadata: {
    nodeCount: number;
    waveCount: number;
    effectiveWaves: number;
    contractsInlined: number;
    recoveriesInlined: number;
  };
}

interface SubgraphInfo {
  nodes: AetherNode[];
  edges: AetherEdge[];
  externalInputs: Map<string, { sourceNode: string; sourcePort: string; targetPort: string }[]>;
  externalOutputs: Map<string, { port: string; targetNode: string; targetPort: string }[]>;
  waves: string[][];
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

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function generateDefault(type: TypeAnnotation): string {
  const t = type.type;
  if (t === "String") return '""';
  if (t === "Bool") return "true";
  if (t === "Int" || t === "Float64") return "0";
  if (t.startsWith("List")) return "[]";
  if (t.startsWith("Map")) return "{}";
  if (t.startsWith("Set")) return "[]";
  return '""';
}

// ─── RuntimeCompiler ─────────────────────────────────────────────────────────────

export class RuntimeCompiler {
  private cache: Map<string, CompiledFunction> = new Map();
  private compilations: number = 0;
  private cacheHits: number = 0;

  /** Compile a subgraph into an optimized function at the specified tier */
  compile(graph: AetherGraph, nodeIds: string[], tier: 1 | 2 = 2): CompiledFunction {
    const hash = this.hashSubgraph(graph, nodeIds) + `_t${tier}`;

    const cached = this.cache.get(hash);
    if (cached) {
      this.cacheHits++;
      return cached;
    }

    this.compilations++;

    const subgraph = this.extractSubgraph(graph, nodeIds);
    const source = tier === 1
      ? this.generateTier1Source(subgraph, graph)
      : this.generateSource(subgraph, graph);

    // Construct the async function from generated source
    // Use AsyncFunction constructor so the generated code can use await
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction(
      "inputs", "implementations", "context",
      source
    ) as CompiledGraphFunction;

    let contractsInlined = 0;
    let recoveriesInlined = 0;
    if (tier === 2) {
      for (const node of subgraph.nodes) {
        contractsInlined += (node.contract.pre?.length ?? 0) + (node.contract.post?.length ?? 0);
        if (node.recovery) recoveriesInlined += Object.keys(node.recovery).length;
      }
    }

    const compiled: CompiledFunction = {
      id: hash,
      sourceNodes: nodeIds,
      fn,
      compiledAt: Date.now(),
      source,
      tier,
      metadata: {
        nodeCount: subgraph.nodes.length,
        waveCount: subgraph.waves.length,
        effectiveWaves: tier === 1 ? 1 : subgraph.waves.length,
        contractsInlined,
        recoveriesInlined,
      },
    };

    this.cache.set(hash, compiled);
    return compiled;
  }

  /** Get cached compilation by subgraph hash */
  getCached(nodeIds: string[]): CompiledFunction | null {
    // We need the graph to compute hash, so search by node set
    for (const [, compiled] of this.cache) {
      const sortedA = [...compiled.sourceNodes].sort();
      const sortedB = [...nodeIds].sort();
      if (sortedA.length === sortedB.length && sortedA.every((v, i) => v === sortedB[i])) {
        this.cacheHits++;
        return compiled;
      }
    }
    return null;
  }

  /** Invalidate cache for a subgraph */
  invalidate(nodeIds: string[]): void {
    for (const [hash, compiled] of this.cache) {
      const sortedA = [...compiled.sourceNodes].sort();
      const sortedB = [...nodeIds].sort();
      if (sortedA.length === sortedB.length && sortedA.every((v, i) => v === sortedB[i])) {
        this.cache.delete(hash);
        return;
      }
    }
  }

  /** Clear all cached compilations */
  clearCache(): void {
    this.cache.clear();
  }

  /** Get compiler stats */
  getStats(): { cached: number; compilations: number; cacheHits: number } {
    return {
      cached: this.cache.size,
      compilations: this.compilations,
      cacheHits: this.cacheHits,
    };
  }

  // ─── Subgraph Extraction ───────────────────────────────────────────────

  private extractSubgraph(graph: AetherGraph, nodeIds: string[]): SubgraphInfo {
    const nodeIdSet = new Set(nodeIds);
    const nodeMap = new Map<string, AetherNode>();

    for (const n of graph.nodes) {
      if (isNode(n) && nodeIdSet.has(n.id)) {
        nodeMap.set(n.id, n);
      }
    }

    const nodes = nodeIds.map(id => nodeMap.get(id)!).filter(Boolean);

    // Internal edges (both endpoints in subgraph)
    const internalEdges: AetherEdge[] = [];
    // External inputs (source outside subgraph)
    const externalInputs = new Map<string, { sourceNode: string; sourcePort: string; targetPort: string }[]>();
    // External outputs (target outside subgraph)
    const externalOutputs = new Map<string, { port: string; targetNode: string; targetPort: string }[]>();

    for (const edge of graph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (!from || !to) continue;

      const fromIn = nodeIdSet.has(from.nodeId);
      const toIn = nodeIdSet.has(to.nodeId);

      if (fromIn && toIn) {
        internalEdges.push(edge);
      } else if (!fromIn && toIn) {
        if (!externalInputs.has(to.nodeId)) externalInputs.set(to.nodeId, []);
        externalInputs.get(to.nodeId)!.push({
          sourceNode: from.nodeId,
          sourcePort: from.portName,
          targetPort: to.portName,
        });
      } else if (fromIn && !toIn) {
        if (!externalOutputs.has(from.nodeId)) externalOutputs.set(from.nodeId, []);
        externalOutputs.get(from.nodeId)!.push({
          port: from.portName,
          targetNode: to.nodeId,
          targetPort: to.portName,
        });
      }
    }

    // Topological sort into waves
    const waves = this.topoSort(nodes, internalEdges);

    return { nodes, edges: internalEdges, externalInputs, externalOutputs, waves };
  }

  private topoSort(nodes: AetherNode[], edges: AetherEdge[]): string[][] {
    const nodeIds = new Set(nodes.map(n => n.id));
    const adj = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const id of nodeIds) {
      adj.set(id, new Set());
      inDegree.set(id, 0);
    }

    for (const edge of edges) {
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
      if (wave.length === 0) break; // cycle guard
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

  // ─── Code Generation ───────────────────────────────────────────────────

  private generateSource(subgraph: SubgraphInfo, graph: AetherGraph): string {
    const lines: string[] = [];
    const nodeMap = new Map(subgraph.nodes.map(n => [n.id, n]));

    // Build internal edge map: targetNodeId.targetPort → sourceNodeId.sourcePort
    const internalEdgeMap = new Map<string, string>();
    for (const edge of subgraph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to) {
        internalEdgeMap.set(`${to.nodeId}.${to.portName}`, `${from.nodeId}.${from.portName}`);
      }
    }

    lines.push("// GENERATED — do not edit");
    lines.push(`// Compiled subgraph: [${subgraph.nodes.map(n => n.id).join(", ")}]`);
    lines.push(`// Original: ${subgraph.nodes.length} nodes, ${subgraph.waves.length} waves`);
    lines.push("");
    lines.push("const log = [];");
    lines.push("const effects = [];");
    lines.push("const t0 = Date.now();");
    lines.push("let final_conf = 1.0;");
    lines.push("");

    const allEffects: string[] = [];

    for (let waveIdx = 0; waveIdx < subgraph.waves.length; waveIdx++) {
      const wave = subgraph.waves[waveIdx];
      lines.push(`// === Wave ${waveIdx} ===`);

      if (wave.length > 1) {
        // Parallel execution within wave
        lines.push(`const [${wave.map(id => `${sanitizeId(id)}_result`).join(", ")}] = await Promise.all([`);
        for (let i = 0; i < wave.length; i++) {
          const nodeId = wave[i];
          const node = nodeMap.get(nodeId)!;
          lines.push(`  (async () => {`);
          this.generateNodeCode(lines, node, nodeMap, subgraph, internalEdgeMap, "    ");
          lines.push(`    return ${sanitizeId(nodeId)}_out;`);
          lines.push(`  })()${i < wave.length - 1 ? "," : ""}`);
        }
        lines.push("]);");
        // Reassign results from Promise.all
        for (let i = 0; i < wave.length; i++) {
          const sId = sanitizeId(wave[i]);
          lines.push(`const ${sId}_out = ${sId}_result;`);
        }
      } else {
        const nodeId = wave[0];
        const node = nodeMap.get(nodeId)!;
        this.generateNodeCode(lines, node, nodeMap, subgraph, internalEdgeMap, "");
      }

      // Confidence and logging for each node in wave
      for (const nodeId of wave) {
        const node = nodeMap.get(nodeId)!;
        const sId = sanitizeId(nodeId);
        const conf = node.confidence ?? 1.0;
        lines.push(`const ${sId}_conf = ${conf};`);
        lines.push(`final_conf = Math.min(final_conf, ${sId}_conf);`);
        lines.push(`log.push("${nodeId}: " + (Date.now() - t0) + "ms conf:" + ${sId}_conf);`);

        for (const effect of node.effects) {
          allEffects.push(effect);
          lines.push(`context.onEffect?.("${nodeId}", "${effect}", {});`);
          lines.push(`effects.push("${effect}");`);
        }
      }

      lines.push("");
    }

    // Collect outputs — last wave's nodes provide the final outputs
    const lastWave = subgraph.waves[subgraph.waves.length - 1];
    lines.push("const _outputs = {};");
    for (const nodeId of subgraph.nodes.map(n => n.id)) {
      const sId = sanitizeId(nodeId);
      lines.push(`_outputs["${nodeId}"] = ${sId}_out;`);
    }

    lines.push("");
    lines.push("return {");
    lines.push("  outputs: _outputs,");
    lines.push("  confidence: final_conf,");
    lines.push(`  effects: effects,`);
    lines.push("  log");
    lines.push("};");

    return lines.join("\n");
  }

  private generateNodeCode(
    lines: string[],
    node: AetherNode,
    nodeMap: Map<string, AetherNode>,
    subgraph: SubgraphInfo,
    internalEdgeMap: Map<string, string>,
    indent: string
  ): void {
    const sId = sanitizeId(node.id);

    // Gather input expressions
    lines.push(`${indent}// ${node.id} (${node.pure ? "pure" : "effectful"}, confidence: ${node.confidence ?? 1.0})`);
    lines.push(`${indent}const impl_${sId} = implementations.get("${node.id}");`);
    lines.push(`${indent}let ${sId}_out;`);

    // Build input object
    const inputEntries: string[] = [];
    for (const portName of Object.keys(node.in)) {
      const edgeKey = `${node.id}.${portName}`;
      const source = internalEdgeMap.get(edgeKey);

      if (source) {
        // Internal edge: reference another node's output
        const [srcNode, srcPort] = source.split(".");
        inputEntries.push(`${indent}  ${portName}: ${sanitizeId(srcNode)}_out${srcPort ? '["' + srcPort + '"]' : ""}`);
      } else {
        // External input or graph input
        const extInputs = subgraph.externalInputs.get(node.id);
        const extInput = extInputs?.find(e => e.targetPort === portName);
        if (extInput) {
          inputEntries.push(`${indent}  ${portName}: inputs["${extInput.sourceNode}.${extInput.sourcePort}"] ?? inputs["${portName}"]`);
        } else {
          inputEntries.push(`${indent}  ${portName}: inputs["${portName}"]`);
        }
      }
    }

    const inputObj = inputEntries.length > 0
      ? `{\n${inputEntries.join(",\n")}\n${indent}}`
      : "{}";

    // Confidence gate
    lines.push(`${indent}const ${sId}_input_conf = final_conf;`);
    lines.push(`${indent}const ${sId}_gate_conf = ${node.confidence ?? 1.0} * ${sId}_input_conf;`);
    lines.push(`${indent}if (${sId}_gate_conf < context.confidenceThreshold) {`);
    lines.push(`${indent}  if (context.onOversight) {`);
    lines.push(`${indent}    ${sId}_out = await context.onOversight("${node.id}", ${sId}_gate_conf, {});`);
    lines.push(`${indent}  } else {`);
    lines.push(`${indent}    log.push("${node.id}: SKIPPED (confidence below threshold)");`);
    // Generate defaults
    const defaults: string[] = [];
    for (const [port, type] of Object.entries(node.out)) {
      defaults.push(`${port}: ${generateDefault(type)}`);
    }
    lines.push(`${indent}    ${sId}_out = {${defaults.join(", ")}};`);
    lines.push(`${indent}  }`);
    lines.push(`${indent}} else if (impl_${sId}) {`);

    // Recovery wrapping
    if (node.recovery && Object.keys(node.recovery).length > 0) {
      lines.push(`${indent}  try {`);
      lines.push(`${indent}    ${sId}_out = await impl_${sId}(${inputObj});`);
      lines.push(`${indent}  } catch (_e${sId}) {`);
      lines.push(`${indent}    let _recovered_${sId} = false;`);

      for (const [condition, action] of Object.entries(node.recovery)) {
        const act = action as { action: string; params?: Record<string, unknown> };
        lines.push(`${indent}    if (!_recovered_${sId} && (_e${sId}.message?.includes("${condition}") || _e${sId}.type === "${condition}")) {`);

        if (act.action === "retry") {
          const count = (act.params?.count as number) ?? (act.params?.attempts as number) ?? 3;
          lines.push(`${indent}      for (let _att = 1; _att <= ${count}; _att++) {`);
          lines.push(`${indent}        await new Promise(r => setTimeout(r, 100 * Math.pow(2, _att)));`);
          lines.push(`${indent}        try {`);
          lines.push(`${indent}          ${sId}_out = await impl_${sId}(${inputObj});`);
          lines.push(`${indent}          _recovered_${sId} = true;`);
          lines.push(`${indent}          break;`);
          lines.push(`${indent}        } catch (_e2) { if (_att === ${count}) throw _e2; }`);
          lines.push(`${indent}      }`);
        } else if (act.action === "fallback") {
          const fallbackDefaults: string[] = [];
          for (const [port, type] of Object.entries(node.out)) {
            fallbackDefaults.push(`${port}: ${generateDefault(type)}`);
          }
          lines.push(`${indent}      ${sId}_out = {${fallbackDefaults.join(", ")}};`);
          lines.push(`${indent}      _recovered_${sId} = true;`);
        } else if (act.action === "escalate") {
          lines.push(`${indent}      if (context.onOversight) {`);
          lines.push(`${indent}        ${sId}_out = await context.onOversight("${node.id}", 0, { error: _e${sId} });`);
          lines.push(`${indent}        _recovered_${sId} = true;`);
          lines.push(`${indent}      } else { throw _e${sId}; }`);
        }

        lines.push(`${indent}    }`);
      }

      lines.push(`${indent}    if (!_recovered_${sId}) throw _e${sId};`);
      lines.push(`${indent}  }`);
    } else {
      lines.push(`${indent}  ${sId}_out = await impl_${sId}(${inputObj});`);
    }

    lines.push(`${indent}} else {`);
    // Stub defaults
    const stubDefaults: string[] = [];
    for (const [port, type] of Object.entries(node.out)) {
      stubDefaults.push(`${port}: ${generateDefault(type)}`);
    }
    lines.push(`${indent}  ${sId}_out = {${stubDefaults.join(", ")}};`);
    lines.push(`${indent}}`);

    // Postcondition checks (only when impl exists)
    if (node.contract.post && node.contract.post.length > 0) {
      lines.push(`${indent}// Postcondition checks`);
      lines.push(`${indent}if (impl_${sId}) {`);
      for (const post of node.contract.post) {
        // Simple postcondition evaluation — complex ones assumed passing
        if (!/∀|∃|<=>|exists\(|forall\(/.test(post)) {
          let js = post
            .replace(/\s*∧\s*/g, " && ")
            .replace(/\s*∨\s*/g, " || ")
            .replace(/¬/g, "!")
            .replace(/\s*≠\s*/g, " !== ")
            .replace(/\s*≤\s*/g, " <= ")
            .replace(/\s*≥\s*/g, " >= ");
          // Replace variable refs with output access
          for (const port of Object.keys(node.out)) {
            js = js.replace(new RegExp(`\\b${port}\\b`, "g"), `${sId}_out["${port}"]`);
          }
          lines.push(`${indent}  // post: ${post}`);
        }
      }
      lines.push(`${indent}}`);
    }
  }

  // ─── Tier 1 Code Generation (Sequential, no contract inlining) ─────────

  private generateTier1Source(subgraph: SubgraphInfo, graph: AetherGraph): string {
    const lines: string[] = [];
    const nodeMap = new Map(subgraph.nodes.map(n => [n.id, n]));

    // Build internal edge map
    const internalEdgeMap = new Map<string, string>();
    for (const edge of subgraph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to) {
        internalEdgeMap.set(`${to.nodeId}.${to.portName}`, `${from.nodeId}.${from.portName}`);
      }
    }

    lines.push("// GENERATED — Tier 1 (sequential, no contract inlining)");
    lines.push(`// Compiled subgraph: [${subgraph.nodes.map(n => n.id).join(", ")}]`);
    lines.push("");
    lines.push("const log = [];");
    lines.push("const effects = [];");
    lines.push("const t0 = Date.now();");
    lines.push("let final_conf = 1.0;");
    lines.push("");

    // Flatten all waves into sequential execution (no Promise.all)
    for (let waveIdx = 0; waveIdx < subgraph.waves.length; waveIdx++) {
      const wave = subgraph.waves[waveIdx];
      lines.push(`// === Wave ${waveIdx} (sequential) ===`);

      for (const nodeId of wave) {
        const node = nodeMap.get(nodeId)!;
        // Use the same node code generation but always sequential
        this.generateNodeCode(lines, node, nodeMap, subgraph, internalEdgeMap, "");

        const sId = sanitizeId(nodeId);
        const conf = node.confidence ?? 1.0;
        lines.push(`const ${sId}_conf = ${conf};`);
        lines.push(`final_conf = Math.min(final_conf, ${sId}_conf);`);
        lines.push(`log.push("${nodeId}: " + (Date.now() - t0) + "ms conf:" + ${sId}_conf);`);

        for (const effect of node.effects) {
          lines.push(`context.onEffect?.("${nodeId}", "${effect}", {});`);
          lines.push(`effects.push("${effect}");`);
        }
        lines.push("");
      }
    }

    // Collect outputs
    lines.push("const _outputs = {};");
    for (const nodeId of subgraph.nodes.map(n => n.id)) {
      const sId = sanitizeId(nodeId);
      lines.push(`_outputs["${nodeId}"] = ${sId}_out;`);
    }

    lines.push("");
    lines.push("return {");
    lines.push("  outputs: _outputs,");
    lines.push("  confidence: final_conf,");
    lines.push("  effects: effects,");
    lines.push("  log");
    lines.push("};");

    return lines.join("\n");
  }

  // ─── Hashing ───────────────────────────────────────────────────────────

  private hashSubgraph(graph: AetherGraph, nodeIds: string[]): string {
    const sorted = [...nodeIds].sort();
    const nodeMap = new Map<string, AetherNode>();
    for (const n of graph.nodes) {
      if (isNode(n)) nodeMap.set(n.id, n);
    }

    const parts: string[] = [];
    for (const id of sorted) {
      const node = nodeMap.get(id);
      if (node) {
        parts.push(`${id}:${JSON.stringify(node.contract)}:${JSON.stringify(node.in)}:${JSON.stringify(node.out)}`);
      }
    }

    // Include edge structure
    for (const edge of graph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to) {
        const fromIn = sorted.includes(from.nodeId);
        const toIn = sorted.includes(to.nodeId);
        if (fromIn || toIn) {
          parts.push(`edge:${edge.from}->${edge.to}`);
        }
      }
    }

    const hash = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12);
    return `compiled_${hash}`;
  }
}

// ─── TierManager ──────────────────────────────────────────────────────────────

export class TierManager {
  private tiers: Map<string, 0 | 1 | 2> = new Map();
  private deoptCounts: Map<string, number> = new Map();
  private deoptLog: Array<{ subgraphHash: string; reason: string; timestamp: number }> = [];
  private blacklisted: Set<string> = new Set();

  /** Decide which tier a subgraph should be at based on profiling data */
  recommendTier(profile: NodeProfile[], executionCount: number): 0 | 1 | 2 {
    if (executionCount >= 20) return 2;
    if (executionCount >= 5) return 1;
    return 0;
  }

  /** Get the current tier for a subgraph */
  getTier(subgraphHash: string): 0 | 1 | 2 {
    if (this.blacklisted.has(subgraphHash)) return 0;
    return this.tiers.get(subgraphHash) ?? 0;
  }

  /** Promote a subgraph to the next tier */
  promote(subgraphHash: string, compiler: RuntimeCompiler, graph: AetherGraph, nodeIds: string[]): void {
    if (this.blacklisted.has(subgraphHash)) return;

    const current = this.getTier(subgraphHash);
    if (current >= 2) return;

    const nextTier = (current + 1) as 1 | 2;
    this.tiers.set(subgraphHash, nextTier);
    compiler.compile(graph, nodeIds, nextTier);
  }

  /** Check if a subgraph should be promoted based on new profiling data */
  shouldPromote(subgraphHash: string, profile: ExecutionProfile): boolean {
    if (this.blacklisted.has(subgraphHash)) return false;

    const current = this.getTier(subgraphHash);
    if (current >= 2) return false;

    const profiles = [...profile.nodeProfiles.values()];
    const rec = this.recommendTier(profiles, profile.totalExecutions);
    return rec > current;
  }

  /** Deoptimize: invalidate compilation, fall back to interpreter */
  deoptimize(subgraphHash: string, reason: string): void {
    this.tiers.set(subgraphHash, 0);
    const count = (this.deoptCounts.get(subgraphHash) ?? 0) + 1;
    this.deoptCounts.set(subgraphHash, count);
    this.deoptLog.push({ subgraphHash, reason, timestamp: Date.now() });

    // Blacklist after 3 deoptimizations
    if (count >= 3) {
      this.blacklisted.add(subgraphHash);
    }
  }

  /** Check if a subgraph is blacklisted from compilation */
  isBlacklisted(subgraphHash: string): boolean {
    return this.blacklisted.has(subgraphHash);
  }

  /** Get deoptimization count for a subgraph */
  getDeoptCount(subgraphHash: string): number {
    return this.deoptCounts.get(subgraphHash) ?? 0;
  }

  /** Get the deoptimization log */
  getDeoptLog(): Array<{ subgraphHash: string; reason: string; timestamp: number }> {
    return [...this.deoptLog];
  }

  /** Get all tier assignments */
  getAllTiers(): Map<string, 0 | 1 | 2> {
    return new Map(this.tiers);
  }
}
