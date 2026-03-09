/**
 * Example Coverage Tests
 * Runs all 8 reference programs through the full pipeline.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { validateGraph } from "../../src/ir/validator.js";
import { checkTypes } from "../../src/compiler/checker.js";
import { verifyGraph } from "../../src/compiler/verifier.js";
import { transpileGraph } from "../../src/compiler/transpiler.js";

const examplesDir = join(__dirname, "../../src/ir/examples");

// Get all JSON example files
const exampleFiles = readdirSync(examplesDir)
  .filter(f => f.endsWith(".json"))
  .sort();

describe("Example Coverage", () => {
  it("should have at least 8 reference programs", () => {
    expect(exampleFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of exampleFiles) {
    const filePath = join(examplesDir, file);
    const graphName = file.replace(".json", "");

    describe(`Reference: ${graphName}`, () => {
      let graph: any;

      it("is valid JSON", () => {
        const raw = readFileSync(filePath, "utf-8");
        graph = JSON.parse(raw);
        expect(graph).toBeDefined();
        expect(graph.id).toBeTruthy();
      });

      it("passes schema validation", () => {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        const result = validateGraph(raw);
        expect(result.valid).toBe(true);
        if (!result.valid) {
          console.error(`Validation errors for ${graphName}:`, result.errors);
        }
      });

      it("passes type checking", () => {
        graph = JSON.parse(readFileSync(filePath, "utf-8"));
        const result = checkTypes(graph);
        expect(result.compatible).toBe(true);
        if (!result.compatible) {
          console.error(`Type errors for ${graphName}:`, result.errors);
        }
      });

      it("passes verification without crashing", async () => {
        graph = JSON.parse(readFileSync(filePath, "utf-8"));
        const report = await verifyGraph(graph);
        expect(report.graph_id).toBe(graph.id);
        expect(report.verification_percentage).toBeGreaterThanOrEqual(0);
        // Log verification percentage for informational purposes
        console.log(`  ${graphName}: ${report.verification_percentage}% verified (${report.nodes_verified}/${report.nodes_verified + report.nodes_failed}), ${report.nodes_unsupported} unsupported`);
      });

      it("transpiles to syntactically valid JavaScript", () => {
        graph = JSON.parse(readFileSync(filePath, "utf-8"));
        const js = transpileGraph(graph);
        expect(js).toBeTruthy();
        expect(js.length).toBeGreaterThan(0);
        // Check the generated JS is syntactically valid by parsing it
        expect(() => new Function(js)).not.toThrow();
        // Check basic structure
        expect(js).toContain("async function");
        expect(js).toContain("module.exports");
      });
    });
  }
});
