/**
 * Tests: Transaction Analysis Pipeline — Full End-to-End
 *
 * Complete pipeline: generate data → run pipeline → check all output files → verify contracts.
 * Uses real filesystem (no mocks). Verifies files exist with fs.existsSync.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import { generateSampleData } from "../../scripts/generate-sample-data.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const E2E_DIR = resolve("test-output/txn-e2e");
const SAMPLE_DIR = join(E2E_DIR, "sample-data");
const OUTPUT_DIR = join(E2E_DIR, "output");

function loadGraph(): AetherGraph {
  return JSON.parse(readFileSync("src/ir/examples/real-world/transaction-analysis.json", "utf-8"));
}

describe("Transaction Analysis — End-to-End", () => {
  beforeAll(async () => {
    // Clean slate
    rmSync(E2E_DIR, { recursive: true, force: true });
    mkdirSync(E2E_DIR, { recursive: true });

    // Step 1: Generate sample data
    await generateSampleData(SAMPLE_DIR);
  });

  it("sample data files exist on disk", () => {
    expect(existsSync(join(SAMPLE_DIR, "transactions.csv"))).toBe(true);
    expect(existsSync(join(SAMPLE_DIR, "customers.json"))).toBe(true);
    expect(existsSync(join(SAMPLE_DIR, "categories.json"))).toBe(true);
  });

  it("full pipeline produces all output files with enforced contracts", async () => {
    const graph = loadGraph();
    const ctx = await createExecutionContext(
      graph,
      {
        read_transactions: { file_path: "sample-data/transactions.csv" },
        read_customers: { file_path: "sample-data/customers.json" },
        read_categories: { file_path: "sample-data/categories.json" },
        write_csv_output: { output_dir: "output" },
        write_report: { output_dir: "output" },
        write_summary: { output_dir: "output" },
      },
      {
        serviceConfig: {
          mode: "real" as const,
          real: { filesystem: { basePath: E2E_DIR } },
        },
        contractMode: "enforce",
      },
    );

    const result = await execute(ctx);

    // All 12 nodes executed
    expect(result.nodesExecuted).toBe(12);
    expect(result.nodesSkipped).toBe(0);

    // Contract report: 0 violated, 0 unevaluable
    if (result.contractReport) {
      expect(result.contractReport.violated).toBe(0);
      expect(result.contractReport.unevaluable).toBe(0);
      expect(result.contractReport.passed).toBeGreaterThan(0);
    }

    // Output files exist on disk (real files, not in-memory)
    expect(existsSync(join(OUTPUT_DIR, "cleaned_transactions.csv"))).toBe(true);
    expect(existsSync(join(OUTPUT_DIR, "report.html"))).toBe(true);
    expect(existsSync(join(OUTPUT_DIR, "summary.json"))).toBe(true);

    // Cleaned CSV is valid
    const csvContent = readFileSync(join(OUTPUT_DIR, "cleaned_transactions.csv"), "utf-8");
    const csvLines = csvContent.trim().split("\n");
    expect(csvLines.length).toBeGreaterThan(1); // at least header + 1 row
    const headerFields = csvLines[0].split(",");
    expect(headerFields).toContain("transaction_id");
    expect(headerFields).toContain("amount");

    // HTML report contains all sections
    const html = readFileSync(join(OUTPUT_DIR, "report.html"), "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Data Quality");
    expect(html).toContain("Revenue by Region");
    expect(html).toContain("Top 10 Merchants");
    expect(html).toContain("Category Breakdown");
    expect(html).toContain("Anomalies Detected");
    expect(html).toContain("Contract Verification");
    expect(html).toContain("Pipeline Metadata");

    // JSON summary is parseable and contains analytics
    const summary = JSON.parse(readFileSync(join(OUTPUT_DIR, "summary.json"), "utf-8"));
    expect(summary.data_quality).toBeDefined();
    expect(summary.data_quality.records_read).toBeGreaterThan(0);
    expect(summary.analytics).toBeDefined();
    expect(summary.analytics.total_revenue).toBeGreaterThan(0);
    expect(summary.analytics.revenue_by_region.length).toBeGreaterThan(0);
    expect(summary.analytics.top_merchants.length).toBeGreaterThan(0);

    // Effects tracked
    expect(result.effectsPerformed).toContain("filesystem.read");
    expect(result.effectsPerformed).toContain("filesystem.write");
    expect(result.effectsPerformed).toContain("ml_model.infer");

    // Final confidence reflects anomaly detection uncertainty (0.82 propagated through chain)
    expect(result.confidence).toBeLessThan(1.0);
    expect(result.confidence).toBeGreaterThan(0.3);
  });
});
