/**
 * Scenario Validation Tests — validates the scenarios themselves
 */

import { describe, it, expect } from "vitest";
import { scenarios, getScenario, getAllScenarioIds } from "../../src/ai/scenarios.js";
import type { BugType } from "../../src/ai/generate.js";

const VALID_BUG_TYPES: BugType[] = [
  "missing_recovery",
  "missing_adversarial",
  "type_mismatch",
  "domain_mismatch",
  "sensitivity_violation",
  "contract_violation",
  "cycle_detected",
  "confidence_gap",
  "effect_undeclared",
  "port_mismatch",
  "state_violation",
];

describe("bug detection scenarios", () => {
  it("has exactly 8 scenarios", () => {
    expect(scenarios.length).toBe(8);
  });

  it("all scenarios have non-empty description", () => {
    for (const s of scenarios) {
      expect(s.description).toBeTruthy();
      expect(s.description.length).toBeGreaterThan(20);
    }
  });

  it("all scenarios have at least one expectedBugType", () => {
    for (const s of scenarios) {
      expect(s.expectedBugTypes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("all expectedBugTypes are valid BugReport types", () => {
    for (const s of scenarios) {
      for (const bugType of s.expectedBugTypes) {
        expect(VALID_BUG_TYPES).toContain(bugType);
      }
    }
  });

  it("no duplicate scenario IDs", () => {
    const ids = scenarios.map(s => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("all scenarios have non-empty explanation", () => {
    for (const s of scenarios) {
      expect(s.explanation).toBeTruthy();
      expect(s.explanation.length).toBeGreaterThan(20);
    }
  });

  it("all scenarios have non-empty id", () => {
    for (const s of scenarios) {
      expect(s.id).toBeTruthy();
      expect(s.id.length).toBeGreaterThan(3);
    }
  });

  it("getScenario returns correct scenario", () => {
    const s = getScenario("payment-no-recovery");
    expect(s).toBeDefined();
    expect(s!.id).toBe("payment-no-recovery");
    expect(s!.expectedBugTypes).toContain("missing_recovery");
  });

  it("getScenario returns undefined for unknown ID", () => {
    expect(getScenario("nonexistent")).toBeUndefined();
  });

  it("getAllScenarioIds returns all IDs", () => {
    const ids = getAllScenarioIds();
    expect(ids.length).toBe(8);
    expect(ids).toContain("recommender-overlap");
    expect(ids).toContain("payment-no-recovery");
    expect(ids).toContain("pii-leak");
    expect(ids).toContain("cycle-dependency");
  });

  it("specific scenario: recommender-overlap expects missing_adversarial", () => {
    const s = getScenario("recommender-overlap");
    expect(s!.expectedBugTypes).toContain("missing_adversarial");
  });

  it("specific scenario: pii-leak expects sensitivity_violation", () => {
    const s = getScenario("pii-leak");
    expect(s!.expectedBugTypes).toContain("sensitivity_violation");
  });

  it("specific scenario: cycle-dependency expects cycle_detected", () => {
    const s = getScenario("cycle-dependency");
    expect(s!.expectedBugTypes).toContain("cycle_detected");
  });
});
