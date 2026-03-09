import { describe, it, expect } from "vitest";
import { mapTypeToLean, generateSemanticWrapper, generateStateTypeExport } from "../../src/proofs/lean-types.js";
import type { TypeAnnotation, StateType } from "../../src/ir/validator.js";

describe("Lean Type Mapper", () => {
  describe("Base type mappings", () => {
    it("maps String → String", () => {
      const result = mapTypeToLean({ type: "String" });
      expect(result.leanType).toBe("String");
      expect(result.imports).toEqual([]);
    });

    it("maps Int → Int", () => {
      const result = mapTypeToLean({ type: "Int" });
      expect(result.leanType).toBe("Int");
    });

    it("maps Bool → Bool", () => {
      const result = mapTypeToLean({ type: "Bool" });
      expect(result.leanType).toBe("Bool");
    });

    it("maps Float64 → Float", () => {
      const result = mapTypeToLean({ type: "Float64" });
      expect(result.leanType).toBe("Float");
    });

    it("maps Decimal → Float with approximate note", () => {
      const result = mapTypeToLean({ type: "Decimal" });
      expect(result.leanType).toContain("Float");
      expect(result.leanType).toContain("approximate");
    });
  });

  describe("Generic type mappings", () => {
    it("maps List<Product> → List Product", () => {
      const result = mapTypeToLean({ type: "List<Product>" });
      expect(result.leanType).toBe("List Product");
    });

    it("maps List<String> recursively", () => {
      const result = mapTypeToLean({ type: "List<String>" });
      expect(result.leanType).toBe("List String");
    });

    it("maps Map<K,V> → Std.HashMap K V", () => {
      const result = mapTypeToLean({ type: "Map<String, Int>" });
      expect(result.leanType).toBe("Std.HashMap String Int");
      expect(result.imports).toContain("Std.Data.HashMap");
    });
  });

  describe("Semantic type wrappers", () => {
    it("generates newtype wrapper for domain type", () => {
      const wrapper = generateSemanticWrapper("user_id", {
        type: "String",
        domain: "authentication",
        format: "uuid_v4",
      });
      expect(wrapper).not.toBeNull();
      expect(wrapper!.name).toBe("UserId");
      expect(wrapper!.source).toContain("structure UserId where");
      expect(wrapper!.source).toContain("value : String");
      expect(wrapper!.source).toContain("format_valid");
    });

    it("generates constrained wrapper for dimension type", () => {
      const wrapper = generateSemanticWrapper("amount", {
        type: "Float64",
        dimension: "currency",
        unit: "USD",
      });
      expect(wrapper).not.toBeNull();
      expect(wrapper!.source).toContain("structure Amount where");
      expect(wrapper!.source).toContain("value : Float");
      expect(wrapper!.source).toContain("non_negative");
    });

    it("returns null for plain types without domain/dimension/unit", () => {
      const wrapper = generateSemanticWrapper("count", { type: "Int" });
      expect(wrapper).toBeNull();
    });

    it("generates email wrapper with constraints", () => {
      const wrapper = generateSemanticWrapper("email", {
        type: "String",
        domain: "authentication",
        format: "email",
      });
      expect(wrapper).not.toBeNull();
      expect(wrapper!.source).toContain("is_lowercase");
      expect(wrapper!.source).toContain("is_trimmed");
    });
  });

  describe("State type export", () => {
    const orderLifecycle: StateType = {
      id: "OrderLifecycle",
      states: ["created", "paid", "shipped", "delivered", "cancelled", "refunded"],
      transitions: [
        { from: "created", to: "paid", when: "payment_confirmed" },
        { from: "created", to: "cancelled", when: "customer_cancelled" },
        { from: "paid", to: "shipped", when: "shipment_dispatched" },
        { from: "paid", to: "refunded", when: "refund_requested" },
        { from: "shipped", to: "delivered", when: "delivery_confirmed" },
        { from: "delivered", to: "refunded", when: "return_approved" },
      ],
      invariants: {
        never: [
          { from: "cancelled", to: "paid" },
          { from: "delivered", to: "shipped" },
        ],
        terminal: ["cancelled", "refunded"],
        initial: "created",
      },
    };

    it("generates inductive type for states", () => {
      const result = generateStateTypeExport(orderLifecycle);
      expect(result.inductiveType).toContain("inductive OrderLifecycleState where");
      expect(result.inductiveType).toContain("| created");
      expect(result.inductiveType).toContain("| paid");
      expect(result.inductiveType).toContain("| cancelled");
      expect(result.inductiveType).toContain("deriving Repr, BEq");
    });

    it("generates transition relation", () => {
      const result = generateStateTypeExport(orderLifecycle);
      expect(result.transitionRelation).toContain("inductive OrderLifecycleTransition");
      expect(result.transitionRelation).toContain("created_to_paid");
      expect(result.transitionRelation).toContain("paid_to_shipped");
    });

    it("generates never-invariant impossibility theorems", () => {
      const result = generateStateTypeExport(orderLifecycle);
      expect(result.neverTheorems).toHaveLength(2);
      expect(result.neverTheorems[0]).toContain("no_cancelled_to_paid");
      expect(result.neverTheorems[0]).toContain("intro h; cases h");
      expect(result.neverTheorems[1]).toContain("no_delivered_to_shipped");
    });

    it("generates terminal state theorems", () => {
      const result = generateStateTypeExport(orderLifecycle);
      expect(result.terminalTheorems).toHaveLength(2);
      expect(result.terminalTheorems[0]).toContain("cancelled_is_terminal");
      expect(result.terminalTheorems[1]).toContain("refunded_is_terminal");
    });
  });
});
