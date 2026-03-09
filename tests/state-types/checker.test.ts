/**
 * State Type Checker Tests
 */

import { describe, it, expect } from "vitest";
import { checkTypes } from "../../src/compiler/checker.js";

function makeGraph(nodes: any[], edges: any[]): any {
  return {
    id: "test_checker",
    version: 1,
    effects: [],
    nodes,
    edges,
  };
}

describe("State Type Checker", () => {
  it("matching state_type on edge → compatible", () => {
    const graph = makeGraph(
      [
        {
          id: "a",
          in: {},
          out: { status: { type: "String", state_type: "OrderLifecycle" } },
          contract: {},
          effects: [],
        },
        {
          id: "b",
          in: { status: { type: "String", state_type: "OrderLifecycle" } },
          out: {},
          contract: {},
          effects: [],
        },
      ],
      [{ from: "a.status", to: "b.status" }]
    );

    const result = checkTypes(graph);
    expect(result.compatible).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("mismatched state_type → error", () => {
    const graph = makeGraph(
      [
        {
          id: "a",
          in: {},
          out: { status: { type: "String", state_type: "OrderLifecycle" } },
          contract: {},
          effects: [],
        },
        {
          id: "b",
          in: { status: { type: "String", state_type: "PaymentLifecycle" } },
          out: {},
          contract: {},
          effects: [],
        },
      ],
      [{ from: "a.status", to: "b.status" }]
    );

    const result = checkTypes(graph);
    expect(result.compatible).toBe(false);
    expect(result.errors.some(e => e.code === "STATE_TYPE_MISMATCH")).toBe(true);
  });

  it("state type on one side, missing on other → warning", () => {
    const graph = makeGraph(
      [
        {
          id: "a",
          in: {},
          out: { status: { type: "String", state_type: "OrderLifecycle" } },
          contract: {},
          effects: [],
        },
        {
          id: "b",
          in: { status: { type: "String" } },
          out: {},
          contract: {},
          effects: [],
        },
      ],
      [{ from: "a.status", to: "b.status" }]
    );

    const result = checkTypes(graph);
    expect(result.compatible).toBe(true);
    expect(result.warnings.some(w => w.code === "STATE_TYPE_LOST")).toBe(true);
  });

  it("state type on destination only → warning", () => {
    const graph = makeGraph(
      [
        {
          id: "a",
          in: {},
          out: { status: { type: "String" } },
          contract: {},
          effects: [],
        },
        {
          id: "b",
          in: { status: { type: "String", state_type: "OrderLifecycle" } },
          out: {},
          contract: {},
          effects: [],
        },
      ],
      [{ from: "a.status", to: "b.status" }]
    );

    const result = checkTypes(graph);
    expect(result.compatible).toBe(true);
    expect(result.warnings.some(w => w.code === "STATE_TYPE_LOST")).toBe(true);
  });
});
