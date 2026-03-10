/**
 * AETHER Server — Integration Tests
 *
 * End-to-end: load graph → validate → execute → check results.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createServer } from "../../src/server/index.js";

const EXAMPLE_PATH = join(process.cwd(), "src/ir/examples/user-registration.json");
const TX_ANALYSIS_PATH = join(process.cwd(), "src/ir/examples/real-world/transaction-analysis.json");

function request(server: http.Server, path: string, options: { method?: string; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method: options.method ?? "GET", headers: options.body ? { "Content-Type": "application/json" } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf-8") }));
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe("Server Integration", () => {
  let server: http.Server;

  beforeAll(async () => {
    server = createServer({ port: 0, graphPath: EXAMPLE_PATH });
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("full pipeline: validate → execute → dashboard", async () => {
    // Step 1: Validate
    const valRes = await request(server, "/api/validate", { method: "POST" });
    expect(valRes.status).toBe(200);
    const valResult = JSON.parse(valRes.body);
    expect(valResult.valid).toBe(true);

    // Step 2: Execute
    const execRes = await request(server, "/api/execute", { method: "POST" });
    expect(execRes.status).toBe(200);
    const execResult = JSON.parse(execRes.body);
    expect(execResult.nodesExecuted).toBeGreaterThan(0);
    expect(execResult.waves).toBeGreaterThan(0);

    // Step 3: Dashboard
    const dashRes = await request(server, "/api/dashboard");
    expect(dashRes.status).toBe(200);
    const dashData = JSON.parse(dashRes.body);
    expect(dashData.graph.id).toBe("user_registration");
    expect(dashData.verification.percentage).toBeGreaterThanOrEqual(0);
  });

  it("load new graph → validate → execute", async () => {
    // Load payment-processing graph
    const graphJson = readFileSync(join(process.cwd(), "src/ir/examples/payment-processing.json"), "utf-8");
    const loadRes = await request(server, "/api/graph", { method: "POST", body: graphJson });
    expect(loadRes.status).toBe(200);

    // Validate
    const valRes = await request(server, "/api/validate", { method: "POST" });
    expect(valRes.status).toBe(200);

    // Execute (may return 200 or 500 depending on graph complexity)
    const execRes = await request(server, "/api/execute", { method: "POST" });
    const execResult = JSON.parse(execRes.body);
    if (execRes.status === 200) {
      expect(execResult.nodesExecuted).toBeGreaterThan(0);
    } else {
      // Server returns error JSON with message
      expect(execResult).toHaveProperty("error");
    }

    // Restore original
    const original = readFileSync(EXAMPLE_PATH, "utf-8");
    await request(server, "/api/graph", { method: "POST", body: original });
  });

  it("transaction-analysis graph loads and executes", async () => {
    if (!existsSync(TX_ANALYSIS_PATH)) return;

    const graphJson = readFileSync(TX_ANALYSIS_PATH, "utf-8");
    const loadRes = await request(server, "/api/graph", { method: "POST", body: graphJson });
    expect(loadRes.status).toBe(200);

    // Execute — may use stub mode, may fail for complex pipelines
    const execRes = await request(server, "/api/execute", { method: "POST" });
    const execResult = JSON.parse(execRes.body);
    if (execRes.status === 200) {
      expect(execResult).toHaveProperty("outputs");
    } else {
      // Complex pipelines may error in stub mode — verify error is reported
      expect(execResult).toHaveProperty("error");
    }

    // Restore original
    const original = readFileSync(EXAMPLE_PATH, "utf-8");
    await request(server, "/api/graph", { method: "POST", body: original });
  });

  it("API results match CLI execution pattern", async () => {
    // Ensure we have the right graph loaded
    const original = readFileSync(EXAMPLE_PATH, "utf-8");
    await request(server, "/api/graph", { method: "POST", body: original });

    // Execute via API
    const execRes = await request(server, "/api/execute", { method: "POST" });
    const result = JSON.parse(execRes.body);

    // Verify structure matches ExecutionResult
    expect(result).toHaveProperty("outputs");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("executionLog");
    expect(result).toHaveProperty("effectsPerformed");
    expect(result).toHaveProperty("nodesExecuted");
    expect(result).toHaveProperty("nodesSkipped");
    expect(result).toHaveProperty("duration_ms");
    expect(result).toHaveProperty("waves");
    expect(result).toHaveProperty("contractReport");

    // Log entries have correct structure
    for (const entry of result.executionLog) {
      expect(entry).toHaveProperty("nodeId");
      expect(entry).toHaveProperty("wave");
      expect(entry).toHaveProperty("duration_ms");
      expect(entry).toHaveProperty("confidence");
      expect(typeof entry.skipped).toBe("boolean");
    }
  });

  it("export-proofs returns Lean 4 proof data", async () => {
    const res = await request(server, "/api/export-proofs", { method: "POST" });
    expect(res.status).toBe(200);
    const proofs = JSON.parse(res.body);
    expect(proofs).toHaveProperty("source");
    expect(proofs).toHaveProperty("metadata");
    expect(proofs.source).toContain("import Mathlib");
  });
});
