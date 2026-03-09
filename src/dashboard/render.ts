/**
 * AETHER Dashboard — HTML Renderer
 *
 * Generates a self-contained HTML dashboard from DashboardData.
 * Dark theme, inline CSS/JS, no external dependencies.
 */

import type { DashboardData } from "./collector.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function scoreColor(pct: number): string {
  if (pct >= 90) return "#6ee7b7";
  if (pct >= 70) return "#fbbf24";
  return "#f43f5e";
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

function statusBg(status: string): string {
  switch (status) {
    case "verified": return "rgba(110,231,183,0.08)";
    case "failed": return "rgba(244,63,94,0.08)";
    case "unsupported": return "rgba(107,114,128,0.08)";
    case "supervised": return "rgba(251,191,36,0.08)";
    default: return "transparent";
  }
}

function priorityBadge(p: string): string {
  const colors: Record<string, string> = { high: "#f43f5e", medium: "#fbbf24", low: "#6b7280" };
  return `<span style="background:${colors[p] ?? "#6b7280"};color:#0a0f1a;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${esc(p)}</span>`;
}

// ─── Render ─────────────────────────────────────────────────────────────────

export function renderDashboard(data: DashboardData): string {
  const vPct = data.verification.percentage;
  const vColor = scoreColor(vPct);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AETHER Dashboard — ${esc(data.graph.id)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0f1a;color:#e2e8f0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6}
.container{max-width:1400px;margin:0 auto;padding:24px}
h1{font-size:28px;font-weight:700;color:#f1f5f9}
h2{font-size:20px;font-weight:600;color:#f1f5f9;margin:24px 0 12px;border-bottom:1px solid #1e293b;padding-bottom:8px}
h3{font-size:16px;font-weight:600;color:#cbd5e1;margin:16px 0 8px}

.header{display:grid;grid-template-columns:1fr auto;gap:24px;align-items:center;padding:24px;background:#111827;border-radius:12px;margin-bottom:24px;border:1px solid #1e293b}
.header-left{display:flex;flex-direction:column;gap:4px}
.header-meta{color:#9ca3af;font-size:13px}
.score{font-size:64px;font-weight:800;text-align:right;line-height:1}
.score-label{font-size:12px;color:#9ca3af;text-align:right;margin-top:4px}
.quick-stats{display:flex;gap:16px;margin-top:12px;flex-wrap:wrap}
.stat{background:#1e293b;padding:8px 16px;border-radius:8px;display:flex;flex-direction:column;align-items:center;min-width:80px}
.stat-value{font-size:20px;font-weight:700;color:#f1f5f9}
.stat-label{font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px}

.section{background:#111827;border-radius:12px;padding:20px;margin-bottom:16px;border:1px solid #1e293b}
.summary-bar{display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap}
.summary-item{display:flex;align-items:center;gap:6px;font-size:13px}
.summary-dot{width:10px;height:10px;border-radius:50%;display:inline-block}

table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:8px 12px;border-bottom:2px solid #1e293b;color:#9ca3af;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap}
th:hover{color:#e2e8f0}
th.sorted-asc::after{content:" ▲";font-size:10px}
th.sorted-desc::after{content:" ▼";font-size:10px}
td{padding:8px 12px;border-bottom:1px solid #1e293b}
tr:hover td{background:rgba(255,255,255,0.02)}
.status-badge{display:inline-block;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600}

.confidence-bar{display:flex;height:24px;border-radius:4px;overflow:hidden;margin:8px 0}
.confidence-bar div{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#0a0f1a}

.effect-chip{display:inline-block;background:#1e293b;color:#a78bfa;padding:2px 8px;border-radius:4px;font-size:12px;margin:2px}
.effect-chip.pure{color:#6ee7b7;border:1px solid rgba(110,231,183,0.2)}

.opt-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #1e293b}
.opt-row:last-child{border-bottom:none}
.auto-badge{background:#6ee7b7;color:#0a0f1a;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:700}

.proof-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.proof-card{background:#1e293b;border-radius:8px;padding:16px;text-align:center}
.proof-card .value{font-size:28px;font-weight:700}
.proof-card .label{font-size:11px;color:#9ca3af;text-transform:uppercase;margin-top:4px}

.state-type-block{margin-bottom:16px;padding:12px;background:#1e293b;border-radius:8px}
.transition-table{margin-top:8px}
.transition-table td{font-size:12px;padding:4px 8px}

.timestamp{text-align:center;color:#6b7280;font-size:12px;margin-top:24px;padding:12px}

.expandable{cursor:pointer}
.expandable-content{display:none;padding:8px 12px;background:#0a0f1a;border-radius:4px;margin:4px 0}
.expandable.open .expandable-content{display:block}
</style>
</head>
<body>
<div class="container">

${renderHeader(data, vPct, vColor)}
${renderVerification(data)}
${renderConfidence(data)}
${renderTypeSafety(data)}
${renderEffects(data)}
${renderStateTypes(data)}
${renderOptimizations(data)}
${renderProofReadiness(data)}
${renderExecution(data)}

<div class="timestamp">Generated ${esc(data.generatedAt)} · AETHER Verification Dashboard</div>
</div>

<script>
${getSortScript()}
</script>
</body>
</html>`;
}

function renderHeader(data: DashboardData, vPct: number, vColor: string): string {
  const g = data.graph;
  return `
<div class="header">
  <div class="header-left">
    <h1>${esc(g.id)}</h1>
    <div class="header-meta">Version ${g.version} · ${esc(data.generatedAt)}</div>
    <div class="quick-stats">
      <div class="stat"><span class="stat-value">${g.nodeCount}</span><span class="stat-label">Nodes</span></div>
      <div class="stat"><span class="stat-value">${g.edgeCount}</span><span class="stat-label">Edges</span></div>
      <div class="stat"><span class="stat-value">${g.waveCount}</span><span class="stat-label">Waves</span></div>
      <div class="stat"><span class="stat-value">${g.scopeCount}</span><span class="stat-label">Scopes</span></div>
      ${g.templateCount > 0 ? `<div class="stat"><span class="stat-value">${g.templateCount}</span><span class="stat-label">Templates</span></div>` : ""}
      ${g.intentCount > 0 ? `<div class="stat"><span class="stat-value">${g.intentCount}</span><span class="stat-label">Intents</span></div>` : ""}
    </div>
  </div>
  <div>
    <div class="score" style="color:${vColor}">${vPct.toFixed(1)}%</div>
    <div class="score-label">Verification Score</div>
  </div>
</div>`;
}

function renderVerification(data: DashboardData): string {
  const s = data.verification.summary;
  const rows = data.verification.byNode.map(n => {
    const c = n.contracts;
    return `<tr style="background:${statusBg(n.status)}">
      <td><strong>${esc(n.nodeId)}</strong></td>
      <td><span class="status-badge" style="background:${statusColor(n.status)};color:#0a0f1a">${esc(n.status)}</span></td>
      <td>${c.pre.verified}/${c.pre.total}</td>
      <td>${c.post.verified}/${c.post.total}</td>
      <td>${c.invariants.verified}/${c.invariants.total}</td>
      <td>${c.adversarial.passed}/${c.adversarial.total}</td>
      <td>${n.confidence.propagated.toFixed(2)}</td>
      <td>${n.effects.length > 0 ? n.effects.map(e => `<span class="effect-chip">${esc(e)}</span>`).join("") : '<span class="effect-chip pure">pure</span>'}</td>
      <td>${n.recoveryPaths}</td>
    </tr>`;
  }).join("\n");

  return `
<div class="section">
  <h2>Verification Breakdown</h2>
  <div class="summary-bar">
    <div class="summary-item"><span class="summary-dot" style="background:#6ee7b7"></span> Verified: ${s.verified}</div>
    <div class="summary-item"><span class="summary-dot" style="background:#f43f5e"></span> Failed: ${s.failed}</div>
    <div class="summary-item"><span class="summary-dot" style="background:#6b7280"></span> Unsupported: ${s.unsupported}</div>
    <div class="summary-item"><span class="summary-dot" style="background:#fbbf24"></span> Supervised: ${s.supervised}</div>
  </div>
  <table id="verification-table">
    <thead>
      <tr>
        <th data-col="0">Node</th>
        <th data-col="1">Status</th>
        <th data-col="2">Pre</th>
        <th data-col="3">Post</th>
        <th data-col="4">Inv</th>
        <th data-col="5">Adv</th>
        <th data-col="6">Confidence</th>
        <th data-col="7">Effects</th>
        <th data-col="8">Recovery</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</div>`;
}

function renderConfidence(data: DashboardData): string {
  const c = data.confidence;
  const total = c.distribution.high + c.distribution.medium + c.distribution.low;
  const highPct = total > 0 ? (c.distribution.high / total * 100) : 0;
  const medPct = total > 0 ? (c.distribution.medium / total * 100) : 0;
  const lowPct = total > 0 ? (c.distribution.low / total * 100) : 0;

  return `
<div class="section">
  <h2>Confidence Flow</h2>
  <p style="margin-bottom:12px">Graph confidence: <strong style="color:${scoreColor(c.graphConfidence * 100)}">${(c.graphConfidence * 100).toFixed(1)}%</strong></p>

  <h3>Distribution</h3>
  <div class="confidence-bar">
    ${highPct > 0 ? `<div style="width:${highPct}%;background:#6ee7b7">High ${c.distribution.high}</div>` : ""}
    ${medPct > 0 ? `<div style="width:${medPct}%;background:#fbbf24">Med ${c.distribution.medium}</div>` : ""}
    ${lowPct > 0 ? `<div style="width:${lowPct}%;background:#f43f5e">Low ${c.distribution.low}</div>` : ""}
  </div>

  <h3>Critical Path</h3>
  <p style="font-family:monospace;color:#a78bfa">${c.criticalPath.map(n => esc(n)).join(" → ")}</p>

  ${c.oversightNodes.length > 0 ? `
  <h3>Oversight Required</h3>
  <p>${c.oversightNodes.map(n => `<span class="effect-chip" style="color:#fbbf24;border:1px solid rgba(251,191,36,0.3)">${esc(n)}</span>`).join("")}</p>
  ` : ""}
</div>`;
}

function renderTypeSafety(data: DashboardData): string {
  const ts = data.typeSafety;
  if (ts.edgesChecked === 0 && ts.errors === 0 && ts.warnings === 0) {
    return `<div class="section"><h2>Type Safety</h2><p>No edges to check.</p></div>`;
  }

  const edgeRows = [
    ...ts.errorDetails.map(e =>
      `<tr style="background:rgba(244,63,94,0.08)"><td>${esc(e.edge)}</td><td><span style="color:#f43f5e">${esc(e.code)}</span></td><td>${esc(e.message)}</td></tr>`
    ),
    ...ts.warningDetails.map(w =>
      `<tr style="background:rgba(251,191,36,0.08)"><td>${esc(w.edge)}</td><td><span style="color:#fbbf24">${esc(w.code)}</span></td><td>${esc(w.message)}</td></tr>`
    ),
  ];

  return `
<div class="section">
  <h2>Type Safety</h2>
  <div class="summary-bar">
    <div class="summary-item"><span class="summary-dot" style="background:#6ee7b7"></span> Compatible: ${ts.compatible}</div>
    <div class="summary-item"><span class="summary-dot" style="background:#f43f5e"></span> Errors: ${ts.errors}</div>
    <div class="summary-item"><span class="summary-dot" style="background:#fbbf24"></span> Warnings: ${ts.warnings}</div>
  </div>
  ${edgeRows.length > 0 ? `
  <table>
    <thead><tr><th>Edge</th><th>Code</th><th>Message</th></tr></thead>
    <tbody>${edgeRows.join("\n")}</tbody>
  </table>` : `<p style="color:#6ee7b7">All ${ts.edgesChecked} edges type-compatible.</p>`}
</div>`;
}

function renderEffects(data: DashboardData): string {
  const e = data.effects;
  const distEntries = Object.entries(e.effectDistribution).sort((a, b) => b[1] - a[1]);

  return `
<div class="section">
  <h2>Effect Audit</h2>
  <div class="summary-bar">
    <div class="summary-item"><span class="summary-dot" style="background:#6ee7b7"></span> Pure: ${e.pureNodes.length}</div>
    <div class="summary-item"><span class="summary-dot" style="background:#a78bfa"></span> Effectful: ${e.effectfulNodes.length}</div>
  </div>

  ${distEntries.length > 0 ? `
  <h3>Effect Distribution</h3>
  ${distEntries.map(([name, count]) => {
    const maxCount = Math.max(...distEntries.map(d => d[1]));
    const barWidth = (count / maxCount * 100);
    return `<div style="display:flex;align-items:center;gap:12px;margin:4px 0">
      <span style="width:140px;font-family:monospace;font-size:12px;color:#a78bfa">${esc(name)}</span>
      <div style="flex:1;background:#1e293b;border-radius:4px;height:20px">
        <div style="width:${barWidth}%;background:#a78bfa;height:100%;border-radius:4px;display:flex;align-items:center;padding-left:8px;font-size:11px;font-weight:600;color:#0a0f1a">${count}</div>
      </div>
    </div>`;
  }).join("\n")}` : ""}

  <h3>By Node</h3>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
    ${Object.entries(e.byNode).map(([nodeId, effects]) =>
      `<div style="background:#1e293b;padding:6px 12px;border-radius:6px;font-size:12px">
        <strong>${esc(nodeId)}</strong>: ${effects.length > 0 ? effects.map(ef => `<span class="effect-chip">${esc(ef)}</span>`).join("") : '<span class="effect-chip pure">pure</span>'}
      </div>`
    ).join("\n")}
  </div>
</div>`;
}

function renderStateTypes(data: DashboardData): string {
  if (data.stateTypes.length === 0) return "";

  return `
<div class="section">
  <h2>State Types</h2>
  ${data.stateTypes.map(st => `
  <div class="state-type-block">
    <h3>${esc(st.id)}</h3>
    <div style="display:flex;gap:16px;font-size:13px;margin-bottom:8px">
      <span>${st.states} states</span>
      <span>${st.transitions} transitions</span>
      <span>Never-invariants: ${st.neverInvariants.verified}/${st.neverInvariants.total} verified</span>
    </div>
    ${st.terminalStates.length > 0 ? `<div style="font-size:12px;color:#9ca3af">Terminal: ${st.terminalStates.map(s => `<span class="effect-chip">${esc(s)}</span>`).join("")}</div>` : ""}
  </div>`).join("\n")}
</div>`;
}

function renderOptimizations(data: DashboardData): string {
  if (data.optimizations.length === 0) return "";

  return `
<div class="section">
  <h2>Optimization Suggestions</h2>
  ${data.optimizations.map(o => `
  <div class="opt-row">
    ${priorityBadge(o.priority)}
    <span style="flex:1">${esc(o.description)}</span>
    <span style="font-family:monospace;font-size:12px;color:#6b7280">${esc(o.type)}</span>
    ${o.autoApplicable ? '<span class="auto-badge">AUTO</span>' : ""}
  </div>`).join("\n")}
</div>`;
}

function renderProofReadiness(data: DashboardData): string {
  const p = data.proofExport;
  if (p.theoremsGenerable === 0 && p.stateTypeProofs === 0) return "";

  const total = p.theoremsGenerable;
  const provedPct = total > 0 ? (p.fullyProvable / total * 100) : 0;
  const sorryPct = total > 0 ? (p.needingSorry / total * 100) : 0;
  const leanFile = `${esc(data.graph.id)}.lean`;

  return `
<div class="section">
  <h2>Proof Readiness</h2>
  <p style="margin-bottom:12px;font-size:13px;color:#9ca3af">Lean 4 export: <span style="font-family:monospace;color:#a78bfa">${leanFile}</span></p>
  <div class="proof-grid">
    <div class="proof-card"><div class="value" style="color:#a78bfa">${p.theoremsGenerable}</div><div class="label">Theorems</div></div>
    <div class="proof-card"><div class="value" style="color:#6ee7b7">${p.fullyProvable}</div><div class="label">Fully Proved</div></div>
    <div class="proof-card"><div class="value" style="color:#fbbf24">${p.needingSorry}</div><div class="label">Needing Sorry</div></div>
    <div class="proof-card"><div class="value" style="color:#a78bfa">${p.stateTypeProofs}</div><div class="label">State Type Proofs</div></div>
  </div>
  ${total > 0 ? `
  <div style="margin-top:12px">
    <h3>Proof Completion</h3>
    <div class="confidence-bar">
      ${provedPct > 0 ? `<div style="width:${provedPct}%;background:#6ee7b7">Proved ${p.fullyProvable}</div>` : ""}
      ${sorryPct > 0 ? `<div style="width:${sorryPct}%;background:#fbbf24">Sorry ${p.needingSorry}</div>` : ""}
    </div>
  </div>` : ""}
</div>`;
}

function renderExecution(data: DashboardData): string {
  if (!data.execution) return "";
  const e = data.execution;

  return `
<div class="section">
  <h2>Execution Profile</h2>
  <div class="summary-bar">
    <div class="summary-item">Runs: <strong>${e.totalRuns}</strong></div>
    <div class="summary-item">Avg time: <strong>${e.avgTime_ms.toFixed(1)}ms</strong></div>
    <div class="summary-item">JIT: <strong>${e.jitCompiled ? "Yes" : "No"}</strong></div>
    ${e.jitSpeedup ? `<div class="summary-item">Speedup: <strong>${esc(e.jitSpeedup)}</strong></div>` : ""}
  </div>
  ${e.hotPaths.length > 0 ? `
  <h3>Hot Paths</h3>
  ${e.hotPaths.map(path =>
    `<p style="font-family:monospace;font-size:12px;color:#fbbf24">${path.map(n => esc(n)).join(" → ")}</p>`
  ).join("\n")}` : ""}
</div>`;
}

function getSortScript(): string {
  return `
document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', function() {
    const table = this.closest('table');
    const tbody = table.querySelector('tbody');
    const col = parseInt(this.dataset.col);
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const isAsc = this.classList.contains('sorted-asc');

    table.querySelectorAll('th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
    this.classList.add(isAsc ? 'sorted-desc' : 'sorted-asc');

    rows.sort((a, b) => {
      const aVal = a.children[col]?.textContent?.trim() ?? '';
      const bVal = b.children[col]?.textContent?.trim() ?? '';
      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return isAsc ? bNum - aNum : aNum - bNum;
      }
      return isAsc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    });
    rows.forEach(r => tbody.appendChild(r));
  });
});`;
}
