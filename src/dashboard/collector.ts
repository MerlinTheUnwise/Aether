/**
 * AETHER Dashboard — Data Collector
 *
 * Aggregates data from all AETHER tools into a unified DashboardData structure.
 * Runs the full pipeline: validate → check → verify → confidence → effects → optionally execute/optimize/proof.
 */

import { readFileSync } from "fs";
import {
  validateGraph,
  type AetherGraph,
  type AetherNode,
  type AetherEdge,
  type StateType,
} from "../ir/validator.js";
import { checkTypes, type CheckResult } from "../compiler/checker.js";
import { verifyGraph, type GraphVerificationReport } from "../compiler/verifier.js";
import { ConfidenceEngine } from "../runtime/confidence.js";
import { EffectTracker } from "../runtime/effects.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DashboardData {
  graph: {
    id: string;
    version: number;
    nodeCount: number;
    edgeCount: number;
    waveCount: number;
    scopeCount: number;
    templateCount: number;
    intentCount: number;
  };

  verification: {
    percentage: number;
    byNode: Array<{
      nodeId: string;
      status: "verified" | "failed" | "unsupported" | "supervised";
      contracts: {
        pre: { total: number; verified: number };
        post: { total: number; verified: number };
        invariants: { total: number; verified: number };
        adversarial: { total: number; passed: number };
      };
      confidence: { declared: number; propagated: number };
      effects: string[];
      recoveryPaths: number;
      supervised: boolean;
    }>;
    summary: {
      verified: number;
      failed: number;
      unsupported: number;
      supervised: number;
    };
  };

  typeSafety: {
    edgesChecked: number;
    compatible: number;
    errors: number;
    warnings: number;
    errorDetails: Array<{ edge: string; code: string; message: string }>;
    warningDetails: Array<{ edge: string; code: string; message: string }>;
  };

  confidence: {
    graphConfidence: number;
    criticalPath: string[];
    oversightNodes: string[];
    nodeConfidences: Record<string, { declared: number; propagated: number }>;
    distribution: { high: number; medium: number; low: number };
  };

  effects: {
    totalDeclared: string[];
    byNode: Record<string, string[]>;
    pureNodes: string[];
    effectfulNodes: string[];
    effectDistribution: Record<string, number>;
  };

  stateTypes: Array<{
    id: string;
    states: number;
    transitions: number;
    neverInvariants: { total: number; verified: number };
    terminalStates: string[];
  }>;

  optimizations: Array<{
    type: string;
    priority: string;
    description: string;
    autoApplicable: boolean;
  }>;

  proofExport: {
    theoremsGenerable: number;
    fullyProvable: number;
    needingSorry: number;
    stateTypeProofs: number;
  };

  execution?: {
    totalRuns: number;
    avgTime_ms: number;
    jitCompiled: boolean;
    jitSpeedup?: string;
    hotPaths: string[][];
  };

  generatedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isNode(n: any): n is AetherNode {
  return !("hole" in n && n.hole === true) && !("intent" in n && n.intent === true);
}

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

/** Compute wave count via topological sort */
function computeWaves(graph: AetherGraph): number {
  const nodes = graph.nodes.filter(n => isNode(n));
  if (nodes.length === 0) return 0;

  const preds = new Map<string, Set<string>>();
  for (const n of nodes) preds.set(n.id, new Set());

  for (const edge of graph.edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to && from.nodeId !== to.nodeId) {
      if (preds.has(to.nodeId)) {
        preds.get(to.nodeId)!.add(from.nodeId);
      }
    }
  }

  const waveOf = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, ps] of preds) {
    if (ps.size === 0) {
      waveOf.set(id, 0);
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const wave = waveOf.get(id)!;
    for (const edge of graph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to && from.nodeId === id) {
        const nextWave = Math.max(waveOf.get(to.nodeId) ?? 0, wave + 1);
        waveOf.set(to.nodeId, nextWave);
        // Check if all preds are resolved
        const allReady = [...(preds.get(to.nodeId) ?? [])].every(p => waveOf.has(p));
        if (allReady && !queue.includes(to.nodeId)) {
          queue.push(to.nodeId);
        }
      }
    }
  }

  if (waveOf.size === 0) return 1;
  return Math.max(...waveOf.values()) + 1;
}

