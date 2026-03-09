/**
 * Scope Extraction Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractScope, verifyScope } from "../../src/compiler/scopes.js";
import { validateGraph } from "../../src/ir/validator.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

describe("Scope Extraction", () => {
  it("extracts scope from multi-scope-order → valid standalone graph", () => {
    const graph = loadExample("multi-scope-order.json");
    const view = extractScope(graph, "order");

    expect(view.scope.id).toBe("order");
    expect(view.graph.nodes.length).toBeGreaterThanOrEqual(2); // order has 2 nodes
    expect(view.internalEdges.length).toBe(1); // validate_order→check_inventory
    expect(view.boundaryEdges.length).toBeGreaterThan(0);
  });

  it("extracted graph has stub nodes for boundary edges", () => {
    const graph = loadExample("multi-scope-order.json");
    const view = extractScope(graph, "order");

    expect(view.boundaryStubs.length).toBeGreaterThan(0);
    // Stubs should be pure nodes with no effects
    for (const stub of view.boundaryStubs) {
      expect(stub.effects).toEqual([]);
      expect(stub.pure).toBe(true);
    }
  });

  it("extracted graph passes validation independently", () => {
    const graph = loadExample("multi-scope-order.json");
    const view = extractScope(graph, "order");

    // The extracted graph is partial (has stubs)
    const result = validateGraph(view.graph);
    // Should be valid — stubs are real nodes, not holes
    expect(result.errors.length).toBe(0);
  });

  it("all boundary contracts present in extracted view", () => {
    const graph = loadExample("multi-scope-order.json");
    const view = extractScope(graph, "order");

    expect(view.scope.boundary_contracts).toBeDefined();
    expect(view.scope.boundary_contracts!.provides).toBeDefined();
    expect(view.scope.boundary_contracts!.provides!.length).toBeGreaterThan(0);
  });

  it("extraction preserves internal edges correctly", () => {
    const graph = loadExample("multi-scope-order.json");
    const view = extractScope(graph, "order");

    // Internal edge: validate_order.validated_order → check_inventory.validated_order
    expect(view.internalEdges.some(
      e => e.from === "validate_order.validated_order" && e.to === "check_inventory.validated_order"
    )).toBe(true);
  });

  it("throws for unknown scope id", () => {
    const graph = loadExample("multi-scope-order.json");
    expect(() => extractScope(graph, "nonexistent")).toThrow("not found");
  });

  it("extracts all scopes from scoped-ecommerce independently", () => {
    const graph = loadExample("scoped-ecommerce.json");
    for (const scope of graph.scopes!) {
      const view = extractScope(graph, scope.id);
      expect(view.scope.id).toBe(scope.id);
      expect(view.graph.nodes.length).toBeGreaterThan(0);
    }
  });
});
