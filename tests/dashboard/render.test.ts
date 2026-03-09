import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { collectDashboardData, type DashboardData } from "../../src/dashboard/collector.js";
import { renderDashboard } from "../../src/dashboard/render.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function examplePath(name: string): string {
  return join(examplesDir, `${name}.json`);
}

describe("Dashboard Renderer", () => {
  let userRegData: DashboardData;

  it("renders dashboard for user-registration as valid HTML", async () => {
    userRegData = await collectDashboardData(examplePath("user-registration"));
    const html = renderDashboard(userRegData);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });

  it("HTML contains verification percentage", async () => {
    if (!userRegData) {
      userRegData = await collectDashboardData(examplePath("user-registration"));
    }
    const html = renderDashboard(userRegData);

    expect(html).toContain(`${userRegData.verification.percentage.toFixed(1)}%`);
  });

  it("HTML contains node table with all node IDs", async () => {
    if (!userRegData) {
      userRegData = await collectDashboardData(examplePath("user-registration"));
    }
    const html = renderDashboard(userRegData);

    for (const node of userRegData.verification.byNode) {
      expect(html).toContain(node.nodeId);
    }
  });

  it("HTML contains confidence section", async () => {
    if (!userRegData) {
      userRegData = await collectDashboardData(examplePath("user-registration"));
    }
    const html = renderDashboard(userRegData);

    expect(html).toContain("Confidence Flow");
    expect(html).toContain("Critical Path");
  });

  it("HTML contains effect audit", async () => {
    if (!userRegData) {
      userRegData = await collectDashboardData(examplePath("user-registration"));
    }
    const html = renderDashboard(userRegData);

    expect(html).toContain("Effect Audit");
  });

  it("renders with execution data showing execution section", async () => {
    const data = await collectDashboardData(examplePath("user-registration"), {
      includeExecution: true,
      executionRuns: 2,
    });
    const html = renderDashboard(data);

    expect(html).toContain("Execution Profile");
    expect(html).toContain("Avg time");
  });

  it("renders with optimization data showing suggestions section", async () => {
    const data = await collectDashboardData(examplePath("payment-processing"), {
      includeOptimization: true,
    });
    const html = renderDashboard(data);

    // If suggestions exist, section should appear; if not, it's omitted
    if (data.optimizations.length > 0) {
      expect(html).toContain("Optimization Suggestions");
    }
  });

  it("renders with proof data showing proof readiness section", async () => {
    const data = await collectDashboardData(examplePath("user-registration"), {
      includeProofs: true,
    });
    const html = renderDashboard(data);

    if (data.proofExport.theoremsGenerable > 0) {
      expect(html).toContain("Proof Readiness");
    }
  });

  it("renders sortable table with JavaScript", async () => {
    if (!userRegData) {
      userRegData = await collectDashboardData(examplePath("user-registration"));
    }
    const html = renderDashboard(userRegData);

    expect(html).toContain("data-col=");
    expect(html).toContain("addEventListener");
    expect(html).toContain("sorted-asc");
  });
});
