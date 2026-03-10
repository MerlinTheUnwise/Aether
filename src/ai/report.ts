/**
 * AETHER Bug Detection Report Generator
 * Generates human-readable reports of what AETHER's verification pipeline caught.
 */

import type { BugReport, BugType, GenerationResult } from "./generate.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScenarioDetail {
  scenario: string;
  description: string;
  expectedBugs: string[];
  actualBugs: BugReport[];
  caught: boolean;
  explanation: string;
}

export interface BugDetectionReport {
  totalScenarios: number;
  scenariosRun: number;
  bugsDetected: number;
  bugsByType: Record<string, number>;
  bugsBySeverity: Record<string, number>;
  detectionRate: number;
  details: ScenarioDetail[];
  summary: string;
}

// ─── Report Generation ───────────────────────────────────────────────────────

export function generateBugReport(
  results: Map<string, GenerationResult>,
  scenarioMeta?: Map<string, { description: string; expectedBugs: string[]; explanation: string }>
): BugDetectionReport {
  const bugsByType: Record<string, number> = {};
  const bugsBySeverity: Record<string, number> = {};
  const details: ScenarioDetail[] = [];
  let totalBugs = 0;
  let caughtCount = 0;

  for (const [scenarioId, result] of results) {
    const meta = scenarioMeta?.get(scenarioId);
    const expectedBugs = meta?.expectedBugs ?? [];
    const actualBugs = result.bugsFound;

    // Count bugs by type and severity
    for (const bug of actualBugs) {
      bugsByType[bug.type] = (bugsByType[bug.type] || 0) + 1;
      bugsBySeverity[bug.severity] = (bugsBySeverity[bug.severity] || 0) + 1;
      totalBugs++;
    }

    // Check if at least one expected bug was caught
    const actualTypes = new Set(actualBugs.map(b => b.type));
    const caught = expectedBugs.length === 0
      ? actualBugs.length > 0
      : expectedBugs.some(expected => actualTypes.has(expected as BugType));

    if (caught) caughtCount++;

    details.push({
      scenario: scenarioId,
      description: meta?.description ?? "",
      expectedBugs,
      actualBugs,
      caught,
      explanation: meta?.explanation ?? "",
    });
  }

  const totalScenarios = results.size;
  const detectionRate = totalScenarios > 0 ? caughtCount / totalScenarios : 0;

  const summary = totalScenarios > 0
    ? `AETHER caught ${totalBugs} bug${totalBugs !== 1 ? "s" : ""} across ${caughtCount} scenario${caughtCount !== 1 ? "s" : ""} before any code executed. ` +
      `Detection rate: ${(detectionRate * 100).toFixed(1)}% (${caughtCount}/${totalScenarios} scenarios caught ≥1 expected bug).`
    : "No scenarios were run.";

  return {
    totalScenarios,
    scenariosRun: totalScenarios,
    bugsDetected: totalBugs,
    bugsByType,
    bugsBySeverity,
    detectionRate,
    details,
    summary,
  };
}

// ─── Pretty Print ────────────────────────────────────────────────────────────

const IMPACT_LABELS: Record<string, string> = {
  missing_recovery: "unhandled production errors",
  sensitivity_violation: "PII data leak",
  missing_adversarial: "silent incorrect results",
  domain_mismatch: "wrong data type used",
  type_mismatch: "runtime type errors",
  confidence_gap: "overconfident AI decisions",
  cycle_detected: "infinite loop",
  effect_undeclared: "untracked side effects",
  contract_violation: "invalid output silently",
  port_mismatch: "data flow failure",
  state_violation: "corrupted application state",
};

export function formatReport(report: BugDetectionReport): string {
  const sep = "═══════════════════════════════════════════════════════════════════";
  const lines: string[] = [];

  lines.push(sep);
  lines.push("AETHER Bug Detection Report");
  lines.push(sep);
  lines.push(`Scenarios run: ${report.scenariosRun}`);
  lines.push(`Bugs detected: ${report.bugsDetected}`);
  lines.push(`Detection rate: ${(report.detectionRate * 100).toFixed(1)}% (${report.details.filter(d => d.caught).length}/${report.totalScenarios} scenarios caught ≥1 expected bug)`);
  lines.push("");

  // By type
  if (Object.keys(report.bugsByType).length > 0) {
    lines.push("By type:");
    const sorted = Object.entries(report.bugsByType).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted) {
      const impact = IMPACT_LABELS[type] || "unknown impact";
      lines.push(`  ${type.padEnd(25)}${String(count).padStart(2)}  (would cause: ${impact})`);
    }
    lines.push("");
  }

  // Scenario details
  lines.push("Scenario details:");
  for (const detail of report.details) {
    const mark = detail.caught ? "✓" : "✗";
    const bugCount = detail.actualBugs.length;
    const bugSummary = bugCount === 0
      ? "0 bugs caught"
      : `${bugCount} bug${bugCount !== 1 ? "s" : ""} caught (${summarizeBugTypes(detail.actualBugs)})`;
    lines.push(`  ${mark} ${detail.scenario.padEnd(25)}${bugSummary}`);
  }
  lines.push("");
  lines.push(report.summary);
  lines.push(sep);

  return lines.join("\n");
}

function summarizeBugTypes(bugs: BugReport[]): string {
  const counts: Record<string, number> = {};
  for (const bug of bugs) {
    counts[bug.type] = (counts[bug.type] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([type, count]) => count > 1 ? `${type} × ${count}` : type)
    .join(", ");
}
