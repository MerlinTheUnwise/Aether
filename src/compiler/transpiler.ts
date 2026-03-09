/**
 * AETHER-IR → JavaScript Transpiler
 * Generates a runnable Node.js module from an AetherGraph.
 *
 * Strategy:
 *   1. Topological sort by data dependency
 *   2. Group into parallel waves (Promise.all)
 *   3. Each node → async function with contracts + confidence + effects
 *   4. Recovery → try/catch wrappers
 *   5. Confidence propagation: output = node_confidence × min(input_confidences)
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

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

interface AetherNode {
  id: string;
  in: Record<string, TypeAnnotation>;
  out: Record<string, TypeAnnotation>;
  contract: { pre?: string[]; post?: string[]; invariants?: string[] };
  confidence?: number;
  adversarial_check?: { break_if: string[] };
  effects: string[];
  pure?: boolean;
  recovery?: Record<string, { action: string; params?: Record<string, unknown> }>;
  supervised?: { reason: string; review_status?: string };
}

interface AetherEdge {
  from: string; // "node_id.port_name"
  to: string;   // "node_id.port_name"
}

interface AetherGraph {
  id: string;
  version: number;
  effects: string[];
  sla?: { latency_ms?: number; availability?: number };
  nodes: AetherNode[];
  edges: AetherEdge[];
  metadata?: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Default placeholder value for a type annotation */
function defaultValueForType(ann: TypeAnnotation): string {
  const t = ann.type;
  if (t === "Bool") return "false";
  if (t === "Int" || t === "Float64" || t === "Float32" || t === "Decimal") return "0";
  if (t === "String") return '""';
  if (t.startsWith("List<")) return "[]";
  if (t.startsWith("Map<")) return "{}";
  // Custom/domain types → empty object
  return "{}";
}

// ─── Contract → JavaScript ────────────────────────────────────────────────────

function contractToJS(expr: string): string | null {
  let js = expr;

  // Detect unsupported patterns
  const unsupported = [
    "forall(", "exists(", "is_subset_of", "intersection(", "not_in",
    "has_duplicates", "is_distinct", "in allowed_actions", "modifies",
    "deletes", "never(", "size in ", "<=>"
  ];
  for (const pat of unsupported) {
    if (js.includes(pat)) return null;
  }

  // Unicode → JS
  js = js.replace(/∧/g, "&&");
  js = js.replace(/∨/g, "||");
  js = js.replace(/¬/g, "!");
  js = js.replace(/≠/g, "!==");
  js = js.replace(/≤/g, "<=");
  js = js.replace(/≥/g, ">=");

  // "in [" set membership → .includes() — only simple array form
  const inArrayMatch = js.match(/^(\S+)\s+in\s+\[(.+)]$/);
  if (inArrayMatch) {
    js = `[${inArrayMatch[2]}].includes(${inArrayMatch[1]})`;
  }

  // "∈" → .includes()
  const memberMatch = js.match(/^(\S+)\s*∈\s*(\S+)$/);
  if (memberMatch) {
    js = `${memberMatch[2]}.includes(${memberMatch[1]})`;
  }

  // Standalone "=" that isn't "==" or "!=" or "<=" or ">=" → "==="
  js = js.replace(/(?<![=!<>])=(?!=)/g, "===");

  return js;
}

// ─── Topological Waves ────────────────────────────────────────────────────────

interface Wave {
  level: number;
  nodeIds: string[];
}

function computeWaves(nodes: AetherNode[], edges: AetherEdge[]): Wave[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to && nodeIds.has(from.nodeId) && nodeIds.has(to.nodeId) && from.nodeId !== to.nodeId) {
      const neighbors = adj.get(from.nodeId)!;
      if (!neighbors.has(to.nodeId)) {
        neighbors.add(to.nodeId);
        inDegree.set(to.nodeId, (inDegree.get(to.nodeId) ?? 0) + 1);
      }
    }
  }

  const waves: Wave[] = [];
  const remaining = new Set(nodeIds);
  let level = 0;

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        wave.push(id);
      }
    }

    if (wave.length === 0) {
      throw new Error("Cycle detected in graph — cannot topologically sort");
    }

    for (const id of wave) {
      remaining.delete(id);
      for (const neighbor of adj.get(id) ?? []) {
        inDegree.set(neighbor, (inDegree.get(neighbor) ?? 0) - 1);
      }
    }

    waves.push({ level, nodeIds: wave });
    level++;
  }

  return waves;
}

