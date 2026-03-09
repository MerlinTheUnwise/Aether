/**
 * Program implementations: rate-limiter
 * Nodes: check_quota, increment_counter, enforce_limit, reset_window
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

export const checkQuotaImpl: NodeImplementation = async (inputs, context) => {
  const client_id = (inputs.client_id ?? "").toString();
  const window_seconds = Number(inputs.window_seconds ?? 60);
  const max_requests = Number(inputs.max_requests ?? 100);

  const db = context.getService!<AetherDatabase>("database");
  const quotas = await db.query("quotas", { field: "client_id", operator: "=", value: client_id });
  const quota = quotas[0] ?? { count: 0 };

  const current_count = Number(quota.count ?? 0);
  const within_limit = current_count < max_requests;
  const remaining = Math.max(0, max_requests - current_count);

  return { current_count, within_limit, remaining };
};

export const incrementCounterImpl: NodeImplementation = async (inputs, context) => {
  const client_id = (inputs.client_id ?? "").toString();
  const within_limit = inputs.within_limit ?? false;

  if (!within_limit) throw new Error("rate_exceeded");

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  const quotas = await db.query("quotas", { field: "client_id", operator: "=", value: client_id });
  const current = quotas[0];

  if (current) {
    const new_count = Number(current.count ?? 0) + 1;
    await db.update("quotas", current.id, { count: new_count });
    return { new_count, success: true };
  } else {
    await db.create("quotas", { client_id, count: 1, id: `q_${client_id}` });
    return { new_count: 1, success: true };
  }
};

export const enforceLimitImpl: NodeImplementation = async (inputs, context) => {
  const within_limit = inputs.within_limit ?? false;
  const remaining = Number(inputs.remaining ?? 0);

  context.reportEffect("database.read");

  if (!within_limit) {
    return { allowed: false, retry_after_seconds: 60 };
  }

  return { allowed: true, retry_after_seconds: 0 };
};

export const resetWindowImpl: NodeImplementation = async (inputs, context) => {
  const client_id = (inputs.client_id ?? "").toString();
  const window_seconds = Number(inputs.window_seconds ?? 60);

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  const quotas = await db.query("quotas", { field: "client_id", operator: "=", value: client_id });
  if (quotas[0]) {
    await db.update("quotas", quotas[0].id, { count: 0 });
  }

  const reset_at = Math.floor(Date.now() / 1000) + window_seconds;

  return { reset_at, cleared: true };
};
