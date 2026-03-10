// Recursive descent parser for the .aether surface syntax
// Produces a typed AST and collects errors/warnings

import type { Token, TokenType } from "./lexer.js";
import type {
  AetherAST, ASTGraph, ASTNode, ASTHole, ASTIntent, ASTEdge,
  ASTStateType, ASTScope, ASTTemplate, ASTTemplateUse,
  ASTPort, ASTTypeRef, ASTAnnotation, ASTContract, ASTContractClause,
  ASTRecoveryRule, ASTComment, ASTStateTransition,
  ASTBoundaryContract, ASTTemplateParam, ASTTemplateBinding,
  ASTIntentConstraints, ASTSupervised, ASTMetadata, SourceLocation,
} from "./ast.js";
import type { ParseError, ParseWarning } from "./errors.js";
import { makeError } from "./errors.js";

export interface ParseResult {
  ast: AetherAST | null;
  errors: ParseError[];
  warnings: ParseWarning[];
}

export function parse(tokens: Token[], sourceLines?: string[]): ParseResult {
  const p = new Parser(tokens, sourceLines ?? []);
  return p.parseProgram();
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];
  private sourceLines: string[];

  constructor(tokens: Token[], sourceLines: string[]) {
    this.tokens = tokens;
    this.sourceLines = sourceLines;
  }

  // --- Token navigation ---

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "EOF", value: "", line: 0, column: 0, length: 0 };
  }

  private peekType(): TokenType {
    return this.peek().type;
  }

  private advance(): Token {
    const tok = this.peek();
    if (tok.type !== "EOF") this.pos++;
    return tok;
  }

  private expect(type: TokenType, contextMsg?: string): Token | null {
    const tok = this.peek();
    if (tok.type === type) {
      return this.advance();
    }
    this.addError(
      "E012",
      `expected ${type}${contextMsg ? " " + contextMsg : ""}, got ${tok.type} '${tok.value}'`,
      tok,
      contextMsg
    );
    return null;
  }

  private check(type: TokenType): boolean {
    return this.peekType() === type;
  }

  private match(...types: TokenType[]): Token | null {
    if (types.includes(this.peekType())) {
      return this.advance();
    }
    return null;
  }

  private skipNewlines(): void {
    while (this.check("NEWLINE")) this.advance();
  }

  private skipNewlinesAndComments(): ASTComment[] {
    const comments: ASTComment[] = [];
    while (this.check("NEWLINE") || this.check("COMMENT")) {
      const tok = this.advance();
      if (tok.type === "COMMENT") {
        comments.push({
          text: tok.value,
          loc: { line: tok.line, column: tok.column, length: tok.length },
        });
      }
    }
    return comments;
  }

  private addError(code: string, message: string, tok: Token, suggestion?: string) {
    this.errors.push(
      makeError(code, message, tok.line, tok.column, tok.length, this.sourceLines, suggestion)
    );
  }

  private addWarning(code: string, message: string, tok: Token, suggestion?: string) {
    this.warnings.push({
      message,
      line: tok.line,
      column: tok.column,
      code,
      suggestion,
    });
  }

  private loc(tok: Token): SourceLocation {
    return { line: tok.line, column: tok.column, length: tok.length };
  }

  // --- Synchronization (error recovery) ---

  private synchronize(): void {
    // Skip until we find a keyword that starts a new block or 'end'
    while (!this.check("EOF")) {
      const t = this.peekType();
      if (t === "NODE" || t === "HOLE" || t === "INTENT" || t === "EDGE" ||
          t === "STATETYPE" || t === "SCOPE" || t === "TEMPLATE" || t === "USE" ||
          t === "END" || t === "GRAPH") {
        return;
      }
      this.advance();
    }
  }

  // --- Parse entry point ---

  parseProgram(): ParseResult {
    const leadingComments = this.skipNewlinesAndComments();

    if (this.check("EOF")) {
      this.addError("E011", "expected 'graph' declaration", this.peek());
      return { ast: null, errors: this.errors, warnings: this.warnings };
    }

    const graph = this.parseGraph();

    this.skipNewlinesAndComments();
    if (!this.check("EOF")) {
      this.addWarning("W001", "unexpected content after graph end", this.peek());
    }

    if (graph && this.errors.length === 0) {
      // Validate AETHER rules
      this.validateAetherRules(graph);
    }

    return {
      ast: graph ? { graph, leadingComments } : null,
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  // --- Graph ---

  private parseGraph(): ASTGraph | null {
    const startTok = this.peek();
    if (!this.match("GRAPH")) {
      this.addError("E011", "expected 'graph' keyword", startTok);
      return null;
    }

    const idTok = this.expect("IDENTIFIER", "for graph name");
    if (!idTok) return null;

    // Version: v1, v2, etc. — parse as identifier starting with 'v'
    let version = 1;
    const vTok = this.peek();
    if (vTok.type === "IDENTIFIER" && vTok.value.startsWith("v")) {
      this.advance();
      const vNum = parseInt(vTok.value.slice(1), 10);
      if (isNaN(vNum)) {
        this.addError("E014", `invalid version: ${vTok.value}`, vTok, "Version should be like 'v1', 'v2'");
      } else {
        version = vNum;
      }
    }

    this.skipNewlines();

    // Parse graph body
    const effects: string[] = [];
    const nodes: (ASTNode | ASTHole | ASTIntent)[] = [];
    const edges: ASTEdge[] = [];
    const stateTypes: ASTStateType[] = [];
    const scopes: ASTScope[] = [];
    const templates: ASTTemplate[] = [];
    const templateUses: ASTTemplateUse[] = [];
    const comments: ASTComment[] = [];
    let partial = false;
    let metadata: ASTMetadata | undefined;
    let pipelineProperties: string[] | undefined;

    while (!this.check("END") && !this.check("EOF")) {
      const innerComments = this.skipNewlinesAndComments();
      comments.push(...innerComments);

      if (this.check("END") || this.check("EOF")) break;

      const tok = this.peek();

      switch (tok.type) {
        case "EFFECTS": {
          this.advance();
          this.match("COLON");
          const eff = this.parseBracketedList();
          effects.push(...eff);
          break;
        }
        case "PARTIAL": {
          this.advance();
          partial = true;
          break;
        }
        case "PIPELINE_PROPERTIES": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          pipelineProperties = this.parseIndentedExpressionList();
          break;
        }
        case "METADATA": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          metadata = this.parseMetadata();
          break;
        }
        case "NODE": {
          const node = this.parseNode();
          if (node) nodes.push(node);
          break;
        }
        case "HOLE": {
          const hole = this.parseHole();
          if (hole) nodes.push(hole);
          break;
        }
        case "INTENT": {
          const intent = this.parseIntent();
          if (intent) nodes.push(intent);
          break;
        }
        case "EDGE": {
          const edge = this.parseEdge();
          if (edge) edges.push(edge);
          break;
        }
        case "STATETYPE": {
          const st = this.parseStateType();
          if (st) stateTypes.push(st);
          break;
        }
        case "SCOPE": {
          const sc = this.parseScope();
          if (sc) scopes.push(sc);
          break;
        }
        case "TEMPLATE": {
          const tmpl = this.parseTemplate();
          if (tmpl) templates.push(tmpl);
          break;
        }
        case "USE": {
          const use = this.parseTemplateUse();
          if (use) templateUses.push(use);
          break;
        }
        default: {
          this.addError("E012", `unexpected token '${tok.value}' in graph body`, tok);
          this.synchronize();
          break;
        }
      }
    }

    const endTok = this.peek();
    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close graph block", endTok,
        "Add 'end' after the last node/edge declaration");
    }

    // Skip optional comment after end (e.g. "end // graph")
    if (this.check("COMMENT")) {
      this.advance();
    }

    return {
      id: idTok.value,
      version,
      effects,
      partial: partial || undefined,
      nodes,
      edges,
      stateTypes,
      scopes,
      templates,
      templateUses,
      comments,
      metadata,
      pipelineProperties,
      loc: this.loc(startTok),
    };
  }

  // --- Node ---

  private parseNode(): ASTNode | null {
    const startTok = this.advance(); // consume NODE
    const idTok = this.expect("IDENTIFIER", "for node name");
    if (!idTok) { this.synchronize(); return null; }

    this.skipNewlines();

    const node: ASTNode = {
      kind: "node",
      id: idTok.value,
      inputs: [],
      outputs: [],
      comments: [],
      loc: this.loc(startTok),
    };

    while (!this.check("END") && !this.check("EOF") && !this.isBlockStart()) {
      const innerComments = this.skipNewlinesAndComments();
      node.comments.push(...innerComments);

      if (this.check("END") || this.check("EOF") || this.isBlockStart()) break;

      const tok = this.peek();

      switch (tok.type) {
        case "IN": {
          this.advance();
          this.match("COLON");
          node.inputs = this.parsePortList();
          break;
        }
        case "OUT": {
          this.advance();
          this.match("COLON");
          node.outputs = this.parsePortList();
          break;
        }
        case "EFFECTS": {
          this.advance();
          this.match("COLON");
          node.effects = this.parseBracketedList();
          break;
        }
        case "CONTRACTS": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          node.contracts = this.parseContracts();
          break;
        }
        case "RECOVERY": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          node.recovery = this.parseRecoveryBlock();
          break;
        }
        case "CONFIDENCE": {
          this.advance();
          this.match("COLON");
          const numTok = this.expect("NUMBER", "for confidence value");
          if (numTok) node.confidence = parseFloat(numTok.value);
          break;
        }
        case "PURE": {
          this.advance();
          node.pure = true;
          break;
        }
        case "AXIOMS": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          node.axioms = this.parseAxiomsBlock();
          break;
        }
        case "ADVERSARIAL": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          node.adversarial = this.parseAdversarialBlock();
          break;
        }
        case "SUPERVISED": {
          this.advance();
          this.match("COLON");
          node.supervised = this.parseSupervisedBlock(tok);
          break;
        }
        default: {
          this.addError("E012", `unexpected token '${tok.value}' in node body`, tok);
          this.advance();
          break;
        }
      }
    }

    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close node block", this.peek(),
        `Add 'end' after node '${node.id}' declaration`);
    }

    return node;
  }

  // --- Hole ---

  private parseHole(): ASTHole | null {
    const startTok = this.advance(); // consume HOLE
    const idTok = this.expect("IDENTIFIER", "for hole name");
    if (!idTok) { this.synchronize(); return null; }

    this.skipNewlines();

    const hole: ASTHole = {
      kind: "hole",
      id: idTok.value,
      inputs: [],
      outputs: [],
      comments: [],
      loc: this.loc(startTok),
    };

    // Parse must_satisfy block or direct fields
    while (!this.check("END") && !this.check("EOF") && !this.isBlockStart()) {
      const innerComments = this.skipNewlinesAndComments();
      hole.comments.push(...innerComments);

      if (this.check("END") || this.check("EOF") || this.isBlockStart()) break;

      const tok = this.peek();

      switch (tok.type) {
        case "MUST_SATISFY": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          // Parse must_satisfy body (same fields as node: in, out, effects, contracts)
          while (!this.check("END") && !this.check("EOF") && !this.isBlockStart()) {
            this.skipNewlinesAndComments();
            if (this.check("END") || this.check("EOF") || this.isBlockStart()) break;
            const inner = this.peek();
            if (inner.type === "IN") {
              this.advance(); this.match("COLON");
              hole.inputs = this.parsePortList();
            } else if (inner.type === "OUT") {
              this.advance(); this.match("COLON");
              hole.outputs = this.parsePortList();
            } else if (inner.type === "EFFECTS") {
              this.advance(); this.match("COLON");
              hole.effects = this.parseBracketedList();
            } else if (inner.type === "CONTRACTS") {
              this.advance(); this.match("COLON");
              this.skipNewlines();
              hole.contracts = this.parseContracts();
            } else {
              break;
            }
          }
          break;
        }
        case "IN": {
          this.advance(); this.match("COLON");
          hole.inputs = this.parsePortList();
          break;
        }
        case "OUT": {
          this.advance(); this.match("COLON");
          hole.outputs = this.parsePortList();
          break;
        }
        case "EFFECTS": {
          this.advance(); this.match("COLON");
          hole.effects = this.parseBracketedList();
          break;
        }
        case "CONTRACTS": {
          this.advance(); this.match("COLON");
          this.skipNewlines();
          hole.contracts = this.parseContracts();
          break;
        }
        default: {
          this.addError("E012", `unexpected token '${tok.value}' in hole body`, tok);
          this.advance();
          break;
        }
      }
    }

    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close hole block", this.peek(),
        `Add 'end' after hole '${hole.id}' declaration`);
    }

    return hole;
  }

  // --- Intent ---

  private parseIntent(): ASTIntent | null {
    const startTok = this.advance(); // consume INTENT
    const idTok = this.expect("IDENTIFIER", "for intent name");
    if (!idTok) { this.synchronize(); return null; }

    this.skipNewlines();

    const intent: ASTIntent = {
      kind: "intent",
      id: idTok.value,
      inputs: [],
      outputs: [],
      ensure: [],
      comments: [],
      loc: this.loc(startTok),
    };

    while (!this.check("END") && !this.check("EOF") && !this.isBlockStart()) {
      const innerComments = this.skipNewlinesAndComments();
      intent.comments.push(...innerComments);

      if (this.check("END") || this.check("EOF") || this.isBlockStart()) break;

      const tok = this.peek();

      switch (tok.type) {
        case "IN": {
          this.advance(); this.match("COLON");
          intent.inputs = this.parsePortList();
          break;
        }
        case "OUT": {
          this.advance(); this.match("COLON");
          intent.outputs = this.parsePortList();
          break;
        }
        case "ENSURE": {
          this.advance();
          this.match("COLON");
          intent.ensure.push(this.parseExpression());
          break;
        }
        case "EFFECTS": {
          this.advance(); this.match("COLON");
          intent.effects = this.parseBracketedList();
          break;
        }
        case "CONSTRAINTS": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          intent.constraints = this.parseIntentConstraints();
          break;
        }
        case "CONFIDENCE": {
          this.advance();
          this.match("COLON");
          const numTok = this.expect("NUMBER", "for confidence value");
          if (numTok) intent.confidence = parseFloat(numTok.value);
          break;
        }
        default: {
          this.addError("E012", `unexpected token '${tok.value}' in intent body`, tok);
          this.advance();
          break;
        }
      }
    }

    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close intent block", this.peek(),
        `Add 'end' after intent '${intent.id}' declaration`);
    }

    return intent;
  }

  // --- Edge ---

  private parseEdge(): ASTEdge | null {
    const startTok = this.advance(); // consume EDGE

    const fromRef = this.parseDottedRef();
    if (!fromRef) return null;

    if (!this.match("ARROW")) {
      this.addError("E016", "expected '->' in edge declaration", this.peek());
      return null;
    }

    const toRef = this.parseDottedRef();
    if (!toRef) return null;

    return {
      from: fromRef,
      to: toRef,
      loc: this.loc(startTok),
    };
  }

  // --- State Type ---

  private parseStateType(): ASTStateType | null {
    const startTok = this.advance(); // consume STATETYPE
    const idTok = this.expect("IDENTIFIER", "for state type name");
    if (!idTok) { this.synchronize(); return null; }

    this.skipNewlines();

    const st: ASTStateType = {
      id: idTok.value,
      states: [],
      transitions: [],
      comments: [],
      loc: this.loc(startTok),
    };

    while (!this.check("END") && !this.check("EOF") && !this.isBlockStart()) {
      const innerComments = this.skipNewlinesAndComments();
      st.comments.push(...innerComments);

      if (this.check("END") || this.check("EOF") || this.isBlockStart()) break;

      const tok = this.peek();

      switch (tok.type) {
        case "STATES": {
          this.advance();
          this.match("COLON");
          st.states = this.parseBracketedList();
          break;
        }
        case "TRANSITIONS": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          st.transitions = this.parseTransitionBlock();
          break;
        }
        case "NEVER": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          st.never = this.parseTransitionBlock();
          break;
        }
        case "TERMINAL": {
          this.advance();
          this.match("COLON");
          st.terminal = this.parseBracketedList();
          break;
        }
        case "INITIAL": {
          this.advance();
          this.match("COLON");
          const initTok = this.expect("IDENTIFIER", "for initial state");
          if (initTok) st.initial = initTok.value;
          break;
        }
        default: {
          this.addError("E012", `unexpected token '${tok.value}' in statetype body`, tok);
          this.advance();
          break;
        }
      }
    }

    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close statetype block", this.peek());
    }

    return st;
  }

  // --- Scope ---

  private parseScope(): ASTScope | null {
    const startTok = this.advance(); // consume SCOPE
    const idTok = this.expect("IDENTIFIER", "for scope name");
    if (!idTok) { this.synchronize(); return null; }

    this.skipNewlines();

    const scope: ASTScope = {
      id: idTok.value,
      nodes: [],
      comments: [],
      loc: this.loc(startTok),
    };

    while (!this.check("END") && !this.check("EOF") && !this.isBlockStart()) {
      const innerComments = this.skipNewlinesAndComments();
      scope.comments.push(...innerComments);

      if (this.check("END") || this.check("EOF") || this.isBlockStart()) break;

      const tok = this.peek();

      switch (tok.type) {
        case "NODES": {
          this.advance();
          this.match("COLON");
          scope.nodes = this.parseBracketedList();
          break;
        }
        case "REQUIRES": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          scope.requires = this.parseBoundaryContracts();
          break;
        }
        case "PROVIDES": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          scope.provides = this.parseBoundaryContracts();
          break;
        }
        default: {
          this.addError("E012", `unexpected token '${tok.value}' in scope body`, tok);
          this.advance();
          break;
        }
      }
    }

    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close scope block", this.peek());
    }

    return scope;
  }

  // --- Template ---

  private parseTemplate(): ASTTemplate | null {
    const startTok = this.advance(); // consume TEMPLATE
    const idTok = this.expect("IDENTIFIER", "for template name");
    if (!idTok) { this.synchronize(); return null; }

    this.skipNewlines();

    const tmpl: ASTTemplate = {
      id: idTok.value,
      params: [],
      nodes: [],
      edges: [],
      comments: [],
      loc: this.loc(startTok),
    };

    while (!this.check("END") && !this.check("EOF")) {
      const innerComments = this.skipNewlinesAndComments();
      tmpl.comments.push(...innerComments);

      if (this.check("END") || this.check("EOF")) break;

      const tok = this.peek();

      switch (tok.type) {
        case "PARAMS": {
          this.advance();
          this.match("COLON");
          this.skipNewlines();
          tmpl.params = this.parseTemplateParams();
          break;
        }
        case "NODE": {
          const node = this.parseNode();
          if (node) tmpl.nodes.push(node);
          break;
        }
        case "EDGE": {
          const edge = this.parseEdge();
          if (edge) tmpl.edges.push(edge);
          break;
        }
        default: {
          // Could be template-level content, skip
          this.addError("E012", `unexpected token '${tok.value}' in template body`, tok);
          this.advance();
          break;
        }
      }
    }

    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close template block", this.peek());
    }

    return tmpl;
  }

  // --- Template Use ---

  private parseTemplateUse(): ASTTemplateUse | null {
    const startTok = this.advance(); // consume USE
    const templateTok = this.expect("IDENTIFIER", "for template name");
    if (!templateTok) { this.synchronize(); return null; }

    if (!this.match("AS")) {
      this.addError("E012", "expected 'as' after template name in use declaration", this.peek());
      this.synchronize();
      return null;
    }

    const instanceTok = this.expect("IDENTIFIER", "for instance name");
    if (!instanceTok) { this.synchronize(); return null; }

    this.skipNewlines();

    const bindings: ASTTemplateBinding[] = [];
    const comments: ASTComment[] = [];

    while (!this.check("END") && !this.check("EOF") && !this.isBlockStart()) {
      const innerComments = this.skipNewlinesAndComments();
      comments.push(...innerComments);

      if (this.check("END") || this.check("EOF") || this.isBlockStart()) break;

      // Parse binding: ParamName = value
      const paramTok = this.peek();
      if (paramTok.type === "IDENTIFIER") {
        this.advance();
        if (this.match("EQUALS")) {
          const valueParts: string[] = [];
          // Collect the rest of the line as the value
          while (!this.check("NEWLINE") && !this.check("EOF") && !this.check("END")) {
            const vTok = this.advance();
            valueParts.push(vTok.value);
          }
          bindings.push({
            param: paramTok.value,
            value: valueParts.join(" ").trim(),
            loc: this.loc(paramTok),
          });
        } else {
          this.addError("E012", "expected '=' in template binding", this.peek());
        }
      } else {
        this.addError("E012", `unexpected token '${paramTok.value}' in use body`, paramTok);
        this.advance();
      }
    }

    if (!this.match("END")) {
      this.addError("E010", "expected 'end' to close use block", this.peek());
    }

    return {
      id: instanceTok.value,
      templateId: templateTok.value,
      bindings,
      comments,
      loc: this.loc(startTok),
    };
  }

  // --- Helper parsers ---

  private isBlockStart(): boolean {
    const t = this.peekType();
    return t === "NODE" || t === "HOLE" || t === "INTENT" || t === "EDGE" ||
           t === "STATETYPE" || t === "SCOPE" || t === "TEMPLATE" || t === "USE";
  }

  private parseDottedRef(): string | null {
    const parts: string[] = [];
    const firstTok = this.peek();

    // Handle $-prefixed identifiers in templates
    if (this.check("DOLLAR")) {
      this.advance();
      const idTok = this.expect("IDENTIFIER", "after $");
      if (!idTok) return null;
      parts.push("$" + idTok.value);
    } else {
      const idTok = this.expect("IDENTIFIER", "for reference");
      if (!idTok) return null;
      parts.push(idTok.value);
    }

    while (this.match("DOT")) {
      const nextTok = this.peek();
      if (nextTok.type === "IDENTIFIER" || nextTok.type === "BOOLEAN") {
        this.advance();
        parts.push(nextTok.value);
      } else if (nextTok.type === "DOLLAR") {
        this.advance();
        const idTok = this.expect("IDENTIFIER", "after $");
        if (idTok) parts.push("$" + idTok.value);
      } else {
        this.addError("E013", "expected identifier after '.'", nextTok);
        break;
      }
    }

    return parts.join(".");
  }

  private parseBracketedList(): string[] {
    const items: string[] = [];
    if (!this.match("LBRACKET")) {
      // Single item without brackets
      const tok = this.peek();
      if (tok.type === "IDENTIFIER" || tok.type === "STRING") {
        this.advance();
        return [tok.value];
      }
      return [];
    }

    this.skipNewlines();
    while (!this.check("RBRACKET") && !this.check("EOF")) {
      this.skipNewlines();
      if (this.check("RBRACKET")) break;

      const tok = this.peek();
      if (tok.type === "DOLLAR") {
        // Template parameter reference like $storage_effect
        this.advance();
        const idTok = this.peek();
        if (idTok.type === "IDENTIFIER") {
          this.advance();
          items.push("$" + idTok.value);
        }
      } else if (tok.type === "IDENTIFIER" || tok.type === "STRING" || tok.type === "NUMBER") {
        this.advance();
        // Handle dotted identifiers like "database.read"
        let value = tok.value;
        while (this.check("DOT")) {
          this.advance();
          const next = this.peek();
          if (next.type === "IDENTIFIER") {
            this.advance();
            value += "." + next.value;
          } else {
            break;
          }
        }
        items.push(value);
      } else {
        this.addError("E012", `unexpected token '${tok.value}' in list`, tok);
        this.advance();
      }

      this.skipNewlines();
      this.match("COMMA");
      this.skipNewlines();
    }

    this.expect("RBRACKET", "to close list");
    return items;
  }

  private parsePortList(): ASTPort[] {
    const ports: ASTPort[] = [];

    // Ports can be on one line (comma-separated) or multiple lines
    while (true) {
      this.skipNewlines();

      const tok = this.peek();

      // Allow DOLLAR prefix for template params
      if (tok.type === "DOLLAR") {
        this.advance();
        const idTok = this.expect("IDENTIFIER", "after $");
        if (!idTok) break;
        const portName = "$" + idTok.value;
        this.expect("COLON", "after port name");
        const typeRef = this.parseTypeRef();
        ports.push({ name: portName, typeRef, loc: this.loc(tok) });
        if (!this.match("COMMA")) break;
        continue;
      }

      // Port name can be an identifier OR a keyword used as identifier
      // (e.g., "intent: SupportIntent" where "intent" is a keyword but used as port name)
      // We accept any word-like token followed by ":" as a port name
      if (this.isWordToken(tok) && this.lookaheadIsColon()) {
        this.advance();
        const portName = tok.value;
        this.expect("COLON", "after port name");
        const typeRef = this.parseTypeRef();
        ports.push({ name: portName, typeRef, loc: this.loc(tok) });
        if (!this.match("COMMA")) break;
        continue;
      }

      break;
    }

    return ports;
  }

  private isWordToken(tok: Token): boolean {
    return tok.type === "IDENTIFIER" || tok.type === "BOOLEAN" ||
      // Allow keywords used as port names
      tok.type === "INTENT" || tok.type === "CONFIDENCE" || tok.type === "RECOVERY" ||
      tok.type === "STATES" || tok.type === "SCOPE" || tok.type === "NODE" ||
      tok.type === "EDGE" || tok.type === "GRAPH" || tok.type === "TEMPLATE" ||
      tok.type === "PURE" || tok.type === "WHEN" || tok.type === "NEVER" ||
      tok.type === "INITIAL" || tok.type === "TERMINAL" ||
      tok.type === "IN" || tok.type === "OUT" || tok.type === "EFFECTS" ||
      tok.type === "CONTRACTS" || tok.type === "ENSURE" || tok.type === "CONSTRAINTS" ||
      tok.type === "PARAMS" || tok.type === "REQUIRES" || tok.type === "PROVIDES" ||
      tok.type === "NODES" || tok.type === "MUST_SATISFY" || tok.type === "USE" ||
      tok.type === "AS" || tok.type === "HOLE" || tok.type === "STATETYPE" ||
      tok.type === "SUPERVISED" || tok.type === "END" || tok.type === "PARTIAL" ||
      tok.type === "PRE" || tok.type === "POST" || tok.type === "ADVERSARIAL" ||
      tok.type === "BREAK_IF" || tok.type === "TRANSITIONS" || tok.type === "METADATA" ||
      tok.type === "DESCRIPTION" || tok.type === "SAFETY_LEVEL" || tok.type === "HUMAN_OVERSIGHT" ||
      tok.type === "SLA" || tok.type === "LATENCY_MS" || tok.type === "AVAILABILITY";
  }

  private lookaheadIsColon(): boolean {
    // Look ahead past the current token to see if the next non-trivial token is ':'
    const saved = this.pos;
    this.pos++;
    while (this.pos < this.tokens.length && this.tokens[this.pos].type === "NEWLINE") {
      this.pos++;
    }
    const isColon = this.pos < this.tokens.length && this.tokens[this.pos].type === "COLON";
    this.pos = saved;
    return isColon;
  }

  private parseTypeRef(): ASTTypeRef {
    const startTok = this.peek();
    let base = "";

    // Type name
    if (startTok.type === "IDENTIFIER" || startTok.type === "BOOLEAN") {
      this.advance();
      base = startTok.value;
    } else if (startTok.type === "DOLLAR") {
      this.advance();
      const idTok = this.expect("IDENTIFIER", "after $ in type");
      base = idTok ? "$" + idTok.value : "$unknown";
    } else {
      this.addError("E013", "expected type name", startTok);
      base = "Unknown";
    }

    // Generic: List<Record>, Map<String, Int>
    if (this.check("LT")) {
      this.advance();
      base += "<";
      let depth = 1;
      while (depth > 0 && !this.check("EOF")) {
        if (this.check("LT")) depth++;
        if (this.check("GT")) depth--;
        if (depth > 0) {
          base += this.peek().value;
          this.advance();
        }
      }
      this.match("GT");
      base += ">";
    }

    // Annotations
    const annotations = this.parseAnnotations();

    return {
      base,
      annotations,
      loc: this.loc(startTok),
    };
  }

  private parseAnnotations(): ASTAnnotation[] {
    const anns: ASTAnnotation[] = [];

    while (this.check("AT")) {
      const atTok = this.advance();
      const nameTok = this.peek();
      if (nameTok.type !== "IDENTIFIER") {
        this.addError("E013", "expected annotation name after @", nameTok);
        break;
      }
      this.advance();

      let args: string[] | undefined;

      // Check for parenthesized arguments: @constraint("= true"), @range(0, 100)
      if (this.check("LPAREN")) {
        this.advance();
        args = [];
        while (!this.check("RPAREN") && !this.check("EOF")) {
          const argTok = this.peek();
          if (argTok.type === "STRING" || argTok.type === "NUMBER" || argTok.type === "IDENTIFIER") {
            this.advance();
            args.push(argTok.value);
          } else {
            this.advance(); // skip
          }
          this.match("COMMA");
        }
        this.expect("RPAREN", "to close annotation arguments");
      }

      anns.push({
        name: nameTok.value,
        args,
        loc: this.loc(atTok),
      });
    }

    return anns;
  }

  private parseContracts(): ASTContract {
    const pre: ASTContractClause[] = [];
    const post: ASTContractClause[] = [];
    const invariants: ASTContractClause[] = [];
    const startTok = this.peek();

    while (true) {
      this.skipNewlines();
      const tok = this.peek();

      if (tok.type === "PRE") {
        this.advance();
        this.match("COLON");
        const expr = this.parseExpression();
        pre.push({ expr, loc: this.loc(tok) });
      } else if (tok.type === "POST") {
        this.advance();
        this.match("COLON");
        const expr = this.parseExpression();
        post.push({ expr, loc: this.loc(tok) });
      } else if (tok.type === "IDENTIFIER" && tok.value === "inv") {
        this.advance();
        this.match("COLON");
        const expr = this.parseExpression();
        invariants.push({ expr, loc: this.loc(tok) });
      } else {
        break;
      }
    }

    return { pre, post, invariants, loc: this.loc(startTok) };
  }

  private parseRecoveryBlock(): ASTRecoveryRule[] {
    const rules: ASTRecoveryRule[] = [];

    while (true) {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.type !== "IDENTIFIER") break;
      // Check it's not a field keyword
      if (this.isFieldKeyword(tok)) break;

      this.advance();

      if (!this.match("ARROW")) {
        // Not a recovery rule, put back conceptually
        this.addError("E016", "expected '->' in recovery rule", this.peek());
        break;
      }

      // Parse action: retry(3, exponential), fallback(unique: false), escalate("msg")
      const actionTok = this.expect("IDENTIFIER", "for recovery action");
      if (!actionTok) break;

      const args: string[] = [];
      if (this.match("LPAREN")) {
        while (!this.check("RPAREN") && !this.check("EOF")) {
          this.skipNewlines();
          if (this.check("RPAREN")) break;

          const argTok = this.peek();
          if (argTok.type === "STRING" || argTok.type === "NUMBER" || argTok.type === "IDENTIFIER" || argTok.type === "BOOLEAN") {
            this.advance();
            // Handle key: value pairs
            if (this.check("COLON")) {
              this.advance();
              const valTok = this.peek();
              if (valTok.type === "RPAREN" || valTok.type === "COMMA" || valTok.type === "NEWLINE" || valTok.type === "EOF") {
                // Empty value
                args.push(argTok.value);
              } else {
                this.advance();
                args.push(argTok.value + ": " + valTok.value);
              }
            } else {
              args.push(argTok.value);
            }
          } else {
            this.advance();
          }
          this.match("COMMA");
        }
        this.expect("RPAREN", "to close recovery action arguments");
      }

      rules.push({
        condition: tok.value,
        action: actionTok.value,
        args,
        loc: this.loc(tok),
      });
    }

    return rules;
  }

  private parseIndentedExpressionList(): string[] {
    const items: string[] = [];

    while (true) {
      this.skipNewlines();
      const tok = this.peek();
      // Stop when we see a keyword that starts a new section, END, or COMMENT
      if (tok.type === "END" || tok.type === "EOF" || tok.type === "COMMENT" ||
          this.isBlockStart() ||
          tok.type === "METADATA" || tok.type === "EFFECTS" || tok.type === "PARTIAL" ||
          tok.type === "PIPELINE_PROPERTIES") {
        break;
      }
      const expr = this.parseExpression();
      if (expr.length === 0) break; // safety: prevent infinite loop
      items.push(expr);
    }

    return items;
  }

  private parseAxiomsBlock(): string[] {
    const axioms: string[] = [];

    while (true) {
      this.skipNewlines();
      const tok = this.peek();
      // Axiom lines are just expressions, one per line
      // Stop when we see a keyword that starts a new section or END
      if (tok.type === "END" || tok.type === "EOF" || this.isBlockStart() ||
          tok.type === "CONTRACTS" || tok.type === "RECOVERY" || tok.type === "ADVERSARIAL" ||
          tok.type === "SUPERVISED" || tok.type === "PURE" || tok.type === "CONFIDENCE" ||
          tok.type === "EFFECTS" || tok.type === "IN" || tok.type === "OUT" ||
          tok.type === "AXIOMS") {
        break;
      }
      axioms.push(this.parseExpression());
    }

    return axioms;
  }

  private parseAdversarialBlock(): string[] {
    const breakIfs: string[] = [];

    while (true) {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.type === "BREAK_IF") {
        this.advance();
        this.match("COLON");
        breakIfs.push(this.parseExpression());
      } else {
        break;
      }
    }

    return breakIfs;
  }

  private parseSupervisedBlock(tok: Token): ASTSupervised {
    let reason = "";
    let status = "pending";

    // supervised: "reason" status
    if (this.check("STRING")) {
      reason = this.advance().value;
    }
    if (this.check("IDENTIFIER")) {
      status = this.advance().value;
    }

    return { reason, status, loc: this.loc(tok) };
  }

  private parseTransitionBlock(): ASTStateTransition[] {
    const transitions: ASTStateTransition[] = [];

    while (true) {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.type !== "IDENTIFIER") break;
      // Stop if this is a known keyword
      if (this.isStateTypeKeyword(tok)) break;

      this.advance();

      if (!this.match("ARROW")) {
        // Not a transition, probably next section
        this.pos--;
        break;
      }

      const toTok = this.expect("IDENTIFIER", "for transition target state");
      if (!toTok) break;

      let when: string | undefined;
      if (this.match("WHEN")) {
        const whenTok = this.expect("IDENTIFIER", "for transition condition");
        if (whenTok) when = whenTok.value;
      }

      transitions.push({
        from: tok.value,
        to: toTok.value,
        when,
        loc: this.loc(tok),
      });
    }

    return transitions;
  }

  private parseBoundaryContracts(): ASTBoundaryContract[] {
    const contracts: ASTBoundaryContract[] = [];

    while (true) {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.type !== "IDENTIFIER") break;
      if (this.isFieldKeyword(tok) || tok.value === "provides" || tok.value === "requires") break;

      this.advance();

      // name: (inputs) -> (outputs)
      this.match("COLON");

      // Parse function signature
      const inputs: ASTPort[] = [];
      const outputs: ASTPort[] = [];

      if (this.match("LPAREN")) {
        // Parse input ports
        while (!this.check("RPAREN") && !this.check("EOF")) {
          const portTok = this.peek();
          if (portTok.type === "IDENTIFIER") {
            this.advance();
            this.expect("COLON", "after port name");
            const typeRef = this.parseTypeRef();
            inputs.push({ name: portTok.value, typeRef, loc: this.loc(portTok) });
          }
          this.match("COMMA");
        }
        this.expect("RPAREN", "to close input ports");
      }

      this.match("ARROW");

      if (this.match("LPAREN")) {
        while (!this.check("RPAREN") && !this.check("EOF")) {
          const portTok = this.peek();
          if (portTok.type === "IDENTIFIER") {
            this.advance();
            this.expect("COLON", "after port name");
            const typeRef = this.parseTypeRef();
            outputs.push({ name: portTok.value, typeRef, loc: this.loc(portTok) });
          }
          this.match("COMMA");
        }
        this.expect("RPAREN", "to close output ports");
      }

      contracts.push({
        name: tok.value,
        inputs,
        outputs,
        loc: this.loc(tok),
      });
    }

    return contracts;
  }

  private parseTemplateParams(): ASTTemplateParam[] {
    const params: ASTTemplateParam[] = [];

    while (true) {
      this.skipNewlines();
      const tok = this.peek();

      if (tok.type === "DOLLAR") {
        this.advance();
        const nameTok = this.expect("IDENTIFIER", "for template parameter name");
        if (!nameTok) break;

        this.expect("COLON", "after parameter name");
        const kindTok = this.expect("IDENTIFIER", "for parameter kind (type, effect, value, node_id)");
        if (!kindTok) break;

        params.push({
          name: nameTok.value,
          kind: kindTok.value,
          loc: this.loc(tok),
        });
      } else {
        break;
      }
    }

    return params;
  }

  private parseIntentConstraints(): ASTIntentConstraints {
    const constraints: ASTIntentConstraints = {};

    while (true) {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.type !== "IDENTIFIER") break;
      if (this.isFieldKeyword(tok)) break;

      const key = tok.value;
      this.advance();
      this.match("COLON");

      const valTok = this.peek();
      if (key === "time_complexity") {
        constraints.time_complexity = this.parseExpression();
      } else if (key === "space_complexity") {
        constraints.space_complexity = this.parseExpression();
      } else if (key === "latency_ms" && valTok.type === "NUMBER") {
        this.advance();
        constraints.latency_ms = parseFloat(valTok.value);
      } else if (key === "deterministic") {
        if (valTok.type === "BOOLEAN") {
          this.advance();
          constraints.deterministic = valTok.value === "true";
        }
      } else {
        // Unknown constraint key, skip value
        this.parseExpression();
      }
    }

    return constraints;
  }

  private parseMetadata(): ASTMetadata {
    const meta: ASTMetadata = {};

    while (true) {
      this.skipNewlines();
      const tok = this.peek();

      if (tok.type === "DESCRIPTION") {
        this.advance();
        this.match("COLON");
        const strTok = this.peek();
        if (strTok.type === "STRING") {
          this.advance();
          meta.description = strTok.value;
        }
      } else if (tok.type === "SAFETY_LEVEL") {
        this.advance();
        this.match("COLON");
        const valTok = this.expect("IDENTIFIER", "for safety level");
        if (valTok) meta.safety_level = valTok.value;
      } else if (tok.type === "HUMAN_OVERSIGHT") {
        this.advance();
        this.match("COLON");
        const strTok = this.peek();
        if (strTok.type === "STRING") {
          this.advance();
          meta.human_oversight = strTok.value;
        }
      } else if (tok.type === "SLA") {
        this.advance();
        this.match("COLON");
        this.skipNewlines();
        // Parse SLA sub-fields
        while (true) {
          this.skipNewlines();
          const slaTok = this.peek();
          if (slaTok.type === "LATENCY_MS") {
            this.advance();
            this.match("COLON");
            const numTok = this.expect("NUMBER", "for latency value");
            if (numTok) meta.sla_latency_ms = parseFloat(numTok.value);
          } else if (slaTok.type === "AVAILABILITY") {
            this.advance();
            this.match("COLON");
            const numTok = this.expect("NUMBER", "for availability value");
            if (numTok) meta.sla_availability = parseFloat(numTok.value);
          } else {
            break;
          }
        }
      } else {
        break;
      }
    }

    return meta;
  }

  // Parse an expression (everything until newline, consuming tokens and joining them)
  private parseExpression(): string {
    const parts: string[] = [];
    let parenDepth = 0;

    while (!this.check("NEWLINE") && !this.check("EOF") && !this.check("COMMENT")) {
      const tok = this.peek();

      // Track parentheses depth — inside parens, consume everything
      if (tok.type === "LPAREN") parenDepth++;
      if (tok.type === "RPAREN") {
        if (parenDepth === 0) break;
        parenDepth--;
      }

      // Only stop at block-level keywords when NOT inside parens
      if (parenDepth === 0) {
        if (tok.type === "END") break;
        if (this.isBlockStart()) break;
      }

      this.advance();

      // Format the value based on token type
      if (tok.type === "STRING") {
        parts.push(`"${tok.value}"`);
      } else if (tok.type === "ARROW") {
        parts.push("->");
      } else {
        parts.push(tok.value);
      }
    }

    return parts.join(" ").trim();
  }

  private isFieldKeyword(tok: Token): boolean {
    return tok.type === "IN" || tok.type === "OUT" || tok.type === "EFFECTS" ||
           tok.type === "CONTRACTS" || tok.type === "RECOVERY" || tok.type === "CONFIDENCE" ||
           tok.type === "PURE" || tok.type === "ENSURE" || tok.type === "CONSTRAINTS" ||
           tok.type === "ADVERSARIAL" || tok.type === "SUPERVISED" ||
           tok.type === "STATES" || tok.type === "TRANSITIONS" || tok.type === "NEVER" ||
           tok.type === "TERMINAL" || tok.type === "INITIAL" ||
           tok.type === "NODES" || tok.type === "REQUIRES" || tok.type === "PROVIDES" ||
           tok.type === "PARAMS" || tok.type === "MUST_SATISFY" ||
           tok.type === "METADATA" || tok.type === "PARTIAL";
  }

  private isStateTypeKeyword(tok: Token): boolean {
    return tok.type === "NEVER" || tok.type === "TERMINAL" || tok.type === "INITIAL" ||
           tok.type === "STATES" || tok.type === "TRANSITIONS";
  }

  // --- AETHER Rule Validation ---

  private validateAetherRules(graph: ASTGraph): void {
    const nodeMap = new Map<string, ASTNode | ASTHole | ASTIntent>();
    for (const n of graph.nodes) {
      nodeMap.set(n.id, n);
    }

    for (const n of graph.nodes) {
      if (n.kind === "node") {
        this.validateNodeRules(n);
      }
    }

    // Validate edges reference real ports
    this.validateEdges(graph, nodeMap);

    // Validate graph effects cover node effects
    this.validateEffectCoverage(graph);
  }

  private validateNodeRules(node: ASTNode): void {
    // Rule 1: Effectful node without recovery
    const hasEffects = node.effects && node.effects.length > 0;
    const isPure = node.pure === true;

    if (hasEffects && !isPure && (!node.recovery || node.recovery.length === 0)) {
      const tok = { line: node.loc.line, column: node.loc.column, length: node.id.length, value: node.id, type: "NODE" as const };
      this.errors.push(
        makeError("E020", "effectful node missing recovery block", node.loc.line, node.loc.column,
          node.id.length, this.sourceLines,
          `node has effects [${node.effects!.join(", ")}] but no recovery block.\n` +
          `   |   Add a recovery block:\n` +
          `   |     recovery:\n` +
          `   |       timeout -> retry(3, exponential)\n` +
          `   |       error   -> fallback(default_value)`)
      );
    }

    // Rule 2: Low confidence without adversarial
    if (node.confidence !== undefined && node.confidence < 0.85 &&
        (!node.adversarial || node.adversarial.length === 0)) {
      this.errors.push(
        makeError("E021", "low-confidence node missing adversarial check", node.loc.line, node.loc.column,
          node.id.length, this.sourceLines,
          `node has confidence ${node.confidence} (< 0.85) but no adversarial block.\n` +
          `   |   Add an adversarial block:\n` +
          `   |     adversarial:\n` +
          `   |       break_if: <condition that should fail>`)
      );
    }

    // Rule 3: Contracts block must have at least one postcondition
    if (node.contracts && node.contracts.post.length === 0) {
      this.errors.push(
        makeError("E022", "contracts block missing postcondition", node.loc.line, node.loc.column,
          node.id.length, this.sourceLines,
          "Every contracts block should have at least one 'post:' clause")
      );
    }
  }

  private validateEdges(graph: ASTGraph, nodeMap: Map<string, ASTNode | ASTHole | ASTIntent>): void {
    for (const edge of graph.edges) {
      const [fromNode, fromPort] = edge.from.split(".");
      const [toNode, toPort] = edge.to.split(".");

      const srcNode = nodeMap.get(fromNode);
      const destNode = nodeMap.get(toNode);

      if (!srcNode) {
        this.errors.push(
          makeError("E023", `edge references nonexistent node '${fromNode}'`,
            edge.loc.line, edge.loc.column, edge.from.length, this.sourceLines)
        );
        continue;
      }
      if (!destNode) {
        this.errors.push(
          makeError("E023", `edge references nonexistent node '${toNode}'`,
            edge.loc.line, edge.loc.column, edge.to.length, this.sourceLines)
        );
        continue;
      }

      // Check port existence
      if (srcNode.kind === "node" || srcNode.kind === "intent") {
        const outPorts = srcNode.outputs.map(p => p.name);
        if (fromPort && !outPorts.includes(fromPort)) {
          this.errors.push(
            makeError("E024", `edge source '${edge.from}' references nonexistent output port '${fromPort}' on node '${fromNode}'`,
              edge.loc.line, edge.loc.column, edge.from.length, this.sourceLines,
              `Available output ports: ${outPorts.join(", ")}`)
          );
        }
      }

      if (destNode.kind === "node" || destNode.kind === "intent") {
        const inPorts = destNode.inputs.map(p => p.name);
        if (toPort && !inPorts.includes(toPort)) {
          this.errors.push(
            makeError("E025", `edge target '${edge.to}' references nonexistent input port '${toPort}' on node '${toNode}'`,
              edge.loc.line, edge.loc.column, edge.to.length, this.sourceLines,
              `Available input ports: ${inPorts.join(", ")}`)
          );
        }
      }
    }
  }

  private validateEffectCoverage(graph: ASTGraph): void {
    const graphEffects = new Set(graph.effects);
    for (const n of graph.nodes) {
      if (n.kind !== "node") continue;
      if (n.effects) {
        for (const eff of n.effects) {
          // Check if graph effects cover this node effect
          // "database" covers "database.read", "database.write"
          const covered = graphEffects.has(eff) ||
            [...graphEffects].some(ge => eff.startsWith(ge + ".") || ge.startsWith(eff + "."));
          if (!covered && graphEffects.size > 0) {
            this.warnings.push({
              message: `node '${n.id}' has effect '${eff}' not covered by graph effects [${graph.effects.join(", ")}]`,
              line: n.loc.line,
              column: n.loc.column,
              code: "E026",
              suggestion: `Add '${eff}' to graph effects list`,
            });
          }
        }
      }
    }
  }
}
