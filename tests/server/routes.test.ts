/**
 * AETHER Server — Route Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { createServer } from "../../src/server/index.js";

const EXAMPLE_PATH = join(process.cwd(), "src/ir/examples/user-registration.json");

function request(server: http.Server, path: string, options: { method?: string; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      { hostname: "127.0.0.1", port: addr.port, path, method: options.method ?? "GET", headers: options.body ? { "Content-Type": "application/json" } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8") }));
      },
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe("Server Routes", () => {
  let server: http.Server;

  beforeAll(async () => {
    server = createServer({ port: 0, graphPath: EXAMPLE_PATH });
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET / returns HTML dashboard", async () => {
    const res = await request(server, "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("AETHER");
    expect(res.body).toContain("Dashboard");
  });

  it("GET /api/graph returns loaded graph JSON", async () => {
    const res = await request(server, "/api/graph");
    expect(res.status).toBe(200);
    const graph = JSON.parse(res.body);
    expect(graph.id).toBe("user_registration");
    expect(graph.nodes.length).toBeGreaterThan(0);
  });

  it("POST /api/graph loads a new graph", async () => {
    const newGraph = readFileSync(join(process.cwd(), "src/ir/examples/payment-processing.json"), "utf-8");
    const res = await request(server, "/api/graph", { method: "POST", body: newGraph });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body);
    expect(result.ok).toBe(true);
    expect(result.id).toBe("payment_processing");

    // Restore original
    const original = readFileSync(EXAMPLE_PATH, "utf-8");
    await request(server, "/api/graph", { method: "POST", body: original });
  });

  it("POST /api/validate returns validation result", async () => {
    const res = await request(server, "/api/validate", { method: "POST" });
    expect(res.status).toBe(200);
    const result = JSON.parse(res.body);
    expect(result).toHaveProperty("valid");
  });

  it("GET /editor returns editor HTML", async () => {
    const res = await request(server, "/editor");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body.length).toBeGreaterThan(100);
  });

  it("GET /demo returns demo HTML", async () => {
    const res = await request(server, "/demo");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body.length).toBeGreaterThan(100);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(server, "/nonexistent");
    expect(res.status).toBe(404);
  });

  it("has CORS headers", async () => {
    const res = await request(server, "/api/graph");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("handles OPTIONS preflight", async () => {
    const res = await request(server, "/api/graph", { method: "OPTIONS" });
    expect(res.status).toBe(200);
  });

  it("GET /api/visualize returns HTML with SVG", async () => {
    const res = await request(server, "/api/visualize");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("svg");
  });
});
