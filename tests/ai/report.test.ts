/**
 * Bug Detection Report Tests (no API needed)
 */

import { describe, it, expect } from "vitest";
import { generateBugReport, formatReport, type BugDetectionReport } from "../../src/ai/report.js";
import type { GenerationResult, BugReport } from "../../src/ai/generate.js";

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function mockResult(bugs: BugReport[]): GenerationResult {
  return {
    success: bugs.length === 0,
    graph: null,
    attempts: [{ attemptNumber: 1, raw_json: "{}", parseSuccess: true }],
    bugsFound: bugs,
    finalValidation: null,
    finalVerification: null,
  };
}

function mockBug(type: BugReport["type"], severity: BugReport["severity"] = "high"): BugReport {
  return {
    type,
    severity,
    description: `Mock ${type} bug`,
    wouldCauseInProduction: `Would cause ${type} issues in production`,
    caughtBy: "validator",
  };
}

// ─── Report Generation Tests ─────────────────────────────────────────────────

describe("generateBugReport", () => {
  it("report from 3 mock results → correct totals", () => {
    const results = new Map<string, GenerationResult>();
    results.set("scenario-a", mockResult([mockBug("missing_recovery", "critical"), mockBug("missing_adversarial")]));
    results.set("scenario-b", mockResult([mockBug("sensitivity_violation", "critical")]));
    results.set("scenario-c", mockResult([]));

    const meta = new Map<string, { description: string; expectedBugs: string[]; explanation: string }>();
    meta.set("scenario-a", { description: "Test A", expectedBugs: ["missing_recovery"], explanation: "..." });
    meta.set("scenario-b", { description: "Test B", expectedBugs: ["sensitivity_violation"], explanation: "..." });
    meta.set("scenario-c", { description: "Test C", expectedBugs: ["cycle_detected"], explanation: "..." });

    const report = generateBugReport(results, meta);

    expect(report.totalScenarios).toBe(3);
    expect(report.scenariosRun).toBe(3);
    expect(report.bugsDetected).toBe(3);
  });

  it("detection rate calculated correctly", () => {
    const results = new Map<string, GenerationResult>();
    results.set("s1", mockResult([mockBug("missing_recovery")]));
    results.set("s2", mockResult([mockBug("missing_adversarial")]));
    results.set("s3", mockResult([])); // no bugs caught
    results.set("s4", mockResult([mockBug("cycle_detected")]));

    const meta = new Map<string, { description: string; expectedBugs: string[]; explanation: string }>();
    meta.set("s1", { description: "", expectedBugs: ["missing_recovery"], explanation: "" });
    meta.set("s2", { description: "", expectedBugs: ["missing_adversarial"], explanation: "" });
    meta.set("s3", { description: "", expectedBugs: ["type_mismatch"], explanation: "" });
    meta.set("s4", { description: "", expectedBugs: ["cycle_detected"], explanation: "" });

    const report = generateBugReport(results, meta);

    // s1, s2, s4 caught expected bugs. s3 caught nothing.
    expect(report.detectionRate).toBe(0.75);
    expect(report.details.filter(d => d.caught).length).toBe(3);
    expect(report.details.filter(d => !d.caught).length).toBe(1);
  });

  it("bugs grouped by type and severity", () => {
    const results = new Map<string, GenerationResult>();
    results.set("s1", mockResult([
      mockBug("missing_recovery", "critical"),
      mockBug("missing_recovery", "critical"),
      mockBug("missing_adversarial", "high"),
    ]));

    const report = generateBugReport(results);

    expect(report.bugsByType["missing_recovery"]).toBe(2);
    expect(report.bugsByType["missing_adversarial"]).toBe(1);
    expect(report.bugsBySeverity["critical"]).toBe(2);
    expect(report.bugsBySeverity["high"]).toBe(1);
  });

  it("summary string is non-empty", () => {
    const results = new Map<string, GenerationResult>();
    results.set("s1", mockResult([mockBug("cycle_detected")]));

    const report = generateBugReport(results);
    expect(report.summary).toBeTruthy();
    expect(report.summary.length).toBeGreaterThan(20);
  });

  it("empty results produce valid report", () => {
    const results = new Map<string, GenerationResult>();
    const report = generateBugReport(results);

    expect(report.totalScenarios).toBe(0);
    expect(report.bugsDetected).toBe(0);
    expect(report.detectionRate).toBe(0);
    expect(report.summary).toContain("No scenarios");
  });
});

// ─── Report Formatting Tests ─────────────────────────────────────────────────

describe("formatReport", () => {
  it("formatted report includes key sections", () => {
    const results = new Map<string, GenerationResult>();
    results.set("test-scenario", mockResult([
      mockBug("missing_recovery", "critical"),
      mockBug("sensitivity_violation", "critical"),
    ]));

    const meta = new Map<string, { description: string; expectedBugs: string[]; explanation: string }>();
    meta.set("test-scenario", { description: "Test", expectedBugs: ["missing_recovery"], explanation: "..." });

    const report = generateBugReport(results, meta);
    const formatted = formatReport(report);

    expect(formatted).toContain("AETHER Bug Detection Report");
    expect(formatted).toContain("Scenarios run:");
    expect(formatted).toContain("Bugs detected:");
    expect(formatted).toContain("Detection rate:");
    expect(formatted).toContain("By type:");
    expect(formatted).toContain("Scenario details:");
    expect(formatted).toContain("test-scenario");
  });

  it("shows check mark for caught scenarios", () => {
    const results = new Map<string, GenerationResult>();
    results.set("caught", mockResult([mockBug("missing_recovery")]));
    results.set("missed", mockResult([]));

    const meta = new Map<string, { description: string; expectedBugs: string[]; explanation: string }>();
    meta.set("caught", { description: "", expectedBugs: ["missing_recovery"], explanation: "" });
    meta.set("missed", { description: "", expectedBugs: ["cycle_detected"], explanation: "" });

    const report = generateBugReport(results, meta);
    const formatted = formatReport(report);

    expect(formatted).toContain("✓ caught");
    expect(formatted).toContain("✗ missed");
  });
});
