// Tokenizer for the .aether surface syntax

import type { LexError } from "./errors.js";

export type TokenType =
  // Keywords
  | "GRAPH" | "NODE" | "EDGE" | "END" | "HOLE" | "INTENT" | "SCOPE" | "TEMPLATE" | "USE"
  | "STATETYPE" | "SUPERVISED" | "AS"
  // Field keywords
  | "IN" | "OUT" | "EFFECTS" | "CONTRACTS" | "RECOVERY" | "CONFIDENCE"
  | "PRE" | "POST" | "PURE" | "ENSURE" | "CONSTRAINTS" | "PARAMS"
  | "STATES" | "TRANSITIONS" | "NEVER" | "TERMINAL" | "INITIAL" | "WHEN"
  | "REQUIRES" | "PROVIDES" | "NODES" | "MUST_SATISFY"
  | "AXIOMS" | "PIPELINE_PROPERTIES"
  | "ADVERSARIAL" | "BREAK_IF" | "MCP"
  | "PARTIAL" | "METADATA" | "DESCRIPTION" | "SAFETY_LEVEL" | "HUMAN_OVERSIGHT"
  | "SLA" | "LATENCY_MS" | "AVAILABILITY"
  // Operators
  | "ARROW"          // ->
  | "COLON"          // :
  | "COMMA"          // ,
  | "DOT"            // .
  | "AT"             // @
  | "DOLLAR"         // $
  | "EQUALS"         // =
  | "LPAREN" | "RPAREN" | "LBRACKET" | "RBRACKET"
  | "LT" | "GT"     // < >
  // Comparison operators (in expressions)
  | "LTEQ" | "GTEQ" | "EQEQ" | "NEQ"
  | "AND" | "OR" | "NOT"
  | "PLUS" | "MINUS" | "STAR" | "SLASH"
  // Literals
  | "IDENTIFIER" | "STRING" | "NUMBER" | "BOOLEAN"
  // Special
  | "COMMENT"
  | "NEWLINE" | "EOF";

const KEYWORDS: Record<string, TokenType> = {
  graph: "GRAPH",
  node: "NODE",
  edge: "EDGE",
  end: "END",
  hole: "HOLE",
  intent: "INTENT",
  scope: "SCOPE",
  template: "TEMPLATE",
  use: "USE",
  as: "AS",
  statetype: "STATETYPE",
  supervised: "SUPERVISED",
  in: "IN",
  out: "OUT",
  effects: "EFFECTS",
  contracts: "CONTRACTS",
  recovery: "RECOVERY",
  confidence: "CONFIDENCE",
  pre: "PRE",
  post: "POST",
  pure: "PURE",
  ensure: "ENSURE",
  constraints: "CONSTRAINTS",
  params: "PARAMS",
  states: "STATES",
  transitions: "TRANSITIONS",
  never: "NEVER",
  terminal: "TERMINAL",
  initial: "INITIAL",
  when: "WHEN",
  requires: "REQUIRES",
  provides: "PROVIDES",
  nodes: "NODES",
  must_satisfy: "MUST_SATISFY",
  axioms: "AXIOMS",
  pipeline_properties: "PIPELINE_PROPERTIES",
  adversarial: "ADVERSARIAL",
  break_if: "BREAK_IF",
  mcp: "MCP",
  partial: "PARTIAL",
  metadata: "METADATA",
  description: "DESCRIPTION",
  safety_level: "SAFETY_LEVEL",
  human_oversight: "HUMAN_OVERSIGHT",
  sla: "SLA",
  latency_ms: "LATENCY_MS",
  availability: "AVAILABILITY",
  true: "BOOLEAN",
  false: "BOOLEAN",
};

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  length: number;
}

export interface TokenizeResult {
  tokens: Token[];
  errors: LexError[];
}

