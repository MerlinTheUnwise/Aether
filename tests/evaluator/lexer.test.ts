import { describe, it, expect } from "vitest";
import { tokenize, Token } from "../../src/runtime/evaluator/lexer.js";

function types(tokens: Token[]): string[] {
  return tokens.filter(t => t.type !== "EOF").map(t => t.type);
}

describe("Expression Lexer", () => {
  it("tokenizes simple comparison: x > 0", () => {
    expect(types(tokenize("x > 0"))).toEqual(["IDENTIFIER", "GT", "NUMBER"]);
  });

  it("tokenizes boolean logic: a ∧ b ∨ c", () => {
    expect(types(tokenize("a ∧ b ∨ c"))).toEqual(["IDENTIFIER", "AND", "IDENTIFIER", "OR", "IDENTIFIER"]);
  });

  it("tokenizes Unicode operators", () => {
    const ops: Array<[string, string]> = [
      ["≤", "LTE"], ["≥", "GTE"], ["∈", "IN"], ["∉", "NOT_IN"],
      ["∀", "FORALL"], ["∃", "EXISTS"], ["∧", "AND"], ["∨", "OR"],
      ["¬", "NOT"], ["→", "IMPLIES"], ["∩", "INTERSECTION"], ["⊆", "SUBSET"], ["∅", "EMPTY_SET"],
    ];
    for (const [ch, expected] of ops) {
      const result = tokenize(ch);
      expect(result[0].type).toBe(expected);
    }
  });

  it("tokenizes ASCII equivalents", () => {
    const ops: Array<[string, string]> = [
      ["<=", "LTE"], [">=", "GTE"], ["&&", "AND"], ["||", "OR"],
      ["!", "NOT"], ["!=", "NEQ"], ["=>", "IMPLIES"],
    ];
    for (const [ch, expected] of ops) {
      const result = tokenize(ch);
      expect(result[0].type).toBe(expected);
    }
  });

  it("tokenizes keyword equivalents", () => {
    expect(tokenize("forall")[0].type).toBe("FORALL");
    expect(tokenize("exists")[0].type).toBe("EXISTS");
    expect(tokenize("in")[0].type).toBe("IN");
    expect(tokenize("not_in")[0].type).toBe("NOT_IN");
    expect(tokenize("and")[0].type).toBe("AND");
    expect(tokenize("or")[0].type).toBe("OR");
    expect(tokenize("not")[0].type).toBe("NOT");
  });

  it("tokenizes string literals", () => {
    const tokens = tokenize('"active"');
    expect(tokens[0].type).toBe("STRING");
    expect(tokens[0].value).toBe("active");
  });

  it("tokenizes dotted identifiers as separate tokens", () => {
    const result = types(tokenize("user.email.length"));
    expect(result).toEqual(["IDENTIFIER", "DOT", "IDENTIFIER", "DOT", "IDENTIFIER"]);
  });

  it("tokenizes array literals", () => {
    const result = types(tokenize('[1, 2, 3]'));
    expect(result).toEqual(["LBRACKET", "NUMBER", "COMMA", "NUMBER", "COMMA", "NUMBER", "RBRACKET"]);
  });

  it("tokenizes string array literal", () => {
    const result = types(tokenize('["active", "pending"]'));
    expect(result).toEqual(["LBRACKET", "STRING", "COMMA", "STRING", "RBRACKET"]);
  });

  it("tokenizes quantifier expression: ∀p ∈ recommended: p ∉ purchases", () => {
    const result = types(tokenize("∀p ∈ recommended: p ∉ purchases"));
    expect(result).toEqual(["FORALL", "IDENTIFIER", "IN", "IDENTIFIER", "COLON", "IDENTIFIER", "NOT_IN", "IDENTIFIER"]);
  });

  it("tokenizes numbers including decimals and negatives", () => {
    expect(tokenize("3.14")[0].value).toBe("3.14");
    expect(tokenize("0")[0].value).toBe("0");
    expect(tokenize("-5")[0].value).toBe("-5");
  });

  it("tokenizes booleans", () => {
    expect(tokenize("true")[0].type).toBe("BOOLEAN");
    expect(tokenize("false")[0].type).toBe("BOOLEAN");
  });

  it("tokenizes arithmetic operators", () => {
    const result = types(tokenize("a + b * c"));
    expect(result).toEqual(["IDENTIFIER", "PLUS", "IDENTIFIER", "MULTIPLY", "IDENTIFIER"]);
  });

  it("tokenizes ×, ÷ as multiply/divide", () => {
    expect(tokenize("×")[0].type).toBe("MULTIPLY");
    expect(tokenize("÷")[0].type).toBe("DIVIDE");
  });

  it("produces ERROR for unrecognized characters", () => {
    const result = tokenize("x @ y");
    expect(result[1].type).toBe("ERROR");
    expect(result[1].value).toBe("@");
    expect(result[1].position).toBe(2);
  });

  it("always ends with EOF", () => {
    const result = tokenize("x");
    expect(result[result.length - 1].type).toBe("EOF");
  });

  it("tokenizes parenthesized expression", () => {
    const result = types(tokenize("(a + b)"));
    expect(result).toEqual(["LPAREN", "IDENTIFIER", "PLUS", "IDENTIFIER", "RPAREN"]);
  });

  it("tokenizes function call syntax", () => {
    const result = types(tokenize("length(x)"));
    expect(result).toEqual(["IDENTIFIER", "LPAREN", "IDENTIFIER", "RPAREN"]);
  });

  it("tokenizes chained comparison", () => {
    const result = types(tokenize("0 ≤ x ≤ 100"));
    expect(result).toEqual(["NUMBER", "LTE", "IDENTIFIER", "LTE", "NUMBER"]);
  });

  it("tokenizes equality operator", () => {
    expect(tokenize("=")[0].type).toBe("EQ");
    expect(tokenize("==")[0].type).toBe("EQ");
  });

  it("tokenizes ≠", () => {
    expect(tokenize("≠")[0].type).toBe("NEQ");
  });

  it("handles complex expression with mixed operators", () => {
    const result = types(tokenize("a ∧ b → c ∨ d"));
    expect(result).toEqual(["IDENTIFIER", "AND", "IDENTIFIER", "IMPLIES", "IDENTIFIER", "OR", "IDENTIFIER"]);
  });
});
