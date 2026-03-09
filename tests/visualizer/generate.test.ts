import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { generateVisualization } from "../../src/visualizer/generate.js";
import { execute } from "../../src/runtime/executor.js";
import type { AetherGraph, AetherNode, AetherHole } from "../../src/ir/validator.js";

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

describe("Visualizer", () => {
  it("generates valid HTML for user-registration", () => {
    const graph = loadGraph("user-registration.json");
    const html = generateVisualization(graph);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("<svg");
  });

  it("generates valid HTML for all reference programs", () => {
    for (const prog of referencePrograms) {
      const graph = loadGraph(prog);
      const html = generateVisualization(graph);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<svg");
    }
  });

  it("includes all node IDs in output", () => {
    const graph = loadGraph("user-registration.json");
    const html = generateVisualization(graph);
    for (const node of graph.nodes) {
      expect(html).toContain(node.id);
    }
  });

  it("includes edge lines/paths for edges", () => {
    const graph = loadGraph("user-registration.json");
    const html = generateVisualization(graph);
    const lineCount = (html.match(/<line /g) || []).length;
    expect(lineCount).toBeGreaterThanOrEqual(graph.edges.length);
  });

  it("color-codes high confidence nodes with green", () => {
    const graph = loadGraph("user-registration.json");
    const html = generateVisualization(graph);
    // High confidence nodes (>0.85) should have green color
    expect(html).toContain("#22c55e");
  });

  it("color-codes low confidence nodes with red", () => {
    // Create a graph with a low-confidence node
    const graph: AetherGraph = {
      id: "low-conf-test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "risky_node",
          in: {},
          out: { result: { type: "String" } },
          contract: { pre: [], post: [] },
          confidence: 0.5,
          effects: [],
          adversarial_check: { break_if: ["result = \"\""] },
        } as AetherNode,
      ],
      edges: [],
    };
    const html = generateVisualization(graph);
    expect(html).toContain("#ef4444"); // red for <0.7
  });

  it("renders partial graph with hole styling", () => {
    const graph: AetherGraph = {
      id: "partial-test",
      version: 1,
      effects: [],
      partial: true,
      nodes: [
        {
          id: "real_node",
          in: {},
          out: { data: { type: "String" } },
          contract: { pre: [], post: [] },
          confidence: 0.9,
          effects: [],
        } as AetherNode,
        {
          id: "placeholder",
          hole: true,
          must_satisfy: {
            in: { data: { type: "String" } },
            out: { result: { type: "String" } },
          },
        } as AetherHole,
      ],
      edges: [{ from: "real_node.data", to: "placeholder.data" }],
    };
    const html = generateVisualization(graph);
    expect(html).toContain("placeholder");
    // Hole uses gray color and dotted border
    expect(html).toContain("#9ca3af");
    expect(html).toContain("stroke-dasharray: 4 4");
  });

  it("includes execution overlay when ExecutionResult is provided", async () => {
    const graph = loadGraph("user-registration.json");
    const execResult = await execute({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });
    const html = generateVisualization(graph, execResult);
    // Should contain wave labels
    expect(html).toContain("Wave 0");
    // Should contain timing info
    expect(html).toContain("ms");
    // Should contain execution summary
    expect(html).toContain("Execution Summary");
    expect(html).toContain("Final confidence");
  });

  it("returns a complete HTML string writable to file", () => {
    const graph = loadGraph("user-registration.json");
    const html = generateVisualization(graph);
    expect(typeof html).toBe("string");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("shows skipped nodes with distinct styling when below threshold", async () => {
    // Create a graph with a node that will be skipped
    const graph: AetherGraph = {
      id: "skip-test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "source",
          in: {},
          out: { data: { type: "String" } },
          contract: { pre: [], post: [] },
          confidence: 0.5,
          effects: [],
          adversarial_check: { break_if: ["data = \"\""] },
        } as AetherNode,
      ],
      edges: [],
    };
    const execResult = await execute({
      graph,
      inputs: {},
      nodeImplementations: new Map(),
      confidenceThreshold: 0.7,
    });
    const html = generateVisualization(graph, execResult);
    expect(html).toContain("skipped-node");
  });

  it("includes effect tags and confidence badges", () => {
    const graph = loadGraph("payment-processing.json");
    const html = generateVisualization(graph);
    // Should have confidence badges
    expect(html).toContain("confidence-badge");
    // Should show effect pills for effectful nodes
    expect(html).toContain("effect-pill");
  });
});
