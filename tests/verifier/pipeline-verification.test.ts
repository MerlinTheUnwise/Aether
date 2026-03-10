/**
 * Tests for pipeline-level verification.
 * Verifies end-to-end properties of entire graphs from axiom chains.
 */

import { describe, it, expect } from "vitest";
import { verifyGraph } from "../../src/compiler/verifier.js";
import { readFileSync } from "fs";
import { join } from "path";

const examplesDir = join(process.cwd(), "src", "ir", "examples");
const realWorldDir = join(examplesDir, "real-world");

describe("Pipeline verification", () => {
  it("data-pipeline-etl: pipeline properties proved from axiom chain", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "data-pipeline-etl.json"), "utf-8"));
    const report = await verifyGraph(graph);

    expect(report.pipelineProperties).toBeDefined();
    expect(report.pipelineProperties!.length).toBe(3);

    // record_count >= 0 should be proved (axiom on fetch_raw_data)
    const recordCount = report.pipelineProperties!.find(p => p.property === "record_count >= 0");
    expect(recordCount).toBeDefined();
    expect(recordCount!.provedFromChain).toBe(true);

    // duplicates_removed >= 0 should be proved (axiom on deduplicate)
    const dupes = report.pipelineProperties!.find(p => p.property === "duplicates_removed >= 0");
    expect(dupes).toBeDefined();
    expect(dupes!.provedFromChain).toBe(true);

    // rows_written >= 0 should be proved (axiom on write_output)
    const rows = report.pipelineProperties!.find(p => p.property === "rows_written >= 0");
    expect(rows).toBeDefined();
    expect(rows!.provedFromChain).toBe(true);
  }, 30000);

  it("user-registration: pipeline properties proved", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "user-registration.json"), "utf-8"));
    const report = await verifyGraph(graph);

    expect(report.pipelineProperties).toBeDefined();
    expect(report.pipelineProperties!.length).toBe(2);

    // At least one property should be proved
    const proved = report.pipelineProperties!.filter(p => p.provedFromChain);
    expect(proved.length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it("payment-processing: pipeline properties verified", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "payment-processing.json"), "utf-8"));
    const report = await verifyGraph(graph);

    expect(report.pipelineProperties).toBeDefined();
    expect(report.pipelineProperties!.length).toBe(2);
  }, 30000);

  it("sales-analytics: pipeline properties verified", async () => {
    const graph = JSON.parse(readFileSync(join(realWorldDir, "sales-analytics.json"), "utf-8"));
    const report = await verifyGraph(graph);

    expect(report.pipelineProperties).toBeDefined();
    expect(report.pipelineProperties!.length).toBe(2);

    // archived = true should be proved (axiom on archive_results)
    const archived = report.pipelineProperties!.find(p => p.property === "archived = true");
    expect(archived).toBeDefined();
    expect(archived!.provedFromChain).toBe(true);
  }, 30000);

  it("missing axiom in chain → pipeline property fails", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "data-pipeline-etl.json"), "utf-8"));

    // Add a pipeline property that no axiom supports
    graph.pipeline_properties = ["nonexistent_var > 1000"];

    const report = await verifyGraph(graph);

    expect(report.pipelineProperties).toBeDefined();
    expect(report.pipelineProperties!.length).toBe(1);
    expect(report.pipelineProperties![0].provedFromChain).toBe(false);
  }, 30000);

  it("pipeline with no properties declared → skip gracefully", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "rate-limiter.json"), "utf-8"));
    const report = await verifyGraph(graph);

    // No pipeline_properties declared, so pipelineProperties should be empty
    expect(report.pipelineProperties).toBeDefined();
    expect(report.pipelineProperties!.length).toBe(0);
  }, 30000);

  it("summary includes pipeline proof rate", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "data-pipeline-etl.json"), "utf-8"));
    const report = await verifyGraph(graph);

    expect(report.summary).toBeDefined();
    expect(report.summary!.pipelineProofRate).toBeGreaterThanOrEqual(0);
    expect(report.summary!.overallConfidence).toBeDefined();
  }, 30000);
});
