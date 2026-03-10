/**
 * AETHER Runtime — Recovery Strategy Engine
 *
 * Handles error recovery for graph nodes: retry with backoff, fallback values,
 * escalation to oversight, and response strategies.
 */

import type { AetherNode, TypeAnnotation } from "../ir/validator.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export class EscalationError extends Error {
  nodeId: string;

  constructor(nodeId: string, message?: string) {
    super(`Escalation required for "${nodeId}"${message ? `: ${message}` : ""}`);
    this.name = "EscalationError";
    this.nodeId = nodeId;
  }
}

/** Minimal context needed by recovery — avoids circular dependency with executor */
export interface RecoveryContext {
  nodeImplementations: Map<string, (inputs: Record<string, any>) => Promise<Record<string, any>>>;
  onOversightRequired?: (nodeId: string, confidence: number, payload: any) => Promise<Record<string, any>>;
}

// ─── Condition Matching ──────────────────────────────────────────────────────

/** Match an error against a recovery condition name */
export function matchesCondition(error: Error, condition: string): boolean {
  const msg = error.message.toLowerCase();
  const cond = condition.toLowerCase();
  return msg.includes(cond) || (error as any).type === condition || (error as any).code === condition;
}

// ─── Retry with Backoff ──────────────────────────────────────────────────────

/** Retry a node's implementation with exponential or linear backoff */
export async function retryWithBackoff(
  node: AetherNode,
  inputs: Record<string, any>,
  context: RecoveryContext,
  params?: Record<string, unknown>
): Promise<Record<string, any>> {
  const count = (params?.count as number) ?? (params?.attempts as number) ?? 3;
  const backoff = (params?.backoff as string) ?? "exponential";

  for (let attempt = 1; attempt <= count; attempt++) {
    const delay = backoff === "exponential" ? 100 * Math.pow(2, attempt) : 100 * attempt;
    await new Promise(r => setTimeout(r, delay));
    try {
      const impl = context.nodeImplementations.get(node.id);
      if (impl) return await impl(inputs);
    } catch (e) {
      if (attempt === count) throw e;
    }
  }
  throw new Error(`Retry exhausted for "${node.id}"`);
}

// ─── Default Generation ──────────────────────────────────────────────────────

function generateDefault(type: TypeAnnotation): any {
  const t = type.type;
  if (t === "String") return "";
  if (t === "Bool") return true;
  if (t === "Int") return 0;
  if (t === "Float64") return 0.0;
  if (t.startsWith("List")) return [];
  if (t.startsWith("Map")) return {};
  if (t.startsWith("Set")) return [];
  return "";
}

function generateDefaults(out: Record<string, TypeAnnotation>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [port, type] of Object.entries(out)) {
    result[port] = generateDefault(type);
  }
  return result;
}

// ─── Recovery Execution ──────────────────────────────────────────────────────

/** Execute the appropriate recovery strategy for a failed node */
export async function executeRecovery(
  node: AetherNode,
  error: Error,
  inputs: Record<string, any>,
  context: RecoveryContext
): Promise<Record<string, any>> {
  if (!node.recovery) throw error;

  for (const [condition, action] of Object.entries(node.recovery)) {
    if (matchesCondition(error, condition)) {
      const act = action as { action: string; params?: Record<string, unknown> };
      switch (act.action) {
        case "retry":
          return await retryWithBackoff(node, inputs, context, act.params);
        case "fallback":
          return act.params?.value as Record<string, any> ?? generateDefaults(node.out);
        case "escalate":
          if (context.onOversightRequired) {
            return await context.onOversightRequired(
              node.id, 0, { error, message: act.params?.message }
            );
          }
          throw new EscalationError(node.id, act.params?.message as string);
        case "respond":
          return { status: act.params?.status, body: act.params?.body };
        case "report":
          console.error(`[AETHER:${node.id}] ${error.message}`);
          throw error;
        default:
          throw error;
      }
    }
  }
  throw error;
}
