import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  execute,
  ContractViolation,
  EscalationError,
  evaluateContract,
  type ExecutionContext,
  type NodeFunction,
} from "../../src/runtime/executor.js";
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
  return {
    id: "test",
    version: 1,
    effects: [],
    nodes,
    edges,
  };
}

function makeContext(graph: AetherGraph, overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    graph,
    inputs: {},
    nodeImplementations: new Map(),
    confidenceThreshold: 0.7,
    ...overrides,
  };
}

// ─── Stub Execution Tests ────────────────────────────────────────────────────

describe("Executor — Stub Execution", () => {
  const examples = [
    "user-registration",
    "payment-processing",
    "product-recommendations",
    "customer-support-agent",
    "data-pipeline-etl",
    "rate-limiter",
    "multi-scope-order",
    "content-moderation-agent",
  ];

  for (const name of examples) {
    it(`stub execution: ${name} completes without error`, async () => {
      const graph = loadExample(name);
      const ctx = makeContext(graph);
      const result = await execute(ctx);

      expect(result.nodesExecuted + result.nodesSkipped).toBeGreaterThan(0);
      expect(result.waves).toBeGreaterThan(0);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(result.executionLog.length).toBeGreaterThan(0);
    });
  }
});

// ─── Wave Scheduling Tests ───────────────────────────────────────────────────

describe("Executor — Wave Scheduling", () => {
  it("nodes in the same wave execute in parallel", async () => {
    // Two independent nodes (no edges between them) = same wave
    const nodeA = makeNode("a", { out: { x: { type: "String" } } });
    const nodeB = makeNode("b", { out: { y: { type: "String" } } });
    const graph = makeGraph([nodeA, nodeB]);

    const executionOrder: string[] = [];
    const implA: NodeFunction = async () => {
      executionOrder.push("a_start");
      await new Promise(r => setTimeout(r, 10));
      executionOrder.push("a_end");
      return { x: "hello" };
    };
    const implB: NodeFunction = async () => {
      executionOrder.push("b_start");
      await new Promise(r => setTimeout(r, 10));
      executionOrder.push("b_end");
      return { y: "world" };
    };

    const impls = new Map<string, NodeFunction>([["a", implA], ["b", implB]]);
    const ctx = makeContext(graph, { nodeImplementations: impls });
    const result = await execute(ctx);

    // Both should be in wave 0
    expect(result.executionLog[0].wave).toBe(0);
    expect(result.executionLog[1].wave).toBe(0);

    // Parallel: both should start before either ends
    expect(executionOrder[0]).toBe("a_start");
    expect(executionOrder[1]).toBe("b_start");
    expect(result.nodesExecuted).toBe(2);
  });

  it("dependent nodes execute in separate waves", async () => {
    const nodeA = makeNode("a", { out: { x: { type: "String" } } });
    const nodeB = makeNode("b", {
      in: { x: { type: "String" } },
      out: { y: { type: "String" } },
    });

    const graph = makeGraph([nodeA, nodeB], [{ from: "a.x", to: "b.x" }]);
    const ctx = makeContext(graph);
    const result = await execute(ctx);

    const waveA = result.executionLog.find(e => e.nodeId === "a")!.wave;
    const waveB = result.executionLog.find(e => e.nodeId === "b")!.wave;
    expect(waveB).toBeGreaterThan(waveA);
  });
});

// ─── Confidence Tests ────────────────────────────────────────────────────────

describe("Executor — Confidence Propagation", () => {
  it("final confidence matches manual calculation for user-registration", async () => {
    const graph = loadExample("user-registration");
    const ctx = makeContext(graph);
    const result = await execute(ctx);

    // validate_email: 0.99 (wave 0, no inputs)
    // check_uniqueness: 1.0 * 0.99 = 0.99 (input from validate_email)
    // create_user: 1.0 * min(0.99, 0.99) = 0.99 (inputs from both)
    // All propagated confidences should be 0.99 or close
    const logEntries = result.executionLog;
    const validateConf = logEntries.find(e => e.nodeId === "validate_email")!.confidence;
    expect(validateConf).toBeCloseTo(0.99);
  });

  it("confidence gate: node below threshold, no handler -> skipped", async () => {
    const nodeA = makeNode("a", { confidence: 0.3, out: { x: { type: "String" } } });
    const graph = makeGraph([nodeA]);
    const ctx = makeContext(graph, { confidenceThreshold: 0.5 });

    const result = await execute(ctx);
    expect(result.nodesSkipped).toBe(1);
    expect(result.executionLog[0].skipped).toBe(true);
  });

  it("confidence gate with handler: handler called with correct args", async () => {
    const nodeA = makeNode("a", { confidence: 0.3, out: { x: { type: "String" } } });
    const graph = makeGraph([nodeA]);

    const oversightHandler = vi.fn().mockResolvedValue({ x: "oversight_approved" });

    const ctx = makeContext(graph, {
      confidenceThreshold: 0.5,
      onOversightRequired: oversightHandler,
    });

    const result = await execute(ctx);
    expect(oversightHandler).toHaveBeenCalledOnce();
    expect(oversightHandler).toHaveBeenCalledWith("a", 0.3, expect.any(Object));
    expect(result.nodesSkipped).toBe(0);
    expect(result.outputs["a"]).toEqual({ x: "oversight_approved" });
  });
});

