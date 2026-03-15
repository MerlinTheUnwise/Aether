// AST ↔ AetherGraph (IR) bidirectional conversion

import type {
  AetherGraph, AetherNode, AetherHole, AetherEdge, IntentNode,
  TypeAnnotation, Contract, StateType, StateTransition,
  Scope, BoundaryContract, AetherTemplate, AetherTemplateInstance,
  AetherTemplateParameter,
} from "../ir/validator.js";
import type {
  AetherAST, ASTGraph, ASTNode, ASTHole as ASTHoleType, ASTIntent, ASTEdge as ASTEdgeType,
  ASTPort, ASTTypeRef, ASTContract, ASTRecoveryRule,
  ASTStateType, ASTStateTransition, ASTScope, ASTBoundaryContract,
  ASTTemplate, ASTTemplateUse, ASTComment,
} from "./ast.js";
import type { ParseError } from "./errors.js";
import { tokenize } from "./lexer.js";
import { parse } from "./parser.js";
import { emit } from "./emitter.js";
import { expandAnnotations, typeAnnotationToAnnotations } from "./annotations.js";

// Parse .aether source → AetherGraph (JSON IR)
export function aetherToIR(source: string): { graph: AetherGraph | null; errors: ParseError[] } {
  const { tokens, errors: lexErrors } = tokenize(source);
  if (lexErrors.length > 0) {
    const sourceLines = source.split("\n");
    return {
      graph: null,
      errors: lexErrors.map(e => ({
        message: e.message,
        line: e.line,
        column: e.column,
        length: 1,
        context: sourceLines[e.line - 1] ?? "",
        pointer: " ".repeat(Math.max(0, e.column - 1)) + "^",
        code: e.code,
      })),
    };
  }

  const sourceLines = source.split("\n");
  const { ast, errors: parseErrors, warnings } = parse(tokens, sourceLines);

  if (parseErrors.length > 0 || !ast) {
    return { graph: null, errors: parseErrors };
  }

  // Convert AST → IR
  const graph = astToIR(ast.graph);
  return { graph, errors: [] };
}

// AetherGraph (JSON IR) → .aether source (pretty-printed)
export function irToAether(graph: AetherGraph): string {
  const ast = irToAST(graph);
  return emit(ast);
}

// --- AST → IR conversion ---

function astToIR(astGraph: ASTGraph): AetherGraph {
  const graph: AetherGraph = {
    id: astGraph.id,
    version: astGraph.version,
    effects: astGraph.effects,
    nodes: [],
    edges: [],
  };

  if (astGraph.partial) {
    graph.partial = true;
  }

  // Metadata
  if (astGraph.metadata) {
    const md = astGraph.metadata;
    graph.metadata = {};
    if (md.description) graph.metadata.description = md.description;
    if (md.safety_level) (graph.metadata as any).safety_level = md.safety_level;
    if (md.human_oversight) (graph.metadata as any).human_oversight = { required_when: md.human_oversight };
    if (md.sla_latency_ms !== undefined || md.sla_availability !== undefined) {
      graph.sla = {};
      if (md.sla_latency_ms !== undefined) graph.sla.latency_ms = md.sla_latency_ms;
      if (md.sla_availability !== undefined) graph.sla.availability = md.sla_availability;
    }
  }

  // Pipeline properties
  if (astGraph.pipelineProperties && astGraph.pipelineProperties.length > 0) {
    (graph as any).pipeline_properties = astGraph.pipelineProperties;
  }

  // Nodes
  for (const n of astGraph.nodes) {
    if (n.kind === "node") {
      graph.nodes.push(astNodeToIR(n));
    } else if (n.kind === "hole") {
      graph.nodes.push(astHoleToIR(n));
    } else if (n.kind === "intent") {
      graph.nodes.push(astIntentToIR(n));
    }
  }

  // Edges
  for (const e of astGraph.edges) {
    graph.edges.push({ from: e.from, to: e.to });
  }

  // State types
  if (astGraph.stateTypes.length > 0) {
    graph.state_types = astGraph.stateTypes.map(astStateTypeToIR);
  }

  // Scopes
  if (astGraph.scopes.length > 0) {
    graph.scopes = astGraph.scopes.map(astScopeToIR);
  }

  // Templates
  if (astGraph.templates.length > 0) {
    graph.templates = astGraph.templates.map(astTemplateToIR);
  }

  // Template instances
  if (astGraph.templateUses.length > 0) {
    graph.template_instances = astGraph.templateUses.map(astTemplateUseToIR);
  }

  return graph;
}

