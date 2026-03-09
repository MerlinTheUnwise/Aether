/**
 * Program implementations: content-moderation-agent
 * Nodes: classify_content, assess_severity, decide_action, execute_moderation, log_decision
 * ML classifier with realistic confidence cascading
 */

import type { NodeImplementation } from "../types.js";
import type { AetherMLService } from "../services/ml.js";
import type { AetherDatabase } from "../services/database.js";

export const classifyContentImpl: NodeImplementation = async (inputs, context) => {
  const content = (inputs.content ?? "").toString();
  const content_type = (inputs.content_type ?? "text").toString();

  const ml = context.getService!<AetherMLService>("ml");
  context.reportEffect("ml_model.infer");

  const result = await ml.classify("moderation", { text: content, type: content_type });
  return {
    category: result.label,
    classification_confidence: result.confidence,
  };
};

export const assessSeverityImpl: NodeImplementation = async (inputs, context) => {
  const category = (inputs.category ?? "safe").toString();
  const classification_confidence = Number(inputs.classification_confidence ?? 0.5);
  const content = (inputs.content ?? "").toString();

  context.reportEffect("ml_model.infer");

  // Severity rules based on category
  const severityMap: Record<string, string> = {
    spam: "low",
    harmful: "high",
    safe: "none",
    offensive: "medium",
    violence: "critical",
  };

  const severity = severityMap[category] ?? "medium";

  // Confidence actually drops through the chain
  const combined_confidence = classification_confidence * 0.90;

  return { severity, combined_confidence };
};

export const decideModerationActionImpl: NodeImplementation = async (inputs, context) => {
  const severity = (inputs.severity ?? "none").toString();
  const combined_confidence = Number(inputs.combined_confidence ?? 0.5);
  const category = (inputs.category ?? "safe").toString();

  context.reportEffect("database.read");

  const actionMap: Record<string, { action: string; requiresHuman: boolean }> = {
    none: { action: "allow", requiresHuman: false },
    low: { action: "flag", requiresHuman: false },
    medium: { action: "review", requiresHuman: true },
    high: { action: "auto_remove", requiresHuman: combined_confidence < 0.9 },
    critical: { action: "ban_user", requiresHuman: true },
  };

  const entry = actionMap[severity] ?? { action: "review", requiresHuman: true };

  // Confidence drops further
  const decision_confidence = combined_confidence * 0.92;

  return {
    moderation_action: entry.action,
    requires_human_review: entry.requiresHuman,
    decision_confidence,
  };
};

export const executeModerationImpl: NodeImplementation = async (inputs, context) => {
  const moderation_action = (inputs.moderation_action ?? "allow").toString();
  const requires_human_review = inputs.requires_human_review ?? false;

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  await db.create("moderation_actions", {
    id: `mod_${Date.now().toString(36)}`,
    action: moderation_action,
    requires_review: requires_human_review,
    executed_at: new Date().toISOString(),
  });

  return {
    action_taken: moderation_action,
    success: true,
  };
};

export const logDecisionImpl: NodeImplementation = async (inputs, context) => {
  const action_taken = (inputs.action_taken ?? "").toString();
  const decision_confidence = Number(inputs.decision_confidence ?? 0);
  const category = (inputs.category ?? "").toString();

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  await db.create("moderation_log", {
    id: `log_${Date.now().toString(36)}`,
    action: action_taken,
    confidence: decision_confidence,
    category,
    timestamp: new Date().toISOString(),
  });

  return { logged: true };
};
