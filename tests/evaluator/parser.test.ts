import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/runtime/evaluator/lexer.js";
import { parse, ASTNode } from "../../src/runtime/evaluator/parser.js";

function p(expr: string) {
  return parse(tokenize(expr));
}

describe("Expression Parser", () => {
  it("parses simple comparison: x > 0", () => {
    const { ast, errors } = p("x > 0");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.op).toBe(">");
      expect(ast.left).toEqual({ type: "identifier", name: "x" });
      expect(ast.right).toEqual({ type: "literal", value: 0 });
    }
  });

  it("parses boolean AND: a ∧ b", () => {
    const { ast, errors } = p("a ∧ b");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.op).toBe("and");
    }
  });

  it("parses chained comparison: 0 ≤ x ≤ 100", () => {
    const { ast, errors } = p("0 ≤ x ≤ 100");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("chained_comparison");
    if (ast.type === "chained_comparison") {
      expect(ast.comparisons).toHaveLength(2);
      expect(ast.comparisons[0].op).toBe("≤");
      expect(ast.comparisons[1].op).toBe("≤");
    }
  });

  it("parses membership: x ∈ list", () => {
    const { ast, errors } = p("x ∈ list");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("membership");
    if (ast.type === "membership") {
      expect(ast.negated).toBe(false);
      expect(ast.element).toEqual({ type: "identifier", name: "x" });
      expect(ast.collection).toEqual({ type: "identifier", name: "list" });
    }
  });

  it("parses negated membership: x ∉ list", () => {
    const { ast, errors } = p("x ∉ list");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("membership");
    if (ast.type === "membership") {
      expect(ast.negated).toBe(true);
    }
  });

  it("parses intersection: a ∩ b = ∅", () => {
    const { ast, errors } = p("a ∩ b = ∅");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.op).toBe("=");
      expect(ast.left).toEqual({
        type: "intersection",
        left: { type: "identifier", name: "a" },
        right: { type: "identifier", name: "b" },
      });
      expect(ast.right).toEqual({ type: "empty_set" });
    }
  });

  it("parses subset: a ⊆ b", () => {
    const { ast, errors } = p("a ⊆ b");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("subset");
    if (ast.type === "subset") {
      expect(ast.left).toEqual({ type: "identifier", name: "a" });
      expect(ast.right).toEqual({ type: "identifier", name: "b" });
    }
  });

  it("parses quantifier: ∀x ∈ list: x > 0", () => {
    const { ast, errors } = p("∀x ∈ list: x > 0");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("forall");
    if (ast.type === "forall") {
      expect(ast.variable).toBe("x");
      expect(ast.collection).toEqual({ type: "identifier", name: "list" });
      expect(ast.predicate.type).toBe("comparison");
    }
  });

  it("parses exists quantifier: ∃x ∈ list: x < 0", () => {
    const { ast, errors } = p("∃x ∈ list: x < 0");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("exists");
    if (ast.type === "exists") {
      expect(ast.variable).toBe("x");
    }
  });

  it("parses implication: a → b", () => {
    const { ast, errors } = p("a → b");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.op).toBe("implies");
    }
  });

  it("parses property access: user.email.is_lowercase", () => {
    const { ast, errors } = p("user.email.is_lowercase");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("property_access");
    if (ast.type === "property_access") {
      expect(ast.property).toBe("is_lowercase");
      expect(ast.object.type).toBe("property_access");
    }
  });

  it("operator precedence: a ∧ b ∨ c → OR(AND(a,b), c)", () => {
    const { ast, errors } = p("a ∧ b ∨ c");
    expect(errors).toEqual([]);
    // OR is lower precedence, so it's the root
    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.op).toBe("or");
      expect(ast.left.type).toBe("logical");
      if (ast.left.type === "logical") {
        expect(ast.left.op).toBe("and");
      }
    }
  });

  it("parses negation: ¬a", () => {
    const { ast, errors } = p("¬a");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("not");
  });

  it("parses function call: length(x)", () => {
    const { ast, errors } = p("length(x)");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("function_call");
    if (ast.type === "function_call") {
      expect(ast.name).toBe("length");
      expect(ast.args).toHaveLength(1);
    }
  });

  it("parses array literal: [1, 2, 3]", () => {
    const { ast, errors } = p("[1, 2, 3]");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("array_literal");
    if (ast.type === "array_literal") {
      expect(ast.elements).toHaveLength(3);
    }
  });

  it("parses arithmetic with correct precedence", () => {
    const { ast, errors } = p("a + b * c");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("binary_op");
    if (ast.type === "binary_op") {
      expect(ast.op).toBe("+");
      expect(ast.right.type).toBe("binary_op");
    }
  });

  it("parse error produces errors array, not thrown exception", () => {
    const { errors } = p("∀");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("parses string literal", () => {
    const { ast, errors } = p('"active"');
    expect(errors).toEqual([]);
    expect(ast.type).toBe("literal");
    if (ast.type === "literal") {
      expect(ast.value).toBe("active");
    }
  });

  it("parses equality comparison: status = \"active\"", () => {
    const { ast, errors } = p('status = "active"');
    expect(errors).toEqual([]);
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.op).toBe("=");
    }
  });

  it("parses complex quantifier: ∀p ∈ recommended: p ∉ purchases", () => {
    const { ast, errors } = p("∀p ∈ recommended: p ∉ purchases");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("forall");
    if (ast.type === "forall") {
      expect(ast.variable).toBe("p");
      expect(ast.predicate.type).toBe("membership");
      if (ast.predicate.type === "membership") {
        expect(ast.predicate.negated).toBe(true);
      }
    }
  });

  it("parses parenthesized expressions", () => {
    const { ast, errors } = p("(a ∨ b) ∧ c");
    expect(errors).toEqual([]);
    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.op).toBe("and");
      expect(ast.left.type).toBe("logical");
    }
  });
});
