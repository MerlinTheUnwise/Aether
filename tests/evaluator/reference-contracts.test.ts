import { describe, it, expect } from "vitest";
import { checkContract } from "../../src/runtime/evaluator/checker.js";

// Every contract expression from every reference program, evaluated against appropriate test data.
// If any contract can't be evaluated, that's a test failure — not a silent pass.

describe("Reference Program Contracts — Evaluability", () => {
  describe("user-registration", () => {
    it("email.length > 0", () => {
      const r = checkContract("email.length > 0", { email: "test@example.com" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("normalized.is_lowercase ∧ normalized.is_trimmed", () => {
      const r = checkContract("normalized.is_lowercase ∧ normalized.is_trimmed", { normalized: "test@example.com" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("normalized.is_lowercase fails for uppercase", () => {
      const r = checkContract("normalized.is_lowercase ∧ normalized.is_trimmed", { normalized: "Test@Example.com" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(false);
    });

    it("user.email = email (using ==)", () => {
      const r = checkContract("user.email = email", { user: { email: "a@b.com" }, email: "a@b.com" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('user.status = "active" (status check with string equality)', () => {
      const r = checkContract('user.status = "active"', { user: { status: "active" } });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("unique = true", () => {
      const r = checkContract("unique = true", { unique: true });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });
  });

  describe("product-recommendations", () => {
    it("token.length > 0", () => {
      const r = checkContract("token.length > 0", { token: "abc123" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("∀p ∈ recommended: p ∉ purchases (forall + negated membership)", () => {
      const r = checkContract("∀p ∈ recommended: p ∉ purchases", {
        recommended: ["A", "B", "C"],
        purchases: ["D", "E"],
      });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("∀p ∈ recommended: p ∉ purchases fails with overlap", () => {
      const r = checkContract("∀p ∈ recommended: p ∉ purchases", {
        recommended: ["A", "B", "C"],
        purchases: ["B", "E"],
      });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(false);
    });

    it("recommended.distinct (renamed from is_distinct)", () => {
      const r = checkContract("recommended.distinct", { recommended: ["A", "B", "C"] });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("recommended.has_duplicates (adversarial)", () => {
      const r = checkContract("recommended.has_duplicates", { recommended: ["A", "B", "B"] });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true); // has_duplicates = true means adversarial triggered
    });
  });

  describe("customer-support-agent", () => {
    it("action ∈ allowed_actions", () => {
      const r = checkContract("action ∈ allowed_actions", {
        action: "lookup_order",
        allowed_actions: ["lookup_order", "issue_refund", "escalate"],
      });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("confidence_score > 0.7", () => {
      const r = checkContract("confidence_score > 0.7", { confidence_score: 0.85 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });
  });

  describe("payment-processing", () => {
    it("amount > 0", () => {
      const r = checkContract("amount > 0", { amount: 99.99 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("card_token.length > 0", () => {
      const r = checkContract("card_token.length > 0", { card_token: "tok_abc123" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("validated_amount = amount (equality)", () => {
      const r = checkContract("validated_amount = amount", { validated_amount: 99.99, amount: 99.99 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('status = "authorized"', () => {
      const r = checkContract('status = "authorized"', { status: "authorized" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("authorization_code.length > 0", () => {
      const r = checkContract("authorization_code.length > 0", { authorization_code: "AUTH_123" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("captured_amount = authorized_amount", () => {
      const r = checkContract("captured_amount = authorized_amount", { captured_amount: 100, authorized_amount: 100 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("captured_amount ≤ authorized_amount (invariant)", () => {
      const r = checkContract("captured_amount ≤ authorized_amount", { captured_amount: 100, authorized_amount: 100 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("adversarial: authorized_amount ≠ validated_amount", () => {
      // Should be false (not triggered) when amounts match
      const r = checkContract("authorized_amount ≠ validated_amount", { authorized_amount: 100, validated_amount: 100 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(false); // ≠ is false when they're equal = adversarial NOT triggered
    });

    it("receipt.amount = payment.amount", () => {
      const r = checkContract("receipt.amount = payment.amount", {
        receipt: { amount: 100 },
        payment: { amount: 100 },
      });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("receipt_sent = true", () => {
      const r = checkContract("receipt_sent = true", { receipt_sent: true });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });
  });

  describe("data-pipeline-etl", () => {
    it("record_count ≥ 0", () => {
      const r = checkContract("record_count ≥ 0", { record_count: 100 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("cleaned.length ≤ data.length", () => {
      const r = checkContract("cleaned.length ≤ data.length", { cleaned: [1, 2], data: [1, 2, 3, 4] });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("invalid_count ≥ 0", () => {
      const r = checkContract("invalid_count ≥ 0", { invalid_count: 3 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("duplicates_removed ≥ 0", () => {
      const r = checkContract("duplicates_removed ≥ 0", { duplicates_removed: 5 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("checksum.length > 0", () => {
      const r = checkContract("checksum.length > 0", { checksum: "abc123hash" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("rows_written ≥ 0", () => {
      const r = checkContract("rows_written ≥ 0", { rows_written: 50 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("success = true", () => {
      const r = checkContract("success = true", { success: true });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });
  });

  describe("rate-limiter", () => {
    it("current_count ≥ 0", () => {
      const r = checkContract("current_count ≥ 0", { current_count: 5 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("remaining ≥ 0", () => {
      const r = checkContract("remaining ≥ 0", { remaining: 95 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("count ≤ max_requests", () => {
      const r = checkContract("count ≤ max_requests", { count: 5, max_requests: 100 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("within_limit = true", () => {
      const r = checkContract("within_limit = true", { within_limit: true });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("new_count > 0", () => {
      const r = checkContract("new_count > 0", { new_count: 6 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("retry_after_seconds ≥ 0", () => {
      const r = checkContract("retry_after_seconds ≥ 0", { retry_after_seconds: 30 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("reset_at > 0", () => {
      const r = checkContract("reset_at > 0", { reset_at: 1700000000 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("cleared = true", () => {
      const r = checkContract("cleared = true", { cleared: true });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });
  });

  describe("content-moderation-agent", () => {
    it("classification_confidence ≥ 0", () => {
      const r = checkContract("classification_confidence ≥ 0", { classification_confidence: 0.85 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("classification_confidence ≤ 1", () => {
      const r = checkContract("classification_confidence ≤ 1", { classification_confidence: 0.85 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("combined_confidence ≥ 0", () => {
      const r = checkContract("combined_confidence ≥ 0", { combined_confidence: 0.7 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("decision_confidence ≥ 0", () => {
      const r = checkContract("decision_confidence ≥ 0", { decision_confidence: 0.9 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("decision_confidence > 0", () => {
      const r = checkContract("decision_confidence > 0", { decision_confidence: 0.9 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("success = true", () => {
      const r = checkContract("success = true", { success: true });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("logged = true", () => {
      const r = checkContract("logged = true", { logged: true });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("adversarial: classification_confidence < 0", () => {
      // Not triggered when confidence is valid
      const r = checkContract("classification_confidence < 0", { classification_confidence: 0.85 });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(false);
    });

    it("adversarial: decision_confidence > combined_confidence", () => {
      // Triggered when decision > combined (bad)
      const r = checkContract("decision_confidence > combined_confidence", {
        decision_confidence: 0.95,
        combined_confidence: 0.7,
      });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true); // true = triggered = BAD
    });
  });

  describe("order-lifecycle", () => {
    it("customer_id.length > 0", () => {
      const r = checkContract("customer_id.length > 0", { customer_id: "cust_123" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('status = "created"', () => {
      const r = checkContract('status = "created"', { status: "created" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('status = "paid"', () => {
      const r = checkContract('status = "paid"', { status: "paid" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('status = "shipped"', () => {
      const r = checkContract('status = "shipped"', { status: "shipped" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('status = "delivered"', () => {
      const r = checkContract('status = "delivered"', { status: "delivered" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('status = "cancelled"', () => {
      const r = checkContract('status = "cancelled"', { status: "cancelled" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it('status = "refunded"', () => {
      const r = checkContract('status = "refunded"', { status: "refunded" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("order_id.length > 0", () => {
      const r = checkContract("order_id.length > 0", { order_id: "ord_456" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("tracking_id.length > 0", () => {
      const r = checkContract("tracking_id.length > 0", { tracking_id: "TRK_789" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });

    it("payment_id.length > 0", () => {
      const r = checkContract("payment_id.length > 0", { payment_id: "pay_101" });
      expect(r.unevaluable).toBe(false);
      expect(r.passed).toBe(true);
    });
  });
});
