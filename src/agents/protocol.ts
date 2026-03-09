/**
 * AETHER Multi-Agent Collaboration Protocol
 *
 * Defines how agents claim scopes, submit work, and integrate.
 * Guarantees integration correctness via boundary contract verification.
 */

import type {
  AetherGraph,
  AetherNode,
  AetherHole,
  AetherEdge,
  Scope,
  BoundaryContract,
  TypeAnnotation,
} from "../ir/validator.js";
import {
  extractScope,
  verifyScope,
  checkBoundaryCompatibility,
  computeScopeOrder,
  type ScopeView,
  type ScopeVerificationResult,
  type CompatibilityResult,
} from "../compiler/scopes.js";
import { validateGraph } from "../ir/validator.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentAssignment {
  agent_id: string;
  scope_id: string;
  assigned_at: string;
  status: "working" | "submitted" | "verified" | "rejected";
}

export interface AgentSubmission {
  agent_id: string;
  scope_id: string;
  nodes: AetherNode[];
  edges: AetherEdge[];
  submitted_at: string;
}

export interface SubmissionResult {
  accepted: boolean;
  errors: string[];
  warnings: string[];
}

export interface BoundaryVerificationResult {
  pairs: Array<{
    provider_scope: string;
    requirer_scope: string;
    compatible: boolean;
    errors: string[];
  }>;
  allCompatible: boolean;
}

export interface IntegrationReport {
  graph_id: string;
  scopes: Array<{
    scope_id: string;
    agent_id: string;
    status: "verified" | "rejected" | "pending";
    internal_valid: boolean;
    boundary_compatible: boolean;
    errors: string[];
  }>;
  cross_scope_compatibility: Array<{
    provider_scope: string;
    requirer_scope: string;
    compatible: boolean;
    errors: string[];
  }>;
  overall: "integrated" | "partial" | "failed";
  verification_percentage: number;
}

export interface SessionStatus {
  graph_id: string;
  total_scopes: number;
  assigned: number;
  submitted: number;
  verified: number;
  rejected: number;
  pending: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNode(n: AetherNode | AetherHole): n is AetherNode {
  return !("hole" in n && (n as any).hole === true);
}

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

// ─── CollaborationSession ────────────────────────────────────────────────────

export class CollaborationSession {
  readonly graphId: string;
  readonly originalGraph: AetherGraph;
  private assignments: Map<string, AgentAssignment> = new Map(); // scope_id → assignment
  private submissions: Map<string, AgentSubmission> = new Map(); // scope_id → submission
  private scopeViews: Map<string, ScopeView> = new Map();

  constructor(graph: AetherGraph) {
    if (!graph.scopes || graph.scopes.length === 0) {
      throw new Error("Cannot create collaboration session: graph has no scopes");
    }
    this.graphId = graph.id;
    this.originalGraph = graph;
  }

  assign(agentId: string, scopeId: string): ScopeView {
    const scope = this.originalGraph.scopes!.find(s => s.id === scopeId);
    if (!scope) {
      throw new Error(`Scope "${scopeId}" not found in graph`);
    }

    const existing = this.assignments.get(scopeId);
    if (existing && existing.status !== "rejected") {
      throw new Error(`Scope "${scopeId}" is already assigned to agent "${existing.agent_id}"`);
    }

    const assignment: AgentAssignment = {
      agent_id: agentId,
      scope_id: scopeId,
      assigned_at: new Date().toISOString(),
      status: "working",
    };
    this.assignments.set(scopeId, assignment);

    const scopeView = extractScope(this.originalGraph, scopeId);
    this.scopeViews.set(scopeId, scopeView);

    return scopeView;
  }

  submit(submission: AgentSubmission): SubmissionResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check assignment
    const assignment = this.assignments.get(submission.scope_id);
    if (!assignment) {
      return { accepted: false, errors: [`Scope "${submission.scope_id}" is not assigned to any agent`], warnings: [] };
    }
    if (assignment.agent_id !== submission.agent_id) {
      return {
        accepted: false,
        errors: [`Agent "${submission.agent_id}" is not assigned to scope "${submission.scope_id}" (assigned to "${assignment.agent_id}")`],
        warnings: [],
      };
    }

