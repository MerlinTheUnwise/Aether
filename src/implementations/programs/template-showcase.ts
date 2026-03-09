/**
 * Program implementations: template-showcase
 * Template-instantiated nodes + concrete nodes (api_router, response_builder)
 * Instances: user_crud, product_crud, main_auth
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

// ─── api_router ─────────────────────────────────────────────────────────────────

export const apiRouterImpl: NodeImplementation = async (inputs) => {
  const request = inputs.request ?? {};
  const token = request.headers?.authorization ?? request.token ?? "default_token";
  const entity_data = request.body ?? "{}";
  const route = request.path ?? request.route ?? "/users";
  return { token, entity_data: typeof entity_data === "string" ? entity_data : JSON.stringify(entity_data), route };
};

// ─── response_builder ───────────────────────────────────────────────────────────

export const responseBuilderImpl: NodeImplementation = async (inputs) => {
  const data = inputs.data ?? "";
  const status = Number(inputs.status ?? 200);
  return { response: { status, body: data } };
};

// ─── crud-entity: validate_input ────────────────────────────────────────────────

export const validateInputImpl: NodeImplementation = async (inputs) => {
  const data = inputs.data;
  if (data === null || data === undefined) throw new Error("Input data is null");
  return { validated: data };
};

// ─── crud-entity: create_entity ─────────────────────────────────────────────────

export const createEntityImpl: NodeImplementation = async (inputs, context) => {
  const data = inputs.data ?? {};
  context.reportEffect("database.write");
  const entity = { ...data, id: data.id ?? `ent_${Date.now().toString(36)}` };
  return { entity, success: true };
};

// ─── crud-entity: read_entity ───────────────────────────────────────────────────

export const readEntityImpl: NodeImplementation = async (inputs, context) => {
  const entity_id = inputs.entity_id ?? "";
  context.reportEffect("database.read");
  // Return a synthetic entity
  return { entity: { id: entity_id, name: `Entity ${entity_id}` } };
};

// ─── auth-gate: validate_token ──────────────────────────────────────────────────

export const validateTokenImpl: NodeImplementation = async (inputs, context) => {
  const token = (inputs.token ?? "").toString();
  if (!token || token.length === 0) throw new Error("invalid_token");
  context.reportEffect("auth.verify");
  return { claims: { sub: "user_1", iat: Date.now() }, valid: true };
};

// ─── auth-gate: load_user ───────────────────────────────────────────────────────

export const loadUserImpl: NodeImplementation = async (inputs, context) => {
  const claims = inputs.claims ?? {};
  context.reportEffect("auth.verify");
  return { user: { id: claims.sub ?? "user_1", name: "Test User", role: "admin" } };
};

// ─── auth-gate: check_permissions ───────────────────────────────────────────────

export const checkPermissionsImpl: NodeImplementation = async (inputs, context) => {
  const user = inputs.user ?? {};
  context.reportEffect("auth.verify");
  return { authorized_user: user };
};