// ─── Collector ──────────────────────────────────────────────────────────────

export async function collectDashboardData(
  graphPath: string,
  options?: {
    includeExecution?: boolean;
    executionRuns?: number;
    includeOptimization?: boolean;
    includeProofs?: boolean;
  }
): Promise<DashboardData> {
  const raw = JSON.parse(readFileSync(graphPath, "utf-8"));
  const graph = raw as AetherGraph;
  const opts = options ?? {};

  const realNodes = graph.nodes.filter(n => isNode(n)) as AetherNode[];
  const intentNodes = graph.nodes.filter((n: any) => n.intent === true);
  const scopes = (graph as any).scopes as any[] | undefined;
  const templates = (graph as any).templates as any[] | undefined;

  // ─── Verification ───────────────────────────────────────────────────────
  const verifyReport = await verifyGraph(graph as any);

  const verificationByNode: DashboardData["verification"]["byNode"] = [];
  const summary = { verified: 0, failed: 0, unsupported: 0, supervised: 0 };

  // Build confidence engine for propagated confidences
  const confEngine = new ConfidenceEngine(graph, 0.7);
  // Run propagation by building predecessor map and processing in topo order
  const predMap = new Map<string, Set<string>>();
  for (const n of realNodes) predMap.set(n.id, new Set());
  for (const edge of graph.edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to && from.nodeId !== to.nodeId && predMap.has(to.nodeId)) {
      predMap.get(to.nodeId)!.add(from.nodeId);
    }
  }

  // Topological propagation
  const propagated = new Map<string, number>();
  const remaining = new Set(realNodes.map(n => n.id));
  while (remaining.size > 0) {
    const ready: string[] = [];
    for (const id of remaining) {
      const preds = predMap.get(id) ?? new Set();
      if ([...preds].every(p => propagated.has(p) || !remaining.has(p))) {
        ready.push(id);
      }
    }
    if (ready.length === 0) break; // cycle safety
    for (const id of ready) {
      const inputConfs = new Map<string, number>();
      for (const pred of predMap.get(id) ?? []) {
        inputConfs.set(pred, propagated.get(pred) ?? 1.0);
      }
      const prop = confEngine.propagate(id, inputConfs);
      propagated.set(id, prop);
      remaining.delete(id);
    }
  }

  const confReport = confEngine.getReport();

  for (const node of realNodes) {
    const vResult = verifyReport.results.find(r => r.node_id === node.id);
    const contract = node.contract ?? {};
    const preArr = contract.pre ?? [];
    const postArr = contract.post ?? [];
    const invArr = contract.invariants ?? [];
    const advCheck = (node as any).adversarial_check;
    const advArr = advCheck?.break_if ?? [];

    let preVerified = 0;
    let postVerified = 0;
    let invVerified = 0;
    let advPassed = 0;

    if (vResult) {
      for (const pc of vResult.postconditions) {
        if (pc.status === "verified") postVerified++;
      }
      for (const ac of vResult.adversarial_checks) {
        if (ac.status === "passed") advPassed++;
      }
      // Pre/invariants: count verified if postconditions all verified (simplified)
      preVerified = vResult.verified ? preArr.length : 0;
      invVerified = vResult.verified ? invArr.length : 0;
    }

    let status: "verified" | "failed" | "unsupported" | "supervised";
    if (node.supervised) {
      status = "supervised";
      summary.supervised++;
    } else if (vResult) {
      if (vResult.verified) {
        status = "verified";
        summary.verified++;
      } else {
        // Check if all postconditions are unsupported
        const allUnsupported = vResult.postconditions.every(p => p.status === "unsupported") &&
          vResult.adversarial_checks.every(a => a.status === "unsupported");
        if (allUnsupported && vResult.postconditions.length + vResult.adversarial_checks.length > 0) {
          status = "unsupported";
          summary.unsupported++;
        } else if (vResult.postconditions.some(p => p.status === "failed") ||
                   vResult.adversarial_checks.some(a => a.status === "failed")) {
          status = "failed";
          summary.failed++;
        } else {
          status = "unsupported";
          summary.unsupported++;
        }
      }
    } else {
      status = "unsupported";
      summary.unsupported++;
    }

    const recovery = (node as any).recovery ?? {};
    const recoveryPaths = Object.keys(recovery).length;

    const nodeConf = confReport.nodeConfidences[node.id];

    verificationByNode.push({
      nodeId: node.id,
      status,
      contracts: {
        pre: { total: preArr.length, verified: preVerified },
        post: { total: postArr.length, verified: postVerified },
        invariants: { total: invArr.length, verified: invVerified },
        adversarial: { total: advArr.length, passed: advPassed },
      },
      confidence: {
        declared: nodeConf?.declared ?? (node.confidence ?? 1.0),
        propagated: nodeConf?.propagated ?? (node.confidence ?? 1.0),
      },
      effects: [...node.effects],
      recoveryPaths,
      supervised: !!(node.supervised),
    });
  }

  // ─── Type Safety ────────────────────────────────────────────────────────
  const checkResult = checkTypes(graph as any);

  // ─── Confidence ─────────────────────────────────────────────────────────
  const nodeConfidences: Record<string, { declared: number; propagated: number }> = {};
  let high = 0, medium = 0, low = 0;
  for (const [id, conf] of Object.entries(confReport.nodeConfidences)) {
    nodeConfidences[id] = { declared: conf.declared, propagated: conf.propagated };
    if (conf.propagated > 0.85) high++;
    else if (conf.propagated >= 0.7) medium++;
    else low++;
  }

  // ─── Effects ────────────────────────────────────────────────────────────
  const effectsByNode: Record<string, string[]> = {};
  const pureNodes: string[] = [];
  const effectfulNodes: string[] = [];
  const allEffects: string[] = [];
  const effectDist: Record<string, number> = {};

  for (const node of realNodes) {
    effectsByNode[node.id] = [...node.effects];
    if (node.pure === true || node.effects.length === 0) {
      pureNodes.push(node.id);
    } else {
      effectfulNodes.push(node.id);
    }
    for (const eff of node.effects) {
      if (!allEffects.includes(eff)) allEffects.push(eff);
      effectDist[eff] = (effectDist[eff] ?? 0) + 1;
    }
  }

  // ─── State Types ────────────────────────────────────────────────────────
  const stateTypesArr = (graph as any).state_types as StateType[] | undefined;
  const stateTypeData: DashboardData["stateTypes"] = [];

  if (stateTypesArr) {
    for (const st of stateTypesArr) {
      const neverInvariants = st.invariants?.never ?? [];
      const terminalStates = st.invariants?.terminal ?? [];
      // Check verifier results for state types
      const stResult = verifyReport.stateTypeResults?.find(r => r.id === st.id);
      stateTypeData.push({
        id: st.id,
        states: st.states.length,
        transitions: st.transitions.length,
        neverInvariants: {
          total: neverInvariants.length,
          verified: stResult?.neverInvariants?.verified ?? 0,
        },
        terminalStates,
      });
    }
  }

  // ─── Optimizations (optional) ───────────────────────────────────────────
  let optimizations: DashboardData["optimizations"] = [];
  if (opts.includeOptimization) {
    try {
      const { GraphOptimizer } = await import("../compiler/optimizer.js");
      const optimizer = new GraphOptimizer();
      const suggestions = optimizer.analyze(graph);
      optimizations = suggestions.map(s => ({
        type: s.type,
        priority: s.priority,
        description: s.description,
        autoApplicable: s.autoApplicable,
      }));
    } catch {
      // Optimizer not available
    }
  }

  // ─── Proof Export readiness (optional) ──────────────────────────────────
  let proofExport: DashboardData["proofExport"] = {
    theoremsGenerable: 0,
    fullyProvable: 0,
    needingSorry: 0,
    stateTypeProofs: 0,
  };
  if (opts.includeProofs) {
    try {
      const { generateProofExport } = await import("../proofs/generate.js");
      const proof = generateProofExport(graph as any, verifyReport);

      // Count state type proofs separately (never-invariant + terminal theorems)
      let stateTypeProofCount = 0;
      for (const st of stateTypesArr ?? []) {
        const neverCount = st.invariants?.never?.length ?? 0;
        const terminalCount = st.invariants?.terminal?.length ?? 0;
        stateTypeProofCount += neverCount + terminalCount;
      }

      proofExport = {
        theoremsGenerable: proof.metadata.theoremsGenerated,
        fullyProvable: proof.metadata.fullyProved,
        needingSorry: proof.metadata.sorryCount,
        stateTypeProofs: stateTypeProofCount,
      };
    } catch {
      // Proof exporter not available — leave defaults
    }
  }

  // ─── Execution (optional) ───────────────────────────────────────────────
  let execution: DashboardData["execution"] | undefined;
  if (opts.includeExecution) {
    try {
      const { execute } = await import("../runtime/executor.js");
      const { ExecutionProfiler } = await import("../runtime/profiler.js");

      const runs = opts.executionRuns ?? 5;
      const profiler = new ExecutionProfiler(graph.id);
      profiler.setGraph(graph);

      let totalTime = 0;
      for (let i = 0; i < runs; i++) {
        const result = await execute({
          graph: graph as any,
          inputs: {},
          nodeImplementations: new Map(),
          confidenceThreshold: 0.7,
        });
        totalTime += result.duration_ms;
        profiler.recordGraphExecution(result);
      }

      const profile = profiler.analyze();
      execution = {
        totalRuns: runs,
        avgTime_ms: totalTime / runs,
        jitCompiled: false,
        hotPaths: profile.hotPaths.map(hp => hp.nodes),
      };
    } catch {
      // Execution not available
    }
  }

  // ─── Assemble ───────────────────────────────────────────────────────────
  return {
    graph: {
      id: graph.id,
      version: graph.version,
      nodeCount: realNodes.length,
      edgeCount: graph.edges.length,
      waveCount: computeWaves(graph),
      scopeCount: scopes?.length ?? 0,
      templateCount: templates?.length ?? 0,
      intentCount: intentNodes.length,
    },
    verification: {
      percentage: verifyReport.verification_percentage,
      byNode: verificationByNode,
      summary,
    },
    typeSafety: {
      edgesChecked: graph.edges.length,
      compatible: graph.edges.length - checkResult.errors.length,
      errors: checkResult.errors.length,
      warnings: checkResult.warnings.length,
      errorDetails: checkResult.errors.map(e => ({ edge: e.edge, code: e.code, message: e.message })),
      warningDetails: checkResult.warnings.map(w => ({ edge: w.edge, code: w.code, message: w.message })),
    },
    confidence: {
      graphConfidence: confReport.graphConfidence,
      criticalPath: confReport.criticalPath,
      oversightNodes: confReport.oversightNodes,
      nodeConfidences,
      distribution: { high, medium, low },
    },
    effects: {
      totalDeclared: allEffects,
      byNode: effectsByNode,
      pureNodes,
      effectfulNodes,
      effectDistribution: effectDist,
    },
    stateTypes: stateTypeData,
    optimizations,
    proofExport,
    execution,
    generatedAt: new Date().toISOString(),
  };
}
