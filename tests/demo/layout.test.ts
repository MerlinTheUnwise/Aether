import { describe, it, expect } from "vitest";
import { computeWaves, EXAMPLES } from "../../src/demo/generate.js";

describe("In-Browser Layout", () => {
  it("3-node chain produces 3 waves", () => {
    const program = {
      nodes: [
        { id: "a", in: {}, out: { y: { type: "Int" } } },
        { id: "b", in: { x: { type: "Int" } }, out: { y: { type: "Int" } } },
        { id: "c", in: { x: { type: "Int" } }, out: { z: { type: "Int" } } },
      ],
      edges: [
        { from: "a.y", to: "b.x" },
        { from: "b.y", to: "c.x" },
      ],
    };

    const { waves } = computeWaves(program);
    expect(waves).toHaveLength(3);
    expect(waves[0]).toContain("a");
    expect(waves[1]).toContain("b");
    expect(waves[2]).toContain("c");
  });

  it("parallel nodes land in the same wave", () => {
    const program = {
      nodes: [
        { id: "a", in: {}, out: { y: { type: "Int" } } },
        { id: "b", in: {}, out: { y: { type: "Int" } } },
        { id: "c", in: { x: { type: "Int" }, z: { type: "Int" } }, out: { r: { type: "Int" } } },
      ],
      edges: [
        { from: "a.y", to: "c.x" },
        { from: "b.y", to: "c.z" },
      ],
    };

    const { waves, waveMap } = computeWaves(program);
    expect(waveMap.get("a")).toBe(0);
    expect(waveMap.get("b")).toBe(0);
    expect(waveMap.get("c")).toBe(1);
    expect(waves[0]).toContain("a");
    expect(waves[0]).toContain("b");
    expect(waves[1]).toContain("c");
  });

  it("positions user-registration nodes by wave", () => {
    const program = EXAMPLES[0].program;
    const { waves, waveMap } = computeWaves(program as any);

    // validate_email has no dependencies → wave 0
    expect(waveMap.get("validate_email")).toBe(0);

    // check_uniqueness depends on validate_email → wave 1
    expect(waveMap.get("check_uniqueness")).toBe(1);

    // create_user depends on both validate_email and check_uniqueness → wave 2
    expect(waveMap.get("create_user")).toBe(2);

    expect(waves).toHaveLength(3);
  });

  it("handles single node graph", () => {
    const program = {
      nodes: [{ id: "only", in: {}, out: {} }],
      edges: [],
    };
    const { waves, waveMap } = computeWaves(program);
    expect(waves).toHaveLength(1);
    expect(waveMap.get("only")).toBe(0);
  });

  it("handles diamond dependency pattern", () => {
    // a → b, a → c, b → d, c → d
    const program = {
      nodes: [
        { id: "a", in: {}, out: { x: { type: "Int" }, y: { type: "Int" } } },
        { id: "b", in: { x: { type: "Int" } }, out: { z: { type: "Int" } } },
        { id: "c", in: { y: { type: "Int" } }, out: { z: { type: "Int" } } },
        { id: "d", in: { p: { type: "Int" }, q: { type: "Int" } }, out: { r: { type: "Int" } } },
      ],
      edges: [
        { from: "a.x", to: "b.x" },
        { from: "a.y", to: "c.y" },
        { from: "b.z", to: "d.p" },
        { from: "c.z", to: "d.q" },
      ],
    };

    const { waves, waveMap } = computeWaves(program);
    expect(waveMap.get("a")).toBe(0);
    expect(waveMap.get("b")).toBe(1);
    expect(waveMap.get("c")).toBe(1);
    expect(waveMap.get("d")).toBe(2);
    expect(waves).toHaveLength(3);
  });

  it("correctly assigns waves for all 4 examples", () => {
    for (const ex of EXAMPLES) {
      const { waves } = computeWaves(ex.program as any);
      expect(waves.length).toBeGreaterThan(0);
      // Every node should be assigned to exactly one wave
      const allNodes = new Set((ex.program as any).nodes.map((n: any) => n.id));
      const nodesInWaves = new Set(waves.flat());
      expect(nodesInWaves).toEqual(allNodes);
    }
  });
});
