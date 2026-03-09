/**
 * AETHER Incremental Verification Engine (Pillar 8)
 *
 * Validates partial graphs with typed holes, verifying nodes one at a time.
 * Essential for AI generation workflow: build node-by-node with instant feedback.
 */

import { createRequire } from "module";
import {
  validateGraph,
  type AetherNode,
  type AetherHole,
  type AetherEdge,
  type AetherGraph,
  type TypeAnnotation,
  type Contract,
  type ValidationResult,
} from "../ir/validator.js";
import { checkTypes } from "./checker.js";
import { verifyNode, getZ3 } from "./verifier.js";

const _require = createRequire(import.meta.url);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NodeAddResult {
  accepted: boolean;
  node_id: string;
  validation: {
    schema: "pass" | "fail";
    contracts: "verified" | "failed" | "unsupported";
    confidence_rule: "pass" | "fail" | "n/a";
    recovery_rule: "pass" | "fail" | "n/a";
  };
  errors: string[];
}

export interface HoleAddResult {
  accepted: boolean;
  hole_id: string;
  errors: string[];
}

export interface FillResult {
  accepted: boolean;
  node_id: string;
  errors: string[];
}

export interface EdgeAddResult {
  accepted: boolean;
  edge: string;
  errors: string[];
}

export interface RemoveResult {
  removed: boolean;
  errors: string[];
}

export interface IncrementalReport {
  nodes: string[];
  holes: string[];
  edges: { from: string; to: string }[];
  verified_count: number;
  hole_count: number;
  completeness: number;
}

// ─── IncrementalBuilder ───────────────────────────────────────────────────────

export class IncrementalBuilder {
  private graphId: string;
  private version: number;
  private nodes: Map<string, AetherNode> = new Map();
  private holes: Map<string, AetherHole> = new Map();
  private edges: AetherEdge[] = [];
  private verifiedNodes: Set<string> = new Set();

  constructor(graphId: string, version: number = 1) {
    this.graphId = graphId;
    this.version = version;
  }

  async addNode(node: AetherNode): Promise<NodeAddResult> {
    const errors: string[] = [];
    const validation: NodeAddResult["validation"] = {
      schema: "pass",
      contracts: "unsupported",
      confidence_rule: "n/a",
      recovery_rule: "n/a",
    };

    // Check duplicate ID
    if (this.nodes.has(node.id) || this.holes.has(node.id)) {
      return {
        accepted: false,
        node_id: node.id,
        validation,
        errors: [`Node or hole with id "${node.id}" already exists`],
      };
    }

    // Validate required fields
    if (!node.id || !node.in || !node.out || !node.contract || !node.effects) {
      validation.schema = "fail";
      errors.push(`Node "${node.id}" missing required fields (id, in, out, contract, effects)`);
      return { accepted: false, node_id: node.id, validation, errors };
    }

    // Confidence rule: < 0.85 requires adversarial_check
    if (node.confidence !== undefined && node.confidence < 0.85) {
      validation.confidence_rule = "fail";
      if (!node.adversarial_check || node.adversarial_check.break_if.length === 0) {
        errors.push(
          `Node "${node.id}": confidence=${node.confidence} < 0.85 requires adversarial_check`
        );
      } else {
        validation.confidence_rule = "pass";
      }
    } else if (node.confidence !== undefined) {
      validation.confidence_rule = "pass";
    }

    // Recovery rule: effectful non-pure nodes require recovery
    const isEffectful = node.effects.length > 0 && node.pure !== true;
    if (isEffectful) {
      if (!node.recovery) {
        validation.recovery_rule = "fail";
        errors.push(
          `Node "${node.id}": has effects [${node.effects.join(", ")}] but no recovery block`
        );
      } else {
        validation.recovery_rule = "pass";
      }
    } else if (node.pure === true || node.effects.length === 0) {
      validation.recovery_rule = "pass";
    }

    if (errors.length > 0) {
      validation.schema = "fail";
      return { accepted: false, node_id: node.id, validation, errors };
    }

    // Type check edges touching this node
    const edgeErrors = this.checkEdgesForNode(node.id, node);
    if (edgeErrors.length > 0) {
      errors.push(...edgeErrors);
      return { accepted: false, node_id: node.id, validation, errors };
    }

    // Z3 contract verification
    try {
      const z3 = await getZ3();
      const result = await verifyNode(node, z3);
      const hasVerified = result.postconditions.some(p => p.status === "verified") ||
        result.adversarial_checks.some(a => a.status === "passed");
      const hasFailed = result.postconditions.some(p => p.status === "failed") ||
        result.adversarial_checks.some(a => a.status === "failed");

      if (hasFailed) {
        validation.contracts = "failed";
      } else if (hasVerified) {
        validation.contracts = "verified";
      } else {
        validation.contracts = "unsupported";
      }
    } catch {
      validation.contracts = "unsupported";
    }

    this.nodes.set(node.id, node);
    this.verifiedNodes.add(node.id);
    return { accepted: true, node_id: node.id, validation, errors: [] };
  }

