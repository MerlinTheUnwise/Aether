/**
 * Scope Execution Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { executeScope, executeScopedGraph } from "../../src/runtime/executor.js";
import type { ExecutionContext } from "../../src/runtime/executor.js";
import type { AetherGraph } from "../../src/ir/validator.js";
import { computeScopeOrder } from "../../src/compiler/scopes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

describe("Scope Execution", () => {
  it("execute multi-scope-order with scope-aware execution → all scopes complete", async () => {
    const graph = loadExample("multi-scope-order.json");
    const context: ExecutionContext = {
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    };

    const result = await executeScopedGraph(context);
    // Each scope runs its nodes + boundary stubs independently, so total includes stubs
    expect(result.nodesExecuted + result.nodesSkipped).toBeGreaterThanOrEqual(5);
    expect(result.waves).toBeGreaterThan(0);
  });

  it("boundary outputs pass correctly between scopes", async () => {
    const graph = loadExample("multi-scope-order.json");
    const context: ExecutionContext = {
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    };

    // Execute the "order" scope first
    const orderResult = await executeScope(graph, "order", {}, context);
    expect(orderResult.scopeId).toBe("order");
    expect(orderResult.boundaryOutputs).toBeDefined();
    // The order scope should produce boundary outputs for downstream scopes
    expect(Object.keys(orderResult.boundaryOutputs).length).toBeGreaterThan(0);
  });

  it("scope execution order respects dependencies", () => {
    const graph = loadExample("multi-scope-order.json");
    const order = computeScopeOrder(graph);

    // order must come before payment, fulfillment, and notification
    const orderIdx = order.indexOf("order");
    const paymentIdx = order.indexOf("payment");
    const fulfillmentIdx = order.indexOf("fulfillment");
    const notificationIdx = order.indexOf("notification");

    expect(orderIdx).toBeLessThan(paymentIdx);
    expect(paymentIdx).toBeLessThan(fulfillmentIdx);
    expect(fulfillmentIdx).toBeLessThan(notificationIdx);
  });

  it("scoped-ecommerce executes all scopes in order", async () => {
    const graph = loadExample("scoped-ecommerce.json");
    const context: ExecutionContext = {
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    };

    const result = await executeScopedGraph(context);
    // Each scope runs its nodes + boundary stubs independently, so total includes stubs
    expect(result.nodesExecuted + result.nodesSkipped).toBeGreaterThanOrEqual(8);
    expect(result.waves).toBeGreaterThan(0);
  });

  it("scoped-ecommerce scope order: catalog → checkout → post_purchase", () => {
    const graph = loadExample("scoped-ecommerce.json");
    const order = computeScopeOrder(graph);

    expect(order.indexOf("catalog")).toBeLessThan(order.indexOf("checkout"));
    expect(order.indexOf("checkout")).toBeLessThan(order.indexOf("post_purchase"));
  });

  it("graph without scopes falls back to normal execution", async () => {
    const graph: AetherGraph = {
      id: "no_scopes",
      version: 1,
      effects: [],
      nodes: [
        { id: "n1", in: {}, out: { x: { type: "String" } }, contract: {}, pure: true, effects: [] },
      ],
      edges: [],
    };

    const result = await executeScopedGraph({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });
    expect(result.nodesExecuted + result.nodesSkipped).toBe(1);
  });
});
