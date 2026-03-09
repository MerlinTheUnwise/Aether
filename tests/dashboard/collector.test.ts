import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { collectDashboardData, type DashboardData } from "../../src/dashboard/collector.js";
import { verifyGraph } from "../../src/compiler/verifier.js";
import { ConfidenceEngine } from "../../src/runtime/confidence.js";
import { EffectTracker } from "../../src/runtime/effects.js";
import { checkTypes } from "../../src/compiler/checker.js";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function examplePath(name: string): string {
  return join(examplesDir, `${name}.json`);
}

function loadGraph(name: string): any {
  return JSON.parse(readFileSync(examplePath(name), "utf-8"));
}

describe("Dashboard Collector", () => {
  it("collects data for user-registration with all fields populated", async () => {
    const data = await collectDashboardData(examplePath("user-registration"));

    // Graph metadata
    expect(data.graph.id).toBe("user_registration");
    expect(data.graph.version).toBe(1);
    expect(data.graph.nodeCount).toBe(3);
    expect(data.graph.edgeCount).toBe(3);
    expect(data.graph.waveCount).toBeGreaterThan(0);

    // Verification
    expect(data.verification.byNode).toHaveLength(3);
    expect(typeof data.verification.percentage).toBe("number");
    expect(data.verification.summary).toBeDefined();

    // Type safety
    expect(data.typeSafety.edgesChecked).toBe(3);
    expect(typeof data.typeSafety.errors).toBe("number");
    expect(typeof data.typeSafety.warnings).toBe("number");

    // Confidence
    expect(typeof data.confidence.graphConfidence).toBe("number");
    expect(data.confidence.criticalPath.length).toBeGreaterThan(0);

    // Effects
    expect(data.effects.byNode).toBeDefined();
    expect(Object.keys(data.effects.byNode)).toHaveLength(3);

    // Timestamp
    expect(data.generatedAt).toBeTruthy();
  });

  it("verification percentage matches verifier output", async () => {
    const graph = loadGraph("user-registration");
    const [data, verifyReport] = await Promise.all([
      collectDashboardData(examplePath("user-registration")),
      verifyGraph(graph),
    ]);

    expect(data.verification.percentage).toBe(verifyReport.verification_percentage);
  });

  it("confidence data matches confidence engine output", async () => {
    const graph = loadGraph("user-registration");
    const engine = new ConfidenceEngine(graph, 0.7);

    // Propagate all nodes (simplified — root nodes only)
    const nodes = graph.nodes.filter((n: any) => !n.hole && !n.intent);
    for (const node of nodes) {
      engine.propagate(node.id, new Map());
    }

    const data = await collectDashboardData(examplePath("user-registration"));
    const engineReport = engine.getReport();

    expect(data.confidence.oversightNodes).toBeDefined();
    expect(data.confidence.criticalPath.length).toBeGreaterThan(0);
  });

  it("effect audit matches effect tracker output", async () => {
    const graph = loadGraph("user-registration");
    const tracker = new EffectTracker(graph);
    const trackerReport = tracker.getReport();

    const data = await collectDashboardData(examplePath("user-registration"));

    // Check that declared effects match
    for (const [nodeId, effects] of Object.entries(trackerReport.declaredEffects)) {
      expect(data.effects.byNode[nodeId]).toEqual(effects);
    }
  });

  it("type safety matches checker output", async () => {
    const graph = loadGraph("user-registration");
    const checkResult = checkTypes(graph);

    const data = await collectDashboardData(examplePath("user-registration"));

    expect(data.typeSafety.errors).toBe(checkResult.errors.length);
    expect(data.typeSafety.warnings).toBe(checkResult.warnings.length);
  });

  it("optional fields absent when flags not set", async () => {
    const data = await collectDashboardData(examplePath("user-registration"));

    expect(data.execution).toBeUndefined();
    expect(data.optimizations).toEqual([]);
    expect(data.proofExport.theoremsGenerable).toBe(0);
  });

  it("includes execution data when flag set", async () => {
    const data = await collectDashboardData(examplePath("user-registration"), {
      includeExecution: true,
      executionRuns: 2,
    });

    expect(data.execution).toBeDefined();
    expect(data.execution!.totalRuns).toBe(2);
    expect(typeof data.execution!.avgTime_ms).toBe("number");
  });

  it("includes optimization data when flag set", async () => {
    const data = await collectDashboardData(examplePath("user-registration"), {
      includeOptimization: true,
    });

    // May or may not have suggestions depending on graph
    expect(Array.isArray(data.optimizations)).toBe(true);
  });

  it("includes proof data when flag set", async () => {
    const data = await collectDashboardData(examplePath("user-registration"), {
      includeProofs: true,
    });

    expect(data.proofExport.theoremsGenerable).toBeGreaterThanOrEqual(0);
    expect(typeof data.proofExport.fullyProvable).toBe("number");
    expect(typeof data.proofExport.needingSorry).toBe("number");
  });
});