function astNodeToIR(node: ASTNode): AetherNode {
  const irNode: AetherNode = {
    id: node.id,
    in: portsToIR(node.inputs),
    out: portsToIR(node.outputs),
    contract: contractToIR(node.contracts),
    effects: node.effects ?? [],
  };

  if (node.pure) irNode.pure = true;
  if (node.confidence !== undefined) irNode.confidence = node.confidence;

  if (node.recovery && node.recovery.length > 0) {
    irNode.recovery = {};
    for (const r of node.recovery) {
      irNode.recovery[r.condition] = recoveryToIR(r);
    }
  }

  if (node.axioms && node.axioms.length > 0) {
    irNode.axioms = node.axioms;
  }

  if (node.adversarial && node.adversarial.length > 0) {
    irNode.adversarial_check = { break_if: node.adversarial };
  }

  if (node.supervised) {
    irNode.supervised = {
      reason: node.supervised.reason,
      review_status: node.supervised.status as "pending" | "approved" | "rejected",
    };
  }

  if (node.mcp) {
    (irNode as any).mcp = {
      server: node.mcp.server,
      tool: node.mcp.tool,
    };
    if (node.mcp.params && Object.keys(node.mcp.params).length > 0) {
      (irNode as any).mcp.params = node.mcp.params;
    }
  }

  return irNode;
}

function astHoleToIR(hole: ASTHoleType): AetherHole {
  const irHole: AetherHole = {
    id: hole.id,
    hole: true,
    must_satisfy: {
      in: portsToIR(hole.inputs),
      out: portsToIR(hole.outputs),
    },
  };

  if (hole.effects && hole.effects.length > 0) {
    irHole.must_satisfy.effects = hole.effects;
  }

  if (hole.contracts) {
    irHole.must_satisfy.contract = contractToIR(hole.contracts);
  }

  return irHole;
}

function astIntentToIR(intent: ASTIntent): IntentNode {
  const irIntent: IntentNode = {
    id: intent.id,
    intent: true,
    ensure: intent.ensure,
    in: portsToIR(intent.inputs),
    out: portsToIR(intent.outputs),
  };

  if (intent.effects && intent.effects.length > 0) {
    irIntent.effects = intent.effects;
  }

  if (intent.constraints) {
    irIntent.constraints = {};
    const c = intent.constraints;
    if (c.time_complexity) irIntent.constraints.time_complexity = c.time_complexity;
    if (c.space_complexity) irIntent.constraints.space_complexity = c.space_complexity;
    if (c.latency_ms !== undefined) irIntent.constraints.latency_ms = c.latency_ms;
    if (c.deterministic !== undefined) irIntent.constraints.deterministic = c.deterministic;
  }

  if (intent.confidence !== undefined) {
    irIntent.confidence = intent.confidence;
  }

  return irIntent;
}

function portsToIR(ports: ASTPort[]): Record<string, TypeAnnotation> {
  const result: Record<string, TypeAnnotation> = {};
  for (const p of ports) {
    result[p.name] = typeRefToIR(p.typeRef);
  }
  return result;
}

function typeRefToIR(ref: ASTTypeRef): TypeAnnotation {
  const ta: TypeAnnotation = { type: ref.base };
  const { typeAnnotation } = expandAnnotations(ref.base, ref.annotations);
  Object.assign(ta, typeAnnotation);
  return ta;
}

