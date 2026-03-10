/**
 * AETHER Server — Live Dashboard & API Server
 *
 * Minimal HTTP server using Node.js built-in `http` module.
 * Serves the dashboard, editor, demo, and provides API endpoints
 * for validation, type-checking, verification, execution, optimization,
 * proof export, and AI generation.
 */

import http from "http";
import { URL } from "url";
import path from "path";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import type { AetherGraph } from "../ir/validator.js";
import { generateDashboardPage } from "./dashboard-page.js";
import { executeWithStream, type ExecutionStream } from "./executor-stream.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServerOptions {
  port: number;
  graphPath?: string;
  fsPath?: string;
  dbPath?: string;
  open?: boolean;
  mode?: "mock" | "real";
}

interface ServerState {
  graph: AetherGraph | null;
  graphPath: string | null;
  options: ServerOptions;
}

// ─── Body Parser ─────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function htmlResponse(res: http.ServerResponse, html: string, status = 200): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

async function serveDashboard(res: http.ServerResponse, state: ServerState): Promise<void> {
  const nodes = state.graph?.nodes ?? [];
  const edges = state.graph?.edges ?? [];
  const html = generateDashboardPage({
    port: state.options.port,
    graphId: state.graph?.id,
    graphVersion: state.graph?.version,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    mode: state.options.mode ?? "mock",
  });
  htmlResponse(res, html);
}

async function serveGraph(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) {
    jsonResponse(res, { error: "No graph loaded" }, 404);
    return;
  }
  jsonResponse(res, state.graph);
}

async function handleLoadGraph(req: http.IncomingMessage, res: http.ServerResponse, state: ServerState): Promise<void> {
  const body = await readBody(req);
  try {
    const graph = JSON.parse(body) as AetherGraph;
    state.graph = graph;
    state.graphPath = null;
    jsonResponse(res, { ok: true, id: graph.id, nodes: graph.nodes.length });
  } catch {
    jsonResponse(res, { error: "Invalid JSON" }, 400);
  }
}

async function handleValidate(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  const { validateGraph } = await import("../ir/validator.js");
  const result = validateGraph(state.graph);
  jsonResponse(res, result);
}

async function handleCheck(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  const { checkTypes } = await import("../compiler/checker.js");
  const result = checkTypes(state.graph as any);
  jsonResponse(res, result);
}

async function handleVerify(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  const { verifyGraph } = await import("../compiler/verifier.js");
  const result = await verifyGraph(state.graph as any);
  jsonResponse(res, result);
}