    const scope = this.originalGraph.scopes!.find(s => s.id === submission.scope_id)!;
    const scopeNodeIds = new Set(scope.nodes);

    // 1. Check submitted nodes belong to the assigned scope
    for (const node of submission.nodes) {
      if (!scopeNodeIds.has(node.id)) {
        errors.push(`Node "${node.id}" does not belong to scope "${submission.scope_id}"`);
      }
    }

    // 2. Validate submitted nodes have required structure
    for (const node of submission.nodes) {
      if (!node.id || !node.in || !node.out || !node.contract) {
        errors.push(`Node "${node.id}": missing required fields (id, in, out, contract)`);
        continue;
      }
      const isEffectful = node.effects && node.effects.length > 0 && node.pure !== true;
      if (isEffectful && !node.recovery) {
        errors.push(`Node "${node.id}": has effects but no recovery block`);
      }
    }

    // 3. Check edges reference valid ports
    const submittedNodeMap = new Map<string, AetherNode>();
    for (const n of submission.nodes) submittedNodeMap.set(n.id, n);

    for (const edge of submission.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (!from || !to) {
        errors.push(`Edge "${edge.from}" → "${edge.to}": invalid format`);
        continue;
      }
      // Only check edges within scope
      if (scopeNodeIds.has(from.nodeId) && scopeNodeIds.has(to.nodeId)) {
        const fromNode = submittedNodeMap.get(from.nodeId);
        const toNode = submittedNodeMap.get(to.nodeId);
        if (fromNode && !(from.portName in fromNode.out)) {
          errors.push(`Edge from="${edge.from}": port "${from.portName}" not found on node "${from.nodeId}"`);
        }
        if (toNode && !(to.portName in toNode.in)) {
          errors.push(`Edge to="${edge.to}": port "${to.portName}" not found on node "${to.nodeId}"`);
        }
      }
    }

    // 4. Verify provides contracts are satisfiable
    const provides = scope.boundary_contracts?.provides ?? [];
    const scopeView = this.scopeViews.get(submission.scope_id);
    if (scopeView) {
      for (const prov of provides) {
        const hasOutput = scopeView.boundaryEdges.some(edge => {
          const from = parseEdgeRef(edge.from);
          if (!from || !scopeNodeIds.has(from.nodeId)) return false;
          const node = submittedNodeMap.get(from.nodeId);
          if (!node) return false;
          return Object.values(prov.out).some(
            provType => Object.values(node.out).some(nodeType => nodeType.type === provType.type)
          );
        });

        if (!hasOutput && Object.keys(prov.out).length > 0) {
          errors.push(`Provides contract "${prov.name}": no matching boundary output from submitted nodes`);
        }
      }
    }

    if (errors.length === 0) {
      assignment.status = "submitted";
      this.submissions.set(submission.scope_id, submission);
      return { accepted: true, errors: [], warnings };
    } else {
      assignment.status = "rejected";
      return { accepted: false, errors, warnings };
    }
  }

