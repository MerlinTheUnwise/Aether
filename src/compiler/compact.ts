/**
 * AETHER Compact Form Parser & Emitter
 *
 * Bidirectional conversion between structured JSON IR and token-efficient compact form.
 * Compact form syntax:
 *   G:graph_id vN eff[effect1,effect2]
 *   N:node_id (port:Type@annotation,...)->(port:Type,...) eff[effects] c:0.99
 *     C[pre:expr post:expr]
 *     R[condition→action]
 *     A[break_if_expr]
 *   E:from_node.port→to_node.port
 *   H:hole_id (port:Type,...)->(port:Type,...)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface TypeAnnotation {
  type: string;
  domain?: string;
  unit?: string;
  dimension?: string;
  format?: string;
  sensitivity?: string;
  range?: [number, number];
  constraint?: string;
}

interface Contract {
  pre?: string[];
  post?: string[];
  invariants?: string[];
}

interface RecoveryAction {
  action: string;
  params?: Record<string, unknown>;
}

interface AdversarialCheck {
  break_if: string[];
}

interface SupervisedBlock {
  reason: string;
  review_status?: "pending" | "approved" | "rejected";
}

interface AetherNode {
  id: string;
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  contract: Contract;
  confidence?: number;
  adversarial_check?: AdversarialCheck;
  effects: string[];
  pure?: boolean;
  recovery?: Record<string, RecoveryAction>;
  supervised?: SupervisedBlock;
}

interface AetherHole {
  id: string;
  hole: true;
  must_satisfy: {
    in: Record<string, TypeAnnotation>;
    out: Record<string, TypeAnnotation>;
    effects?: string[];
    contract?: Contract;
  };
}

interface IntentNode {
  id: string;
  intent: true;
  ensure: string[];
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  effects?: string[];
  constraints?: {
    time_complexity?: string;
    space_complexity?: string;
    latency_ms?: number;
    deterministic?: boolean;
  };
  confidence?: number;
}

interface AetherEdge {
  from: string;
  to: string;
}

interface AetherGraph {
  id: string;
  version: number;
  effects: string[];
  partial?: boolean;
  sla?: { latency_ms?: number; availability?: number };
  nodes: (AetherNode | AetherHole | IntentNode)[];
  edges: AetherEdge[];
  metadata?: {
    description?: string;
    safety_level?: string;
    human_oversight?: { required_when: string };
  };
}

// ─── Type Shorthand Maps ──────────────────────────────────────────────────────

const TYPE_EXPAND: Record<string, string> = {
  "Str": "String",
  "Bool": "Bool",
  "Int": "Int",
  "F64": "Float64",
  "Dec": "Decimal",
};

const TYPE_COMPACT: Record<string, string> = {
  "String": "Str",
  "Float64": "F64",
  "Decimal": "Dec",
};

const ANNOTATION_EXPAND: Record<string, { key: string; value: string }> = {
  "@email": { key: "format", value: "email" },
  "@pii": { key: "sensitivity", value: "pii" },
  "@uuid": { key: "format", value: "uuid_v4" },
  "@public": { key: "sensitivity", value: "public" },
  "@internal": { key: "sensitivity", value: "internal" },
};

// ─── Emitter: Structured → Compact ───────────────────────────────────────────

function isHole(node: AetherNode | AetherHole | IntentNode): node is AetherHole {
  return "hole" in node && (node as AetherHole).hole === true;
}

function isIntent(node: AetherNode | AetherHole | IntentNode): node is IntentNode {
  return "intent" in node && (node as IntentNode).intent === true;
}

function compactType(type: string): string {
  return TYPE_COMPACT[type] ?? type;
}

function compactAnnotations(ann: TypeAnnotation): string {
  const parts: string[] = [];
  if (ann.format === "email") parts.push("@email");
  else if (ann.format === "uuid_v4") parts.push("@uuid");
  else if (ann.format) parts.push(`@${ann.format}`);

  if (ann.sensitivity === "pii") parts.push("@pii");
  else if (ann.sensitivity === "public") parts.push("@public");
  else if (ann.sensitivity === "internal") parts.push("@internal");

  if (ann.domain) parts.push(`#${ann.domain}`);
  if (ann.unit) parts.push(`$${ann.unit}`);
  if (ann.dimension) parts.push(`~${ann.dimension}`);
  if (ann.range) parts.push(`[${ann.range[0]}..${ann.range[1]}]`);
  if (ann.constraint) parts.push(`{${ann.constraint}}`);
  return parts.join("");
}

function emitPorts(ports: Record<string, TypeAnnotation>): string {
  const entries = Object.entries(ports);
  if (entries.length === 0) return "";
  return entries
    .map(([name, ann]) => `${name}:${compactType(ann.type)}${compactAnnotations(ann)}`)
    .join(",");
}

function emitRecoveryAction(action: RecoveryAction): string {
  if (action.action === "retry" && action.params) {
    const count = action.params.attempts ?? action.params.count ?? 3;
    const backoff = action.params.backoff ?? "exponential";
    if (backoff === "exponential") return `retry${count}exp`;
    return `retry${count}`;
  }
  if (action.action === "escalate" && action.params?.message) {
    return `esc(${action.params.message})`;
  }
  if (action.action === "respond" && action.params) {
    return `rsp(${action.params.status ?? ""},${action.params.body ?? ""})`;
  }
  if (action.action === "fallback" && action.params) {
    const val = Object.values(action.params)[0];
    return `fb(${val})`;
  }
  // Generic
  return `${action.action}(${action.params ? JSON.stringify(action.params) : ""})`;
}

export function emitCompact(graph: AetherGraph): string {
  const lines: string[] = [];

  // Graph header
  let header = `G:${graph.id} v${graph.version}`;
  if (graph.effects.length > 0) {
    header += ` eff[${graph.effects.join(",")}]`;
  }
  if (graph.partial) header += " partial";
  lines.push(header);

  // Metadata
  if (graph.metadata) {
    if (graph.metadata.description) lines.push(`// ${graph.metadata.description}`);
    if (graph.metadata.safety_level) lines.push(`// safety_level:${graph.metadata.safety_level}`);
    if (graph.metadata.human_oversight) lines.push(`// human_oversight:${graph.metadata.human_oversight.required_when}`);
  }

  // SLA
  if (graph.sla) {
    const slaParts: string[] = [];
    if (graph.sla.latency_ms !== undefined) slaParts.push(`latency:${graph.sla.latency_ms}ms`);
    if (graph.sla.availability !== undefined) slaParts.push(`avail:${graph.sla.availability}%`);
    if (slaParts.length > 0) lines.push(`// sla:${slaParts.join(",")}`);
  }

  // Nodes
  for (const node of graph.nodes) {
    if (isHole(node)) {
      const inPorts = emitPorts(node.must_satisfy.in);
      const outPorts = emitPorts(node.must_satisfy.out);
      let holeLine = `H:${node.id} (${inPorts})->(${outPorts})`;
      if (node.must_satisfy.effects && node.must_satisfy.effects.length > 0) {
        holeLine += ` eff[${node.must_satisfy.effects.join(",")}]`;
      }
      lines.push(holeLine);
      if (node.must_satisfy.contract) {
        const c = node.must_satisfy.contract;
        if (c.pre && c.pre.length > 0) {
          lines.push(`  C[pre:${c.pre.join(" && ")}]`);
        }
        if (c.post && c.post.length > 0) {
          lines.push(`  C[post:${c.post.join(" && ")}]`);
        }
      }
    } else if (isIntent(node)) {
      const inPorts = emitPorts(node.in);
      const outPorts = emitPorts(node.out);
      let intentLine = `I:${node.id} (${inPorts})->(${outPorts})`;
      if (node.effects && node.effects.length > 0) {
        intentLine += ` eff[${node.effects.join(",")}]`;
      }
      if (node.confidence !== undefined) intentLine += ` c:${node.confidence}`;
      lines.push(intentLine);

      // Ensure clauses
      for (const clause of node.ensure) {
        lines.push(`  E[${clause}]`);
      }

      // Constraints
      if (node.constraints) {
        const parts: string[] = [];
        if (node.constraints.time_complexity) parts.push(`time:${node.constraints.time_complexity}`);
        if (node.constraints.space_complexity) parts.push(`space:${node.constraints.space_complexity}`);
        if (node.constraints.deterministic !== undefined) parts.push(`det:${node.constraints.deterministic}`);
        if (node.constraints.latency_ms !== undefined) parts.push(`lat:${node.constraints.latency_ms}`);
        if (parts.length > 0) lines.push(`  K[${parts.join(",")}]`);
      }
    } else {
      const inPorts = emitPorts(node.in);
      const outPorts = emitPorts(node.out);
      let nodeLine = `N:${node.id} (${inPorts})->(${outPorts})`;
      if (node.effects.length > 0) {
        nodeLine += ` eff[${node.effects.join(",")}]`;
      }
      if (node.pure === true) nodeLine += " pure";
      if (node.confidence !== undefined) nodeLine += ` c:${node.confidence}`;
      lines.push(nodeLine);

      // Contract
      if (node.contract.pre && node.contract.pre.length > 0) {
        lines.push(`  C[pre:${node.contract.pre.join(" && ")}]`);
      }
      if (node.contract.post && node.contract.post.length > 0) {
        lines.push(`  C[post:${node.contract.post.join(" && ")}]`);
      }
      if (node.contract.invariants && node.contract.invariants.length > 0) {
        lines.push(`  C[inv:${node.contract.invariants.join(" && ")}]`);
      }

      // Recovery
      if (node.recovery) {
        for (const [condition, action] of Object.entries(node.recovery)) {
          lines.push(`  R[${condition}→${emitRecoveryAction(action)}]`);
        }
      }

      // Adversarial
      if (node.adversarial_check) {
        for (const breakIf of node.adversarial_check.break_if) {
          lines.push(`  A[${breakIf}]`);
        }
      }

      // Supervised
      if (node.supervised) {
        lines.push(`  S[${node.supervised.reason}${node.supervised.review_status ? ` status:${node.supervised.review_status}` : ""}]`);
      }
    }
  }

  // Edges
  for (const edge of graph.edges) {
    lines.push(`E:${edge.from}→${edge.to}`);
  }

  return lines.join("\n") + "\n";
}

// ─── Parser: Compact → Structured ────────────────────────────────────────────

function expandType(shortType: string): string {
  return TYPE_EXPAND[shortType] ?? shortType;
}

function parsePorts(portStr: string): Record<string, TypeAnnotation> {
  const ports: Record<string, TypeAnnotation> = {};
  if (!portStr.trim()) return ports;

  // Split by comma but respect nested brackets
  const entries = smartSplit(portStr, ",");

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;

    const name = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    // Parse type and annotations
    const ann: TypeAnnotation = { type: "" };

    // Extract type (first word-like token, possibly with angle brackets)
    let typeEnd = 0;
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "<") depth++;
      else if (rest[i] === ">") depth--;
      else if (depth === 0 && (rest[i] === "@" || rest[i] === "#" || rest[i] === "$" || rest[i] === "~" || rest[i] === "[" || rest[i] === "{")) {
        break;
      }
      typeEnd = i + 1;
    }

    ann.type = expandType(rest.slice(0, typeEnd).trim());

    // Parse annotations after type
    const annStr = rest.slice(typeEnd);
    parseAnnotationString(annStr, ann);

    ports[name] = ann;
  }

  return ports;
}

function smartSplit(str: string, delimiter: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth--;

    if (ch === delimiter && depth === 0) {
      results.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) results.push(current);
  return results;
}

function parseAnnotationString(str: string, ann: TypeAnnotation): void {
  let i = 0;
  while (i < str.length) {
    if (str[i] === "@") {
      // Read annotation name
      i++;
      let name = "";
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        name += str[i];
        i++;
      }
      const fullAnnot = `@${name}`;
      if (ANNOTATION_EXPAND[fullAnnot]) {
        const { key, value } = ANNOTATION_EXPAND[fullAnnot];
        (ann as unknown as Record<string, unknown>)[key] = value;
      } else {
        // Generic format annotation
        ann.format = name;
      }
    } else if (str[i] === "#") {
      i++;
      let domain = "";
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        domain += str[i];
        i++;
      }
      ann.domain = domain;
    } else if (str[i] === "$") {
      i++;
      let unit = "";
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        unit += str[i];
        i++;
      }
      ann.unit = unit;
    } else if (str[i] === "~") {
      i++;
      let dim = "";
      while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
        dim += str[i];
        i++;
      }
      ann.dimension = dim;
    } else if (str[i] === "[") {
      // Range: [min..max]
      i++;
      let rangeStr = "";
      while (i < str.length && str[i] !== "]") {
        rangeStr += str[i];
        i++;
      }
      if (i < str.length) i++; // skip ]
      const parts = rangeStr.split("..");
      if (parts.length === 2) {
        ann.range = [parseFloat(parts[0]), parseFloat(parts[1])];
      }
    } else if (str[i] === "{") {
      // Constraint: {expr}
      i++;
      let constraint = "";
      let depth = 1;
      while (i < str.length && depth > 0) {
        if (str[i] === "{") depth++;
        if (str[i] === "}") { depth--; if (depth === 0) break; }
        constraint += str[i];
        i++;
      }
      if (i < str.length) i++; // skip }
      ann.constraint = constraint.trim();
    } else {
      i++;
    }
  }
}

function parseRecoveryAction(actionStr: string): RecoveryAction {
  // retry3exp → { action: "retry", params: { count: 3, backoff: "exponential" } }
  const retryMatch = actionStr.match(/^retry(\d+)(exp)?$/);
  if (retryMatch) {
    const params: Record<string, unknown> = { attempts: parseInt(retryMatch[1]) };
    if (retryMatch[2]) params.backoff = "exponential";
    return { action: "retry", params };
  }

  // esc(msg) → { action: "escalate", params: { message: msg } }
  const escMatch = actionStr.match(/^esc\((.+)\)$/);
  if (escMatch) {
    return { action: "escalate", params: { message: escMatch[1] } };
  }

  // rsp(code,body) → { action: "respond", params: { status: code, body: body } }
  const rspMatch = actionStr.match(/^rsp\(([^,]*),([^)]*)\)$/);
  if (rspMatch) {
    return { action: "respond", params: { status: rspMatch[1], body: rspMatch[2] } };
  }

  // fb(val) → { action: "fallback", params: { value: val } }
  const fbMatch = actionStr.match(/^fb\((.+)\)$/);
  if (fbMatch) {
    let val: unknown = fbMatch[1];
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (!isNaN(Number(val))) val = Number(val);
    return { action: "fallback", params: { value: val } };
  }

  // Generic: action(json)
  const genericMatch = actionStr.match(/^(\w+)\((.+)\)$/);
  if (genericMatch) {
    try {
      const params = JSON.parse(genericMatch[2]);
      return { action: genericMatch[1], params };
    } catch {
      return { action: genericMatch[1], params: { raw: genericMatch[2] } };
    }
  }

  return { action: actionStr };
}

export function parseCompact(source: string): AetherGraph {
  const lines = source.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error("Empty compact source");

  let graph: Partial<AetherGraph> = {
    nodes: [],
    edges: [],
    effects: [],
  };

  let currentNode: AetherNode | null = null;
  let currentHole: AetherHole | null = null;
  let currentIntent: IntentNode | null = null;

  function flushCurrent(): void {
    if (currentNode) (graph.nodes as any[]).push(currentNode);
    if (currentHole) (graph.nodes as any[]).push(currentHole);
    if (currentIntent) (graph.nodes as any[]).push(currentIntent);
    currentNode = null;
    currentHole = null;
    currentIntent = null;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Comment
    if (trimmed.startsWith("//")) {
      parseComment(trimmed, graph);
      continue;
    }

    // Graph header
    if (trimmed.startsWith("G:")) {
      parseGraphHeader(trimmed, graph);
      continue;
    }

    // Node
    if (trimmed.startsWith("N:")) {
      flushCurrent();
      currentNode = parseNodeLine(trimmed);
      continue;
    }

    // Hole
    if (trimmed.startsWith("H:")) {
      flushCurrent();
      currentHole = parseHoleLine(trimmed);
      continue;
    }

    // Intent Node
    if (trimmed.startsWith("I:")) {
      flushCurrent();
      currentIntent = parseIntentLine(trimmed);
      continue;
    }

    // Edge
    if (trimmed.startsWith("E:")) {
      flushCurrent();
      parseEdgeLine(trimmed, graph);
      continue;
    }

    // Indented blocks (belong to current node/hole/intent)
    if (trimmed.startsWith("C[")) {
      if (currentNode) parseContractBlock(trimmed, currentNode.contract);
      else if (currentHole) {
        if (!currentHole.must_satisfy.contract) currentHole.must_satisfy.contract = {};
        parseContractBlock(trimmed, currentHole.must_satisfy.contract);
      }
      continue;
    }

    if (trimmed.startsWith("R[")) {
      if (currentNode) parseRecoveryBlock(trimmed, currentNode);
      continue;
    }

    if (trimmed.startsWith("A[")) {
      if (currentNode) parseAdversarialBlock(trimmed, currentNode);
      continue;
    }

    if (trimmed.startsWith("S[")) {
      if (currentNode) parseSupervisedBlock(trimmed, currentNode);
      continue;
    }

    // Intent ensure clause
    if (trimmed.startsWith("E[") && trimmed.endsWith("]") && !trimmed.startsWith("E:")) {
      if (currentIntent) {
        currentIntent.ensure.push(trimmed.slice(2, -1));
      }
      continue;
    }

    // Intent constraints
    if (trimmed.startsWith("K[") && trimmed.endsWith("]")) {
      if (currentIntent) {
        const content = trimmed.slice(2, -1);
        const parts = content.split(",");
        if (!currentIntent.constraints) currentIntent.constraints = {};
        for (const part of parts) {
          const [key, val] = part.split(":");
          if (key === "time") currentIntent.constraints.time_complexity = val;
          if (key === "space") currentIntent.constraints.space_complexity = val;
          if (key === "det") currentIntent.constraints.deterministic = val === "true";
          if (key === "lat") currentIntent.constraints.latency_ms = parseFloat(val);
        }
      }
      continue;
    }
  }

  // Push last node/hole/intent
  flushCurrent();

  return graph as AetherGraph;
}

function parseGraphHeader(line: string, graph: Partial<AetherGraph>): void {
  // G:graph_id vN eff[effect1,effect2] partial
  const afterG = line.slice(2).trim();
  const parts = afterG.split(/\s+/);

  graph.id = parts[0];

  for (const part of parts.slice(1)) {
    if (part.startsWith("v") && /^\d+$/.test(part.slice(1))) {
      graph.version = parseInt(part.slice(1));
    } else if (part.startsWith("eff[") && part.endsWith("]")) {
      const effs = part.slice(4, -1);
      graph.effects = effs ? effs.split(",") : [];
    } else if (part === "partial") {
      graph.partial = true;
    }
  }

  if (!graph.version) graph.version = 1;
}

function parseComment(line: string, graph: Partial<AetherGraph>): void {
  const content = line.slice(2).trim();

  // Parse structured comments
  if (content.startsWith("safety_level:")) {
    if (!graph.metadata) graph.metadata = {};
    (graph.metadata as Record<string, unknown>).safety_level = content.slice("safety_level:".length);
  } else if (content.startsWith("human_oversight:")) {
    if (!graph.metadata) graph.metadata = {};
    (graph.metadata as Record<string, unknown>).human_oversight = { required_when: content.slice("human_oversight:".length) };
  } else if (content.startsWith("sla:")) {
    const slaParts = content.slice(4).split(",");
    const sla: Record<string, number> = {};
    for (const p of slaParts) {
      const [key, val] = p.split(":");
      if (key === "latency" && val.endsWith("ms")) sla.latency_ms = parseFloat(val);
      if (key === "avail" && val.endsWith("%")) sla.availability = parseFloat(val);
    }
    if (Object.keys(sla).length > 0) graph.sla = sla as AetherGraph["sla"];
  } else if (!graph.metadata?.description) {
    // First non-structured comment becomes description
    if (!graph.metadata) graph.metadata = {};
    (graph.metadata as Record<string, unknown>).description = content;
  }
}

function parseNodeLine(line: string): AetherNode {
  // N:node_id (port:Type@ann,...)->(port:Type,...) eff[effects] pure c:0.99
  const afterN = line.slice(2).trim();

  // Extract node ID (first token before space or paren)
  const idEnd = afterN.search(/[\s(]/);
  const id = idEnd > 0 ? afterN.slice(0, idEnd) : afterN;
  const rest = idEnd > 0 ? afterN.slice(idEnd).trim() : "";

  // Extract input/output ports
  const arrowIdx = rest.indexOf(")->(");
  let inPorts: Record<string, TypeAnnotation> = {};
  let outPorts: Record<string, TypeAnnotation> = {};
  let afterPorts = "";

  if (arrowIdx >= 0) {
    const inStr = rest.slice(1, arrowIdx); // skip opening (
    const afterArrow = rest.slice(arrowIdx + 4); // skip )->(
    const outEnd = afterArrow.indexOf(")");
    const outStr = outEnd >= 0 ? afterArrow.slice(0, outEnd) : afterArrow;
    afterPorts = outEnd >= 0 ? afterArrow.slice(outEnd + 1).trim() : "";

    inPorts = parsePorts(inStr);
    outPorts = parsePorts(outStr);
  }

  const node: AetherNode = {
    id,
    in: inPorts,
    out: outPorts,
    contract: {},
    effects: [],
  };

  // Parse remaining tokens
  const tokens = afterPorts.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith("eff[") && token.endsWith("]")) {
      const effs = token.slice(4, -1);
      node.effects = effs ? effs.split(",") : [];
    } else if (token === "pure") {
      node.pure = true;
    } else if (token.startsWith("c:")) {
      node.confidence = parseFloat(token.slice(2));
    }
  }

  return node;
}

function parseHoleLine(line: string): AetherHole {
  // H:hole_id (port:Type,...)->(port:Type,...) eff[effects]
  const afterH = line.slice(2).trim();
  const idEnd = afterH.search(/[\s(]/);
  const id = idEnd > 0 ? afterH.slice(0, idEnd) : afterH;
  const rest = idEnd > 0 ? afterH.slice(idEnd).trim() : "";

  const arrowIdx = rest.indexOf(")->(");
  let inPorts: Record<string, TypeAnnotation> = {};
  let outPorts: Record<string, TypeAnnotation> = {};
  let afterPorts = "";

  if (arrowIdx >= 0) {
    const inStr = rest.slice(1, arrowIdx);
    const afterArrow = rest.slice(arrowIdx + 4);
    const outEnd = afterArrow.indexOf(")");
    const outStr = outEnd >= 0 ? afterArrow.slice(0, outEnd) : afterArrow;
    afterPorts = outEnd >= 0 ? afterArrow.slice(outEnd + 1).trim() : "";

    inPorts = parsePorts(inStr);
    outPorts = parsePorts(outStr);
  }

  const hole: AetherHole = {
    id,
    hole: true,
    must_satisfy: { in: inPorts, out: outPorts },
  };

  // Parse effects
  const tokens = afterPorts.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith("eff[") && token.endsWith("]")) {
      const effs = token.slice(4, -1);
      hole.must_satisfy.effects = effs ? effs.split(",") : [];
    }
  }

  return hole;
}

function parseIntentLine(line: string): IntentNode {
  // I:node_id (port:Type,...)->(port:Type,...) eff[effects] c:0.99
  const afterI = line.slice(2).trim();
  const idEnd = afterI.search(/[\s(]/);
  const id = idEnd > 0 ? afterI.slice(0, idEnd) : afterI;
  const rest = idEnd > 0 ? afterI.slice(idEnd).trim() : "";

  const arrowIdx = rest.indexOf(")->(");
  let inPorts: Record<string, TypeAnnotation> = {};
  let outPorts: Record<string, TypeAnnotation> = {};
  let afterPorts = "";

  if (arrowIdx >= 0) {
    const inStr = rest.slice(1, arrowIdx);
    const afterArrow = rest.slice(arrowIdx + 4);
    const outEnd = afterArrow.indexOf(")");
    const outStr = outEnd >= 0 ? afterArrow.slice(0, outEnd) : afterArrow;
    afterPorts = outEnd >= 0 ? afterArrow.slice(outEnd + 1).trim() : "";

    inPorts = parsePorts(inStr);
    outPorts = parsePorts(outStr);
  }

  const intent: IntentNode = {
    id,
    intent: true,
    ensure: [],
    in: inPorts,
    out: outPorts,
  };

  const tokens = afterPorts.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (token.startsWith("eff[") && token.endsWith("]")) {
      const effs = token.slice(4, -1);
      intent.effects = effs ? effs.split(",") : [];
    } else if (token.startsWith("c:")) {
      intent.confidence = parseFloat(token.slice(2));
    }
  }

  return intent;
}

function parseEdgeLine(line: string, graph: Partial<AetherGraph>): void {
  // E:from_node.port→to_node.port  or  E:from_node.port->to_node.port
  const afterE = line.slice(2).trim();
  // Support both → and ->
  const arrowIdx = afterE.indexOf("→");
  const dashArrowIdx = afterE.indexOf("->");

  let from: string;
  let to: string;

  if (arrowIdx >= 0) {
    from = afterE.slice(0, arrowIdx).trim();
    to = afterE.slice(arrowIdx + 1).trim(); // → is a single char
  } else if (dashArrowIdx >= 0) {
    from = afterE.slice(0, dashArrowIdx).trim();
    to = afterE.slice(dashArrowIdx + 2).trim();
  } else {
    throw new Error(`Invalid edge line: ${line}`);
  }

  if (!graph.edges) graph.edges = [];
  graph.edges.push({ from, to });
}

function parseContractBlock(line: string, contract: Contract): void {
  // C[pre:expr && expr]  or  C[post:expr && expr]  or  C[inv:expr && expr]
  const content = line.slice(2, -1); // strip C[ and ]
  if (content.startsWith("pre:")) {
    const exprs = content.slice(4).split(" && ").map(s => s.trim()).filter(Boolean);
    contract.pre = (contract.pre ?? []).concat(exprs);
  } else if (content.startsWith("post:")) {
    const exprs = content.slice(5).split(" && ").map(s => s.trim()).filter(Boolean);
    contract.post = (contract.post ?? []).concat(exprs);
  } else if (content.startsWith("inv:")) {
    const exprs = content.slice(4).split(" && ").map(s => s.trim()).filter(Boolean);
    contract.invariants = (contract.invariants ?? []).concat(exprs);
  }
}

function parseRecoveryBlock(line: string, node: AetherNode): void {
  // R[condition→action]
  const content = line.slice(2, -1); // strip R[ and ]
  // Support both → and ->
  let arrowIdx = content.indexOf("→");
  let arrowLen = 1;
  if (arrowIdx < 0) {
    arrowIdx = content.indexOf("->");
    arrowLen = 2;
  }
  if (arrowIdx < 0) return;

  const condition = content.slice(0, arrowIdx).trim();
  const actionStr = content.slice(arrowIdx + arrowLen).trim();

  if (!node.recovery) node.recovery = {};
  node.recovery[condition] = parseRecoveryAction(actionStr);
}

function parseAdversarialBlock(line: string, node: AetherNode): void {
  // A[break_if_expr]
  const content = line.slice(2, -1).trim(); // strip A[ and ]
  if (!node.adversarial_check) node.adversarial_check = { break_if: [] };
  node.adversarial_check.break_if.push(content);
}

function parseSupervisedBlock(line: string, node: AetherNode): void {
  // S[reason status:pending]
  const content = line.slice(2, -1).trim();
  const statusMatch = content.match(/\s+status:(\w+)$/);
  const reason = statusMatch ? content.slice(0, statusMatch.index).trim() : content;
  node.supervised = { reason };
  if (statusMatch) {
    node.supervised.review_status = statusMatch[1] as "pending" | "approved" | "rejected";
  }
}
