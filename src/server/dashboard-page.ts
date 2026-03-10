/**
 * AETHER Server — Live Dashboard Page
 *
 * Generates a self-contained HTML page served at `/`.
 * Four panels: Graph & Controls, Live Results, Verification Status, Output.
 * Auto-refreshes via polling + SSE for real-time execution updates.
 */

export interface DashboardPageOptions {
  port: number;
  graphId?: string;
  graphVersion?: number;
  nodeCount?: number;
  edgeCount?: number;
  mode?: "mock" | "real";
}

export function generateDashboardPage(options: DashboardPageOptions): string {
  const { port, graphId, graphVersion, nodeCount, edgeCount, mode } = options;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AETHER Dashboard${graphId ? ` — ${graphId}` : ""}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0a0f1a; color: #e2e8f0; min-height: 100vh; }

  .header { background: #111827; border-bottom: 1px solid #1e293b; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; }
  .header h1 { font-size: 18px; color: #6ee7b7; font-weight: 600; }
  .header .meta { font-size: 13px; color: #94a3b8; }
  .header .status { display: flex; gap: 12px; align-items: center; }
  .header .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .header .dot.green { background: #6ee7b7; }
  .header .dot.yellow { background: #fbbf24; }
  .header .dot.red { background: #f43f5e; }

  .layout { display: grid; grid-template-columns: 300px 1fr 280px; grid-template-rows: 1fr 200px; height: calc(100vh - 52px); gap: 1px; background: #1e293b; }

  .panel { background: #0f172a; padding: 16px; overflow-y: auto; }
  .panel h2 { font-size: 14px; color: #a78bfa; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }

  .left { grid-row: 1 / 3; }
  .center { grid-column: 2; }
  .right { grid-row: 1 / 3; }
  .bottom { grid-column: 2; }

  button { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; width: 100%; margin-bottom: 8px; transition: all 0.15s; }
  button:hover { background: #334155; border-color: #6ee7b7; }
  button.primary { background: #065f46; border-color: #6ee7b7; color: #6ee7b7; }
  button.primary:hover { background: #047857; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .btn-row button { flex: 1; }

  input[type="text"], textarea { width: 100%; background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 8px 12px; border-radius: 6px; font-size: 13px; margin-bottom: 8px; font-family: inherit; }
  input[type="text"]:focus, textarea:focus { outline: none; border-color: #6ee7b7; }
  textarea { resize: vertical; min-height: 60px; }

  input[type="file"] { display: none; }
  label.file-upload { display: block; background: #1e293b; border: 1px dashed #334155; padding: 12px; border-radius: 6px; text-align: center; cursor: pointer; font-size: 13px; color: #94a3b8; margin-bottom: 8px; }
  label.file-upload:hover { border-color: #6ee7b7; color: #6ee7b7; }

  .graph-svg { background: #111827; border: 1px solid #1e293b; border-radius: 6px; margin-bottom: 12px; min-height: 180px; overflow: hidden; display: flex; align-items: center; justify-content: center; color: #475569; font-size: 13px; }
  .graph-svg svg { max-width: 100%; max-height: 100%; }

  .wave-log { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; line-height: 1.8; }
  .wave-log .wave-header { color: #a78bfa; font-weight: 600; margin-top: 12px; }
  .wave-log .wave-header:first-child { margin-top: 0; }
  .wave-log .node-entry { padding-left: 16px; border-left: 2px solid #1e293b; margin-left: 4px; }
  .wave-log .node-entry.ok { border-left-color: #6ee7b7; }
  .wave-log .node-entry.skip { border-left-color: #fbbf24; }
  .wave-log .node-entry.err { border-left-color: #f43f5e; }
  .wave-log .confidence { color: #6ee7b7; }
  .wave-log .effects { color: #fbbf24; }
  .wave-log .error { color: #f43f5e; }
  .wave-log .recovery { color: #fbbf24; background: #422006; padding: 2px 6px; border-radius: 3px; }
  .wave-log .violation { color: #f43f5e; background: #450a0a; padding: 2px 6px; border-radius: 3px; }

  .verify-list { list-style: none; }
  .verify-list li { padding: 6px 0; border-bottom: 1px solid #1e293b; font-size: 13px; display: flex; justify-content: space-between; }
  .verify-list .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge.verified { background: #065f46; color: #6ee7b7; }
  .badge.failed { background: #7f1d1d; color: #f43f5e; }
  .badge.timeout { background: #78350f; color: #fbbf24; }
  .badge.unsupported { background: #1e293b; color: #94a3b8; }

  .stat-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #1e293b; font-size: 13px; }
  .stat-row .label { color: #94a3b8; }
  .stat-row .value { color: #e2e8f0; font-weight: 500; }
  .stat-row .value.green { color: #6ee7b7; }
  .stat-row .value.red { color: #f43f5e; }
  .stat-row .value.yellow { color: #fbbf24; }

  .output-area { font-family: 'Cascadia Code', 'Fira Code', monospace; font-size: 12px; background: #111827; border: 1px solid #1e293b; border-radius: 6px; padding: 12px; overflow-y: auto; max-height: 160px; white-space: pre-wrap; word-break: break-all; }

  .links { margin-top: 8px; }
  .links a { color: #6ee7b7; text-decoration: none; font-size: 13px; display: block; padding: 4px 0; }
  .links a:hover { text-decoration: underline; }

  .progress-bar { height: 4px; background: #1e293b; border-radius: 2px; margin-bottom: 12px; overflow: hidden; }
  .progress-bar .fill { height: 100%; background: #6ee7b7; transition: width 0.3s; border-radius: 2px; }

  .empty { color: #475569; font-size: 13px; text-align: center; padding: 24px; }

  #executing-spinner { display: none; }
  #executing-spinner.active { display: inline-block; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="header">
  <h1>AETHER <span style="color:#94a3b8;font-weight:400">Dashboard</span></h1>
  <div class="meta">
    <span id="graph-label">${graphId ? `${graphId} v${graphVersion ?? 1}` : "No graph loaded"}</span>
    &nbsp;·&nbsp;
    <span id="node-count">${nodeCount ?? 0} nodes</span>
    &nbsp;·&nbsp;
    <span id="mode-label">${mode ?? "mock"}</span>
  </div>
  <div class="status">
    <span id="executing-spinner">⟳</span>
    <span id="server-status"><span class="dot green"></span> Connected</span>
  </div>
</div>

<div class="layout">
  <!-- Left Panel: Graph & Controls -->
  <div class="panel left">
    <h2>Graph</h2>
    <div class="graph-svg" id="graph-container">Loading...</div>

    <h2>Actions</h2>
    <button class="primary" id="btn-execute" onclick="doExecute()">Execute</button>
    <div class="btn-row">
      <button id="btn-validate" onclick="doValidate()">Validate</button>
      <button id="btn-optimize" onclick="doOptimize()">Optimize</button>
    </div>
    <div class="btn-row">
      <button onclick="doVerify()">Verify</button>
      <button onclick="doTypeCheck()">Type Check</button>
    </div>

    <h2 style="margin-top:16px">Load Graph</h2>
    <label class="file-upload" for="graph-file">
      Drop or click to upload JSON graph
      <input type="file" id="graph-file" accept=".json" onchange="uploadGraph(this)">
    </label>

    <h2 style="margin-top:16px">AI Generate</h2>
    <textarea id="ai-description" placeholder="Describe your pipeline..."></textarea>
    <button onclick="doAiGenerate()">Generate Graph</button>
  </div>

  <!-- Center Panel: Live Results -->
  <div class="panel center">
    <h2>Execution Log</h2>
    <div class="progress-bar"><div class="fill" id="exec-progress" style="width:0%"></div></div>
    <div class="wave-log" id="wave-log">
      <div class="empty">Click "Execute" to run the pipeline</div>
    </div>
  </div>

  <!-- Right Panel: Verification Status -->
  <div class="panel right">
    <h2>Verification</h2>
    <div id="verify-stats">
      <div class="stat-row"><span class="label">Verified</span><span class="value" id="stat-verified">—</span></div>
      <div class="stat-row"><span class="label">Failed</span><span class="value" id="stat-failed">—</span></div>
      <div class="stat-row"><span class="label">Coverage</span><span class="value green" id="stat-coverage">—</span></div>
    </div>
    <h2 style="margin-top:16px">Type Safety</h2>
    <div id="type-stats">
      <div class="stat-row"><span class="label">Edges Checked</span><span class="value" id="stat-edges">—</span></div>
      <div class="stat-row"><span class="label">Compatible</span><span class="value green" id="stat-compatible">—</span></div>
      <div class="stat-row"><span class="label">Errors</span><span class="value" id="stat-type-errors">—</span></div>
    </div>
    <h2 style="margin-top:16px">Per-Node Status</h2>
    <ul class="verify-list" id="verify-list">
      <li class="empty">No data yet</li>
    </ul>

    <h2 style="margin-top:16px">Effects</h2>
    <div id="effect-stats">
      <div class="stat-row"><span class="label">Total Declared</span><span class="value" id="stat-effects-total">—</span></div>
      <div class="stat-row"><span class="label">Pure Nodes</span><span class="value green" id="stat-pure">—</span></div>
    </div>
  </div>

  <!-- Bottom Panel: Output -->
  <div class="panel bottom">
    <h2>Output</h2>
    <div class="output-area" id="output-area">No execution output yet.</div>
    <div class="links" id="output-links"></div>
  </div>
</div>

<script>
const API = "";

async function fetchJSON(url, options) {
  try {
    const res = await fetch(API + url, options);
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (e) {
    console.error("API error:", e);
    return null;
  }
}

async function loadVisualization() {
  try {
    const res = await fetch(API + "/api/visualize");
    if (res.ok) {
      const html = await res.text();
      const m = html.match(/<svg[\\s\\S]*?<\\/svg>/i);
      if (m) {
        document.getElementById("graph-container").innerHTML = m[0];
      } else {
        document.getElementById("graph-container").innerHTML = html;
      }
    }
  } catch {}
}

async function loadDashboardData() {
  const data = await fetchJSON("/api/dashboard");
  if (!data) return;

  document.getElementById("graph-label").textContent = data.graph.id + " v" + data.graph.version;
  document.getElementById("node-count").textContent = data.graph.nodeCount + " nodes";

  // Verification
  document.getElementById("stat-verified").textContent = data.verification.byNode.filter(n => n.status === "verified").length;
  document.getElementById("stat-failed").textContent = data.verification.byNode.filter(n => n.status === "failed").length;
  document.getElementById("stat-coverage").textContent = data.verification.percentage.toFixed(0) + "%";
  document.getElementById("stat-coverage").className = "value " + (data.verification.percentage >= 80 ? "green" : data.verification.percentage >= 50 ? "yellow" : "red");

  // Type safety
  document.getElementById("stat-edges").textContent = data.typeSafety.edgesChecked;
  document.getElementById("stat-compatible").textContent = data.typeSafety.compatible;
  document.getElementById("stat-type-errors").textContent = data.typeSafety.errors;
  document.getElementById("stat-type-errors").className = "value " + (data.typeSafety.errors > 0 ? "red" : "green");

  // Effects
  document.getElementById("stat-effects-total").textContent = data.effects.totalDeclared;
  document.getElementById("stat-pure").textContent = data.effects.pureNodes;

  // Per-node verification list
  const list = document.getElementById("verify-list");
  list.innerHTML = data.verification.byNode.map(n => {
    const cls = n.status === "verified" ? "verified" : n.status === "failed" ? "failed" : n.status === "supervised" ? "timeout" : "unsupported";
    return '<li><span>' + n.nodeId + '</span><span class="badge ' + cls + '">' + n.status + '</span></li>';
  }).join("");
}

async function doExecute() {
  const btn = document.getElementById("btn-execute");
  const spinner = document.getElementById("executing-spinner");
  const log = document.getElementById("wave-log");
  const progress = document.getElementById("exec-progress");

  btn.disabled = true;
  spinner.classList.add("active");
  log.innerHTML = '<div class="wave-header">Starting execution...</div>';
  progress.style.width = "0%";

  // Use SSE for streaming
  const es = new EventSource(API + "/api/execute/stream");
  let totalWaves = 1;
  let completedWaves = 0;

  es.onmessage = function(event) {
    const data = JSON.parse(event.data);

    if (data.type === "wave_start") {
      totalWaves = Math.max(totalWaves, data.wave + 1);
      const nodes = data.nodes.join(", ");
      log.innerHTML += '<div class="wave-header">Wave ' + data.wave + ': [' + nodes + ']</div>';
    }

    if (data.type === "node_complete") {
      const r = data.result;
      const cls = r.error ? "err" : r.skipped ? "skip" : "ok";
      let html = '<div class="node-entry ' + cls + '">';
      html += (r.skipped ? "⊘" : r.error ? "✗" : "✓") + " " + r.nodeId;
      html += ' <span class="confidence">[' + r.confidence.toFixed(2) + ']</span>';
      html += ' ' + r.duration_ms.toFixed(0) + 'ms';
      if (r.effects.length) html += ' <span class="effects">[' + r.effects.join(", ") + ']</span>';
      if (r.error) html += ' <span class="error">' + r.error + '</span>';
      html += '</div>';
      log.innerHTML += html;
    }

    if (data.type === "wave_complete") {
      completedWaves++;
      progress.style.width = Math.round((completedWaves / totalWaves) * 100) + "%";
    }

    if (data.type === "contract_check") {
      const c = data.check;
      if (!c.passed) {
        log.innerHTML += '<div class="node-entry err"><span class="violation">CONTRACT ' + c.kind + ': ' + c.expression + '</span></div>';
      }
    }

    if (data.type === "recovery") {
      log.innerHTML += '<div class="node-entry skip"><span class="recovery">RECOVERY: ' + data.condition + ' → ' + data.action + '</span></div>';
    }

    if (data.type === "complete") {
      es.close();
      progress.style.width = "100%";
      btn.disabled = false;
      spinner.classList.remove("active");

      const r = data.result;
      log.innerHTML += '<div class="wave-header" style="color:#6ee7b7">Complete: ' + r.nodesExecuted + ' executed, ' + r.nodesSkipped + ' skipped, ' + r.waves + ' waves, ' + r.duration_ms.toFixed(0) + 'ms</div>';

      // Update output
      document.getElementById("output-area").textContent = JSON.stringify(r.outputs, null, 2);

      // Refresh dashboard data
      loadDashboardData();
      loadVisualization();
    }

    if (data.type === "error") {
      es.close();
      btn.disabled = false;
      spinner.classList.remove("active");
      log.innerHTML += '<div class="wave-header" style="color:#f43f5e">Error: ' + data.message + '</div>';
    }
  };

  es.onerror = function() {
    es.close();
    btn.disabled = false;
    spinner.classList.remove("active");
  };
}

async function doValidate() {
  const data = await fetchJSON("/api/validate", { method: "POST" });
  if (!data) return;
  const log = document.getElementById("wave-log");
  if (data.valid) {
    log.innerHTML = '<div class="wave-header" style="color:#6ee7b7">Validation: PASSED</div>';
    if (data.warnings?.length) log.innerHTML += data.warnings.map(w => '<div class="node-entry skip">' + w + '</div>').join("");
  } else {
    log.innerHTML = '<div class="wave-header" style="color:#f43f5e">Validation: FAILED</div>';
    log.innerHTML += (data.errors || []).map(e => '<div class="node-entry err">' + e + '</div>').join("");
  }
}

async function doOptimize() {
  const data = await fetchJSON("/api/optimize", { method: "POST" });
  if (!data) return;
  const log = document.getElementById("wave-log");
  log.innerHTML = '<div class="wave-header">Optimization Suggestions (' + data.length + ')</div>';
  log.innerHTML += data.map(s => '<div class="node-entry ok">[' + s.priority + '] ' + s.type + ': ' + s.description + '</div>').join("");
}

async function doVerify() {
  const data = await fetchJSON("/api/verify", { method: "POST" });
  if (!data) return;
  const log = document.getElementById("wave-log");
  log.innerHTML = '<div class="wave-header">Z3 Verification: ' + data.nodes_verified + '/' + (data.nodes_verified + data.nodes_failed) + ' verified</div>';
  loadDashboardData();
}

async function doTypeCheck() {
  const data = await fetchJSON("/api/check", { method: "POST" });
  if (!data) return;
  const log = document.getElementById("wave-log");
  if (data.compatible !== undefined) {
    log.innerHTML = '<div class="wave-header">Type Check: ' + data.compatible + '/' + data.edgesChecked + ' compatible</div>';
    if (data.errors?.length) log.innerHTML += data.errors.map(e => '<div class="node-entry err">' + (e.message || e) + '</div>').join("");
  } else {
    log.innerHTML = '<div class="wave-header">Type Check: complete</div>';
  }
}

function uploadGraph(input) {
  if (!input.files.length) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const res = await fetch(API + "/api/graph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: e.target.result
    });
    if (res.ok) {
      location.reload();
    }
  };
  reader.readAsText(input.files[0]);
}

async function doAiGenerate() {
  const desc = document.getElementById("ai-description").value.trim();
  if (!desc) return;
  const log = document.getElementById("wave-log");
  log.innerHTML = '<div class="wave-header">Generating graph from description...</div>';
  const data = await fetchJSON("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: desc })
  });
  if (data?.success) {
    log.innerHTML = '<div class="wave-header" style="color:#6ee7b7">Generated: ' + data.graph.id + ' (' + data.graph.nodes.length + ' nodes)</div>';
    loadDashboardData();
    loadVisualization();
  } else {
    log.innerHTML = '<div class="wave-header" style="color:#f43f5e">Generation failed</div>';
  }
}

// Initial load
loadVisualization();
loadDashboardData();

// Poll for updates every 5s
setInterval(loadDashboardData, 5000);
</script>
</body>
</html>`;
}
