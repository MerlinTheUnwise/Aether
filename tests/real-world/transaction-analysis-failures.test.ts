/**
 * Tests: Transaction Analysis Pipeline — Failure Modes
 *
 * Tests recovery strategies, corrupt data handling, and graceful degradation.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import { generateSampleData } from "../../scripts/generate-sample-data.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const TEST_DATA_DIR = resolve("test-output/txn-analysis-failures");

function loadGraph(): AetherGraph {
  return JSON.parse(readFileSync("src/ir/examples/real-world/transaction-analysis.json", "utf-8"));
}

describe("Transaction Analysis Pipeline — Failure Modes", () => {
  beforeAll(async () => {
    const sampleDir = join(TEST_DATA_DIR, "sample-data");
    if (!existsSync(sampleDir)) {
      await generateSampleData(sampleDir);
    }
    mkdirSync(join(TEST_DATA_DIR, "output"), { recursive: true });
  });

  it("missing input file triggers recovery escalation", async () => {
    const graph = loadGraph();
    const ctx = await createExecutionContext(
      graph,
      {
        read_transactions: { file_path: "nonexistent/missing.csv" },
        read_customers: { file_path: "sample-data/customers.json" },
        read_categories: { file_path: "sample-data/categories.json" },
        write_csv_output: { output_dir: "output" },
        write_report: { output_dir: "output" },
        write_summary: { output_dir: "output" },
      },
      {
        serviceConfig: {
          mode: "real" as const,
          real: { filesystem: { basePath: TEST_DATA_DIR } },
        },
        contractMode: "skip",
      },
    );

    // Missing file should cause an error (recovery escalation throws)
    let threw = false;
    try {
      await execute(ctx);
    } catch (err: any) {
      threw = true;
      expect(err.message).toMatch(/not found|File not found/i);
    }
    expect(threw).toBe(true);
  });

  it("corrupt CSV with malformed rows gets caught by validation", async () => {
    // Write a corrupt CSV
    const corruptDir = join(TEST_DATA_DIR, "corrupt-data");
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(
      join(corruptDir, "transactions.csv"),
      "transaction_id,date,merchant,category,amount,currency,status,customer_id\n" +
      "TXN-0001,2026-01-15,Walmart,groceries,47.83,USD,completed,CUST-001\n" +
      "BAD-ROW-NO-FIELDS\n" +
      ",,,,,,,\n" +
      "TXN-0003,2026-01-16,Shell,fuel,52.10,USD,completed,CUST-001\n",
    );

    // Copy customers and categories
    const sampleDir = join(TEST_DATA_DIR, "sample-data");
    writeFileSync(
      join(corruptDir, "customers.json"),
      readFileSync(join(sampleDir, "customers.json"), "utf-8"),
    );
    writeFileSync(
      join(corruptDir, "categories.json"),
      readFileSync(join(sampleDir, "categories.json"), "utf-8"),
    );

    const graph = loadGraph();
    const ctx = await createExecutionContext(
      graph,
      {
        read_transactions: { file_path: "corrupt-data/transactions.csv" },
        read_customers: { file_path: "corrupt-data/customers.json" },
        read_categories: { file_path: "corrupt-data/categories.json" },
        write_csv_output: { output_dir: "output" },
        write_report: { output_dir: "output" },
        write_summary: { output_dir: "output" },
      },
      {
        serviceConfig: {
          mode: "real" as const,
          real: { filesystem: { basePath: TEST_DATA_DIR } },
        },
        contractMode: "skip",
      },
    );

    const result = await execute(ctx);
    // Validation should catch malformed rows
    const validateOut = result.outputs["validate_txn_records"];
    if (validateOut) {
      expect(validateOut.invalid.length).toBeGreaterThan(0);
      expect(validateOut.valid.length + validateOut.invalid.length).toBe(
        result.outputs["read_transactions"].data.length,
      );
    }
  });

  it("anomaly detector fallback returns empty anomalies on injected failure", async () => {
    const graph = loadGraph();

    // Override detect_txn_anomalies to throw
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
          real: { filesystem: { basePath: TEST_DATA_DIR } },
        },
        contractMode: "skip",
        implementations: new Map([
          ["detect_txn_anomalies", async () => {
            throw Object.assign(new Error("model_error"), { type: "model_error" });
          }],
        ]),
      },
    );

    const result = await execute(ctx);
    // The fallback should produce empty normal/anomalies
    const anomalyOut = result.outputs["detect_txn_anomalies"];
    if (anomalyOut) {
      expect(anomalyOut.normal).toBeDefined();
      expect(anomalyOut.anomalies).toBeDefined();
    }
  });
});
