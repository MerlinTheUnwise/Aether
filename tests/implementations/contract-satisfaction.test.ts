/**
 * Contract Satisfaction Tests
 *
 * Runs each core implementation with test inputs, then verifies that outputs
 * satisfy corresponding contracts using the contract evaluator from Session 1.
 *
 * This closes the loop: Z3 verifies contracts at compile time, the evaluator
 * checks them at runtime, and the implementations actually satisfy them.
 */

import { describe, it, expect } from "vitest";
import { checkContract } from "../../src/runtime/evaluator/index.js";
import { validateEmail } from "../../src/implementations/strings.js";
import { sortAscending, filterPredicate, deduplicate, aggregate } from "../../src/implementations/collections.js";

const ctx = { nodeId: "test", effects: [], confidence: 1.0, reportEffect: () => {}, log: () => {} };

describe("Contract Satisfaction — implementations satisfy declared contracts", () => {
  describe("validateEmail → normalized.is_lowercase ∧ normalized.is_trimmed", () => {
    it("output is lowercase", async () => {
      const output = await validateEmail({ email: "  User@EXAMPLE.COM  " }, ctx);
      expect(output.normalized).toBe(output.normalized.toLowerCase());
    });

    it("output is trimmed", async () => {
      const output = await validateEmail({ email: "  User@EXAMPLE.COM  " }, ctx);
      expect(output.normalized).toBe(output.normalized.trim());
    });

    it("contract evaluator confirms lowercase + trimmed", async () => {
      const output = await validateEmail({ email: "Test@Example.COM" }, ctx);
      // Check that normalized is lowercase
      const lcResult = checkContract(
        "normalized == lower_normalized",
        { normalized: output.normalized, lower_normalized: output.normalized.toLowerCase() },
      );
      expect(lcResult.passed).toBe(true);

      // Check that normalized is trimmed
      const trimResult = checkContract(
        "normalized == trimmed_normalized",
        { normalized: output.normalized, trimmed_normalized: output.normalized.trim() },
      );
      expect(trimResult.passed).toBe(true);
    });
  });

  describe("sortAscending → output.is_sorted", () => {
    it("output is sorted in ascending order", async () => {
      const output = await sortAscending({ data: [5, 3, 8, 1, 9, 2] }, ctx);
      for (let i = 1; i < output.sorted.length; i++) {
        expect(output.sorted[i]).toBeGreaterThanOrEqual(output.sorted[i - 1]);
      }
    });

    it("output is permutation (same length, same elements)", async () => {
      const input = [5, 3, 8, 1, 9, 2];
      const output = await sortAscending({ data: input }, ctx);
      expect(output.sorted.length).toBe(input.length);
      expect([...output.sorted].sort()).toEqual([...input].sort());
    });

    it("contract evaluator confirms sorted via pairwise check", async () => {
      const output = await sortAscending({ data: [10, 1, 7, 3] }, ctx);
      // Check pairwise: each element <= next
      for (let i = 0; i < output.sorted.length - 1; i++) {
        const result = checkContract("a <= b", { a: output.sorted[i], b: output.sorted[i + 1] });
        expect(result.passed).toBe(true);
      }
    });
  });

  describe("deduplicate → output.distinct", () => {
    it("no duplicates in output", async () => {
      const output = await deduplicate({ data: [1, 2, 2, 3, 3, 3, 4] }, ctx);
      const uniqueSet = new Set(output.unique);
      expect(uniqueSet.size).toBe(output.unique.length);
    });

    it("all unique elements preserved", async () => {
      const input = [1, 2, 2, 3, 3, 3, 4];
      const output = await deduplicate({ data: input }, ctx);
      const inputUnique = [...new Set(input)];
      expect(output.unique).toEqual(inputUnique);
    });

    it("contract evaluator confirms distinct count", async () => {
      const output = await deduplicate({ data: [1, 1, 2, 2, 3] }, ctx);
      const result = checkContract("count == unique_count", {
        count: output.unique.length,
        unique_count: new Set(output.unique).size,
      });
      expect(result.passed).toBe(true);
    });
  });

  describe("aggregate sum → result = sum(data.field)", () => {
    it("sum is mathematically correct", async () => {
      const data = [{ amount: 10 }, { amount: 20 }, { amount: 30 }];
      const expectedSum = data.reduce((s, d) => s + d.amount, 0);

      const output = await aggregate({
        data,
        operations: [{ field: "amount", function: "sum", as: "total" }],
      }, ctx);

      expect(output.result[0].total).toBe(expectedSum);
    });

    it("avg is mathematically correct", async () => {
      const data = [{ v: 10 }, { v: 20 }, { v: 30 }];
      const expectedAvg = data.reduce((s, d) => s + d.v, 0) / data.length;

      const output = await aggregate({
        data,
        operations: [{ field: "v", function: "avg", as: "mean" }],
      }, ctx);

      expect(output.result[0].mean).toBe(expectedAvg);
    });

    it("contract evaluator confirms sum equality", async () => {
      const data = [{ x: 5 }, { x: 15 }, { x: 25 }];
      const output = await aggregate({
        data,
        operations: [{ field: "x", function: "sum", as: "total" }],
      }, ctx);

      const manualSum = 5 + 15 + 25;
      const result = checkContract("total == expected", {
        total: output.result[0].total,
        expected: manualSum,
      });
      expect(result.passed).toBe(true);
    });
  });

  describe("filterPredicate → ∀x ∈ filtered: x satisfies predicate ∧ filtered ⊆ data", () => {
    it("all output elements satisfy the predicate", async () => {
      const output = await filterPredicate({
        data: [1, 2, 3, 4, 5, 6, 7, 8],
        field: "",
        operator: ">",
        value: 5,
      }, ctx);

      for (const item of output.filtered) {
        expect(item).toBeGreaterThan(5);
      }
    });

    it("output is subset of input", async () => {
      const input = [10, 20, 30, 40, 50];
      const output = await filterPredicate({
        data: input,
        field: "",
        operator: ">=",
        value: 30,
      }, ctx);

      for (const item of output.filtered) {
        expect(input).toContain(item);
      }
      expect(output.filtered.length).toBeLessThanOrEqual(input.length);
    });

    it("contract evaluator confirms predicate satisfaction", async () => {
      const output = await filterPredicate({
        data: [{ score: 80 }, { score: 55 }, { score: 92 }, { score: 40 }],
        field: "score",
        operator: ">=",
        value: 70,
      }, ctx);

      for (const item of output.filtered) {
        const result = checkContract("score >= threshold", {
          score: item.score,
          threshold: 70,
        });
        expect(result.passed).toBe(true);
      }
    });
  });
});
