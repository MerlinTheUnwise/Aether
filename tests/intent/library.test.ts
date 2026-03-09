import { describe, it, expect } from "vitest";
import { loadCertifiedLibrary, type CertifiedAlgorithm } from "../../src/compiler/resolver.js";

describe("Certified Algorithm Library", () => {
  const library = loadCertifiedLibrary();

  it("loads all 6 certified algorithms", () => {
    expect(library.length).toBe(6);
    const ids = library.map(a => a.id).sort();
    expect(ids).toEqual([
      "aggregate-sum",
      "deduplicate",
      "filter-predicate",
      "lookup-by-key",
      "sort-ascending",
      "validate-schema",
    ]);
  });

  it("each algorithm has valid interface with in/out types", () => {
    for (const algo of library) {
      expect(algo.interface).toBeDefined();
      expect(algo.interface.in).toBeDefined();
      expect(algo.interface.out).toBeDefined();
      expect(Object.keys(algo.interface.in).length).toBeGreaterThan(0);
      expect(Object.keys(algo.interface.out).length).toBeGreaterThan(0);
    }
  });

  it("each algorithm has contracts with postconditions", () => {
    for (const algo of library) {
      expect(algo.contracts).toBeDefined();
      expect(algo.contracts.post).toBeDefined();
      expect(algo.contracts.post!.length).toBeGreaterThan(0);
    }
  });

  it("each algorithm has complexity information", () => {
    for (const algo of library) {
      expect(algo.complexity).toBeDefined();
      expect(algo.complexity.time).toBeDefined();
    }
  });

  it("all algorithms are deterministic", () => {
    for (const algo of library) {
      expect(algo.deterministic).toBe(true);
    }
  });

  it("each algorithm has implementation nodes", () => {
    for (const algo of library) {
      expect(algo.nodes).toBeDefined();
      expect(algo.nodes.length).toBeGreaterThan(0);
      for (const node of algo.nodes) {
        expect(node.id).toBeTruthy();
        expect(node.in).toBeDefined();
        expect(node.out).toBeDefined();
      }
    }
  });

  it("sort-ascending has correct complexity", () => {
    const sort = library.find(a => a.id === "sort-ascending")!;
    expect(sort.complexity.time).toBe("O(n log n)");
    expect(sort.deterministic).toBe(true);
  });

  it("deduplicate has correct complexity", () => {
    const dedup = library.find(a => a.id === "deduplicate")!;
    expect(dedup.complexity.time).toBe("O(n)");
    expect(dedup.deterministic).toBe(true);
  });

  it("aggregate-sum has correct complexity", () => {
    const sum = library.find(a => a.id === "aggregate-sum")!;
    expect(sum.complexity.time).toBe("O(n)");
    expect(sum.complexity.space).toBe("O(1)");
  });
});
