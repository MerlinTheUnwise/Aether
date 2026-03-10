import { describe, it, expect } from "vitest";
import { tokenize, type Token, type TokenType } from "../../src/parser/lexer.js";

function types(source: string): TokenType[] {
  const { tokens } = tokenize(source);
  return tokens.filter(t => t.type !== "NEWLINE" && t.type !== "EOF").map(t => t.type);
}

function values(source: string): string[] {
  const { tokens } = tokenize(source);
  return tokens.filter(t => t.type !== "NEWLINE" && t.type !== "EOF").map(t => t.value);
}

describe("Lexer", () => {
  it("tokenizes minimal graph", () => {
    const { tokens, errors } = tokenize("graph my_graph v1\nend");
    expect(errors).toHaveLength(0);
    const meaningful = tokens.filter(t => t.type !== "NEWLINE" && t.type !== "EOF");
    expect(meaningful.map(t => t.type)).toEqual(["GRAPH", "IDENTIFIER", "IDENTIFIER", "END"]);
    expect(meaningful.map(t => t.value)).toEqual(["graph", "my_graph", "v1", "end"]);
  });

  it("recognizes all keywords", () => {
    const keywords = [
      "graph", "node", "edge", "end", "hole", "intent", "scope", "template", "use",
      "statetype", "supervised", "in", "out", "effects", "contracts", "recovery",
      "confidence", "pre", "post", "pure", "ensure", "constraints", "params",
      "states", "transitions", "never", "terminal", "initial", "when",
      "requires", "provides", "nodes", "must_satisfy",
    ];
    for (const kw of keywords) {
      const { tokens, errors } = tokenize(kw);
      expect(errors).toHaveLength(0);
      const tok = tokens[0];
      expect(tok.type).not.toBe("IDENTIFIER");
    }
  });

  it("tokenizes annotations", () => {
    const toks = types("@email @auth @pii");
    expect(toks).toEqual(["AT", "IDENTIFIER", "AT", "IDENTIFIER", "AT", "IDENTIFIER"]);
  });

  it("preserves comments", () => {
    const { tokens } = tokenize("// this is a comment\nnode x");
    const comment = tokens.find(t => t.type === "COMMENT");
    expect(comment).toBeDefined();
    expect(comment!.value).toBe("// this is a comment");
  });

  it("tokenizes string literals", () => {
    const { tokens, errors } = tokenize('"hello world"');
    expect(errors).toHaveLength(0);
    const str = tokens.find(t => t.type === "STRING");
    expect(str).toBeDefined();
    expect(str!.value).toBe("hello world");
  });

  it("tokenizes numbers (integers and floats)", () => {
    const toks = types("42 0.95 100");
    expect(toks).toEqual(["NUMBER", "NUMBER", "NUMBER"]);
    const vals = values("42 0.95 100");
    expect(vals).toEqual(["42", "0.95", "100"]);
  });

  it("tokenizes arrow operator -> as ARROW", () => {
    const toks = types("a -> b");
    expect(toks).toEqual(["IDENTIFIER", "ARROW", "IDENTIFIER"]);
  });

  it("tokenizes unicode arrow → as ARROW", () => {
    const toks = types("a → b");
    expect(toks).toEqual(["IDENTIFIER", "ARROW", "IDENTIFIER"]);
  });

  it("tokenizes boolean literals", () => {
    const toks = types("true false");
    expect(toks).toEqual(["BOOLEAN", "BOOLEAN"]);
  });

  it("tokenizes brackets, parens, operators", () => {
    const toks = types("[a, b] (x: y) @email");
    expect(toks).toContain("LBRACKET");
    expect(toks).toContain("RBRACKET");
    expect(toks).toContain("LPAREN");
    expect(toks).toContain("RPAREN");
    expect(toks).toContain("COLON");
    expect(toks).toContain("COMMA");
    expect(toks).toContain("AT");
  });

  it("reports error for unrecognized character", () => {
    const { errors } = tokenize("node `bad");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("E001");
    expect(errors[0].line).toBeGreaterThan(0);
    expect(errors[0].column).toBeGreaterThan(0);
  });

  it("reports error for unterminated string", () => {
    const { errors } = tokenize('"hello\nnext line');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].code).toBe("E002");
  });

  it("tracks line and column numbers", () => {
    const { tokens } = tokenize("graph x\n  node y");
    const nodeToken = tokens.find(t => t.value === "node");
    expect(nodeToken).toBeDefined();
    expect(nodeToken!.line).toBe(2);
    expect(nodeToken!.column).toBe(3);
  });

  it("handles dotted identifiers via separate tokens", () => {
    const toks = types("database.read");
    expect(toks).toEqual(["IDENTIFIER", "DOT", "IDENTIFIER"]);
  });

  it("tokenizes comparison operators", () => {
    expect(types("<=")).toEqual(["LTEQ"]);
    expect(types(">=")).toEqual(["GTEQ"]);
    expect(types("==")).toEqual(["EQEQ"]);
    expect(types("!=")).toEqual(["NEQ"]);
  });

  it("tokenizes generic types like List<Record>", () => {
    const toks = types("List<Record>");
    expect(toks).toEqual(["IDENTIFIER", "LT", "IDENTIFIER", "GT"]);
  });
});
