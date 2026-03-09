/**
 * Program implementations: payment-processing
 * Nodes: validate_payment, authorize_card, capture_funds, send_receipt
 * State transitions: created → authorized → captured
 */

import type { NodeImplementation } from "../types.js";

export const validatePaymentImpl: NodeImplementation = async (inputs) => {
  const amount = Number(inputs.amount ?? 0);
  const card_token = (inputs.card_token ?? "").toString();
  const merchant_id = (inputs.merchant_id ?? "merchant_default").toString();

  if (amount <= 0) throw new Error("Amount must be positive");
  if (!card_token) throw new Error("Card token required");

  const payment_id = `pay_${Date.now().toString(36)}`;
  return {
    validated_amount: amount,
    payment_id,
    status: "created",
  };
};

export const authorizeCardImpl: NodeImplementation = async (inputs, context) => {
  const payment_id = (inputs.payment_id ?? "").toString();
  const validated_amount = Number(inputs.validated_amount ?? 0);
  const card_token = (inputs.card_token ?? "").toString();

  context.reportEffect("payment_gateway.write");

  // Configurable confidence: 0.80 base, degraded on edge cases
  let confidence = 0.80;
  if (validated_amount > 10000) confidence = 0.70;
  if (card_token.startsWith("test_")) confidence = 0.75;

  const authorization_code = `auth_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  return {
    authorization_code,
    authorized_amount: validated_amount,
    status: "authorized",
  };
};

export const captureFundsImpl: NodeImplementation = async (inputs, context) => {
  const authorization_code = (inputs.authorization_code ?? "").toString();
  const authorized_amount = Number(inputs.authorized_amount ?? 0);
  const payment_id = (inputs.payment_id ?? "").toString();

  context.reportEffect("payment_gateway.write");
  context.reportEffect("database.write");

  const capture_id = `cap_${Date.now().toString(36)}`;

  return {
    capture_id,
    captured_amount: authorized_amount,
    status: "captured",
  };
};

export const sendReceiptImpl: NodeImplementation = async (inputs, context) => {
  const payment_id = (inputs.payment_id ?? "").toString();
  const captured_amount = Number(inputs.captured_amount ?? 0);

  context.reportEffect("email");

  return { receipt_sent: true };
};
