/**
 * Tests: Executor Wiring — Real Implementations
 * The most important tests in Phase 5.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execute, createExecutionContext, ContractViolation, AdversarialViolation } from "../../src/runtime/executor.js";
import { ImplementationRegistry } from "../../src/implementations/registry.js";
import { registerProgramImplementations } from "../../src/implementations/programs/index.js";
import { ServiceContainer } from "../../src/implementations/services/container.js";
import type { AetherGraph, AetherNode } from "../../src/ir/validator.js";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function loadGraph(name: string): AetherGraph {
  return JSON.parse(readFileSync(`src/ir/examples/${name}.json`, "utf-8"));
}

function loadSeed(name: string): Record<string, any[]> {
  return JSON.parse(readFileSync(`test-data/${name}/seed.json`, "utf-8"));
}

function loadInputs(name: string): Record<string, any> {
  return JSON.parse(readFileSync(`test-data/${name}/inputs.json`, "utf-8"));
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("Executor — Real Implementations", () => {
  it("executes user-registration with real implementations and seed data", async () => {
    const graph = loadGraph("user-registration");
    const seed = loadSeed("user-registration");
    const inputs = loadInputs("user-registration");

    const ctx = await createExecutionContext(graph, inputs, {
      serviceConfig: { database: { seed } },
      contractMode: "warn", // some contracts use expressions not evaluable in our evaluator
    });

    const result = await execute(ctx);

    expect(result.nodesExecuted).toBe(3);
    expect(result.waves).toBe(3);

    // validate_email output
    const validateOut = result.outputs["validate_email"];
    expect(validateOut.normalized).toBe("newuser@example.com");
    expect(validateOut.valid).toBe(true);

    // create_user output
    const createOut = result.outputs["create_user"];
    expect(createOut.user.email).toBe("newuser@example.com");
    expect(createOut.user.status).toBe("active");
  });

  it("enforces contracts with real implementations", async () => {
    // Use a custom graph with evaluable contracts
    const graph: AetherGraph = {
      id: "test-enforce",
      version: 1,
      effects: [],
      nodes: [{
        id: "compute",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        contract: { pre: ["x > 0"], post: ["y > 0"] },
        effects: [],
      }],
      edges: [],
    } as any;

    const registry = new ImplementationRegistry();
    registry.override("compute", async (inp) => ({ y: inp.x * 2 }));

    const result = await execute({
      graph,
      inputs: { x: 5 },
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      registry,
      contractMode: "enforce",
    });

    expect(result.contractReport).toBeDefined();
    expect(result.contractReport!.totalChecked).toBeGreaterThanOrEqual(2);
    expect(result.contractReport!.passed).toBeGreaterThanOrEqual(2);
    expect(result.nodesExecuted).toBe(1);
  });

  it("postcondition violation throws ContractViolation in enforce mode", async () => {
    // Build a minimal graph where postcondition will fail
    const graph: AetherGraph = {
      id: "test-post-fail",
      version: 1,
      effects: [],
      nodes: [{
        id: "bad_node",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        contract: { post: ["y > 1000"] },
        effects: [],
      }],
      edges: [],
    } as any;

    const registry = new ImplementationRegistry();
    registry.override("bad_node", async (inp) => ({ y: 5 })); // y=5, not > 1000

    const result = execute({
      graph,
      inputs: { x: 1 },
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      registry,
      contractMode: "enforce",
    });

    await expect(result).rejects.toThrow(ContractViolation);
  });

  it("effect tracking records effects from real implementations", async () => {
    const graph = loadGraph("user-registration");
    const seed = loadSeed("user-registration");

    const ctx = await createExecutionContext(graph, { email: "test@example.com" }, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    expect(result.effectsPerformed.length).toBeGreaterThan(0);
    expect(result.effectsPerformed).toContain("database.read");
    expect(result.effectsPerformed).toContain("database.write");
  });

  it("confidence propagation works with real implementations", async () => {
    const graph = loadGraph("user-registration");
    const seed = loadSeed("user-registration");

    const ctx = await createExecutionContext(graph, { email: "test@example.com" }, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    // All node confidences should be > 0
    for (const entry of result.executionLog) {
      expect(entry.confidence).toBeGreaterThan(0);
    }
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("unresolved node uses stub mode with warning", async () => {
    const graph: AetherGraph = {
      id: "test-stub",
      version: 1,
      effects: [],
      nodes: [{
        id: "unknown_node_xyz",
        in: { x: { type: "String" } },
        out: { y: { type: "String" } },
        contract: {},
        effects: [],
      }],
      edges: [],
    } as any;

    const registry = new ImplementationRegistry();
    // Don't register anything — node will be unresolved

    const result = await execute({
      graph,
      inputs: { x: "hello" },
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      registry,
      contractMode: "enforce",
    });

    // Should succeed (stub mode for unresolved)
    expect(result.nodesExecuted).toBe(1);
    expect(result.outputs["unknown_node_xyz"].y).toBe(""); // default string
  });

  it("mixed: some nodes resolved, some stubbed", async () => {
    const graph: AetherGraph = {
      id: "test-mixed",
      version: 1,
      effects: [],
      nodes: [
        { id: "real_node", in: { x: { type: "Int" } }, out: { y: { type: "Int" } }, contract: {}, effects: [] },
        { id: "stub_node", in: { x: { type: "Int" } }, out: { y: { type: "Int" } }, contract: {}, effects: [] },
      ],
      edges: [
        { from: "real_node.y", to: "stub_node.x" },
      ],
    } as any;

    const registry = new ImplementationRegistry();
    registry.override("real_node", async (inp) => ({ y: 42 }));
    // stub_node has no implementation

    const result = await execute({
      graph,
      inputs: { x: 1 },
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
      registry,
      contractMode: "enforce",
    });

    expect(result.nodesExecuted).toBe(2);
    expect(result.outputs["real_node"].y).toBe(42);
    expect(result.outputs["stub_node"].y).toBe(0); // default Int
  });
});
