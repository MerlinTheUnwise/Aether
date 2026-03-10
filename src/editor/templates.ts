/**
 * AETHER Graph Editor — HTML/JS/CSS Templates
 *
 * Provides the inline CSS, SVG canvas, and JavaScript for the interactive editor.
 * All templates are returned as strings for embedding in a self-contained HTML file.
 */

export function editorCSS(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0f1a; color: #e2e8f0; font-family: 'Inter', system-ui, sans-serif;
      overflow: hidden; height: 100vh; width: 100vw;
    }
    #toolbar {
      position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 100;
      background: #1e293b; border-bottom: 1px solid #334155;
      display: flex; align-items: center; padding: 0 16px; gap: 8px;
    }
    #toolbar h1 { font-size: 14px; font-weight: 600; color: #6ee7b7; margin-right: 16px; }
    .tb-btn {
      background: #334155; border: 1px solid #475569; color: #e2e8f0;
      padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
      transition: background 0.15s; white-space: nowrap;
    }
    .tb-btn:hover { background: #475569; }
    .tb-btn.primary { background: #059669; border-color: #059669; color: #fff; }
    .tb-btn.primary:hover { background: #047857; }
    .tb-btn.active { background: #6ee7b7; color: #0a0f1a; border-color: #6ee7b7; }
    .tb-sep { width: 1px; height: 24px; background: #475569; margin: 0 4px; }
    .tb-dropdown {
      position: relative; display: inline-block;
    }
    .tb-dropdown-menu {
      position: absolute; top: 100%; left: 0; background: #1e293b; border: 1px solid #475569;
      border-radius: 6px; padding: 4px 0; min-width: 180px; z-index: 300;
      display: none; box-shadow: 0 4px 12px #0005; margin-top: 4px;
    }
    .tb-dropdown-menu.open { display: block; }
    .tb-dropdown-item {
      padding: 6px 16px; cursor: pointer; font-size: 12px; color: #e2e8f0;
      display: flex; align-items: center; gap: 8px;
    }
    .tb-dropdown-item:hover { background: #334155; }
    .tb-dropdown-item .item-label { font-weight: 600; }
    .tb-dropdown-item .item-desc { color: #94a3b8; font-size: 10px; }
    #canvas-container {
      position: fixed; top: 48px; left: 0; right: 0; bottom: 36px;
      overflow: hidden; cursor: grab;
    }
    #canvas-container.dragging { cursor: grabbing; }
    #canvas-container.connecting { cursor: crosshair; }
    #canvas-container.selecting { cursor: crosshair; }
    svg#canvas { width: 100%; height: 100%; }
    .grid-bg { fill: url(#grid-pattern); }
    .node-group { cursor: move; }
    .node-rect {
      rx: 8; ry: 8; stroke-width: 2; transition: filter 0.15s;
    }
    .node-group:hover .node-rect { filter: brightness(1.15); }
    .node-group.selected .node-rect { stroke-dasharray: 4 2; }
    .node-group.multi-selected .node-rect { stroke: #6ee7b7 !important; stroke-width: 3; stroke-dasharray: 6 3; }
    .node-group.error .node-rect { stroke: #f43f5e !important; stroke-width: 3; }
    .node-header {
      fill: none; font-size: 13px; font-weight: 600; dominant-baseline: middle;
    }
    .node-label { fill: #e2e8f0; font-size: 11px; dominant-baseline: middle; }
    .port-circle {
      r: 6; stroke-width: 2; cursor: crosshair; transition: r 0.1s;
    }
    .port-circle:hover { r: 8; }
    .port-label {
      fill: #94a3b8; font-size: 9px; dominant-baseline: middle;
    }
    .confidence-badge {
      font-size: 10px; font-weight: 700; dominant-baseline: middle; text-anchor: end;
    }
    .effect-pill {
      rx: 4; ry: 4; fill: #a78bfa22; stroke: #a78bfa; stroke-width: 1;
    }
    .effect-text { fill: #a78bfa; font-size: 9px; dominant-baseline: middle; }
    .edge-path {
      fill: none; stroke-width: 2; cursor: pointer; transition: stroke-width 0.15s;
    }
    .edge-path:hover { stroke-width: 3.5; }
    .edge-path.selected { stroke-dasharray: 6 3; stroke-width: 3; }
    .recovery-badge {
      fill: #fbbf2433; stroke: #fbbf24; stroke-width: 1; rx: 3; ry: 3;
    }
    .recovery-text { fill: #fbbf24; font-size: 9px; dominant-baseline: middle; }
    .supervised-badge {
      fill: #38bdf833; stroke: #38bdf8; stroke-width: 1; rx: 3; ry: 3;
    }
    .supervised-text { fill: #38bdf8; font-size: 9px; dominant-baseline: middle; }

    /* Selection rectangle */
    .selection-rect {
      fill: #6ee7b711; stroke: #6ee7b7; stroke-width: 1; stroke-dasharray: 4 2;
    }

    /* Minimap */
    #minimap {
      position: fixed; bottom: 44px; right: 8px; width: 180px; height: 120px;
      background: #1e293b; border: 1px solid #334155; border-radius: 6px;
      overflow: hidden; z-index: 50;
    }
    #minimap svg { width: 100%; height: 100%; }
    #minimap .viewport-rect {
      fill: #6ee7b744; stroke: #6ee7b7; stroke-width: 1;
    }

    /* Template palette sidebar */
    #template-palette {
      position: fixed; top: 48px; right: 0; width: 280px; bottom: 36px;
      background: #1e293b; border-left: 1px solid #334155;
      overflow-y: auto; z-index: 80; display: none; padding: 12px;
    }
    #template-palette.visible { display: block; }
    #template-palette h3 { font-size: 13px; color: #6ee7b7; margin-bottom: 12px; }
    .tpl-card {
      background: #0f172a; border: 1px solid #334155; border-radius: 8px;
      padding: 12px; margin-bottom: 10px; cursor: pointer; transition: border-color 0.15s;
    }
    .tpl-card:hover { border-color: #6ee7b7; }
    .tpl-card .tpl-name { font-size: 12px; font-weight: 600; color: #e2e8f0; margin-bottom: 4px; }
    .tpl-card .tpl-desc { font-size: 10px; color: #94a3b8; margin-bottom: 6px; }
    .tpl-card .tpl-params { font-size: 10px; color: #a78bfa; }
    .tpl-card .tpl-nodes { font-size: 10px; color: #6ee7b7; margin-top: 4px; }

    /* Binding form */
    .binding-form label { display: block; font-size: 11px; color: #94a3b8; margin: 8px 0 2px; }
    .binding-form input, .binding-form select {
      width: 100%; background: #0f172a; border: 1px solid #334155; color: #e2e8f0;
      padding: 6px 8px; border-radius: 4px; font-size: 11px;
    }
    .binding-form .kind-tag {
      display: inline-block; background: #a78bfa33; color: #a78bfa; font-size: 9px;
      padding: 1px 6px; border-radius: 3px; margin-left: 4px;
    }

    /* Error panel */
    #error-panel {
      position: fixed; bottom: 36px; left: 0; right: 0; max-height: 180px;
      background: #1e293b; border-top: 1px solid #334155; overflow-y: auto;
      display: none; z-index: 90; padding: 8px 16px; font-size: 12px;
    }
    #error-panel.visible { display: block; }
    #error-panel .err-row { padding: 4px 0; border-bottom: 1px solid #1a2332; }
    #error-panel .err-icon { color: #f43f5e; margin-right: 6px; }
    #error-panel .warn-icon { color: #fbbf24; margin-right: 6px; }
    #error-panel .ok-icon { color: #6ee7b7; }

    /* Status bar */
    #status-bar {
      position: fixed; bottom: 0; left: 0; right: 0; height: 36px;
      background: #1e293b; border-top: 1px solid #334155;
      display: flex; align-items: center; padding: 0 16px; gap: 16px;
      font-size: 11px; color: #94a3b8; z-index: 100;
    }
    #status-bar .stat { display: flex; align-items: center; gap: 4px; }
    #status-bar .dot { width: 8px; height: 8px; border-radius: 50%; }
    #status-bar .dot.green { background: #6ee7b7; }
    #status-bar .dot.red { background: #f43f5e; }
    #status-bar .dot.yellow { background: #fbbf24; }
    #status-bar .dirty-indicator { color: #fbbf24; font-weight: 600; }
    #status-bar .clean-indicator { color: #6ee7b7; }

    /* Modal */
    .modal-overlay {
      position: fixed; inset: 0; background: #000a; z-index: 200;
      display: flex; align-items: center; justify-content: center;
    }
    .modal {
      background: #1e293b; border: 1px solid #475569; border-radius: 10px;
      padding: 24px; min-width: 420px; max-width: 600px; max-height: 80vh;
      overflow-y: auto;
    }
    .modal h2 { font-size: 16px; color: #6ee7b7; margin-bottom: 16px; }
    .modal label { display: block; font-size: 12px; color: #94a3b8; margin: 10px 0 4px; }
    .modal input, .modal textarea, .modal select {
      width: 100%; background: #0f172a; border: 1px solid #334155; color: #e2e8f0;
      padding: 8px 10px; border-radius: 6px; font-size: 12px; font-family: inherit;
    }
    .modal textarea { min-height: 60px; resize: vertical; }
    .modal .btn-row { display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end; }
    .modal .port-row {
      display: flex; gap: 8px; align-items: center; margin: 4px 0;
    }
    .modal .port-row input { flex: 1; }
    .modal .port-row select { width: 100px; flex: 0 0 100px; }
    .modal .port-row .port-extras { display: flex; gap: 4px; align-items: center; }
    .modal .port-row .port-extras label { display: inline; font-size: 10px; margin: 0; }
    .modal .port-row .port-extras input[type="checkbox"] { width: auto; margin: 0; }
    .modal .remove-btn {
      background: #f43f5e33; border: 1px solid #f43f5e; color: #f43f5e;
      width: 28px; height: 28px; border-radius: 4px; cursor: pointer;
      display: flex; align-items: center; justify-content: center; font-size: 14px;
    }
    .modal .add-port-btn {
      background: none; border: 1px dashed #475569; color: #94a3b8;
      padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 11px;
      margin-top: 4px;
    }
    .modal .add-port-btn:hover { border-color: #6ee7b7; color: #6ee7b7; }

    /* Contract template chips */
    .contract-chips {
      display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px;
    }
    .contract-chip {
      background: #334155; border: 1px solid #475569; color: #94a3b8;
      padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 10px;
      transition: border-color 0.15s;
    }
    .contract-chip:hover { border-color: #6ee7b7; color: #6ee7b7; }

    /* Context menu */
    #context-menu {
      position: fixed; background: #1e293b; border: 1px solid #475569;
      border-radius: 6px; padding: 4px 0; min-width: 180px; z-index: 300;
      display: none; box-shadow: 0 4px 12px #0005;
    }
    #context-menu .ctx-item {
      padding: 6px 16px; cursor: pointer; font-size: 12px;
      display: flex; align-items: center; gap: 8px;
    }
    #context-menu .ctx-item:hover { background: #334155; }
    #context-menu .ctx-item.danger { color: #f43f5e; }
    #context-menu .ctx-sep { height: 1px; background: #334155; margin: 4px 0; }

    /* State diagram */
    .state-node { fill: #1e293b; stroke: #6ee7b7; stroke-width: 2; rx: 20; ry: 20; }
    .state-label { fill: #e2e8f0; font-size: 11px; text-anchor: middle; dominant-baseline: middle; }
    .state-transition { fill: none; stroke: #475569; stroke-width: 1.5; }
    .state-transition.never { stroke: #f43f5e; stroke-dasharray: 4 3; }

    /* Quick-add toolbar */
    #quick-add-bar {
      display: flex; gap: 4px; align-items: center;
    }
    .qa-btn {
      background: #0f172a; border: 1px solid #475569; color: #94a3b8;
      padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 10px;
      transition: all 0.15s;
    }
    .qa-btn:hover { border-color: #6ee7b7; color: #6ee7b7; }
    .qa-btn.pure-btn { border-color: #059669; }
    .qa-btn.db-btn { border-color: #a78bfa; }
    .qa-btn.api-btn { border-color: #60a5fa; }
    .qa-btn.ml-btn { border-color: #fbbf24; }

    /* ─── Text Editor (View Modes) ─── */
    .view-btn { font-weight: 600; }
    .view-btn.active { background: #6ee7b7; color: #0a0f1a; border-color: #6ee7b7; }

    #text-editor-container {
      position: fixed; top: 48px; left: 0; right: 0; bottom: 36px;
      display: none; flex-direction: column; background: #0a0f1a;
    }
    #text-editor-container.visible { display: flex; }

    /* Split view: canvas and text side by side */
    body.split-view #canvas-container { right: 50%; }
    body.split-view #text-editor-container {
      display: flex; left: 50%; border-left: 2px solid #334155;
    }

    #text-editor-wrap {
      flex: 1; display: flex; position: relative; overflow: hidden;
    }
    #text-line-numbers {
      width: 48px; background: #0f172a; color: #475569; font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px; line-height: 20px; padding: 12px 8px 12px 0; text-align: right;
      overflow: hidden; user-select: none; border-right: 1px solid #1e293b;
    }
    #text-editor {
      flex: 1; background: #0a0f1a; color: #e2e8f0; border: none; outline: none; resize: none;
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px; line-height: 20px; padding: 12px 16px;
      tab-size: 2; white-space: pre; overflow: auto;
    }
    #text-highlight-overlay {
      position: absolute; top: 0; left: 48px; right: 0; bottom: 0;
      pointer-events: none; overflow: hidden;
      font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px; line-height: 20px; padding: 12px 16px;
      white-space: pre; color: transparent;
    }
    .hl-keyword { color: #6ee7b7; font-weight: 600; }
    .hl-field { color: #67e8f9; }
    .hl-annotation { color: #a78bfa; }
    .hl-comment { color: #64748b; font-style: italic; }
    .hl-string { color: #fbbf24; }
    .hl-number { color: #f472b6; }
    .hl-arrow { color: #6ee7b7; font-weight: 700; }
    .hl-boolean { color: #f472b6; }

    #text-error-bar {
      background: #1e293b; border-top: 1px solid #334155;
      padding: 6px 12px; font-size: 11px; color: #94a3b8;
      max-height: 80px; overflow-y: auto;
    }
    .text-error { color: #f43f5e; margin: 2px 0; }
    .text-ok { color: #6ee7b7; }
  `;
}

export function editorJS(graphJSON: string, templatesJSON: string): string {
  return `
(function() {
  'use strict';

  // ─── State ───
  let graph = ${graphJSON};
  let positions = {};
  let selectedNode = null;
  let selectedEdge = null;
  let dragNode = null;
  let dragOffset = { x: 0, y: 0 };
  let connecting = false;
  let connectFrom = null;
  let connectLine = null;
  let viewBox = { x: 0, y: 0, w: 1200, h: 800 };
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let zoom = 1;

  // Multi-select state
  let multiSelected = new Set();
  let isSelecting = false;
  let selectionStart = null;
  let selectionRect = null;
  let groupDragOffset = null;

  // Templates
  const templates = ${templatesJSON};

  const NODE_W = 220, NODE_H = 120, H_GAP = 80, V_GAP = 60;
  const HISTORY_LIMIT = 50;
  const PORT_COLORS = {
    String: '#60a5fa', Int: '#34d399', Float64: '#34d399', Bool: '#fb923c',
    List: '#a78bfa', Record: '#94a3b8', User: '#94a3b8'
  };

  // ─── History (Undo/Redo) ───
  const history = {
    past: [],
    present: null,
    future: [],
    push(g) {
      if (this.present !== null) {
        this.past.push(JSON.parse(JSON.stringify(this.present)));
        if (this.past.length > HISTORY_LIMIT) this.past.shift();
      }
      this.present = JSON.parse(JSON.stringify(g));
      this.future = [];
    },
    undo() {
      if (this.past.length === 0) return;
      this.future.push(JSON.parse(JSON.stringify(this.present)));
      this.present = this.past.pop();
      graph = JSON.parse(JSON.stringify(this.present));
      autoLayout();
      markDirty();
    },
    redo() {
      if (this.future.length === 0) return;
      this.past.push(JSON.parse(JSON.stringify(this.present)));
      this.present = this.future.pop();
      graph = JSON.parse(JSON.stringify(this.present));
      autoLayout();
      markDirty();
    }
  };

  // Initialize history with current graph
  history.push(graph);

  // ─── Dirty State ───
  let isDirty = false;
  function markDirty() {
    isDirty = true;
    updateDirtyIndicator();
  }
  function markClean() {
    isDirty = false;
    updateDirtyIndicator();
  }
  function updateDirtyIndicator() {
    const el = document.getElementById('dirty-indicator');
    if (el) {
      el.textContent = isDirty ? '\\u25CF Unsaved changes' : '\\u2713 Saved';
      el.className = isDirty ? 'dirty-indicator' : 'clean-indicator';
    }
  }

  // Record change and push to history
  function recordChange() {
    history.push(graph);
    markDirty();
  }

  function getPortColor(type) {
    return PORT_COLORS[type] || '#94a3b8';
  }

  function confidenceColor(c) {
    if (c >= 0.85) return '#6ee7b7';
    if (c >= 0.7) return '#fbbf24';
    return '#f43f5e';
  }

  // ─── Wave layout ───
  function computeWaves() {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const ids = new Set(nodes.map(n => n.id));
    if (ids.size === 0) return [];

    const adj = new Map(); const inDeg = new Map();
    for (const id of ids) { adj.set(id, new Set()); inDeg.set(id, 0); }
    for (const e of edges) {
      const f = e.from.split('.')[0], t = e.to.split('.')[0];
      if (f === t || !ids.has(f) || !ids.has(t)) continue;
      if (!adj.get(f).has(t)) { adj.get(f).add(t); inDeg.set(t, (inDeg.get(t)||0)+1); }
    }
    const waves = []; const rem = new Set(ids);
    while (rem.size > 0) {
      const wave = [];
      for (const id of rem) if ((inDeg.get(id)||0) === 0) wave.push(id);
      if (wave.length === 0) { waves.push([...rem]); break; }
      for (const id of wave) {
        rem.delete(id);
        for (const nx of (adj.get(id)||[])) inDeg.set(nx, (inDeg.get(nx)||0)-1);
      }
      waves.push(wave);
    }
    return waves;
  }

  function autoLayout() {
    const waves = computeWaves();
    positions = {};
    const PAD = 60;
    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w];
      const totalW = wave.length * NODE_W + (wave.length - 1) * H_GAP;
      const startX = PAD + (600 - totalW / 2);
      for (let i = 0; i < wave.length; i++) {
        positions[wave[i]] = {
          x: startX + i * (NODE_W + H_GAP),
          y: PAD + w * (NODE_H + V_GAP)
        };
      }
    }
    render();
    fitView();
  }

  function fitView() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of Object.values(positions)) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
    }
    if (!isFinite(minX)) { viewBox = { x: 0, y: 0, w: 1200, h: 800 }; }
    else {
      const pad = 80;
      viewBox = { x: minX - pad, y: minY - pad, w: maxX - minX + pad*2, h: maxY - minY + pad*2 };
    }
    updateViewBox();
  }

  // ─── SVG helpers ───
  const svgNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    const e = document.createElementNS(svgNS, tag);
    for (const [k,v] of Object.entries(attrs||{})) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ─── Render ───
  function render() {
    const svg = document.getElementById('canvas');
    const keep = ['defs', 'grid-bg-rect'];
    [...svg.children].forEach(c => {
      if (!keep.includes(c.id) && c.tagName !== 'defs') {
        if (c.classList && c.classList.contains('grid-bg')) return;
        svg.removeChild(c);
      }
    });

    const edgeGroup = el('g', { id: 'edges' }, svg);
    const nodeGroup = el('g', { id: 'nodes' }, svg);

    // Render edges
    (graph.edges || []).forEach((edge, idx) => {
      const fromParts = edge.from.split('.'), toParts = edge.to.split('.');
      const fromNode = fromParts[0], fromPort = fromParts.slice(1).join('.');
      const toNode = toParts[0], toPort = toParts.slice(1).join('.');

      const fp = positions[fromNode], tp = positions[toNode];
      if (!fp || !tp) return;

      const fromN = (graph.nodes||[]).find(n => n.id === fromNode);
      const toN = (graph.nodes||[]).find(n => n.id === toNode);
      const outPorts = fromN && !fromN.hole ? Object.keys(fromN.out || {}) : [];
      const inPorts = toN && !toN.hole ? Object.keys(toN.in || {}) : [];

      const fromIdx = outPorts.indexOf(fromPort);
      const toIdx = inPorts.indexOf(toPort);
      const fromY = fp.y + 36 + (fromIdx >= 0 ? fromIdx : 0) * 18;
      const toY = tp.y + 36 + (toIdx >= 0 ? toIdx : 0) * 18;

      const x1 = fp.x + NODE_W, y1 = fromY;
      const x2 = tp.x, y2 = toY;
      const cx = (x1 + x2) / 2;

      let color = '#6ee7b7';
      if (fromN && toN && !fromN.hole && !toN.hole) {
        const outType = (fromN.out || {})[fromPort];
        const inType = (toN.in || {})[toPort];
        if (outType && inType) {
          if (outType.type !== inType.type) color = '#f43f5e';
          else if (outType.domain && inType.domain && outType.domain !== inType.domain) color = '#fbbf24';
        }
      }

      const path = el('path', {
        d: 'M ' + x1 + ' ' + y1 + ' C ' + cx + ' ' + y1 + ' ' + cx + ' ' + y2 + ' ' + x2 + ' ' + y2,
        stroke: color, class: 'edge-path' + (selectedEdge === idx ? ' selected' : ''),
        'marker-end': 'url(#arrowhead-' + color.replace('#','') + ')',
        'data-idx': idx
      }, edgeGroup);

      path.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectedNode = null; selectedEdge = idx; multiSelected.clear(); render();
      });
    });

    // Render nodes
    (graph.nodes || []).forEach(node => {
      if (node.hole) return;
      const pos = positions[node.id];
      if (!pos) return;

      const isIntent = node.intent === true;
      const conf = node.confidence || 1.0;
      const effects = node.effects || [];
      const inPorts = Object.entries(node.in || {});
      const outPorts = Object.entries(node.out || {});
      const hasRecovery = node.recovery && Object.keys(node.recovery).length > 0;
      const isSupervised = !!node.supervised;

      const dynH = Math.max(NODE_H, 36 + Math.max(inPorts.length, outPorts.length) * 18 + (effects.length > 0 ? 22 : 0) + (hasRecovery ? 18 : 0));

      const isMulti = multiSelected.has(node.id);
      const g = el('g', {
        class: 'node-group' + (selectedNode === node.id ? ' selected' : '') + (isMulti ? ' multi-selected' : ''),
        transform: 'translate(' + pos.x + ',' + pos.y + ')',
        'data-id': node.id
      }, nodeGroup);

      const fill = node.pure ? '#0f2922' : '#1e293b';
      const stroke = isIntent ? '#a78bfa' : (isSupervised ? '#38bdf8' : (node.pure ? '#059669' : '#475569'));
      el('rect', {
        width: NODE_W, height: dynH, fill: fill, stroke: stroke,
        class: 'node-rect'
      }, g);

      el('line', { x1: 0, y1: 28, x2: NODE_W, y2: 28, stroke: stroke, 'stroke-opacity': '0.4' }, g);

      const headerText = el('text', { x: 10, y: 16, class: 'node-header', fill: '#e2e8f0' }, g);
      headerText.textContent = node.id;

      const confText = el('text', {
        x: NODE_W - 10, y: 16, class: 'confidence-badge',
        fill: confidenceColor(conf)
      }, g);
      confText.textContent = (conf * 100).toFixed(0) + '%';

      inPorts.forEach(([name, type], i) => {
        const py = 36 + i * 18;
        const c = el('circle', {
          cx: 0, cy: py, class: 'port-circle',
          fill: getPortColor(type.type), stroke: '#0a0f1a',
          'data-node': node.id, 'data-port': name, 'data-dir': 'in'
        }, g);
        const lab = el('text', { x: 12, y: py, class: 'port-label' }, g);
        lab.textContent = name;

        c.addEventListener('mouseup', (ev) => {
          if (connecting && connectFrom) {
            finishConnect(node.id, name, 'in');
            ev.stopPropagation();
          }
        });
      });

      outPorts.forEach(([name, type], i) => {
        const py = 36 + i * 18;
        const c = el('circle', {
          cx: NODE_W, cy: py, class: 'port-circle',
          fill: getPortColor(type.type), stroke: '#0a0f1a',
          'data-node': node.id, 'data-port': name, 'data-dir': 'out'
        }, g);
        const lab = el('text', { x: NODE_W - 12, y: py, class: 'port-label', 'text-anchor': 'end' }, g);
        lab.textContent = name;

        c.addEventListener('mousedown', (ev) => {
          ev.stopPropagation();
          startConnect(node.id, name, 'out', pos.x + NODE_W, pos.y + py);
        });
      });

      let ey = 36 + Math.max(inPorts.length, outPorts.length) * 18 + 4;
      if (effects.length > 0) {
        let ex = 6;
        effects.forEach(eff => {
          const tw = eff.length * 6 + 10;
          el('rect', { x: ex, y: ey, width: tw, height: 16, class: 'effect-pill' }, g);
          const t = el('text', { x: ex + 5, y: ey + 9, class: 'effect-text' }, g);
          t.textContent = eff;
          ex += tw + 4;
        });
        ey += 22;
      }

      if (hasRecovery) {
        el('rect', { x: 6, y: ey, width: 60, height: 14, class: 'recovery-badge' }, g);
        const rt = el('text', { x: 10, y: ey + 8, class: 'recovery-text' }, g);
        rt.textContent = 'recovery';
        ey += 18;
      }

      if (isSupervised) {
        el('rect', { x: hasRecovery ? 72 : 6, y: ey - (hasRecovery ? 18 : 0), width: 72, height: 14, class: 'supervised-badge' }, g);
        const st = el('text', { x: (hasRecovery ? 76 : 10), y: ey - (hasRecovery ? 18 : 0) + 8, class: 'supervised-text' }, g);
        st.textContent = 'supervised';
      }

      // Node drag (supports multi-select group drag)
      g.addEventListener('mousedown', (ev) => {
        if (ev.target.classList.contains('port-circle')) return;
        ev.stopPropagation();
        const svgPt = screenToSVG(ev.clientX, ev.clientY);

        if (ev.shiftKey) {
          // Shift-click: toggle multi-select
          if (multiSelected.has(node.id)) {
            multiSelected.delete(node.id);
          } else {
            multiSelected.add(node.id);
          }
          selectedNode = null; selectedEdge = null;
          render();
          return;
        }

        if (multiSelected.has(node.id) && multiSelected.size > 1) {
          // Dragging a multi-selected group
          dragNode = '__group__';
          groupDragOffset = {};
          for (const nid of multiSelected) {
            const np = positions[nid];
            if (np) groupDragOffset[nid] = { x: svgPt.x - np.x, y: svgPt.y - np.y };
          }
        } else {
          dragNode = node.id;
          dragOffset = { x: svgPt.x - pos.x, y: svgPt.y - pos.y };
          multiSelected.clear();
        }
        selectedNode = node.id; selectedEdge = null;
        render();
      });

      g.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        openNodeEditor(node.id);
      });

      g.addEventListener('contextmenu', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        showContextMenu(ev.clientX, ev.clientY, node.id);
      });
    });

    updateMinimap();
    validate();
    window.__AETHER_GRAPH__ = graph;
  }

  // Expose renderGraph for history undo/redo
  function renderGraph(g) {
    graph = JSON.parse(JSON.stringify(g));
    autoLayout();
  }

  // ─── Connection drawing ───
  function startConnect(nodeId, portName, dir, x, y) {
    connecting = true;
    connectFrom = { nodeId, portName, dir };
    document.getElementById('canvas-container').classList.add('connecting');

    const svg = document.getElementById('canvas');
    connectLine = el('line', {
      x1: x, y1: y, x2: x, y2: y,
      stroke: '#6ee7b7', 'stroke-width': 2, 'stroke-dasharray': '4 3',
      'pointer-events': 'none', id: 'connect-line'
    }, svg);
  }

  function finishConnect(nodeId, portName, dir) {
    if (!connectFrom || connectFrom.dir === dir) { cancelConnect(); return; }
    const from = connectFrom.dir === 'out' ? connectFrom : { nodeId, portName };
    const to = connectFrom.dir === 'in' ? connectFrom : { nodeId, portName };

    graph.edges = graph.edges || [];
    graph.edges.push({ from: from.nodeId + '.' + from.portName, to: to.nodeId + '.' + to.portName });
    cancelConnect();
    recordChange();
    render();
  }

  function cancelConnect() {
    connecting = false; connectFrom = null;
    document.getElementById('canvas-container').classList.remove('connecting');
    const cl = document.getElementById('connect-line');
    if (cl) cl.remove();
    connectLine = null;
  }

  // ─── Coordinate transform ───
  function screenToSVG(cx, cy) {
    const svg = document.getElementById('canvas');
    const rect = svg.getBoundingClientRect();
    return {
      x: viewBox.x + (cx - rect.left) / rect.width * viewBox.w,
      y: viewBox.y + (cy - rect.top) / rect.height * viewBox.h
    };
  }

  function updateViewBox() {
    const svg = document.getElementById('canvas');
    svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
  }

  // ─── Pan & Zoom & Selection ───
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('canvas-container');

    container.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.node-group') || ev.target.closest('.port-circle')) return;

      if (ev.shiftKey) {
        // Shift-drag: selection rectangle
        isSelecting = true;
        selectionStart = screenToSVG(ev.clientX, ev.clientY);
        const svg = document.getElementById('canvas');
        selectionRect = el('rect', {
          x: selectionStart.x, y: selectionStart.y, width: 0, height: 0,
          class: 'selection-rect'
        }, svg);
        container.classList.add('selecting');
        return;
      }

      isPanning = true; panStart = { x: ev.clientX, y: ev.clientY };
      container.classList.add('dragging');
      selectedNode = null; selectedEdge = null; multiSelected.clear();
      render();
    });

    window.addEventListener('mousemove', (ev) => {
      if (isSelecting && selectionRect && selectionStart) {
        const pt = screenToSVG(ev.clientX, ev.clientY);
        const x = Math.min(selectionStart.x, pt.x);
        const y = Math.min(selectionStart.y, pt.y);
        const w = Math.abs(pt.x - selectionStart.x);
        const h = Math.abs(pt.y - selectionStart.y);
        selectionRect.setAttribute('x', x);
        selectionRect.setAttribute('y', y);
        selectionRect.setAttribute('width', w);
        selectionRect.setAttribute('height', h);
        return;
      }
      if (isPanning) {
        const svg = document.getElementById('canvas');
        const rect = svg.getBoundingClientRect();
        const dx = (ev.clientX - panStart.x) / rect.width * viewBox.w;
        const dy = (ev.clientY - panStart.y) / rect.height * viewBox.h;
        viewBox.x -= dx; viewBox.y -= dy;
        panStart = { x: ev.clientX, y: ev.clientY };
        updateViewBox();
        updateMinimap();
      }
      if (dragNode === '__group__' && groupDragOffset) {
        const pt = screenToSVG(ev.clientX, ev.clientY);
        for (const nid of multiSelected) {
          const off = groupDragOffset[nid];
          if (off) positions[nid] = { x: pt.x - off.x, y: pt.y - off.y };
        }
        render();
      } else if (dragNode) {
        const pt = screenToSVG(ev.clientX, ev.clientY);
        positions[dragNode] = { x: pt.x - dragOffset.x, y: pt.y - dragOffset.y };
        render();
      }
      if (connecting && connectLine) {
        const pt = screenToSVG(ev.clientX, ev.clientY);
        connectLine.setAttribute('x2', pt.x);
        connectLine.setAttribute('y2', pt.y);
      }
    });

    window.addEventListener('mouseup', (ev) => {
      if (isSelecting && selectionRect && selectionStart) {
        // Compute selection
        const pt = screenToSVG(ev.clientX, ev.clientY);
        const sx = Math.min(selectionStart.x, pt.x);
        const sy = Math.min(selectionStart.y, pt.y);
        const sw = Math.abs(pt.x - selectionStart.x);
        const sh = Math.abs(pt.y - selectionStart.y);

        multiSelected.clear();
        for (const [id, p] of Object.entries(positions)) {
          if (p.x >= sx && p.y >= sy && p.x + NODE_W <= sx + sw && p.y + NODE_H <= sy + sh) {
            multiSelected.add(id);
          }
        }
        selectionRect.remove();
        selectionRect = null;
        selectionStart = null;
        isSelecting = false;
        container.classList.remove('selecting');
        selectedNode = null; selectedEdge = null;
        render();
        return;
      }
      isPanning = false; dragNode = null; groupDragOffset = null;
      container.classList.remove('dragging');
      if (connecting) cancelConnect();
    });

    container.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY > 0 ? 1.1 : 0.9;
      const svg = document.getElementById('canvas');
      const rect = svg.getBoundingClientRect();
      const mx = viewBox.x + (ev.clientX - rect.left) / rect.width * viewBox.w;
      const my = viewBox.y + (ev.clientY - rect.top) / rect.height * viewBox.h;

      viewBox.w *= factor; viewBox.h *= factor;
      viewBox.x = mx - (ev.clientX - rect.left) / rect.width * viewBox.w;
      viewBox.y = my - (ev.clientY - rect.top) / rect.height * viewBox.h;
      zoom /= factor;
      updateViewBox(); updateMinimap();
    }, { passive: false });

    // Keyboard shortcuts
    window.addEventListener('keydown', (ev) => {
      if (document.querySelector('.modal-overlay')) return;

      // Ctrl+Z / Ctrl+Shift+Z
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && !ev.shiftKey) {
        ev.preventDefault(); history.undo(); return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z' && ev.shiftKey) {
        ev.preventDefault(); history.redo(); return;
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Z') {
        ev.preventDefault(); history.redo(); return;
      }
      // Ctrl+S — save
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
        ev.preventDefault(); saveGraph(); return;
      }
      // Ctrl+O — open
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'o') {
        ev.preventDefault(); openFile(); return;
      }
      // Ctrl+N — new
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'n') {
        ev.preventDefault(); newGraph(); return;
      }

      // Delete / Backspace
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (multiSelected.size > 0) {
          for (const nid of multiSelected) deleteNode(nid);
          multiSelected.clear();
          recordChange();
          render();
          return;
        }
        if (selectedNode) { deleteNode(selectedNode); selectedNode = null; recordChange(); render(); }
        if (selectedEdge !== null) { graph.edges.splice(selectedEdge, 1); selectedEdge = null; recordChange(); render(); }
      }

      if (ev.key === 'Escape') {
        cancelConnect();
        closeModal();
        hideContextMenu();
        multiSelected.clear();
        render();
      }
    });

    // Warn on close if dirty
    window.addEventListener('beforeunload', (ev) => {
      if (isDirty) {
        ev.preventDefault();
        ev.returnValue = '';
      }
    });

    // Initial render
    if (graph.nodes && graph.nodes.length > 0) {
      autoLayout();
    } else {
      render();
      fitView();
    }
    updateDirtyIndicator();
  });

  // ─── Minimap ───
  function updateMinimap() {
    const mm = document.querySelector('#minimap svg');
    if (!mm) return;
    mm.innerHTML = '';
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of Object.values(positions)) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
    }
    if (!isFinite(minX)) return;
    const pad = 20;
    const fw = maxX - minX + pad*2, fh = maxY - minY + pad*2;
    mm.setAttribute('viewBox', (minX-pad) + ' ' + (minY-pad) + ' ' + fw + ' ' + fh);

    for (const [id, p] of Object.entries(positions)) {
      el('rect', { x: p.x, y: p.y, width: NODE_W, height: NODE_H, fill: '#334155', rx: 3, stroke: '#6ee7b7', 'stroke-width': 2 }, mm);
    }
    el('rect', {
      x: viewBox.x, y: viewBox.y, width: viewBox.w, height: viewBox.h,
      class: 'viewport-rect'
    }, mm);
  }

  // ─── Validation ───
  function validate() {
    const panel = document.getElementById('error-panel');
    const errors = [];
    const warnings = [];

    (graph.nodes || []).forEach(node => {
      if (node.hole) return;
      const conf = node.confidence || 1.0;
      if (conf < 0.85 && (!node.adversarial_check || !node.adversarial_check.break_if || node.adversarial_check.break_if.length === 0)) {
        errors.push('Node "' + node.id + '": confidence < 0.85 requires adversarial_check with break_if');
      }
      if (!node.pure && (node.effects || []).length > 0 && !node.recovery) {
        errors.push('Node "' + node.id + '": effectful non-pure node requires recovery block');
      }
      if (node.supervised) {
        warnings.push('Node "' + node.id + '": supervised (' + node.supervised.reason + ')');
      }
    });

    (graph.edges || []).forEach(edge => {
      const fromNode = edge.from.split('.')[0], fromPort = edge.from.split('.').slice(1).join('.');
      const toNode = edge.to.split('.')[0], toPort = edge.to.split('.').slice(1).join('.');
      const fn = (graph.nodes||[]).find(n => n.id === fromNode);
      const tn = (graph.nodes||[]).find(n => n.id === toNode);
      if (!fn) errors.push('Edge "' + edge.from + ' \\u2192 ' + edge.to + '": source node "' + fromNode + '" not found');
      if (!tn) errors.push('Edge "' + edge.from + ' \\u2192 ' + edge.to + '": target node "' + toNode + '" not found');
      if (fn && !fn.hole && fn.out && !fn.out[fromPort]) errors.push('Edge: port "' + fromPort + '" not found on "' + fromNode + '.out"');
      if (tn && !tn.hole && tn.in && !tn.in[toPort]) errors.push('Edge: port "' + toPort + '" not found on "' + toNode + '.in"');
    });

    let html = '';
    if (errors.length === 0 && warnings.length === 0) {
      html = '<span class="ok-icon">\\u2713</span> Valid \\u2014 ' + (graph.nodes||[]).length + ' nodes, ' + (graph.edges||[]).length + ' edges';
    } else {
      errors.forEach(e => { html += '<div class="err-row"><span class="err-icon">\\u2717</span>' + escHtml(e) + '</div>'; });
      warnings.forEach(w => { html += '<div class="err-row"><span class="warn-icon">\\u26A0</span>' + escHtml(w) + '</div>'; });
    }
    panel.innerHTML = html;
    panel.classList.add('visible');

    document.getElementById('stat-nodes').textContent = (graph.nodes||[]).length + ' nodes';
    document.getElementById('stat-edges').textContent = (graph.edges||[]).length + ' edges';
    const dot = document.getElementById('stat-dot');
    dot.className = 'dot ' + (errors.length > 0 ? 'red' : warnings.length > 0 ? 'yellow' : 'green');
    document.getElementById('stat-status').textContent = errors.length > 0 ? errors.length + ' errors' : warnings.length > 0 ? warnings.length + ' warnings' : 'valid';

    document.querySelectorAll('.node-group').forEach(g => g.classList.remove('error'));
    errors.forEach(e => {
      const m = e.match(/Node "([^"]+)"/);
      if (m) {
        const ng = document.querySelector('.node-group[data-id="' + m[1] + '"]');
        if (ng) ng.classList.add('error');
      }
    });
  }

  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ─── Node CRUD ───
  function deleteNode(id) {
    graph.nodes = (graph.nodes||[]).filter(n => n.id !== id);
    graph.edges = (graph.edges||[]).filter(e => !e.from.startsWith(id + '.') && !e.to.startsWith(id + '.'));
    delete positions[id];
  }

  // ─── Save / Load / New ───
  function saveGraph() {
    const json = JSON.stringify(graph, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (graph.id || 'untitled') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    markClean();
  }

  function saveCompact() {
    const compact = graphToCompact(graph);
    const blob = new Blob([compact], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (graph.id || 'untitled') + '.aether';
    a.click();
    URL.revokeObjectURL(url);
    markClean();
  }

  // Simplified compact emitter (forward conversion only)
  function graphToCompact(g) {
    let out = 'G:' + (g.id || 'untitled') + ' v' + (g.version || 1);
    if (g.effects && g.effects.length > 0) out += ' eff[' + g.effects.join(',') + ']';
    out += '\\n';

    (g.nodes || []).forEach(node => {
      if (node.hole) {
        out += 'H:' + node.id;
      } else if (node.intent) {
        out += 'I:' + node.id;
      } else {
        out += 'N:' + node.id;
      }

      const ins = Object.entries(node.in || {}).map(([n,t]) => n + ':' + (t.type || 'String')).join(',');
      const outs = Object.entries(node.out || {}).map(([n,t]) => n + ':' + (t.type || 'String')).join(',');
      out += ' (' + ins + ')->(' + outs + ')';

      if (node.effects && node.effects.length > 0) out += ' eff[' + node.effects.join(',') + ']';
      if (node.pure) out += ' pure';
      if (node.confidence !== undefined && node.confidence !== 1.0) out += ' c:' + node.confidence;
      out += '\\n';

      if (node.contract) {
        if (node.contract.pre && node.contract.pre.length) out += '  C[pre:' + node.contract.pre.join(' && ') + ']\\n';
        if (node.contract.post && node.contract.post.length) out += '  C[post:' + node.contract.post.join(' && ') + ']\\n';
        if (node.contract.invariants && node.contract.invariants.length) out += '  C[inv:' + node.contract.invariants.join(' && ') + ']\\n';
      }
      if (node.recovery) {
        for (const [cond, action] of Object.entries(node.recovery)) {
          let act = action.action;
          if (act === 'retry') act = 'retry' + (action.params?.max || 3) + (action.params?.backoff === 'exponential' ? 'exp' : '');
          else if (act === 'escalate') act = 'esc(' + (action.params?.message || action.params?.reason || '') + ')';
          else if (act === 'respond') act = 'rsp(' + (action.params?.status || 500) + ',' + (action.params?.body || '') + ')';
          else if (act === 'fallback') act = 'fb(' + (action.params?.value || action.params?.target || '') + ')';
          out += '  R[' + cond + '\\u2192' + act + ']\\n';
        }
      }
      if (node.adversarial_check && node.adversarial_check.break_if) {
        node.adversarial_check.break_if.forEach(b => { out += '  A[' + b + ']\\n'; });
      }
    });

    (g.edges || []).forEach(e => {
      out += 'E:' + e.from + '\\u2192' + e.to + '\\n';
    });

    return out;
  }

  function openFile() {
    if (isDirty && !confirm('You have unsaved changes. Continue?')) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.aether';
    input.onchange = (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result;
        try {
          if (file.name.endsWith('.aether')) {
            loadCompact(text);
          } else {
            loadJSON(text);
          }
        } catch (err) {
          alert('Failed to load: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function loadJSON(text) {
    graph = JSON.parse(text);
    history.push(graph);
    markClean();
    autoLayout();
  }

  function loadCompact(text) {
    // Simplified compact parser (handles most common forms)
    const g = { id: 'untitled', version: 1, effects: [], nodes: [], edges: [] };
    let currentNode = null;
    const lines = text.split('\\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//')) continue;

      if (trimmed.startsWith('G:')) {
        const parts = trimmed.substring(2).split(/\\s+/);
        g.id = parts[0];
        for (const p of parts) {
          if (p.startsWith('v')) g.version = parseInt(p.substring(1)) || 1;
          if (p.startsWith('eff[')) {
            g.effects = p.slice(4, -1).split(',').filter(Boolean);
          }
        }
        continue;
      }

      const nodeMatch = trimmed.match(/^([NIH]):([^\\s]+)\\s+\\(([^)]*)\\)->\\(([^)]*)\\)(.*)/);
      if (nodeMatch) {
        const [, prefix, id, insStr, outsStr, rest] = nodeMatch;
        const node = { id: id, in: {}, out: {}, effects: [], contract: {} };
        if (prefix === 'H') { node.hole = true; }
        if (prefix === 'I') { node.intent = true; }

        if (insStr.trim()) {
          insStr.split(',').forEach(p => {
            const [name, type] = p.trim().split(':');
            if (name) node.in[name.trim()] = { type: (type || 'String').trim() };
          });
        }
        if (outsStr.trim()) {
          outsStr.split(',').forEach(p => {
            const [name, type] = p.trim().split(':');
            if (name) node.out[name.trim()] = { type: (type || 'String').trim() };
          });
        }

        if (rest.includes('pure')) node.pure = true;
        const confMatch = rest.match(/c:([\\d.]+)/);
        if (confMatch) node.confidence = parseFloat(confMatch[1]);
        const effMatch = rest.match(/eff\\[([^\\]]*)\\]/);
        if (effMatch) node.effects = effMatch[1].split(',').filter(Boolean);

        g.nodes.push(node);
        currentNode = node;
        continue;
      }

      if (trimmed.startsWith('E:')) {
        const edgeStr = trimmed.substring(2);
        const parts = edgeStr.split(/\\u2192|->/).map(s => s.trim());
        if (parts.length === 2) g.edges.push({ from: parts[0], to: parts[1] });
        continue;
      }

      if (currentNode && trimmed.startsWith('C[')) {
        const inner = trimmed.slice(2, -1);
        if (inner.startsWith('pre:')) {
          currentNode.contract = currentNode.contract || {};
          currentNode.contract.pre = inner.substring(4).split(' && ').filter(Boolean);
        } else if (inner.startsWith('post:')) {
          currentNode.contract = currentNode.contract || {};
          currentNode.contract.post = inner.substring(5).split(' && ').filter(Boolean);
        } else if (inner.startsWith('inv:')) {
          currentNode.contract = currentNode.contract || {};
          currentNode.contract.invariants = inner.substring(4).split(' && ').filter(Boolean);
        }
        continue;
      }

      if (currentNode && trimmed.startsWith('R[')) {
        currentNode.recovery = currentNode.recovery || {};
        const inner = trimmed.slice(2, -1);
        const arrow = inner.indexOf('\\u2192') >= 0 ? '\\u2192' : '->';
        const [cond, act] = inner.split(arrow).map(s => s.trim());
        if (cond && act) {
          if (act.startsWith('retry')) {
            const num = parseInt(act.replace('retry','').replace('exp','')) || 3;
            currentNode.recovery[cond] = { action: 'retry', params: { max: num, backoff: act.includes('exp') ? 'exponential' : 'linear' } };
          } else if (act.startsWith('esc(')) {
            currentNode.recovery[cond] = { action: 'escalate', params: { message: act.slice(4,-1) } };
          } else if (act.startsWith('rsp(')) {
            const parts = act.slice(4,-1).split(',');
            currentNode.recovery[cond] = { action: 'respond', params: { status: parseInt(parts[0]) || 500 } };
          } else if (act.startsWith('fb(')) {
            currentNode.recovery[cond] = { action: 'fallback', params: { value: act.slice(3,-1) } };
          }
        }
        continue;
      }

      if (currentNode && trimmed.startsWith('A[')) {
        currentNode.adversarial_check = currentNode.adversarial_check || { break_if: [] };
        currentNode.adversarial_check.break_if.push(trimmed.slice(2, -1));
        continue;
      }
    }
    graph = g;
    history.push(graph);
    markClean();
    autoLayout();
  }

  function newGraph() {
    if (isDirty && !confirm('You have unsaved changes. Continue?')) return;
    const id = prompt('Graph ID:', 'new-graph');
    if (!id) return;
    const version = parseInt(prompt('Version:', '1')) || 1;
    graph = { id: id, version: version, effects: [], nodes: [], edges: [] };
    positions = {};
    history.push(graph);
    markClean();
    render();
    fitView();
  }

  // ─── Modal: Add/Edit Node ───
  function openNodeEditor(existingId, prefill) {
    const existing = existingId ? (graph.nodes||[]).find(n => n.id === existingId) : null;
    const isEdit = !!existing;
    const pf = prefill || {};

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });

    const modal = document.createElement('div');
    modal.className = 'modal';

    const confVal = existing ? (existing.confidence||1) : (pf.confidence || 0.95);
    const effectsVal = existing ? (existing.effects||[]).join(', ') : (pf.effects || []).join(', ');
    const pureVal = existing ? existing.pure : (pf.pure || false);
    const recoveryVal = existing && existing.recovery ? JSON.stringify(existing.recovery, null, 2) : (pf.recovery ? JSON.stringify(pf.recovery, null, 2) : '');
    const advVal = existing && existing.adversarial_check ? (existing.adversarial_check.break_if||[]).join('\\n') : (pf.adversarial ? pf.adversarial.join('\\n') : '');

    modal.innerHTML = '<h2>' + (isEdit ? 'Edit Node' : 'Add Node') + '</h2>' +
      '<label>Node ID</label><input id="m-id" value="' + (existing ? existing.id : '') + '" ' + (isEdit ? 'readonly' : '') + '>' +
      '<label>Confidence (0-1)</label><input id="m-conf" type="number" step="0.01" min="0" max="1" value="' + confVal + '">' +
      '<label>Effects (comma-separated)</label><input id="m-effects" value="' + effectsVal + '">' +
      '<div><input type="checkbox" id="m-pure" ' + (pureVal ? 'checked' : '') + '> <label style="display:inline" for="m-pure">Pure</label></div>' +
      '<label>Input Ports</label><div id="m-in-ports"></div><button class="add-port-btn" onclick="addPortRow(\\'in\\')">+ Add input port</button>' +
      '<label>Output Ports</label><div id="m-out-ports"></div><button class="add-port-btn" onclick="addPortRow(\\'out\\')">+ Add output port</button>' +
      '<label>Preconditions</label>' +
      '<div class="contract-chips" id="pre-chips">' +
        '<span class="contract-chip" data-expr="output.length > 0" data-target="m-pre">non-empty</span>' +
        '<span class="contract-chip" data-expr="output.length \\u2264 input.length" data-target="m-pre">filter</span>' +
        '<span class="contract-chip" data-expr="output.is_sorted" data-target="m-pre">sorted</span>' +
      '</div>' +
      '<textarea id="m-pre">' + (existing && existing.contract && existing.contract.pre ? existing.contract.pre.join('\\n') : '') + '</textarea>' +
      '<label>Postconditions</label>' +
      '<div class="contract-chips" id="post-chips">' +
        '<span class="contract-chip" data-expr="output.length > 0" data-target="m-post">non-empty</span>' +
        '<span class="contract-chip" data-expr="output.length \\u2264 input.length" data-target="m-post">filter/clean</span>' +
        '<span class="contract-chip" data-expr="output.is_sorted" data-target="m-post">sorted</span>' +
        '<span class="contract-chip" data-expr="output.distinct" data-target="m-post">no duplicates</span>' +
        '<span class="contract-chip" data-expr="\\u2200x \\u2208 output: x \\u2208 input" data-target="m-post">subset</span>' +
      '</div>' +
      '<textarea id="m-post">' + (existing && existing.contract && existing.contract.post ? existing.contract.post.join('\\n') : '') + '</textarea>' +
      '<label>Invariants</label><textarea id="m-inv">' + (existing && existing.contract && existing.contract.invariants ? existing.contract.invariants.join('\\n') : '') + '</textarea>' +
      '<div id="m-adv-section" style="display:none"><label>Adversarial break_if (one per line)</label><textarea id="m-adv">' + advVal + '</textarea></div>' +
      '<div id="m-recovery-section"><label>Recovery (JSON)</label><textarea id="m-recovery">' + recoveryVal + '</textarea></div>' +
      '<div class="btn-row"><button class="tb-btn" onclick="closeModal()">Cancel</button><button class="tb-btn primary" id="m-save">Save</button></div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Contract chip click handlers
    modal.querySelectorAll('.contract-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const target = document.getElementById(chip.dataset.target);
        if (target) {
          const current = target.value.trim();
          target.value = current ? current + '\\n' + chip.dataset.expr : chip.dataset.expr;
        }
      });
    });

    // Populate port rows
    const inPorts = existing ? Object.entries(existing.in || {}) : (pf.inPorts || []);
    const outPorts = existing ? Object.entries(existing.out || {}) : (pf.outPorts || []);
    inPorts.forEach(([n,t]) => addPortRow('in', n, typeof t === 'object' ? t.type : t));
    outPorts.forEach(([n,t]) => addPortRow('out', n, typeof t === 'object' ? t.type : t));

    function checkAdv() {
      const c = parseFloat(document.getElementById('m-conf').value);
      document.getElementById('m-adv-section').style.display = c < 0.85 ? 'block' : 'none';
    }
    document.getElementById('m-conf').addEventListener('input', checkAdv);
    checkAdv();

    document.getElementById('m-save').addEventListener('click', () => saveNode(isEdit, existingId));
  }

  window.addPortRow = function(dir, name, type) {
    const container = document.getElementById('m-' + dir + '-ports');
    const row = document.createElement('div');
    row.className = 'port-row';
    row.innerHTML = '<input placeholder="port name" value="' + (name||'') + '">' +
      '<select>' +
        '<option>String</option><option>Bool</option><option>Int</option><option>Float64</option>' +
        '<option>List&lt;String&gt;</option><option>List&lt;Record&gt;</option><option>Record</option>' +
      '</select>' +
      '<button class="remove-btn" onclick="this.parentElement.remove()">\\u00D7</button>';
    const sel = row.querySelector('select');
    if (type) {
      // Match type to select option
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].text === type || sel.options[i].value === type) {
          sel.selectedIndex = i; break;
        }
      }
      // Fallback: if type not in dropdown, just pick closest
      if (sel.value !== type) {
        const baseType = type.replace(/<.*>/, '');
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.startsWith(baseType)) { sel.selectedIndex = i; break; }
        }
      }
    }
    container.appendChild(row);
  };

  function saveNode(isEdit, existingId) {
    const id = document.getElementById('m-id').value.trim();
    if (!id) return alert('Node ID is required');

    if (!isEdit && (graph.nodes||[]).some(n => n.id === id)) return alert('Node ID already exists');

    const conf = parseFloat(document.getElementById('m-conf').value) || 0.95;
    const effects = document.getElementById('m-effects').value.split(',').map(s => s.trim()).filter(Boolean);
    const pure = document.getElementById('m-pure').checked;

    const inPorts = {}; const outPorts = {};
    document.querySelectorAll('#m-in-ports .port-row').forEach(row => {
      const name = row.querySelector('input').value.trim();
      const type = row.querySelector('select').value.replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      if (name) inPorts[name] = { type: type };
    });
    document.querySelectorAll('#m-out-ports .port-row').forEach(row => {
      const name = row.querySelector('input').value.trim();
      const type = row.querySelector('select').value.replace(/&lt;/g,'<').replace(/&gt;/g,'>');
      if (name) outPorts[name] = { type: type };
    });

    const pre = document.getElementById('m-pre').value.split('\\n').filter(Boolean);
    const post = document.getElementById('m-post').value.split('\\n').filter(Boolean);
    const inv = document.getElementById('m-inv').value.split('\\n').filter(Boolean);
    const contract = {};
    if (pre.length) contract.pre = pre;
    if (post.length) contract.post = post;
    if (inv.length) contract.invariants = inv;

    const node = { id: id, in: inPorts, out: outPorts, contract: contract, confidence: conf, effects: effects, pure: pure };

    if (conf < 0.85) {
      const adv = document.getElementById('m-adv').value.split('\\n').filter(Boolean);
      if (adv.length) node.adversarial_check = { break_if: adv };
    }

    const recoveryText = document.getElementById('m-recovery').value.trim();
    if (recoveryText) {
      try { node.recovery = JSON.parse(recoveryText); } catch(e) { /* skip invalid */ }
    }

    if (isEdit) {
      const idx = graph.nodes.findIndex(n => n.id === existingId);
      if (idx >= 0) graph.nodes[idx] = node;
    } else {
      graph.nodes = graph.nodes || [];
      graph.nodes.push(node);
      positions[id] = { x: viewBox.x + viewBox.w/2 - NODE_W/2, y: viewBox.y + viewBox.h/2 - NODE_H/2 };
    }
    closeModal();
    recordChange();
    render();
  }

  function closeModal() {
    const overlay = document.querySelector('.modal-overlay');
    if (overlay) overlay.remove();
  }
  window.closeModal = closeModal;

  // ─── Context Menu ───
  function showContextMenu(cx, cy, nodeId) {
    const menu = document.getElementById('context-menu');
    menu.style.left = cx + 'px';
    menu.style.top = cy + 'px';
    menu.style.display = 'block';

    let items = '<div class="ctx-item" data-action="edit">\\u270E Edit</div>';
    if (multiSelected.size > 1) {
      items += '<div class="ctx-sep"></div>';
      items += '<div class="ctx-item" data-action="align-h">\\u2194 Align Horizontally</div>';
      items += '<div class="ctx-item" data-action="align-v">\\u2195 Align Vertically</div>';
      items += '<div class="ctx-item" data-action="scope">\\u25A1 Create Scope from Selection</div>';
      items += '<div class="ctx-sep"></div>';
      items += '<div class="ctx-item danger" data-action="delete-group">\\u2717 Delete Selected (' + multiSelected.size + ')</div>';
    }
    items += '<div class="ctx-item danger" data-action="delete">\\u2717 Delete</div>';
    menu.innerHTML = items;

    menu.onclick = (ev) => {
      const action = ev.target.dataset.action;
      if (action === 'edit') openNodeEditor(nodeId);
      if (action === 'delete') { deleteNode(nodeId); recordChange(); render(); }
      if (action === 'delete-group') {
        for (const nid of multiSelected) deleteNode(nid);
        multiSelected.clear(); recordChange(); render();
      }
      if (action === 'align-h') {
        const yVals = [...multiSelected].map(id => positions[id]?.y || 0);
        const avgY = yVals.reduce((a,b) => a+b, 0) / yVals.length;
        for (const nid of multiSelected) { if (positions[nid]) positions[nid].y = avgY; }
        render();
      }
      if (action === 'align-v') {
        const xVals = [...multiSelected].map(id => positions[id]?.x || 0);
        const avgX = xVals.reduce((a,b) => a+b, 0) / xVals.length;
        for (const nid of multiSelected) { if (positions[nid]) positions[nid].x = avgX; }
        render();
      }
      if (action === 'scope') {
        const name = prompt('Scope name:', 'scope-' + Date.now());
        if (name) {
          graph.scopes = graph.scopes || [];
          graph.scopes.push({ id: name, nodes: [...multiSelected] });
          recordChange(); render();
        }
      }
      hideContextMenu();
    };
  }

  function hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
  }
  document.addEventListener('click', hideContextMenu);

  // ─── Quick-Add Node Presets ───
  window.quickAddPure = function() {
    openNodeEditor(null, { pure: true, effects: [], confidence: 0.99 });
  };
  window.quickAddDbRead = function() {
    openNodeEditor(null, {
      effects: ['database.read'],
      recovery: { db_timeout: { action: 'retry', params: { max: 3, backoff: 'exponential' } }, db_error: { action: 'escalate', params: { message: 'Database read failure' } } }
    });
  };
  window.quickAddDbWrite = function() {
    openNodeEditor(null, {
      effects: ['database.write'],
      recovery: { write_fail: { action: 'retry', params: { max: 3, backoff: 'exponential' } } }
    });
  };
  window.quickAddApi = function() {
    openNodeEditor(null, {
      effects: ['network'],
      recovery: { timeout: { action: 'retry', params: { max: 3, backoff: 'exponential' } }, error: { action: 'escalate', params: { message: 'API call failure' } } }
    });
  };
  window.quickAddMl = function() {
    openNodeEditor(null, {
      effects: ['ml_model.infer'],
      confidence: 0.80,
      adversarial: ['output.confidence < 0', 'output.confidence > 1']
    });
  };

  // ─── Template Palette ───
  window.toggleTemplatePalette = function() {
    const palette = document.getElementById('template-palette');
    palette.classList.toggle('visible');
    // Adjust canvas when palette is visible
    const container = document.getElementById('canvas-container');
    if (palette.classList.contains('visible')) {
      container.style.right = '280px';
    } else {
      container.style.right = '0';
    }
  };

  function renderTemplatePalette() {
    const palette = document.getElementById('template-palette');
    let html = '<h3>Template Palette</h3>';
    templates.forEach(tpl => {
      const params = tpl.parameters.map(p => p.name + ' (' + p.kind + ')').join(', ');
      html += '<div class="tpl-card" data-tpl="' + tpl.id + '">' +
        '<div class="tpl-name">' + escHtml(tpl.id.replace(/-/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase())) + '</div>' +
        '<div class="tpl-desc">' + escHtml(tpl.description || '') + '</div>' +
        '<div class="tpl-params">' + escHtml(params) + '</div>' +
        '<div class="tpl-nodes">' + (tpl.nodes || []).length + ' nodes, ' + (tpl.edges || []).length + ' edges</div>' +
      '</div>';
    });
    palette.innerHTML = html;

    palette.querySelectorAll('.tpl-card').forEach(card => {
      card.addEventListener('click', () => {
        const tplId = card.dataset.tpl;
        const tpl = templates.find(t => t.id === tplId);
        if (tpl) showBindingForm(tpl);
      });
    });
  }

  function showBindingForm(tpl) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });

    const modal = document.createElement('div');
    modal.className = 'modal';
    let html = '<h2>Instantiate: ' + escHtml(tpl.id) + '</h2>';
    html += '<p style="font-size:11px;color:#94a3b8;margin-bottom:12px">' + escHtml(tpl.description || '') + '</p>';
    html += '<div class="binding-form">';
    html += '<label>Instance ID</label><input id="bind-instance-id" value="' + tpl.id.replace(/-/g, '_') + '_1" placeholder="unique instance ID">';

    tpl.parameters.forEach(param => {
      html += '<label>' + escHtml(param.name) + ' <span class="kind-tag">' + param.kind + '</span></label>';
      if (param.kind === 'type') {
        html += '<select id="bind-' + param.name + '">' +
          '<option>String</option><option>Int</option><option>Float64</option><option>Bool</option>' +
          '<option>Record</option><option>List</option><option>User</option>' +
        '</select>';
      } else {
        html += '<input id="bind-' + param.name + '" placeholder="' + (param.constraint || param.kind) + '">';
      }
    });
    html += '</div>';
    html += '<div class="btn-row"><button class="tb-btn" onclick="closeModal()">Cancel</button><button class="tb-btn primary" id="bind-save">Instantiate</button></div>';

    modal.innerHTML = html;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('bind-save').addEventListener('click', () => {
      const instanceId = document.getElementById('bind-instance-id').value.trim();
      if (!instanceId) { alert('Instance ID is required'); return; }

      const bindings = {};
      let valid = true;
      tpl.parameters.forEach(param => {
        const el = document.getElementById('bind-' + param.name);
        const val = el ? el.value.trim() : '';
        if (!val) { alert('Missing binding for ' + param.name); valid = false; }
        bindings[param.name] = val;
      });
      if (!valid) return;

      instantiateTemplate(tpl, instanceId, bindings);
      closeModal();
    });
  }

  function instantiateTemplate(tpl, instanceId, bindings) {
    graph.nodes = graph.nodes || [];
    graph.edges = graph.edges || [];

    // Substitute parameters and add nodes with prefixed IDs
    const nodeIdMap = {};
    let offsetX = viewBox.x + viewBox.w / 2 - NODE_W;
    let offsetY = viewBox.y + viewBox.h / 2 - NODE_H;

    (tpl.nodes || []).forEach((tplNode, idx) => {
      const newId = instanceId + '_' + tplNode.id;
      nodeIdMap[tplNode.id] = newId;

      const node = JSON.parse(JSON.stringify(tplNode));
      node.id = newId;

      // Substitute $Param in types
      const sub = (obj) => {
        if (!obj) return obj;
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v.type === 'string' && v.type.startsWith('$')) {
            const paramName = v.type.substring(1);
            result[k] = { ...v, type: bindings[paramName] || v.type };
          } else {
            result[k] = v;
          }
        }
        return result;
      };
      node.in = sub(node.in);
      node.out = sub(node.out);

      // Substitute $Param in effects
      if (node.effects) {
        node.effects = node.effects.map(eff =>
          eff.startsWith('$') ? (bindings[eff.substring(1)] || eff) : eff
        );
      }

      graph.nodes.push(node);
      positions[newId] = { x: offsetX + (idx % 3) * (NODE_W + H_GAP), y: offsetY + Math.floor(idx / 3) * (NODE_H + V_GAP) };
    });

    // Add edges with remapped IDs
    (tpl.edges || []).forEach(tplEdge => {
      const fromParts = tplEdge.from.split('.');
      const toParts = tplEdge.to.split('.');
      const newFrom = (nodeIdMap[fromParts[0]] || fromParts[0]) + '.' + fromParts.slice(1).join('.');
      const newTo = (nodeIdMap[toParts[0]] || toParts[0]) + '.' + toParts.slice(1).join('.');
      graph.edges.push({ from: newFrom, to: newTo });
    });

    recordChange();
    autoLayout();
  }

  // ─── Export functions ───
  window.exportGraph = function() { saveGraph(); };
  window.importGraph = function() { openFile(); };
  window.saveCompactBtn = function() { saveCompact(); };
  window.newGraphBtn = function() { newGraph(); };

  window.copyJSON = function() {
    navigator.clipboard.writeText(JSON.stringify(graph, null, 2)).then(() => {
      const btn = document.getElementById('copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
    });
  };

  window.addNode = function() { openNodeEditor(null); };
  window.autoLayoutBtn = autoLayout;

  // Expose for testing
  window.__AETHER_GRAPH__ = graph;
  window.__AETHER_GET_GRAPH__ = function() { return JSON.parse(JSON.stringify(graph)); };
  window.__AETHER_HISTORY__ = history;
  window.__AETHER_IS_DIRTY__ = function() { return isDirty; };
  window.__AETHER_MARK_CLEAN__ = markClean;
  window.__AETHER_RECORD_CHANGE__ = recordChange;
  window.__AETHER_MULTI_SELECTED__ = function() { return multiSelected; };
  window.__AETHER_SAVE_GRAPH__ = saveGraph;
  window.__AETHER_SAVE_COMPACT__ = saveCompact;
  window.__AETHER_GRAPH_TO_COMPACT__ = graphToCompact;
  window.__AETHER_LOAD_JSON__ = loadJSON;
  window.__AETHER_LOAD_COMPACT__ = loadCompact;
  window.__AETHER_NEW_GRAPH__ = function(id, version) {
    graph = { id: id || 'new', version: version || 1, effects: [], nodes: [], edges: [] };
    positions = {};
    history.push(graph);
    markClean();
  };
  window.__AETHER_INSTANTIATE_TEMPLATE__ = instantiateTemplate;
  window.__AETHER_OPEN_NODE_EDITOR__ = openNodeEditor;
  window.__AETHER_TEMPLATES__ = templates;

  // Init template palette on load
  document.addEventListener('DOMContentLoaded', renderTemplatePalette);

  // ─── Text Editor (View Modes) ─── //

  let currentView = 'visual'; // 'visual' | 'text' | 'split'

  // Syntax highlighting patterns
  const hlPatterns = [
    { re: /\/\/.*/g, cls: 'hl-comment' },
    { re: /"[^"]*"/g, cls: 'hl-string' },
    { re: /\b(graph|node|edge|end|hole|intent|scope|template|use|statetype|supervised)\b/g, cls: 'hl-keyword' },
    { re: /\b(in|out|effects|contracts|recovery|confidence|pure|ensure|constraints|params|pre|post|never|terminal|initial|when|requires|provides|must_satisfy|nodes|partial)\b/g, cls: 'hl-field' },
    { re: /@\w+/g, cls: 'hl-annotation' },
    { re: /\b\d+(\.\d+)?\b/g, cls: 'hl-number' },
    { re: /->/g, cls: 'hl-arrow' },
    { re: /\b(true|false)\b/g, cls: 'hl-boolean' },
  ];

  function highlightAether(text) {
    // Escape HTML first
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Apply highlighting via spans (order matters: comments first to avoid double-highlighting)
    for (const { re, cls } of hlPatterns) {
      re.lastIndex = 0;
      html = html.replace(re, function(m) { return '<span class="' + cls + '">' + m + '</span>'; });
    }
    return html;
  }

  function updateLineNumbers() {
    const ta = document.getElementById('text-editor');
    const ln = document.getElementById('text-line-numbers');
    if (!ta || !ln) return;
    const lines = ta.value.split('\\n').length;
    ln.innerHTML = Array.from({ length: lines }, (_, i) => (i + 1)).join('<br>');
  }

  function updateHighlight() {
    const ta = document.getElementById('text-editor');
    const overlay = document.getElementById('text-highlight-overlay');
    if (!ta || !overlay) return;
    overlay.innerHTML = highlightAether(ta.value) + '\\n';
    // Sync scroll
    overlay.scrollTop = ta.scrollTop;
    overlay.scrollLeft = ta.scrollLeft;
  }

  // Simple in-browser .aether validator (checks structure, not full parse)
  function validateAetherText(source) {
    const errors = [];
    const lines = source.split('\\n');
    let hasGraph = false;
    let graphClosed = false;
    let openBlocks = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//')) continue;
      if (line.startsWith('graph ')) hasGraph = true;
      if (/^(graph|node|hole|intent|scope|template|statetype|use)\b/.test(line)) openBlocks++;
      if (line === 'end' || line.startsWith('end ')) {
        openBlocks--;
        if (openBlocks < 0) errors.push({ line: i + 1, message: 'Unexpected end' });
      }
      if (line.startsWith('edge ') && !line.includes('->'))
        errors.push({ line: i + 1, message: 'Edge missing -> operator' });
    }
    if (!hasGraph) errors.push({ line: 1, message: 'Missing graph declaration' });
    if (openBlocks > 0) errors.push({ line: lines.length, message: openBlocks + ' unclosed block(s)' });
    return errors;
  }

  function updateTextErrors() {
    const ta = document.getElementById('text-editor');
    const bar = document.getElementById('text-error-bar');
    if (!ta || !bar) return;
    const errors = validateAetherText(ta.value);
    if (errors.length === 0) {
      bar.innerHTML = '<span class="text-ok">✓ Valid .aether syntax</span>';
    } else {
      bar.innerHTML = errors.map(e => '<div class="text-error">Line ' + e.line + ': ' + e.message + '</div>').join('');
    }
  }

  // Graph → .aether text (simplified emitter for in-browser use)
  function graphToAether(g) {
    let out = 'graph ' + (g.id || 'untitled') + ' v' + (g.version || 1) + '\\n';
    if (g.effects && g.effects.length > 0) out += '  effects: [' + g.effects.join(', ') + ']\\n';
    out += '\\n';

    // Nodes
    for (const n of (g.nodes || [])) {
      if (n.hole) {
        out += '  hole ' + n.id + '\\n';
        if (n.must_satisfy) {
          if (n.must_satisfy.in) out += '    in:  ' + formatPorts(n.must_satisfy.in) + '\\n';
          if (n.must_satisfy.out) out += '    out: ' + formatPorts(n.must_satisfy.out) + '\\n';
        }
        out += '  end\\n\\n';
        continue;
      }
      if (n.intent) {
        out += '  intent ' + n.id + '\\n';
        if (n.in) out += '    in:  ' + formatPorts(n.in) + '\\n';
        if (n.out) out += '    out: ' + formatPorts(n.out) + '\\n';
        if (n.ensure) out += '    ensure: ' + n.ensure.join(', ') + '\\n';
        out += '  end\\n\\n';
        continue;
      }
      out += '  node ' + n.id + '\\n';
      if (n.in) out += '    in:  ' + formatPorts(n.in) + '\\n';
      if (n.out) out += '    out: ' + formatPorts(n.out) + '\\n';
      if (n.effects && n.effects.length > 0) out += '    effects: [' + n.effects.join(', ') + ']\\n';
      if (n.contract) {
        out += '    contracts:\\n';
        for (const p of (n.contract.pre || [])) out += '      pre:  ' + p + '\\n';
        for (const p of (n.contract.post || [])) out += '      post: ' + p + '\\n';
        if (n.adversarial_check) {
          for (const b of (n.adversarial_check.break_if || [])) out += '      break_if: ' + b + '\\n';
        }
      }
      if (n.confidence !== undefined) out += '    confidence: ' + n.confidence + '\\n';
      if (n.pure) out += '    pure\\n';
      if (n.recovery) {
        out += '    recovery:\\n';
        for (const [k, v] of Object.entries(n.recovery)) {
          let args = '';
          if (v.params) {
            const parts = [];
            for (const [pk, pv] of Object.entries(v.params)) parts.push(pk + ': ' + pv);
            args = '(' + parts.join(', ') + ')';
          }
          out += '      ' + k + ' -> ' + v.action + args + '\\n';
        }
      }
      out += '  end\\n\\n';
    }

    // Edges
    for (const e of (g.edges || [])) {
      out += '  edge ' + e.from + ' -> ' + e.to + '\\n';
    }

    out += '\\nend // graph\\n';
    return out;
  }

  function formatPorts(ports) {
    return Object.entries(ports).map(function([name, ta]) {
      let s = name + ': ' + (ta.type || 'String');
      if (ta.format) s += ' @' + ta.format;
      if (ta.sensitivity === 'pii') s += ' @pii';
      if (ta.domain) s += ' @' + ta.domain;
      return s;
    }).join(', ');
  }

  function syncVisualToText() {
    const ta = document.getElementById('text-editor');
    if (!ta) return;
    ta.value = graphToAether(graph);
    updateLineNumbers();
    updateHighlight();
    updateTextErrors();
  }

  let textSyncTimer = null;
  function onTextInput() {
    updateLineNumbers();
    updateHighlight();
    clearTimeout(textSyncTimer);
    textSyncTimer = setTimeout(function() {
      updateTextErrors();
    }, 500);
  }

  function setViewMode(mode) {
    currentView = mode;
    const body = document.body;
    const canvas = document.getElementById('canvas-container');
    const textCont = document.getElementById('text-editor-container');
    body.classList.remove('split-view');
    canvas.style.display = 'none';
    textCont.classList.remove('visible');

    document.querySelectorAll('.view-btn').forEach(function(b) { b.classList.remove('active'); });
    document.getElementById('view-' + mode).classList.add('active');

    if (mode === 'visual') {
      canvas.style.display = '';
    } else if (mode === 'text') {
      textCont.classList.add('visible');
      syncVisualToText();
    } else if (mode === 'split') {
      canvas.style.display = '';
      body.classList.add('split-view');
      textCont.classList.add('visible');
      syncVisualToText();
    }
  }

  // Expose for toolbar buttons
  window.__AETHER_SET_VIEW__ = setViewMode;

  // On load, init text editor events
  document.addEventListener('DOMContentLoaded', function() {
    const ta = document.getElementById('text-editor');
    if (ta) {
      ta.addEventListener('input', onTextInput);
      ta.addEventListener('scroll', function() {
        const overlay = document.getElementById('text-highlight-overlay');
        const ln = document.getElementById('text-line-numbers');
        if (overlay) { overlay.scrollTop = ta.scrollTop; overlay.scrollLeft = ta.scrollLeft; }
        if (ln) ln.scrollTop = ta.scrollTop;
      });
      ta.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
          ta.selectionStart = ta.selectionEnd = start + 2;
          onTextInput();
        }
      });
    }
  });
})();
`;
}

export function editorHTML(css: string, js: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AETHER Editor — ${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>

<div id="toolbar">
  <h1>AETHER Editor</h1>
  <button id="view-visual" class="tb-btn view-btn active" onclick="__AETHER_SET_VIEW__('visual')">Visual</button>
  <button id="view-text" class="tb-btn view-btn" onclick="__AETHER_SET_VIEW__('text')">Text</button>
  <button id="view-split" class="tb-btn view-btn" onclick="__AETHER_SET_VIEW__('split')">Split</button>
  <div class="tb-sep"></div>
  <button class="tb-btn" onclick="newGraphBtn()">New</button>
  <button class="tb-btn" onclick="importGraph()">Open</button>
  <button class="tb-btn primary" onclick="exportGraph()">Save</button>
  <button class="tb-btn" onclick="saveCompactBtn()">Save .aether</button>
  <div class="tb-sep"></div>
  <button class="tb-btn primary" onclick="addNode()">+ Add Node</button>
  <div id="quick-add-bar">
    <button class="qa-btn pure-btn" onclick="quickAddPure()">Pure</button>
    <button class="qa-btn db-btn" onclick="quickAddDbRead()">DB Read</button>
    <button class="qa-btn db-btn" onclick="quickAddDbWrite()">DB Write</button>
    <button class="qa-btn api-btn" onclick="quickAddApi()">API Call</button>
    <button class="qa-btn ml-btn" onclick="quickAddMl()">ML Node</button>
  </div>
  <div class="tb-sep"></div>
  <button class="tb-btn" onclick="autoLayoutBtn()">Auto Layout</button>
  <button class="tb-btn" id="copy-btn" onclick="copyJSON()">Copy JSON</button>
  <button class="tb-btn" onclick="toggleTemplatePalette()">Templates</button>
</div>

<div id="canvas-container">
  <svg id="canvas" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="grid-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" stroke-width="0.5"/>
      </pattern>
      <marker id="arrowhead-6ee7b7" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6" fill="#6ee7b7"/>
      </marker>
      <marker id="arrowhead-f43f5e" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6" fill="#f43f5e"/>
      </marker>
      <marker id="arrowhead-fbbf24" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6" fill="#fbbf24"/>
      </marker>
    </defs>
    <rect class="grid-bg" width="10000" height="10000" x="-5000" y="-5000"/>
  </svg>
</div>

<div id="template-palette"></div>
<div id="minimap"><svg></svg></div>
<div id="error-panel"></div>

<div id="text-editor-container">
  <div id="text-editor-wrap">
    <div id="text-line-numbers">1</div>
    <div id="text-highlight-overlay"></div>
    <textarea id="text-editor" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"></textarea>
  </div>
  <div id="text-error-bar"><span class="text-ok">&#10003; Ready</span></div>
</div>

<div id="status-bar">
  <div class="stat"><span id="stat-dot" class="dot green"></span><span id="stat-status">valid</span></div>
  <div class="stat" id="stat-nodes">0 nodes</div>
  <div class="stat" id="stat-edges">0 edges</div>
  <div class="stat"><span id="dirty-indicator" class="clean-indicator">&#10003; Saved</span></div>
</div>

<div id="context-menu"></div>

<script>${js}</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