async function handleExecute(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  try {
    const { execute, createExecutionContext } = await import("../runtime/executor.js");

    const serviceConfig = buildServiceConfig(state);
    const ctx = await createExecutionContext(state.graph as any, {}, {
      serviceConfig,
      contractMode: "warn",
    });
    const result = await execute(ctx);
    jsonResponse(res, result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    jsonResponse(res, { error: msg }, 500);
  }
}

async function handleExecuteReal(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  const { execute, createExecutionContext } = await import("../runtime/executor.js");

  const serviceConfig = buildServiceConfig({ ...state, options: { ...state.options, mode: "real" } });
  const ctx = await createExecutionContext(state.graph as any, {}, {
    serviceConfig,
    contractMode: "warn",
  });
  const result = await execute(ctx);
  jsonResponse(res, result);
}

async function handleExecuteStream(req: http.IncomingMessage, res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("No graph loaded");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const { createExecutionContext } = await import("../runtime/executor.js");
  const serviceConfig = buildServiceConfig(state);
  const ctx = await createExecutionContext(state.graph as any, {}, {
    serviceConfig,
    contractMode: "warn",
  });

  const stream: ExecutionStream = {
    onWaveStart: (wave, nodes) => {
      res.write(`data: ${JSON.stringify({ type: "wave_start", wave, nodes })}\n\n`);
    },
    onNodeComplete: (nodeId, result) => {
      res.write(`data: ${JSON.stringify({ type: "node_complete", nodeId, result })}\n\n`);
    },
    onWaveComplete: (wave, results) => {
      res.write(`data: ${JSON.stringify({ type: "wave_complete", wave, results })}\n\n`);
    },
    onContractCheck: (nodeId, check) => {
      res.write(`data: ${JSON.stringify({ type: "contract_check", nodeId, check })}\n\n`);
    },
    onRecoveryTriggered: (nodeId, condition, action) => {
      res.write(`data: ${JSON.stringify({ type: "recovery", nodeId, condition, action })}\n\n`);
    },
    onComplete: (result) => {
      res.write(`data: ${JSON.stringify({ type: "complete", result })}\n\n`);
      res.end();
    },
    onError: (error) => {
      res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
      res.end();
    },
  };

  try {
    await executeWithStream(state.graph, ctx, stream);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.write(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`);
    res.end();
  }
}

async function handleVisualize(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { htmlResponse(res, "<p>No graph loaded</p>", 400); return; }
  const { generateVisualization } = await import("../visualizer/generate.js");
  const html = generateVisualization(state.graph as any);
  htmlResponse(res, html);
}

async function handleDashboard(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }

  try {
  // Use in-memory graph to build dashboard data without reading from file
  const { validateGraph } = await import("../ir/validator.js");
  const { checkTypes } = await import("../compiler/checker.js");
  const { verifyGraph } = await import("../compiler/verifier.js");
  const { ConfidenceEngine } = await import("../runtime/confidence.js");
  const { GraphOptimizer } = await import("../compiler/optimizer.js");

  const graph = state.graph as any;
  const isNodeFn = (n: any) => !n.hole && !n.intent;
  const realNodes = graph.nodes.filter(isNodeFn);

  // Validation
  validateGraph(graph);

  // Type check
  const typeResult = checkTypes(graph);

  // Verification
  let verifyResult;
  try {
    verifyResult = await verifyGraph(graph);
  } catch {
    verifyResult = { nodes_verified: 0, nodes_failed: 0, nodes_unsupported: 0, results: [] };
  }

  // Confidence
  const ce = new ConfidenceEngine(graph);
  const ceReport = ce.getReport();

  // Optimizer
  const optimizer = new GraphOptimizer();
  const suggestions = optimizer.analyze(graph);

  // Build DashboardData
  const byNode = realNodes.map((n: any) => {
    const vr = verifyResult.results?.find((r: any) => r.node_id === n.id);
    const status = vr ? (vr.verified ? "verified" : "failed") : "unsupported";
    return {
      nodeId: n.id,
      status,
      contracts: { pre: n.contract?.pre?.length ?? 0, post: n.contract?.post?.length ?? 0 },
      confidence: n.confidence ?? 1.0,
      effects: n.effects ?? [],
      recoveryPaths: n.recovery ? 1 : 0,
      supervised: !!n.supervised,
    };
  });

  const verified = byNode.filter((n: any) => n.status === "verified").length;
  const total = byNode.length;

  const data = {
    graph: {
      id: graph.id,
      version: graph.version,
      nodeCount: realNodes.length,
      edgeCount: graph.edges.length,
      waveCount: 0,
      scopeCount: graph.scopes?.length ?? 0,
      templateCount: graph.templates?.length ?? 0,
      intentCount: graph.nodes.filter((n: any) => n.intent).length,
    },
    verification: {
      percentage: total > 0 ? (verified / total) * 100 : 0,
      byNode,
      summary: `${verified}/${total} verified`,
    },
    typeSafety: {
      edgesChecked: graph.edges.length,
      compatible: typeResult.compatible ? graph.edges.length - typeResult.errors.length : 0,
      errors: typeResult.errors.length,
      warnings: typeResult.warnings.length,
      errorDetails: typeResult.errors,
      warningDetails: typeResult.warnings,
    },
    confidence: {
      graphConfidence: ceReport.graphConfidence,
      criticalPath: ceReport.criticalPath,
      oversightNodes: ceReport.oversightNodes,
      nodeConfidences: ceReport.nodeConfidences,
      distribution: {},
    },
    effects: {
      totalDeclared: realNodes.reduce((s: number, n: any) => s + (n.effects?.length ?? 0), 0),
      byNode: {},
      pureNodes: realNodes.filter((n: any) => n.pure).length,
      effectfulNodes: realNodes.filter((n: any) => !n.pure && (n.effects?.length ?? 0) > 0).length,
      effectDistribution: {},
    },
    optimizations: suggestions.map(s => ({
      type: s.type,
      priority: s.priority,
      description: s.description,
      autoApplicable: s.autoApplicable,
    })),
    generatedAt: new Date().toISOString(),
  };

  jsonResponse(res, data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    jsonResponse(res, { error: msg }, 500);
  }
}

async function handleReport(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  if (state.graphPath) {
    const { collectDashboardData } = await import("../dashboard/collector.js");
    const { renderDashboard } = await import("../dashboard/render.js");
    const data = await collectDashboardData(state.graphPath, { includeOptimization: true });
    htmlResponse(res, renderDashboard(data));
  } else {
    htmlResponse(res, "<p>Report requires a graph file path</p>", 400);
  }
}

async function handleGenerate(req: http.IncomingMessage, res: http.ServerResponse, state: ServerState): Promise<void> {
  const body = await readBody(req);
  try {
    const { description } = JSON.parse(body);
    if (!description) { jsonResponse(res, { error: "Missing description" }, 400); return; }

    const { generateFromDescription } = await import("../ai/generate.js");
    const result = await generateFromDescription({ description });
    if (result.success && result.graph) {
      state.graph = result.graph as any;
      jsonResponse(res, { success: true, graph: result.graph });
    } else {
      jsonResponse(res, { success: false, error: "Generation failed" }, 400);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    jsonResponse(res, { error: msg }, 500);
  }
}

async function handleOptimize(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  const { GraphOptimizer } = await import("../compiler/optimizer.js");
  const optimizer = new GraphOptimizer();
  const suggestions = optimizer.analyze(state.graph as any);
  jsonResponse(res, suggestions);
}

async function handleExportProofs(res: http.ServerResponse, state: ServerState): Promise<void> {
  if (!state.graph) { jsonResponse(res, { error: "No graph loaded" }, 400); return; }
  const { generateProofExport } = await import("../proofs/generate.js");
  const { verifyGraph } = await import("../compiler/verifier.js");
  let verifyResult;
  try { verifyResult = await verifyGraph(state.graph as any); } catch { verifyResult = undefined; }
  const proofs = generateProofExport(state.graph as any, verifyResult);
  jsonResponse(res, proofs);
}

async function serveEditor(res: http.ServerResponse, state: ServerState): Promise<void> {
  const { generateEditor } = await import("../editor/generate.js");
  const html = generateEditor(state.graph as any);
  htmlResponse(res, html);
}

async function serveDemo(res: http.ServerResponse): Promise<void> {
  const { generateDemo } = await import("../demo/generate.js");
  htmlResponse(res, generateDemo());
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, state: ServerState): void {
  const urlPath = new URL(req.url || "/", `http://localhost`).pathname;
  const relPath = urlPath.replace(/^\/static\//, "");
  const basePath = state.options.fsPath || ".";
  const fullPath = path.resolve(basePath, relPath);

  // Prevent path traversal
  if (!fullPath.startsWith(path.resolve(basePath))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".csv": "text/csv",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".txt": "text/plain",
  };

  res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "application/octet-stream" });
  res.end(readFileSync(fullPath));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildServiceConfig(state: ServerState): any {
  const mode = state.options.mode ?? "mock";
  if (mode === "real") {
    return {
      mode: "real",
      real: {
        filesystem: { basePath: path.resolve(state.options.fsPath ?? ".") },
        ...(state.options.dbPath ? { database: { path: state.options.dbPath } } : {}),
      },
    };
  }
  return {};
}

// ─── Server ──────────────────────────────────────────────────────────────────

export function createServer(options: ServerOptions): http.Server {
  const state: ServerState = {
    graph: null,
    graphPath: null,
    options,
  };

  // Pre-load graph if path provided
  if (options.graphPath && existsSync(options.graphPath)) {
    state.graph = JSON.parse(readFileSync(options.graphPath, "utf-8")) as AetherGraph;
    state.graphPath = options.graphPath;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${options.port}`);
    const urlPath = url.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

    try {
      // ─── HTML pages ──────────────────────────────────────────
      if (urlPath === "/" && req.method === "GET") return await serveDashboard(res, state);
      if (urlPath === "/editor" && req.method === "GET") return await serveEditor(res, state);
      if (urlPath === "/demo" && req.method === "GET") return await serveDemo(res);

      // ─── API endpoints ───────────────────────────────────────
      if (urlPath === "/api/graph" && req.method === "GET") return await serveGraph(res, state);
      if (urlPath === "/api/graph" && req.method === "POST") return await handleLoadGraph(req, res, state);
      if (urlPath === "/api/validate" && req.method === "POST") return await handleValidate(res, state);
      if (urlPath === "/api/check" && req.method === "POST") return await handleCheck(res, state);
      if (urlPath === "/api/verify" && req.method === "POST") return await handleVerify(res, state);
      if (urlPath === "/api/execute" && req.method === "POST") return await handleExecute(res, state);
      if (urlPath === "/api/execute-real" && req.method === "POST") return await handleExecuteReal(res, state);
      if (urlPath === "/api/execute/stream" && req.method === "GET") return await handleExecuteStream(req, res, state);
      if (urlPath === "/api/visualize" && req.method === "GET") return await handleVisualize(res, state);
      if (urlPath === "/api/dashboard" && req.method === "GET") return await handleDashboard(res, state);
      if (urlPath === "/api/report" && req.method === "GET") return await handleReport(res, state);
      if (urlPath === "/api/generate" && req.method === "POST") return await handleGenerate(req, res, state);
      if (urlPath === "/api/optimize" && req.method === "POST") return await handleOptimize(res, state);
      if (urlPath === "/api/export-proofs" && req.method === "POST") return await handleExportProofs(res, state);

      // ─── Static files ────────────────────────────────────────
      if (urlPath.startsWith("/static/")) return serveStatic(req, res, state);

      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: msg }));
    }
  });

  return server;
}

export async function startServer(options: ServerOptions): Promise<http.Server> {
  const server = createServer(options);

  return new Promise((resolve) => {
    server.listen(options.port, () => {
      const graph = options.graphPath ? JSON.parse(readFileSync(options.graphPath, "utf-8")) as AetherGraph : null;

      const sep = "═══════════════════════════════════════════";
      console.log(sep);
      console.log("AETHER Server");
      console.log(sep);
      if (graph) {
        console.log(`Graph:     ${graph.id} (v${graph.version})`);
      }
      console.log(`Port:      ${options.port}`);
      if (options.fsPath) {
        console.log(`FS Path:   ${path.resolve(options.fsPath)}`);
      }
      console.log(`Mode:      ${options.mode ?? "mock"}`);
      console.log("");
      console.log(`Dashboard: http://localhost:${options.port}`);
      console.log(`Editor:    http://localhost:${options.port}/editor`);
      console.log(`Demo:      http://localhost:${options.port}/demo`);
      console.log(`API:       http://localhost:${options.port}/api`);
      console.log("");
      console.log("Press Ctrl+C to stop.");
      console.log(sep);

      if (options.open) {
        import("child_process").then(({ exec }) => {
          const platform = process.platform;
          const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
          exec(`${cmd} http://localhost:${options.port}`);
        });
      }

      resolve(server);
    });
  });
}
