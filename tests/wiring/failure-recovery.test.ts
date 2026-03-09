/**
 * Tests: Failure Recovery with Real Implementations
 */

import { describe, it, expect } from "vitest";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import { ImplementationRegistry } from "../../src/implementations/registry.js";
import { ServiceContainer } from "../../src/implementations/services/container.js";
import type { AetherGraph } from "../../src/ir/validator.js";

describe("Failure Recovery — Real Implementations", () => {
  it("retry recovery fires on database timeout", async () => {
    const graph: AetherGraph = {
      id: "test-retry",
      version: 1,
      effects: ["database.read"],
      nodes: [{
        id: "db_node",
        in: { q: { type: "String" } },
        out: { data: { type: "String" } },
        contract: {},
        effects: ["database.read"],
        recovery: {
          db_timeout: { action: "retry", params: { count: 3, backoff: "linear" } },
        },
      }],
      edges: [],
    } as any;

    let attempts = 0;
    const registry = new ImplementationRegistry();
    registry.override("db_node", async () => {
      attempts++;
      if (attempts < 3) throw new Error("db_timeout");
      return { data: "recovered" };
    });

    const result = await execute({
      graph,
      inputs: { q: "test" },
      nodeImplementations: new Map([["db_node", async () => {
        attempts++;
        if (attempts < 3) throw new Error("db_timeout");
        return { data: "recovered" };
      }]]),
      confidenceThreshold: 0.7,
      registry,
      contractMode: "skip",
    });

    expect(result.nodesExecuted).toBe(1);
  }, 15000);

  it("fallback recovery returns default on database error", async () => {
    const graph: AetherGraph = {
      id: "test-fallback",
      version: 1,
      effects: ["database.read"],
      nodes: [{
        id: "db_node",
        in: { q: { type: "String" } },
        out: { data: { type: "String" } },
        contract: {},
        effects: ["database.read"],
        recovery: {
          db_error: { action: "fallback" },
        },
      }],
      edges: [],
    } as any;

    const registry = new ImplementationRegistry();
    // Implementation in nodeImplementations is what recovery retries use
    const result = await execute({
      graph,
      inputs: { q: "test" },
      nodeImplementations: new Map([["db_node", async () => {
        throw new Error("db_error: connection refused");
      }]]),
      confidenceThreshold: 0.7,
      registry,
      contractMode: "skip",
    });

    // Fallback should provide defaults
    expect(result.nodesExecuted).toBe(1);
    expect(result.outputs["db_node"]).toBeDefined();
  });

  it("respond recovery returns status", async () => {
    const graph: AetherGraph = {
      id: "test-respond",
      version: 1,
      effects: [],
      nodes: [{
        id: "auth_node",
        in: { token: { type: "String" } },
        out: { user: { type: "String" } },
        contract: {},
        effects: [],
        recovery: {
          invalid_token: { action: "respond", params: { status: 401, body: "unauthorized" } },
        },
      }],
      edges: [],
    } as any;

    const result = await execute({
      graph,
      inputs: { token: "bad" },
      nodeImplementations: new Map([["auth_node", async () => {
        throw new Error("invalid_token");
      }]]),
      confidenceThreshold: 0.7,
      contractMode: "skip",
    });

    expect(result.nodesExecuted).toBe(1);
    expect(result.outputs["auth_node"].status).toBe(401);
  });

  it("multiple failures in one execution — each handled by its node recovery", async () => {
    const graph: AetherGraph = {
      id: "test-multi-recovery",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: {},
          effects: [],
          recovery: { err_a: { action: "fallback" } },
        },
        {
          id: "node_b",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: {},
          effects: [],
          recovery: { err_b: { action: "respond", params: { status: 500, body: "error_b" } } },
        },
      ],
      edges: [],
    } as any;

    const result = await execute({
      graph,
      inputs: { x: "test" },
      nodeImplementations: new Map([
        ["node_a", async () => { throw new Error("err_a happened"); }],
        ["node_b", async () => { throw new Error("err_b occurred"); }],
      ]),
      confidenceThreshold: 0.7,
      contractMode: "skip",
    });

    expect(result.nodesExecuted).toBe(2);
    // node_a used fallback (defaults)
    expect(result.outputs["node_a"]).toBeDefined();
    // node_b used respond
    expect(result.outputs["node_b"].status).toBe(500);
  });

  it("inject database failure via ServiceContainer", async () => {
    const services = ServiceContainer.createDefault({
      database: { seed: { users: [{ id: "u1", email: "a@b.com" }] } },
    });

    // Inject 100% failure rate
    services.injectFailures({
      database: { type: "error", probability: 1.0, message: "injected failure" },
    });

    const db = services.get<any>("database");

    // Direct query should fail
    try {
      await db.query("users", { field: "id", operator: "=", value: "u1" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("injected failure");
    }

    // Clear and retry
    services.clearAllFailures();
    const result = await db.query("users", { field: "id", operator: "=", value: "u1" });
    expect(result.length).toBe(1);
  });
});
