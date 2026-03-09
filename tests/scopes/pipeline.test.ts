/**
 * Scope Pipeline Tests — both scope-bearing examples pass full pipeline
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validateGraph } from "../../src/ir/validator.js";
import { checkTypes } from "../../src/compiler/checker.js";
import { extractScope, verifyScope, checkBoundaryCompatibility, computeScopeOrder } from "../../src/compiler/scopes.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

describe("Scope Pipeline", () => {
  const examples = ["multi-scope-order.json", "scoped-ecommerce.json"];

  for (const exampleFile of examples) {
    describe(exampleFile, () => {
      it("passes schema validation", () => {
        const graph = loadExample(exampleFile);
        const result = validateGraph(graph);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("passes type checking", () => {
        const graph = loadExample(exampleFile);
        const result = checkTypes(graph as any);
        expect(result.compatible).toBe(true);
      });

      it("all scopes extract and verify cleanly", () => {
        const graph = loadExample(exampleFile);
        for (const scope of graph.scopes!) {
          const view = extractScope(graph, scope.id);
          const verification = verifyScope(view);
          expect(verification.internalValid).toBe(true);
          expect(verification.errors).toHaveLength(0);
        }
      });

      it("scope execution order is valid", () => {
        const graph = loadExample(exampleFile);
        const order = computeScopeOrder(graph);
        expect(order.length).toBe(graph.scopes!.length);
      });

      it("all boundary compatibility checks pass", () => {
        const graph = loadExample(exampleFile);
        const scopes = graph.scopes!;
        const scopeMap = new Map(scopes.map(s => [s.id, s]));
        const nodeToScope = new Map<string, string>();
        for (const s of scopes) {
          for (const n of s.nodes) nodeToScope.set(n, s.id);
        }

        // Check all cross-scope pairs
        const checkedPairs = new Set<string>();
        for (const edge of graph.edges) {
          const fromNode = edge.from.split(".")[0];
          const toNode = edge.to.split(".")[0];
          const fromScope = nodeToScope.get(fromNode);
          const toScope = nodeToScope.get(toNode);
          if (!fromScope || !toScope || fromScope === toScope) continue;

          const key = `${fromScope}→${toScope}`;
          if (checkedPairs.has(key)) continue;
          checkedPairs.add(key);

          const result = checkBoundaryCompatibility(scopeMap.get(fromScope)!, scopeMap.get(toScope)!);
          expect(result.compatible).toBe(true);
        }
      });
    });
  }
});
