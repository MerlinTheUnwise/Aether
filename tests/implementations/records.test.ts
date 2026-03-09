import { describe, it, expect } from "vitest";
import {
  createRecord,
  mergeRecords,
  extractFields,
  validateRecord,
} from "../../src/implementations/records.js";

const ctx = { nodeId: "test", effects: [], confidence: 1.0, reportEffect: () => {}, log: () => {} };

describe("Record Implementations", () => {
  describe("createRecord", () => {
    it("produces record with specified fields", async () => {
      const result = await createRecord({
        fields: { name: "Alice", age: 30 },
      }, ctx);
      expect(result.record).toEqual({ name: "Alice", age: 30 });
    });

    it("applies defaults for missing fields", async () => {
      const result = await createRecord({
        fields: { name: "Alice" },
        defaults: { name: "Unknown", role: "user" },
      }, ctx);
      expect(result.record).toEqual({ name: "Alice", role: "user" });
    });
  });

  describe("mergeRecords", () => {
    it("deep merges with override priority", async () => {
      const result = await mergeRecords({
        base: { a: 1, nested: { x: 10, y: 20 } },
        override: { b: 2, nested: { y: 99 } },
      }, ctx);
      expect(result.merged).toEqual({
        a: 1,
        b: 2,
        nested: { x: 10, y: 99 },
      });
    });

    it("override replaces arrays (not deep merge)", async () => {
      const result = await mergeRecords({
        base: { items: [1, 2] },
        override: { items: [3, 4] },
      }, ctx);
      expect(result.merged.items).toEqual([3, 4]);
    });
  });

  describe("extractFields", () => {
    it("picks correct subset", async () => {
      const result = await extractFields({
        record: { a: 1, b: 2, c: 3, d: 4 },
        fields: ["a", "c"],
      }, ctx);
      expect(result.extracted).toEqual({ a: 1, c: 3 });
    });

    it("ignores missing fields", async () => {
      const result = await extractFields({
        record: { a: 1 },
        fields: ["a", "z"],
      }, ctx);
      expect(result.extracted).toEqual({ a: 1 });
    });
  });

  describe("validateRecord", () => {
    it("valid when all required fields present", async () => {
      const result = await validateRecord({
        record: { name: "Alice", age: 30 },
        required_fields: ["name", "age"],
      }, ctx);
      expect(result.valid).toBe(true);
      expect(result.missing_fields).toEqual([]);
    });

    it("invalid with missing required field named", async () => {
      const result = await validateRecord({
        record: { name: "Alice" },
        required_fields: ["name", "age", "email"],
      }, ctx);
      expect(result.valid).toBe(false);
      expect(result.missing_fields).toContain("age");
      expect(result.missing_fields).toContain("email");
    });

    it("reports type errors", async () => {
      const result = await validateRecord({
        record: { name: 42, age: "not a number" },
        required_fields: ["name"],
        field_types: { name: "string", age: "number" },
      }, ctx);
      expect(result.valid).toBe(false);
      expect(result.type_errors.length).toBeGreaterThan(0);
    });
  });
});
