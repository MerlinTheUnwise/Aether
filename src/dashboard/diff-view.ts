/**
 * AETHER Dashboard — Diff View
 *
 * Compare two DashboardData snapshots to show verification changes over time.
 */

import type { DashboardData } from "./collector.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DashboardDiff {
  from: { graphId: string; version: number; generatedAt: string };
  to: { graphId: string; version: number; generatedAt: string };
  changes: {
    verificationDelta: number;
    nodesAdded: string[];
    nodesRemoved: string[];
    verificationChanged: Array<{
      nodeId: string;
      from: "verified" | "failed" | "unsupported" | "supervised";
      to: "verified" | "failed" | "unsupported" | "supervised";
    }>;
    confidenceDelta: number;
    newErrors: string[];
    resolvedErrors: string[];
    optimizationsDelta: number;
  };
}

// ─── Diff Logic ─────────────────────────────────────────────────────────────

export function diffDashboards(before: DashboardData, after: DashboardData): DashboardDiff {
  const beforeNodeIds = new Set(before.verification.byNode.map(n => n.nodeId));
  const afterNodeIds = new Set(after.verification.byNode.map(n => n.nodeId));

  const nodesAdded = [...afterNodeIds].filter(id => !beforeNodeIds.has(id));
  const nodesRemoved = [...beforeNodeIds].filter(id => !afterNodeIds.has(id));

  // Verification status changes
  const verificationChanged: DashboardDiff["changes"]["verificationChanged"] = [];
  for (const afterNode of after.verification.byNode) {
    const beforeNode = before.verification.byNode.find(n => n.nodeId === afterNode.nodeId);
    if (beforeNode && beforeNode.status !== afterNode.status) {
      verificationChanged.push({
        nodeId: afterNode.nodeId,
        from: beforeNode.status,
        to: afterNode.status,
      });
    }
  }

  // Error tracking
  const beforeErrors = new Set(before.typeSafety.errorDetails.map(e => `${e.edge}:${e.code}`));
  const afterErrors = new Set(after.typeSafety.errorDetails.map(e => `${e.edge}:${e.code}`));

  const newErrors = [...afterErrors].filter(e => !beforeErrors.has(e));
  const resolvedErrors = [...beforeErrors].filter(e => !afterErrors.has(e));

  return {
    from: {
      graphId: before.graph.id,
      version: before.graph.version,
      generatedAt: before.generatedAt,
    },
    to: {
      graphId: after.graph.id,
      version: after.graph.version,
      generatedAt: after.generatedAt,
    },
    changes: {
      verificationDelta: after.verification.percentage - before.verification.percentage,
      nodesAdded,
      nodesRemoved,
      verificationChanged,
      confidenceDelta: after.confidence.graphConfidence - before.confidence.graphConfidence,
      newErrors,
      resolvedErrors,
      optimizationsDelta: after.optimizations.length - before.optimizations.length,
    },
  };
}

// ─── HTML Render ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function deltaColor(n: number): string {
  if (n > 0) return "#6ee7b7";
  if (n < 0) return "#f43f5e";
  return "#9ca3af";
}

function deltaSign(n: number, suffix = ""): string {
  if (n > 0) return `+${n.toFixed(1)}${suffix}`;
  if (n < 0) return `${n.toFixed(1)}${suffix}`;
  return `0${suffix}`;
}

function statusColor(status: string): string {
  switch (status) {
    case "verified": return "#6ee7b7";
    case "failed": return "#f43f5e";
    case "unsupported": return "#6b7280";
    case "supervised": return "#fbbf24";
    default: return "#9ca3af";
  }
}

