/**
 * Reference program validation tests.
 * Each hand-authored example must be a valid AetherGraph.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validateGraph } from "../../src/ir/validator.js";
import { checkTypes } from "../../src/compiler/checker.js";
import { transpileGraph } from "../../src/compiler/transpiler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): unknown {
  const raw = readFileSync(join(examplesDir, name), "utf-8");
  return JSON.parse(raw) as unknown;
}

// ─── Positive tests ────────────────────────────────────────────────────────────

describe("user-registration.json", () => {
  it("is a valid AetherGraph", () => {
    const graph = loadExample("user-registration.json");
    const result = validateGraph(graph);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("product-recommendations.json", () => {
  it("is a valid AetherGraph", () => {
    const graph = loadExample("product-recommendations.json");
    const result = validateGraph(graph);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("customer-support-agent.json", () => {
  it("is a valid AetherGraph", () => {
    const graph = loadExample("customer-support-agent.json");
    const result = validateGraph(graph);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

// ─── Type checker tests ───────────────────────────────────────────────────────

describe("Type checker — reference programs", () => {
  it("user-registration passes type check", () => {
    const graph = loadExample("user-registration.json");
    const result = checkTypes(graph as any);
    expect(result.compatible).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("product-recommendations passes type check", () => {
    const graph = loadExample("product-recommendations.json");
    const result = checkTypes(graph as any);
    expect(result.compatible).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("customer-support-agent passes type check", () => {
    const graph = loadExample("customer-support-agent.json");
    const result = checkTypes(graph as any);
    expect(result.compatible).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("Type checker — DOMAIN_MISMATCH", () => {
  it("detects UserID (authentication) flowing into ProductID (commerce)", () => {
    const graph = {
      id: "domain_mismatch_test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "auth_node",
          in: {},
          out: {
            user_id: { type: "String", domain: "authentication" },
          },
          contract: {},
          effects: [],
          pure: true,
        },
        {
          id: "commerce_node",
          in: {
            product_id: { type: "String", domain: "commerce" },
          },
          out: {},
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [
        { from: "auth_node.user_id", to: "commerce_node.product_id" },
      ],
    };

    const result = checkTypes(graph as any);
    expect(result.compatible).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].code).toBe("DOMAIN_MISMATCH");
    expect(result.errors[0].message).toContain("authentication");
    expect(result.errors[0].message).toContain("commerce");
  });
});

// ─── Negative test ─────────────────────────────────────────────────────────────

describe("malformed graph — effectful node without recovery", () => {
  it("returns valid=false with a descriptive error", () => {
    const badGraph = {
      id: "bad_graph",
      version: 1,
      effects: ["database.write"],
      nodes: [
        {
          id: "write_data",
          in: { payload: { type: "String" } },
          out: { result: { type: "Bool" } },
          contract: { post: ["result == true"] },
          effects: ["database.write"]
          // ← recovery block intentionally missing
        }
      ],
      edges: []
    };

    const result = validateGraph(badGraph);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("write_data"))).toBe(true);
    expect(result.errors.some((e) => e.includes("recovery"))).toBe(true);
  });
});

// ─── Additional negative tests ─────────────────────────────────────────────────

describe("malformed graph — confidence < 0.85 without adversarial_check", () => {
  it("returns valid=false", () => {
    const badGraph = {
      id: "low_confidence_no_check",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "risky_node",
          in: { x: { type: "Int" } },
          out: { y: { type: "Int" } },
          contract: { post: ["y > 0"] },
          confidence: 0.6,
          // ← adversarial_check intentionally missing
          effects: [],
          pure: true
        }
      ],
      edges: []
    };

    const result = validateGraph(badGraph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("risky_node"))).toBe(true);
    expect(result.errors.some((e) => e.includes("adversarial_check"))).toBe(true);
  });
});

describe("malformed graph — edge referencing unknown node", () => {
  it("returns valid=false", () => {
    const badGraph = {
      id: "bad_edge_ref",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: {},
          out: { result: { type: "String" } },
          contract: {},
          effects: [],
          pure: true
        }
      ],
      edges: [
        { from: "node_a.result", to: "ghost_node.input" } // ghost_node doesn't exist
      ]
    };

    const result = validateGraph(badGraph);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ghost_node"))).toBe(true);
  });
});

// ─── Transpiler tests (full pipeline per reference program) ──────────────────

describe("Full pipeline — validate + check + transpile", () => {
  const examples = [
    "user-registration.json",
    "product-recommendations.json",
    "customer-support-agent.json",
  ];

  for (const name of examples) {
    describe(name, () => {
      const graph = loadExample(name);

      it("validates", () => {
        expect(validateGraph(graph).valid).toBe(true);
      });

      it("type checks", () => {
        expect(checkTypes(graph as any).compatible).toBe(true);
      });

      it("transpiles to syntactically valid JS", () => {
        const output = transpileGraph(graph as any);
        // eslint-disable-next-line no-new-func
        expect(() => new Function(output)).not.toThrow();
      });
    });
  }
});
