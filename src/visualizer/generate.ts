/**
 * AETHER Visualizer — HTML Graph Visualization
 *
 * Generates a standalone HTML file that renders an AETHER graph as a visual DAG.
 * Uses inline SVG — no external dependencies, works offline.
 */

import type { AetherGraph, AetherNode, AetherHole, AetherEdge } from "../ir/validator.js";
import type { ExecutionResult, ExecutionLogEntry } from "../runtime/executor.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wave: number;
  isHole: boolean;
  node: AetherNode | AetherHole;
  confidence: number;
  effects: string[];
  pure: boolean;
  supervised: boolean;
}

interface LayoutEdge {
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isNode(n: AetherNode | AetherHole): n is AetherNode {
  return !("hole" in n && (n as any).hole === true);
}

function isHole(n: AetherNode | AetherHole): n is AetherHole {
  return "hole" in n && (n as any).hole === true;
}

function parseEdgeRef(ref: string): { nodeId: string; portName: string } | null {
  const dot = ref.indexOf(".");
  if (dot < 1 || dot === ref.length - 1) return null;
  return { nodeId: ref.slice(0, dot), portName: ref.slice(dot + 1) };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Wave Computation ────────────────────────────────────────────────────────

function computeWaves(graph: AetherGraph): Map<string, number> {
  const nodeIds = new Set(graph.nodes.map(n => n.id));
  const adj = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();

  for (const id of nodeIds) {
    adj.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const edge of graph.edges) {
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

  const waveMap = new Map<string, number>();
  let remaining = new Set(nodeIds);
  let level = 0;

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) wave.push(id);
    }
    if (wave.length === 0) break;

    for (const id of wave) {
      waveMap.set(id, level);
      remaining.delete(id);
      for (const next of adj.get(id) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1);
      }
    }
    level++;
  }

  return waveMap;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 60;
const H_SPACING = 240;
const V_SPACING = 120;
const MARGIN = 40;

function computeLayout(graph: AetherGraph): LayoutNode[] {
  const waveMap = computeWaves(graph);
  const waves = new Map<number, (AetherNode | AetherHole)[]>();

  for (const node of graph.nodes) {
    const w = waveMap.get(node.id) ?? 0;
    if (!waves.has(w)) waves.set(w, []);
    waves.get(w)!.push(node);
  }

  const layout: LayoutNode[] = [];
  const maxWave = Math.max(0, ...waves.keys());

  for (let w = 0; w <= maxWave; w++) {
    const nodesInWave = waves.get(w) ?? [];
    const waveWidth = nodesInWave.length * H_SPACING;
    const startX = MARGIN + (waveWidth > H_SPACING ? 0 : (H_SPACING - NODE_WIDTH) / 2);

    for (let i = 0; i < nodesInWave.length; i++) {
      const n = nodesInWave[i];
      const hole = isHole(n);
      const aNode = hole ? null : (n as AetherNode);

      layout.push({
        id: n.id,
        x: startX + i * H_SPACING,
        y: MARGIN + w * V_SPACING,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        wave: w,
        isHole: hole,
        node: n,
        confidence: hole ? 0.5 : (aNode!.confidence ?? 0.9),
        effects: hole ? (n as AetherHole).must_satisfy.effects ?? [] : aNode!.effects,
        pure: hole ? true : (aNode!.pure ?? aNode!.effects.length === 0),
        supervised: hole ? false : !!aNode!.supervised,
      });
    }
  }

  return layout;
}

// ─── Color Helpers ───────────────────────────────────────────────────────────

function confidenceColor(c: number): string {
  if (c > 0.85) return "#22c55e"; // green
  if (c >= 0.7) return "#eab308";  // yellow
  return "#ef4444";                 // red
}

function confidenceBg(c: number): string {
  if (c > 0.85) return "rgba(34,197,94,0.08)";
  if (c >= 0.7) return "rgba(234,179,8,0.08)";
  return "rgba(239,68,68,0.08)";
}

