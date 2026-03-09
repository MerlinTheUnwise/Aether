/**
 * Program implementations: scoped-ecommerce
 * Scopes: catalog, checkout, post_purchase
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

export const loadCartImpl: NodeImplementation = async (inputs, context) => {
  const session_id = (inputs.session_id ?? "").toString();

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");

  const cart_items = await db.query("carts", { field: "session_id", operator: "=", value: session_id });
  const items = cart_items.length > 0 ? cart_items : [{ id: "item_1", name: "Widget", price: 29.99, quantity: 1 }];
  const cart_total = items.reduce((s: number, i: any) => s + Number(i.price ?? 0) * Number(i.quantity ?? 1), 0);

  return { cart_items: items, cart_total: Math.round(cart_total * 100) / 100 };
};

export const validateStockImpl: NodeImplementation = async (inputs, context) => {
  const cart_items = inputs.cart_items ?? [];
  context.reportEffect("database.read");
  return { in_stock_items: cart_items, all_available: true };
};

export const applyDiscountsImpl: NodeImplementation = async (inputs) => {
  const in_stock_items = inputs.in_stock_items ?? [];
  const cart_total = Number(inputs.cart_total ?? 0);

  let discount = 0;
  let discount_applied = "none";
  if (cart_total > 100) {
    discount = cart_total * 0.10;
    discount_applied = "10% off orders over $100";
  } else if (cart_total > 50) {
    discount = cart_total * 0.05;
    discount_applied = "5% off orders over $50";
  }

  const final_total = Math.round((cart_total - discount) * 100) / 100;
  return { final_total, discount_applied };
};

export const reserveInventoryImpl: NodeImplementation = async (inputs, context) => {
  const in_stock_items = inputs.in_stock_items ?? [];
  context.reportEffect("database.write");
  const reservation_id = `res_${Date.now().toString(36)}`;
  return { reservation_id, reserved_items: in_stock_items };
};

export const chargePaymentImpl: NodeImplementation = async (inputs, context) => {
  const final_total = Number(inputs.final_total ?? 0);
  const reservation_id = (inputs.reservation_id ?? "").toString();
  context.reportEffect("payment_gateway.write");
  const transaction_id = `txn_${Date.now().toString(36)}`;
  return { transaction_id, charge_status: "success" };
};

export const createOrderRecordImpl: NodeImplementation = async (inputs, context) => {
  const transaction_id = (inputs.transaction_id ?? "").toString();
  const reserved_items = inputs.reserved_items ?? [];
  const final_total = Number(inputs.final_total ?? 0);

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  const order_id = `ord_${Date.now().toString(36)}`;
  await db.create("orders", {
    id: order_id,
    transaction_id,
    items: reserved_items,
    total: final_total,
    status: "confirmed",
  });

  return { order_id, order_status: "confirmed" };
};

export const sendReceiptEcomImpl: NodeImplementation = async (inputs, context) => {
  context.reportEffect("email");
  return { receipt_sent: true };
};

export const trackAnalyticsImpl: NodeImplementation = async (inputs, context) => {
  context.reportEffect("analytics.write");
  return { event_logged: true };
};
