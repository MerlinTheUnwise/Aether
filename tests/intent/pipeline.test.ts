import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { resolveGraph, loadCertifiedLibrary } from "../../src/compiler/resolver.js";
import { diffGraphs, hasBreakingChanges, affectedNodes } from "../../src/compiler/diff.js";
import { validateGraph } from "../../src/ir/validator.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "..", "..", "src", "ir", "examples");

const v1 = JSON.parse(readFileSync(join(examplesDir, "intent-data-pipeline.json"), "utf-8")) as AetherGraph;
const v2 = JSON.parse(readFileSync(join(examplesDir, "intent-data-pipeline-v2.json"), "utf-8")) as AetherGraph;
const library = loadCertifiedLibrary();

describe("Intent Data Pipeline", () => {
  it("v1 validates successfully", () => {
    const result = validateGraph(v1);
    expect(result.valid).toBe(true);
  });

  it("v2 validates successfully", () => {
    const result = validateGraph(v2);
    expect(result.valid).toBe(true);
  });

  it("v1 resolves 3 intents correctly", () => {
    const report = resolveGraph(v1, library);
    expect(report.intents_found).toBe(3);
    expect(report.intents_resolved).toBe(3);
    expect(report.intents_unresolved).toBe(0);

    // Check specific resolutions
    const sortRes = report.resolutions.find(r => r.intentId === "sort_results");
    expect(sortRes?.resolved).toBe(true);
    expect(sortRes?.matchReason).toContain("sort-ascending");

    const dedupRes = report.resolutions.find(r => r.intentId === "remove_dupes");
    expect(dedupRes?.resolved).toBe(true);
    expect(dedupRes?.matchReason).toContain("deduplicate");

    const sumRes = report.resolutions.find(r => r.intentId === "sum_revenue");
    expect(sumRes?.resolved).toBe(true);
    expect(sumRes?.matchReason).toContain("aggregate-sum");
  });

  it("resolved v1 graph passes full validation", () => {
    const report = resolveGraph(v1, library);
    const result = validateGraph(report.resolvedGraph);
    expect(result.valid).toBe(true);
  });

  it("diff between v1 and v2 produces expected changes", () => {
    const diff = diffGraphs(v1, v2);

    expect(diff.graph_id).toBe("daily-report");
    expect(diff.version_from).toBe(1);
    expect(diff.version_to).toBe(2);

    // Should detect at least these changes:
    // 1. Node added (validate_dates)
    expect(diff.impact.nodes_added).toBeGreaterThanOrEqual(1);
    const addedNode = diff.changes.find(
      c => c.type === "node_added" && c.node_id === "validate_dates"
    );
    expect(addedNode).toBeDefined();

    // 2. Confidence changed on sum_revenue (0.95 → 0.8)
    const confChange = diff.changes.find(
      c => c.type === "confidence_changed" && c.node_id === "sum_revenue"
    );
    expect(confChange).toBeDefined();
    expect((confChange as any).from).toBe(0.95);
    expect((confChange as any).to).toBe(0.8);

    // 3. Effect added to format_report
    const effectAdd = diff.changes.find(
      c => c.type === "effect_added" && c.node_id === "format_report"
    );
    expect(effectAdd).toBeDefined();
    expect((effectAdd as any).effect).toBe("logging");

    // Should have breaking changes
    expect(hasBreakingChanges(diff)).toBe(true);
  });

  it("affected nodes includes downstream of changed nodes", () => {
    const diff = diffGraphs(v1, v2);
    const affected = affectedNodes(diff, v2);

    // format_report changed (effect added), deliver is downstream
    expect(affected).toContain("format_report");
    expect(affected).toContain("deliver");
  });
});
