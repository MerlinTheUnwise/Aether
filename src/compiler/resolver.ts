/**
 * AETHER Intent Resolver
 * Matches IntentNodes to certified implementations from the standard library.
 *
 * Resolution algorithm:
 *   1. Scan library for type-compatible algorithms
 *   2. Filter by ensure clauses (algorithm contracts must imply intent's ensure)
 *   3. Filter by constraints (complexity, determinism, latency)
 *   4. Filter by effects
 *   5. Rank candidates
 *   6. Select best match
 */

import { readFileSync, readdirSync } from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type {
  IntentNode,
  AetherNode,
  AetherEdge,
  AetherGraph,
  TypeAnnotation,
  Contract,
} from "../ir/validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CertifiedAlgorithm {
  id: string;
  description: string;
  interface: {
    in: Record<string, TypeAnnotation>;
    out: Record<string, TypeAnnotation>;
  };
  contracts: Contract;
  complexity: { time?: string; space?: string };
  deterministic: boolean;
  nodes: AetherNode[];
  edges: AetherEdge[];
}

export interface ResolutionResult {
  intentId: string;
  resolved: boolean;
  implementation: AetherNode[] | null;
  edges: AetherEdge[] | null;
  matchReason: string;
  alternatives: Array<{
    algorithm: string;
    reason_not_chosen: string;
  }>;
}

export interface GraphResolutionReport {
  graph_id: string;
  intents_found: number;
  intents_resolved: number;
  intents_unresolved: number;
  resolutions: ResolutionResult[];
  resolvedGraph: AetherGraph;
}

// ─── Library Loading ─────────────────────────────────────────────────────────

export function loadCertifiedLibrary(libraryPath?: string): CertifiedAlgorithm[] {
  const dir = libraryPath ?? join(__dirname, "..", "stdlib", "certified");
  const algorithms: CertifiedAlgorithm[] = [];

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith(".certified.json"));
  } catch {
    return algorithms;
  }

  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      algorithms.push({
        id: raw.id,
        description: raw.description ?? "",
        interface: raw.interface,
        contracts: raw.contracts ?? {},
        complexity: raw.complexity ?? {},
        deterministic: raw.deterministic ?? false,
        nodes: raw.nodes ?? [],
        edges: raw.edges ?? [],
      });
    } catch {
      // Skip malformed files
    }
  }

  return algorithms;
}

// ─── Type Compatibility ──────────────────────────────────────────────────────

function normalizeType(t: string): string {
  return t.replace(/<[^>]+>/g, "").trim().toLowerCase();
}

function isTypeCompatible(intentType: TypeAnnotation, algoType: TypeAnnotation): boolean {
  const iBase = normalizeType(intentType.type);
  const aBase = normalizeType(algoType.type);

  // Exact match
  if (iBase === aBase) return true;

  // Generic collection matching: Collection<T> matches List<X>, Array<X>, etc.
  const collectionTypes = ["collection", "list", "array", "set"];
  if (collectionTypes.includes(iBase) && collectionTypes.includes(aBase)) return true;

  // Numeric matching
  const numericTypes = ["numeric", "number", "int", "float", "double"];
  if (numericTypes.includes(iBase) && numericTypes.includes(aBase)) return true;

  // Any type matches anything
  if (aBase === "any" || iBase === "any") return true;

  // Optional type matching (T? matches T)
  if (aBase.endsWith("?") && normalizeType(aBase.replace("?", "")) === iBase) return true;
  if (iBase.endsWith("?") && normalizeType(iBase.replace("?", "")) === aBase) return true;

  // Generic type variable matching (single uppercase letter or T)
  const isGeneric = (s: string) => /^[a-z]$/.test(s) || s === "t";
  if (isGeneric(iBase) || isGeneric(aBase)) return true;

  return false;
}

