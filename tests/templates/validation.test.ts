/**
 * Template Validation Tests
 */

import { describe, it, expect } from "vitest";
import { validateTemplate } from "../../src/compiler/templates.js";
import type { AetherTemplate } from "../../src/ir/validator.js";

function makeTemplate(overrides?: Partial<AetherTemplate>): AetherTemplate {
  return {
    id: "test-template",
    parameters: [
      { name: "Entity", kind: "type" },
      { name: "storage_effect", kind: "effect" },
    ],
    nodes: [
      {
        id: "do_thing",
        in: { data: { type: "$Entity" } },
        out: { result: { type: "$Entity" } },
        contract: { pre: ["input.data != null"], post: ["output.result != null"] },
        effects: ["$storage_effect"],
        recovery: { fail: { action: "retry", params: { max: 3 } } },
      },
    ],
    edges: [],
    ...overrides,
  };
}

describe("Template Validation", () => {
  it("valid template passes validation", () => {
    const result = validateTemplate(makeTemplate());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("template missing id fails", () => {
    const result = validateTemplate(makeTemplate({ id: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("non-empty id"))).toBe(true);
  });

  it("duplicate parameter name fails", () => {
    const result = validateTemplate(makeTemplate({
      parameters: [
        { name: "Entity", kind: "type" },
        { name: "Entity", kind: "value" },
      ],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Duplicate template parameter"))).toBe(true);
  });

  it("invalid parameter kind fails", () => {
    const result = validateTemplate(makeTemplate({
      parameters: [
        { name: "X", kind: "bogus" as any },
      ],
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("invalid kind"))).toBe(true);
  });

  it("warns about undeclared parameter references", () => {
    const result = validateTemplate(makeTemplate({
      parameters: [{ name: "Entity", kind: "type" }],
      // nodes reference $storage_effect which is not declared
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes("undeclared parameter"))).toBe(true);
  });
});
