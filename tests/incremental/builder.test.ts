/**
 * Tests for AETHER Incremental Builder (Pillar 8)
 */
import { describe, it, expect } from "vitest";
import { IncrementalBuilder } from "../../src/compiler/incremental.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(id: string, opts: {
  inPorts?: Record<string, { type: string }>;
  outPorts?: Record<string, { type: string }>;
  effects?: string[];
  pure?: boolean;
  recovery?: Record<string, { action: string; params?: Record<string, unknown> }>;
  confidence?: number;
  adversarial_check?: { break_if: string[] };
  contract?: { pre?: string[]; post?: string[] };
} = {}) {
  return {
    id,
    in: opts.inPorts ?? {},
    out: opts.outPorts ?? { result: { type: "Bool" } },
    contract: opts.contract ?? { post: ["result == true"] },
    effects: opts.effects ?? [],
    pure: opts.pure,
    recovery: opts.recovery,
    confidence: opts.confidence,
    adversarial_check: opts.adversarial_check,
  };
}

function makeHole(id: string, opts: {
  inPorts?: Record<string, { type: string }>;
  outPorts?: Record<string, { type: string }>;
  effects?: string[];
} = {}) {
  return {
    id,
    hole: true as const,
    must_satisfy: {
      in: opts.inPorts ?? { input: { type: "String" } },
      out: opts.outPorts ?? { output: { type: "Bool" } },
      effects: opts.effects,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("IncrementalBuilder", () => {
  it("basic construction: add 3 nodes, add edges, finalize → valid graph", async () => {
    const builder = new IncrementalBuilder("test_graph");

    const n1 = makeNode("validate", {
      inPorts: { email: { type: "String" } },
      outPorts: { normalized: { type: "String" } },
      pure: true,
    });
    const n2 = makeNode("check", {
      inPorts: { email: { type: "String" } },
      outPorts: { unique: { type: "Bool" } },
      effects: ["database.read"],
      recovery: { db_error: { action: "retry", params: { attempts: 3 } } },
    });
    const n3 = makeNode("create", {
      inPorts: { email: { type: "String" }, unique: { type: "Bool" } },
      outPorts: { user: { type: "User" } },
      effects: ["database.write"],
      recovery: { write_fail: { action: "escalate", params: { message: "failed" } } },
    });

    const r1 = await builder.addNode(n1);
    expect(r1.accepted).toBe(true);

    const r2 = await builder.addNode(n2);
    expect(r2.accepted).toBe(true);

    const r3 = await builder.addNode(n3);
    expect(r3.accepted).toBe(true);

    const e1 = builder.addEdge({ from: "validate.normalized", to: "check.email" });
    expect(e1.accepted).toBe(true);

    const e2 = builder.addEdge({ from: "validate.normalized", to: "create.email" });
    expect(e2.accepted).toBe(true);

    const e3 = builder.addEdge({ from: "check.unique", to: "create.unique" });
    expect(e3.accepted).toBe(true);

    const result = builder.finalize();
    expect(result.valid).toBe(true);
    expect(result.holeCount).toBe(0);
    expect(result.completeness).toBe(1);
  });

  it("hole lifecycle: add hole → track → fill → finalize", async () => {
    const builder = new IncrementalBuilder("hole_test");

    const n1 = makeNode("source", {
      outPorts: { data: { type: "String" } },
      pure: true,
    });
    await builder.addNode(n1);

    const hole = makeHole("processor", {
      inPorts: { data: { type: "String" } },
      outPorts: { result: { type: "Bool" } },
    });
    const holeResult = builder.addHole(hole);
    expect(holeResult.accepted).toBe(true);

    const report = builder.getReport();
    expect(report.holes).toContain("processor");
    expect(report.hole_count).toBe(1);

    builder.addEdge({ from: "source.data", to: "processor.data" });

    // Fill with valid node
    const fillNode = makeNode("processor", {
      inPorts: { data: { type: "String" } },
      outPorts: { result: { type: "Bool" } },
      pure: true,
    });
    const fillResult = await builder.fillHole("processor", fillNode);
    expect(fillResult.accepted).toBe(true);

    const finalResult = builder.finalize();
    expect(finalResult.valid).toBe(true);
  });

  it("hole rejection: fill with node that doesn't satisfy must_satisfy", async () => {
    const builder = new IncrementalBuilder("reject_test");

    const hole = makeHole("handler", {
      inPorts: { amount: { type: "Decimal" } },
      outPorts: { receipt: { type: "Receipt" } },
    });
    builder.addHole(hole);

    // Fill with node that has wrong port types
    const wrongNode = makeNode("handler", {
      inPorts: { amount: { type: "String" } },  // wrong type!
      outPorts: { receipt: { type: "Receipt" } },
      pure: true,
    });
    const result = await builder.fillHole("handler", wrongNode);
    expect(result.accepted).toBe(false);
    expect(result.errors.some(e => e.includes("amount"))).toBe(true);
  });

  it("incremental type checking: add edge with domain mismatch → immediate error", async () => {
    const builder = new IncrementalBuilder("type_test");

    const n1 = makeNode("auth", {
      outPorts: { token: { type: "String", domain: "authentication" } as any },
      pure: true,
    });
    const n2 = makeNode("pay", {
      inPorts: { token: { type: "String", domain: "commerce" } as any },
      outPorts: { result: { type: "Bool" } },
      pure: true,
    });

    await builder.addNode(n1);
    await builder.addNode(n2);

    const edgeResult = builder.addEdge({ from: "auth.token", to: "pay.token" });
    expect(edgeResult.accepted).toBe(false);
    expect(edgeResult.errors.some(e => e.includes("Domain mismatch"))).toBe(true);
  });

  it("incremental cycle detection: add edge that creates cycle → immediate error", async () => {
    const builder = new IncrementalBuilder("cycle_test");

    const n1 = makeNode("a", {
      inPorts: { x: { type: "Int" } },
      outPorts: { y: { type: "Int" } },
      pure: true,
    });
    const n2 = makeNode("b", {
      inPorts: { y: { type: "Int" } },
      outPorts: { x: { type: "Int" } },
      pure: true,
    });

    await builder.addNode(n1);
    await builder.addNode(n2);

    const e1 = builder.addEdge({ from: "a.y", to: "b.y" });
    expect(e1.accepted).toBe(true);

    // This should create a cycle: a→b→a
    const e2 = builder.addEdge({ from: "b.x", to: "a.x" });
    expect(e2.accepted).toBe(false);
    expect(e2.errors.some(e => e.includes("cycle"))).toBe(true);
  });

  it("confidence rule: low-confidence node without adversarial check → immediate error", async () => {
    const builder = new IncrementalBuilder("confidence_test");

    const node = makeNode("risky", {
      confidence: 0.6,
      pure: true,
    });
    const result = await builder.addNode(node);
    expect(result.accepted).toBe(false);
    expect(result.errors.some(e => e.includes("adversarial_check"))).toBe(true);
  });

  it("recovery rule: effectful node without recovery → immediate error", async () => {
    const builder = new IncrementalBuilder("recovery_test");

    const node = makeNode("writer", {
      effects: ["database.write"],
    });
    const result = await builder.addNode(node);
    expect(result.accepted).toBe(false);
    expect(result.errors.some(e => e.includes("recovery"))).toBe(true);
  });

  it("partial finalize: try to finalize with holes remaining → error listing unfilled holes", async () => {
    const builder = new IncrementalBuilder("partial_test");

    const n1 = makeNode("start", { pure: true });
    await builder.addNode(n1);

    builder.addHole(makeHole("unfilled_1"));
    builder.addHole(makeHole("unfilled_2"));

    const result = builder.finalize();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("unfilled_1"))).toBe(true);
    expect(result.errors.some(e => e.includes("unfilled_2"))).toBe(true);
  });

  it("remove and rebuild: add node, remove it, add different node → consistent", async () => {
    const builder = new IncrementalBuilder("rebuild_test");

    const n1 = makeNode("first", { pure: true });
    await builder.addNode(n1);

    const removeResult = builder.removeNode("first");
    expect(removeResult.removed).toBe(true);

    const n2 = makeNode("second", { pure: true });
    const addResult = await builder.addNode(n2);
    expect(addResult.accepted).toBe(true);

    const report = builder.getReport();
    expect(report.nodes).toContain("second");
    expect(report.nodes).not.toContain("first");
  });
});
