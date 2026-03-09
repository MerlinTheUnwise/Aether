import { describe, it, expect } from "vitest";
import {
  sortAscending,
  filterPredicate,
  deduplicate,
  aggregate,
  mapTransform,
  listOperations,
} from "../../src/implementations/collections.js";

const ctx = { nodeId: "test", effects: [], confidence: 1.0, reportEffect: () => {}, log: () => {} };

describe("Collection Implementations", () => {
  describe("sortAscending", () => {
    it("sorts numbers", async () => {
      const result = await sortAscending({ data: [3, 1, 2] }, ctx);
      expect(result.sorted).toEqual([1, 2, 3]);
    });

    it("sorts by key", async () => {
      const result = await sortAscending({
        data: [{ n: 3 }, { n: 1 }, { n: 2 }],
        key: "n",
      }, ctx);
      expect(result.sorted).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    it("output is permutation of input (same elements)", async () => {
      const input = [5, 3, 8, 1, 9];
      const result = await sortAscending({ data: input }, ctx);
      expect(result.sorted.sort()).toEqual([...input].sort());
      expect(result.sorted.length).toBe(input.length);
    });

    it("does not mutate original array", async () => {
      const data = [3, 1, 2];
      await sortAscending({ data }, ctx);
      expect(data).toEqual([3, 1, 2]);
    });
  });

  describe("filterPredicate", () => {
    it("filters with > operator", async () => {
      const result = await filterPredicate({
        data: [1, 2, 3, 4, 5],
        field: "",
        operator: ">",
        value: 3,
      }, ctx);
      expect(result.filtered).toEqual([4, 5]);
    });

    it("filters objects by field", async () => {
      const result = await filterPredicate({
        data: [{ age: 10 }, { age: 20 }, { age: 30 }],
        field: "age",
        operator: ">=",
        value: 20,
      }, ctx);
      expect(result.filtered).toEqual([{ age: 20 }, { age: 30 }]);
    });

    it("output is subset of input", async () => {
      const input = [{ x: 1 }, { x: 2 }, { x: 3 }];
      const result = await filterPredicate({
        data: input,
        field: "x",
        operator: ">",
        value: 1,
      }, ctx);
      for (const item of result.filtered) {
        expect(input).toContainEqual(item);
      }
    });

    it("filters with 'in' operator", async () => {
      const result = await filterPredicate({
        data: [{ status: "active" }, { status: "inactive" }, { status: "pending" }],
        field: "status",
        operator: "in",
        value: ["active", "pending"],
      }, ctx);
      expect(result.filtered).toEqual([{ status: "active" }, { status: "pending" }]);
    });
  });

  describe("deduplicate", () => {
    it("removes duplicate primitives", async () => {
      const result = await deduplicate({ data: [1, 2, 2, 3, 3] }, ctx);
      expect(result.unique).toEqual([1, 2, 3]);
    });

    it("deduplicates by key", async () => {
      const result = await deduplicate({
        data: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 1, name: "c" }],
        key: "id",
      }, ctx);
      expect(result.unique).toHaveLength(2);
      expect(result.unique[0].id).toBe(1);
      expect(result.unique[1].id).toBe(2);
    });

    it("preserves all unique elements", async () => {
      const result = await deduplicate({ data: [1, 2, 3] }, ctx);
      expect(result.unique).toEqual([1, 2, 3]);
    });
  });

  describe("aggregate", () => {
    it("computes sum", async () => {
      const result = await aggregate({
        data: [{ a: 10 }, { a: 20 }, { a: 30 }],
        operations: [{ field: "a", function: "sum", as: "total" }],
      }, ctx);
      expect(result.result).toEqual([{ total: 60 }]);
    });

    it("computes correct average", async () => {
      const result = await aggregate({
        data: [{ v: 10 }, { v: 20 }, { v: 30 }],
        operations: [{ field: "v", function: "avg", as: "mean" }],
      }, ctx);
      expect(result.result[0].mean).toBe(20);
    });

    it("groups correctly with group_by", async () => {
      const result = await aggregate({
        data: [
          { cat: "A", v: 10 },
          { cat: "B", v: 20 },
          { cat: "A", v: 30 },
        ],
        operations: [{ field: "v", function: "sum", as: "total" }],
        group_by: ["cat"],
      }, ctx);
      expect(result.result).toHaveLength(2);
      const groupA = result.result.find((r: any) => r.cat === "A");
      const groupB = result.result.find((r: any) => r.cat === "B");
      expect(groupA.total).toBe(40);
      expect(groupB.total).toBe(20);
    });

    it("computes count", async () => {
      const result = await aggregate({
        data: [{ a: 1 }, { a: 2 }, { a: 3 }],
        operations: [{ field: "a", function: "count", as: "cnt" }],
      }, ctx);
      expect(result.result[0].cnt).toBe(3);
    });

    it("computes min and max", async () => {
      const result = await aggregate({
        data: [{ v: 5 }, { v: 1 }, { v: 9 }],
        operations: [
          { field: "v", function: "min", as: "lo" },
          { field: "v", function: "max", as: "hi" },
        ],
      }, ctx);
      expect(result.result[0].lo).toBe(1);
      expect(result.result[0].hi).toBe(9);
    });
  });

  describe("mapTransform", () => {
    it("applies field reference transformation", async () => {
      const result = await mapTransform({
        data: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
        transformations: { a: "x", b: "y" },
      }, ctx);
      expect(result.mapped).toEqual([{ a: 1, b: 2 }, { a: 3, b: 4 }]);
    });

    it("applies expression transformation", async () => {
      const result = await mapTransform({
        data: [{ x: 2 }, { x: 3 }],
        transformations: { doubled: "x * 2" },
      }, ctx);
      expect(result.mapped).toEqual([{ doubled: 4 }, { doubled: 6 }]);
    });
  });

  describe("listOperations", () => {
    const data = [10, 20, 30, 40, 50];

    it("length", async () => {
      const r = await listOperations({ data, operation: "length" }, ctx);
      expect(r.result).toBe(5);
    });

    it("first", async () => {
      const r = await listOperations({ data, operation: "first" }, ctx);
      expect(r.result).toBe(10);
    });

    it("last", async () => {
      const r = await listOperations({ data, operation: "last" }, ctx);
      expect(r.result).toBe(50);
    });

    it("reverse", async () => {
      const r = await listOperations({ data, operation: "reverse" }, ctx);
      expect(r.result).toEqual([50, 40, 30, 20, 10]);
    });

    it("take", async () => {
      const r = await listOperations({ data, operation: "take", count: 2 }, ctx);
      expect(r.result).toEqual([10, 20]);
    });

    it("skip", async () => {
      const r = await listOperations({ data, operation: "skip", count: 3 }, ctx);
      expect(r.result).toEqual([40, 50]);
    });

    it("flatten", async () => {
      const r = await listOperations({ data: [[1, 2], [3, 4]], operation: "flatten" }, ctx);
      expect(r.result).toEqual([1, 2, 3, 4]);
    });
  });
});
