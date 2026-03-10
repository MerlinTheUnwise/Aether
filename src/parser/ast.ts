// AST node type definitions for the .aether surface syntax

export interface SourceLocation {
  line: number;    // 1-indexed
  column: number;  // 1-indexed
  length: number;
}

export interface ASTComment {
  text: string;
  loc: SourceLocation;
}

// --- Type references with annotations ---

export interface ASTTypeRef {
  base: string;                    // "String", "Bool", "Int", "List<Record>", etc.
  annotations: ASTAnnotation[];
  loc: SourceLocation;
}

export interface ASTAnnotation {
  name: string;                    // "@email", "@auth", etc. (without @)
  args?: string[];                 // For @constraint("= true"), @range(0, 100)
  loc: SourceLocation;
}

// --- Port declarations ---

export interface ASTPort {
  name: string;
  typeRef: ASTTypeRef;
  loc: SourceLocation;
}

// --- Contract blocks ---

export interface ASTContract {
  pre: ASTContractClause[];
  post: ASTContractClause[];
  invariants: ASTContractClause[];
  loc: SourceLocation;
}

export interface ASTContractClause {
  expr: string;
  loc: SourceLocation;
}

// --- Recovery blocks ---

export interface ASTRecoveryRule {
  condition: string;
  action: string;       // "retry", "fallback", "escalate", "respond", "report"
  args: string[];       // e.g. ["3", "exponential"] or ["\"user creation failed\""]
  loc: SourceLocation;
}

// --- Node ---

export interface ASTNode {
  kind: "node";
  id: string;
  inputs: ASTPort[];
  outputs: ASTPort[];
  effects?: string[];
  contracts?: ASTContract;
  recovery?: ASTRecoveryRule[];
  confidence?: number;
  pure?: boolean;
  adversarial?: string[];          // break_if expressions
  supervised?: ASTSupervised;
  comments: ASTComment[];
  loc: SourceLocation;
}

export interface ASTSupervised {
  reason: string;
  status: string;
  loc: SourceLocation;
}

// --- Hole ---

export interface ASTHole {
  kind: "hole";
  id: string;
  inputs: ASTPort[];
  outputs: ASTPort[];
  effects?: string[];
  contracts?: ASTContract;
  comments: ASTComment[];
  loc: SourceLocation;
}

// --- Intent ---

export interface ASTIntent {
  kind: "intent";
  id: string;
  inputs: ASTPort[];
  outputs: ASTPort[];
  ensure: string[];
  effects?: string[];
  constraints?: ASTIntentConstraints;
  confidence?: number;
  comments: ASTComment[];
  loc: SourceLocation;
}

export interface ASTIntentConstraints {
  time_complexity?: string;
  space_complexity?: string;
  latency_ms?: number;
  deterministic?: boolean;
}

// --- Edge ---

export interface ASTEdge {
  from: string;   // "node_id.port"
  to: string;     // "node_id.port"
  loc: SourceLocation;
}

// --- State Type ---

export interface ASTStateType {
  id: string;
  states: string[];
  transitions: ASTStateTransition[];
  never?: ASTStateTransition[];
  terminal?: string[];
  initial?: string;
  comments: ASTComment[];
  loc: SourceLocation;
}

export interface ASTStateTransition {
  from: string;
  to: string;
  when?: string;
  loc: SourceLocation;
}

// --- Scope ---

export interface ASTScope {
  id: string;
  nodes: string[];
  requires?: ASTBoundaryContract[];
  provides?: ASTBoundaryContract[];
  comments: ASTComment[];
  loc: SourceLocation;
}

export interface ASTBoundaryContract {
  name: string;
  inputs: ASTPort[];
  outputs: ASTPort[];
  effects?: string[];
  contracts?: ASTContract;
  confidence?: number;
  loc: SourceLocation;
}

// --- Template ---

export interface ASTTemplate {
  id: string;
  params: ASTTemplateParam[];
  nodes: ASTNode[];
  edges: ASTEdge[];
  comments: ASTComment[];
  loc: SourceLocation;
}

export interface ASTTemplateParam {
  name: string;    // $ParamName (without $)
  kind: string;    // "type", "effect", "value", "node_id"
  loc: SourceLocation;
}

// --- Template Use (Instantiation) ---

export interface ASTTemplateUse {
  id: string;              // instance id
  templateId: string;      // which template
  bindings: ASTTemplateBinding[];
  comments: ASTComment[];
  loc: SourceLocation;
}

export interface ASTTemplateBinding {
  param: string;
  value: string;
  loc: SourceLocation;
}

// --- Graph (top-level) ---

export interface ASTGraph {
  id: string;
  version: number;
  effects: string[];
  partial?: boolean;
  nodes: (ASTNode | ASTHole | ASTIntent)[];
  edges: ASTEdge[];
  stateTypes: ASTStateType[];
  scopes: ASTScope[];
  templates: ASTTemplate[];
  templateUses: ASTTemplateUse[];
  comments: ASTComment[];
  metadata?: ASTMetadata;
  loc: SourceLocation;
}

export interface ASTMetadata {
  description?: string;
  safety_level?: string;
  human_oversight?: string;
  sla_latency_ms?: number;
  sla_availability?: number;
}

// --- Root AST (a file can contain one graph) ---

export interface AetherAST {
  graph: ASTGraph;
  leadingComments: ASTComment[];
}