  addHole(hole: AetherHole): HoleAddResult {
    if (this.nodes.has(hole.id) || this.holes.has(hole.id)) {
      return {
        accepted: false,
        hole_id: hole.id,
        errors: [`Node or hole with id "${hole.id}" already exists`],
      };
    }

    if (!hole.must_satisfy || !hole.must_satisfy.in || !hole.must_satisfy.out) {
      return {
        accepted: false,
        hole_id: hole.id,
        errors: [`Hole "${hole.id}" must have must_satisfy with in and out`],
      };
    }

    this.holes.set(hole.id, hole);
    return { accepted: true, hole_id: hole.id, errors: [] };
  }

  async fillHole(holeId: string, node: AetherNode): Promise<FillResult> {
    const hole = this.holes.get(holeId);
    if (!hole) {
      return { accepted: false, node_id: holeId, errors: [`Hole "${holeId}" not found`] };
    }

    const errors: string[] = [];
    const ms = hole.must_satisfy;

    // Check in ports: node must accept at least what hole requires
    for (const [portName, portType] of Object.entries(ms.in)) {
      if (!(portName in node.in)) {
        errors.push(`Node missing required input port "${portName}" from hole's must_satisfy`);
      } else {
        if (node.in[portName].type !== portType.type) {
          errors.push(
            `Input port "${portName}": expected type "${portType.type}", got "${node.in[portName].type}"`
          );
        }
      }
    }

    // Check out ports: node must provide at least what hole promises
    for (const [portName, portType] of Object.entries(ms.out)) {
      if (!(portName in node.out)) {
        errors.push(`Node missing required output port "${portName}" from hole's must_satisfy`);
      } else {
        if (node.out[portName].type !== portType.type) {
          errors.push(
            `Output port "${portName}": expected type "${portType.type}", got "${node.out[portName].type}"`
          );
        }
      }
    }

    // Check effects
    if (ms.effects) {
      for (const eff of ms.effects) {
        if (!node.effects.includes(eff)) {
          errors.push(`Node missing required effect "${eff}" from hole's must_satisfy`);
        }
      }
    }

    if (errors.length > 0) {
      return { accepted: false, node_id: holeId, errors };
    }

    // Replace hole with node (keep the same ID)
    node = { ...node, id: holeId };
    this.holes.delete(holeId);
    this.nodes.set(holeId, node);
    this.verifiedNodes.add(holeId);

    // Re-validate edges touching this node
    const edgeErrors = this.checkEdgesForNode(holeId, node);
    if (edgeErrors.length > 0) {
      // Rollback
      this.nodes.delete(holeId);
      this.verifiedNodes.delete(holeId);
      this.holes.set(holeId, hole);
      return { accepted: false, node_id: holeId, errors: edgeErrors };
    }

    return { accepted: true, node_id: holeId, errors: [] };
  }

  addEdge(edge: AetherEdge): EdgeAddResult {
    const edgeLabel = `${edge.from}→${edge.to}`;
    const errors: string[] = [];

    const fromParsed = this.parseEdgeRef(edge.from);
    const toParsed = this.parseEdgeRef(edge.to);

    if (!fromParsed || !toParsed) {
      return { accepted: false, edge: edgeLabel, errors: ["Invalid edge reference format"] };
    }

    // Both endpoints must exist
    const fromNode = this.nodes.get(fromParsed.nodeId) as AetherNode | undefined;
    const fromHole = this.holes.get(fromParsed.nodeId);
    const toNode = this.nodes.get(toParsed.nodeId) as AetherNode | undefined;
    const toHole = this.holes.get(toParsed.nodeId);

    if (!fromNode && !fromHole) {
      errors.push(`Source node "${fromParsed.nodeId}" does not exist`);
    }
    if (!toNode && !toHole) {
      errors.push(`Target node "${toParsed.nodeId}" does not exist`);
    }
    if (errors.length > 0) {
      return { accepted: false, edge: edgeLabel, errors };
    }

    // Port direction checks for concrete nodes
    if (fromNode && !(fromParsed.portName in fromNode.out)) {
      errors.push(`"${edge.from}" is not an output port`);
    }
    if (toNode && !(toParsed.portName in toNode.in)) {
      errors.push(`"${edge.to}" is not an input port`);
    }
    // Port checks for holes
    if (fromHole && !(fromParsed.portName in fromHole.must_satisfy.out)) {
      errors.push(`"${edge.from}" is not a declared output port on hole`);
    }
    if (toHole && !(toParsed.portName in toHole.must_satisfy.in)) {
      errors.push(`"${edge.to}" is not a declared input port on hole`);
    }

    if (errors.length > 0) {
      return { accepted: false, edge: edgeLabel, errors };
    }

    // Type compatibility check (only when both are concrete nodes)
    if (fromNode && toNode) {
      const fromType = fromNode.out[fromParsed.portName];
      const toType = toNode.in[toParsed.portName];
      if (fromType && toType) {
        if (fromType.domain && toType.domain && fromType.domain !== toType.domain) {
          errors.push(`Domain mismatch: ${fromType.domain} → ${toType.domain}`);
        }
      }
    }

    if (errors.length > 0) {
      return { accepted: false, edge: edgeLabel, errors };
    }

    // Cycle detection: add edge temporarily, check for cycle
    this.edges.push(edge);
    if (this.hasCycle()) {
      this.edges.pop();
      return { accepted: false, edge: edgeLabel, errors: ["Edge would create a cycle"] };
    }

    return { accepted: true, edge: edgeLabel, errors: [] };
  }