  verifyBoundaries(): BoundaryVerificationResult {
    const pairs: BoundaryVerificationResult["pairs"] = [];
    const scopes = this.originalGraph.scopes!;

    // Build node→scope map
    const nodeToScope = new Map<string, string>();
    for (const scope of scopes) {
      for (const nodeId of scope.nodes) {
        nodeToScope.set(nodeId, scope.id);
      }
    }

    // Find connected scope pairs from edges
    const checkedPairs = new Set<string>();
    for (const edge of this.originalGraph.edges) {
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (!from || !to) continue;
      const fromScope = nodeToScope.get(from.nodeId);
      const toScope = nodeToScope.get(to.nodeId);
      if (!fromScope || !toScope || fromScope === toScope) continue;

      const pairKey = `${fromScope}→${toScope}`;
      if (checkedPairs.has(pairKey)) continue;
      checkedPairs.add(pairKey);

      // Only check if both scopes are submitted
      const fromAssignment = this.assignments.get(fromScope);
      const toAssignment = this.assignments.get(toScope);
      if (!fromAssignment || !toAssignment) continue;
      if (fromAssignment.status !== "submitted" && fromAssignment.status !== "verified") continue;
      if (toAssignment.status !== "submitted" && toAssignment.status !== "verified") continue;

      const providerScope = scopes.find(s => s.id === fromScope)!;
      const requirerScope = scopes.find(s => s.id === toScope)!;
      const compat = checkBoundaryCompatibility(providerScope, requirerScope);

      pairs.push({
        provider_scope: fromScope,
        requirer_scope: toScope,
        compatible: compat.compatible,
        errors: compat.errors,
      });
    }

    return {
      pairs,
      allCompatible: pairs.every(p => p.compatible),
    };
  }

  integrate(): IntegrationReport {
    const scopes = this.originalGraph.scopes!;
    const scopeResults: IntegrationReport["scopes"] = [];

    // 1. Verify each submitted scope
    for (const scope of scopes) {
      const assignment = this.assignments.get(scope.id);
      if (!assignment) {
        scopeResults.push({
          scope_id: scope.id,
          agent_id: "(unassigned)",
          status: "pending",
          internal_valid: false,
          boundary_compatible: false,
          errors: ["Scope not assigned to any agent"],
        });
        continue;
      }

      if (assignment.status === "rejected") {
        scopeResults.push({
          scope_id: scope.id,
          agent_id: assignment.agent_id,
          status: "rejected",
          internal_valid: false,
          boundary_compatible: false,
          errors: ["Submission was rejected"],
        });
        continue;
      }

      if (assignment.status === "working") {
        scopeResults.push({
          scope_id: scope.id,
          agent_id: assignment.agent_id,
          status: "pending",
          internal_valid: false,
          boundary_compatible: false,
          errors: ["Agent has not submitted work yet"],
        });
        continue;
      }

      // Verify scope internally
      const scopeView = this.scopeViews.get(scope.id)!;
      const verification = verifyScope(scopeView);
      const internalValid = verification.internalValid && verification.boundariesSatisfied;

      scopeResults.push({
        scope_id: scope.id,
        agent_id: assignment.agent_id,
        status: internalValid ? "verified" : "rejected",
        internal_valid: internalValid,
        boundary_compatible: true, // will be updated below
        errors: verification.errors,
      });

      if (internalValid) {
        assignment.status = "verified";
      } else {
        assignment.status = "rejected";
      }
    }

    // 2. Check pairwise boundary compatibility
    const boundaryResult = this.verifyBoundaries();

    // Update boundary_compatible flags
    for (const pair of boundaryResult.pairs) {
      if (!pair.compatible) {
        const provResult = scopeResults.find(r => r.scope_id === pair.provider_scope);
        const reqResult = scopeResults.find(r => r.scope_id === pair.requirer_scope);
        if (provResult) {
          provResult.boundary_compatible = false;
          provResult.errors.push(`Boundary incompatible with "${pair.requirer_scope}": ${pair.errors.join(", ")}`);
        }
        if (reqResult) {
          reqResult.boundary_compatible = false;
          reqResult.errors.push(`Boundary incompatible with "${pair.provider_scope}": ${pair.errors.join(", ")}`);
        }
      }
    }

    // 3. Check for ID conflicts across submissions
    const allNodeIds = new Map<string, string>(); // node_id → scope_id
    for (const [scopeId, submission] of this.submissions) {
      for (const node of submission.nodes) {
        if (allNodeIds.has(node.id)) {
          const otherScope = allNodeIds.get(node.id)!;
          const result = scopeResults.find(r => r.scope_id === scopeId);
          if (result) {
            result.errors.push(`ID conflict: node "${node.id}" also exists in scope "${otherScope}"`);
            result.status = "rejected";
          }
        } else {
          allNodeIds.set(node.id, scopeId);
        }
      }
    }

    // 4. Compute composed confidence
    const confidences: number[] = [];
    for (const scope of scopes) {
      const provides = scope.boundary_contracts?.provides ?? [];
      for (const prov of provides) {
        if (prov.confidence !== undefined) {
          confidences.push(prov.confidence);
        }
      }
    }
    // Also collect node-level confidences
    for (const [, submission] of this.submissions) {
      for (const node of submission.nodes) {
        if (node.confidence !== undefined) {
          confidences.push(node.confidence);
        }
      }
    }

    // 5. Determine overall status
    const verifiedCount = scopeResults.filter(r => r.status === "verified").length;
    const totalScopes = scopes.length;
    const allVerified = verifiedCount === totalScopes && boundaryResult.allCompatible;
    const noneVerified = verifiedCount === 0;

    const overall: IntegrationReport["overall"] = allVerified
      ? "integrated"
      : noneVerified
        ? "failed"
        : "partial";

    const verification_percentage = totalScopes > 0
      ? Math.round((verifiedCount / totalScopes) * 100)
      : 0;

    return {
      graph_id: this.graphId,
      scopes: scopeResults,
      cross_scope_compatibility: boundaryResult.pairs,
      overall,
      verification_percentage,
    };
  }

