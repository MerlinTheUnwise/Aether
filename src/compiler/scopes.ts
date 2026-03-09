/**
 * AETHER Scope Extractor
 *
 * Extracts a single scope as an independent, validatable graph.
 * Verifies scopes in isolation against their boundary contracts.
 * Checks boundary compatibility between scopes.
 */

import type {
  AetherGraph,
  AetherNode,
  AetherHole,
  AetherEdge,
  IntentNode,
  Scope,
  BoundaryContract,
  TypeAnnotation,
} from "../ir/validator.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScopeView {
  scope: Scope;
  graph: AetherGraph;          // subgraph containing only this scope's nodes + stubs
  boundaryStubs: AetherNode[]; // stub nodes representing adjacent scopes
  internalEdges: AetherEdge[]; // edges within scope
  boundaryEdges: AetherEdge[]; // edges crossing scope boundary
}

export interface ScopeVerificationResult {
  scopeId: string;
  internalValid: boolean;      // scope's own nodes pass validation
  boundariesSatisfied: boolean; // scope satisfies its provides contracts
  requirementsMet: boolean;     // scope's requires contracts are satisfiable
  errors: string[];
  verification_percentage: number;
}

export interface CompatibilityResult {
  compatible: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

function isNode(n: AetherNode | AetherHole | IntentNode): n is AetherNode {
  return !("hole" in n && (n as any).hole === true) && !("intent" in n && (n as any).intent === true);
}

// ─── Extract Scope ───────────────────────────────────────────────────────────

export function extractScope(graph: AetherGraph, scopeId: string): ScopeView {
  const scope = graph.scopes?.find(s => s.id === scopeId);
  if (!scope) {
    throw new Error(`Scope "${scopeId}" not found in graph`);
  }

  const scopeNodeIds = new Set(scope.nodes);
  const nodeMap = new Map<string, AetherNode | AetherHole | IntentNode>();
  for (const n of graph.nodes) {
    nodeMap.set(n.id, n);
  }

  // 1. Collect scope's nodes
  const scopeNodes: (AetherNode | AetherHole | IntentNode)[] = [];
  for (const nodeId of scope.nodes) {
    const node = nodeMap.get(nodeId);
    if (node) scopeNodes.push(node);
  }

  // 2-3. Classify edges
  const internalEdges: AetherEdge[] = [];
  const boundaryEdges: AetherEdge[] = [];

  for (const edge of graph.edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (!from || !to) continue;

    const fromInScope = scopeNodeIds.has(from.nodeId);
    const toInScope = scopeNodeIds.has(to.nodeId);

    if (fromInScope && toInScope) {
      internalEdges.push(edge);
    } else if (fromInScope || toInScope) {
      boundaryEdges.push(edge);
    }
  }

  // 4. Create stub nodes for boundary edges
  // First pass: collect all ports needed per stub
  const stubOutPorts = new Map<string, Record<string, TypeAnnotation>>();
  const stubInPorts = new Map<string, Record<string, TypeAnnotation>>();

  for (const edge of boundaryEdges) {
    const from = parseEdgeRef(edge.from)!;
    const to = parseEdgeRef(edge.to)!;

    if (!scopeNodeIds.has(from.nodeId)) {
      // Edge comes FROM outside — stub needs this out port
      if (!stubOutPorts.has(from.nodeId)) stubOutPorts.set(from.nodeId, {});
      const toNode = nodeMap.get(to.nodeId);
      if (toNode && isNode(toNode) && toNode.in[to.portName]) {
        stubOutPorts.get(from.nodeId)![from.portName] = toNode.in[to.portName];
      }
    }

    if (!scopeNodeIds.has(to.nodeId)) {
      // Edge goes TO outside — stub needs this in port
      if (!stubInPorts.has(to.nodeId)) stubInPorts.set(to.nodeId, {});
      const fromNode = nodeMap.get(from.nodeId);
      if (fromNode && isNode(fromNode) && fromNode.out[from.portName]) {
        stubInPorts.get(to.nodeId)![to.portName] = fromNode.out[from.portName];
      }
    }
  }

  // Second pass: create stub nodes
  const boundaryStubs: AetherNode[] = [];
  const allStubIds = new Set([...stubOutPorts.keys(), ...stubInPorts.keys()]);

  for (const stubId of allStubIds) {
    boundaryStubs.push({
      id: stubId,
      in: stubInPorts.get(stubId) ?? {},
      out: stubOutPorts.get(stubId) ?? {},
      contract: {},
      effects: [],
      pure: true,
    });
  }

  // 5. Build standalone AetherGraph
  const allNodes: (AetherNode | AetherHole | IntentNode)[] = [...scopeNodes, ...boundaryStubs];
  const allEdges: AetherEdge[] = [...internalEdges, ...boundaryEdges];

  // Collect effects from scope nodes only
  const scopeEffects: string[] = [];
  for (const node of scopeNodes) {
    if (isNode(node)) {
      scopeEffects.push(...node.effects);
    }
  }

  const subgraph: AetherGraph = {
    id: `${graph.id}__scope_${scopeId}`,
    version: graph.version,
    effects: [...new Set(scopeEffects)],
    nodes: allNodes,
    edges: allEdges,
    partial: true, // scoped graphs are partial
  };

  return {
    scope,
    graph: subgraph,
    boundaryStubs,
    internalEdges,
    boundaryEdges,
  };
}

// ─── Verify Scope ────────────────────────────────────────────────────────────

export function verifyScope(scopeView: ScopeView): ScopeVerificationResult {
  const errors: string[] = [];
  let internalValid = true;
  let boundariesSatisfied = true;
  let requirementsMet = true;

  const scope = scopeView.scope;
  const nodeMap = new Map<string, AetherNode | AetherHole | IntentNode>();
  for (const n of scopeView.graph.nodes) {
    nodeMap.set(n.id, n);
  }

  // Internal validation: check that scope nodes have required structure
  const scopeNodeIds = new Set(scope.nodes);
  for (const nodeId of scope.nodes) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      errors.push(`Scope "${scope.id}": node "${nodeId}" not found in extracted graph`);
      internalValid = false;
      continue;
    }
    if (!isNode(node)) continue;

