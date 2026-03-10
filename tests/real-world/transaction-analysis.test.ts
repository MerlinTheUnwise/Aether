/**
 * Tests: Transaction Analysis Pipeline — Real-World
 *
 * Runs the full 12-node pipeline with real filesystem I/O:
 * read CSV/JSON, validate, clean, dedupe, detect anomalies, compute analytics,
 * generate report, write output files.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import { generateSampleData } from "../../scripts/generate-sample-data.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const TEST_DATA_DIR = resolve("test-output/txn-analysis-data");
const TEST_OUTPUT_DIR = resolve("test-output/txn-analysis-output");

function loadGraph(): AetherGraph {
  return JSON.parse(readFileSync("src/ir/examples/real-world/transaction-analysis.json", "utf-8"));
}

async function runPipeline(contractMode: "enforce" | "warn" | "skip" = "warn") {
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
        real: {
          filesystem: { basePath: TEST_DATA_DIR },
        },
      },
      contractMode,
    },
  );
  return execute(ctx);
}

describe("Transaction Analysis Pipeline — Real Execution", () => {
  beforeAll(async () => {
    // Generate sample data into test directory
    const sampleDir = join(TEST_DATA_DIR, "sample-data");
    if (!existsSync(sampleDir)) {
      await generateSampleData(sampleDir);
    }
    // Ensure output directory exists
    mkdirSync(join(TEST_DATA_DIR, "output"), { recursive: true });
  });

  it("generates sample data with correct counts", async () => {
    const txnCsv = readFileSync(join(TEST_DATA_DIR, "sample-data/transactions.csv"), "utf-8");
    const lines = txnCsv.trim().split("\n");
    expect(lines.length).toBe(1001); // header + 1000 rows

    const customers = JSON.parse(readFileSync(join(TEST_DATA_DIR, "sample-data/customers.json"), "utf-8"));
    expect(customers.length).toBe(50);

    const categories = JSON.parse(readFileSync(join(TEST_DATA_DIR, "sample-data/categories.json"), "utf-8"));
    expect(categories.length).toBe(8);
  });

  it("executes all 12 nodes without errors", async () => {
    const result = await runPipeline();
    expect(result.nodesExecuted).toBe(12);
    expect(result.waves).toBeGreaterThanOrEqual(4);
  });

  it("read_transactions reads 1000 rows from real CSV", async () => {
    const result = await runPipeline();
    const out = result.outputs["read_transactions"];
    expect(out.data.length).toBe(1000);
  });

  it("read_customers reads 50 records from real JSON", async () => {
    const result = await runPipeline();
    const out = result.outputs["read_customers"];
    expect(out.customers.length).toBe(50);
  });

  it("read_categories reads 8 categories from real JSON", async () => {
    const result = await runPipeline();
    const out = result.outputs["read_categories"];
    expect(out.categories.length).toBe(8);
  });

  it("validate_txn_records splits into valid and invalid, totaling 1000", async () => {
    const result = await runPipeline();
    const out = result.outputs["validate_txn_records"];
    expect(out.valid.length + out.invalid.length).toBe(1000);
    expect(out.valid.length).toBeGreaterThan(900);
    expect(out.invalid.length).toBeGreaterThan(0);
  });

  it("valid records all have required fields", async () => {
    const result = await runPipeline();
    const valid = result.outputs["validate_txn_records"].valid;
    for (const r of valid) {
      expect(r.amount).not.toBeNull();
      expect(r.amount).not.toBe("");
      expect(r.transaction_id).not.toBeNull();
      expect(r.transaction_id).not.toBe("");
    }
  });

  it("clean_and_dedupe removes duplicates and converts refunds", async () => {
    const result = await runPipeline();
    const cleaned = result.outputs["clean_and_dedupe"].cleaned;
    const valid = result.outputs["validate_txn_records"].valid;

    // cleaned ≤ valid
    expect(cleaned.length).toBeLessThanOrEqual(valid.length);

    // No duplicate transaction_ids
    const ids = new Set(cleaned.map((r: any) => r.transaction_id));
    expect(ids.size).toBe(cleaned.length);

    // All amounts ≥ 0
    for (const r of cleaned) {
      expect(r.amount).toBeGreaterThanOrEqual(0);
    }
  });

  it("detect_txn_anomalies flags future dates, outliers, and currency mismatches", async () => {
    const result = await runPipeline();
    const out = result.outputs["detect_txn_anomalies"];

    // normal + anomalies = cleaned
    const cleaned = result.outputs["clean_and_dedupe"].cleaned;
    expect(out.normal.length + out.anomalies.length).toBe(cleaned.length);

    // Anomalies exist
    expect(out.anomalies.length).toBeGreaterThan(0);

    // Check anomaly reasons
    const reasons = out.anomalies.flatMap((a: any) => a.anomaly_reasons ?? []);
    expect(reasons.some((r: string) => r === "future_date" || r === "amount_outlier" || r === "currency_mismatch")).toBe(true);
  });

  it("calculate_analytics produces revenue by region and top merchants", async () => {
    const result = await runPipeline();
    const analytics = result.outputs["calculate_analytics"].analytics;

    expect(analytics.revenue_by_region.length).toBeGreaterThan(0);
    expect(analytics.top_merchants.length).toBeGreaterThan(0);
    expect(analytics.total_revenue).toBeGreaterThan(0);
    expect(analytics.total_transactions).toBeGreaterThan(0);

    // Top merchants sorted descending
    for (let i = 1; i < analytics.top_merchants.length; i++) {
      expect(analytics.top_merchants[i - 1].revenue).toBeGreaterThanOrEqual(analytics.top_merchants[i].revenue);
    }
  });

  it("writes cleaned CSV to disk", async () => {
    const result = await runPipeline();
    const csvPath = join(TEST_DATA_DIR, result.outputs["write_csv_output"].csv_path);
    expect(existsSync(csvPath)).toBe(true);

    const content = readFileSync(csvPath, "utf-8");
    const lines = content.trim().split("\n");
    // header + cleaned row count
    const cleaned = result.outputs["clean_and_dedupe"].cleaned;
    expect(lines.length).toBe(cleaned.length + 1);
  });

  it("writes HTML report to disk", async () => {
    const result = await runPipeline();
    const reportPath = join(TEST_DATA_DIR, result.outputs["write_report"].report_path);
    expect(existsSync(reportPath)).toBe(true);

    const html = readFileSync(reportPath, "utf-8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Data Quality");
    expect(html).toContain("Revenue by Region");
    expect(html).toContain("Top 10 Merchants");
    expect(html).toContain("Anomalies Detected");
    expect(html).toContain("Contract Verification");
    expect(html).toContain("Pipeline Metadata");
  });

  it("writes JSON summary to disk", async () => {
    const result = await runPipeline();
    const summaryPath = join(TEST_DATA_DIR, result.outputs["write_summary"].summary_path);
    expect(existsSync(summaryPath)).toBe(true);

    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    expect(summary.data_quality).toBeDefined();
    expect(summary.analytics).toBeDefined();
    expect(summary.generated_at).toBeDefined();
  });

  it("tracks all effects correctly", async () => {
    const result = await runPipeline();
    const effects = result.effectsPerformed;
    expect(effects).toContain("filesystem.read");
    expect(effects).toContain("filesystem.write");
    expect(effects).toContain("ml_model.infer");
  });

  it("confidence reflects anomaly detection uncertainty", async () => {
    const result = await runPipeline();
    // Anomaly detection has 0.82 confidence, propagated through chain
    expect(result.confidence).toBeLessThan(1.0);
    expect(result.confidence).toBeGreaterThan(0.3);
  });
});
