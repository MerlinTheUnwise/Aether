import { describe, it, expect } from "vitest";
import { calculate, compare, conditional } from "../../src/implementations/arithmetic.js";

const ctx = { nodeId: "test", effects: [], confidence: 1.0, reportEffect: () => {}, log: () => {} };

describe("Arithmetic Implementations", () => {
  describe("calculate", () => {
    it("evaluates amount * rate", async () => {
      const result = await calculate({
        values: { amount: 100, rate: 0.15 },
        expression: "amount * rate",
      }, ctx);
      expect(result.result).toBeCloseTo(15);
    });

    it("handles subtraction", async () => {
      const result = await calculate({
        values: { total: 100, discount: 20 },
        expression: "total - discount",
      }, ctx);
      expect(result.result).toBe(80);
    });

    it("handles division", async () => {
      const result = await calculate({
        values: { a: 10, b: 4 },
        expression: "a / b",
      }, ctx);
      expect(result.result).toBe(2.5);
    });

    it("handles parentheses", async () => {
      const result = await calculate({
        values: { a: 2, b: 3, c: 4 },
        expression: "(a + b) * c",
      }, ctx);
      expect(result.result).toBe(20);
    });

    it("handles modulo", async () => {
      const result = await calculate({
        values: { x: 17, y: 5 },
        expression: "x % y",
      }, ctx);
      expect(result.result).toBe(2);
    });
  });

  describe("compare", () => {
    it("equal (=)", async () => {
      expect((await compare({ left: 5, right: 5, operator: "=" }, ctx)).result).toBe(true);
      expect((await compare({ left: 5, right: 6, operator: "=" }, ctx)).result).toBe(false);
    });

    it("not equal (!=)", async () => {
      expect((await compare({ left: 5, right: 6, operator: "!=" }, ctx)).result).toBe(true);
      expect((await compare({ left: 5, right: 5, operator: "!=" }, ctx)).result).toBe(false);
    });

    it("greater than (>)", async () => {
      expect((await compare({ left: 10, right: 5, operator: ">" }, ctx)).result).toBe(true);
      expect((await compare({ left: 5, right: 10, operator: ">" }, ctx)).result).toBe(false);
    });

    it("less than (<)", async () => {
      expect((await compare({ left: 3, right: 7, operator: "<" }, ctx)).result).toBe(true);
    });

    it("greater than or equal (>=)", async () => {
      expect((await compare({ left: 5, right: 5, operator: ">=" }, ctx)).result).toBe(true);
      expect((await compare({ left: 6, right: 5, operator: ">=" }, ctx)).result).toBe(true);
      expect((await compare({ left: 4, right: 5, operator: ">=" }, ctx)).result).toBe(false);
    });

    it("less than or equal (<=)", async () => {
      expect((await compare({ left: 5, right: 5, operator: "<=" }, ctx)).result).toBe(true);
      expect((await compare({ left: 4, right: 5, operator: "<=" }, ctx)).result).toBe(true);
      expect((await compare({ left: 6, right: 5, operator: "<=" }, ctx)).result).toBe(false);
    });
  });

  describe("conditional", () => {
    it("returns if_true when condition is true", async () => {
      const result = await conditional({
        condition: true,
        if_true: "yes",
        if_false: "no",
      }, ctx);
      expect(result.result).toBe("yes");
    });

    it("returns if_false when condition is false", async () => {
      const result = await conditional({
        condition: false,
        if_true: "yes",
        if_false: "no",
      }, ctx);
      expect(result.result).toBe("no");
    });
  });
});
