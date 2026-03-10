// AST → .aether text (pretty printer)

import type {
  AetherAST, ASTGraph, ASTNode, ASTHole, ASTIntent, ASTEdge,
  ASTStateType, ASTScope, ASTTemplate, ASTTemplateUse,
  ASTPort, ASTTypeRef, ASTContract, ASTRecoveryRule,
  ASTStateTransition, ASTBoundaryContract, ASTComment,
} from "./ast.js";

export function emit(ast: AetherAST): string {
  const lines: string[] = [];

  // Leading comments
  for (const c of ast.leadingComments) {
    lines.push(c.text);
  }
  if (ast.leadingComments.length > 0) {
    lines.push("");
  }

  emitGraph(ast.graph, lines);

  return lines.join("\n") + "\n";
}

function emitGraph(graph: ASTGraph, lines: string[]) {
  lines.push(`graph ${graph.id} v${graph.version}`);

  if (graph.effects.length > 0) {
    lines.push(`  effects: [${graph.effects.join(", ")}]`);
  } else {
    lines.push(`  effects: []`);
  }

  if (graph.partial) {
    lines.push(`  partial`);
  }

  if (graph.pipelineProperties && graph.pipelineProperties.length > 0) {
    lines.push("");
    lines.push("  pipeline_properties:");
    for (const p of graph.pipelineProperties) {
      lines.push(`    ${p}`);
    }
  }

  if (graph.metadata) {
    lines.push("");
    lines.push("  metadata:");
    if (graph.metadata.description) lines.push(`    description: "${graph.metadata.description}"`);
    if (graph.metadata.safety_level) lines.push(`    safety_level: ${graph.metadata.safety_level}`);
    if (graph.metadata.human_oversight) lines.push(`    human_oversight: "${graph.metadata.human_oversight}"`);
    if (graph.metadata.sla_latency_ms !== undefined || graph.metadata.sla_availability !== undefined) {
      lines.push("    sla:");
      if (graph.metadata.sla_latency_ms !== undefined) lines.push(`      latency_ms: ${graph.metadata.sla_latency_ms}`);
      if (graph.metadata.sla_availability !== undefined) lines.push(`      availability: ${graph.metadata.sla_availability}`);
    }
  }

  // State types
  for (const st of graph.stateTypes) {
    lines.push("");
    emitStateType(st, lines, "  ");
  }

  // Templates
  for (const tmpl of graph.templates) {
    lines.push("");
    emitTemplate(tmpl, lines, "  ");
  }

  // Template uses
  for (const use of graph.templateUses) {
    lines.push("");
    emitTemplateUse(use, lines, "  ");
  }

  // Scopes
  for (const sc of graph.scopes) {
    lines.push("");
    emitScope(sc, lines, "  ");
  }

  // Nodes
  const nodes = graph.nodes;
  const edges = graph.edges;

  if (nodes.length > 0) {
    lines.push("");
    lines.push("  // ─── Nodes ───");
  }

  for (const n of nodes) {
    lines.push("");
    if (n.kind === "node") emitNode(n, lines, "  ");
    else if (n.kind === "hole") emitHole(n, lines, "  ");
    else if (n.kind === "intent") emitIntent(n, lines, "  ");
  }

  // Edges
  if (edges.length > 0) {
    lines.push("");
    lines.push("  // ─── Edges ───");
    lines.push("");
    for (const e of edges) {
      emitEdge(e, lines, "  ");
    }
  }

  lines.push("");
  lines.push("end // graph");
}

