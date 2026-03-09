import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { JITCompiler } from "../../src/runtime/jit.js";
import type { AetherGraph, AetherNode, TypeAnnotation } from "../../src/ir/validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
}

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
  } = {}
): AetherNode {
  return {
    id,
    in: opts.in ?? {},
    out: opts.out ?? { result: { type: "String" } },
    contract: opts.contract ?? {},
    confidence: opts.confidence,
    effects: opts.effects ?? [],
    pure: opts.pure,
    recovery: opts.recovery,
  };
}

function makeGraph(nodes: AetherNode[], edges: { from: string; to: string }[] = []): AetherGraph {
  return { id: "test", version: 1, effects: [], nodes, edges };
}

describe("JITCompiler", () => {
  it("compiles simple 2-node chain into valid function", () => {
    const n1 = makeNode("a", {
      out: { x: { type: "String" } },
      pure: true,
    });
    const n2 = makeNode("b", {
      in: { x: { type: "String" } },
      out: { y: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph([n1, n2], [{ from: "a.x", to: "b.x" }]);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a", "b"]);

    expect(compiled.id).toMatch(/^compiled_/);
    expect(compiled.sourceNodes).toEqual(["a", "b"]);
    expect(compiled.metadata.nodeCount).toBe(2);
    expect(typeof compiled.fn).toBe("function");
    expect(compiled.source).toContain("a");
    expect(compiled.source).toContain("b");
  });

  it("compiled function executes in stub mode with correct defaults", async () => {
    const n1 = makeNode("a", {
      out: { x: { type: "String" } },
      pure: true,
    });
    const n2 = makeNode("b", {
      in: { x: { type: "String" } },
      out: { y: { type: "Bool" } },
      pure: true,
    });
    const graph = makeGraph([n1, n2], [{ from: "a.x", to: "b.x" }]);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a", "b"]);

    // Execute with no implementations (stub mode)
    const result = await compiled.fn(
      {},
      new Map(),
      { confidenceThreshold: 0.7 }
    );

    expect(result.outputs).toBeDefined();
    expect(result.outputs.a).toBeDefined();
    expect(result.outputs.b).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.log.length).toBeGreaterThan(0);
  });

  it("compiled function executes with real implementations", async () => {
    const n1 = makeNode("a", {
      in: { val: { type: "Int" } },
      out: { doubled: { type: "Int" } },
      pure: true,
    });
    const n2 = makeNode("b", {
      in: { doubled: { type: "Int" } },
      out: { result: { type: "String" } },
      pure: true,
    });
    const graph = makeGraph([n1, n2], [{ from: "a.doubled", to: "b.doubled" }]);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a", "b"]);

    const impls = new Map<string, any>();
    impls.set("a", async (inputs: any) => ({ doubled: (inputs.val ?? 5) * 2 }));
    impls.set("b", async (inputs: any) => ({ result: `Value is ${inputs.doubled}` }));

    const result = await compiled.fn(
      { val: 5 },
      impls,
      { confidenceThreshold: 0.7 }
    );

    expect(result.outputs.a.doubled).toBe(10);
    expect(result.outputs.b.result).toBe("Value is 10");
  });

  it("compiled function respects confidence gate", async () => {
    const n1 = makeNode("a", {
      out: { x: { type: "String" } },
      confidence: 0.3, // Below threshold
    });
    const graph = makeGraph([n1]);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a"]);

    const result = await compiled.fn(
      {},
      new Map(),
      { confidenceThreshold: 0.7 }
    );

    // Should have been skipped due to confidence
    expect(result.log.some(l => l.includes("SKIPPED"))).toBe(true);
  });

  it("compiled function reports effects via callback", async () => {
    const n1 = makeNode("a", {
      out: { x: { type: "String" } },
      effects: ["database.read"],
    });
    const graph = makeGraph([n1]);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a"]);

    const effectLog: string[] = [];
    const result = await compiled.fn(
      {},
      new Map(),
      {
        confidenceThreshold: 0.7,
        onEffect: (node: string, effect: string) => effectLog.push(`${node}:${effect}`),
      }
    );

    expect(effectLog).toContain("a:database.read");
    expect(result.effects).toContain("database.read");
  });

  it("compiled function handles recovery (retry)", async () => {
    const n1 = makeNode("a", {
      out: { x: { type: "String" } },
      effects: ["network"],
      recovery: {
        timeout: { action: "retry", params: { attempts: 2 } },
      },
    });
    const graph = makeGraph([n1]);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, ["a"]);

    let callCount = 0;
    const impls = new Map<string, any>();
    impls.set("a", async () => {
      callCount++;
      if (callCount === 1) throw Object.assign(new Error("timeout"), { type: "timeout" });
      return { x: "recovered" };
    });

    const result = await compiled.fn(
      {},
      impls,
      { confidenceThreshold: 0.7 }
    );

    expect(result.outputs.a.x).toBe("recovered");
    expect(callCount).toBeGreaterThan(1);
  });

  it("cache hit: same subgraph compiled twice returns first compilation", () => {
    const n1 = makeNode("a");
    const graph = makeGraph([n1]);

    const compiler = new JITCompiler();
    const first = compiler.compile(graph, ["a"]);
    const second = compiler.compile(graph, ["a"]);

    expect(first.id).toBe(second.id);
    expect(first.compiledAt).toBe(second.compiledAt);
    expect(compiler.getStats().compilations).toBe(1);
    expect(compiler.getStats().cacheHits).toBe(1);
  });

  it("cache invalidation: invalidate then access returns null", () => {
    const n1 = makeNode("a");
    const graph = makeGraph([n1]);

    const compiler = new JITCompiler();
    compiler.compile(graph, ["a"]);
    expect(compiler.getCached(["a"])).not.toBeNull();

    compiler.invalidate(["a"]);
    expect(compiler.getCached(["a"])).toBeNull();
  });

  it("generated source is readable (contains node names and wave comments)", () => {
    const graph = loadExample("user-registration");
    const nodeIds = (graph as any).nodes.map((n: any) => n.id);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, nodeIds);

    expect(compiled.source).toContain("validate_email");
    expect(compiled.source).toContain("check_uniqueness");
    expect(compiled.source).toContain("create_user");
    expect(compiled.source).toContain("Wave 0");
    expect(compiled.source).toContain("GENERATED");
  });

  it("compiles user-registration reference program", async () => {
    const graph = loadExample("user-registration");
    const nodeIds = (graph as any).nodes.map((n: any) => n.id);

    const compiler = new JITCompiler();
    const compiled = compiler.compile(graph, nodeIds);

    const result = await compiled.fn(
      {},
      new Map(),
      { confidenceThreshold: 0.7 }
    );

    expect(result.outputs).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.log.length).toBeGreaterThan(0);
  });
});
