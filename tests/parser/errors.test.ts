import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/parser/lexer.js";
import { parse } from "../../src/parser/parser.js";
import { formatError, type ParseError } from "../../src/parser/errors.js";

function parseSource(source: string) {
  const { tokens, errors: lexErrors } = tokenize(source);
  if (lexErrors.length > 0) {
    const sourceLines = source.split("\n");
    return {
      errors: lexErrors.map(e => ({
        message: e.message,
        line: e.line,
        column: e.column,
        length: 1,
        context: sourceLines[e.line - 1] ?? "",
        pointer: " ".repeat(Math.max(0, e.column - 1)) + "^",
        code: e.code,
        suggestion: undefined as string | undefined,
      })) as ParseError[],
      warnings: [],
      ast: null,
    };
  }
  const sourceLines = source.split("\n");
  return parse(tokens, sourceLines);
}

describe("Error Reporting", () => {
  it("missing 'end' → error with line number pointing to unclosed block", () => {
    const result = parseSource(`graph test v1
  effects: []
  node fetch
    in: id: String
    out: data: String
    pure
    confidence: 0.99`);
    const err = result.errors.find(e => e.code === "E010");
    expect(err).toBeDefined();
    expect(err!.line).toBeGreaterThan(0);
  });

  it("missing recovery → error with suggestion showing recovery syntax", () => {
    const result = parseSource(`graph test v1
  effects: [database.read]
  node fetch
    in: id: String
    out: data: String
    effects: [database.read]
    contracts:
      post: data.length > 0
    confidence: 0.9
  end
end`);
    const err = result.errors.find(e => e.code === "E020");
    expect(err).toBeDefined();
    expect(err!.suggestion).toContain("recovery");
    expect(err!.suggestion).toContain("retry");
  });

  it("missing adversarial → error with suggestion", () => {
    const result = parseSource(`graph test v1
  effects: []
  node risky
    in: x: String
    out: y: String
    contracts:
      post: y.length > 0
    pure
    confidence: 0.6
  end
end`);
    const err = result.errors.find(e => e.code === "E021");
    expect(err).toBeDefined();
    expect(err!.suggestion).toContain("adversarial");
  });

  it("missing postcondition → error with suggestion", () => {
    const result = parseSource(`graph test v1
  effects: []
  node bad
    in: x: String
    out: y: String
    contracts:
      pre: x.length > 0
    pure
    confidence: 0.99
  end
end`);
    const err = result.errors.find(e => e.code === "E022");
    expect(err).toBeDefined();
    expect(err!.message).toContain("postcondition");
  });

  it("invalid edge port → error naming the nonexistent port", () => {
    const result = parseSource(`graph test v1
  effects: []
  node a
    in: x: String
    out: y: String
    contracts:
      post: y.length > 0
    pure
    confidence: 0.99
  end
  edge a.z -> a.x
end`);
    const err = result.errors.find(e => e.code === "E024");
    expect(err).toBeDefined();
    expect(err!.message).toContain("z");
    expect(err!.suggestion).toContain("y");
  });

  it("all errors include line, column, context, pointer, code", () => {
    const source = `graph test v1
  effects: [database.read]
  node bad_node
    in: x: String
    out: y: String
    effects: [database.read]
    confidence: 0.5
  end
end`;
    const result = parseSource(source);
    for (const err of result.errors) {
      expect(err.line).toBeGreaterThan(0);
      expect(err.column).toBeGreaterThan(0);
      expect(typeof err.context).toBe("string");
      expect(typeof err.pointer).toBe("string");
      expect(typeof err.code).toBe("string");
    }
  });

  it("formatError produces Rust-style output", () => {
    const result = parseSource(`graph test v1
  effects: [database.read]
  node fetch
    in: id: String
    out: data: String
    effects: [database.read]
    contracts:
      post: data.length > 0
    confidence: 0.9
  end
end`);
    const err = result.errors.find(e => e.code === "E020");
    expect(err).toBeDefined();

    const formatted = formatError(err!, "pipeline.aether");
    expect(formatted).toContain("error[E020]");
    expect(formatted).toContain("-->");
    expect(formatted).toContain("pipeline.aether");
    expect(formatted).toContain("|");
    expect(formatted).toContain("help:");
  });

  it("edge references nonexistent node → error", () => {
    const result = parseSource(`graph test v1
  effects: []
  node a
    in: x: String
    out: y: String
    contracts:
      post: y.length > 0
    pure
    confidence: 0.99
  end
  edge ghost.y -> a.x
end`);
    const err = result.errors.find(e => e.code === "E023");
    expect(err).toBeDefined();
    expect(err!.message).toContain("ghost");
  });
});
