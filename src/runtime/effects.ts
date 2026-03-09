/**
 * AETHER Runtime — Effect Enforcement
 *
 * Tracks and enforces declared effects at runtime:
 * - pure nodes (effects: []) must record zero effects
 * - Effectful nodes may only record declared effects
 * - Effect hierarchy: "database" covers "database.read", "database.write", etc.
 * - "database.read_write" covers both "database.read" and "database.write"
 */

import type { AetherGraph, AetherNode } from "../ir/validator.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EffectReport {
  declaredEffects: Record<string, string[]>;
  executedEffects: string[];
  violations: string[];
  pureNodesVerified: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNode(n: { id: string; hole?: boolean }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true);
}

/**
 * Check if a declared effect covers an executed effect.
 * - "database" covers "database.read", "database.write", "database.read_write"
 * - "database.read_write" covers "database.read" and "database.write"
 * - Exact match always passes
 */
function effectCovers(declared: string, executed: string): boolean {
  if (declared === executed) return true;

  // Parent covers child: "database" covers "database.read"
  if (executed.startsWith(declared + ".")) return true;

  // read_write covers read and write
  if (declared.endsWith(".read_write")) {
    const base = declared.slice(0, -".read_write".length);
    if (executed === base + ".read" || executed === base + ".write") return true;
  }

  return false;
}

// ─── EffectTracker ───────────────────────────────────────────────────────────

export class EffectTracker {
  private declaredEffects: Map<string, string[]> = new Map();
  private pureNodes: Set<string> = new Set();
  private executedEffects: string[] = [];
  private violations: string[] = [];
  private executedByNode: Map<string, string[]> = new Map();

  constructor(graph: AetherGraph) {
    for (const node of graph.nodes) {
      if (!isNode(node)) continue;
      this.declaredEffects.set(node.id, [...node.effects]);
      if (node.pure === true || node.effects.length === 0) {
        this.pureNodes.add(node.id);
      }
    }
  }

  /** Record an effect executed by a node */
  recordEffect(nodeId: string, effect: string): void {
    this.executedEffects.push(effect);

    if (!this.executedByNode.has(nodeId)) {
      this.executedByNode.set(nodeId, []);
    }
    this.executedByNode.get(nodeId)!.push(effect);

    // Check pure violation
    if (this.pureNodes.has(nodeId)) {
      this.violations.push(
        `Pure node "${nodeId}" executed effect "${effect}" — pure nodes must have zero effects`
      );
      return;
    }

    // Check declared effects
    const declared = this.declaredEffects.get(nodeId) ?? [];
    const covered = declared.some(d => effectCovers(d, effect));
    if (!covered) {
      this.violations.push(
        `Node "${nodeId}" executed undeclared effect "${effect}" — declared: [${declared.join(", ")}]`
      );
    }
  }

  /** Get all violations detected so far */
  getViolations(): string[] {
    return [...this.violations];
  }

  /** Full report */
  getReport(): EffectReport {
    const declaredEffects: Record<string, string[]> = {};
    for (const [nodeId, effects] of this.declaredEffects) {
      declaredEffects[nodeId] = effects;
    }

    // Count pure nodes that had zero effects (verified)
    let pureNodesVerified = 0;
    for (const nodeId of this.pureNodes) {
      const executed = this.executedByNode.get(nodeId);
      if (!executed || executed.length === 0) {
        pureNodesVerified++;
      }
    }

    return {
      declaredEffects,
      executedEffects: [...this.executedEffects],
      violations: [...this.violations],
      pureNodesVerified,
    };
  }
}
