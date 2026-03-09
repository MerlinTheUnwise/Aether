// Recursive descent parser for AETHER contract expressions
// Produces an AST from a token stream

import { Token, TokenType } from "./lexer.js";

export type ASTNode =
  | { type: "literal"; value: number | string | boolean }
  | { type: "identifier"; name: string }
  | { type: "property_access"; object: ASTNode; property: string }
  | { type: "binary_op"; op: string; left: ASTNode; right: ASTNode }
  | { type: "unary_op"; op: string; operand: ASTNode }
  | { type: "comparison"; op: string; left: ASTNode; right: ASTNode }
  | { type: "logical"; op: "and" | "or" | "implies"; left: ASTNode; right: ASTNode }
  | { type: "not"; operand: ASTNode }
  | { type: "membership"; element: ASTNode; collection: ASTNode; negated: boolean }
  | { type: "subset"; left: ASTNode; right: ASTNode }
  | { type: "intersection"; left: ASTNode; right: ASTNode }
  | { type: "forall"; variable: string; collection: ASTNode; predicate: ASTNode }
  | { type: "exists"; variable: string; collection: ASTNode; predicate: ASTNode }
  | { type: "array_literal"; elements: ASTNode[] }
  | { type: "function_call"; name: string; args: ASTNode[] }
  | { type: "chained_comparison"; comparisons: Array<{ op: string; left: ASTNode; right: ASTNode }> }
  | { type: "empty_set" };

export interface ParseResult {
  ast: ASTNode;
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  position: number;
  token?: Token;
}

