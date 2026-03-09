/**
 * Scope Boundary Compatibility Tests
 */

import { describe, it, expect } from "vitest";
import { checkBoundaryCompatibility } from "../../src/compiler/scopes.js";
import type { Scope } from "../../src/ir/validator.js";

function makeProvider(overrides?: Partial<Scope>): Scope {
  return {
    id: "provider",
    nodes: ["p1"],
    boundary_contracts: {
      provides: [
        {
          name: "data_feed",
          in: {},
          out: {
            value: { type: "Float64", dimension: "currency", unit: "USD", domain: "payment" },
          },
          effects: ["database.read"],
          confidence: 0.95,
        },
      ],
    },
    ...overrides,
  };
}

function makeRequirer(overrides?: Partial<Scope>): Scope {
  return {
    id: "requirer",
    nodes: ["r1"],
    boundary_contracts: {
      requires: [
        {
          name: "data_feed",
          in: {
            value: { type: "Float64", dimension: "currency", unit: "USD", domain: "payment" },
          },
          out: {},
          effects: ["database.read"],
          confidence: 0.9,
        },
      ],
    },
    ...overrides,
  };
}

describe("Boundary Compatibility", () => {
  it("compatible boundary contracts → pass", () => {
    const result = checkBoundaryCompatibility(makeProvider(), makeRequirer());
    expect(result.compatible).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("type mismatch at boundary → error", () => {
    const provider = makeProvider();
    provider.boundary_contracts!.provides![0].out.value.type = "String";
    const result = checkBoundaryCompatibility(provider, makeRequirer());
    expect(result.compatible).toBe(false);
    expect(result.errors.some(e => e.includes("type mismatch"))).toBe(true);
  });

  it("domain mismatch at boundary → error", () => {
    const provider = makeProvider();
    provider.boundary_contracts!.provides![0].out.value.domain = "inventory";
    const result = checkBoundaryCompatibility(provider, makeRequirer());
    expect(result.compatible).toBe(false);
    expect(result.errors.some(e => e.includes("type mismatch") || e.includes("domain"))).toBe(true);
  });

  it("confidence too low for boundary requirement → warning", () => {
    const provider = makeProvider();
    provider.boundary_contracts!.provides![0].confidence = 0.5;
    const requirer = makeRequirer();
    requirer.boundary_contracts!.requires![0].confidence = 0.9;
    const result = checkBoundaryCompatibility(provider, requirer);
    expect(result.compatible).toBe(true); // confidence is a warning, not an error
    expect(result.warnings.some(w => w.includes("confidence"))).toBe(true);
  });

  it("missing contract name match → compatible (contract is for different provider)", () => {
    const provider = makeProvider();
    provider.boundary_contracts!.provides![0].name = "wrong_name";
    const result = checkBoundaryCompatibility(provider, makeRequirer());
    // No error because the requirer's contract may be satisfied by a different provider
    expect(result.compatible).toBe(true);
  });

  it("provider missing a required output key → error", () => {
    const provider = makeProvider();
    delete provider.boundary_contracts!.provides![0].out.value;
    const result = checkBoundaryCompatibility(provider, makeRequirer());
    expect(result.compatible).toBe(false);
    expect(result.errors.some(e => e.includes("does not output"))).toBe(true);
  });

  it("unexpected provider effect → warning", () => {
    const provider = makeProvider();
    provider.boundary_contracts!.provides![0].effects = ["database.read", "network.write"];
    const result = checkBoundaryCompatibility(provider, makeRequirer());
    expect(result.compatible).toBe(true);
    expect(result.warnings.some(w => w.includes("network.write"))).toBe(true);
  });
});
