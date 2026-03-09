/**
 * AETHER Implementation Registry
 *
 * Matches AETHER nodes to their implementations via:
 * 1. Override (user-provided)
 * 2. Exact ID match
 * 3. Regex pattern match
 * 4. Type signature match
 * 5. Stub fallback (no match)
 */

import type { AetherNode, AetherGraph } from "../ir/validator.js";
import type { NodeImplementation, RegisteredImplementation, ImplementationMeta } from "./types.js";
import { getCoreImplementations } from "./index.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SignatureMatch {
  inputTypes?: Record<string, string>;
  outputTypes?: Record<string, string>;
  effects?: string[];
  tags?: string[];
}

export interface ResolvedImplementation {
  implementation: NodeImplementation;
  source: "id" | "pattern" | "signature" | "override";
  matchReason: string;
}

export interface GraphResolution {
  resolved: Map<string, ResolvedImplementation>;
  unresolved: string[];
  stubbed: string[];
  report: string;
}

// ─── Registry ───────────────────────────────────────────────────────────────────

function isNode(n: any): n is AetherNode {
  return !("hole" in n && n.hole === true) && !("intent" in n && n.intent === true);
}

export class ImplementationRegistry {
  private byId: Map<string, RegisteredImplementation> = new Map();
  private byPattern: Array<{ pattern: RegExp; impl: RegisteredImplementation }> = [];
  private bySignature: Array<{ sig: SignatureMatch; impl: RegisteredImplementation }> = [];
  private overrides: Map<string, NodeImplementation> = new Map();

  constructor() {}

  registerById(nodeId: string, impl: RegisteredImplementation): void {
    this.byId.set(nodeId, impl);
  }

  registerByPattern(pattern: RegExp, impl: RegisteredImplementation): void {
    this.byPattern.push({ pattern, impl });
  }

  registerBySignature(signature: SignatureMatch, impl: RegisteredImplementation): void {
    this.bySignature.push({ sig: signature, impl });
  }

  registerCore(): void {
    const core = getCoreImplementations();
    for (const impl of core) {
      this.byId.set(impl.meta.id, impl);
    }
  }

  resolve(node: AetherNode): ResolvedImplementation | null {
    // 1. Override
    const override = this.overrides.get(node.id);
    if (override) {
      return {
        implementation: override,
        source: "override",
        matchReason: `User override for "${node.id}"`,
      };
    }

    // 2. Exact ID
    const exact = this.byId.get(node.id);
    if (exact) {
      return {
        implementation: exact.fn,
        source: "id",
        matchReason: `Exact ID match: "${node.id}"`,
      };
    }

    // 3. Pattern match
    for (const { pattern, impl } of this.byPattern) {
      if (pattern.test(node.id)) {
        return {
          implementation: impl.fn,
          source: "pattern",
          matchReason: `Pattern match: ${pattern} on "${node.id}"`,
        };
      }
    }

    // 4. Signature match
    for (const { sig, impl } of this.bySignature) {
      if (this.matchesSignature(node, sig)) {
        return {
          implementation: impl.fn,
          source: "signature",
          matchReason: `Signature match on "${node.id}": ${JSON.stringify(sig)}`,
        };
      }
    }

    return null;
  }

  resolveAll(graph: AetherGraph): GraphResolution {
    const resolved = new Map<string, ResolvedImplementation>();
    const unresolved: string[] = [];
    const stubbed: string[] = [];
    const lines: string[] = [];

    const nodes = graph.nodes.filter(n => isNode(n)) as AetherNode[];

    for (const node of nodes) {
      const result = this.resolve(node);
      if (result) {
        resolved.set(node.id, result);
        lines.push(`  ✓ ${node.id} — ${result.source}: ${result.matchReason}`);
      } else {
        unresolved.push(node.id);
        stubbed.push(node.id);
        lines.push(`  ⚠ ${node.id} — UNRESOLVED (will use stub)`);
      }
    }

    const report = [
      `Resolution Report: ${resolved.size} resolved, ${unresolved.length} unresolved`,
      ...lines,
    ].join("\n");

    return { resolved, unresolved, stubbed, report };
  }

  override(nodeId: string, impl: NodeImplementation): void {
    this.overrides.set(nodeId, impl);
  }

  list(): RegisteredImplementation[] {
    const all: RegisteredImplementation[] = [];
    for (const impl of this.byId.values()) {
      all.push(impl);
    }
    for (const { impl } of this.byPattern) {
      if (!all.includes(impl)) all.push(impl);
    }
    for (const { impl } of this.bySignature) {
      if (!all.includes(impl)) all.push(impl);
    }
    return all;
  }

  private matchesSignature(node: AetherNode, sig: SignatureMatch): boolean {
    // Check input types
    if (sig.inputTypes) {
      for (const [name, type] of Object.entries(sig.inputTypes)) {
        const nodeIn = node.in[name];
        if (!nodeIn) return false;
        if (nodeIn.type !== type && type !== "Any") return false;
      }
    }

    // Check output types
    if (sig.outputTypes) {
      for (const [name, type] of Object.entries(sig.outputTypes)) {
        const nodeOut = node.out[name];
        if (!nodeOut) return false;
        if (nodeOut.type !== type && type !== "Any") return false;
      }
    }

    // Check effects
    if (sig.effects) {
      for (const effect of sig.effects) {
        if (!node.effects.includes(effect)) return false;
      }
    }

    return true;
  }
}