export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const errors: LexError[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek(): string {
    return pos < source.length ? source[pos] : "\0";
  }

  function peekAt(offset: number): string {
    return pos + offset < source.length ? source[pos + offset] : "\0";
  }

  function advance(): string {
    const ch = source[pos];
    pos++;
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  }

  function addToken(type: TokenType, value: string, startLine: number, startCol: number) {
    tokens.push({ type, value, line: startLine, column: startCol, length: value.length });
  }

  while (pos < source.length) {
    const ch = peek();
    const startLine = line;
    const startCol = col;

    // Skip spaces and tabs (not newlines)
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance();
      continue;
    }

    // Newline
    if (ch === "\n") {
      advance();
      addToken("NEWLINE", "\n", startLine, startCol);
      continue;
    }

    // Comments
    if (ch === "/" && peekAt(1) === "/") {
      advance(); advance(); // skip //
      let text = "";
      while (pos < source.length && peek() !== "\n") {
        text += advance();
      }
      addToken("COMMENT", "//" + text, startLine, startCol);
      continue;
    }

    // Unicode arrows: → and ∨
    if (ch === "\u2192") { // →
      advance();
      addToken("ARROW", "->", startLine, startCol);
      continue;
    }
    if (ch === "\u2228") { // ∨ (logical or)
      advance();
      addToken("OR", "∨", startLine, startCol);
      continue;
    }
    if (ch === "\u2227") { // ∧ (logical and)
      advance();
      addToken("AND", "∧", startLine, startCol);
      continue;
    }
    if (ch === "\u2264") { // ≤
      advance();
      addToken("LTEQ", "<=", startLine, startCol);
      continue;
    }
    if (ch === "\u2265") { // ≥
      advance();
      addToken("GTEQ", ">=", startLine, startCol);
      continue;
    }

    // Arrow ->
    if (ch === "-" && peekAt(1) === ">") {
      advance(); advance();
      addToken("ARROW", "->", startLine, startCol);
      continue;
    }

    // Two-char operators
    if (ch === "&" && peekAt(1) === "&") {
      advance(); advance();
      addToken("AND", "&&", startLine, startCol);
      continue;
    }
    if (ch === "|" && peekAt(1) === "|") {
      advance(); advance();
      addToken("OR", "||", startLine, startCol);
      continue;
    }
    if (ch === "&") {
      advance();
      addToken("AND", "&", startLine, startCol);
      continue;
    }
    if (ch === "|") {
      advance();
      addToken("OR", "|", startLine, startCol);
      continue;
    }
    if (ch === "<" && peekAt(1) === "=") {
      advance(); advance();
      addToken("LTEQ", "<=", startLine, startCol);
      continue;
    }
    if (ch === ">" && peekAt(1) === "=") {
      advance(); advance();
      addToken("GTEQ", ">=", startLine, startCol);
      continue;
    }
    if (ch === "=" && peekAt(1) === "=") {
      advance(); advance();
      addToken("EQEQ", "==", startLine, startCol);
      continue;
    }
    if (ch === "!" && peekAt(1) === "=") {
      advance(); advance();
      addToken("NEQ", "!=", startLine, startCol);
      continue;
    }

    // Single-char operators
    switch (ch) {
      case ":": advance(); addToken("COLON", ":", startLine, startCol); continue;
      case ",": advance(); addToken("COMMA", ",", startLine, startCol); continue;
      case ".": advance(); addToken("DOT", ".", startLine, startCol); continue;
      case "@": advance(); addToken("AT", "@", startLine, startCol); continue;
      case "$": advance(); addToken("DOLLAR", "$", startLine, startCol); continue;
      case "=": advance(); addToken("EQUALS", "=", startLine, startCol); continue;
      case "(": advance(); addToken("LPAREN", "(", startLine, startCol); continue;
      case ")": advance(); addToken("RPAREN", ")", startLine, startCol); continue;
      case "[": advance(); addToken("LBRACKET", "[", startLine, startCol); continue;
      case "]": advance(); addToken("RBRACKET", "]", startLine, startCol); continue;
      case "<": advance(); addToken("LT", "<", startLine, startCol); continue;
      case ">": advance(); addToken("GT", ">", startLine, startCol); continue;
      case "+": advance(); addToken("PLUS", "+", startLine, startCol); continue;
      case "-": advance(); addToken("MINUS", "-", startLine, startCol); continue;
      case "*": advance(); addToken("STAR", "*", startLine, startCol); continue;
      case "/": advance(); addToken("SLASH", "/", startLine, startCol); continue;
      case "!": advance(); addToken("NOT", "!", startLine, startCol); continue;
    }

    // String literals
    if (ch === '"') {
      advance(); // skip opening quote
      let str = "";
      while (pos < source.length && peek() !== '"' && peek() !== "\n") {
        if (peek() === "\\") {
          advance();
          const esc = advance();
          switch (esc) {
            case "n": str += "\n"; break;
            case "t": str += "\t"; break;
            case '"': str += '"'; break;
            case "\\": str += "\\"; break;
            default: str += esc;
          }
        } else {
          str += advance();
        }
      }
      if (peek() === '"') {
        advance(); // skip closing quote
        addToken("STRING", str, startLine, startCol);
      } else {
        errors.push({
          message: "unterminated string literal",
          line: startLine,
          column: startCol,
          code: "E002",
        });
      }
      continue;
    }

    // Numbers (integers and floats)
    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (pos < source.length && peek() >= "0" && peek() <= "9") {
        num += advance();
      }
      if (peek() === "." && peekAt(1) >= "0" && peekAt(1) <= "9") {
        num += advance(); // the dot
        while (pos < source.length && peek() >= "0" && peek() <= "9") {
          num += advance();
        }
      }
      addToken("NUMBER", num, startLine, startCol);
      continue;
    }

    // Identifiers and keywords
    if (isIdentStart(ch)) {
      let ident = "";
      while (pos < source.length && isIdentPart(peek())) {
        ident += advance();
      }

      // Check for hyphenated identifiers (e.g., "template-showcase", "intent-data-pipeline")
      // Only consume hyphen if followed by an ident char (not '>') to avoid eating '->'
      while (peek() === "-" && pos + 1 < source.length && isIdentStart(peekAt(1))) {
        ident += advance(); // the hyphen
        while (pos < source.length && isIdentPart(peek())) {
          ident += advance();
        }
      }

      // Check for compound keywords with underscore-separated words
      const lower = ident.toLowerCase();
      const kwType = KEYWORDS[lower];
      if (kwType && !ident.includes("-")) {
        // Only treat as keyword if it's not a hyphenated identifier
        addToken(kwType, ident, startLine, startCol);
      } else {
        addToken("IDENTIFIER", ident, startLine, startCol);
      }
      continue;
    }

    // Unicode section dividers (─)
    if (ch === "\u2500") {
      // Skip decorative line chars
      while (pos < source.length && peek() === "\u2500") {
        advance();
      }
      continue;
    }

    // Unknown character
    errors.push({
      message: `unexpected character '${ch}'`,
      line: startLine,
      column: startCol,
      code: "E001",
    });
    advance();
  }

  addToken("EOF", "", line, col);
  return { tokens, errors };
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") ||
         (ch >= "A" && ch <= "Z") ||
         ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) ||
         (ch >= "0" && ch <= "9");
}
