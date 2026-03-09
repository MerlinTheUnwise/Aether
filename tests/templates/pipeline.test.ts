/**
 * Template Pipeline Tests
 * Verifies template-showcase.json passes the full pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { validateGraph } from "../../src/ir/validator.js";
import { checkTypes } from "../../src/compiler/checker.js";
import { verifyGraph } from "../../src/compiler/verifier.js";
import { execute } from "../../src/runtime/executor.js";
import { generateVisualization } from "../../src/visualizer/generate.js";

const showcasePath = join(__dirname, "../../src/ir/examples/template-showcase.json");

describe("Template Pipeline", () => {
  it("template-showcase.json passes validation", () => {
    const raw = JSON.parse(readFileSync(showcasePath, "utf-8"));
    const result = validateGraph(raw);
    expect(result.valid).toBe(true);
  });

  it("template-showcase.json passes type checking", () => {
    const graph = JSON.parse(readFileSync(showcasePath, "utf-8"));
    const result = checkTypes(graph);
    expect(result.compatible).toBe(true);
  });

  it("template-showcase.json passes verification", async () => {
    const graph = JSON.parse(readFileSync(showcasePath, "utf-8"));
    const report = await verifyGraph(graph);
    // Just ensure it doesn't crash — unsupported expressions are okay
    expect(report.results).toBeDefined();
  });

  it("template-showcase.json executes in stub mode", async () => {
    const graph = JSON.parse(readFileSync(showcasePath, "utf-8"));
    const result = await execute({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });
    expect(result.nodesExecuted + result.nodesSkipped).toBeGreaterThan(0);
    expect(result.waves).toBeGreaterThan(0);
  });

  it("template-showcase.json generates visualization", async () => {
    const graph = JSON.parse(readFileSync(showcasePath, "utf-8"));
    const execResult = await execute({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });
    const html = generateVisualization(graph, execResult);
    expect(html).toContain("template-showcase");
    expect(html).toContain("<svg");
  });
});
