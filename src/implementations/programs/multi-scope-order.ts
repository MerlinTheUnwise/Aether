/**
 * Program implementations: multi-scope-order
 * Scopes: order, payment, fulfillment, notification
 */

import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";

export const validateOrderImpl: NodeImplementation = async (inputs) => {
  const order_items = inputs.order_items ?? [];
  const customer_id = (inputs.customer_id ?? "").toString();

  const total_amount = order_items.reduce(
    (sum: number, item: any) => sum + (Number(item.price ?? 0) * Number(item.quantity ?? 1)),
    0,
  );

  return {
    validated_order: { customer_id, items: order_items, total: total_amount },
    total_amount: Math.round(total_amount * 100) / 100,
  };
};

export const checkInventoryImpl: NodeImplementation = async (inputs, context) => {
  const validated_order = inputs.validated_order ?? {};
  const items = validated_order.items ?? [];

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");
  context.reportEffect("database.write");

  return {
    available: true,
    reserved_items: items,
  };
};

export const processPaymentMSOImpl: NodeImplementation = async (inputs, context) => {
  const total_amount = Number(inputs.total_amount ?? 0);
  const available = inputs.available ?? false;

  context.reportEffect("payment_gateway.write");

  const transaction_id = `txn_${Date.now().toString(36)}`;

  return {
    transaction_id,
    payment_status: "completed",
  };
};

export const createShipmentImpl: NodeImplementation = async (inputs, context) => {
  const reserved_items = inputs.reserved_items ?? [];
  const transaction_id = (inputs.transaction_id ?? "").toString();

  context.reportEffect("shipping.write");
  context.reportEffect("database.write");

  const tracking_number = `ship_${Date.now().toString(36)}`;

  return {
    tracking_number,
    estimated_delivery: new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0],
  };
};

export const sendConfirmationImpl: NodeImplementation = async (inputs, context) => {
  const customer_id = (inputs.customer_id ?? "").toString();
  const transaction_id = (inputs.transaction_id ?? "").toString();
  const tracking_number = (inputs.tracking_number ?? "").toString();

  context.reportEffect("email");

  return { notification_sent: true };
};