  status(): SessionStatus {
    const scopes = this.originalGraph.scopes!;
    let assigned = 0, submitted = 0, verified = 0, rejected = 0, pending = 0;

    for (const scope of scopes) {
      const a = this.assignments.get(scope.id);
      if (!a) { pending++; continue; }
      assigned++;
      if (a.status === "submitted") submitted++;
      else if (a.status === "verified") verified++;
      else if (a.status === "rejected") rejected++;
    }

    return {
      graph_id: this.graphId,
      total_scopes: scopes.length,
      assigned,
      submitted,
      verified,
      rejected,
      pending: scopes.length - assigned,
    };
  }

  exportGraph(): AetherGraph {
    // Merge all verified submissions into a single flat graph
    const scopes = this.originalGraph.scopes!;
    const allNodes: (AetherNode | AetherHole)[] = [];
    const allEdges: AetherEdge[] = [];
    const seenEdges = new Set<string>();

    for (const scope of scopes) {
      const submission = this.submissions.get(scope.id);
      if (submission) {
        allNodes.push(...submission.nodes);
        for (const edge of submission.edges) {
          const key = `${edge.from}→${edge.to}`;
          if (!seenEdges.has(key)) {
            seenEdges.add(key);
            allEdges.push(edge);
          }
        }
      }
    }

    // Add cross-scope edges from the original graph
    const submittedNodeIds = new Set(allNodes.map(n => n.id));
    for (const edge of this.originalGraph.edges) {
      const key = `${edge.from}→${edge.to}`;
      if (seenEdges.has(key)) continue;
      const from = parseEdgeRef(edge.from);
      const to = parseEdgeRef(edge.to);
      if (from && to && submittedNodeIds.has(from.nodeId) && submittedNodeIds.has(to.nodeId)) {
        seenEdges.add(key);
        allEdges.push(edge);
      }
    }

    return {
      id: this.originalGraph.id,
      version: this.originalGraph.version,
      effects: this.originalGraph.effects,
      nodes: allNodes,
      edges: allEdges,
      metadata: this.originalGraph.metadata,
      state_types: this.originalGraph.state_types,
    };
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function createSession(graph: AetherGraph): CollaborationSession {
  return new CollaborationSession(graph);
}

export function assignScope(
  session: CollaborationSession,
  agentId: string,
  scopeId: string,
): ScopeView {
  return session.assign(agentId, scopeId);
}

export function submitScope(
  session: CollaborationSession,
  submission: AgentSubmission,
): SubmissionResult {
  return session.submit(submission);
}

export function integrate(session: CollaborationSession): IntegrationReport {
  return session.integrate();
}

export function exportGraph(session: CollaborationSession): AetherGraph {
  return session.exportGraph();
}