function emitNode(node: ASTNode, lines: string[], indent: string) {
  // Leading comments
  for (const c of node.comments) {
    lines.push(`${indent}${c.text}`);
  }

  lines.push(`${indent}node ${node.id}`);

  if (node.inputs.length > 0) {
    lines.push(`${indent}  in:  ${formatPortList(node.inputs)}`);
  }
  if (node.outputs.length > 0) {
    lines.push(`${indent}  out: ${formatPortList(node.outputs)}`);
  }

  if (node.effects && node.effects.length > 0) {
    lines.push(`${indent}  effects: [${node.effects.join(", ")}]`);
  }

  if (node.axioms && node.axioms.length > 0) {
    lines.push(`${indent}  axioms:`);
    for (const a of node.axioms) {
      lines.push(`${indent}    ${a}`);
    }
  }

  if (node.contracts) {
    emitContracts(node.contracts, lines, indent + "  ");
  }

  if (node.recovery && node.recovery.length > 0) {
    lines.push(`${indent}  recovery:`);
    for (const r of node.recovery) {
      const args = r.args.length > 0 ? `(${r.args.join(", ")})` : "";
      lines.push(`${indent}    ${r.condition} -> ${r.action}${args}`);
    }
  }

  if (node.adversarial && node.adversarial.length > 0) {
    lines.push(`${indent}  adversarial:`);
    for (const b of node.adversarial) {
      lines.push(`${indent}    break_if: ${b}`);
    }
  }

  if (node.supervised) {
    const sup = node.supervised;
    lines.push(`${indent}  supervised: "${sup.reason}" ${sup.status}`);
  }

  if (node.pure) {
    lines.push(`${indent}  pure`);
  }

  if (node.confidence !== undefined) {
    lines.push(`${indent}  confidence: ${node.confidence}`);
  }

  lines.push(`${indent}end`);
}

function emitHole(hole: ASTHole, lines: string[], indent: string) {
  lines.push(`${indent}hole ${hole.id}`);
  lines.push(`${indent}  must_satisfy:`);

  if (hole.inputs.length > 0) {
    lines.push(`${indent}    in:  ${formatPortList(hole.inputs)}`);
  }
  if (hole.outputs.length > 0) {
    lines.push(`${indent}    out: ${formatPortList(hole.outputs)}`);
  }
  if (hole.effects && hole.effects.length > 0) {
    lines.push(`${indent}    effects: [${hole.effects.join(", ")}]`);
  }
  if (hole.contracts) {
    emitContracts(hole.contracts, lines, indent + "    ");
  }

  lines.push(`${indent}end`);
}

function emitIntent(intent: ASTIntent, lines: string[], indent: string) {
  lines.push(`${indent}intent ${intent.id}`);

  if (intent.inputs.length > 0) {
    lines.push(`${indent}  in:  ${formatPortList(intent.inputs)}`);
  }
  if (intent.outputs.length > 0) {
    lines.push(`${indent}  out: ${formatPortList(intent.outputs)}`);
  }
  if (intent.effects && intent.effects.length > 0) {
    lines.push(`${indent}  effects: [${intent.effects.join(", ")}]`);
  }

  for (const e of intent.ensure) {
    lines.push(`${indent}  ensure: ${e}`);
  }

  if (intent.constraints) {
    lines.push(`${indent}  constraints:`);
    const c = intent.constraints;
    if (c.time_complexity) lines.push(`${indent}    time_complexity: ${c.time_complexity}`);
    if (c.space_complexity) lines.push(`${indent}    space_complexity: ${c.space_complexity}`);
    if (c.latency_ms !== undefined) lines.push(`${indent}    latency_ms: ${c.latency_ms}`);
    if (c.deterministic !== undefined) lines.push(`${indent}    deterministic: ${c.deterministic}`);
  }

  if (intent.confidence !== undefined) {
    lines.push(`${indent}  confidence: ${intent.confidence}`);
  }

  lines.push(`${indent}end`);
}

function emitEdge(edge: ASTEdge, lines: string[], indent: string) {
  lines.push(`${indent}edge ${edge.from} -> ${edge.to}`);
}

