import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync } from "fs";
import { collectDashboardData } from "../../src/dashboard/collector.js";
import { renderDashboard } from "../../src/dashboard/render.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

const exampleFiles = readdirSync(examplesDir)
  .filter(f => f.endsWith(".json"))
  .map(f => f.replace(".json", ""));

// Test a representative subset with full pipeline (Z3 WASM has per-process memory limits)
const fullPipelinePrograms = [
  "user-registration",
  "payment-processing",
  "order-lifecycle",
  "data-pipeline-etl",
  "rate-limiter",
  "content-moderation-agent",
];

describe("All Programs Dashboard", () => {
  for (const name of fullPipelinePrograms) {
    if (!exampleFiles.includes(name)) continue;

    describe(`Reference: ${name}`, () => {
      it("generates dashboard with correct node count and valid HTML", async () => {
        const graph = JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
        const realNodes = graph.nodes.filter(
          (n: any) => !("hole" in n && n.hole === true) && !("intent" in n && n.intent === true)
        );

        const data = await collectDashboardData(join(examplesDir, `${name}.json`));
        expect(data.graph.nodeCount).toBe(realNodes.length);

        const html = renderDashboard(data);
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("</html>");
        expect(html).toContain(data.graph.id);

        // All node IDs present in HTML
        for (const node of data.verification.byNode) {
          expect(html).toContain(node.nodeId);
        }

        // Verification percentage is a valid number
        expect(data.verification.percentage).toBeGreaterThanOrEqual(0);
        expect(data.verification.percentage).toBeLessThanOrEqual(100);
      });
    });
  }

  // Test remaining programs — collect + render without error
  const remainingPrograms = exampleFiles.filter(f => !fullPipelinePrograms.includes(f));
  for (const name of remainingPrograms) {
    it(`Reference: ${name} — collects and renders without error`, async () => {
      const data = await collectDashboardData(join(examplesDir, `${name}.json`));

      expect(data.graph.id).toBeTruthy();
      expect(data.graph.nodeCount).toBeGreaterThanOrEqual(0);
      expect(data.verification.byNode.length).toBe(data.graph.nodeCount);

      const html = renderDashboard(data);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("</html>");
    });
  }
});
