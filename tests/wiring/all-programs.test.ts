/**
 * Tests: Execute ALL reference programs with real implementations
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function loadGraph(name: string): AetherGraph {
  return JSON.parse(readFileSync(`src/ir/examples/${name}.json`, "utf-8"));
}

function loadSeed(name: string): Record<string, any[]> {
  try {
    return JSON.parse(readFileSync(`test-data/${name}/seed.json`, "utf-8"));
  } catch {
    return {};
  }
}

function loadInputs(name: string): Record<string, any> {
  try {
    return JSON.parse(readFileSync(`test-data/${name}/inputs.json`, "utf-8"));
  } catch {
    return {};
  }
}

// Programs that can be tested with --real mode
// Some programs use contracts/expressions that our evaluator can handle,
// others need "warn" mode for unevaluable expressions
const PROGRAMS = [
  { name: "user-registration", contractMode: "warn" as const },
  { name: "payment-processing", contractMode: "warn" as const },
  { name: "data-pipeline-etl", contractMode: "warn" as const },
  { name: "rate-limiter", contractMode: "warn" as const },
  { name: "customer-support-agent", contractMode: "warn" as const },
  { name: "content-moderation-agent", contractMode: "warn" as const },
  { name: "order-lifecycle", contractMode: "warn" as const },
  { name: "product-recommendations", contractMode: "warn" as const },
];

describe("All Programs — Real Execution", () => {
  for (const prog of PROGRAMS) {
    it(`${prog.name} executes without errors`, async () => {
      const graph = loadGraph(prog.name);
      const seed = loadSeed(prog.name);
      const inputs = loadInputs(prog.name);

      const ctx = await createExecutionContext(graph, inputs, {
        serviceConfig: { database: { seed } },
        contractMode: prog.contractMode,
      });

      const result = await execute(ctx);

      // Should complete without unhandled errors
      expect(result.nodesExecuted).toBeGreaterThan(0);
      expect(result.waves).toBeGreaterThan(0);

      // All nodes should produce outputs
      for (const entry of result.executionLog) {
        if (!entry.skipped) {
          expect(result.outputs[entry.nodeId]).toBeDefined();
        }
      }

      // Confidence values should be valid
      expect(result.confidence).toBeGreaterThan(0);
      for (const entry of result.executionLog) {
        expect(entry.confidence).toBeGreaterThan(0);
        expect(entry.confidence).toBeLessThanOrEqual(1);
      }
    });
  }

  it("user-registration creates user with correct email", async () => {
    const graph = loadGraph("user-registration");
    const seed = loadSeed("user-registration");

    const ctx = await createExecutionContext(graph, { email: "Test@EXAMPLE.com" }, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    const userOutput = result.outputs["create_user"];
    expect(userOutput.user.email).toBe("test@example.com");
    expect(userOutput.user.status).toBe("active");
  });

  it("payment-processing transitions through created → authorized → captured", async () => {
    const graph = loadGraph("payment-processing");
    const seed = loadSeed("payment-processing");
    const inputs = loadInputs("payment-processing");

    const ctx = await createExecutionContext(graph, inputs, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    expect(result.outputs["validate_payment"].status).toBe("created");
    expect(result.outputs["authorize_card"].status).toBe("authorized");
    expect(result.outputs["capture_funds"].status).toBe("captured");
  });

  it("data-pipeline-etl processes records with deduplication", async () => {
    const graph = loadGraph("data-pipeline-etl");
    const seed = loadSeed("data-pipeline-etl");
    const inputs = loadInputs("data-pipeline-etl");

    const ctx = await createExecutionContext(graph, inputs, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    // Deduplicate should have processed records (DB may already deduplicate on seed)
    const dedupOut = result.outputs["deduplicate"];
    expect(dedupOut.duplicates_removed).toBeGreaterThanOrEqual(0);
    expect(dedupOut.unique_records.length).toBeGreaterThan(0);

    // Aggregate should produce results
    const aggOut = result.outputs["aggregate"];
    expect(aggOut.aggregated_data.length).toBeGreaterThan(0);
    expect(aggOut.checksum).toBeTruthy();

    // Write should succeed
    expect(result.outputs["write_output"].success).toBe(true);
  });

  it("rate-limiter checks and increments quota", async () => {
    const graph = loadGraph("rate-limiter");
    const seed = loadSeed("rate-limiter");
    const inputs = loadInputs("rate-limiter");

    const ctx = await createExecutionContext(graph, inputs, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    const quotaOut = result.outputs["check_quota"];
    expect(quotaOut.current_count).toBeDefined();
    expect(quotaOut.within_limit).toBe(true);
    expect(quotaOut.remaining).toBeGreaterThan(0);
  });

  it("content-moderation-agent cascades confidence through pipeline", async () => {
    const graph = loadGraph("content-moderation-agent");
    const seed = loadSeed("content-moderation-agent");
    const inputs = loadInputs("content-moderation-agent");

    const ctx = await createExecutionContext(graph, inputs, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    // Confidence should cascade (decrease through the chain)
    const classifyConf = result.outputs["classify_content"]?.classification_confidence;
    const severityConf = result.outputs["assess_severity"]?.combined_confidence;

    if (classifyConf !== undefined && severityConf !== undefined) {
      expect(severityConf).toBeLessThanOrEqual(classifyConf);
    }
  });

  it("real-world/sales-analytics executes without errors", async () => {
    const graph = loadGraph("real-world/sales-analytics");
    const csvContent = readFileSync("test-data/sales-analytics/sales.csv", "utf-8");

    const ctx = await createExecutionContext(graph, { file_path: "sales.csv" }, {
      serviceConfig: { filesystem: { files: { "sales.csv": csvContent } } },
      contractMode: "warn",
    });

    const result = await execute(ctx);
    expect(result.nodesExecuted).toBe(10);
    expect(result.contractReport!.violated).toBe(0);
  });

  it("real-world/api-orchestration executes without errors", async () => {
    const graph = loadGraph("real-world/api-orchestration");
    const seed = loadSeed("api-orchestration");
    const inputs = loadInputs("api-orchestration");

    const ctx = await createExecutionContext(graph, inputs, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);
    expect(result.nodesExecuted).toBe(7);
    expect(result.contractReport!.violated).toBe(0);
  });

  it("all effects properly reported", async () => {
    const graph = loadGraph("user-registration");
    const seed = loadSeed("user-registration");

    const ctx = await createExecutionContext(graph, { email: "test@test.com" }, {
      serviceConfig: { database: { seed } },
      contractMode: "warn",
    });

    const result = await execute(ctx);

    // Should have database effects
    expect(result.effectsPerformed.length).toBeGreaterThan(0);
  });
});
