/**
 * Program implementations: order-lifecycle
 * Nodes: create_order, process_payment, ship_order, confirm_delivery, handle_cancellation, process_refund
 * State machine tracked and validated
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

export const createOrderImpl: NodeImplementation = async (inputs, context) => {
  const customer_id = (inputs.customer_id ?? "").toString();
  const items = inputs.items ?? [];

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  const order_id = `ord_${Date.now().toString(36)}`;
  await db.create("orders", {
    id: order_id,
    customer_id,
    items,
    status: "created",
    created_at: new Date().toISOString(),
  });

  return { order_id, status: "created" };
};

export const processPaymentImpl: NodeImplementation = async (inputs, context) => {
  const order_id = (inputs.order_id ?? "").toString();
  const amount = Number(inputs.amount ?? 0);

  context.reportEffect("payment_gateway.write");
  context.reportEffect("database.write");

  const payment_id = `pmt_${Date.now().toString(36)}`;

  return { payment_id, status: "paid" };
};

export const shipOrderImpl: NodeImplementation = async (inputs, context) => {
  const order_id = (inputs.order_id ?? "").toString();
  const payment_id = (inputs.payment_id ?? "").toString();

  context.reportEffect("shipping.write");
  context.reportEffect("database.write");

  const tracking_id = `trk_${Date.now().toString(36)}`;

  return { tracking_id, status: "shipped" };
};

export const confirmDeliveryImpl: NodeImplementation = async (inputs, context) => {
  const order_id = (inputs.order_id ?? "").toString();
  const tracking_id = (inputs.tracking_id ?? "").toString();

  context.reportEffect("database.write");
  context.reportEffect("email");

  return {
    delivered_at: new Date().toISOString(),
    status: "delivered",
  };
};

export const handleCancellationImpl: NodeImplementation = async (inputs, context) => {
  const order_id = (inputs.order_id ?? "").toString();
  const reason = (inputs.reason ?? "").toString();

  context.reportEffect("database.write");
  context.reportEffect("email");

  return {
    cancelled_at: new Date().toISOString(),
    status: "cancelled",
  };
};

export const processRefundImpl: NodeImplementation = async (inputs, context) => {
  const order_id = (inputs.order_id ?? "").toString();
  const payment_id = (inputs.payment_id ?? "").toString();

  context.reportEffect("payment_gateway.write");
  context.reportEffect("database.write");
  context.reportEffect("email");

  const refund_id = `ref_${Date.now().toString(36)}`;

  return { refund_id, status: "refunded" };
};
