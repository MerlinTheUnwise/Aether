/**
 * Tests: Sales Analytics Pipeline — Real-World End-to-End
 *
 * Runs the full 10-node pipeline against 500-row CSV with real computation:
 * validation, deduplication, anomaly detection, parallel analytics, report, archive, email.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function loadGraph(): AetherGraph {
  return JSON.parse(readFileSync("src/ir/examples/real-world/sales-analytics.json", "utf-8"));
}

const csvContent = readFileSync("test-data/sales-analytics/sales.csv", "utf-8");

async function runPipeline(contractMode: "enforce" | "warn" = "warn") {
  const graph = loadGraph();
  const ctx = await createExecutionContext(graph, { file_path: "sales.csv" }, {
    serviceConfig: {
      filesystem: { files: { "sales.csv": csvContent } },
    },
    contractMode,
  });
  return execute(ctx);
}

describe("Sales Analytics Pipeline — Real Execution", () => {
  it("executes all 10 nodes without errors", async () => {
    const result = await runPipeline();
    expect(result.nodesExecuted).toBe(10);
    expect(result.waves).toBeGreaterThanOrEqual(4); // sequential chain + parallel analytics wave
  });

  it("fetch_csv_data returns all 500 rows", async () => {
    const result = await runPipeline();
    const out = result.outputs["fetch_csv_data"];
    expect(out.raw_data.length).toBe(500);
  });

  it("validate_records splits into valid (475) and invalid (25)", async () => {
    const result = await runPipeline();
    const out = result.outputs["validate_records"];
    expect(out.valid.length).toBe(475);
    expect(out.invalid.length).toBe(25);
    expect(out.valid.length + out.invalid.length).toBe(500);
  });

  it("clean_and_normalize deduplicates to ~455 records with no null amounts", async () => {
    const result = await runPipeline();
    const out = result.outputs["clean_and_normalize"];
    expect(out.cleaned.length).toBe(455);

    // Verify distinct by transaction_id
    const ids = new Set(out.cleaned.map((r: any) => r.transaction_id));
    expect(ids.size).toBe(out.cleaned.length);

    // No null amounts
    for (const record of out.cleaned) {
      expect(record.amount).not.toBeNull();
      expect(record.amount).not.toBeNaN();
      expect(record.amount).toBeGreaterThanOrEqual(0);
    }
  });

  it("detect_anomalies flags future-dated rows (confidence 0.82)", async () => {
    const result = await runPipeline();
    const out = result.outputs["detect_anomalies"];

    // Future-dated rows should be anomalies
    expect(out.anomalies.length).toBeGreaterThanOrEqual(3);
    expect(out.data.length + out.anomalies.length).toBe(455);

    // Check anomaly reasons
    const futureAnomalies = out.anomalies.filter((a: any) => a.anomaly_reason === "future_date");
    expect(futureAnomalies.length).toBe(3);
  });

  it("revenue_by_region sums match total of all transaction amounts", async () => {
    const result = await runPipeline();
    const regionOut = result.outputs["calculate_revenue_by_region"];
    const dataOut = result.outputs["detect_anomalies"];

    const regionalTotal = regionOut.revenue_by_region.reduce(
      (s: number, r: any) => s + r.total_revenue, 0
    );
    const dataTotal = dataOut.data.reduce(
      (s: number, r: any) => s + Number(r.amount), 0
    );

    // Must match to the penny
    expect(Math.round(regionalTotal * 100)).toBe(Math.round(dataTotal * 100));

    // All 5 regions present
    expect(regionOut.revenue_by_region.length).toBe(5);
  });

  it("top_products sorted descending, length <= 10", async () => {
    const result = await runPipeline();
    const out = result.outputs["calculate_top_products"];

    expect(out.top_products.length).toBeLessThanOrEqual(10);
    expect(out.top_products.length).toBeGreaterThan(0);

    // Verify sorted descending by revenue
    for (let i = 1; i < out.top_products.length; i++) {
      expect(out.top_products[i - 1].revenue).toBeGreaterThanOrEqual(out.top_products[i].revenue);
    }
  });

  it("growth_trends sorted by date ascending", async () => {
    const result = await runPipeline();
    const out = result.outputs["calculate_growth_trends"];

    expect(out.trends.length).toBeGreaterThan(0);

    // Verify sorted ascending by month
    for (let i = 1; i < out.trends.length; i++) {
      expect(out.trends[i].month.localeCompare(out.trends[i - 1].month)).toBeGreaterThanOrEqual(0);
    }
  });

  it("report contains all 4 sections", async () => {
    const result = await runPipeline();
    const out = result.outputs["generate_report"];

    expect(out.report.sections_count).toBe(4);
    expect(out.report.revenue_by_region).toBeDefined();
    expect(out.report.top_products).toBeDefined();
    expect(out.report.growth_trends).toBeDefined();
    expect(out.report.anomalies).toBeDefined();

    // Summary has correct totals
    expect(out.report.summary.total_transactions).toBeGreaterThan(0);
    expect(out.report.summary.total_revenue).toBeGreaterThan(0);
  });

  it("archive writes to filesystem", async () => {
    const result = await runPipeline();
    const out = result.outputs["archive_report"];

    expect(out.archived).toBe(true);
    expect(out.path).toContain("/reports/");
  });

  it("email captured (not actually sent)", async () => {
    const result = await runPipeline();
    const out = result.outputs["email_report"];

    expect(out.sent).toBe(true);
  });

  it("all contracts pass with zero violations", async () => {
    const result = await runPipeline("warn");

    expect(result.contractReport).toBeDefined();
    expect(result.contractReport!.violated).toBe(0);
  });

  it("effects properly tracked across the full flow", async () => {
    const result = await runPipeline();

    expect(result.effectsPerformed).toContain("filesystem.read");
    expect(result.effectsPerformed).toContain("filesystem.write");
    expect(result.effectsPerformed).toContain("ml_model.infer");
    expect(result.effectsPerformed).toContain("email");
  });

  it("confidence propagates through the pipeline", async () => {
    const result = await runPipeline();

    // detect_anomalies has confidence 0.82, so downstream nodes should reflect that
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);

    // Anomaly detection node should have lower confidence
    const anomalyEntry = result.executionLog.find(e => e.nodeId === "detect_anomalies");
    expect(anomalyEntry).toBeDefined();
    expect(anomalyEntry!.confidence).toBeLessThanOrEqual(0.82);
  });
});