function areInputsCompatible(
  intentIn: Record<string, TypeAnnotation>,
  algoIn: Record<string, TypeAnnotation>
): boolean {
  // The algorithm must accept all of the intent's input types.
  // The algo may accept additional inputs (like accessor/predicate) that the intent doesn't mention.
  for (const [port, intentType] of Object.entries(intentIn)) {
    // Find a matching port in the algorithm
    const algoType = algoIn[port];
    if (algoType) {
      if (!isTypeCompatible(intentType, algoType)) return false;
    } else {
      // No exact port name match — check if any algo input is type-compatible
      const anyMatch = Object.values(algoIn).some(at => isTypeCompatible(intentType, at));
      if (!anyMatch) return false;
    }
  }
  return true;
}

function areOutputsCompatible(
  intentOut: Record<string, TypeAnnotation>,
  algoOut: Record<string, TypeAnnotation>
): boolean {
  // The algorithm must produce all of the intent's required outputs
  for (const [port, intentType] of Object.entries(intentOut)) {
    const algoType = algoOut[port];
    if (algoType) {
      if (!isTypeCompatible(intentType, algoType)) return false;
    } else {
      // Check if any algo output is type-compatible
      const anyMatch = Object.values(algoOut).some(at => isTypeCompatible(intentType, at));
      if (!anyMatch) return false;
    }
  }
  return true;
}

// ─── Ensure Clause Matching ──────────────────────────────────────────────────

function normalizeClause(clause: string): string {
  return clause.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Semantic keywords that indicate the same concept
const SYNONYMS: Record<string, string[]> = {
  sorted: ["sorted", "sort", "ascending", "ordered", "order"],
  permutation: ["permutation", "permutation of input", "reordering"],
  length: ["length", "size", "count"],
  preserved: ["preserved", "equal", "same", "unchanged"],
  duplicates: ["duplicates", "duplicate", "unique", "distinct", "dedup", "deduplicated"],
  subset: ["subset", "contained", "within"],
  sum: ["sum", "total", "aggregate", "summation"],
};

function getSemanticKeywords(word: string): string[] {
  for (const [, group] of Object.entries(SYNONYMS)) {
    if (group.includes(word)) return group;
  }
  return [word];
}

function doesContractImplyEnsure(contracts: Contract, ensure: string[]): { implied: boolean; unmatched: string[] } {
  const allContractClauses = [
    ...(contracts.pre ?? []),
    ...(contracts.post ?? []),
    ...(contracts.invariants ?? []),
  ].map(normalizeClause);

  const allContractText = allContractClauses.join(" ");
  const unmatched: string[] = [];

  for (const ensureClause of ensure) {
    const normalized = normalizeClause(ensureClause);
    const words = normalized.split(" ").filter(w => w.length > 2);

    // Check if any contract clause covers this ensure clause
    const matched = allContractClauses.some(cc => {
      // Direct substring match
      if (cc.includes(normalized)) return true;

      // Semantic word overlap with synonym expansion
      let matchCount = 0;
      for (const w of words) {
        const synonyms = getSemanticKeywords(w);
        if (synonyms.some(syn => cc.includes(syn))) {
          matchCount++;
        }
      }
      return words.length > 0 && matchCount / words.length >= 0.5;
    });

    // Also check across all contract clauses combined for distributed matches
    if (!matched) {
      let matchCount = 0;
      for (const w of words) {
        const synonyms = getSemanticKeywords(w);
        if (synonyms.some(syn => allContractText.includes(syn))) {
          matchCount++;
        }
      }
      const distributedMatch = words.length > 0 && matchCount / words.length >= 0.5;
      if (!distributedMatch) {
        unmatched.push(ensureClause);
      }
    }
  }

  return { implied: unmatched.length === 0, unmatched };
}

// ─── Complexity Comparison ───────────────────────────────────────────────────

const COMPLEXITY_ORDER = ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n^2)", "O(n^3)", "O(2^n)"];

function complexityRank(c: string): number {
  const normalized = c.replace(/\s+/g, "").toLowerCase();
  const idx = COMPLEXITY_ORDER.findIndex(o => o.replace(/\s+/g, "").toLowerCase() === normalized);
  return idx >= 0 ? idx : 999;
}