function emitStateType(st: ASTStateType, lines: string[], indent: string) {
  lines.push(`${indent}statetype ${st.id}`);
  lines.push(`${indent}  states: [${st.states.join(", ")}]`);

  if (st.transitions.length > 0) {
    lines.push(`${indent}  transitions:`);
    for (const t of st.transitions) {
      const when = t.when ? ` when ${t.when}` : "";
      lines.push(`${indent}    ${t.from} -> ${t.to}${when}`);
    }
  }

  if (st.never && st.never.length > 0) {
    lines.push(`${indent}  never:`);
    for (const t of st.never) {
      lines.push(`${indent}    ${t.from} -> ${t.to}`);
    }
  }

  if (st.terminal && st.terminal.length > 0) {
    lines.push(`${indent}  terminal: [${st.terminal.join(", ")}]`);
  }

  if (st.initial) {
    lines.push(`${indent}  initial: ${st.initial}`);
  }

  lines.push(`${indent}end`);
}

function emitScope(sc: ASTScope, lines: string[], indent: string) {
  lines.push(`${indent}scope ${sc.id}`);
  lines.push(`${indent}  nodes: [${sc.nodes.join(", ")}]`);

  if (sc.requires && sc.requires.length > 0) {
    lines.push(`${indent}  requires:`);
    for (const bc of sc.requires) {
      emitBoundaryContract(bc, lines, indent + "    ");
    }
  }

  if (sc.provides && sc.provides.length > 0) {
    lines.push(`${indent}  provides:`);
    for (const bc of sc.provides) {
      emitBoundaryContract(bc, lines, indent + "    ");
    }
  }

  lines.push(`${indent}end`);
}

function emitBoundaryContract(bc: ASTBoundaryContract, lines: string[], indent: string) {
  const inParts = bc.inputs.map(p => `${p.name}: ${formatTypeRef(p.typeRef)}`).join(", ");
  const outParts = bc.outputs.map(p => `${p.name}: ${formatTypeRef(p.typeRef)}`).join(", ");
  lines.push(`${indent}${bc.name}: (${inParts}) -> (${outParts})`);
}

function emitTemplate(tmpl: ASTTemplate, lines: string[], indent: string) {
  lines.push(`${indent}template ${tmpl.id}`);

  if (tmpl.params.length > 0) {
    lines.push(`${indent}  params:`);
    for (const p of tmpl.params) {
      lines.push(`${indent}    $${p.name}: ${p.kind}`);
    }
  }

  for (const node of tmpl.nodes) {
    lines.push("");
    emitNode(node, lines, indent + "  ");
  }

  if (tmpl.edges.length > 0) {
    lines.push("");
    for (const e of tmpl.edges) {
      emitEdge(e, lines, indent + "  ");
    }
  }

  lines.push(`${indent}end`);
}

function emitTemplateUse(use: ASTTemplateUse, lines: string[], indent: string) {
  lines.push(`${indent}use ${use.templateId} as ${use.id}`);

  for (const b of use.bindings) {
    lines.push(`${indent}  ${b.param} = ${b.value}`);
  }

  lines.push(`${indent}end`);
}

function emitContracts(contracts: ASTContract, lines: string[], indent: string) {
  if (contracts.pre.length === 0 && contracts.post.length === 0 && contracts.invariants.length === 0) {
    return;
  }

  lines.push(`${indent}contracts:`);
  for (const p of contracts.pre) {
    lines.push(`${indent}  pre:  ${p.expr}`);
  }
  for (const p of contracts.post) {
    lines.push(`${indent}  post: ${p.expr}`);
  }
  for (const p of contracts.invariants) {
    lines.push(`${indent}  inv:  ${p.expr}`);
  }
}

function formatPortList(ports: ASTPort[]): string {
  return ports.map(p => `${p.name}: ${formatTypeRef(p.typeRef)}`).join(", ");
}

function formatTypeRef(ref: ASTTypeRef): string {
  let s = ref.base;
  for (const ann of ref.annotations) {
    if (ann.args && ann.args.length > 0) {
      s += ` @${ann.name}(${ann.args.map(a => /^\d/.test(a) ? a : `"${a}"`).join(", ")})`;
    } else {
      s += ` @${ann.name}`;
    }
  }
  return s;
}
