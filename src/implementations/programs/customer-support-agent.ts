/**
 * Program implementations: customer-support-agent
 * Nodes: decide_action, execute_with_guard
 */

import type { NodeImplementation } from "../types.js";

const ACTION_TABLE: Record<string, { action: string; risk_level: number }> = {
  refund_request: { action: "process_refund", risk_level: 2 },
  order_status: { action: "check_order_status", risk_level: 1 },
  product_info: { action: "provide_product_info", risk_level: 1 },
  complaint: { action: "escalate_to_supervisor", risk_level: 3 },
  billing_inquiry: { action: "view_billing_summary", risk_level: 2 },
  account_update: { action: "update_contact_info", risk_level: 2 },
  cancellation: { action: "process_cancellation", risk_level: 3 },
  technical_support: { action: "create_support_ticket", risk_level: 1 },
};

const AGENT_AUTHORITY_LEVEL = 3;

export const decideActionImpl: NodeImplementation = async (inputs, context) => {
  const intent = (inputs.intent ?? "").toString().toLowerCase();
  const urgency = (inputs.urgency ?? "normal").toString();
  context.reportEffect("database");

  const entry = ACTION_TABLE[intent];
  if (!entry) {
    throw new Error("unknown_intent");
  }

  const action = {
    type: entry.action,
    risk_level: entry.risk_level,
    intent,
    urgency,
  };

  // Belt and suspenders: implementation also prevents billing modification
  if (action.type.includes("billing") && action.type.includes("modify")) {
    throw new Error("billing modification not allowed without human approval");
  }

  const confidence_score = urgency === "critical" ? 0.65 : 0.85;

  return {
    action,
    confidence_score,
  };
};

export const executeWithGuardImpl: NodeImplementation = async (inputs, context) => {
  const action = inputs.action ?? {};
  const confidence_score = inputs.confidence_score ?? 0;

  if (confidence_score <= 0.7) {
    throw new Error("low_confidence");
  }

  context.reportEffect("database");
  context.reportEffect("email");

  return {
    result: {
      status: "success",
      action_type: action.type,
      executed_at: new Date().toISOString(),
    },
  };
};
