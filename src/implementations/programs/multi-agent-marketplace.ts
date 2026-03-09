/**
 * Program implementations: multi-agent-marketplace
 * 4 scopes: seller, buyer, payment, logistics (12 nodes)
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

// ─── Seller scope ───────────────────────────────────────────────────────────────

export const listProductImpl: NodeImplementation = async (inputs, context) => {
  const seller_id = (inputs.seller_id ?? "").toString();
  const product_data = inputs.product_data ?? {};
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");
  const listing_id = `lst_${Date.now().toString(36)}`;
  const listing_price = Number(product_data.price ?? 49.99);
  await db.create("listings", { id: listing_id, seller_id, ...product_data, price: listing_price });
  return { listing_id, listing_price };
};

export const verifySellerImpl: NodeImplementation = async (inputs, context) => {
  const seller_id = (inputs.seller_id ?? "").toString();
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");
  const sellers = await db.query("sellers", { field: "id", operator: "=", value: seller_id });
  const seller = sellers[0] ?? { rating: 4.5 };
  return { seller_verified: true, seller_rating: Number(seller.rating ?? 4.5) };
};

export const calculateFeesImpl: NodeImplementation = async (inputs) => {
  const listing_price = Number(inputs.listing_price ?? 0);
  const seller_rating = Number(inputs.seller_rating ?? 4.0);
  // Fee decreases with higher rating
  const fee_rate = seller_rating >= 4.5 ? 0.08 : seller_rating >= 4.0 ? 0.10 : 0.12;
  const platform_fee = Math.round(listing_price * fee_rate * 100) / 100;
  const seller_payout = Math.round((listing_price - platform_fee) * 100) / 100;
  return { platform_fee, seller_payout };
};

// ─── Buyer scope ────────────────────────────────────────────────────────────────

export const browseCatalogImpl: NodeImplementation = async (inputs, context) => {
  const search_query = (inputs.search_query ?? "").toString();
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");
  const all = await db.query("listings", { field: "id", operator: "!=", value: "" });
  const search_results = search_query
    ? all.filter((l: any) => JSON.stringify(l).toLowerCase().includes(search_query.toLowerCase()))
    : all;
  return {
    search_results,
    result_count: search_results.length,
    selected_listing: search_results[0]?.id ?? "",
  };
};

export const placeOrderImpl: NodeImplementation = async (inputs, context) => {
  const listing_id = (inputs.listing_id ?? "").toString();
  const buyer_id = (inputs.buyer_id ?? "").toString();
  const listing_price = Number(inputs.listing_price ?? 0);
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");
  const order_id = `mkt_ord_${Date.now().toString(36)}`;
  await db.create("orders", { id: order_id, listing_id, buyer_id, total: listing_price });
  return { order_id, order_total: listing_price };
};

export const buyerReviewImpl: NodeImplementation = async (inputs, context) => {
  const order_id = (inputs.order_id ?? "").toString();
  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");
  await db.create("reviews", { id: `rev_${Date.now().toString(36)}`, order_id, rating: 4.5 });
  return { review_submitted: true, buyer_satisfaction: 4.5 };
};

// ─── Payment scope ──────────────────────────────────────────────────────────────

export const processMarketplacePaymentImpl: NodeImplementation = async (inputs, context) => {
  const order_total = Number(inputs.order_total ?? 0);
  context.reportEffect("payment_gateway.write");
  const transaction_id = `mkt_txn_${Date.now().toString(36)}`;
  return { transaction_id, payment_status: "completed" };
};

export const escrowHoldImpl: NodeImplementation = async (inputs, context) => {
  const transaction_id = (inputs.transaction_id ?? "").toString();
  const seller_payout = Number(inputs.seller_payout ?? 0);
  context.reportEffect("payment_gateway.write");
  context.reportEffect("database.write");
  const escrow_id = `esc_${Date.now().toString(36)}`;
  return { escrow_id, escrow_status: "held" };
};

export const refundCheckImpl: NodeImplementation = async (inputs) => {
  const escrow_id = (inputs.escrow_id ?? "").toString();
  const buyer_satisfaction = Number(inputs.buyer_satisfaction ?? 5);
  const refund_eligible = buyer_satisfaction < 2.0;
  return {
    refund_eligible,
    final_payment_status: refund_eligible ? "refund_pending" : "completed",
  };
};

// ─── Logistics scope ────────────────────────────────────────────────────────────

export const createShipmentMktImpl: NodeImplementation = async (inputs, context) => {
  const order_id = (inputs.order_id ?? "").toString();
  const transaction_id = (inputs.transaction_id ?? "").toString();
  context.reportEffect("shipping.write");
  context.reportEffect("database.write");
  const tracking_number = `mkt_trk_${Date.now().toString(36)}`;
  return {
    tracking_number,
    estimated_delivery: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
  };
};

export const deliveryTrackingImpl: NodeImplementation = async (inputs, context) => {
  const tracking_number = (inputs.tracking_number ?? "").toString();
  context.reportEffect("database.read");
  context.reportEffect("notification");
  return { delivery_status: "in_transit", delivery_confirmed: false };
};

export const notifyPartiesImpl: NodeImplementation = async (inputs, context) => {
  context.reportEffect("email");
  context.reportEffect("notification");
  return { notifications_sent: true };
};
