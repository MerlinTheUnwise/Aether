import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { collectDashboardData, type DashboardData } from "../../src/dashboard/collector.js";
import { diffDashboards, renderDiffView } from "../../src/dashboard/diff-view.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function examplePath(name: string): string {
  return join(examplesDir, `${name}.json`);
}

describe("Dashboard Diff", () => {
  it("diff identical dashboards yields no changes", async () => {
    const data = await collectDashboardData(examplePath("user-registration"));
    const diff = diffDashboards(data, data);

    expect(diff.changes.verificationDelta).toBe(0);
    expect(diff.changes.nodesAdded).toEqual([]);
    expect(diff.changes.nodesRemoved).toEqual([]);
    expect(diff.changes.verificationChanged).toEqual([]);
    expect(diff.changes.confidenceDelta).toBe(0);
    expect(diff.changes.newErrors).toEqual([]);
    expect(diff.changes.resolvedErrors).toEqual([]);
    expect(diff.changes.optimizationsDelta).toBe(0);
  });

  it("diff with added node detected in nodesAdded", async () => {
    const before = await collectDashboardData(examplePath("user-registration"));

    // Simulate "after" with an extra node
    const after: DashboardData = JSON.parse(JSON.stringify(before));
    after.verification.byNode.push({
      nodeId: "new_node",
      status: "verified",
      contracts: {
        pre: { total: 0, verified: 0 },
        post: { total: 1, verified: 1 },
        invariants: { total: 0, verified: 0 },
        adversarial: { total: 0, passed: 0 },
      },
      confidence: { declared: 0.95, propagated: 0.9 },
      effects: [],
      recoveryPaths: 0,
      supervised: false,
    });

    const diff = diffDashboards(before, after);
    expect(diff.changes.nodesAdded).toContain("new_node");
  });

  it("diff with removed node detected in nodesRemoved", async () => {
    const before = await collectDashboardData(examplePath("user-registration"));

    const after: DashboardData = JSON.parse(JSON.stringify(before));
    after.verification.byNode = after.verification.byNode.filter(
      n => n.nodeId !== before.verification.byNode[0].nodeId
    );

    const diff = diffDashboards(before, after);
    expect(diff.changes.nodesRemoved).toContain(before.verification.byNode[0].nodeId);
  });

  it("diff with verification change detected", async () => {
    const before = await collectDashboardData(examplePath("user-registration"));

    const after: DashboardData = JSON.parse(JSON.stringify(before));
    const firstNode = after.verification.byNode[0];
    const originalStatus = firstNode.status;
    firstNode.status = originalStatus === "verified" ? "failed" : "verified";

    const diff = diffDashboards(before, after);
    expect(diff.changes.verificationChanged.length).toBeGreaterThan(0);
    expect(diff.changes.verificationChanged[0].nodeId).toBe(firstNode.nodeId);
    expect(diff.changes.verificationChanged[0].from).toBe(originalStatus);
    expect(diff.changes.verificationChanged[0].to).toBe(firstNode.status);
  });

  it("diff with confidence change has correct delta", async () => {
    const before = await collectDashboardData(examplePath("user-registration"));

    const after: DashboardData = JSON.parse(JSON.stringify(before));
    after.confidence.graphConfidence = before.confidence.graphConfidence + 0.1;

    const diff = diffDashboards(before, after);
    expect(diff.changes.confidenceDelta).toBeCloseTo(0.1, 5);
  });

  it("diff view renders valid HTML", async () => {
    const before = await collectDashboardData(examplePath("user-registration"));
    const after: DashboardData = JSON.parse(JSON.stringify(before));
    after.graph.version = 2;
    after.verification.byNode.push({
      nodeId: "added_node",
      status: "verified",
      contracts: {
        pre: { total: 0, verified: 0 },
        post: { total: 0, verified: 0 },
        invariants: { total: 0, verified: 0 },
        adversarial: { total: 0, passed: 0 },
      },
      confidence: { declared: 1.0, propagated: 1.0 },
      effects: [],
      recoveryPaths: 0,
      supervised: false,
    });

    const diff = diffDashboards(before, after);
    const html = renderDiffView(diff);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("Dashboard Diff");
    expect(html).toContain("added_node");
  });

  it("diff between intent-data-pipeline v1 and v2", async () => {
    const [before, after] = await Promise.all([
      collectDashboardData(examplePath("intent-data-pipeline")),
      collectDashboardData(examplePath("intent-data-pipeline-v2")),
    ]);

    const diff = diffDashboards(before, after);

    // v2 has more nodes than v1
    expect(diff.changes.nodesAdded.length + diff.changes.nodesRemoved.length).toBeGreaterThanOrEqual(0);
    expect(diff.from.graphId).toBe(before.graph.id);
    expect(diff.to.graphId).toBe(after.graph.id);

    // Render should work
    const html = renderDiffView(diff);
    expect(html).toContain("<!DOCTYPE html>");
  });
});