function contractToIR(contracts?: ASTContract): Contract {
  if (!contracts) return { post: [] };

  const result: Contract = {};
  if (contracts.pre.length > 0) result.pre = contracts.pre.map(c => c.expr);
  if (contracts.post.length > 0) result.post = contracts.post.map(c => c.expr);
  if (contracts.invariants.length > 0) result.invariants = contracts.invariants.map(c => c.expr);
  // Ensure at least an empty post array if the contract has nothing
  if (!result.pre && !result.post && !result.invariants) {
    result.post = [];
  }
  return result;
}

function recoveryToIR(r: ASTRecoveryRule): any {
  const action: any = { action: r.action };

  // Parse args into params
  if (r.args.length > 0) {
    const params: Record<string, any> = {};

    // Detect key: value pairs vs positional args
    const hasKeyValue = r.args.some(a => a.includes(": "));

    if (hasKeyValue) {
      for (const arg of r.args) {
        const [key, ...rest] = arg.split(": ");
        const value = rest.join(": ");
        params[key.trim()] = parseRecoveryValue(value.trim());
      }
    } else {
      // Map positional args based on action type
      switch (r.action) {
        case "retry":
          if (r.args[0]) params.attempts = parseInt(r.args[0], 10);
          if (r.args[1]) params.backoff = r.args[1];
          break;
        case "fallback":
          if (r.args[0]) {
            const val = r.args[0].replace(/^"(.*)"$/, "$1");
            params[val] = parseRecoveryValue(val);
          }
          break;
        case "escalate":
          if (r.args[0]) params.message = r.args[0].replace(/^"(.*)"$/, "$1");
          break;
        case "respond":
          if (r.args[0]) params.status = parseInt(r.args[0], 10);
          if (r.args[1]) params.body = r.args[1].replace(/^"(.*)"$/, "$1");
          break;
        default:
          // Generic: put args as numbered params
          r.args.forEach((a, i) => { params[`arg${i}`] = a; });
      }
    }

    action.params = params;
  }

  return action;
}

function parseRecoveryValue(val: string): any {
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!isNaN(num)) return num;
  return val;
}

function astStateTypeToIR(st: ASTStateType): StateType {
  const irSt: StateType = {
    id: st.id,
    states: st.states,
    transitions: st.transitions.map(t => ({
      from: t.from,
      to: t.to,
      when: t.when ?? "",
    })),
  };

  if (st.never || st.terminal || st.initial) {
    irSt.invariants = {};
    if (st.never && st.never.length > 0) {
      irSt.invariants.never = st.never.map(t => ({ from: t.from, to: t.to }));
    }
    if (st.terminal && st.terminal.length > 0) {
      irSt.invariants.terminal = st.terminal;
    }
    if (st.initial) {
      irSt.invariants.initial = st.initial;
    }
  }

  return irSt;
}

function astScopeToIR(sc: ASTScope): Scope {
  const irScope: Scope = {
    id: sc.id,
    nodes: sc.nodes,
  };

  if (sc.requires || sc.provides) {
    irScope.boundary_contracts = {};
    if (sc.requires) {
      irScope.boundary_contracts.requires = sc.requires.map(boundaryContractToIR);
    }
    if (sc.provides) {
      irScope.boundary_contracts.provides = sc.provides.map(boundaryContractToIR);
    }
  }

  return irScope;
}

function boundaryContractToIR(bc: ASTBoundaryContract): BoundaryContract {
  return {
    name: bc.name,
    in: portsToIR(bc.inputs),
    out: portsToIR(bc.outputs),
  };
}

function astTemplateToIR(tmpl: ASTTemplate): AetherTemplate {
  return {
    id: tmpl.id,
    parameters: tmpl.params.map(p => ({
      name: p.name,
      kind: p.kind as "type" | "value" | "effect" | "node_id",
    })),
    nodes: tmpl.nodes.map(astNodeToIR),
    edges: tmpl.edges.map(e => ({ from: e.from, to: e.to })),
  };
}