    // Check that non-pure effectful nodes have recovery
    const isEffectful = node.effects.length > 0 && node.pure !== true;
    if (isEffectful && !node.recovery) {
      errors.push(`Scope "${scope.id}": node "${node.id}" has effects but no recovery`);
      internalValid = false;
    }
  }

  // Check provides contracts are satisfiable
  const provides = scope.boundary_contracts?.provides ?? [];
  for (const prov of provides) {
    // Check that at least one boundary edge carries the output types
    const hasMatchingOutput = scopeView.boundaryEdges.some(edge => {
      const from = parseEdgeRef(edge.from);
      if (!from || !scopeNodeIds.has(from.nodeId)) return false;
      const node = nodeMap.get(from.nodeId);
      if (!node || !isNode(node)) return false;
      return Object.values(prov.out).some(
        provType => Object.values(node.out).some(nodeType => nodeType.type === provType.type)
      );
    });

    if (!hasMatchingOutput && Object.keys(prov.out).length > 0) {
      errors.push(`Scope "${scope.id}": provides contract "${prov.name}" has no matching boundary output`);
      boundariesSatisfied = false;
    }
  }

  // Check requires contracts are satisfiable
  const requires = scope.boundary_contracts?.requires ?? [];
  for (const req of requires) {
    const hasMatchingInput = scopeView.boundaryEdges.some(edge => {
      const to = parseEdgeRef(edge.to);
      if (!to || !scopeNodeIds.has(to.nodeId)) return false;
      const node = nodeMap.get(to.nodeId);
      if (!node || !isNode(node)) return false;
      return Object.values(req.in).some(
        reqType => Object.values(node.in).some(nodeType => nodeType.type === reqType.type)
      );
    });

    if (!hasMatchingInput && Object.keys(req.in).length > 0) {
      errors.push(`Scope "${scope.id}": requires contract "${req.name}" has no matching boundary input`);
      requirementsMet = false;
    }
  }

  const totalChecks = scope.nodes.length + provides.length + requires.length;
  const passedChecks = totalChecks - errors.length;
  const verification_percentage = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;

  return {
    scopeId: scope.id,
    internalValid,
    boundariesSatisfied,
    requirementsMet,
    errors,
    verification_percentage,
  };
}

