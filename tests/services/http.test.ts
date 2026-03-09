import { describe, it, expect, beforeEach } from "vitest";
import { AetherHTTPService } from "../../src/implementations/services/http.js";

describe("AetherHTTPService", () => {
  let http: AetherHTTPService;

  beforeEach(() => {
    http = new AetherHTTPService();
  });

  it("register route + request → correct response", async () => {
    http.registerRoute("GET", "/users", async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: [{ id: 1, name: "Alice" }],
    }));

    const res = await http.request({ method: "GET", path: "/users", headers: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("404 for unregistered route", async () => {
    const res = await http.request({ method: "GET", path: "/unknown", headers: {} });
    expect(res.status).toBe(404);
  });

  it("request logging → all requests captured", async () => {
    http.registerRoute("GET", "/a", async () => ({ status: 200, headers: {}, body: "a" }));
    http.registerRoute("POST", "/b", async () => ({ status: 201, headers: {}, body: "b" }));

    await http.request({ method: "GET", path: "/a", headers: {} });
    await http.request({ method: "POST", path: "/b", headers: {}, body: { x: 1 } });
    await http.request({ method: "GET", path: "/missing", headers: {} });

    const log = http.getLog();
    expect(log).toHaveLength(3);
    expect(log[0].path).toBe("/a");
    expect(log[1].method).toBe("POST");
    expect(log[2].path).toBe("/missing");
  });

  it("failure injection → returns configured error status", async () => {
    http.registerRoute("GET", "/api", async () => ({ status: 200, headers: {}, body: "ok" }));
    http.injectFailure({ status: 503, probability: 1.0 });

    const res = await http.request({ method: "GET", path: "/api", headers: {} });
    expect(res.status).toBe(503);
  });

  it("failure injection on specific path", async () => {
    http.registerRoute("GET", "/ok", async () => ({ status: 200, headers: {}, body: "ok" }));
    http.registerRoute("GET", "/fail", async () => ({ status: 200, headers: {}, body: "ok" }));
    http.injectFailure({ status: 500, probability: 1.0, path: "/fail" });

    const ok = await http.request({ method: "GET", path: "/ok", headers: {} });
    expect(ok.status).toBe(200);

    const fail = await http.request({ method: "GET", path: "/fail", headers: {} });
    expect(fail.status).toBe(500);
  });

  it("POST with body → handler receives body", async () => {
    http.registerRoute("POST", "/data", async (req) => ({
      status: 201,
      headers: {},
      body: { received: req.body },
    }));

    const res = await http.request({ method: "POST", path: "/data", headers: {}, body: { key: "val" } });
    expect(res.status).toBe(201);
    expect(res.body.received).toEqual({ key: "val" });
  });

  it("clearLog empties the request log", async () => {
    await http.request({ method: "GET", path: "/x", headers: {} });
    expect(http.getLog()).toHaveLength(1);
    http.clearLog();
    expect(http.getLog()).toHaveLength(0);
  });

  it("clearFailures removes injected failures", async () => {
    http.registerRoute("GET", "/api", async () => ({ status: 200, headers: {}, body: "ok" }));
    http.injectFailure({ status: 500, probability: 1.0 });
    http.clearFailures();

    const res = await http.request({ method: "GET", path: "/api", headers: {} });
    expect(res.status).toBe(200);
  });

  it("middleware modifies request flow", async () => {
    http.registerRoute("GET", "/protected", async () => ({
      status: 200, headers: {}, body: "secret",
    }));

    http.addMiddleware(async (req, next) => {
      if (!req.headers["authorization"]) {
        return { status: 401, headers: {}, body: { error: "Unauthorized" } };
      }
      return next();
    });

    const noAuth = await http.request({ method: "GET", path: "/protected", headers: {} });
    expect(noAuth.status).toBe(401);

    const withAuth = await http.request({
      method: "GET", path: "/protected", headers: { authorization: "Bearer token" },
    });
    expect(withAuth.status).toBe(200);
  });
});