function astTemplateUseToIR(use: ASTTemplateUse): AetherTemplateInstance {
  const bindings: Record<string, unknown> = {};
  for (const b of use.bindings) {
    bindings[b.param] = b.value;
  }
  return {
    id: use.id,
    template: use.templateId,
    bindings,
  };
}

// --- IR → AST conversion ---

function irToAST(graph: AetherGraph): AetherAST {
  const astGraph = irGraphToAST(graph);

  // Generate description comment
  const leadingComments: ASTComment[] = [];
  if (graph.metadata?.description) {
    leadingComments.push({
      text: `// ${graph.metadata.description}`,
      loc: { line: 1, column: 1, length: 0 },
    });
    leadingComments.push({
      text: `//`,
      loc: { line: 2, column: 1, length: 0 },
    });
  }

  return { graph: astGraph, leadingComments };
}

function irGraphToAST(graph: AetherGraph): ASTGraph {
  const loc = { line: 1, column: 1, length: 0 };

  const astGraph: ASTGraph = {
    id: graph.id,
    version: graph.version,
    effects: graph.effects,
    nodes: [],
    edges: [],
    stateTypes: [],
    scopes: [],
    templates: [],
    templateUses: [],
    comments: [],
    loc,
  };

  if (graph.partial) astGraph.partial = true;

  // Pipeline properties
  if ((graph as any).pipeline_properties && (graph as any).pipeline_properties.length > 0) {
    astGraph.pipelineProperties = (graph as any).pipeline_properties;
  }

  // Metadata
  if (graph.metadata || graph.sla) {
    astGraph.metadata = {};
    if (graph.metadata?.description) astGraph.metadata.description = graph.metadata.description;
    if ((graph.metadata as any)?.safety_level) astGraph.metadata.safety_level = (graph.metadata as any).safety_level;
    if ((graph.metadata as any)?.human_oversight?.required_when) {
      astGraph.metadata.human_oversight = (graph.metadata as any).human_oversight.required_when;
    }
    if (graph.sla?.latency_ms !== undefined) astGraph.metadata.sla_latency_ms = graph.sla.latency_ms;
    if (graph.sla?.availability !== undefined) astGraph.metadata.sla_availability = graph.sla.availability;
  }

  // Nodes
  for (const n of graph.nodes) {
    if ("hole" in n && n.hole) {
      astGraph.nodes.push(irHoleToAST(n as AetherHole));
    } else if ("intent" in n && (n as any).intent) {
      astGraph.nodes.push(irIntentToAST(n as IntentNode));
    } else {
      astGraph.nodes.push(irNodeToAST(n as AetherNode));
    }
  }

  // Edges
  for (const e of graph.edges) {
    astGraph.edges.push({ from: e.from, to: e.to, loc });
  }

  // State types
  if (graph.state_types) {
    astGraph.stateTypes = graph.state_types.map(st => irStateTypeToAST(st));
  }

  // Scopes
  if (graph.scopes) {
    astGraph.scopes = graph.scopes.map(sc => irScopeToAST(sc));
  }

  // Templates
  if (graph.templates) {
    astGraph.templates = graph.templates.map(t => irTemplateToAST(t));
  }

  // Template instances
  if (graph.template_instances) {
    astGraph.templateUses = graph.template_instances.map(ti => irTemplateInstanceToAST(ti));
  }

  return astGraph;
}

