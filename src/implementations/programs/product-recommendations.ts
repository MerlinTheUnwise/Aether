/**
 * Program implementations: product-recommendations
 * Nodes: authenticate, fetch_history, generate_recommendations
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

export const authenticateImpl: NodeImplementation = async (inputs, context) => {
  const token = (inputs.token ?? "").toString();
  if (!token || token.length === 0) throw new Error("invalid_token");
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");
  const users = await db.query("users", { field: "token", operator: "=", value: token });
  if (users.length === 0) throw new Error("invalid_token");
  const user = users[0];
  return { user: { ...user, authenticated: true } };
};

export const fetchHistoryImpl: NodeImplementation = async (inputs, context) => {
  const user = inputs.user ?? {};
  const userId = user.id ?? user.user_id ?? "";
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");
  const purchases = await db.query("purchases", { field: "user_id", operator: "=", value: userId });
  const views = await db.query("views", { field: "user_id", operator: "=", value: userId });
  return {
    purchases: purchases.map((p: any) => p.product ?? p),
    views: views.map((v: any) => v.product ?? v),
  };
};

export const generateRecommendationsImpl: NodeImplementation = async (inputs, context) => {
  const purchases = inputs.purchases ?? [];
  const views = inputs.views ?? [];
  context.reportEffect("ml_model.infer");

  const db = context.getService!<AetherDatabase>("database");
  const allProducts = await db.query("products", { field: "id", operator: "!=", value: "" });

  const purchasedIds = new Set(purchases.map((p: any) => p.id ?? p.product_id));

  // Filter out already purchased, deduplicate, score by views
  const viewCounts = new Map<string, number>();
  for (const v of views) {
    const vid = v.id ?? v.product_id;
    viewCounts.set(vid, (viewCounts.get(vid) ?? 0) + 1);
  }

  const candidates = allProducts
    .filter((p: any) => !purchasedIds.has(p.id))
    .map((p: any) => ({
      ...p,
      score: (viewCounts.get(p.id) ?? 0) + (p.popularity ?? 1),
    }))
    .sort((a: any, b: any) => b.score - a.score);

  // Deduplicate by id
  const seen = new Set<string>();
  const unique = candidates.filter((p: any) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Take 10-20 results
  const recommended = unique.slice(0, Math.max(10, Math.min(20, unique.length)));

  // Pad to 10 if not enough
  while (recommended.length < 10 && allProducts.length >= 10) {
    const fill = allProducts.find((p: any) => !seen.has(p.id));
    if (!fill) break;
    seen.add(fill.id);
    recommended.push({ ...fill, score: 0 });
  }

  return { recommended };
};
