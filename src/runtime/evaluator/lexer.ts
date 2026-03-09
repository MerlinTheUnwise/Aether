// Expression Lexer for AETHER contract expressions
// Tokenizes both Unicode operators (∧, ∨, ∀, ∈, ≤) and ASCII equivalents (&&, ||, forall, in, <=)

export type TokenType =
  // Literals
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "IDENTIFIER"
  // Comparison
  | "EQ"
  | "NEQ"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE"
  // Boolean
  | "AND"
  | "OR"
  | "NOT"
  | "IMPLIES"
  // Set/Collection
  | "IN"
  | "NOT_IN"
  | "INTERSECTION"
  | "SUBSET"
  | "EMPTY_SET"
  // Quantifiers
  | "FORALL"
  | "EXISTS"
  | "COLON"
  // Grouping
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "COMMA"
  // Arithmetic
  | "PLUS"
  | "MINUS"
  | "MULTIPLY"
  | "DIVIDE"
  // Special
  | "DOT"
  | "ERROR"
  | "EOF";

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const KEYWORDS: Record<string, TokenType> = {
  true: "BOOLEAN",
  false: "BOOLEAN",
  forall: "FORALL",
  exists: "EXISTS",
  in: "IN",
  not_in: "NOT_IN",
  and: "AND",
  or: "OR",
  not: "NOT",
};