function irNodeToAST(node: AetherNode): ASTNode {
  const loc = { line: 0, column: 0, length: 0 };

  const astNode: ASTNode = {
    kind: "node",
    id: node.id,
    inputs: irPortsToAST(node.in),
    outputs: irPortsToAST(node.out),
    comments: [],
    loc,
  };

  if (node.effects && node.effects.length > 0) {
    astNode.effects = node.effects;
  }

  if (node.contract) {
    astNode.contracts = irContractToAST(node.contract);
  }

  if (node.recovery) {
    astNode.recovery = [];
    for (const [condition, action] of Object.entries(node.recovery)) {
      astNode.recovery.push(irRecoveryToAST(condition, action));
    }
  }

  if (node.confidence !== undefined) {
    astNode.confidence = node.confidence;
  }

  if (node.pure) {
    astNode.pure = true;
  }

  if (node.axioms && node.axioms.length > 0) {
    astNode.axioms = node.axioms;
  }

  if (node.adversarial_check?.break_if) {
    astNode.adversarial = node.adversarial_check.break_if;
  }

  if (node.supervised) {
    astNode.supervised = {
      reason: node.supervised.reason,
      status: node.supervised.review_status ?? "pending",
      loc,
    };
  }

  if ((node as any).mcp) {
    const m = (node as any).mcp;
    astNode.mcp = {
      server: m.server,
      tool: m.tool,
      params: m.params,
      loc,
    };
  }

  return astNode;
}

function irHoleToAST(hole: AetherHole): ASTHoleType {
  const loc = { line: 0, column: 0, length: 0 };

  const astHole: ASTHoleType = {
    kind: "hole",
    id: hole.id,
    inputs: irPortsToAST(hole.must_satisfy.in),
    outputs: irPortsToAST(hole.must_satisfy.out),
    comments: [],
    loc,
  };

  if (hole.must_satisfy.effects) {
    astHole.effects = hole.must_satisfy.effects;
  }

  if (hole.must_satisfy.contract) {
    astHole.contracts = irContractToAST(hole.must_satisfy.contract);
  }

  return astHole;
}

function irIntentToAST(intent: IntentNode): ASTIntent {
  const loc = { line: 0, column: 0, length: 0 };

  const astIntent: ASTIntent = {
    kind: "intent",
    id: intent.id,
    inputs: irPortsToAST(intent.in),
    outputs: irPortsToAST(intent.out),
    ensure: intent.ensure ?? [],
    comments: [],
    loc,
  };

  if (intent.effects) {
    astIntent.effects = intent.effects;
  }

  if (intent.constraints) {
    astIntent.constraints = {};
    if (intent.constraints.time_complexity) astIntent.constraints.time_complexity = intent.constraints.time_complexity;
    if (intent.constraints.space_complexity) astIntent.constraints.space_complexity = intent.constraints.space_complexity;
    if (intent.constraints.latency_ms !== undefined) astIntent.constraints.latency_ms = intent.constraints.latency_ms;
    if (intent.constraints.deterministic !== undefined) astIntent.constraints.deterministic = intent.constraints.deterministic;
  }

  if (intent.confidence !== undefined) {
    astIntent.confidence = intent.confidence;
  }

  return astIntent;
}

function irPortsToAST(ports: Record<string, TypeAnnotation>): ASTPort[] {
  const loc = { line: 0, column: 0, length: 0 };
  return Object.entries(ports).map(([name, ta]) => ({
    name,
    typeRef: irTypeToAST(ta),
    loc,
  }));
}

function irTypeToAST(ta: TypeAnnotation): ASTTypeRef {
  const loc = { line: 0, column: 0, length: 0 };
  const annotations = typeAnnotationToAnnotations(ta).map(a => {
    // Parse annotation string back to AST
    const match = a.match(/^@(\w+)(?:\((.+)\))?$/);
    if (!match) return { name: a.slice(1), loc };

    const name = match[1];
    let args: string[] | undefined;
    if (match[2]) {
      args = match[2].split(",").map(s => s.trim().replace(/^"(.*)"$/, "$1"));
    }
    return { name, args, loc };
  });

  return { base: ta.type, annotations, loc };
}