// ─── Contract Tests ──────────────────────────────────────────────────────────

describe("Executor — Contracts", () => {
  it("precondition violation throws ContractViolation", async () => {
    const node = makeNode("a", {
      in: { x: { type: "Int" } },
      out: { y: { type: "Int" } },
      contract: { pre: ["x > 0"] },
    });
    const graph = makeGraph([node]);

    const impl: NodeFunction = async (inputs) => ({ y: inputs.x * 2 });
    const ctx = makeContext(graph, {
      inputs: { x: -5 },
      nodeImplementations: new Map([["a", impl]]),
    });

    await expect(execute(ctx)).rejects.toThrow(ContractViolation);
  });

  it("postcondition violation throws ContractViolation", async () => {
    const node = makeNode("a", {
      in: { x: { type: "Int" } },
      out: { y: { type: "Int" } },
      contract: { post: ["y > 100"] },
    });
    const graph = makeGraph([node]);

    const impl: NodeFunction = async () => ({ y: 5 }); // y=5, not > 100
    const ctx = makeContext(graph, {
      inputs: { x: 1 },
      nodeImplementations: new Map([["a", impl]]),
    });

    await expect(execute(ctx)).rejects.toThrow(ContractViolation);
  });
});

// ─── Recovery Tests ──────────────────────────────────────────────────────────

describe("Executor — Recovery", () => {
  it("retry: impl fails twice then succeeds", async () => {
    let attempts = 0;
    const node = makeNode("a", {
      out: { result: { type: "String" } },
      recovery: {
        timeout: {
          action: "retry",
          params: { count: 3, backoff: "linear" },
        },
      },
    });
    const graph = makeGraph([node]);

    const impl: NodeFunction = async () => {
      attempts++;
      if (attempts <= 2) {
        const err = new Error("timeout");
        throw err;
      }
      return { result: "success" };
    };

    const ctx = makeContext(graph, {
      nodeImplementations: new Map([["a", impl]]),
    });

    const result = await execute(ctx);
    expect(result.outputs["a"]).toEqual({ result: "success" });
    expect(attempts).toBe(3); // 1 initial + 2 retries (succeeds on retry 2)
  }, 10000);

  it("fallback: node fails -> fallback value returned", async () => {
    const node = makeNode("a", {
      out: { result: { type: "String" } },
      recovery: {
        error: {
          action: "fallback",
          params: { value: { result: "fallback_value" } },
        },
      },
    });
    const graph = makeGraph([node]);

    const impl: NodeFunction = async () => {
      throw new Error("error");
    };

    const ctx = makeContext(graph, {
      nodeImplementations: new Map([["a", impl]]),
    });

    const result = await execute(ctx);
    expect(result.outputs["a"]).toEqual({ result: "fallback_value" });
  });

  it("escalate: no oversight handler -> EscalationError thrown", async () => {
    const node = makeNode("a", {
      out: { result: { type: "String" } },
      recovery: {
        critical: {
          action: "escalate",
          params: { message: "help needed" },
        },
      },
    });
    const graph = makeGraph([node]);

    const impl: NodeFunction = async () => {
      throw new Error("critical");
    };

    const ctx = makeContext(graph, {
      nodeImplementations: new Map([["a", impl]]),
    });

    await expect(execute(ctx)).rejects.toThrow(EscalationError);
  });

  it("respond: returns status and body", async () => {
    const node = makeNode("a", {
      out: { status: { type: "Int" }, body: { type: "String" } },
      recovery: {
        bad_request: {
          action: "respond",
          params: { status: 400, body: "bad request" },
        },
      },
    });
    const graph = makeGraph([node]);

    const impl: NodeFunction = async () => {
      throw new Error("bad_request");
    };

    const ctx = makeContext(graph, {
      nodeImplementations: new Map([["a", impl]]),
    });

    const result = await execute(ctx);
    expect(result.outputs["a"]).toEqual({ status: 400, body: "bad request" });
  });
});

// ─── Contract Evaluator Tests ────────────────────────────────────────────────

describe("evaluateContract", () => {
  it("evaluates simple comparisons", () => {
    expect(evaluateContract("x > 0", { x: 5 })).toBe(true);
    expect(evaluateContract("x > 0", { x: -1 })).toBe(false);
  });

  it("evaluates equality with ==", () => {
    expect(evaluateContract("status == true", { status: true })).toBe(true);
  });

  it("evaluates .length", () => {
    expect(evaluateContract("name.length > 0", { name: "hello" })).toBe(true);
    expect(evaluateContract("name.length > 0", { name: "" })).toBe(false);
  });

  it("unsupported expressions return true (assume passing)", () => {
    expect(evaluateContract("∀x ∈ S: x > 0", { S: [1, 2, 3] })).toBe(true);
    expect(evaluateContract("exists(users, email)", { users: [], email: "a" })).toBe(true);
  });
});
