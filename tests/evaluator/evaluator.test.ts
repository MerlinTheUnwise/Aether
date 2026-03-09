import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/runtime/evaluator/lexer.js";
import { parse } from "../../src/runtime/evaluator/parser.js";
import { evaluate, builtinFunctions, EvalContext } from "../../src/runtime/evaluator/evaluator.js";

function eval_(expr: string, vars: Record<string, any> = {}) {
  const tokens = tokenize(expr);
  const { ast } = parse(tokens);
  return evaluate(ast, { variables: vars, functions: { ...builtinFunctions } });
}

describe("Expression Evaluator", () => {
  describe("Literals", () => {
    it("evaluates number: 42 → 42", () => {
      expect(eval_("42").value).toBe(42);
    });
    it("evaluates string: \"hello\" → \"hello\"", () => {
      expect(eval_('"hello"').value).toBe("hello");
    });
    it("evaluates boolean: true → true", () => {
      expect(eval_("true").value).toBe(true);
    });
  });

  describe("Comparison", () => {
    it("5 > 3 → true", () => {
      expect(eval_("5 > 3").value).toBe(true);
    });
    it("5 < 3 → false", () => {
      expect(eval_("5 < 3").value).toBe(false);
    });
    it("5 = 5 → true", () => {
      expect(eval_("5 = 5").value).toBe(true);
    });
    it("5 ≠ 3 → true", () => {
      expect(eval_("5 ≠ 3").value).toBe(true);
    });
    it("variable comparison: x > 0", () => {
      expect(eval_("x > 0", { x: 5 }).value).toBe(true);
      expect(eval_("x > 0", { x: -1 }).value).toBe(false);
    });
  });

  describe("Chained comparisons", () => {
    it("0 ≤ 5 ≤ 10 → true", () => {
      expect(eval_("0 ≤ 5 ≤ 10").value).toBe(true);
    });
    it("0 ≤ 15 ≤ 10 → false", () => {
      expect(eval_("0 ≤ 15 ≤ 10").value).toBe(false);
    });
    it("0 ≤ x ≤ 100 with variable", () => {
      expect(eval_("0 ≤ x ≤ 100", { x: 50 }).value).toBe(true);
      expect(eval_("0 ≤ x ≤ 100", { x: 150 }).value).toBe(false);
    });
  });

  describe("Boolean logic", () => {
    it("true ∧ false → false", () => {
      expect(eval_("true ∧ false").value).toBe(false);
    });
    it("true ∨ false → true", () => {
      expect(eval_("true ∨ false").value).toBe(true);
    });
    it("¬true → false", () => {
      expect(eval_("¬true").value).toBe(false);
    });
    it("short-circuit AND", () => {
      // false ∧ anything should short-circuit
      expect(eval_("false ∧ true").value).toBe(false);
    });
    it("short-circuit OR", () => {
      // true ∨ anything should short-circuit
      expect(eval_("true ∨ false").value).toBe(true);
    });
  });

  describe("Implication", () => {
    it("true → false → false", () => {
      expect(eval_("true → false").value).toBe(false);
    });
    it("false → false → true", () => {
      expect(eval_("false → false").value).toBe(true);
    });
    it("true → true → true", () => {
      expect(eval_("true → true").value).toBe(true);
    });
    it("false → true → true", () => {
      expect(eval_("false → true").value).toBe(true);
    });
  });

  describe("Membership", () => {
    it("3 ∈ [1, 2, 3] → true", () => {
      expect(eval_("3 ∈ [1, 2, 3]").value).toBe(true);
    });
    it("4 ∈ [1, 2, 3] → false", () => {
      expect(eval_("4 ∈ [1, 2, 3]").value).toBe(false);
    });
    it("4 ∉ [1, 2, 3] → true", () => {
      expect(eval_("4 ∉ [1, 2, 3]").value).toBe(true);
    });
    it("variable membership: x ∈ list", () => {
      expect(eval_("x ∈ list", { x: 2, list: [1, 2, 3] }).value).toBe(true);
      expect(eval_("x ∈ list", { x: 5, list: [1, 2, 3] }).value).toBe(false);
    });
    it("string membership: action ∈ allowed_actions", () => {
      expect(eval_('action ∈ allowed_actions', { action: "read", allowed_actions: ["read", "write"] }).value).toBe(true);
    });
  });

  describe("Set intersection", () => {
    it("a ∩ b = ∅ → true when disjoint", () => {
      expect(eval_("a ∩ b = ∅", { a: [1, 2], b: [3, 4] }).value).toBe(true);
    });
    it("a ∩ b = ∅ → false when overlapping", () => {
      expect(eval_("a ∩ b = ∅", { a: [1, 2], b: [2, 3] }).value).toBe(false);
    });
    it("a ∩ b ≠ ∅ when overlapping", () => {
      expect(eval_("a ∩ b ≠ ∅", { a: [1, 2], b: [2, 3] }).value).toBe(true);
    });
  });

  describe("Subset", () => {
    it("a ⊆ b → true when subset", () => {
      expect(eval_("a ⊆ b", { a: [1, 2], b: [1, 2, 3] }).value).toBe(true);
    });
    it("a ⊆ b → false when not subset", () => {
      expect(eval_("a ⊆ b", { a: [1, 4], b: [1, 2, 3] }).value).toBe(false);
    });
  });

  describe("Quantifiers", () => {
    it("∀x ∈ list: x > 0 with all positive → true", () => {
      expect(eval_("∀x ∈ list: x > 0", { list: [2, 4, 6] }).value).toBe(true);
    });
    it("∀x ∈ list: x > 0 with negative → false", () => {
      expect(eval_("∀x ∈ list: x > 0", { list: [2, -1, 6] }).value).toBe(false);
    });
    it("∃x ∈ list: x < 0 → true when one negative", () => {
      expect(eval_("∃x ∈ list: x < 0", { list: [1, -2, 3] }).value).toBe(true);
    });
    it("∃x ∈ list: x < 0 → false when all positive", () => {
      expect(eval_("∃x ∈ list: x < 0", { list: [1, 2, 3] }).value).toBe(false);
    });
    it("∀ with empty list → true (vacuously)", () => {
      expect(eval_("∀x ∈ list: x > 0", { list: [] }).value).toBe(true);
    });
    it("∃ with empty list → false", () => {
      expect(eval_("∃x ∈ list: x < 0", { list: [] }).value).toBe(false);
    });
  });

  describe("Property access", () => {
    it("user.email.is_lowercase → false for mixed case", () => {
      expect(eval_("user.email.is_lowercase", { user: { email: "Test@X.com" } }).value).toBe(false);
    });
    it("user.email.is_lowercase → true for lowercase", () => {
      expect(eval_("user.email.is_lowercase", { user: { email: "test@x.com" } }).value).toBe(true);
    });
    it("list.length > 0 → true for non-empty", () => {
      expect(eval_("list.length > 0", { list: [1, 2, 3] }).value).toBe(true);
    });
    it("list.length > 0 → false for empty", () => {
      expect(eval_("list.length > 0", { list: [] }).value).toBe(false);
    });
    it("list.distinct → true when no dupes", () => {
      expect(eval_("list.distinct", { list: [1, 2, 3] }).value).toBe(true);
    });
    it("list.distinct → false when dupes", () => {
      expect(eval_("list.distinct", { list: [1, 2, 2] }).value).toBe(false);
    });
    it("list.is_sorted → true when sorted", () => {
      expect(eval_("list.is_sorted", { list: [1, 2, 3] }).value).toBe(true);
    });
    it("list.is_sorted → false when unsorted", () => {
      expect(eval_("list.is_sorted", { list: [3, 1, 2] }).value).toBe(false);
    });
    it("list.has_duplicates", () => {
      expect(eval_("list.has_duplicates", { list: [1, 2, 2] }).value).toBe(true);
      expect(eval_("list.has_duplicates", { list: [1, 2, 3] }).value).toBe(false);
    });
    it("str.is_trimmed", () => {
      expect(eval_("s.is_trimmed", { s: "hello" }).value).toBe(true);
      expect(eval_("s.is_trimmed", { s: " hello " }).value).toBe(false);
    });
  });

  describe("String equality", () => {
    it('status = "active" → true when matching', () => {
      expect(eval_('status = "active"', { status: "active" }).value).toBe(true);
    });
    it('status = "active" → false when not matching', () => {
      expect(eval_('status = "active"', { status: "inactive" }).value).toBe(false);
    });
  });

  describe("Arithmetic", () => {
    it("2 + 3 → 5", () => {
      expect(eval_("2 + 3").value).toBe(5);
    });
    it("10 * 0.5 → 5", () => {
      expect(eval_("10 * 0.5").value).toBe(5);
    });
    it("10 / 2 → 5", () => {
      expect(eval_("10 / 2").value).toBe(5);
    });
    it("10 - 3 → 7", () => {
      expect(eval_("10 - 3").value).toBe(7);
    });
    it("type error on non-number arithmetic", () => {
      const result = eval_('"a" - 1');
      expect(result.success).toBe(false);
    });
  });

  describe("Error handling", () => {
    it("undefined variable produces error, not silent pass", () => {
      const result = eval_("nonexistent > 0");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Undefined variable");
    });
    it("unknown function produces warning and error", () => {
      const result = eval_("unknown_fn(x)", { x: 1 });
      expect(result.success).toBe(false);
      expect(result.warnings).toContain("Unknown function: unknown_fn");
    });
  });

  describe("Complex real contracts", () => {
    it("∀p ∈ recommended: p ∉ purchases", () => {
      const result = eval_("∀p ∈ recommended: p ∉ purchases", {
        recommended: ["A", "B", "C"],
        purchases: ["D", "E"],
      });
      expect(result.value).toBe(true);
      expect(result.success).toBe(true);
    });

    it("∀p ∈ recommended: p ∉ purchases — fails when overlap", () => {
      const result = eval_("∀p ∈ recommended: p ∉ purchases", {
        recommended: ["A", "B", "C"],
        purchases: ["B", "E"],
      });
      expect(result.value).toBe(false);
    });

    it("normalized.is_lowercase ∧ normalized.is_trimmed", () => {
      const result = eval_("normalized.is_lowercase ∧ normalized.is_trimmed", {
        normalized: "hello world",
      });
      expect(result.value).toBe(true);
    });

    it("email.length > 0", () => {
      expect(eval_("email.length > 0", { email: "test@example.com" }).value).toBe(true);
      expect(eval_("email.length > 0", { email: "" }).value).toBe(false);
    });

    it("count ≤ max_requests", () => {
      expect(eval_("count ≤ max_requests", { count: 5, max_requests: 10 }).value).toBe(true);
      expect(eval_("count ≤ max_requests", { count: 15, max_requests: 10 }).value).toBe(false);
    });

    it("cleaned.length ≤ data.length", () => {
      expect(eval_("cleaned.length ≤ data.length", {
        cleaned: [1, 2],
        data: [1, 2, 3, 4],
      }).value).toBe(true);
    });

    it("receipt.amount = payment.amount", () => {
      expect(eval_("receipt.amount = payment.amount", {
        receipt: { amount: 100 },
        payment: { amount: 100 },
      }).value).toBe(true);
    });
  });

  describe("Built-in functions", () => {
    it("length(x)", () => {
      expect(eval_("length(x)", { x: [1, 2, 3] }).value).toBe(3);
    });
    it("is_sorted(x)", () => {
      expect(eval_("is_sorted(x)", { x: [1, 2, 3] }).value).toBe(true);
    });
    it("has_duplicates(x)", () => {
      expect(eval_("has_duplicates(x)", { x: [1, 2, 2] }).value).toBe(true);
    });
    it("includes(list, elem)", () => {
      expect(eval_("includes(list, x)", { list: [1, 2, 3], x: 2 }).value).toBe(true);
    });
  });
});
