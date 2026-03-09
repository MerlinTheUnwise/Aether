import { describe, it, expect } from "vitest";
import {
  validateEmail,
  normalizeString,
  formatCheck,
  stringContains,
  stringTransform,
} from "../../src/implementations/strings.js";

const ctx = { nodeId: "test", effects: [], confidence: 1.0, reportEffect: () => {}, log: () => {} };

describe("String Implementations", () => {
  describe("validateEmail", () => {
    it("accepts valid email", async () => {
      const result = await validateEmail({ email: "user@example.com" }, ctx);
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("user@example.com");
    });

    it("rejects non-email", async () => {
      const result = await validateEmail({ email: "not-an-email" }, ctx);
      expect(result.valid).toBe(false);
    });

    it("normalizes to lowercase and trimmed", async () => {
      const result = await validateEmail({ email: "  User@EXAMPLE.com  " }, ctx);
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe("user@example.com");
    });

    it("rejects email without domain", async () => {
      const result = await validateEmail({ email: "user@" }, ctx);
      expect(result.valid).toBe(false);
    });

    it("rejects email without TLD", async () => {
      const result = await validateEmail({ email: "user@example" }, ctx);
      expect(result.valid).toBe(false);
    });

    it("rejects email with consecutive dots in local", async () => {
      const result = await validateEmail({ email: "user..name@example.com" }, ctx);
      expect(result.valid).toBe(false);
    });
  });

  describe("normalizeString", () => {
    it("lowercases and trims", async () => {
      const result = await normalizeString({ value: "  HELLO  " }, ctx);
      expect(result.normalized).toBe("hello");
    });

    it("handles already normalized", async () => {
      const result = await normalizeString({ value: "hello" }, ctx);
      expect(result.normalized).toBe("hello");
    });
  });

  describe("formatCheck", () => {
    it("validates correct UUID v4", async () => {
      const result = await formatCheck({
        value: "550e8400-e29b-41d4-a716-446655440000",
        format: "uuid_v4",
      }, ctx);
      expect(result.valid).toBe(true);
    });

    it("rejects bad UUID v4", async () => {
      const result = await formatCheck({ value: "not-a-uuid", format: "uuid_v4" }, ctx);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("validates JWT pattern", async () => {
      const result = await formatCheck({
        value: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123",
        format: "jwt",
      }, ctx);
      expect(result.valid).toBe(true);
    });

    it("returns error for unknown format", async () => {
      const result = await formatCheck({ value: "test", format: "unknown_format" }, ctx);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown format");
    });
  });

  describe("stringContains", () => {
    it("finds substring", async () => {
      const result = await stringContains({ haystack: "hello world", needle: "world" }, ctx);
      expect(result.found).toBe(true);
    });

    it("returns false when not found", async () => {
      const result = await stringContains({ haystack: "hello world", needle: "xyz" }, ctx);
      expect(result.found).toBe(false);
    });
  });

  describe("stringTransform", () => {
    it("slug operation", async () => {
      const result = await stringTransform({ value: "Hello World", operation: "slug" }, ctx);
      expect(result.result).toBe("hello-world");
    });

    it("uppercase operation", async () => {
      const result = await stringTransform({ value: "hello", operation: "uppercase" }, ctx);
      expect(result.result).toBe("HELLO");
    });

    it("reverse operation", async () => {
      const result = await stringTransform({ value: "abc", operation: "reverse" }, ctx);
      expect(result.result).toBe("cba");
    });

    it("throws on unknown operation", async () => {
      await expect(stringTransform({ value: "x", operation: "nope" }, ctx)).rejects.toThrow();
    });
  });
});
