// Error types with line/column/context for the .aether parser

export interface ParseError {
  message: string;
  line: number;
  column: number;
  length: number;
  context: string;     // the source line containing the error
  pointer: string;     // "    ^^^" pointing to error position
  suggestion?: string;
  code: string;        // "E001", "E002", etc.
}

export interface ParseWarning {
  message: string;
  line: number;
  column: number;
  code: string;
  suggestion?: string;
}

export interface LexError {
  message: string;
  line: number;
  column: number;
  code: string;
}

// Error codes
export const ErrorCodes = {
  // Lexer errors
  E001: "unexpected character",
  E002: "unterminated string literal",
  // Parser errors — structural
  E010: "expected 'end' to close block",
  E011: "expected keyword",
  E012: "unexpected token",
  E013: "expected identifier",
  E014: "expected version number",
  E015: "expected colon",
  E016: "expected arrow (->)",
  E017: "duplicate node id",
  E018: "duplicate edge",
  // Parser errors — AETHER rules
  E020: "effectful node missing recovery block",
  E021: "low-confidence node missing adversarial check",
  E022: "contracts block missing postcondition",
  E023: "edge references nonexistent port",
  E024: "edge source must be output port",
  E025: "edge target must be input port",
  E026: "graph effects should cover all node effects",
  // Annotation warnings
  W001: "unknown annotation",
} as const;

export function formatError(err: ParseError, filePath?: string): string {
  const location = filePath
    ? `  --> ${filePath}:${err.line}:${err.column}`
    : `  --> line ${err.line}:${err.column}`;

  const lines = [
    `error[${err.code}]: ${err.message}`,
    location,
    `   |`,
    `${String(err.line).padStart(3)} | ${err.context}`,
    `   | ${err.pointer}`,
  ];

  if (err.suggestion) {
    lines.push(`   = help: ${err.suggestion}`);
  }

  return lines.join("\n");
}

export function formatWarning(warn: ParseWarning): string {
  return `warning[${warn.code}]: ${warn.message} (line ${warn.line}:${warn.column})${warn.suggestion ? `\n   = help: ${warn.suggestion}` : ""}`;
}

export function makeError(
  code: string,
  message: string,
  line: number,
  column: number,
  length: number,
  sourceLines: string[],
  suggestion?: string
): ParseError {
  const contextLine = sourceLines[line - 1] ?? "";
  const spaces = " ".repeat(Math.max(0, column - 1));
  const carets = "^".repeat(Math.max(1, length));
  return {
    message,
    line,
    column,
    length,
    context: contextLine,
    pointer: spaces + carets,
    suggestion,
    code,
  };
}
