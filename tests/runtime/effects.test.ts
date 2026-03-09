import { describe, it, expect } from "vitest";
import { EffectTracker } from "../../src/runtime/effects.js";
import type { AetherGraph, AetherNode } from "../../src/ir/validator.js";

function makeNode(id: string, opts: { pure?: boolean; effects: string[] }): AetherNode {
  return {
    id,
    in: {},
    out: {},
    contract: {},
    effects: opts.effects,
    pure: opts.pure,
  };
}

function makeGraph(nodes: AetherNode[]): AetherGraph {
  return {
    id: "test",
    version: 1,
    effects: [],
    nodes,
    edges: [],
  };
}

describe("EffectTracker", () => {
  it("pure node records no effects -> pass", () => {
    const graph = makeGraph([makeNode("a", { pure: true, effects: [] })]);
    const tracker = new EffectTracker(graph);

    // No effects recorded
    expect(tracker.getViolations()).toHaveLength(0);

    const report = tracker.getReport();
    expect(report.pureNodesVerified).toBe(1);
  });

  it("pure node records an effect -> violation detected", () => {
    const graph = makeGraph([makeNode("a", { pure: true, effects: [] })]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "database.read");

    const violations = tracker.getViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Pure node");
    expect(violations[0]).toContain("database.read");
  });

  it("effectful node records declared effect -> pass", () => {
    const graph = makeGraph([makeNode("a", { effects: ["database.write"] })]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "database.write");

    expect(tracker.getViolations()).toHaveLength(0);
  });

  it("effectful node records undeclared effect -> violation", () => {
    const graph = makeGraph([makeNode("a", { effects: ["database.read"] })]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "email");

    const violations = tracker.getViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("undeclared effect");
    expect(violations[0]).toContain("email");
  });

  it("effect hierarchy: 'database' covers 'database.read'", () => {
    const graph = makeGraph([makeNode("a", { effects: ["database"] })]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "database.read");

    expect(tracker.getViolations()).toHaveLength(0);
  });

  it("effect hierarchy: 'database' covers 'database.write'", () => {
    const graph = makeGraph([makeNode("a", { effects: ["database"] })]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "database.write");

    expect(tracker.getViolations()).toHaveLength(0);
  });

  it("effect hierarchy: 'database.read_write' covers 'database.read' and 'database.write'", () => {
    const graph = makeGraph([makeNode("a", { effects: ["database.read_write"] })]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "database.read");
    tracker.recordEffect("a", "database.write");

    expect(tracker.getViolations()).toHaveLength(0);
  });

  it("report tracks all executed effects", () => {
    const graph = makeGraph([
      makeNode("a", { effects: ["database.read"] }),
      makeNode("b", { pure: true, effects: [] }),
    ]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "database.read");

    const report = tracker.getReport();
    expect(report.executedEffects).toEqual(["database.read"]);
    expect(report.pureNodesVerified).toBe(1); // b had no effects
    expect(report.violations).toHaveLength(0);
  });

  it("node with empty effects treated as pure", () => {
    const graph = makeGraph([makeNode("a", { effects: [] })]);
    const tracker = new EffectTracker(graph);

    tracker.recordEffect("a", "database.read");

    const violations = tracker.getViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("Pure node");
  });
});