// ─── Code Generation ──────────────────────────────────────────────────────────

function generateNodeFunction(node: AetherNode): string {
  const fnName = safeId(node.id);
  const confidence = node.confidence ?? 1.0;
  const effects = JSON.stringify(node.effects);

  // Build output placeholder
  const outEntries = Object.entries(node.out).map(
    ([port, ann]) => `    ${safeId(port)}: ${defaultValueForType(ann)}`
  );
  const resultObj = outEntries.length > 0
    ? `{\n${outEntries.join(",\n")}\n  }`
    : "{}";

  // Pre-condition checks
  const preChecks: string[] = [];
  for (const pre of node.contract.pre ?? []) {
    const js = contractToJS(pre);
    if (js) {
      preChecks.push(
        `  if (!(${js})) throw new ContractViolation("${node.id}", "pre", ${JSON.stringify(pre)});`
      );
    } else {
      preChecks.push(`  // CONTRACT PRE: ${pre} (not enforced at runtime — verified by Z3)`);
    }
  }

  // Post-condition checks
  const postChecks: string[] = [];
  for (const post of node.contract.post ?? []) {
    const js = contractToJS(post);
    if (js) {
      postChecks.push(
        `  if (!(${js})) throw new ContractViolation("${node.id}", "post", ${JSON.stringify(post)});`
      );
    } else {
      postChecks.push(`  // CONTRACT POST: ${post} (not enforced at runtime — verified by Z3)`);
    }
  }

  // Invariant comments
  const invariantComments: string[] = [];
  for (const inv of node.contract.invariants ?? []) {
    invariantComments.push(`  // INVARIANT: ${inv}`);
  }

  const lines: string[] = [];
  lines.push(`async function ${fnName}(inputs) {`);

  // Destructure inputs
  const inPorts = Object.keys(node.in).map(safeId);
  if (inPorts.length > 0) {
    lines.push(`  const { ${inPorts.join(", ")} } = inputs;`);
    lines.push("");
  }

  // Preconditions
  if (preChecks.length > 0) {
    lines.push("  // Preconditions");
    lines.push(...preChecks);
    lines.push("");
  }

  // Invariants
  if (invariantComments.length > 0) {
    lines.push(...invariantComments);
    lines.push("");
  }

  // Implementation stub
  lines.push("  // Implementation stub — Phase 0 returns typed placeholders");
  lines.push(`  const result = ${resultObj};`);
  lines.push("");

  // Postconditions
  if (postChecks.length > 0) {
    lines.push("  // Postconditions");
    lines.push(...postChecks);
    lines.push("");
  }

  // Confidence propagation
  lines.push("  // Confidence propagation");
  lines.push(`  const inputConfidences = Object.values(inputs.__confidences || {});`);
  lines.push(`  const minInputConfidence = inputConfidences.length > 0 ? Math.min(...inputConfidences) : 1.0;`);
  lines.push(`  const outputConfidence = ${confidence} * minInputConfidence;`);
  lines.push("");

  lines.push(`  return {`);
  lines.push(`    value: result,`);
  lines.push(`    confidence: outputConfidence,`);
  lines.push(`    effects: ${effects},`);
  lines.push(`  };`);
  lines.push(`}`);

  return lines.join("\n");
}

function generateRecoveryWrapper(node: AetherNode): string | null {
  if (!node.recovery || Object.keys(node.recovery).length === 0) return null;

  const fnName = safeId(node.id);
  const entries = Object.entries(node.recovery);

  const cases: string[] = [];
  for (const [errorType, recovery] of entries) {
    const params = JSON.stringify(recovery.params ?? {});
    cases.push(`    if (error.type === ${JSON.stringify(errorType)}) {`);

    switch (recovery.action) {
      case "retry": {
        const attempts = (recovery.params as Record<string, unknown>)?.attempts ?? 3;
        cases.push(`      // Retry strategy: ${attempts} attempts`);
        cases.push(`      for (let i = 0; i < ${attempts}; i++) {`);
        cases.push(`        try { return await ${fnName}(inputs); } catch (e) { if (i === ${Number(attempts) - 1}) throw e; }`);
        cases.push(`      }`);
        break;
      }
      case "fallback":
        cases.push(`      // Fallback: ${params}`);
        cases.push(`      return { value: ${params}, confidence: 0.5, effects: [] };`);
        break;
      case "escalate":
        cases.push(`      // Escalate to human`);
        cases.push(`      throw Object.assign(new Error("ESCALATE: " + ${JSON.stringify((recovery.params as Record<string, unknown>)?.message ?? errorType)}), { type: "escalation" });`);
        break;
      case "respond":
        cases.push(`      // Respond with error`);
        cases.push(`      return { value: ${params}, confidence: 0.0, effects: [] };`);
        break;
      default:
        cases.push(`      // Recovery action: ${recovery.action} ${params}`);
        cases.push(`      throw error;`);
    }

    cases.push(`    }`);
  }

  const lines: string[] = [];
  lines.push(`async function ${fnName}_with_recovery(inputs) {`);
  lines.push(`  try {`);
  lines.push(`    return await ${fnName}(inputs);`);
  lines.push(`  } catch (error) {`);
  lines.push(...cases);
  lines.push(`    throw error; // unhandled → propagate`);
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join("\n");
}