function borderColor(node: LayoutNode): string {
  if (node.isHole) return "#9ca3af";        // gray
  if (node.supervised) return "#eab308";     // yellow
  if (!node.pure) return "#f97316";          // orange
  return "#3b82f6";                          // blue
}

function borderStyle(node: LayoutNode): string {
  if (node.isHole) return "stroke-dasharray: 4 4";
  if (node.supervised) return "stroke-dasharray: 8 4";
  return "";
}

// ─── SVG Generation ──────────────────────────────────────────────────────────

function generateEdgeSvg(edges: AetherEdge[], layout: LayoutNode[]): string {
  const nodeMap = new Map(layout.map(n => [n.id, n]));
  const lines: string[] = [];

  // Arrowhead marker
  lines.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs>`);

  for (const edge of edges) {
    const from = parseEdgeRef(edge.from);
    const to = parseEdgeRef(edge.to);
    if (!from || !to) continue;

    const srcNode = nodeMap.get(from.nodeId);
    const dstNode = nodeMap.get(to.nodeId);
    if (!srcNode || !dstNode) continue;

    const x1 = srcNode.x + srcNode.width / 2;
    const y1 = srcNode.y + srcNode.height;
    const x2 = dstNode.x + dstNode.width / 2;
    const y2 = dstNode.y;

    lines.push(`<line class="edge-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)"/>`);
  }

  return lines.join("\n");
}

function generateNodeSvg(node: LayoutNode, execEntry?: ExecutionLogEntry): string {
  const border = borderColor(node);
  const style = borderStyle(node);
  const bg = confidenceBg(node.confidence);
  const confColor = confidenceColor(node.confidence);

  const aNode = isNode(node.node) ? node.node : null;
  const hole = isHole(node.node) ? node.node as AetherHole : null;

  // Build tooltip text
  const tooltipParts: string[] = [`Node: ${node.id}`];
  if (aNode) {
    tooltipParts.push(`In: ${Object.keys(aNode.in).join(", ") || "none"}`);
    tooltipParts.push(`Out: ${Object.keys(aNode.out).join(", ") || "none"}`);
    tooltipParts.push(`Contracts: ${(aNode.contract.pre?.length ?? 0)} pre, ${(aNode.contract.post?.length ?? 0)} post`);
    tooltipParts.push(`Confidence: ${node.confidence}`);
    if (node.effects.length > 0) tooltipParts.push(`Effects: ${node.effects.join(", ")}`);
    if (aNode.recovery) tooltipParts.push(`Recovery paths: ${Object.keys(aNode.recovery).length}`);
    if (aNode.adversarial_check) tooltipParts.push(`Adversarial checks: ${aNode.adversarial_check.break_if.length}`);
    if (aNode.supervised) tooltipParts.push(`Supervised: ${aNode.supervised.reason}`);
  } else if (hole) {
    tooltipParts.push(`[HOLE] Must satisfy:`);
    tooltipParts.push(`  In: ${Object.keys(hole.must_satisfy.in).join(", ")}`);
    tooltipParts.push(`  Out: ${Object.keys(hole.must_satisfy.out).join(", ")}`);
  }

  if (execEntry) {
    tooltipParts.push(`---`);
    tooltipParts.push(`Wave: ${execEntry.wave}`);
    tooltipParts.push(`Duration: ${execEntry.duration_ms.toFixed(1)}ms`);
    tooltipParts.push(`Confidence: ${execEntry.confidence.toFixed(2)}`);
    if (execEntry.skipped) tooltipParts.push(`SKIPPED (below threshold)`);
    if (execEntry.effects.length > 0) tooltipParts.push(`Effects: ${execEntry.effects.join(", ")}`);
  }

  const tooltip = escapeHtml(tooltipParts.join("\n"));

  // Execution overlay styling
  let extraClass = "";
  let execBadge = "";
  if (execEntry) {
    if (execEntry.skipped) {
      extraClass = " skipped-node";
    }
    execBadge = `<text x="${node.x + node.width - 8}" y="${node.y + 14}" text-anchor="end" class="exec-time">${execEntry.duration_ms.toFixed(1)}ms</text>`;
  }

  // Confidence badge
  const confBadge = `<circle cx="${node.x + 16}" cy="${node.y + 14}" r="5" fill="${confColor}" class="confidence-badge"/><text x="${node.x + 26}" y="${node.y + 18}" class="conf-text">${node.confidence.toFixed(2)}</text>`;

  // Effect pills
  let effectPills = "";
  if (node.effects.length > 0 && !node.isHole) {
    const pillY = node.y + node.height - 14;
    effectPills = node.effects.slice(0, 3).map((eff, i) =>
      `<text x="${node.x + 8 + i * 70}" y="${pillY}" class="effect-pill">${escapeHtml(eff.length > 10 ? eff.slice(0, 9) + "…" : eff)}</text>`
    ).join("");
  }

  return `<g class="node-group${extraClass}" data-node-id="${escapeHtml(node.id)}">
  <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" ry="6" fill="${bg}" stroke="${border}" stroke-width="2" ${style}/>
  <text x="${node.x + node.width / 2}" y="${node.y + 35}" text-anchor="middle" class="node-label">${escapeHtml(node.id)}</text>
  ${confBadge}
  ${execBadge}
  ${effectPills}
  <title>${tooltip}</title>
</g>`;
}

function generateWaveLabels(layout: LayoutNode[], hasExecution: boolean): string {
  if (!hasExecution) return "";

  const waves = new Map<number, number>();
  for (const n of layout) {
    const existing = waves.get(n.wave);
    if (existing === undefined || n.y < existing) {
      waves.set(n.wave, n.y);
    }
  }

  const labels: string[] = [];
  for (const [wave, y] of waves) {
    labels.push(`<text x="8" y="${y + NODE_HEIGHT / 2 + 4}" class="wave-label">Wave ${wave}</text>`);
  }
  return labels.join("\n");
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function generateLegend(graph: AetherGraph, layout: LayoutNode[], verificationPct?: number): string {
  const maxX = Math.max(...layout.map(n => n.x + n.width)) + MARGIN;
  const maxY = Math.max(...layout.map(n => n.y + n.height)) + MARGIN;
  const legendY = maxY + 20;

  return `<g class="legend" transform="translate(${MARGIN}, ${legendY})">
  <text x="0" y="0" class="legend-title">Legend</text>
  <rect x="0" y="12" width="16" height="16" rx="3" fill="none" stroke="#3b82f6" stroke-width="2"/>
  <text x="22" y="24" class="legend-text">Pure node</text>
  <rect x="110" y="12" width="16" height="16" rx="3" fill="none" stroke="#f97316" stroke-width="2"/>
  <text x="132" y="24" class="legend-text">Effectful node</text>
  <rect x="250" y="12" width="16" height="16" rx="3" fill="none" stroke="#eab308" stroke-width="2" stroke-dasharray="8 4"/>
  <text x="272" y="24" class="legend-text">Supervised node</text>
  <rect x="400" y="12" width="16" height="16" rx="3" fill="none" stroke="#9ca3af" stroke-width="2" stroke-dasharray="4 4"/>
  <text x="422" y="24" class="legend-text">Hole (partial)</text>
  <text x="0" y="50" class="legend-text">Confidence:</text>
  <circle cx="80" cy="46" r="5" fill="#22c55e"/><text x="90" y="50" class="legend-text">&gt; 0.85</text>
  <circle cx="140" cy="46" r="5" fill="#eab308"/><text x="150" y="50" class="legend-text">0.7–0.85</text>
  <circle cx="220" cy="46" r="5" fill="#ef4444"/><text x="230" y="50" class="legend-text">&lt; 0.7</text>
  <text x="0" y="74" class="legend-text">Graph: ${escapeHtml(graph.id)} v${graph.version} | ${graph.nodes.length} nodes | ${graph.edges.length} edges${verificationPct !== undefined ? ` | ${verificationPct}% verified` : ""}</text>
</g>`;
}

// ─── Main Generator ──────────────────────────────────────────────────────────

export function generateVisualization(graph: AetherGraph, executionResult?: ExecutionResult): string {
  const layout = computeLayout(graph);

  // Build execution lookup
  const execMap = new Map<string, ExecutionLogEntry>();
  if (executionResult) {
    for (const entry of executionResult.executionLog) {
      execMap.set(entry.nodeId, entry);
    }
    // Override confidence from execution result
    for (const ln of layout) {
      const entry = execMap.get(ln.id);
      if (entry) ln.confidence = entry.confidence;
    }
  }

  // Compute SVG dimensions
  const maxX = Math.max(...layout.map(n => n.x + n.width), 600) + MARGIN;
  const legendHeight = 100;
  const maxY = Math.max(...layout.map(n => n.y + n.height)) + MARGIN + legendHeight;

  // Build SVG parts
  const edgeSvg = generateEdgeSvg(graph.edges, layout);
  const nodeSvg = layout.map(n => generateNodeSvg(n, execMap.get(n.id))).join("\n");
  const waveLabels = generateWaveLabels(layout, !!executionResult);
  const legend = generateLegend(graph, layout);

  // Execution summary panel
  let execSummary = "";
  if (executionResult) {
    const summaryY = 10;
    const summaryX = maxX - 280;
    const oversightNodes = executionResult.executionLog.filter(e => !e.skipped && e.confidence < 0.85);
    const oversightText = oversightNodes.length > 0
      ? oversightNodes.map(e => `${e.nodeId} (${e.confidence.toFixed(2)})`).join(", ")
      : "none";

    execSummary = `<g class="exec-summary" transform="translate(${summaryX}, ${summaryY})">
  <rect x="0" y="0" width="270" height="90" rx="6" fill="rgba(255,255,255,0.95)" stroke="#cbd5e1" stroke-width="1"/>
  <text x="10" y="18" class="exec-title">Execution Summary</text>
  <text x="10" y="34" class="exec-detail">${executionResult.nodesExecuted} nodes in ${executionResult.waves} waves (${executionResult.duration_ms.toFixed(0)}ms)</text>
  <text x="10" y="50" class="exec-detail">Final confidence: ${executionResult.confidence.toFixed(2)}</text>
  <text x="10" y="66" class="exec-detail">Effects: ${[...new Set(executionResult.effectsPerformed)].join(", ") || "none"}</text>
  <text x="10" y="82" class="exec-detail">Oversight: ${escapeHtml(oversightText)}</text>
</g>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AETHER Graph: ${escapeHtml(graph.id)}</title>
<style>
body { margin: 0; padding: 20px; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 18px; color: #1e293b; margin-bottom: 12px; }
svg { background: white; border: 1px solid #e2e8f0; border-radius: 8px; }
.node-label { font-size: 13px; font-weight: 600; fill: #1e293b; }
.conf-text { font-size: 10px; fill: #64748b; }
.effect-pill { font-size: 9px; fill: #9333ea; font-family: monospace; }
.wave-label { font-size: 11px; fill: #94a3b8; font-weight: 600; font-style: italic; }
.legend-title { font-size: 13px; font-weight: 700; fill: #334155; }
.legend-text { font-size: 11px; fill: #64748b; }
.exec-title { font-size: 12px; font-weight: 700; fill: #334155; }
.exec-detail { font-size: 10px; fill: #64748b; font-family: monospace; }
.exec-time { font-size: 9px; fill: #94a3b8; font-family: monospace; }
.skipped-node rect { opacity: 0.4; stroke-dasharray: 6 3; }
.skipped-node text { opacity: 0.5; }
.node-group:hover rect { stroke-width: 3; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1)); }
.edge-line { opacity: 0.6; }
.edge-line:hover { opacity: 1; stroke-width: 2.5; }
</style>
</head>
<body>
<h1>AETHER Graph: ${escapeHtml(graph.id)} (v${graph.version})</h1>
<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">
${edgeSvg}
${nodeSvg}
${waveLabels}
${legend}
${execSummary}
</svg>
</body>
</html>`;
}