  removeNode(nodeId: string): RemoveResult {
    if (this.nodes.has(nodeId)) {
      this.nodes.delete(nodeId);
      this.verifiedNodes.delete(nodeId);
      // Remove edges referencing this node
      this.edges = this.edges.filter(e => {
        const from = this.parseEdgeRef(e.from);
        const to = this.parseEdgeRef(e.to);
        return from?.nodeId !== nodeId && to?.nodeId !== nodeId;
      });
      return { removed: true, errors: [] };
    }
    if (this.holes.has(nodeId)) {
      this.holes.delete(nodeId);
      this.edges = this.edges.filter(e => {
        const from = this.parseEdgeRef(e.from);
        const to = this.parseEdgeRef(e.to);
        return from?.nodeId !== nodeId && to?.nodeId !== nodeId;
      });
      return { removed: true, errors: [] };
    }
    return { removed: false, errors: [`Node or hole "${nodeId}" not found`] };
  }

  removeEdge(from: string, to: string): RemoveResult {
    const idx = this.edges.findIndex(e => e.from === from && e.to === to);
    if (idx >= 0) {
      this.edges.splice(idx, 1);
      return { removed: true, errors: [] };
    }
    return { removed: false, errors: [`Edge ${from}→${to} not found`] };
  }

  getGraph(): AetherGraph {
    const allNodes: (AetherNode | AetherHole)[] = [
      ...Array.from(this.nodes.values()),
      ...Array.from(this.holes.values()),
    ];

    return {
      id: this.graphId,
      version: this.version,
      effects: this.collectEffects(),
      partial: this.holes.size > 0,
      nodes: allNodes,
      edges: [...this.edges],
    };
  }

  getReport(): IncrementalReport {
    const total = this.nodes.size + this.holes.size;
    return {
      nodes: Array.from(this.nodes.keys()),
      holes: Array.from(this.holes.keys()),
      edges: this.edges.map(e => ({ from: e.from, to: e.to })),
      verified_count: this.verifiedNodes.size,
      hole_count: this.holes.size,
      completeness: total > 0 ? this.verifiedNodes.size / total : 1,
    };
  }

  finalize(): ValidationResult {
    if (this.holes.size > 0) {
      const holeIds = Array.from(this.holes.keys());
      return {
        valid: false,
        errors: [`Cannot finalize: ${this.holes.size} hole(s) remaining: ${holeIds.join(", ")}`],
        warnings: [],
        supervisedCount: 0,
        holeCount: this.holes.size,
        completeness: this.nodes.size / (this.nodes.size + this.holes.size),
      };
    }

    const graph = this.getGraph();
    graph.partial = false;
    return validateGraph(graph);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
    const dot = ref.indexOf(".");
    if (dot < 1 || dot === ref.length - 1) return null;
    return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
  }

  private collectEffects(): string[] {
    const effects = new Set<string>();
    for (const node of this.nodes.values()) {
      for (const e of node.effects) effects.add(e);
    }
    return Array.from(effects);
  }

  private checkEdgesForNode(nodeId: string, node: AetherNode): string[] {
    const errors: string[] = [];
    for (const edge of this.edges) {
      const from = this.parseEdgeRef(edge.from);
      const to = this.parseEdgeRef(edge.to);
      if (from?.nodeId === nodeId) {
        if (!(from.portName in node.out)) {
          errors.push(`Edge ${edge.from}→${edge.to}: port "${from.portName}" not an output on node "${nodeId}"`);
        }
      }
      if (to?.nodeId === nodeId) {
        if (!(to.portName in node.in)) {
          errors.push(`Edge ${edge.from}→${edge.to}: port "${to.portName}" not an input on node "${nodeId}"`);
        }
      }
    }
    return errors;
  }

  private hasCycle(): boolean {
    const allIds = new Set([...this.nodes.keys(), ...this.holes.keys()]);
    const adj = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const id of allIds) {
      adj.set(id, new Set());
      inDegree.set(id, 0);
    }

    for (const edge of this.edges) {
      const from = this.parseEdgeRef(edge.from);
      const to = this.parseEdgeRef(edge.to);
      if (from && to && allIds.has(from.nodeId) && allIds.has(to.nodeId)) {
        if (from.nodeId !== to.nodeId) {
          const neighbors = adj.get(from.nodeId)!;
          if (!neighbors.has(to.nodeId)) {
            neighbors.add(to.nodeId);
            inDegree.set(to.nodeId, (inDegree.get(to.nodeId) ?? 0) + 1);
          }
        }
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const neighbor of adj.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    return visited < allIds.size;
  }
}
