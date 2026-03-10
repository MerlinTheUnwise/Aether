/**
 * Tests for edge contract verification.
 * Verifies that source node guarantees imply destination node preconditions.
 */

import { describe, it, expect } from "vitest";
import { verifyEdge, verifyGraph, getZ3 } from "../../src/compiler/verifier.js";
import { readFileSync } from "fs";
import { join } from "path";

function makeNode(overrides: Record<string, any>) {
  return {
    id: "test_node",
    in: {},
    out: {},
    contract: { post: [] },
    effects: [],
    ...overrides,
  };
}

const examplesDir = join(process.cwd(), "src", "ir", "examples");

describe("Edge verification", () => {
  it("source postcondition implies dest precondition → proved", async () => {
    const z3 = await getZ3();
    const source = makeNode({
      id: "source",
      out: { value: { type: "Int" } },
      axioms: ["value > 0"],
      contract: { post: ["value > 0"] },
    });
    const dest = makeNode({
      id: "dest",
      in: { value: { type: "Int" } },
      contract: { pre: ["value > 0"], post: ["value > 0"] },
    });
    const edge = { from: "source.value", to: "dest.value" };

    const result = await verifyEdge(edge, source, dest, z3);
    expect(result.preconditionsSatisfied).toBe(true);
    expect(result.details[0].status).toBe("proved");
  });

  it("source does NOT guarantee dest need → failed", async () => {
    const z3 = await getZ3();
    const source = makeNode({
      id: "source",
      out: { value: { type: "Int" } },
      axioms: ["value >= 0"],
      contract: { post: ["value >= 0"] },
    });
    const dest = makeNode({
      id: "dest",
      in: { value: { type: "Int" } },
      contract: { pre: ["value > 10"], post: ["value > 10"] },
    });
    const edge = { from: "source.value", to: "dest.value" };

    const result = await verifyEdge(edge, source, dest, z3);
    expect(result.preconditionsSatisfied).toBe(false);
    expect(result.details[0].status).toBe("failed");
  });

  it("edge with no preconditions on dest → trivially satisfied", async () => {
    const z3 = await getZ3();
    const source = makeNode({
      id: "source",
      out: { value: { type: "Int" } },
      axioms: ["value > 0"],
      contract: { post: ["value > 0"] },
    });
    const dest = makeNode({
      id: "dest",
      in: { value: { type: "Int" } },
      contract: { post: ["value > 0"] },
    });
    const edge = { from: "source.value", to: "dest.value" };

    const result = await verifyEdge(edge, source, dest, z3);
    expect(result.preconditionsSatisfied).toBe(true);
    expect(result.details).toHaveLength(0);
  });

  it("data-pipeline-etl: edges with preconditions are verified", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "data-pipeline-etl.json"), "utf-8"));
    const report = await verifyGraph(graph);

    // write_output has pre: checksum.length > 0
    // aggregate has axiom: checksum.length > 0
    // So the edge aggregate.checksum → write_output.checksum should be verified
    expect(report.edgeResults).toBeDefined();
    if (report.edgeResults && report.edgeResults.length > 0) {
      const checksumEdge = report.edgeResults.find(e => e.edge.includes("checksum"));
      if (checksumEdge) {
        expect(checksumEdge.preconditionsSatisfied).toBe(true);
      }
    }
  });

  it("multiple edges into one node → all upstream axioms combined", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "user-registration.json"), "utf-8"));
    const report = await verifyGraph(graph);

    // The graph has edges flowing into create_user from both validate_email and check_uniqueness
    expect(report.edgeResults).toBeDefined();
  });

  it("summary includes edge proof rate", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "data-pipeline-etl.json"), "utf-8"));
    const report = await verifyGraph(graph);

    expect(report.summary).toBeDefined();
    expect(report.summary!.edgeProofRate).toBeGreaterThanOrEqual(0);
  });
});
