import { describe, it, expect } from "vitest";
import { LLVMCodeGenerator, summarizeModule } from "../../src/compiler/llvm/codegen.js";
import type { AetherNode } from "../../src/compiler/llvm/types.js";

function makeNode(overrides: Partial<AetherNode> & { id: string }): AetherNode {
  return {
    in: {},
    out: {},
    contract: {},
    effects: [],
    pure: true,
    ...overrides,
  };
}

// Two independent nodes (same wave) + one dependent node (second wave)
function makeParallelGraph() {
  return {
    id: "parallel_test",
    version: 1,
    effects: [],
    nodes: [
      makeNode({
        id: "node_a",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        confidence: 0.95,
      }),
      makeNode({
        id: "node_b",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        confidence: 0.90,
      }),
      makeNode({
        id: "node_c",
        in: { a: { type: "Int" }, b: { type: "Int" } },
        out: { z: { type: "Int" } },
        confidence: 0.99,
      }),
    ],
    edges: [
      { from: "node_a.y", to: "node_c.a" },
      { from: "node_b.y", to: "node_c.b" },
    ],
  };
}

// Single-node graph (should use direct call, not pool)
function makeSingleNodeGraph() {
  return {
    id: "single_test",
    version: 1,
    effects: [],
    nodes: [
      makeNode({
        id: "solo",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
      }),
    ],
    edges: [],
  };
}

// Graph with a low-confidence node in a parallel wave
function makeLowConfidenceGraph() {
  return {
    id: "low_conf_test",
    version: 1,
    effects: [],
    nodes: [
      makeNode({
        id: "reliable",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        confidence: 0.95,
      }),
      makeNode({
        id: "unreliable",
        in: { x: { type: "Int" } },
        out: { y: { type: "Int" } },
        confidence: 0.60,
      }),
      makeNode({
        id: "downstream",
        in: { a: { type: "Int" }, b: { type: "Int" } },
        out: { z: { type: "Int" } },
        confidence: 0.99,
      }),
    ],
    edges: [
      { from: "reliable.y", to: "downstream.a" },
      { from: "unreliable.y", to: "downstream.b" },
    ],
  };
}