// ─── Main Transpiler ──────────────────────────────────────────────────────────

export function transpileGraph(graph: AetherGraph): string {
  const waves = computeWaves(graph.nodes, graph.edges);
  const nodeMap = new Map<string, AetherNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  // Build edge wiring: toNodeId.toPort → fromNodeId.fromPort
  const wiring: { fromNode: string; fromPort: string; toNode: string; toPort: string }[] = [];
  for (const edge of graph.edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (from && to) {
      wiring.push({ fromNode: from.nodeId, fromPort: from.portName, toNode: to.nodeId, toPort: to.portName });
    }
  }

  const lines: string[] = [];

  // Header
  lines.push(`// ═══════════════════════════════════════════════════════════════════`);
  lines.push(`// AETHER Generated Module: ${graph.id} (v${graph.version})`);
  lines.push(`// DO NOT EDIT — regenerate from the AETHER graph definition`);
  lines.push(`// ═══════════════════════════════════════════════════════════════════`);
  lines.push("");

  // ContractViolation class
  lines.push(`class ContractViolation extends Error {`);
  lines.push(`  constructor(nodeId, kind, expression) {`);
  lines.push(`    super(\`Contract \${kind} violation in \${nodeId}: \${expression}\`);`);
  lines.push(`    this.name = "ContractViolation";`);
  lines.push(`    this.nodeId = nodeId;`);
  lines.push(`    this.kind = kind;`);
  lines.push(`    this.expression = expression;`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");

  // Node functions
  for (const node of graph.nodes) {
    lines.push(generateNodeFunction(node));
    lines.push("");

    const recovery = generateRecoveryWrapper(node);
    if (recovery) {
      lines.push(recovery);
      lines.push("");
    }
  }

  // Orchestrator — run function
  lines.push(`// ─── Orchestrator ─────────────────────────────────────────────────`);
  lines.push("");
  lines.push(`async function run(initialInputs = {}) {`);
  lines.push(`  const nodeOutputs = {};`);
  lines.push(`  const nodeConfidences = {};`);
  lines.push(`  const allEffects = [];`);
  lines.push(`  const executionReport = { waves: [], startTime: Date.now() };`);
  lines.push("");

  for (const wave of waves) {
    lines.push(`  // Wave ${wave.level}: [${wave.nodeIds.map(id => `"${id}"`).join(", ")}]`);

    if (wave.nodeIds.length === 1) {
      const nodeId = wave.nodeIds[0];
      const node = nodeMap.get(nodeId)!;
      const fnName = safeId(nodeId);
      const callFn = node.recovery ? `${fnName}_with_recovery` : fnName;

      lines.push(`  {`);
      lines.push(`    const inputs = { ...initialInputs, __confidences: {} };`);

      for (const w of wiring.filter(w => w.toNode === nodeId)) {
        lines.push(`    if (nodeOutputs[${JSON.stringify(w.fromNode)}]) {`);
        lines.push(`      inputs[${JSON.stringify(safeId(w.toPort))}] = nodeOutputs[${JSON.stringify(w.fromNode)}].value[${JSON.stringify(safeId(w.fromPort))}];`);
        lines.push(`      inputs.__confidences[${JSON.stringify(safeId(w.toPort))}] = nodeConfidences[${JSON.stringify(w.fromNode)}] || 1.0;`);
        lines.push(`    }`);
      }

      lines.push(`    const result = await ${callFn}(inputs);`);
      lines.push(`    nodeOutputs[${JSON.stringify(nodeId)}] = result;`);
      lines.push(`    nodeConfidences[${JSON.stringify(nodeId)}] = result.confidence;`);
      lines.push(`    allEffects.push(...result.effects);`);
      lines.push(`    executionReport.waves.push({ level: ${wave.level}, nodes: [${JSON.stringify(nodeId)}], parallel: false });`);
      lines.push(`  }`);
    } else {
      // Multiple nodes — use Promise.all for parallelism
      lines.push(`  {`);
      lines.push(`    const waveResults = await Promise.all([`);

      for (let i = 0; i < wave.nodeIds.length; i++) {
        const nodeId = wave.nodeIds[i];
        const node = nodeMap.get(nodeId)!;
        const fnName = safeId(nodeId);
        const callFn = node.recovery ? `${fnName}_with_recovery` : fnName;
        const comma = i < wave.nodeIds.length - 1 ? "," : "";

        lines.push(`      (async () => {`);
        lines.push(`        const inputs = { ...initialInputs, __confidences: {} };`);

        for (const w of wiring.filter(w => w.toNode === nodeId)) {
          lines.push(`        if (nodeOutputs[${JSON.stringify(w.fromNode)}]) {`);
          lines.push(`          inputs[${JSON.stringify(safeId(w.toPort))}] = nodeOutputs[${JSON.stringify(w.fromNode)}].value[${JSON.stringify(safeId(w.fromPort))}];`);
          lines.push(`          inputs.__confidences[${JSON.stringify(safeId(w.toPort))}] = nodeConfidences[${JSON.stringify(w.fromNode)}] || 1.0;`);
          lines.push(`        }`);
        }

        lines.push(`        return { id: ${JSON.stringify(nodeId)}, result: await ${callFn}(inputs) };`);
        lines.push(`      })()${comma}`);
      }

      lines.push(`    ]);`);
      lines.push("");
      lines.push(`    for (const { id, result } of waveResults) {`);
      lines.push(`      nodeOutputs[id] = result;`);
      lines.push(`      nodeConfidences[id] = result.confidence;`);
      lines.push(`      allEffects.push(...result.effects);`);
      lines.push(`    }`);
      lines.push(`    executionReport.waves.push({ level: ${wave.level}, nodes: ${JSON.stringify(wave.nodeIds)}, parallel: true });`);
      lines.push(`  }`);
    }

    lines.push("");
  }

  // Graph-level confidence
  lines.push(`  // Graph-level confidence`);
  lines.push(`  const graphConfidence = Object.values(nodeConfidences).reduce((a, b) => a * b, 1.0);`);
  lines.push("");

  // Collect final outputs (terminal nodes)
  const nodesWithOutgoing = new Set(wiring.map(w => w.fromNode));
  const terminalNodes = graph.nodes.filter(n => !nodesWithOutgoing.has(n.id));
  const outputCollect = terminalNodes.length > 0
    ? terminalNodes.map(n => `${JSON.stringify(n.id)}: nodeOutputs[${JSON.stringify(n.id)}]?.value`).join(", ")
    : "...nodeOutputs";

  lines.push(`  executionReport.endTime = Date.now();`);
  lines.push(`  executionReport.durationMs = executionReport.endTime - executionReport.startTime;`);
  lines.push("");
  lines.push(`  return {`);
  lines.push(`    outputs: { ${outputCollect} },`);
  lines.push(`    confidence: graphConfidence,`);
  lines.push(`    effects: [...new Set(allEffects)],`);
  lines.push(`    executionReport,`);
  lines.push(`  };`);
  lines.push(`}`);
  lines.push("");

  // Module export
  lines.push(`module.exports = { run, ContractViolation };`);

  return lines.join("\n");
}

export function transpileToFile(graph: AetherGraph, outputPath: string): void {
  const source = transpileGraph(graph);
  writeFileSync(outputPath, source, "utf-8");
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] === __filename ||
  process.argv[1]?.endsWith("transpiler.ts") ||
  process.argv[1]?.endsWith("transpiler.js");

if (isMain && process.argv.length >= 3) {
  const filePath = process.argv[2];
  const outputArg = process.argv.indexOf("--output");
  const outputDir = outputArg >= 0 && process.argv[outputArg + 1] ? process.argv[outputArg + 1] : ".";

  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as AetherGraph;
    const outFile = `${outputDir}/${raw.id}.generated.js`;
    transpileToFile(raw, outFile);
    console.log(`✓  Transpiled → ${outFile}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}
