import { describe, it, expect } from "vitest";
import {
  getCoreImplementations,
  findImplementation,
  findBySignature,
} from "../../src/implementations/index.js";

describe("Implementation Index", () => {
  it("getCoreImplementations returns all 18 implementations", () => {
    const impls = getCoreImplementations();
    expect(impls.length).toBe(18);
    // Verify each has required metadata
    for (const impl of impls) {
      expect(impl.meta.id).toBeTruthy();
      expect(impl.meta.description).toBeTruthy();
      expect(typeof impl.fn).toBe("function");
    }
  });

  it("findImplementation by exact ID", () => {
    const impl = findImplementation("validate_email");
    expect(impl).not.toBeNull();
    expect(impl!.meta.id).toBe("validate_email");
  });

  it("findImplementation by pattern match", () => {
    const impl = findImplementation("scope_validate_email");
    expect(impl).not.toBeNull();
    expect(impl!.meta.id).toBe("validate_email");
  });

  it("findImplementation returns null for unknown", () => {
    expect(findImplementation("nonexistent_thing")).toBeNull();
  });

  it("findBySignature matches by input/output types", () => {
    const results = findBySignature(
      { email: "String" },
      { valid: "Bool", normalized: "String" },
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].meta.id).toBe("validate_email");
  });

  it("findBySignature returns empty for non-matching", () => {
    const results = findBySignature(
      { foo: "Xyz" },
      { bar: "Abc" },
    );
    expect(results).toEqual([]);
  });

  it("all implementations are pure and deterministic", () => {
    const impls = getCoreImplementations();
    for (const impl of impls) {
      expect(impl.meta.pure).toBe(true);
      expect(impl.meta.deterministic).toBe(true);
      expect(impl.meta.effects).toEqual([]);
    }
  });
});