export function renderDiffView(diff: DashboardDiff): string {
  const c = diff.changes;
  const hasChanges = c.nodesAdded.length > 0 || c.nodesRemoved.length > 0 ||
    c.verificationChanged.length > 0 || c.newErrors.length > 0 ||
    c.resolvedErrors.length > 0 || Math.abs(c.verificationDelta) > 0.01;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AETHER Diff — ${esc(diff.from.graphId)} v${diff.from.version} → v${diff.to.version}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0f1a;color:#e2e8f0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6}
.container{max-width:1000px;margin:0 auto;padding:24px}
h1{font-size:24px;font-weight:700;color:#f1f5f9;margin-bottom:4px}
h2{font-size:18px;font-weight:600;color:#f1f5f9;margin:20px 0 10px;border-bottom:1px solid #1e293b;padding-bottom:6px}
.header{padding:24px;background:#111827;border-radius:12px;margin-bottom:24px;border:1px solid #1e293b}
.meta{color:#9ca3af;font-size:13px;margin-bottom:16px}
.delta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.delta-card{background:#1e293b;border-radius:8px;padding:16px;text-align:center}
.delta-value{font-size:32px;font-weight:800;line-height:1}
.delta-label{font-size:11px;color:#9ca3af;text-transform:uppercase;margin-top:4px;letter-spacing:0.5px}
.section{background:#111827;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #1e293b}
.change-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px}
.change-row:last-child{border-bottom:none}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;color:#0a0f1a}
.badge-added{background:#6ee7b7}
.badge-removed{background:#f43f5e}
.badge-changed{background:#fbbf24}
.badge-resolved{background:#6ee7b7}
.badge-new{background:#f43f5e}
.arrow{color:#6b7280;font-size:16px}
.no-changes{color:#6b7280;font-style:italic;padding:12px 0}
.timestamp{text-align:center;color:#6b7280;font-size:12px;margin-top:24px;padding:12px}
</style>
</head>
<body>
<div class="container">

<div class="header">
  <h1>Dashboard Diff</h1>
  <div class="meta">${esc(diff.from.graphId)} v${diff.from.version} → v${diff.to.version}</div>
  <div class="delta-grid">
    <div class="delta-card">
      <div class="delta-value" style="color:${deltaColor(c.verificationDelta)}">${deltaSign(c.verificationDelta, "%")}</div>
      <div class="delta-label">Verification</div>
    </div>
    <div class="delta-card">
      <div class="delta-value" style="color:${deltaColor(c.confidenceDelta * 100)}">${deltaSign(c.confidenceDelta * 100, "%")}</div>
      <div class="delta-label">Confidence</div>
    </div>
    <div class="delta-card">
      <div class="delta-value" style="color:#a78bfa">${c.nodesAdded.length}</div>
      <div class="delta-label">Nodes Added</div>
    </div>
    <div class="delta-card">
      <div class="delta-value" style="color:${c.nodesRemoved.length > 0 ? "#f43f5e" : "#9ca3af"}">${c.nodesRemoved.length}</div>
      <div class="delta-label">Nodes Removed</div>
    </div>
  </div>
</div>

${!hasChanges ? `<div class="section"><h2>Changes</h2><p class="no-changes">No changes detected.</p></div>` : ""}

${c.nodesAdded.length > 0 ? `
<div class="section">
  <h2>Nodes Added</h2>
  ${c.nodesAdded.map(id => `<div class="change-row"><span class="badge badge-added">ADDED</span> <strong>${esc(id)}</strong></div>`).join("\n")}
</div>` : ""}

${c.nodesRemoved.length > 0 ? `
<div class="section">
  <h2>Nodes Removed</h2>
  ${c.nodesRemoved.map(id => `<div class="change-row"><span class="badge badge-removed">REMOVED</span> <strong>${esc(id)}</strong></div>`).join("\n")}
</div>` : ""}

${c.verificationChanged.length > 0 ? `
<div class="section">
  <h2>Verification Changes</h2>
  ${c.verificationChanged.map(vc =>
    `<div class="change-row">
      <span class="badge badge-changed">CHANGED</span>
      <strong>${esc(vc.nodeId)}</strong>
      <span class="badge" style="background:${statusColor(vc.from)}">${esc(vc.from)}</span>
      <span class="arrow">→</span>
      <span class="badge" style="background:${statusColor(vc.to)}">${esc(vc.to)}</span>
    </div>`
  ).join("\n")}
</div>` : ""}

${c.newErrors.length > 0 || c.resolvedErrors.length > 0 ? `
<div class="section">
  <h2>Type Errors</h2>
  ${c.newErrors.map(e => `<div class="change-row"><span class="badge badge-new">NEW</span> ${esc(e)}</div>`).join("\n")}
  ${c.resolvedErrors.map(e => `<div class="change-row"><span class="badge badge-resolved">RESOLVED</span> ${esc(e)}</div>`).join("\n")}
</div>` : ""}

<div class="timestamp">AETHER Dashboard Diff · ${esc(diff.from.generatedAt)} → ${esc(diff.to.generatedAt)}</div>
</div>
</body>
</html>`;
}
