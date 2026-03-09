import { describe, it, expect } from "vitest";
import { resolveIntent, resolveGraph, loadCertifiedLibrary, type CertifiedAlgorithm } from "../../src/compiler/resolver.js";
import type { IntentNode, AetherGraph } from "../../src/ir/validator.js";
import { validateGraph } from "../../src/ir/validator.js";

const library = loadCertifiedLibrary();

function makeIntent(overrides: Partial<IntentNode> & { id: string; ensure: string[] }): IntentNode {
  return {
    intent: true,
    in: { collection: { type: "Collection<T>" } },
    out: { sorted: { type: "Collection<T>" } },
    ...overrides,
  };
}

describe("Intent Resolution", () => {
  it("resolves IntentNode with matching certified algorithm", () => {
    const intent = makeIntent({
      id: "test_sort",
      ensure: ["output is sorted", "output is permutation of input", "length preserved"],
      in: { collection: { type: "List<Item>" } },
      out: { sorted: { type: "List<Item>" } },
    });

    const result = resolveIntent(intent, library);
    expect(result.resolved).toBe(true);
    expect(result.implementation).not.toBeNull();
    expect(result.implementation!.length).toBeGreaterThan(0);
    expect(result.matchReason).toContain("sort-ascending");
  });

  it("returns unresolved with explanation when no algorithm matches", () => {
    const intent = makeIntent({
      id: "test_impossible",
      ensure: ["must teleport data to mars"],
      in: { collection: { type: "QuantumState" } },
      out: { result: { type: "MarsData" } },
    });

    const result = resolveIntent(intent, library);
    expect(result.resolved).toBe(false);
    expect(result.implementation).toBeNull();
    expect(result.matchReason).toContain("no matching algorithm");
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it("filters by complexity constraint", () => {
    const intent = makeIntent({
      id: "test_fast_sort",
      ensure: ["output is sorted in ascending order", "output is permutation of input collection"],
      in: { collection: { type: "List<Item>" } },
      out: { sorted: { type: "List<Item>" } },
      constraints: { time_complexity: "O(n)" },
    });

    // sort-ascending is O(n log n), should not qualify for O(n) constraint
    // and no other O(n) algorithm matches sort-specific ensure clauses
    const result = resolveIntent(intent, library);
    expect(result.resolved).toBe(false);
  });

  it("filters by determinism requirement", () => {
    // All certified algorithms are deterministic, so this should pass
    const intent = makeIntent({
      id: "test_determ",
      ensure: ["output has no duplicates", "output is subset of input", "unique elements preserved"],
      in: { collection: { type: "List<T>" } },
      out: { deduplicated: { type: "List<T>" } },
      constraints: { deterministic: true },
    });

    const result = resolveIntent(intent, library);
    expect(result.resolved).toBe(true);
    expect(result.matchReason).toContain("deduplicate");
  });

  it("selects best candidate with ranking reason when multiple match", () => {
    // A generic intent that might match multiple algorithms
    const intent = makeIntent({
      id: "test_generic",
      ensure: ["output is subset of input"],
      in: { collection: { type: "Collection<T>" } },
      out: { filtered: { type: "Collection<T>" } },
    });

    const result = resolveIntent(intent, library);
    expect(result.resolved).toBe(true);
    expect(result.matchReason).toBeTruthy();
    // Should have alternatives if multiple matched
  });

  it("resolved graph passes full validation", () => {
    const graph: AetherGraph = {
      id: "test-graph",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "sort_it",
          intent: true,
          ensure: ["output is sorted", "permutation of input", "length preserved"],
          in: { collection: { type: "List<T>" } },
          out: { sorted: { type: "List<T>" } },
        } as any,
        {
          id: "sink",
          in: { data: { type: "List<T>" } },
          out: { done: { type: "Bool" } },
          contract: { post: ["output.done == true"] },
          effects: [],
          pure: true,
        },
      ],
      edges: [
        { from: "sort_it.sorted", to: "sink.data" },
      ],
    };

    const report = resolveGraph(graph, library);
    expect(report.intents_found).toBe(1);
    expect(report.intents_resolved).toBe(1);

    // The resolved graph should be valid
    const valResult = validateGraph(report.resolvedGraph);
    expect(valResult.valid).toBe(true);
  });
});
