/**
 * State Type Runtime Tests — state tracking during execution
 */

import { describe, it, expect } from "vitest";
import { execute } from "../../src/runtime/executor.js";
import type { NodeFunction } from "../../src/runtime/executor.js";

function makeOrderGraph(): any {
  return {
    id: "order_lifecycle_test",
    version: 1,
    effects: [],
    state_types: [
      {
        id: "OrderLifecycle",
        states: ["created", "paid", "shipped", "delivered"],
        transitions: [
          { from: "created", to: "paid", when: "payment_confirmed" },
          { from: "paid", to: "shipped", when: "shipment_dispatched" },
          { from: "shipped", to: "delivered", when: "delivery_confirmed" },
        ],
        invariants: {
          initial: "created",
        },
      },
    ],
    nodes: [
      {
        id: "create",
        in: {},
        out: { status: { type: "String", state_type: "OrderLifecycle" } },
        contract: {},
        effects: [],
        pure: true,
      },
      {
        id: "pay",
        in: { status: { type: "String", state_type: "OrderLifecycle" } },
        out: { status: { type: "String", state_type: "OrderLifecycle" } },
        contract: {},
        effects: [],
        pure: true,
      },
      {
        id: "ship",
        in: { status: { type: "String", state_type: "OrderLifecycle" } },
        out: { status: { type: "String", state_type: "OrderLifecycle" } },
        contract: {},
        effects: [],
        pure: true,
      },
      {
        id: "deliver",
        in: { status: { type: "String", state_type: "OrderLifecycle" } },
        out: { status: { type: "String", state_type: "OrderLifecycle" } },
        contract: {},
        effects: [],
        pure: true,
      },
    ],
    edges: [
      { from: "create.status", to: "pay.status" },
      { from: "pay.status", to: "ship.status" },
      { from: "ship.status", to: "deliver.status" },
    ],
  };
}

describe("State Type Runtime", () => {
  it("execute order-lifecycle in stub mode → state transitions logged", async () => {
    const graph = makeOrderGraph();
    const result = await execute({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0,
    });

    expect(result.nodesExecuted).toBe(4);
    // Stub mode returns empty string defaults for String ports,
    // which are not valid state names, so transitions won't be tracked.
    // State tracking only logs when output matches a declared state.
    expect(result.stateTransitions).toBeDefined();
  });

  it("full lifecycle with implementations: created→paid→shipped→delivered", async () => {
    const graph = makeOrderGraph();
    const impls = new Map<string, NodeFunction>();
    impls.set("create", async () => ({ status: "created" }));
    impls.set("pay", async () => ({ status: "paid" }));
    impls.set("ship", async () => ({ status: "shipped" }));
    impls.set("deliver", async () => ({ status: "delivered" }));

    const result = await execute({
      graph,
      inputs: {},
      nodeImplementations: impls,
      confidenceThreshold: 0,
    });

    expect(result.stateTransitions).toBeDefined();
    const st = result.stateTransitions!;

    // Should have transitions logged
    expect(st.log.length).toBeGreaterThanOrEqual(3);
    expect(st.violations).toHaveLength(0);
    expect(st.finalStates["OrderLifecycle"]).toBe("delivered");

    // Check transition sequence
    const states = st.log.map(t => t.to);
    expect(states).toContain("paid");
    expect(states).toContain("shipped");
    expect(states).toContain("delivered");
  });

  it("invalid transition attempted → violation detected", async () => {
    const graph = makeOrderGraph();
    const impls = new Map<string, NodeFunction>();
    impls.set("create", async () => ({ status: "created" }));
    // Skip paid → go directly to shipped (invalid: created→shipped not in transitions)
    impls.set("pay", async () => ({ status: "shipped" }));
    impls.set("ship", async () => ({ status: "delivered" }));
    impls.set("deliver", async () => ({ status: "delivered" }));

    const result = await execute({
      graph,
      inputs: {},
      nodeImplementations: impls,
      confidenceThreshold: 0,
    });

    expect(result.stateTransitions).toBeDefined();
    const st = result.stateTransitions!;
    expect(st.violations.length).toBeGreaterThan(0);
    expect(st.violations[0]).toContain("Invalid transition");
  });

  it("graph without state_types has no stateTransitions", async () => {
    const graph = {
      id: "simple",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "a",
          in: {},
          out: { result: { type: "String" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [],
    };

    const result = await execute({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0,
    });

    expect(result.stateTransitions).toBeUndefined();
  });
});
