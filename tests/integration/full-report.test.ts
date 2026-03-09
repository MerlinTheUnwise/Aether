import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { validateGraph } from "../../src/ir/validator.js";
import { checkTypes } from "../../src/compiler/checker.js";
import { verifyGraph } from "../../src/compiler/verifier.js";
import { execute } from "../../src/runtime/executor.js";
import { generateVisualization } from "../../src/visualizer/generate.js";
import type { AetherGraph, AetherNode } from "../../src/ir/validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadGraph(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8")) as AetherGraph;
}

const referencePrograms = [
  "user-registration.json",
  "payment-processing.json",
  "product-recommendations.json",
  "customer-support-agent.json",
  "data-pipeline-etl.json",
  "rate-limiter.json",
  "multi-scope-order.json",
  "content-moderation-agent.json",
];

interface PipelineResult {
  schemaValid: boolean;
  typesValid: boolean;
  verificationPct: number;
  executionResult?: {
    waves: number;
    confidence: number;
    effects: string[];
  };
  visualization?: string;
  failedStage?: string;
}

async function runFullPipeline(graph: AetherGraph): Promise<PipelineResult> {
  const result: PipelineResult = {
    schemaValid: false,
    typesValid: false,
    verificationPct: 0,
  };

  // 1. Validate
  const valResult = validateGraph(graph);
  if (!valResult.valid) {
    result.failedStage = "schema";
    return result;
  }
  result.schemaValid = true;

  // 2. Type check
  const checkResult = checkTypes(graph as any);
  if (!checkResult.compatible) {
    result.failedStage = "types";
    return result;
  }
  result.typesValid = true;

  // 3. Verify
  const verifyReport = await verifyGraph(graph as any);
  result.verificationPct = verifyReport.verification_percentage;

  // 4. Execute
  try {
    const execResult = await execute({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });
    result.executionResult = {
      waves: execResult.waves,
      confidence: execResult.confidence,
      effects: [...new Set(execResult.effectsPerformed)],
    };

    // 5. Visualize
    const html = generateVisualization(graph, execResult);
    result.visualization = html;
  } catch (e) {
    result.failedStage = "execution";
  }

  return result;
}

describe("Full Pipeline Report", () => {
  it("runs complete pipeline on user-registration", async () => {
    const graph = loadGraph("user-registration.json");
    const result = await runFullPipeline(graph);

    expect(result.schemaValid).toBe(true);
    expect(result.typesValid).toBe(true);
    expect(result.failedStage).toBeUndefined();
    expect(result.executionResult).toBeDefined();
    expect(result.executionResult!.waves).toBeGreaterThan(0);
    expect(result.executionResult!.confidence).toBeGreaterThan(0);
    expect(result.visualization).toBeDefined();
    expect(result.visualization).toContain("<!DOCTYPE html>");
  });

  it("runs complete pipeline on all 8 reference programs", async () => {
    for (const prog of referencePrograms) {
      const graph = loadGraph(prog);
      const result = await runFullPipeline(graph);

      expect(result.schemaValid).toBe(true);
      expect(result.typesValid).toBe(true);
      expect(result.failedStage).toBeUndefined();
      expect(result.executionResult).toBeDefined();
      expect(result.visualization).toBeDefined();
    }
  });

  it("report includes execution data", async () => {
    const graph = loadGraph("payment-processing.json");
    const result = await runFullPipeline(graph);

    expect(result.executionResult).toBeDefined();
    expect(result.executionResult!.waves).toBeGreaterThanOrEqual(1);
    expect(result.executionResult!.confidence).toBeGreaterThan(0);
    expect(result.executionResult!.effects.length).toBeGreaterThan(0);
  });

  it("report generates HTML visualization", async () => {
    const graph = loadGraph("user-registration.json");
    const result = await runFullPipeline(graph);

    expect(result.visualization).toBeDefined();
    expect(result.visualization).toContain("<svg");
    expect(result.visualization).toContain(graph.id);
  });

  it("cascades failure when type check fails", async () => {
    // Create a graph with a type mismatch
    const graph: AetherGraph = {
      id: "broken-types",
      version: 1,
      effects: ["database.read"],
      nodes: [
        {
          id: "node_a",
          in: {},
          out: { result: { type: "Int" } },
          contract: { pre: [], post: [] },
          confidence: 0.9,
          effects: [],
        } as AetherNode,
        {
          id: "node_b",
          in: { data: { type: "String" } },
          out: { output: { type: "String" } },
          contract: { pre: [], post: [] },
          confidence: 0.9,
          effects: ["database.read"],
          recovery: { "*": { action: "fallback", params: { value: {} } } },
        } as AetherNode,
      ],
      edges: [{ from: "node_a.result", to: "node_b.data" }],
    };

    const result = await runFullPipeline(graph);
    expect(result.schemaValid).toBe(true);
    expect(result.typesValid).toBe(false);
    expect(result.failedStage).toBe("types");
    expect(result.executionResult).toBeUndefined();
    expect(result.visualization).toBeUndefined();
  });

  it("cascades failure when schema is invalid", async () => {
    const broken = { id: "broken", version: "not-a-number" } as any;
    const result = await runFullPipeline(broken);

    expect(result.schemaValid).toBe(false);
    expect(result.failedStage).toBe("schema");
    expect(result.executionResult).toBeUndefined();
    expect(result.visualization).toBeUndefined();
  });
});
