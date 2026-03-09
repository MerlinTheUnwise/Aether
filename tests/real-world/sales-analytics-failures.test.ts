/**
 * Tests: Sales Analytics Pipeline — Failure Modes
 *
 * Tests recovery strategies: filesystem failure, ML fallback, email retry, disk full escalation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function loadGraph(): AetherGraph {
  return JSON.parse(readFileSync("src/ir/examples/real-world/sales-analytics.json", "utf-8"));
}

const csvContent = readFileSync("test-data/sales-analytics/sales.csv", "utf-8");

describe("Sales Analytics Pipeline — Failure Modes", () => {
  it("filesystem failure on fetch → escalation fires", async () => {
    const graph = loadGraph();

    // Empty filesystem — CSV not found. Error type "not_found" matches "file_not_found"
    // recovery condition via substring matching → escalate → throws
    const ctx = await createExecutionContext(graph, { file_path: "sales.csv" }, {
      serviceConfig: { filesystem: { files: {} } },
      contractMode: "warn",
    });

    await expect(execute(ctx)).rejects.toThrow();
  });

  it("ML failure on anomaly detection → fallback (empty anomalies)", async () => {
    const graph = loadGraph();

    const overrides = new Map<string, (inputs: Record<string, any>) => Promise<Record<string, any>>>();
    overrides.set("detect_anomalies", async () => {
      throw Object.assign(new Error("ML model crashed"), { type: "model_error" });
    });

    const ctx = await createExecutionContext(graph, { file_path: "sales.csv" }, {
      serviceConfig: { filesystem: { files: { "sales.csv": csvContent } } },
      contractMode: "warn",
      implementations: overrides,
    });

    const result = await execute(ctx);

    // The fallback should produce empty data and anomalies
    const anomalyOut = result.outputs["detect_anomalies"];
    expect(anomalyOut).toBeDefined();
    expect(anomalyOut.data).toEqual([]);
    expect(anomalyOut.anomalies).toEqual([]);
  });

  it("email failure → retry fires (3 retries then throws)", async () => {
    const graph = loadGraph();

    let emailAttempts = 0;
    const overrides = new Map<string, (inputs: Record<string, any>) => Promise<Record<string, any>>>();
    overrides.set("email_report", async () => {
      emailAttempts++;
      throw Object.assign(new Error("SMTP connection refused"), { type: "email_failure" });
    });

    const ctx = await createExecutionContext(graph, { file_path: "sales.csv" }, {
      serviceConfig: { filesystem: { files: { "sales.csv": csvContent } } },
      contractMode: "warn",
      implementations: overrides,
    });

    // Retry exhausts then throws
    await expect(execute(ctx)).rejects.toThrow();

    // 1 original + 3 retries = 4 total
    expect(emailAttempts).toBe(4);
  });

  it("disk full on archive → escalation fires", async () => {
    const graph = loadGraph();

    const overrides = new Map<string, (inputs: Record<string, any>) => Promise<Record<string, any>>>();
    overrides.set("archive_report", async () => {
      throw Object.assign(new Error("No space left on device"), { type: "disk_full" });
    });

    const ctx = await createExecutionContext(graph, { file_path: "sales.csv" }, {
      serviceConfig: { filesystem: { files: { "sales.csv": csvContent } } },
      contractMode: "warn",
      implementations: overrides,
    });

    // Escalation throws EscalationError
    await expect(execute(ctx)).rejects.toThrow(/[Ee]scalation/);
  });
});
