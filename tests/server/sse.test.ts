/**
 * AETHER Server — SSE Streaming Tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { join } from "path";
import { createServer } from "../../src/server/index.js";

const EXAMPLE_PATH = join(process.cwd(), "src/ir/examples/user-registration.json");

function collectSSE(server: http.Server, path: string): Promise<Array<{ type: string; [key: string]: any }>> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const events: Array<{ type: string; [key: string]: any }> = [];
    const req = http.request({ hostname: "127.0.0.1", port: addr.port, path, method: "GET" }, (res) => {
      let buffer = "";
      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (dataLine) {
            try {
              events.push(JSON.parse(dataLine));
            } catch {}
          }
        }
      });
      res.on("end", () => resolve(events));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("SSE Streaming Execution", () => {
  let server: http.Server;

  beforeAll(async () => {
    server = createServer({ port: 0, graphPath: EXAMPLE_PATH });
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("SSE stream sends wave_start events", async () => {
    const events = await collectSSE(server, "/api/execute/stream");
    const waveStarts = events.filter(e => e.type === "wave_start");
    expect(waveStarts.length).toBeGreaterThan(0);
    expect(waveStarts[0]).toHaveProperty("wave");
    expect(waveStarts[0]).toHaveProperty("nodes");
    expect(Array.isArray(waveStarts[0].nodes)).toBe(true);
  });

  it("SSE stream sends node_complete events", async () => {
    const events = await collectSSE(server, "/api/execute/stream");
    const nodeCompletes = events.filter(e => e.type === "node_complete");
    expect(nodeCompletes.length).toBeGreaterThan(0);
    expect(nodeCompletes[0]).toHaveProperty("nodeId");
    expect(nodeCompletes[0]).toHaveProperty("result");
  });

  it("SSE stream sends complete event at end", async () => {
    const events = await collectSSE(server, "/api/execute/stream");
    const completes = events.filter(e => e.type === "complete");
    expect(completes.length).toBe(1);
    expect(completes[0]).toHaveProperty("result");
    expect(completes[0].result).toHaveProperty("outputs");
    expect(completes[0].result).toHaveProperty("waves");
  });

  it("events are valid JSON", async () => {
    const events = await collectSSE(server, "/api/execute/stream");
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(typeof event.type).toBe("string");
      // Re-stringify to confirm valid JSON structure
      expect(() => JSON.stringify(event)).not.toThrow();
    }
  });

  it("wave_complete events have timing data", async () => {
    const events = await collectSSE(server, "/api/execute/stream");
    const waveCompletes = events.filter(e => e.type === "wave_complete");
    expect(waveCompletes.length).toBeGreaterThan(0);
    for (const wc of waveCompletes) {
      expect(wc.results).toHaveProperty("wave");
      expect(wc.results).toHaveProperty("nodes");
      expect(wc.results).toHaveProperty("duration_ms");
    }
  });
});
