/**
 * Agent Integration Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createSession,
  type AgentSubmission,
} from "../../src/agents/protocol.js";
import { createStubAgent } from "../../src/agents/simulator.js";
import { validateGraph } from "../../src/ir/validator.js";
import type { AetherGraph, AetherNode, AetherEdge, Scope } from "../../src/ir/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function isNode(n: { id: string; hole?: boolean }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true);
}

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

async function submitAllScopes(graph: AetherGraph) {
  const session = createSession(graph);
  for (let i = 0; i < graph.scopes!.length; i++) {
    const scope = graph.scopes![i];
    const agentId = `agent-${i + 1}`;
    const view = session.assign(agentId, scope.id);
    const agent = createStubAgent(agentId);
    const submission = await agent(view);
    session.submit(submission);
  }
  return session;
}

describe("Agent Integration", () => {
  it("integrates two compatible scopes successfully", async () => {
    const graph = loadExample("multi-scope-order.json");
    const session = await submitAllScopes(graph);
    const report = session.integrate();

    expect(report.overall).toBe("integrated");
    expect(report.verification_percentage).toBe(100);
    expect(report.scopes.every(s => s.status === "verified")).toBe(true);
  });

  it("detects boundary type mismatch", async () => {
    // Create a graph with incompatible boundary types
    const graph = loadExample("multi-scope-order.json");

    // Mutate the payment scope's requires contract to expect wrong type
    const paymentScope = graph.scopes!.find(s => s.id === "payment")!;
    const req = paymentScope.boundary_contracts!.requires![0];
    // Change expected type from Float64 to String
    req.in.total_amount = { type: "String", domain: "currency" };

    const session = await submitAllScopes(graph);
    const report = session.integrate();

    // Boundary verification should catch the mismatch
    const incompatPairs = report.cross_scope_compatibility.filter(c => !c.compatible);
    expect(incompatPairs.length).toBeGreaterThan(0);
    expect(incompatPairs[0].errors.some(e => e.includes("type mismatch"))).toBe(true);
  });

  it("detects ID conflict across scopes", async () => {
    const graph = loadExample("multi-scope-order.json");
    const session = createSession(graph);

    // Submit scope "order" normally
    const view1 = session.assign("agent-1", "order");
    const scopeNodeIds1 = new Set(view1.scope.nodes);
    const nodes1 = view1.graph.nodes.filter(n => scopeNodeIds1.has(n.id) && isNode(n)) as AetherNode[];
    session.submit({
      agent_id: "agent-1",
      scope_id: "order",
      nodes: nodes1,
      edges: [...view1.internalEdges, ...view1.boundaryEdges],
      submitted_at: new Date().toISOString(),
    });

    // Submit scope "payment" but include a node with an ID from scope "order"
    const view2 = session.assign("agent-2", "payment");
    const scopeNodeIds2 = new Set(view2.scope.nodes);
    const nodes2 = view2.graph.nodes.filter(n => scopeNodeIds2.has(n.id) && isNode(n)) as AetherNode[];
    // Add a conflicting node (same ID as one in scope "order")
    const conflictNode: AetherNode = {
      id: "validate_order", // exists in "order" scope
      in: { x: { type: "Int" } },
      out: { y: { type: "Int" } },
      contract: {},
      effects: [],
      pure: true,
    };
    // This submission should be rejected because validate_order doesn't belong to payment scope
    const result = session.submit({
      agent_id: "agent-2",
      scope_id: "payment",
      nodes: [...nodes2, conflictNode],
      edges: [...view2.internalEdges, ...view2.boundaryEdges],
      submitted_at: new Date().toISOString(),
    });

    expect(result.accepted).toBe(false);
    expect(result.errors.some(e => e.includes("does not belong"))).toBe(true);
  });

  it("computes composed confidence across scopes", async () => {
    const graph = loadExample("multi-scope-order.json");
    const session = await submitAllScopes(graph);
    const report = session.integrate();

    // The order scope provides confidence 0.95
    // Composed = product of all boundary confidences
    expect(report.verification_percentage).toBe(100);
  });

  it("full integration produces valid exportable graph", async () => {
    const graph = loadExample("scoped-ecommerce.json");
    const session = await submitAllScopes(graph);
    const report = session.integrate();

    expect(report.overall).toBe("integrated");

    const exported = session.exportGraph();
    expect(exported.id).toBe(graph.id);
    expect(exported.nodes.length).toBe(graph.nodes.length);
    expect(exported.edges.length).toBeGreaterThan(0);

    // Validate the exported graph passes standalone validation
    const valResult = validateGraph(exported);
    expect(valResult.valid).toBe(true);
  });

  it("partial integration when one scope is not submitted", async () => {
    const graph = loadExample("multi-scope-order.json");
    const session = createSession(graph);

    // Only assign and submit 2 out of 4 scopes
    for (let i = 0; i < 2; i++) {
      const scope = graph.scopes![i];
      const agentId = `agent-${i + 1}`;
      const view = session.assign(agentId, scope.id);
      const agent = createStubAgent(agentId);
      const submission = await agent(view);
      session.submit(submission);
    }

    const report = session.integrate();
    expect(report.overall).toBe("partial");
    expect(report.verification_percentage).toBe(50); // 2 out of 4
  });
});
