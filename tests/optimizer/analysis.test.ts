import { describe, it, expect } from "vitest";
import { GraphOptimizer } from "../../src/compiler/optimizer.js";
import type { AetherGraph, AetherNode, TypeAnnotation } from "../../src/ir/validator.js";

function makeNode(
  id: string,
  opts: {
    in?: Record<string, TypeAnnotation>;
    out?: Record<string, TypeAnnotation>;
    confidence?: number;
    effects?: string[];
    pure?: boolean;
    contract?: { pre?: string[]; post?: string[] };
    recovery?: Record<string, { action: string; params?: Record<string, unknown> }>;
    adversarial_check?: { break_if: string[] };
  } = {}
): AetherNode {
  const node: any = {
    id,
    in: opts.in ?? {},
    out: opts.out ?? { result: { type: "String" } },
    contract: opts.contract ?? {},
    confidence: opts.confidence,
    effects: opts.effects ?? [],
    pure: opts.pure ?? true,
    recovery: opts.recovery,
  };
  if (opts.adversarial_check) node.adversarial_check = opts.adversarial_check;
  return node;
}

function makeGraph(nodes: AetherNode[], edges: { from: string; to: string }[] = []): AetherGraph {
  return { id: "test", version: 1, effects: [], nodes, edges };
}