function meetsComplexityConstraint(algoComplexity: string | undefined, constraint: string): boolean {
  if (!algoComplexity) return false;
  return complexityRank(algoComplexity) <= complexityRank(constraint);
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export function resolveIntent(
  intent: IntentNode,
  library: CertifiedAlgorithm[]
): ResolutionResult {
  const candidates: Array<{
    algorithm: CertifiedAlgorithm;
    score: number;
    reason: string;
  }> = [];
  const alternatives: ResolutionResult["alternatives"] = [];

  for (const algo of library) {
    // Step 1: Type compatibility
    if (!areInputsCompatible(intent.in, algo.interface.in)) {
      alternatives.push({
        algorithm: algo.id,
        reason_not_chosen: "input types incompatible",
      });
      continue;
    }
    if (!areOutputsCompatible(intent.out, algo.interface.out)) {
      alternatives.push({
        algorithm: algo.id,
        reason_not_chosen: "output types incompatible",
      });
      continue;
    }

    // Step 2: Ensure clauses
    const { implied, unmatched } = doesContractImplyEnsure(algo.contracts, intent.ensure);
    if (!implied) {
      alternatives.push({
        algorithm: algo.id,
        reason_not_chosen: `contracts don't cover ensure clauses: ${unmatched.join("; ")}`,
      });
      continue;
    }

    // Step 3: Constraints
    if (intent.constraints) {
      if (intent.constraints.time_complexity) {
        if (!meetsComplexityConstraint(algo.complexity.time, intent.constraints.time_complexity)) {
          alternatives.push({
            algorithm: algo.id,
            reason_not_chosen: `time complexity ${algo.complexity.time ?? "unknown"} exceeds constraint ${intent.constraints.time_complexity}`,
          });
          continue;
        }
      }
      if (intent.constraints.deterministic === true && !algo.deterministic) {
        alternatives.push({
          algorithm: algo.id,
          reason_not_chosen: "algorithm is non-deterministic but intent requires deterministic",
        });
        continue;
      }
    }

    // Step 4: Effects
    if (intent.effects && intent.effects.length > 0) {
      // Intent declares effects — algorithm must have compatible effects
      const algoEffects = new Set<string>();
      for (const node of algo.nodes) {
        for (const eff of node.effects ?? []) {
          algoEffects.add(eff);
        }
      }
      // If intent has effects but algo is pure, that's a mismatch
      const algoPure = algo.nodes.every(n => (n.effects ?? []).length === 0);
      if (!algoPure) {
        const intentEffects = new Set(intent.effects);
        const missing = [...intentEffects].filter(e => !algoEffects.has(e));
        if (missing.length > 0) {
          alternatives.push({
            algorithm: algo.id,
            reason_not_chosen: `missing effects: ${missing.join(", ")}`,
          });
          continue;
        }
      }
    }

    // Step 5: Score candidate
    let score = 0;

    // More postconditions = tighter contracts = better
    score += (algo.contracts.post?.length ?? 0) * 10;

    // Better time complexity = higher score
    score += (7 - complexityRank(algo.complexity.time ?? "O(n)")) * 5;

    // Deterministic preferred
    if (algo.deterministic) score += 20;

    // Higher confidence preferred
    if (intent.confidence !== undefined) {
      score += intent.confidence * 10;
    }

    candidates.push({
      algorithm: algo,
      score,
      reason: `types compatible, ${algo.contracts.post?.length ?? 0} contracts verified, ${algo.complexity.time ?? "unknown"} time, ${algo.deterministic ? "deterministic" : "non-deterministic"}`,
    });
  }

  if (candidates.length === 0) {
    return {
      intentId: intent.id,
      resolved: false,
      implementation: null,
      edges: null,
      matchReason: alternatives.length > 0
        ? `no matching algorithm (${alternatives.map(a => `${a.algorithm}: ${a.reason_not_chosen}`).join("; ")})`
        : "no algorithms in library",
      alternatives,
    };
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Add non-chosen candidates to alternatives
  for (let i = 1; i < candidates.length; i++) {
    alternatives.push({
      algorithm: candidates[i].algorithm.id,
      reason_not_chosen: `lower score (${candidates[i].score} vs ${best.score})`,
    });
  }

  // Create implementation nodes with intent-prefixed IDs
  const implNodes = best.algorithm.nodes.map(node => ({
    ...node,
    id: `${intent.id}_${node.id}`,
  }));

  const implEdges = best.algorithm.edges.map(edge => ({
    from: `${intent.id}_${edge.from.split(".")[0]}.${edge.from.split(".")[1]}`,
    to: `${intent.id}_${edge.to.split(".")[0]}.${edge.to.split(".")[1]}`,
  }));

  return {
    intentId: intent.id,
    resolved: true,
    implementation: implNodes,
    edges: implEdges,
    matchReason: `${best.algorithm.id} (${best.reason})`,
    alternatives,
  };
}

// ─── Graph Resolution ────────────────────────────────────────────────────────

function isIntentNode(node: any): node is IntentNode {
  return "intent" in node && node.intent === true;
}

export function resolveGraph(graph: AetherGraph, library?: CertifiedAlgorithm[]): GraphResolutionReport {
  const lib = library ?? loadCertifiedLibrary();
  const intentNodes: IntentNode[] = [];
  const regularNodes: any[] = [];

  for (const node of graph.nodes) {
    if (isIntentNode(node)) {
      intentNodes.push(node);
    } else {
      regularNodes.push(node);
    }
  }

  const resolutions: ResolutionResult[] = [];
  const allNewNodes: AetherNode[] = [];
  const allNewEdges: AetherEdge[] = [];
  const resolvedIntentIds = new Set<string>();

  for (const intent of intentNodes) {
    const result = resolveIntent(intent, lib);
    resolutions.push(result);

    if (result.resolved && result.implementation) {
      allNewNodes.push(...result.implementation);
      if (result.edges) {
        allNewEdges.push(...result.edges);
      }
      resolvedIntentIds.add(intent.id);
    }
  }

  // Rebuild edges: replace references to intent nodes with references to implementation nodes
  const resolvedEdges: AetherEdge[] = [];
  for (const edge of graph.edges) {
    const fromNodeId = edge.from.split(".")[0];
    const fromPort = edge.from.split(".")[1];
    const toNodeId = edge.to.split(".")[0];
    const toPort = edge.to.split(".")[1];

    let newFrom = edge.from;
    let newTo = edge.to;

    if (resolvedIntentIds.has(fromNodeId)) {
      // Find the implementation node that has this output port
      const resolution = resolutions.find(r => r.intentId === fromNodeId && r.resolved);
      if (resolution?.implementation) {
        const implNode = resolution.implementation.find(n => fromPort in n.out);
        if (implNode) {
          newFrom = `${implNode.id}.${fromPort}`;
        }
      }
    }

    if (resolvedIntentIds.has(toNodeId)) {
      // Find the implementation node that has this input port
      const resolution = resolutions.find(r => r.intentId === toNodeId && r.resolved);
      if (resolution?.implementation) {
        const implNode = resolution.implementation.find(n => toPort in n.in);
        if (implNode) {
          newTo = `${implNode.id}.${toPort}`;
        }
      }
    }

    resolvedEdges.push({ from: newFrom, to: newTo });
  }

  // Keep unresolved intent nodes as-is (they remain IntentNodes in the graph)
  const unresolvedIntents = intentNodes.filter(i => !resolvedIntentIds.has(i.id));

  const resolvedGraph: AetherGraph = {
    ...graph,
    nodes: [...regularNodes, ...allNewNodes, ...unresolvedIntents] as any,
    edges: [...resolvedEdges, ...allNewEdges],
  };

  return {
    graph_id: graph.id,
    intents_found: intentNodes.length,
    intents_resolved: resolutions.filter(r => r.resolved).length,
    intents_unresolved: resolutions.filter(r => !r.resolved).length,
    resolutions,
    resolvedGraph,
  };
}
