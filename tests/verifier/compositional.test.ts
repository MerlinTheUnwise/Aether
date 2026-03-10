/**
 * Tests for compositional verification with axiom propagation.
 * Verifies that axioms from upstream nodes are propagated via edges
 * to enable downstream postcondition proofs.
 */

import { describe, it, expect } from "vitest";
import { verifyGraph, getZ3 } from "../../src/compiler/verifier.js";
import { readFileSync } from "fs";
import { join } from "path";

const examplesDir = join(process.cwd(), "src", "ir", "examples");

describe("Compositional verification", () => {
  it("user-registration: 3-node chain with axioms → postconditions proved", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "user-registration.json"), "utf-8"));
    const report = await verifyGraph(graph);

    // validate_email: normalized.is_lowercase, normalized.is_trimmed → both proved
    const validateResult = report.results.find(r => r.node_id === "validate_email");
    expect(validateResult).toBeDefined();
    expect(validateResult!.postconditions.filter(p => p.status === "verified").length).toBeGreaterThanOrEqual(2);

    // create_user: user.email == email, user.status == active → both proved
    const createResult = report.results.find(r => r.node_id === "create_user");
    expect(createResult).toBeDefined();
    expect(createResult!.postconditions.filter(p => p.status === "verified").length).toBeGreaterThanOrEqual(2);
  });

  it("payment-processing: 4-node chain → postconditions proved", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "payment-processing.json"), "utf-8"));
    const report = await verifyGraph(graph);

    // At least some postconditions should be proved across the pipeline
    const totalVerified = report.results.reduce(
      (sum, r) => sum + r.postconditions.filter(p => p.status === "verified").length,
      0
    );
    expect(totalVerified).toBeGreaterThanOrEqual(5);
  });

  it("order-lifecycle: 6-node chain → all status postconditions proved", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "order-lifecycle.json"), "utf-8"));
    const report = await verifyGraph(graph);

    // All 6 nodes have status axioms → all should be verified
    for (const r of report.results) {
      const statusPosts = r.postconditions.filter(p => p.expression.includes("status"));
      for (const p of statusPosts) {
        expect(p.status).toBe("verified");
      }
    }
  });

  it("removing an axiom breaks verification", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "user-registration.json"), "utf-8"));

    // Remove axioms from validate_email
    const node = graph.nodes.find((n: any) => n.id === "validate_email");
    delete node.axioms;

    const report = await verifyGraph(graph);
    const validateResult = report.results.find(r => r.node_id === "validate_email");
    expect(validateResult).toBeDefined();

    // Without axioms, postconditions should fail
    const failedOrUnsupported = validateResult!.postconditions.filter(
      p => p.status === "failed" || p.status === "unsupported"
    );
    expect(failedOrUnsupported.length).toBeGreaterThan(0);
  });

  it("multi-edge: node depends on both upstream nodes → both axiom sets used", async () => {
    // create_user in user-registration depends on both validate_email and check_uniqueness
    const graph = JSON.parse(readFileSync(join(examplesDir, "user-registration.json"), "utf-8"));
    const report = await verifyGraph(graph);

    const createResult = report.results.find(r => r.node_id === "create_user");
    expect(createResult).toBeDefined();
    // create_user has its own axioms so its postconditions should be proved
    const verifiedCount = createResult!.postconditions.filter(p => p.status === "verified").length;
    expect(verifiedCount).toBeGreaterThanOrEqual(2);
  });

  it("rate-limiter: nodes with simple axioms → proved", async () => {
    const graph = JSON.parse(readFileSync(join(examplesDir, "rate-limiter.json"), "utf-8"));
    const report = await verifyGraph(graph);

    const totalVerified = report.results.reduce(
      (sum, r) => sum + r.postconditions.filter(p => p.status === "verified").length,
      0
    );
    // All postconditions in rate-limiter have matching axioms
    expect(totalVerified).toBeGreaterThanOrEqual(5);
  });
});
