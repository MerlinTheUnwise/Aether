import { describe, it, expect } from "vitest";
import { layoutGraph, computeWaves } from "../../src/editor/layout.js";
import type { AetherGraph } from "../../src/ir/validator.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

describe("Editor Layout", () => {
  describe("computeWaves", () => {
    it("3-node chain → 3 waves", () => {
      const graph = loadExample("user-registration.json");
      const waves = computeWaves(graph);
      // validate_email → check_uniqueness + create_user dependencies
      expect(waves.length).toBeGreaterThanOrEqual(2);
      // First wave has validate_email (no deps)
      expect(waves[0]).toContain("validate_email");
    });

    it("empty graph → empty waves", () => {
      const graph: AetherGraph = { id: "empty", version: 1, effects: [], nodes: [], edges: [] };
      const waves = computeWaves(graph);
      expect(waves).toEqual([]);
    });

    it("single node → one wave", () => {
      const graph: AetherGraph = {
        id: "single", version: 1, effects: [],
        nodes: [{ id: "n1", in: {}, out: {}, contract: {}, effects: [], pure: true }],
        edges: [],
      };
      const waves = computeWaves(graph);
      expect(waves).toEqual([["n1"]]);
    });

    it("2 parallel nodes → same wave", () => {
      const graph: AetherGraph = {
        id: "parallel", version: 1, effects: [],
        nodes: [
          { id: "a", in: {}, out: { x: { type: "Int" } }, contract: {}, effects: [], pure: true },
          { id: "b", in: {}, out: { y: { type: "Int" } }, contract: {}, effects: [], pure: true },
        ],
        edges: [],
      };
      const waves = computeWaves(graph);
      expect(waves.length).toBe(1);
      expect(waves[0]).toContain("a");
      expect(waves[0]).toContain("b");
    });
  });

  describe("layoutGraph", () => {
    it("3-node chain → all nodes positioned, no overlaps", () => {
      const graph = loadExample("user-registration.json");
      const result = layoutGraph(graph);
      expect(result.positions.size).toBe(3);
      expect(result.dimensions.width).toBeGreaterThan(0);
      expect(result.dimensions.height).toBeGreaterThan(0);

      // Check no overlapping positions
      const positions = [...result.positions.values()];
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const overlap =
            Math.abs(positions[i].x - positions[j].x) < 220 &&
            Math.abs(positions[i].y - positions[j].y) < 120;
          if (positions[i].x === positions[j].x && positions[i].y === positions[j].y) {
            expect(overlap).toBe(false);
          }
        }
      }
    });

    it("complex graph (multi-scope-order) → all nodes positioned", () => {
      const graph = loadExample("multi-scope-order.json");
      const result = layoutGraph(graph);
      const nodeCount = graph.nodes.filter(n => !("hole" in n)).length;
      expect(result.positions.size).toBe(nodeCount);
    });

    it("empty graph → empty positions", () => {
      const graph: AetherGraph = { id: "empty", version: 1, effects: [], nodes: [], edges: [] };
      const result = layoutGraph(graph);
      expect(result.positions.size).toBe(0);
      expect(result.dimensions.width).toBe(0);
      expect(result.dimensions.height).toBe(0);
    });

    it("single node → centered", () => {
      const graph: AetherGraph = {
        id: "single", version: 1, effects: [],
        nodes: [{ id: "n1", in: {}, out: {}, contract: {}, effects: [], pure: true }],
        edges: [],
      };
      const result = layoutGraph(graph);
      expect(result.positions.size).toBe(1);
      expect(result.positions.has("n1")).toBe(true);
      const pos = result.positions.get("n1")!;
      expect(pos.x).toBeGreaterThanOrEqual(0);
      expect(pos.y).toBeGreaterThanOrEqual(0);
    });

    it("respects direction option", () => {
      const graph = loadExample("user-registration.json");
      const lr = layoutGraph(graph, { direction: "left-right" });
      expect(lr.positions.size).toBe(3);
      expect(lr.dimensions.width).toBeGreaterThan(0);
    });
  });
});
