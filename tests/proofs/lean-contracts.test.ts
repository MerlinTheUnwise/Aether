import { describe, it, expect } from "vitest";
import { contractToLean, translateContractSection } from "../../src/proofs/lean-contracts.js";
import type { ContractContext } from "../../src/proofs/lean-contracts.js";

const defaultContext: ContractContext = {
  nodeId: "test_node",
  inputTypes: { x: { type: "Int" }, list: { type: "List<Int>" } },
  outputTypes: { result: { type: "Int" } },
  variables: ["x", "list", "result"],
};

describe("Lean Contract Translator", () => {
  describe("Operator mappings", () => {
    it("translates simple comparison: x > 0", () => {
      const result = contractToLean("x > 0", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x > 0");
    });

    it("translates equality: a == b → a = b", () => {
      const result = contractToLean("x == 0", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x = 0");
    });

    it("translates less than or equal: x ≤ 10", () => {
      const result = contractToLean("x ≤ 10", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x ≤ 10");
    });

    it("translates not equal: x ≠ 0", () => {
      const result = contractToLean("x ≠ 0", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x ≠ 0");
    });
  });

  describe("Boolean logic", () => {
    it("translates conjunction: a ∧ b", () => {
      const result = contractToLean("x > 0 ∧ x < 100", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x > 0 ∧ x < 100");
    });

    it("translates disjunction: a ∨ b", () => {
      const result = contractToLean("x > 0 ∨ x < -10", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toContain("∨");
    });

    it("translates negation: ¬a", () => {
      const result = contractToLean("¬valid", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("¬valid");
    });
  });

  describe("Set operations", () => {
    it("translates membership: x ∈ list", () => {
      const result = contractToLean("x ∈ list", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x ∈ list");
    });

    it("translates non-membership: x ∉ list", () => {
      const result = contractToLean("x ∉ list", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x ∉ list");
    });

    it("translates subset: a ⊆ b", () => {
      const result = contractToLean("a ⊆ b", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("a ⊆ b");
    });
  });

  describe("Quantifiers", () => {
    it("translates universal: ∀x ∈ list: P(x) → ∀ x ∈ list, P x", () => {
      const result = contractToLean("∀x ∈ list: x > 0", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("∀ x ∈ list, x > 0");
    });
  });

  describe("Implication", () => {
    it("translates implication: a → b", () => {
      const result = contractToLean("x > 0 → result > 0", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("x > 0 → result > 0");
    });
  });

  describe("Field access", () => {
    it("translates field access: x.y", () => {
      const result = contractToLean("user.email == email", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toContain("user.email");
    });

    it("translates property: normalized.is_lowercase", () => {
      const result = contractToLean("normalized.is_lowercase", defaultContext);
      expect(result.supported).toBe(true);
      expect(result.lean).toBe("normalized.is_lowercase");
    });
  });

  describe("Unsupported expressions", () => {
    it("produces sorry for complex unsupported expressions", () => {
      const result = contractToLean("complex_ml_expression(input, model.predict(x))", defaultContext);
      expect(result.supported).toBe(false);
      expect(result.lean).toContain("sorry");
      expect(result.lean).toContain("complex_ml_expression");
    });
  });

  describe("Contract section translation", () => {
    it("translates a full contract section", () => {
      const section = translateContractSection(
        {
          pre: ["x > 0"],
          post: ["result > 0", "result ≤ x"],
          invariants: ["x ≥ 0"],
        },
        defaultContext,
      );
      expect(section.preconditions).toHaveLength(1);
      expect(section.postconditions).toHaveLength(2);
      expect(section.invariants).toHaveLength(1);
      expect(section.preconditions[0].supported).toBe(true);
    });
  });
});
