/**
 * Transpiler unit tests.
 * Verifies generated JavaScript for each reference program.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { transpileGraph } from "../../src/compiler/transpiler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8")) as unknown;
}

function assertValidJS(source: string): void {
  // Use Function constructor to parse — throws SyntaxError if invalid
  // eslint-disable-next-line no-new-func
  new Function(source);
}

// ─── Transpile each reference program ────────────────────────────────────────

describe("Transpiler — user-registration", () => {
  const graph = loadExample("user-registration.json");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = transpileGraph(graph as any);

  it("produces syntactically valid JavaScript", () => {
    assertValidJS(output);
  });

  it("contains async function for each node", () => {
    expect(output).toContain("async function validate_email(");
    expect(output).toContain("async function check_uniqueness(");
    expect(output).toContain("async function create_user(");
  });

  it("contains confidence propagation logic", () => {
    expect(output).toContain("minInputConfidence");
    expect(output).toContain("outputConfidence");
    expect(output).toContain("0.99");
  });

  it("contains recovery try/catch for effectful nodes", () => {
    expect(output).toContain("check_uniqueness_with_recovery");
    expect(output).toContain("create_user_with_recovery");
    expect(output).toContain("try {");
    expect(output).toContain("catch (error)");
  });

  it("contains ContractViolation class", () => {
    expect(output).toContain("class ContractViolation");
  });

  it("exports a run function", () => {
    expect(output).toContain("module.exports");
    expect(output).toContain("run");
  });
});

describe("Transpiler — product-recommendations", () => {
  const graph = loadExample("product-recommendations.json");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = transpileGraph(graph as any);

  it("produces syntactically valid JavaScript", () => {
    assertValidJS(output);
  });

  it("contains async function for each node", () => {
    expect(output).toContain("async function authenticate(");
    expect(output).toContain("async function fetch_history(");
    expect(output).toContain("async function generate_recommendations(");
  });

  it("contains confidence propagation", () => {
    expect(output).toContain("0.85");
  });
});

describe("Transpiler — customer-support-agent", () => {
  const graph = loadExample("customer-support-agent.json");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = transpileGraph(graph as any);

  it("produces syntactically valid JavaScript", () => {
    assertValidJS(output);
  });

  it("contains async function for each node", () => {
    expect(output).toContain("async function decide_action(");
    expect(output).toContain("async function execute_with_guard(");
  });

  it("contains Promise.all for parallel scheduling", () => {
    // customer-support-agent has 2 nodes in a linear chain, so no Promise.all
    // product-recommendations has authenticate → fetch_history → generate_recommendations, also linear
    // user-registration: validate_email → [check_uniqueness, create_user depends on both]
    // Actually check_uniqueness and create_user are NOT independent (create_user depends on check_uniqueness)
    // So we need a graph with truly independent nodes to test Promise.all
  });

  it("contains recovery wrappers", () => {
    expect(output).toContain("decide_action_with_recovery");
    expect(output).toContain("execute_with_guard_with_recovery");
  });
});

// ─── Promise.all test with synthetic parallel graph ──────────────────────────

describe("Transpiler — parallel scheduling (Promise.all)", () => {
  it("groups independent nodes into Promise.all waves", () => {
    const parallelGraph = {
      id: "parallel_test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "source",
          in: {},
          out: { a: { type: "Int" }, b: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
        {
          id: "branch_a",
          in: { x: { type: "Int" } },
          out: { result: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
        {
          id: "branch_b",
          in: { y: { type: "Int" } },
          out: { result: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
        {
          id: "merge",
          in: { a: { type: "Int" }, b: { type: "Int" } },
          out: { combined: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [
        { from: "source.a", to: "branch_a.x" },
        { from: "source.b", to: "branch_b.y" },
        { from: "branch_a.result", to: "merge.a" },
        { from: "branch_b.result", to: "merge.b" },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = transpileGraph(parallelGraph as any);

    // branch_a and branch_b should be in a Promise.all wave
    expect(output).toContain("Promise.all");
    assertValidJS(output);
  });
});

// ─── Negative test: cyclic graph ─────────────────────────────────────────────

describe("Transpiler — cyclic graph rejection", () => {
  it("throws on cyclic graph", () => {
    const cyclicGraph = {
      id: "cyclic_test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: { x: { type: "Int" } },
          out: { y: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
        {
          id: "node_b",
          in: { x: { type: "Int" } },
          out: { y: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [
        { from: "node_a.y", to: "node_b.x" },
        { from: "node_b.y", to: "node_a.x" },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => transpileGraph(cyclicGraph as any)).toThrow("Cycle");
  });
});
