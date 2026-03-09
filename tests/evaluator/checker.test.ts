import { describe, it, expect } from "vitest";
import { checkContract, checkNodeContracts, checkAdversarial, AdversarialViolation } from "../../src/runtime/evaluator/checker.js";
import type { AetherNode } from "../../src/ir/validator.js";

function makeNode(overrides: Partial<AetherNode> = {}): AetherNode {
  return {
    id: "test_node",
    in: { x: { type: "Int" } },
    out: { y: { type: "Int" } },
    contract: { pre: [], post: [], invariants: [] },
    effects: [],
    ...overrides,
  } as AetherNode;
}

describe("Contract Checker", () => {
  describe("checkContract", () => {
    it("postcondition passes → passed: true", () => {
      const result = checkContract("x > 0", { x: 5 });
      expect(result.passed).toBe(true);
      expect(result.unevaluable).toBe(false);
      expect(result.evaluated_value).toBe(true);
    });

    it("postcondition fails → passed: false", () => {
      const result = checkContract("x > 0", { x: -1 });
      expect(result.passed).toBe(false);
      expect(result.unevaluable).toBe(false);
      expect(result.evaluated_value).toBe(false);
    });

    it("unevaluable expression → unevaluable: true, warning logged", () => {
      const result = checkContract("x > 0", {}); // x not defined
      expect(result.unevaluable).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("parse error → unevaluable: true", () => {
      const result = checkContract("x @ y", { x: 1, y: 2 });
      expect(result.unevaluable).toBe(true);
    });

    it("complex expression evaluates correctly", () => {
      const result = checkContract("∀p ∈ items: p > 0", { items: [1, 2, 3] });
      expect(result.passed).toBe(true);
      expect(result.unevaluable).toBe(false);
    });
  });

  describe("checkAdversarial", () => {
    it("adversarial not triggered → allClear: true", () => {
      const report = checkAdversarial(
        { break_if: ["x > 100"] },
        { x: 5 },
        {}
      );
      expect(report.allClear).toBe(true);
      expect(report.checks[0].triggered).toBe(false);
    });

    it("adversarial triggered → triggered: true", () => {
      const report = checkAdversarial(
        { break_if: ["x > 100"] },
        { x: 200 },
        {}
      );
      expect(report.allClear).toBe(false);
      expect(report.checks[0].triggered).toBe(true);
    });

    it("no adversarial check → allClear: true, empty checks", () => {
      const report = checkAdversarial(undefined, {}, {});
      expect(report.allClear).toBe(true);
      expect(report.checks).toEqual([]);
    });
  });

  describe("checkNodeContracts", () => {
    it("full node check with all passing", () => {
      const node = makeNode({
        contract: {
          pre: ["x > 0"],
          post: ["y > 0"],
          invariants: ["y ≥ x"],
        },
      });
      const report = checkNodeContracts(node, { x: 5 }, { y: 10 });
      expect(report.allPassed).toBe(true);
      expect(report.preconditions[0].passed).toBe(true);
      expect(report.postconditions[0].passed).toBe(true);
      expect(report.invariants[0].passed).toBe(true);
      expect(report.unevaluableCount).toBe(0);
    });

    it("postcondition fails → allPassed: false", () => {
      const node = makeNode({
        contract: {
          pre: ["x > 0"],
          post: ["y > 100"],
        },
      });
      const report = checkNodeContracts(node, { x: 5 }, { y: 10 });
      expect(report.allPassed).toBe(false);
      expect(report.postconditions[0].passed).toBe(false);
    });

    it("mixed results → correct counts", () => {
      const node = makeNode({
        contract: {
          pre: ["x > 0"],
          post: ["y > 100", "y > 0"],
        },
      });
      const report = checkNodeContracts(node, { x: 5 }, { y: 10 });
      expect(report.postconditions[0].passed).toBe(false); // y > 100 fails
      expect(report.postconditions[1].passed).toBe(true);  // y > 0 passes
    });

    it("unevaluable contracts counted separately", () => {
      const node = makeNode({
        contract: {
          post: ["nonexistent_var > 0", "y > 0"],
        },
      });
      const report = checkNodeContracts(node, {}, { y: 5 });
      expect(report.unevaluableCount).toBe(1);
      expect(report.postconditions[0].unevaluable).toBe(true);
      expect(report.postconditions[1].passed).toBe(true);
    });

    it("adversarial triggered → allPassed: false", () => {
      const node = makeNode({
        adversarial_check: { break_if: ["y > 100"] },
      });
      const report = checkNodeContracts(node, {}, { y: 200 });
      expect(report.allPassed).toBe(false);
      expect(report.adversarial.allClear).toBe(false);
    });
  });

  describe("AdversarialViolation", () => {
    it("creates error with correct properties", () => {
      const err = new AdversarialViolation("node1", "x > 100");
      expect(err.name).toBe("AdversarialViolation");
      expect(err.nodeId).toBe("node1");
      expect(err.expression).toBe("x > 100");
      expect(err.message).toContain("node1");
    });
  });
});