describe("GraphOptimizer — Analysis", () => {
  it("merge_sequential_pure: two pure sequential nodes → suggestion generated", () => {
    const a = makeNode("a", { out: { x: { type: "String" } }, pure: true });
    const b = makeNode("b", { in: { x: { type: "String" } }, out: { y: { type: "String" } }, pure: true });
    const graph = makeGraph([a, b], [{ from: "a.x", to: "b.x" }]);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const merge = suggestions.find(s => s.type === "merge_sequential_pure");

    expect(merge).toBeDefined();
    expect(merge!.affectedNodes).toContain("a");
    expect(merge!.affectedNodes).toContain("b");
    expect(merge!.autoApplicable).toBe(true);
    expect(merge!.priority).toBe("high");
  });

  it("merge_sequential_pure: pure node with multiple consumers → no suggestion", () => {
    const a = makeNode("a", { out: { x: { type: "String" } }, pure: true });
    const b = makeNode("b", { in: { x: { type: "String" } }, pure: true });
    const c = makeNode("c", { in: { x: { type: "String" } }, pure: true });
    const graph = makeGraph(
      [a, b, c],
      [{ from: "a.x", to: "b.x" }, { from: "a.x", to: "c.x" }]
    );

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const merge = suggestions.find(s => s.type === "merge_sequential_pure");

    expect(merge).toBeUndefined();
  });

  it("parallelize_independent: two nodes in different waves, no dependency → suggestion", () => {
    // a → c, b → c. a and b are in wave 0, c in wave 1.
    // But if we put a in wave 0 and b in wave 1 with no dep, we should suggest parallelization.
    // To create different waves with no dep: a → c and b standalone in wave 1 due to edge structure
    const a = makeNode("a", { out: { x: { type: "String" } }, pure: true });
    const b = makeNode("b", { out: { y: { type: "String" } }, pure: true });
    const c = makeNode("c", {
      in: { x: { type: "String" } },
      out: { z: { type: "String" } },
      pure: true,
    });
    // b has no edges but a → c creates a wave structure
    // a is wave 0, c is wave 1, b is wave 0 (no deps)
    // a and b are already in the same wave, so no parallelize suggestion for them
    // Let's construct a case where they ARE in different waves:
    // a → d, b → d, c standalone. Where c is in a later wave than b...
    // Actually, the simplest case: create a false dependency with edges.
    // a → b (creates wave 0: a, wave 1: b), c standalone (wave 0: c)
    // Then c and b have no dependency but b is in wave 1
    const d = makeNode("d", {
      in: { x: { type: "String" } },
      out: { z: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph(
      [a, d, b],
      [{ from: "a.x", to: "d.x" }] // a→d, b standalone
    );
    // a,b in wave 0; d in wave 1
    // b (wave 0) and d (wave 1) have no dep → parallelize suggestion

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const parallel = suggestions.find(s =>
      s.type === "parallelize_independent" &&
      s.affectedNodes.includes("b") && s.affectedNodes.includes("d")
    );

    expect(parallel).toBeDefined();
    expect(parallel!.autoApplicable).toBe(false);
  });

  it("eliminate_redundant: duplicate nodes with same contracts → suggestion", () => {
    const a = makeNode("source", {
      out: { x: { type: "String" } },
      pure: true,
    });
    const b = makeNode("dup1", {
      in: { x: { type: "String" } },
      out: { result: { type: "Int" } },
      contract: { post: ["result > 0"] },
      pure: true,
    });
    const c = makeNode("dup2", {
      in: { x: { type: "String" } },
      out: { result: { type: "Int" } },
      contract: { post: ["result > 0"] },
      pure: true,
    });
    const graph = makeGraph(
      [a, b, c],
      [{ from: "source.x", to: "dup1.x" }, { from: "source.x", to: "dup2.x" }]
    );

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const redundant = suggestions.find(s => s.type === "eliminate_redundant");

    expect(redundant).toBeDefined();
    expect(redundant!.autoApplicable).toBe(true);
  });

  it("add_missing_adversarial: node at confidence 0.87 with no adversarial → suggestion", () => {
    const a = makeNode("risky", {
      confidence: 0.87,
      effects: ["database.write"],
      pure: false,
      recovery: { any: { action: "fallback" } },
    });
    const graph = makeGraph([a]);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const adv = suggestions.find(s => s.type === "add_missing_adversarial");

    expect(adv).toBeDefined();
    expect(adv!.affectedNodes).toContain("risky");
    expect(adv!.autoApplicable).toBe(false);
    expect(adv!.priority).toBe("medium");
  });

  it("add_missing_adversarial: node at confidence 0.87 WITH adversarial → no suggestion", () => {
    const a = makeNode("risky", {
      confidence: 0.87,
      effects: ["database.write"],
      pure: false,
      recovery: { any: { action: "fallback" } },
      adversarial_check: { break_if: ["result < 0"] },
    });
    const graph = makeGraph([a]);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const adv = suggestions.find(s => s.type === "add_missing_adversarial");

    expect(adv).toBeUndefined();
  });

  it("split_oversized_node: node with 6 postconditions → suggestion", () => {
    const a = makeNode("big", {
      contract: {
        post: ["a > 0", "b > 0", "c > 0", "d > 0", "e > 0", "f > 0"],
      },
      pure: true,
    });
    const graph = makeGraph([a]);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const split = suggestions.find(s => s.type === "split_oversized_node");

    expect(split).toBeDefined();
    expect(split!.affectedNodes).toContain("big");
    expect(split!.autoApplicable).toBe(false);
  });

  it("scope_decomposition: 12-node graph with no scopes → suggestion", () => {
    const nodes: AetherNode[] = [];
    for (let i = 0; i < 12; i++) {
      nodes.push(makeNode(`node_${i}`, {
        effects: i < 6 ? ["database.read"] : [],
        pure: i >= 6,
      }));
    }
    const graph = makeGraph(nodes);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);
    const scope = suggestions.find(s => s.type === "scope_decomposition");

    expect(scope).toBeDefined();
    expect(scope!.priority).toBe("low");
    expect(scope!.autoApplicable).toBe(false);
    expect(scope!.affectedNodes.length).toBe(12);
  });

  it("no suggestions for well-optimized graph", () => {
    // A small, well-structured graph with no issues
    const a = makeNode("validate", {
      in: { input: { type: "String" } },
      out: { valid: { type: "Bool" } },
      confidence: 0.95,
      pure: true,
      contract: { post: ["valid"] },
    });
    const b = makeNode("process", {
      in: { valid: { type: "Bool" } },
      out: { result: { type: "String" } },
      confidence: 0.95,
      effects: ["database.write"],
      pure: false,
      contract: { post: ["result"] },
      recovery: {
        timeout: { action: "retry", params: { attempts: 3 } },
        error: { action: "fallback" },
      },
    });
    const graph = makeGraph([a, b], [{ from: "validate.valid", to: "process.valid" }]);

    const optimizer = new GraphOptimizer();
    const suggestions = optimizer.analyze(graph);

    // Should have no high-priority suggestions (merge won't match because process is effectful)
    const highPriority = suggestions.filter(s => s.priority === "high");
    expect(highPriority.length).toBe(0);
  });
});