function irContractToAST(contract: Contract): ASTContract {
  const loc = { line: 0, column: 0, length: 0 };
  return {
    pre: (contract.pre ?? []).map(e => ({ expr: e, loc })),
    post: (contract.post ?? []).map(e => ({ expr: e, loc })),
    invariants: (contract.invariants ?? []).map(e => ({ expr: e, loc })),
    loc,
  };
}

function irRecoveryToAST(condition: string, action: any): ASTRecoveryRule {
  const loc = { line: 0, column: 0, length: 0 };
  const args: string[] = [];

  if (action.params) {
    const params = action.params;
    switch (action.action) {
      case "retry":
        if (params.attempts !== undefined) args.push(String(params.attempts));
        if (params.backoff) args.push(params.backoff);
        break;
      case "fallback":
        for (const [k, v] of Object.entries(params)) {
          let val: string;
          if (typeof v === "object" && v !== null) {
            // Quote JSON objects to avoid parser issues with braces
            val = `"${JSON.stringify(v).replace(/"/g, '\\"')}"`;
          } else {
            val = String(v);
          }
          if (val !== "" && val !== "undefined") {
            args.push(`${k}: ${val}`);
          }
        }
        break;
      case "escalate":
        if (params.message) args.push(`"${params.message}"`);
        if (params.max_retries !== undefined) args.push(`max_retries: ${params.max_retries}`);
        break;
      case "respond":
        if (params.status !== undefined) args.push(String(params.status));
        if (params.body) args.push(`"${params.body}"`);
        break;
      default:
        for (const [k, v] of Object.entries(params)) {
          let val: string;
          if (typeof v === "object" && v !== null) {
            val = `"${JSON.stringify(v).replace(/"/g, '\\"')}"`;
          } else {
            val = String(v);
          }
          args.push(`${k}: ${val}`);
        }
    }
  }

  return {
    condition,
    action: action.action,
    args,
    loc,
  };
}

function irStateTypeToAST(st: StateType): ASTStateType {
  const loc = { line: 0, column: 0, length: 0 };

  return {
    id: st.id,
    states: st.states,
    transitions: st.transitions.map(t => ({
      from: t.from,
      to: t.to,
      when: t.when,
      loc,
    })),
    never: st.invariants?.never?.map(t => ({ from: t.from, to: t.to, loc })),
    terminal: st.invariants?.terminal,
    initial: st.invariants?.initial,
    comments: [],
    loc,
  };
}

function irScopeToAST(sc: Scope): ASTScope {
  const loc = { line: 0, column: 0, length: 0 };

  return {
    id: sc.id,
    nodes: sc.nodes,
    requires: sc.boundary_contracts?.requires?.map(bc => irBoundaryContractToAST(bc)),
    provides: sc.boundary_contracts?.provides?.map(bc => irBoundaryContractToAST(bc)),
    comments: [],
    loc,
  };
}

function irBoundaryContractToAST(bc: BoundaryContract): ASTBoundaryContract {
  const loc = { line: 0, column: 0, length: 0 };
  return {
    name: bc.name,
    inputs: irPortsToAST(bc.in),
    outputs: irPortsToAST(bc.out),
    loc,
  };
}

function irTemplateToAST(tmpl: AetherTemplate): ASTTemplate {
  const loc = { line: 0, column: 0, length: 0 };
  return {
    id: tmpl.id,
    params: tmpl.parameters.map(p => ({
      name: p.name,
      kind: p.kind,
      loc,
    })),
    nodes: tmpl.nodes.map(irNodeToAST),
    edges: tmpl.edges.map(e => ({ from: e.from, to: e.to, loc })),
    comments: [],
    loc,
  };
}

function irTemplateInstanceToAST(ti: AetherTemplateInstance): ASTTemplateUse {
  const loc = { line: 0, column: 0, length: 0 };
  return {
    id: ti.id,
    templateId: ti.template,
    bindings: Object.entries(ti.bindings).map(([k, v]) => ({
      param: k,
      value: String(v),
      loc,
    })),
    comments: [],
    loc,
  };
}