class Parser {
  private tokens: Token[];
  private pos: number = 0;
  errors: ParseError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "EOF", value: "", position: -1 };
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t;
  }

  private expect(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) {
      this.errors.push({ message: `Expected ${type}, got ${t.type} ("${t.value}")`, position: t.position, token: t });
      return t;
    }
    return this.advance();
  }

  private match(...types: TokenType[]): Token | null {
    if (types.includes(this.peek().type)) {
      return this.advance();
    }
    return null;
  }

  parse(): ASTNode {
    const ast = this.parseImplication();
    if (this.peek().type !== "EOF") {
      this.errors.push({ message: `Unexpected token: ${this.peek().value}`, position: this.peek().position, token: this.peek() });
    }
    return ast;
  }

  // Precedence 1 (lowest): Implication (→, ⟹, =>)
  private parseImplication(): ASTNode {
    let left = this.parseOr();
    while (this.peek().type === "IMPLIES") {
      this.advance();
      const right = this.parseOr();
      left = { type: "logical", op: "implies", left, right };
    }
    return left;
  }

  // Precedence 2: OR (∨, ||)
  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.peek().type === "OR") {
      this.advance();
      const right = this.parseAnd();
      left = { type: "logical", op: "or", left, right };
    }
    return left;
  }

  // Precedence 3: AND (∧, &&)
  private parseAnd(): ASTNode {
    let left = this.parseNot();
    while (this.peek().type === "AND") {
      this.advance();
      const right = this.parseNot();
      left = { type: "logical", op: "and", left, right };
    }
    return left;
  }

  // Precedence 4: NOT (¬, !)
  private parseNot(): ASTNode {
    if (this.peek().type === "NOT") {
      this.advance();
      const operand = this.parseNot();
      return { type: "not", operand };
    }
    return this.parseComparison();
  }

  // Precedence 5: Comparison with chaining support
  private parseComparison(): ASTNode {
    let left = this.parseSetOps();
    const compOps: TokenType[] = ["EQ", "NEQ", "LT", "GT", "LTE", "GTE"];

    if (compOps.includes(this.peek().type)) {
      const comparisons: Array<{ op: string; left: ASTNode; right: ASTNode }> = [];
      let current = left;

      while (compOps.includes(this.peek().type)) {
        const op = this.advance();
        const right = this.parseSetOps();
        comparisons.push({ op: normalizeCompOp(op), left: current, right });
        current = right;
      }

      if (comparisons.length === 1) {
        return { type: "comparison", op: comparisons[0].op, left: comparisons[0].left, right: comparisons[0].right };
      }
      return { type: "chained_comparison", comparisons };
    }

    return left;
  }

  // Precedence 6: Set operations (∈, ∉, ⊆, ∩)
  private parseSetOps(): ASTNode {
    let left = this.parseAdditive();

    if (this.peek().type === "IN") {
      this.advance();
      const collection = this.parseAdditive();
      return { type: "membership", element: left, collection, negated: false };
    }
    if (this.peek().type === "NOT_IN") {
      this.advance();
      const collection = this.parseAdditive();
      return { type: "membership", element: left, collection, negated: true };
    }
    if (this.peek().type === "SUBSET") {
      this.advance();
      const right = this.parseAdditive();
      return { type: "subset", left, right };
    }
    if (this.peek().type === "INTERSECTION") {
      this.advance();
      const right = this.parseAdditive();
      return { type: "intersection", left, right };
    }

    return left;
  }

  // Precedence 7: Additive (+, -)
  private parseAdditive(): ASTNode {
    let left = this.parseMultiplicative();
    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.advance();
      const right = this.parseMultiplicative();
      left = { type: "binary_op", op: op.value, left, right };
    }
    return left;
  }

  // Precedence 8: Multiplicative (*, /, ×, ÷)
  private parseMultiplicative(): ASTNode {
    let left = this.parseUnaryMinus();
    while (this.peek().type === "MULTIPLY" || this.peek().type === "DIVIDE") {
      const op = this.advance();
      const right = this.parseUnaryMinus();
      left = { type: "binary_op", op: op.type === "MULTIPLY" ? "*" : "/", left, right };
    }
    return left;
  }

  // Unary minus for negative expressions like -x
  private parseUnaryMinus(): ASTNode {
    if (this.peek().type === "MINUS") {
      const op = this.advance();
      const operand = this.parsePropertyAccess();
      return { type: "unary_op", op: "-", operand };
    }
    return this.parsePropertyAccess();
  }

  // Precedence 9: Property access (.)
  private parsePropertyAccess(): ASTNode {
    let left = this.parsePrimary();
    while (this.peek().type === "DOT") {
      this.advance();
      const propToken = this.expect("IDENTIFIER");
      left = { type: "property_access", object: left, property: propToken.value };
    }
    return left;
  }

  // Precedence 10: Primary (literals, identifiers, function calls, parens, quantifiers)
  private parsePrimary(): ASTNode {
    const t = this.peek();

    // Quantifiers
    if (t.type === "FORALL" || t.type === "EXISTS") {
      return this.parseQuantifier();
    }

    // Parenthesized expression
    if (t.type === "LPAREN") {
      this.advance();
      const expr = this.parseImplication();
      this.expect("RPAREN");
      return expr;
    }

    // Array literal
    if (t.type === "LBRACKET") {
      return this.parseArrayLiteral();
    }

    // Empty set
    if (t.type === "EMPTY_SET") {
      this.advance();
      return { type: "empty_set" };
    }

    // Number
    if (t.type === "NUMBER") {
      this.advance();
      return { type: "literal", value: parseFloat(t.value) };
    }

    // String
    if (t.type === "STRING") {
      this.advance();
      return { type: "literal", value: t.value };
    }

    // Boolean
    if (t.type === "BOOLEAN") {
      this.advance();
      return { type: "literal", value: t.value === "true" };
    }

    // Identifier or function call
    if (t.type === "IDENTIFIER") {
      this.advance();
      // Check for function call
      if (this.peek().type === "LPAREN") {
        this.advance();
        const args: ASTNode[] = [];
        if (this.peek().type !== "RPAREN") {
          args.push(this.parseImplication());
          while (this.match("COMMA")) {
            args.push(this.parseImplication());
          }
        }
        this.expect("RPAREN");
        return { type: "function_call", name: t.value, args };
      }
      return { type: "identifier", name: t.value };
    }

    // Error recovery
    this.errors.push({ message: `Unexpected token: ${t.type} ("${t.value}")`, position: t.position, token: t });
    this.advance();
    return { type: "literal", value: 0 };
  }

  private parseQuantifier(): ASTNode {
    const quantType = this.advance(); // FORALL or EXISTS
    const variable = this.expect("IDENTIFIER");

    this.expect("IN");
    const collection = this.parseAdditive();
    // Allow property access on collection
    let coll = collection;
    while (this.peek().type === "DOT") {
      this.advance();
      const prop = this.expect("IDENTIFIER");
      coll = { type: "property_access", object: coll, property: prop.value };
    }

    this.expect("COLON");
    const predicate = this.parseImplication();

    if (quantType.type === "FORALL") {
      return { type: "forall", variable: variable.value, collection: coll, predicate };
    }
    return { type: "exists", variable: variable.value, collection: coll, predicate };
  }

  private parseArrayLiteral(): ASTNode {
    this.advance(); // [
    const elements: ASTNode[] = [];
    if (this.peek().type !== "RBRACKET") {
      elements.push(this.parseImplication());
      while (this.match("COMMA")) {
        elements.push(this.parseImplication());
      }
    }
    this.expect("RBRACKET");
    return { type: "array_literal", elements };
  }
}

function normalizeCompOp(token: Token): string {
  switch (token.type) {
    case "EQ": return "=";
    case "NEQ": return "≠";
    case "LT": return "<";
    case "GT": return ">";
    case "LTE": return "≤";
    case "GTE": return "≥";
    default: return token.value;
  }
}

export function parse(tokens: Token[]): ParseResult {
  const parser = new Parser(tokens);
  const ast = parser.parse();
  return { ast, errors: parser.errors };
}
