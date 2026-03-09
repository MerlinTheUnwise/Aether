/**
 * Program implementations: intent-data-pipeline
 * Non-intent nodes: fetch_data, format_report, deliver
 * (IntentNodes resolve to certified algorithms which already have implementations)
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

export const fetchDataImpl: NodeImplementation = async (inputs, context) => {
  const query = (inputs.query ?? "").toString();

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");

  const transactions = await db.query("transactions", { field: "id", operator: "!=", value: "" });

  return { transactions };
};

export const formatReportImpl: NodeImplementation = async (inputs) => {
  const total = Number(inputs.total ?? 0);
  const transactions = inputs.transactions ?? [];

  const lines = [
    `=== Daily Revenue Report ===`,
    `Total Revenue: $${total.toFixed(2)}`,
    `Transactions: ${transactions.length}`,
    `Generated: ${new Date().toISOString()}`,
  ];

  return { report: lines.join("\n") };
};

export const deliverImpl: NodeImplementation = async (inputs, context) => {
  const report = (inputs.report ?? "").toString();
  context.reportEffect("email");
  return { sent: true };
};