describe("Parallel Native Execution", () => {
  describe("Thread pool API in header", () => {
    it("runtime signatures include thread pool functions", async () => {
      const { getRuntimeSignatures } = await import("../../src/compiler/llvm/runtime/build-runtime.js");
      const sigs = getRuntimeSignatures();
      const poolFns = sigs.filter(s => s.category === "threadpool");

      expect(poolFns.length).toBe(6);
      expect(poolFns.map(s => s.name)).toContain("aether_pool_new");
      expect(poolFns.map(s => s.name)).toContain("aether_pool_submit");
      expect(poolFns.map(s => s.name)).toContain("aether_pool_wait_all");
      expect(poolFns.map(s => s.name)).toContain("aether_pool_free");
      expect(poolFns.map(s => s.name)).toContain("aether_get_num_cores");
      expect(poolFns.map(s => s.name)).toContain("aether_execute_wave");
    });
  });

  describe("Multi-node wave generates submit + wait", () => {
    it("generates pool_submit for each node in multi-node wave", () => {
      const gen = new LLVMCodeGenerator({ parallel: true });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      // Wave 0 has node_a and node_b in parallel
      expect(text).toContain("aether_pool_submit");
      expect(text).toContain("aether_pool_wait_all");
      expect(text).toContain("aether_pool_new");
      expect(text).toContain("aether_pool_free");
    });

    it("generates task wrapper functions for parallel nodes", () => {
      const gen = new LLVMCodeGenerator({ parallel: true });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      // Task wrappers for node_a and node_b (parallel wave)
      expect(text).toContain("define void @task_node_a(i8* %arg, i8* %result_buf)");
      expect(text).toContain("define void @task_node_b(i8* %arg, i8* %result_buf)");
      // node_c is alone in wave 1 — no task wrapper needed
      expect(text).not.toContain("define void @task_node_c");
    });
  });

  describe("Single-node wave generates direct call", () => {
    it("does not use pool for single-node wave", () => {
      const gen = new LLVMCodeGenerator({ parallel: true });
      const graph = makeSingleNodeGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      // Pool is initialized but never used (no multi-node waves)
      expect(text).toContain("call void @aether_solo(%solo_out* sret(%solo_out)");
      // No task wrappers generated
      expect(text).not.toContain("@task_solo");
    });

    it("node_c in second wave calls directly (single-node wave)", () => {
      const gen = new LLVMCodeGenerator({ parallel: true });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      // node_c is called directly (not via pool_submit)
      expect(text).toContain("call void @aether_node_c(%node_c_out* sret(%node_c_out)");
    });
  });

  describe("Confidence pre-check pulls low nodes out", () => {
    it("marks low-confidence nodes for sequential handling", () => {
      const gen = new LLVMCodeGenerator({ parallel: true, confidenceGating: true });
      const graph = makeLowConfidenceGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      // Low confidence node should be noted
      expect(text).toContain("LOW CONFIDENCE: unreliable");
    });

    it("cascading skip for nodes depending on skipped nodes", () => {
      const gen = new LLVMCodeGenerator({ parallel: true, confidenceGating: true });
      const graph = makeLowConfidenceGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      // downstream depends on unreliable → cascading skip
      expect(text).toContain("CASCADING SKIP: downstream");
    });
  });

  describe("parallel:false → sequential", () => {
    it("generates sequential code without pool calls in main", () => {
      const gen = new LLVMCodeGenerator({ parallel: false });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      // Find the main function body
      const mainFn = mod.functions.find(f => f.includes("@main"))!;

      // No pool usage in main function
      expect(mainFn).not.toContain("aether_pool_submit");
      expect(mainFn).not.toContain("aether_pool_new");
      expect(mainFn).not.toContain("aether_pool_wait_all");
      // Direct calls for all nodes
      expect(mainFn).toContain("call void @aether_node_a(%node_a_out* sret(%node_a_out)");
      expect(mainFn).toContain("call void @aether_node_b(%node_b_out* sret(%node_b_out)");
      expect(mainFn).toContain("call void @aether_node_c(%node_c_out* sret(%node_c_out)");
      // Main says sequential
      expect(text).toContain("sequential");
    });

    it("no task wrappers generated when parallel is false", () => {
      const gen = new LLVMCodeGenerator({ parallel: false });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      expect(text).not.toContain("define void @task_");
    });
  });

  describe("Codegen options respected", () => {
    it("custom arena size", () => {
      const gen = new LLVMCodeGenerator({ arenaSize: 2097152 });
      const graph = makeSingleNodeGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      expect(text).toContain("aether_arena_new(%AetherArena* sret(%AetherArena) %arena, i64 2097152)");
    });

    it("execution logging disabled in main function", () => {
      const gen = new LLVMCodeGenerator({ executionLogging: false });
      const graph = makeSingleNodeGraph();
      const mod = gen.generateModule(graph);

      // Check the main function body (not declarations)
      const mainFn = mod.functions.find(f => f.includes("@main"))!;
      expect(mainFn).not.toContain("aether_log_new");
      expect(mainFn).not.toContain("aether_log_print");
    });

    it("execution logging enabled by default", () => {
      const gen = new LLVMCodeGenerator();
      const graph = makeSingleNodeGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      expect(text).toContain("aether_log_new");
      expect(text).toContain("aether_log_print");
    });

    it("thread pool size passed to pool_new", () => {
      const gen = new LLVMCodeGenerator({ parallel: true, threadPoolSize: 4 });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      expect(text).toContain("aether_pool_new(i64 4)");
    });

    it("default pool size is 0 (auto-detect)", () => {
      const gen = new LLVMCodeGenerator({ parallel: true });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      expect(text).toContain("aether_pool_new(i64 0)");
    });
  });

  describe("Summary includes parallel info", () => {
    it("summary reports parallel enabled and task wrapper count", () => {
      const gen = new LLVMCodeGenerator({ parallel: true });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);
      const summary = summarizeModule(mod, text);

      expect(summary.parallel).toBe(true);
      expect(summary.taskWrapperCount).toBe(2); // node_a and node_b
      expect(summary.nodeCount).toBe(3); // 3 real nodes
    });

    it("summary reports parallel disabled", () => {
      const gen = new LLVMCodeGenerator({ parallel: false });
      const graph = makeParallelGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);
      const summary = summarizeModule(mod, text);

      expect(summary.parallel).toBe(false);
      expect(summary.taskWrapperCount).toBe(0);
    });
  });

  describe("Runtime struct definitions", () => {
    it("includes thread pool structs in module", () => {
      const gen = new LLVMCodeGenerator();
      const graph = makeSingleNodeGraph();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);

      expect(text).toContain("%AetherThreadPool = type opaque");
      expect(text).toContain("%AetherTask = type");
      expect(text).toContain("%AetherWave = type");
    });
  });
});
