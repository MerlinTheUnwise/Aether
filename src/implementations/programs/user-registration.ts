/**
 * Program implementations: user-registration
 * Nodes: validate_email, check_uniqueness, create_user
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

export const validateEmailImpl: NodeImplementation = async (inputs, context) => {
  const email = (inputs.email ?? "").toString();
  const normalized = email.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
  return { valid, normalized };
};

export const checkUniquenessImpl: NodeImplementation = async (inputs, context) => {
  const email = (inputs.email ?? "").toString();
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");
  const existing = await db.query("users", { field: "email", operator: "=", value: email });
  const unique = existing.length === 0;
  return { unique };
};

export const createUserImpl: NodeImplementation = async (inputs, context) => {
  const email = (inputs.email ?? "").toString();
  const unique = inputs.unique ?? false;
  if (!unique) throw new Error("Cannot create user: email not unique");
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");
  const id = `usr_${Date.now().toString(36)}`;
  const user = { id, email, status: "active", created_at: new Date().toISOString() };
  await db.create("users", user);
  return { user };
};