export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const ch = expression[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let value = "";
      while (i < expression.length && expression[i] !== quote) {
        if (expression[i] === "\\") {
          i++;
          if (i < expression.length) value += expression[i];
        } else {
          value += expression[i];
        }
        i++;
      }
      if (i < expression.length) i++; // skip closing quote
      tokens.push({ type: "STRING", value, position: start });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === "-" && i + 1 < expression.length && /[0-9]/.test(expression[i + 1]) && (tokens.length === 0 || isOperatorToken(tokens[tokens.length - 1])))) {
      const start = i;
      if (ch === "-") i++;
      while (i < expression.length && /[0-9]/.test(expression[i])) i++;
      if (i < expression.length && expression[i] === "." && i + 1 < expression.length && /[0-9]/.test(expression[i + 1])) {
        i++;
        while (i < expression.length && /[0-9]/.test(expression[i])) i++;
      }
      tokens.push({ type: "NUMBER", value: expression.slice(start, i), position: start });
      continue;
    }

    // Unicode operators (multi-char first)
    if (ch === "∧") { tokens.push({ type: "AND", value: "∧", position: i }); i++; continue; }
    if (ch === "∨") { tokens.push({ type: "OR", value: "∨", position: i }); i++; continue; }
    if (ch === "¬") { tokens.push({ type: "NOT", value: "¬", position: i }); i++; continue; }
    if (ch === "∀") { tokens.push({ type: "FORALL", value: "∀", position: i }); i++; continue; }
    if (ch === "∃") { tokens.push({ type: "EXISTS", value: "∃", position: i }); i++; continue; }
    if (ch === "∈") { tokens.push({ type: "IN", value: "∈", position: i }); i++; continue; }
    if (ch === "∉") { tokens.push({ type: "NOT_IN", value: "∉", position: i }); i++; continue; }
    if (ch === "∩") { tokens.push({ type: "INTERSECTION", value: "∩", position: i }); i++; continue; }
    if (ch === "⊆") { tokens.push({ type: "SUBSET", value: "⊆", position: i }); i++; continue; }
    if (ch === "∅") { tokens.push({ type: "EMPTY_SET", value: "∅", position: i }); i++; continue; }
    if (ch === "≤") { tokens.push({ type: "LTE", value: "≤", position: i }); i++; continue; }
    if (ch === "≥") { tokens.push({ type: "GTE", value: "≥", position: i }); i++; continue; }
    if (ch === "≠") { tokens.push({ type: "NEQ", value: "≠", position: i }); i++; continue; }
    if (ch === "×") { tokens.push({ type: "MULTIPLY", value: "×", position: i }); i++; continue; }
    if (ch === "÷") { tokens.push({ type: "DIVIDE", value: "÷", position: i }); i++; continue; }

    // Arrow: → or ⟹
    if (ch === "→" || ch === "⟹") { tokens.push({ type: "IMPLIES", value: ch, position: i }); i++; continue; }

    // ASCII multi-char operators
    if (ch === "&" && expression[i + 1] === "&") { tokens.push({ type: "AND", value: "&&", position: i }); i += 2; continue; }
    if (ch === "|" && expression[i + 1] === "|") { tokens.push({ type: "OR", value: "||", position: i }); i += 2; continue; }
    if (ch === "!" && expression[i + 1] === "=") { tokens.push({ type: "NEQ", value: "!=", position: i }); i += 2; continue; }
    if (ch === "<" && expression[i + 1] === "=") { tokens.push({ type: "LTE", value: "<=", position: i }); i += 2; continue; }
    if (ch === ">" && expression[i + 1] === "=") { tokens.push({ type: "GTE", value: ">=", position: i }); i += 2; continue; }
    if (ch === "=" && expression[i + 1] === ">") { tokens.push({ type: "IMPLIES", value: "=>", position: i }); i += 2; continue; }
    if (ch === "=" && expression[i + 1] === "=") { tokens.push({ type: "EQ", value: "==", position: i }); i += 2; continue; }

    // Single-char operators
    if (ch === "=") { tokens.push({ type: "EQ", value: "=", position: i }); i++; continue; }
    if (ch === "<") { tokens.push({ type: "LT", value: "<", position: i }); i++; continue; }
    if (ch === ">") { tokens.push({ type: "GT", value: ">", position: i }); i++; continue; }
    if (ch === "!") { tokens.push({ type: "NOT", value: "!", position: i }); i++; continue; }
    if (ch === "(") { tokens.push({ type: "LPAREN", value: "(", position: i }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "RPAREN", value: ")", position: i }); i++; continue; }
    if (ch === "[") { tokens.push({ type: "LBRACKET", value: "[", position: i }); i++; continue; }
    if (ch === "]") { tokens.push({ type: "RBRACKET", value: "]", position: i }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "COMMA", value: ",", position: i }); i++; continue; }
    if (ch === ":") { tokens.push({ type: "COLON", value: ":", position: i }); i++; continue; }
    if (ch === "+") { tokens.push({ type: "PLUS", value: "+", position: i }); i++; continue; }
    if (ch === "-") { tokens.push({ type: "MINUS", value: "-", position: i }); i++; continue; }
    if (ch === "*") { tokens.push({ type: "MULTIPLY", value: "*", position: i }); i++; continue; }
    if (ch === "/") { tokens.push({ type: "DIVIDE", value: "/", position: i }); i++; continue; }
    if (ch === ".") { tokens.push({ type: "DOT", value: ".", position: i }); i++; continue; }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < expression.length && /[a-zA-Z0-9_]/.test(expression[i])) i++;
      const word = expression.slice(start, i);
      const kwType = KEYWORDS[word];
      if (kwType) {
        tokens.push({ type: kwType, value: word, position: start });
      } else {
        tokens.push({ type: "IDENTIFIER", value: word, position: start });
      }
      continue;
    }

    // Unrecognized character
    tokens.push({ type: "ERROR", value: ch, position: i });
    i++;
  }

  tokens.push({ type: "EOF", value: "", position: i });
  return tokens;
}

function isOperatorToken(token: Token): boolean {
  return [
    "EQ", "NEQ", "LT", "GT", "LTE", "GTE",
    "AND", "OR", "NOT", "IMPLIES",
    "IN", "NOT_IN", "INTERSECTION", "SUBSET",
    "PLUS", "MINUS", "MULTIPLY", "DIVIDE",
    "LPAREN", "LBRACKET", "COMMA", "COLON",
  ].includes(token.type);
}
