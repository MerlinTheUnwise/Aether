import { describe, it, expect } from "vitest";
import { diffGraphs, hasBreakingChanges, affectedNodes } from "../../src/compiler/diff.js";
import type { AetherGraph } from "../../src/ir/validator.js";

describe("Diff Impact", () => {
  it("diff with breaking changes returns hasBreakingChanges true", () => {
    const g1: AetherGraph = {
      id: "test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "a",
          in: {},
          out: { y: { type: "String" }, z: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        } as any,
      ],
      edges: [],
    };
    const g2: AetherGraph = {
      id: "test",
      version: 2,
      effects: [],
      nodes: [
        {
          id: "a",
          in: {},
          out: { y: { type: "String" } },
          contract: {},
          effects: [],
          pure: true,
        } as any,
      ],
      edges: [],
    };

    const diff = diffGraphs(g1, g2);
    expect(hasBreakingChanges(diff)).toBe(true);
  });

  it("diff with only non-breaking changes returns false", () => {
    const g1: AetherGraph = {
      id: "test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "a",
          in: {},
          out: { y: { type: "String" } },
          contract: { post: ["output.y != null"] },
          effects: [],
          pure: true,
        } as any,
      ],
      edges: [],
    };
    const g2: AetherGraph = {
      id: "test",
      version: 2,
      effects: [],
      nodes: [
        {
          id: "a",
          in: {},
          out: { y: { type: "String" }, z: { type: "Int" } },
          contract: { post: ["output.y != null", "output.z > 0"] },
          effects: [],
          pure: true,
        } as any,
      ],
      edges: [],
    };

    const diff = diffGraphs(g1, g2);
    expect(hasBreakingChanges(diff)).toBe(false);
  });

  it("affected nodes includes downstream when output changes", () => {
    const g1: AetherGraph = {
      id: "test",
      version: 1,
      effects: [],
      nodes: [
        { id: "a", in: {}, out: { y: { type: "String" } }, contract: {}, effects: [], pure: true } as any,
        { id: "b", in: { x: { type: "String" } }, out: { z: { type: "Int" } }, contract: {}, effects: [], pure: true } as any,
        { id: "c", in: { w: { type: "Int" } }, out: { r: { type: "Bool" } }, contract: {}, effects: [], pure: true } as any,
      ],
      edges: [
        { from: "a.y", to: "b.x" },
        { from: "b.z", to: "c.w" },
      ],
    };
    const g2: AetherGraph = {
      ...g1,
      version: 2,
      nodes: [
        { id: "a", in: {}, out: { y: { type: "Int" } }, contract: {}, effects: [], pure: true } as any,
        { id: "b", in: { x: { type: "String" } }, out: { z: { type: "Int" } }, contract: {}, effects: [], pure: true } as any,
        { id: "c", in: { w: { type: "Int" } }, out: { r: { type: "Bool" } }, contract: {}, effects: [], pure: true } as any,
      ],
    };

    const diff = diffGraphs(g1, g2);
    const affected = affectedNodes(diff, g2);

    // a changed, b is downstream of a, c is downstream of b
    expect(affected).toContain("a");
    expect(affected).toContain("b");
    expect(affected).toContain("c");
  });
});
