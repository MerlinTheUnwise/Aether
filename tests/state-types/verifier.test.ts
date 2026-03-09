/**
 * State Type Verifier Tests — Z3 verification of state transition invariants
 */

import { describe, it, expect } from "vitest";
import { verifyGraph } from "../../src/compiler/verifier.js";

function makeGraphWithStateTypes(stateTypes: any[]): any {
  return {
    id: "test_state_verify",
    version: 1,
    effects: [],
    nodes: [
      {
        id: "node_a",
        in: {},
        out: { status: { type: "String" } },
        contract: { post: ["status == \"created\""] },
        effects: [],
        pure: true,
      },
    ],
    edges: [],
    state_types: stateTypes,
  };
}

describe("State Type Verifier", () => {
  it("never-invariant verified (cancelled→paid is impossible) → UNSAT → pass", async () => {
    const graph = makeGraphWithStateTypes([
      {
        id: "OrderLifecycle",
        states: ["created", "paid", "cancelled"],
        transitions: [
          { from: "created", to: "paid", when: "payment_confirmed" },
          { from: "created", to: "cancelled", when: "customer_cancelled" },
        ],
        invariants: {
          never: [{ from: "cancelled", to: "paid" }],
        },
      },
    ]);

    const report = await verifyGraph(graph);
    expect(report.stateTypeResults).toHaveLength(1);
    const stResult = report.stateTypeResults[0];
    expect(stResult.id).toBe("OrderLifecycle");
    expect(stResult.neverInvariants.checked).toBe(1);
    expect(stResult.neverInvariants.verified).toBe(1);
  });

  it("terminal invariant verified (no transitions from cancelled) → UNSAT → pass", async () => {
    const graph = makeGraphWithStateTypes([
      {
        id: "OrderLifecycle",
        states: ["created", "paid", "cancelled"],
        transitions: [
          { from: "created", to: "paid", when: "payment_confirmed" },
          { from: "created", to: "cancelled", when: "customer_cancelled" },
        ],
        invariants: {
          terminal: ["cancelled"],
        },
      },
    ]);

    const report = await verifyGraph(graph);
    expect(report.stateTypeResults).toHaveLength(1);
    const stResult = report.stateTypeResults[0];
    expect(stResult.terminalInvariants.checked).toBe(1);
    expect(stResult.terminalInvariants.verified).toBe(1);
  });

  it("valid transition sequence verified", async () => {
    const graph = makeGraphWithStateTypes([
      {
        id: "Simple",
        states: ["a", "b", "c"],
        transitions: [
          { from: "a", to: "b", when: "step1" },
          { from: "b", to: "c", when: "step2" },
        ],
        invariants: {
          never: [{ from: "c", to: "a" }],
          terminal: ["c"],
          initial: "a",
        },
      },
    ]);

    const report = await verifyGraph(graph);
    const stResult = report.stateTypeResults[0];
    expect(stResult.states).toBe(3);
    expect(stResult.transitions).toBe(2);
    expect(stResult.neverInvariants.verified).toBe(1);
    expect(stResult.terminalInvariants.verified).toBe(1);
  });

  it("graph with no state_types returns empty stateTypeResults", async () => {
    const graph = {
      id: "no_state_types",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: {},
          out: { result: { type: "String" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [],
    };

    const report = await verifyGraph(graph);
    expect(report.stateTypeResults).toHaveLength(0);
  });
});
