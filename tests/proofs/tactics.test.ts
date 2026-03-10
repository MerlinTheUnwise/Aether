import { describe, it, expect } from "vitest";
import {
  generateTactic,
  generateCompoundTactic,
  buildProofContext,
  getRequiredImports,
  type ProofContext,
} from "../../src/proofs/tactics.js";

function emptyCtx(): ProofContext {
  return {
    variables: new Map(),
    hypotheses: [],
  };
}

function ctxWithHypotheses(hyps: string[]): ProofContext {
  return {
    variables: new Map(),
    hypotheses: hyps,
  };
}

describe("Tactic Generator", () => {
  describe("integer arithmetic → omega", () => {
    it("x > 0 with no hypothesis → omega", () => {
      const result = generateTactic("x > 0", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["omega"]);
      expect(result.confidence).toBe("certain");
    });

    it("x >= 0 → omega", () => {
      const result = generateTactic("x >= 0", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["omega"]);
    });

    it("a + b > 0 → omega", () => {
      const result = generateTactic("a + b > 0", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["omega"]);
    });

    it("x > 0 with matching hypothesis → exact", () => {
      const ctx = ctxWithHypotheses(["x > 0"]);
      const result = generateTactic("x > 0", ctx);
      expect(result.provable).toBe(true);
      expect(result.tactics[0]).toMatch(/exact h_pre_1/);
      expect(result.confidence).toBe("certain");
    });
  });

  describe("boolean logic → tauto/decide", () => {
    it("a ∧ b → tauto", () => {
      const result = generateTactic("a ∧ b", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["tauto"]);
    });

    it("a ∨ b → tauto", () => {
      const result = generateTactic("a ∨ b", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["tauto"]);
    });

    it("x == true → decide", () => {
      const result = generateTactic("x == true", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["decide"]);
    });

    it("x == false → decide", () => {
      const result = generateTactic("x == false", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["decide"]);
    });
  });

  describe("equality from hypothesis → exact", () => {
    it("output == input with hypothesis → exact", () => {
      const ctx = ctxWithHypotheses(["output == input"]);
      const result = generateTactic("output == input", ctx);
      expect(result.provable).toBe(true);
      expect(result.tactics[0]).toMatch(/exact h_pre_1/);
    });

    it("user.email == email with hypothesis → exact", () => {
      const ctx = ctxWithHypotheses(["user.email == email"]);
      const result = generateTactic("user.email == email", ctx);
      expect(result.provable).toBe(true);
      expect(result.tactics[0]).toMatch(/exact/);
    });
  });

  describe("enum membership → decide", () => {
    it("status ∈ values → decide", () => {
      const result = generateTactic('status ∈ ["active", "pending"]', emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["decide"]);
    });
  });

  describe("non-provable → sorry", () => {
    it("complex expression → sorry with explanation", () => {
      const result = generateTactic("unique <=> !exists(users, email)", emptyCtx());
      expect(result.provable).toBe(false);
      expect(result.fallback).toContain("sorry");
      expect(result.confidence).toBe("speculative");
    });

    it("forall expression → sorry", () => {
      const result = generateTactic("forall(p, recommended, p not_in purchases)", emptyCtx());
      expect(result.provable).toBe(false);
    });

    it("set operations → sorry", () => {
      const result = generateTactic("purchases is_subset_of all_products", emptyCtx());
      expect(result.provable).toBe(false);
    });
  });

  describe("field equality → simp", () => {
    it("a.x == b.x without hypothesis → simp", () => {
      const result = generateTactic("validated_amount == amount", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["simp"]);
    });

    it("status == created → simp", () => {
      const result = generateTactic("status == created", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["simp"]);
    });
  });

  describe("length comparisons", () => {
    it("x.length > 0 → omega", () => {
      const result = generateTactic("x.length > 0", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["omega"]);
    });

    it("x.length >= 0 → omega (always true)", () => {
      const result = generateTactic("x.length >= 0", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["omega"]);
    });

    it("x.length > 0 with hypothesis → exact", () => {
      const ctx = ctxWithHypotheses(["x.length > 0"]);
      const result = generateTactic("x.length > 0", ctx);
      expect(result.provable).toBe(true);
      expect(result.tactics[0]).toMatch(/exact/);
    });
  });

  describe("property tests", () => {
    it("normalized.is_lowercase → sorry (domain knowledge)", () => {
      const result = generateTactic("normalized.is_lowercase", emptyCtx());
      expect(result.provable).toBe(false);
    });

    it("normalized.is_lowercase with hypothesis → exact", () => {
      const ctx = ctxWithHypotheses(["normalized.is_lowercase"]);
      const result = generateTactic("normalized.is_lowercase", ctx);
      expect(result.provable).toBe(true);
    });
  });

  describe("!= null → simp", () => {
    it("output.data != null → simp", () => {
      const result = generateTactic("output.data != null", emptyCtx());
      expect(result.provable).toBe(true);
      expect(result.tactics).toEqual(["simp"]);
    });
  });

  describe("compound expressions", () => {
    it("all provable → combined tactic", () => {
      const result = generateCompoundTactic(
        ["x > 0", "y >= 0"],
        emptyCtx(),
      );
      expect(result.combined.provable).toBe(true);
      // Both are omega, so combined should use omega
      expect(result.combined.tactics).toEqual(["omega"]);
    });

    it("mixed provable → not provable", () => {
      const result = generateCompoundTactic(
        ["x > 0", "unique <=> !exists(users, email)"],
        emptyCtx(),
      );
      expect(result.combined.provable).toBe(false);
    });

    it("mixed tactics → constructor approach", () => {
      const result = generateCompoundTactic(
        ["x > 0", "status == created"],
        emptyCtx(),
      );
      expect(result.combined.provable).toBe(true);
      // Different tactics → constructor splitting
      expect(result.combined.tactics.length).toBeGreaterThan(1);
    });
  });

  describe("buildProofContext", () => {
    it("creates context from node info", () => {
      const ctx = buildProofContext(
        { x: { type: "Int" }, y: { type: "String" } },
        { result: { type: "Bool" } },
        ["x > 0", "y.length > 0"],
      );
      expect(ctx.variables.size).toBe(3);
      expect(ctx.hypotheses).toEqual(["x > 0", "y.length > 0"]);
      expect(ctx.variables.get("x")?.type).toBe("Int");
    });

    it("includes state type when provided", () => {
      const ctx = buildProofContext({}, {}, [], "OrderLifecycle");
      expect(ctx.stateType).toBe("OrderLifecycle");
    });
  });

  describe("getRequiredImports", () => {
    it("omega → Mathlib.Tactic.Omega", () => {
      const imports = getRequiredImports(["omega"]);
      expect(imports).toContain("Mathlib.Tactic.Omega");
    });

    it("tauto → Mathlib.Tactic.Tauto", () => {
      const imports = getRequiredImports(["tauto"]);
      expect(imports).toContain("Mathlib.Tactic.Tauto");
    });

    it("decide → no extra imports", () => {
      const imports = getRequiredImports(["decide"]);
      expect(imports).toEqual([]);
    });

    it("deduplicates imports", () => {
      const imports = getRequiredImports(["omega", "omega", "tauto"]);
      expect(imports.filter(i => i === "Mathlib.Tactic.Omega")).toHaveLength(1);
    });
  });
});
