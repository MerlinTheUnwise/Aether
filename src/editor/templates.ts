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
      transition: background 0.15s;
    }
    .tb-btn:hover { background: #475569; }
    .tb-btn.primary { background: #059669; border-color: #059669; color: #fff; }
    .tb-btn.primary:hover { background: #047857; }
    .tb-sep { width: 1px; height: 24px; background: #475569; margin: 0 4px; }
    #canvas-container {
      position: fixed; top: 48px; left: 0; right: 0; bottom: 36px;
      overflow: hidden; cursor: grab;
    }
    #canvas-container.dragging { cursor: grabbing; }
    #canvas-container.connecting { cursor: crosshair; }
    svg#canvas { width: 100%; height: 100%; }
    .grid-bg { fill: url(#grid-pattern); }
    .node-group { cursor: move; }
    .node-rect {
      rx: 8; ry: 8; stroke-width: 2; transition: filter 0.15s;
    }
    .node-group:hover .node-rect { filter: brightness(1.15); }
    .node-group.selected .node-rect { stroke-dasharray: 4 2; }
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

    /* Context menu */
    #context-menu {
      position: fixed; background: #1e293b; border: 1px solid #475569;
      border-radius: 6px; padding: 4px 0; min-width: 140px; z-index: 300;
      display: none; box-shadow: 0 4px 12px #0005;
    }
    #context-menu .ctx-item {
      padding: 6px 16px; cursor: pointer; font-size: 12px;
      display: flex; align-items: center; gap: 8px;
    }
    #context-menu .ctx-item:hover { background: #334155; }
    #context-menu .ctx-item.danger { color: #f43f5e; }

    /* State diagram */
    .state-node { fill: #1e293b; stroke: #6ee7b7; stroke-width: 2; rx: 20; ry: 20; }
    .state-label { fill: #e2e8f0; font-size: 11px; text-anchor: middle; dominant-baseline: middle; }
    .state-transition { fill: none; stroke: #475569; stroke-width: 1.5; }
    .state-transition.never { stroke: #f43f5e; stroke-dasharray: 4 3; }
  `;
}

export function editorJS(graphJSON: string): string {
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
  let connectFrom = null; // { nodeId, portName, type: 'out' }
  let connectLine = null;
  let viewBox = { x: 0, y: 0, w: 1200, h: 800 };
  let isPanning = false;
  let panStart = { x: 0, y: 0 };
  let zoom = 1;

  const NODE_W = 220, NODE_H = 120, H_GAP = 80, V_GAP = 60;
  const PORT_COLORS = {
    String: '#60a5fa', Int: '#34d399', Float64: '#34d399', Bool: '#fb923c',
    List: '#a78bfa', Record: '#94a3b8', User: '#94a3b8'
  };

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
    // Clear everything except defs and grid
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

      // Type compat color
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
        selectedNode = null; selectedEdge = idx; render();
      });
    });

    // Render nodes
    (graph.nodes || []).forEach(node => {
      if (node.hole) return; // Skip holes in visual editor
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

      const g = el('g', {
        class: 'node-group' + (selectedNode === node.id ? ' selected' : ''),
        transform: 'translate(' + pos.x + ',' + pos.y + ')',
        'data-id': node.id
      }, nodeGroup);

      // Node background
      const fill = node.pure ? '#0f2922' : '#1e293b';
      const stroke = isIntent ? '#a78bfa' : (isSupervised ? '#38bdf8' : (node.pure ? '#059669' : '#475569'));
      el('rect', {
        width: NODE_W, height: dynH, fill: fill, stroke: stroke,
        class: 'node-rect'
      }, g);

      // Header line
      el('line', { x1: 0, y1: 28, x2: NODE_W, y2: 28, stroke: stroke, 'stroke-opacity': '0.4' }, g);

      // Node ID
      const headerText = el('text', { x: 10, y: 16, class: 'node-header', fill: '#e2e8f0' }, g);
      headerText.textContent = node.id;

      // Confidence badge
      const confText = el('text', {
        x: NODE_W - 10, y: 16, class: 'confidence-badge',
        fill: confidenceColor(conf)
      }, g);
      confText.textContent = (conf * 100).toFixed(0) + '%';

      // Input ports
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

      // Output ports
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

      // Effect pills
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

      // Recovery badge
      if (hasRecovery) {
        el('rect', { x: 6, y: ey, width: 60, height: 14, class: 'recovery-badge' }, g);
        const rt = el('text', { x: 10, y: ey + 8, class: 'recovery-text' }, g);
        rt.textContent = 'recovery';
        ey += 18;
      }

      // Supervised badge
      if (isSupervised) {
        el('rect', { x: hasRecovery ? 72 : 6, y: ey - (hasRecovery ? 18 : 0), width: 72, height: 14, class: 'supervised-badge' }, g);
        const st = el('text', { x: (hasRecovery ? 76 : 10), y: ey - (hasRecovery ? 18 : 0) + 8, class: 'supervised-text' }, g);
        st.textContent = 'supervised';
      }

      // Node drag
      g.addEventListener('mousedown', (ev) => {
        if (ev.target.classList.contains('port-circle')) return;
        ev.stopPropagation();
        const svgPt = screenToSVG(ev.clientX, ev.clientY);
        dragNode = node.id;
        dragOffset = { x: svgPt.x - pos.x, y: svgPt.y - pos.y };
        selectedNode = node.id; selectedEdge = null;
        render();
      });

      // Double-click to edit
      g.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        openNodeEditor(node.id);
      });

      // Right-click context menu
      g.addEventListener('contextmenu', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        showContextMenu(ev.clientX, ev.clientY, node.id);
      });
    });

    updateMinimap();
    validate();
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

  // ─── Pan & Zoom ───
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('canvas-container');

    container.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.node-group') || ev.target.closest('.port-circle')) return;
      isPanning = true; panStart = { x: ev.clientX, y: ev.clientY };
      container.classList.add('dragging');
      selectedNode = null; selectedEdge = null;
      render();
    });

    window.addEventListener('mousemove', (ev) => {
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
      if (dragNode) {
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

    window.addEventListener('mouseup', () => {
      isPanning = false; dragNode = null;
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

    // Delete key
    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (document.querySelector('.modal-overlay')) return;
        if (selectedNode) { deleteNode(selectedNode); selectedNode = null; render(); }
        if (selectedEdge !== null) { graph.edges.splice(selectedEdge, 1); selectedEdge = null; render(); }
      }
      if (ev.key === 'Escape') {
        cancelConnect();
        closeModal();
        hideContextMenu();
      }
    });

    // Initial render
    if (graph.nodes && graph.nodes.length > 0) {
      autoLayout();
    } else {
      render();
      fitView();
    }
  });

  // ─── Minimap ───
  function updateMinimap() {
    const mm = document.querySelector('#minimap svg');
    if (!mm) return;
    mm.innerHTML = '';
    // Compute full extent
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of Object.values(positions)) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W); maxY = Math.max(maxY, p.y + NODE_H);
    }
    if (!isFinite(minX)) return;
    const pad = 20;
    const fw = maxX - minX + pad*2, fh = maxY - minY + pad*2;
    mm.setAttribute('viewBox', (minX-pad) + ' ' + (minY-pad) + ' ' + fw + ' ' + fh);

    // Nodes
    for (const [id, p] of Object.entries(positions)) {
      el('rect', { x: p.x, y: p.y, width: NODE_W, height: NODE_H, fill: '#334155', rx: 3, stroke: '#6ee7b7', 'stroke-width': 2 }, mm);
    }
    // Viewport
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
      if (!fn) errors.push('Edge "' + edge.from + ' → ' + edge.to + '": source node "' + fromNode + '" not found');
      if (!tn) errors.push('Edge "' + edge.from + ' → ' + edge.to + '": target node "' + toNode + '" not found');
      if (fn && !fn.hole && fn.out && !fn.out[fromPort]) errors.push('Edge: port "' + fromPort + '" not found on "' + fromNode + '.out"');
      if (tn && !tn.hole && tn.in && !tn.in[toPort]) errors.push('Edge: port "' + toPort + '" not found on "' + toNode + '.in"');
    });

    let html = '';
    if (errors.length === 0 && warnings.length === 0) {
      html = '<span class="ok-icon">\\u2713</span> Valid — ' + (graph.nodes||[]).length + ' nodes, ' + (graph.edges||[]).length + ' edges';
    } else {
      errors.forEach(e => { html += '<div class="err-row"><span class="err-icon">\\u2717</span>' + escHtml(e) + '</div>'; });
      warnings.forEach(w => { html += '<div class="err-row"><span class="warn-icon">\\u26A0</span>' + escHtml(w) + '</div>'; });
    }
    panel.innerHTML = html;
    panel.classList.add('visible');

    // Update status bar
    document.getElementById('stat-nodes').textContent = (graph.nodes||[]).length + ' nodes';
    document.getElementById('stat-edges').textContent = (graph.edges||[]).length + ' edges';
    const dot = document.getElementById('stat-dot');
    dot.className = 'dot ' + (errors.length > 0 ? 'red' : warnings.length > 0 ? 'yellow' : 'green');
    document.getElementById('stat-status').textContent = errors.length > 0 ? errors.length + ' errors' : warnings.length > 0 ? warnings.length + ' warnings' : 'valid';

    // Mark error nodes
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

  // ─── Modal: Add/Edit Node ───
  function openNodeEditor(existingId) {
    const existing = existingId ? (graph.nodes||[]).find(n => n.id === existingId) : null;
    const isEdit = !!existing;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) closeModal(); });

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<h2>' + (isEdit ? 'Edit Node' : 'Add Node') + '</h2>' +
      '<label>Node ID</label><input id="m-id" value="' + (existing ? existing.id : '') + '" ' + (isEdit ? 'readonly' : '') + '>' +
      '<label>Confidence (0-1)</label><input id="m-conf" type="number" step="0.01" min="0" max="1" value="' + (existing ? (existing.confidence||1) : '0.95') + '">' +
      '<label>Effects (comma-separated)</label><input id="m-effects" value="' + (existing ? (existing.effects||[]).join(', ') : '') + '">' +
      '<div><input type="checkbox" id="m-pure" ' + (existing && existing.pure ? 'checked' : '') + '> <label style="display:inline" for="m-pure">Pure</label></div>' +
      '<label>Input Ports</label><div id="m-in-ports"></div><button class="add-port-btn" onclick="addPortRow(\\'in\\')">+ Add input port</button>' +
      '<label>Output Ports</label><div id="m-out-ports"></div><button class="add-port-btn" onclick="addPortRow(\\'out\\')">+ Add output port</button>' +
      '<label>Preconditions (one per line)</label><textarea id="m-pre">' + (existing && existing.contract && existing.contract.pre ? existing.contract.pre.join('\\n') : '') + '</textarea>' +
      '<label>Postconditions (one per line)</label><textarea id="m-post">' + (existing && existing.contract && existing.contract.post ? existing.contract.post.join('\\n') : '') + '</textarea>' +
      '<label>Invariants (one per line)</label><textarea id="m-inv">' + (existing && existing.contract && existing.contract.invariants ? existing.contract.invariants.join('\\n') : '') + '</textarea>' +
      '<div id="m-adv-section" style="display:none"><label>Adversarial break_if (one per line)</label><textarea id="m-adv"></textarea></div>' +
      '<div id="m-recovery-section"><label>Recovery (JSON)</label><textarea id="m-recovery">' + (existing && existing.recovery ? JSON.stringify(existing.recovery, null, 2) : '') + '</textarea></div>' +
      '<div class="btn-row"><button class="tb-btn" onclick="closeModal()">Cancel</button><button class="tb-btn primary" id="m-save">Save</button></div>';

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Populate port rows
    const inPorts = existing ? Object.entries(existing.in || {}) : [];
    const outPorts = existing ? Object.entries(existing.out || {}) : [];
    inPorts.forEach(([n,t]) => addPortRow('in', n, t.type));
    outPorts.forEach(([n,t]) => addPortRow('out', n, t.type));

    // Show adversarial if low confidence
    function checkAdv() {
      const c = parseFloat(document.getElementById('m-conf').value);
      document.getElementById('m-adv-section').style.display = c < 0.85 ? 'block' : 'none';
    }
    document.getElementById('m-conf').addEventListener('input', checkAdv);
    if (existing && existing.adversarial_check) {
      document.getElementById('m-adv').value = (existing.adversarial_check.break_if||[]).join('\\n');
    }
    checkAdv();

    document.getElementById('m-save').addEventListener('click', () => saveNode(isEdit, existingId));
  }

  window.addPortRow = function(dir, name, type) {
    const container = document.getElementById('m-' + dir + '-ports');
    const row = document.createElement('div');
    row.className = 'port-row';
    row.innerHTML = '<input placeholder="port name" value="' + (name||'') + '">' +
      '<select><option>String</option><option>Int</option><option>Float64</option><option>Bool</option><option>List</option><option>Record</option><option>User</option></select>' +
      '<button class="remove-btn" onclick="this.parentElement.remove()">\\u00D7</button>';
    if (type) row.querySelector('select').value = type;
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
      const type = row.querySelector('select').value;
      if (name) inPorts[name] = { type: type };
    });
    document.querySelectorAll('#m-out-ports .port-row').forEach(row => {
      const name = row.querySelector('input').value.trim();
      const type = row.querySelector('select').value;
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
      // Position near center of viewport
      positions[id] = { x: viewBox.x + viewBox.w/2 - NODE_W/2, y: viewBox.y + viewBox.h/2 - NODE_H/2 };
    }
    closeModal();
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
    menu.innerHTML = '<div class="ctx-item" data-action="edit">\\u270E Edit</div>' +
      '<div class="ctx-item danger" data-action="delete">\\u2717 Delete</div>';
    menu.onclick = (ev) => {
      const action = ev.target.dataset.action;
      if (action === 'edit') openNodeEditor(nodeId);
      if (action === 'delete') { deleteNode(nodeId); render(); }
      hideContextMenu();
    };
  }

  function hideContextMenu() {
    document.getElementById('context-menu').style.display = 'none';
  }
  document.addEventListener('click', hideContextMenu);

  // ─── Import / Export ───
  window.exportGraph = function() {
    const json = JSON.stringify(graph, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (graph.id || 'graph') + '.json';
    a.click();
  };

  window.importGraph = function() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          graph = JSON.parse(e.target.result);
          autoLayout();
        } catch(err) { alert('Invalid JSON: ' + err.message); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  window.copyJSON = function() {
    navigator.clipboard.writeText(JSON.stringify(graph, null, 2)).then(() => {
      const btn = document.getElementById('copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
    });
  };

  window.addNode = function() { openNodeEditor(null); };
  window.autoLayoutBtn = autoLayout;

  // Expose graph for round-trip testing
  window.__AETHER_GRAPH__ = graph;
  window.__AETHER_GET_GRAPH__ = function() { return JSON.parse(JSON.stringify(graph)); };
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
  <button class="tb-btn primary" onclick="addNode()">+ Add Node</button>
  <button class="tb-btn" onclick="autoLayoutBtn()">Auto Layout</button>
  <div class="tb-sep"></div>
  <button class="tb-btn" onclick="importGraph()">Import</button>
  <button class="tb-btn" onclick="exportGraph()">Export</button>
  <button class="tb-btn" id="copy-btn" onclick="copyJSON()">Copy JSON</button>
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

<div id="minimap"><svg></svg></div>
<div id="error-panel"></div>

<div id="status-bar">
  <div class="stat"><span id="stat-dot" class="dot green"></span><span id="stat-status">valid</span></div>
  <div class="stat" id="stat-nodes">0 nodes</div>
  <div class="stat" id="stat-edges">0 edges</div>
</div>

<div id="context-menu"></div>

<script>${js}</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
