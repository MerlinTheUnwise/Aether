/**
 * AETHER LLVM IR — Confidence Tracking
 *
 * Generates LLVM IR for confidence propagation:
 *   propagated = node_confidence × min(input_confidences)
 *   needs_oversight = propagated < threshold
 */

import type { AetherNode } from "./types.js";

// ─── Confidence Code Generation ──────────────────────────────────────────────

/**
 * Generate LLVM IR global variables for per-node confidence values.
 */
export function generateConfidenceGlobals(nodes: AetherNode[]): string[] {
  const globals: string[] = [];

  for (const node of nodes) {
    const sid = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const conf = node.confidence ?? 1.0;
    globals.push(`@conf_${sid} = global double ${formatDouble(conf)}`);
  }

  // Global confidence threshold
  globals.push("@confidence_threshold = global double 0.7");

  return globals;
}

/**
 * Generate LLVM IR instructions for confidence propagation after a node call.
 * Inserted into the main function after each node invocation.
 *
 * Uses the node's own confidence value directly (inputs' confidences were already
 * propagated when their nodes ran). The node's propagated confidence is stored
 * via aether_confidence_set for downstream use.
 */
export function generateConfidenceCode(node: AetherNode, sid: string): string | null {
  if (node.confidence === undefined && node.confidence !== 0) return null;

  const lines: string[] = [];

  lines.push(`  ; Confidence propagation for ${node.id}`);
  lines.push(`  %node_conf_${sid} = load double, double* @conf_${sid}`);

  // Use the node's own confidence — input confidence was already propagated
  // and factored in during the node function's confidence gate
  lines.push(`  %propagated_${sid} = fadd double %node_conf_${sid}, 0.0  ; identity (propagation done in gate)`);

  // Check threshold
  lines.push(`  %threshold_${sid} = load double, double* @confidence_threshold`);
  lines.push(`  %needs_oversight_${sid} = fcmp olt double %propagated_${sid}, %threshold_${sid}`);

  return lines.join("\n");
}

/**
 * Generate a confidence result struct pairing node output with confidence.
 */
export function generateConfidenceResultStruct(sid: string): string {
  return `%${sid}_result_with_conf = type { %${sid}_out, %ConfidenceValue }`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDouble(n: number): string {
  // LLVM IR requires specific double format
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}
