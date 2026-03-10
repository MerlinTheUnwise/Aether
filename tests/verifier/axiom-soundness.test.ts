/**
 * Tests for axiom soundness checking.
 * Validates that axioms actually hold at runtime against real execution data.
 */

import { describe, it, expect } from "vitest";
import { checkAxiomSoundness } from "../../src/compiler/verifier.js";

function makeNode(overrides: Record<string, any>) {
  return {
    id: "test_node",
    in: {},
    out: {},
    contract: { post: [] },
    effects: [],
    ...overrides,
  };
}

describe("Axiom soundness checking", () => {
  it("correct axiom + correct execution → sound", () => {
    const node = makeNode({
      id: "validate",
      out: { count: { type: "Int" } },
      axioms: ["count >= 0"],
    });

    const result = checkAxiomSoundness(node, {}, { count: 5 });
    expect(result.allSound).toBe(true);
    expect(result.axioms[0].holdsAtRuntime).toBe(true);
  });

  it("incorrect axiom + real execution → unsound detected", () => {
    const node = makeNode({
      id: "validate",
      out: { count: { type: "Int" } },
      axioms: ["count > 10"],
    });

    const result = checkAxiomSoundness(node, {}, { count: 3 });
    expect(result.allSound).toBe(false);
    expect(result.axioms[0].holdsAtRuntime).toBe(false);
  });

  it("multiple axioms — some sound, some not", () => {
    const node = makeNode({
      id: "process",
      out: { x: { type: "Int" }, y: { type: "Int" } },
      axioms: ["x > 0", "y > 100"],
    });

    const result = checkAxiomSoundness(node, {}, { x: 5, y: 10 });
    expect(result.allSound).toBe(false);
    expect(result.axioms[0].holdsAtRuntime).toBe(true);
    expect(result.axioms[1].holdsAtRuntime).toBe(false);
  });

  it("axiom with equality → sound when matching", () => {
    const node = makeNode({
      id: "create",
      out: { count: { type: "Int" } },
      axioms: ["count == 42"],
    });

    const result = checkAxiomSoundness(node, {}, { count: 42 });
    expect(result.allSound).toBe(true);
  });

  it("axiom referencing both inputs and outputs", () => {
    const node = makeNode({
      id: "transform",
      in: { amount: { type: "Float64" } },
      out: { validated_amount: { type: "Float64" } },
      axioms: ["validated_amount = amount"],
    });

    const result = checkAxiomSoundness(
      node,
      { amount: 99.99 },
      { validated_amount: 99.99 }
    );
    // axiom uses = (Z3 syntax), runtime checker may treat as unsupported
    // At minimum, it should not error out
    expect(result.axioms).toHaveLength(1);
  });

  it("node with no axioms → trivially sound", () => {
    const node = makeNode({
      id: "simple",
      out: { x: { type: "Int" } },
    });

    const result = checkAxiomSoundness(node, {}, { x: 5 });
    expect(result.allSound).toBe(true);
    expect(result.axioms).toHaveLength(0);
  });

  it("boolean axiom checked at runtime", () => {
    const node = makeNode({
      id: "check",
      out: { success: { type: "Bool" } },
      axioms: ["success == true"],
    });

    const soundResult = checkAxiomSoundness(node, {}, { success: true });
    expect(soundResult.allSound).toBe(true);

    const unsoundResult = checkAxiomSoundness(node, {}, { success: false });
    expect(unsoundResult.allSound).toBe(false);
  });
});
