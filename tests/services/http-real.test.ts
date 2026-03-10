/**
 * Tests for Real HTTP Adapter
 *
 * Uses a local HTTP test server for real request/response testing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RealHTTPAdapter } from "../../src/implementations/services/http-real.js";
import { createServer, type Server } from "http";

describe("RealHTTPAdapter", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);

      if (url.pathname === "/api/echo" && req.method === "POST") {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ echoed: JSON.parse(body), method: "POST" }));
        });
        return;
      }

      if (url.pathname === "/api/hello") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "hello" }));
        return;
      }

      if (url.pathname === "/api/slow") {
        // Delay response by 2 seconds
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ slow: true }));
        }, 2000);
        return;
      }

      if (url.pathname === "/api/error") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
        return;
      }

      if (url.pathname === "/api/text") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("plain text response");
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" ? addr!.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("GET request → response with correct status, headers, body", async () => {
    const http = new RealHTTPAdapter({ baseUrl: `http://localhost:${port}` });
    const response = await http.request({
      method: "GET",
      path: "/api/hello",
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "hello" });
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("POST request with body → echoed back", async () => {
    const http = new RealHTTPAdapter({ baseUrl: `http://localhost:${port}` });
    const response = await http.request({
      method: "POST",
      path: "/api/echo",
      headers: {},
      body: { key: "value" },
    });

    expect(response.status).toBe(200);
    expect(response.body.echoed).toEqual({ key: "value" });
    expect(response.body.method).toBe("POST");
  });

  it("server error → returns error status", async () => {
    const http = new RealHTTPAdapter({ baseUrl: `http://localhost:${port}` });
    const response = await http.request({
      method: "GET",
      path: "/api/error",
      headers: {},
    });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
  });

  it("timeout → error", async () => {
    const http = new RealHTTPAdapter({
      baseUrl: `http://localhost:${port}`,
      timeout_ms: 100,
    });

    await expect(
      http.request({ method: "GET", path: "/api/slow", headers: {} })
    ).rejects.toThrow("timeout");
  });

  it("network failure → error", async () => {
    const http = new RealHTTPAdapter({ baseUrl: "http://localhost:1" });

    await expect(
      http.request({ method: "GET", path: "/api/hello", headers: {} })
    ).rejects.toThrow();
  });

  it("text response → returns as string", async () => {
    const http = new RealHTTPAdapter({ baseUrl: `http://localhost:${port}` });
    const response = await http.request({
      method: "GET",
      path: "/api/text",
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe("plain text response");
  });

  it("404 response → correct status", async () => {
    const http = new RealHTTPAdapter({ baseUrl: `http://localhost:${port}` });
    const response = await http.request({
      method: "GET",
      path: "/api/nonexistent",
      headers: {},
    });

    expect(response.status).toBe(404);
  });

  it("default headers are sent", async () => {
    const http = new RealHTTPAdapter({
      baseUrl: `http://localhost:${port}`,
      headers: { "X-Custom": "test-value" },
    });

    const response = await http.request({
      method: "GET",
      path: "/api/hello",
      headers: {},
    });

    expect(response.status).toBe(200);
  });
});
