/**
 * Program implementations: api-orchestration
 * 7 nodes: authenticate_user, check_inventory_api, process_order_payment,
 * create_order_record, create_shipment_api, send_order_confirmation, respond_success
 */

import { randomUUID } from "crypto";
import type { NodeImplementation } from "../types.js";
import type { AetherDatabase } from "../services/database.js";
import type { AetherEmailService } from "../services/email.js";

export const authenticateUserImpl: NodeImplementation = async (inputs, context) => {
  const token = String(inputs.token ?? "");

  context.reportEffect("auth.verify");

  // Simple JWT-like validation: check structure and decode payload
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw Object.assign(new Error("Invalid token format"), { type: "invalid_token" });
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));

    if (!payload.user_id) {
      throw Object.assign(new Error("Missing user_id in token"), { type: "invalid_token" });
    }

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw Object.assign(new Error("Token expired"), { type: "invalid_token" });
    }

    // Verify user exists in database
    const db = context.getService!<AetherDatabase>("database");
    const users = await db.query("users", { field: "id", operator: "=", value: payload.user_id });

    if (users.length === 0) {
      throw Object.assign(new Error("User not found"), { type: "invalid_token" });
    }

    const user = users[0];
    if (user.status !== "active") {
      throw Object.assign(new Error("User account is not active"), { type: "invalid_token" });
    }

    return {
      user_id: payload.user_id,
      role: payload.role ?? user.role ?? "customer",
      authenticated: true,
    };
  } catch (e: any) {
    if (e.type === "invalid_token") throw e;
    throw Object.assign(new Error("Token decode failed"), { type: "invalid_token" });
  }
};

export const checkInventoryApiImpl: NodeImplementation = async (inputs, context) => {
  const productId = String(inputs.product_id ?? "");
  const quantity = Number(inputs.quantity ?? 1);

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.read");

  const products = await db.query("products", { field: "id", operator: "=", value: productId });

  if (products.length === 0) {
    throw Object.assign(new Error(`Product not found: ${productId}`), { type: "out_of_stock" });
  }

  const product = products[0];
  if ((product.inventory ?? 0) < quantity) {
    throw Object.assign(new Error(`Insufficient inventory for ${productId}`), { type: "out_of_stock" });
  }

  // Reserve inventory
  context.reportEffect("database.write");
  await db.update("products", productId, { inventory: product.inventory - quantity });

  const unitPrice = Number(product.price ?? 0);
  const totalPrice = Math.round(unitPrice * quantity * 100) / 100;

  return {
    available: true,
    reserved: true,
    unit_price: unitPrice,
    total_price: totalPrice,
  };
};

export const processOrderPaymentImpl: NodeImplementation = async (inputs, context) => {
  const userId = String(inputs.user_id ?? "");
  const totalPrice = Number(inputs.total_price ?? 0);

  context.reportEffect("payment_gateway.write");

  const db = context.getService!<AetherDatabase>("database");

  // Look up payment method
  const methods = await db.query("payment_methods", { field: "user_id", operator: "=", value: userId });

  if (methods.length === 0) {
    throw Object.assign(new Error("No payment method on file"), { type: "payment_declined" });
  }

  const method = methods[0];
  if (!method.valid) {
    throw Object.assign(new Error("Payment method is invalid"), { type: "payment_declined" });
  }

  const paymentId = `pay_${randomUUID().split("-")[0]}`;

  return {
    payment_id: paymentId,
    charged: true,
    amount: totalPrice,
  };
};

export const createOrderRecordApiImpl: NodeImplementation = async (inputs, context) => {
  const userId = String(inputs.user_id ?? "");
  const productId = String(inputs.product_id ?? "");
  const quantity = Number(inputs.quantity ?? 1);
  const paymentId = String(inputs.payment_id ?? "");
  const totalPrice = Number(inputs.total_price ?? 0);

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("database.write");

  const orderId = `ord_${randomUUID().split("-")[0]}`;

  await db.create("orders", {
    id: orderId,
    user_id: userId,
    product_id: productId,
    quantity,
    payment_id: paymentId,
    total_price: totalPrice,
    status: "confirmed",
    created_at: new Date().toISOString(),
  });

  return {
    order_id: orderId,
    status: "confirmed",
  };
};

export const createShipmentApiImpl: NodeImplementation = async (inputs, context) => {
  const orderId = String(inputs.order_id ?? "");

  const db = context.getService!<AetherDatabase>("database");
  context.reportEffect("shipping.write");
  context.reportEffect("database.write");

  const shipmentId = `ship_${randomUUID().split("-")[0]}`;
  const trackingNumber = `TRK${Date.now().toString(36).toUpperCase()}`;

  // Estimated delivery: 5 business days
  const delivery = new Date();
  delivery.setDate(delivery.getDate() + 7);

  await db.create("shipments", {
    id: shipmentId,
    order_id: orderId,
    tracking_number: trackingNumber,
    status: "processing",
    estimated_delivery: delivery.toISOString().split("T")[0],
  });

  return {
    shipment_id: shipmentId,
    tracking_number: trackingNumber,
    estimated_delivery: delivery.toISOString().split("T")[0],
  };
};

export const sendOrderConfirmationImpl: NodeImplementation = async (inputs, context) => {
  const userId = String(inputs.user_id ?? "");
  const orderId = String(inputs.order_id ?? "");
  const trackingNumber = String(inputs.tracking_number ?? "");
  const totalPrice = Number(inputs.total_price ?? 0);

  const db = context.getService!<AetherDatabase>("database");
  const users = await db.query("users", { field: "id", operator: "=", value: userId });
  const email = users.length > 0 ? users[0].email : "customer@example.com";

  const emailService = context.getService!<AetherEmailService>("email");
  context.reportEffect("email");

  await emailService.send({
    to: [email],
    from: "orders@shop.com",
    subject: `Order Confirmed — ${orderId}`,
    body: `Your order ${orderId} for $${totalPrice.toFixed(2)} has been confirmed.\nTracking: ${trackingNumber}`,
  });

  return { email_sent: true };
};

export const respondSuccessImpl: NodeImplementation = async (inputs) => {
  return {
    status_code: 200,
    response: {
      order_id: inputs.order_id,
      shipment_id: inputs.shipment_id,
      email_sent: inputs.email_sent,
      message: "Order placed successfully",
    },
  };
};