// ─── Boundary Compatibility ──────────────────────────────────────────────────

function typesCompatible(a: TypeAnnotation, b: TypeAnnotation): boolean {
  // Base type must match
  if (a.type !== b.type) {
    const numericTypes = new Set(["Int", "Float64", "Float32", "Number"]);
    if (!(numericTypes.has(a.type) && numericTypes.has(b.type))) return false;
  }
  // Domain must match if both specified
  if (a.domain && b.domain && a.domain !== b.domain) return false;
  // Dimension must match if both specified
  if (a.dimension && b.dimension && a.dimension !== b.dimension) return false;
  // Sensitivity: pii → public is forbidden
  if (a.sensitivity === "pii" && b.sensitivity === "public") return false;
  return true;
}

export function checkBoundaryCompatibility(
  provider: Scope,
  requirer: Scope
): CompatibilityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const provides = provider.boundary_contracts?.provides ?? [];
  const requires = requirer.boundary_contracts?.requires ?? [];

  for (const req of requires) {
    // Find matching provides by name — skip if provider doesn't have this contract
    // (it may be provided by a different scope)
    const matching = provides.find(p => p.name === req.name);
    if (!matching) {
      continue; // Not an error — this contract is for a different provider
    }

    // Type compatibility: provider's output types must be compatible with requirer's input types
    for (const [key, reqType] of Object.entries(req.in)) {
      const provType = matching.out[key];
      if (!provType) {
        errors.push(`Contract "${req.name}": requirer expects input "${key}" but provider does not output it`);
        continue;
      }
      if (!typesCompatible(provType, reqType)) {
        errors.push(`Contract "${req.name}" port "${key}": type mismatch — provider outputs ${provType.type}(${provType.domain ?? ""}) but requirer expects ${reqType.type}(${reqType.domain ?? ""})`);
      }
    }

    // Effect compatibility: provider's effects must be subset of what requirer expects
    if (matching.effects && req.effects) {
      const reqEffects = new Set(req.effects);
      for (const effect of matching.effects) {
        if (!reqEffects.has(effect)) {
          warnings.push(`Contract "${req.name}": provider declares effect "${effect}" not expected by requirer`);
        }
      }
    }

    // Confidence check
    if (req.confidence !== undefined && matching.confidence !== undefined) {
      if (matching.confidence < req.confidence) {
        warnings.push(`Contract "${req.name}": provider confidence ${matching.confidence} below requirer minimum ${req.confidence}`);
      }
    }
  }

  return {
    compatible: errors.length === 0,
    errors,
    warnings,
  };
}

// ─── Scope Dependency Order ──────────────────────────────────────────────────

export function computeScopeOrder(graph: AetherGraph): string[] {
  const scopes = graph.scopes ?? [];
  if (scopes.length === 0) return [];

  // Build scope lookup
  const nodeToScope = new Map<string, string>();
  for (const scope of scopes) {
    for (const nodeId of scope.nodes) {
      nodeToScope.set(nodeId, scope.id);
    }
  }

  // Build scope dependency graph from edges
  const scopeIds = new Set(scopes.map(s => s.id));
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const id of scopeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of graph.edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (!from || !to) continue;

    const fromScope = nodeToScope.get(from.nodeId);
    const toScope = nodeToScope.get(to.nodeId);
    if (!fromScope || !toScope || fromScope === toScope) continue;

    if (!adj.get(fromScope)!.has(toScope)) {
      adj.get(fromScope)!.add(toScope);
      inDegree.set(toScope, (inDegree.get(toScope) ?? 0) + 1);
    }
  }

  // Topological sort (Kahn's)
  const result: string[] = [];
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of adj.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (result.length < scopeIds.size) {
    throw new Error("Cycle detected in scope dependencies");
  }

  return result;
}
