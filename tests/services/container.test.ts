import { describe, it, expect } from "vitest";
import { ServiceContainer } from "../../src/implementations/services/container.js";
import { AetherDatabase } from "../../src/implementations/services/database.js";
import { AetherHTTPService } from "../../src/implementations/services/http.js";
import { AetherEmailService } from "../../src/implementations/services/email.js";
import { AetherFileSystem } from "../../src/implementations/services/filesystem.js";
import { AetherMLService } from "../../src/implementations/services/ml.js";

describe("ServiceContainer", () => {
  it("createDefault → all services available", async () => {
    const container = await ServiceContainer.createDefault();
    expect(container.has("database")).toBe(true);
    expect(container.has("http")).toBe(true);
    expect(container.has("email")).toBe(true);
    expect(container.has("filesystem")).toBe(true);
    expect(container.has("ml")).toBe(true);
  });

  it("getService returns correct service types", async () => {
    const container = await ServiceContainer.createDefault();
    expect(container.get<AetherDatabase>("database")).toBeInstanceOf(AetherDatabase);
    expect(container.get<AetherHTTPService>("http")).toBeInstanceOf(AetherHTTPService);
    expect(container.get<AetherEmailService>("email")).toBeInstanceOf(AetherEmailService);
    expect(container.get<AetherFileSystem>("filesystem")).toBeInstanceOf(AetherFileSystem);
    expect(container.get<AetherMLService>("ml")).toBeInstanceOf(AetherMLService);
  });

  it("seed database → data queryable", async () => {
    const container = await ServiceContainer.createDefault({
      database: {
        seed: {
          users: [
            { id: "u1", email: "alice@test.com", role: "admin" },
            { id: "u2", email: "bob@test.com", role: "user" },
          ],
        },
      },
    });

    const db = container.get<AetherDatabase>("database");
    const alice = await db.read("users", "u1");
    expect(alice!.email).toBe("alice@test.com");

    const admins = await db.query("users", { field: "role", operator: "=", value: "admin" });
    expect(admins).toHaveLength(1);
  });

  it("service not found → clear error", () => {
    const container = new ServiceContainer();
    expect(() => container.get("nonexistent")).toThrow(/not found.*nonexistent/i);
  });

  it("injectFailures → failures active across services", async () => {
    const container = await ServiceContainer.createDefault();
    container.injectFailures({
      database: { type: "timeout", probability: 1.0 },
    });

    const db = container.get<AetherDatabase>("database");
    await expect(db.read("users", "u1")).rejects.toThrow(/timeout/i);
  });

  it("clearAllFailures → all services healthy again", async () => {
    const container = await ServiceContainer.createDefault();
    container.injectFailures({
      database: { type: "timeout", probability: 1.0 },
    });
    container.clearAllFailures();

    const db = container.get<AetherDatabase>("database");
    const result = await db.read("users", "nope");
    expect(result).toBeNull(); // No throw
  });

  it("custom ML models registered via config", async () => {
    const container = await ServiceContainer.createDefault({
      ml: {
        models: {
          custom: {
            type: "classifier",
            rules: [
              { condition: (input: any) => input.x > 0, output: { label: "pos", confidence: 0.9 } },
            ],
            default_output: { label: "neg", confidence: 0.5 },
          },
        },
      },
    });

    const ml = container.get<AetherMLService>("ml");
    // Built-in models still available
    expect(ml.hasModel("sentiment")).toBe(true);
    // Custom model also available
    const result = await ml.classify("custom", { x: 1 });
    expect(result.label).toBe("pos");
  });

  it("filesystem files via config", async () => {
    const container = await ServiceContainer.createDefault({
      filesystem: {
        files: { "/config.json": '{"key": "value"}' },
      },
    });

    const fs = container.get<AetherFileSystem>("filesystem");
    expect(await fs.readFile("/config.json")).toBe('{"key": "value"}');
  });

  it("HTTP routes via config", async () => {
    const container = await ServiceContainer.createDefault({
      http: {
        routes: {
          "GET /health": async () => ({ status: 200, headers: {}, body: "ok" }),
        },
      },
    });

    const http = container.get<AetherHTTPService>("http");
    const res = await http.request({ method: "GET", path: "/health", headers: {} });
    expect(res.status).toBe(200);
  });

  it("register and retrieve custom service", () => {
    const container = new ServiceContainer();
    container.register("custom", { value: 42 });
    expect(container.get<{ value: number }>("custom").value).toBe(42);
  });
});
