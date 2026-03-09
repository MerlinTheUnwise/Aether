/**
 * Agent Simulation Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { simulate, simulateWithStubs, type AgentFunction } from "../../src/agents/simulator.js";
import type { AetherGraph, AetherNode } from "../../src/ir/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

describe("Agent Simulation", () => {
  it("simulate on multi-scope-order → all scopes verified", async () => {
    const graph = loadExample("multi-scope-order.json");
    const { report } = await simulateWithStubs(graph);

    expect(report.overall).toBe("integrated");
    expect(report.verification_percentage).toBe(100);
    expect(report.scopes.every(s => s.status === "verified")).toBe(true);
  });

  it("simulate on scoped-ecommerce → all scopes verified", async () => {
    const graph = loadExample("scoped-ecommerce.json");
    const { report } = await simulateWithStubs(graph);

    expect(report.overall).toBe("integrated");
    expect(report.verification_percentage).toBe(100);
    expect(report.scopes.every(s => s.status === "verified")).toBe(true);
  });

  it("simulate on multi-agent-marketplace → all scopes verified", async () => {
    const graph = loadExample("multi-agent-marketplace.json");
    const { report } = await simulateWithStubs(graph);

    expect(report.overall).toBe("integrated");
    expect(report.verification_percentage).toBe(100);
    expect(report.scopes.every(s => s.status === "verified")).toBe(true);
  });

  it("simulate with one agent submitting bad work → partial integration", async () => {
    const graph = loadExample("multi-scope-order.json");

    const agents = new Map<string, AgentFunction>();

    // Good agents for all scopes except payment
    for (const scope of graph.scopes!) {
      if (scope.id === "payment") {
        // Bad agent: submits nodes that don't belong to the scope
        agents.set(scope.id, async (scopeView) => {
          return {
            agent_id: `agent-${scope.id}`,
            scope_id: scope.id,
            nodes: [{
              id: "validate_order", // This belongs to the "order" scope, not "payment"
              in: { x: { type: "Int" } },
              out: { y: { type: "Int" } },
              contract: {},
              effects: [],
              pure: true,
            }],
            edges: [],
            submitted_at: new Date().toISOString(),
          };
        });
      } else {
        // Good agent: returns existing nodes
        agents.set(scope.id, async (scopeView) => {
          const scopeNodeIds = new Set(scopeView.scope.nodes);
          const nodes = scopeView.graph.nodes.filter(
            n => scopeNodeIds.has(n.id) && !("hole" in n && (n as any).hole === true)
          ) as AetherNode[];
          return {
            agent_id: `agent-${scope.id}`,
            scope_id: scope.id,
            nodes,
            edges: [...scopeView.internalEdges, ...scopeView.boundaryEdges],
            submitted_at: new Date().toISOString(),
          };
        });
      }
    }

    const report = await simulate(graph, agents);

    expect(report.overall).toBe("partial");
    // payment scope should be rejected
    const paymentResult = report.scopes.find(s => s.scope_id === "payment");
    expect(paymentResult?.status).toBe("rejected");
  });

  it("simulate with custom agents using simulate function", async () => {
    const graph = loadExample("scoped-ecommerce.json");

    const agents = new Map<string, AgentFunction>();
    for (const scope of graph.scopes!) {
      agents.set(scope.id, async (scopeView) => {
        const scopeNodeIds = new Set(scopeView.scope.nodes);
        const nodes = scopeView.graph.nodes.filter(
          n => scopeNodeIds.has(n.id) && !("hole" in n && (n as any).hole === true)
        ) as AetherNode[];
        return {
          agent_id: `custom-agent-${scope.id}`,
          scope_id: scope.id,
          nodes,
          edges: [...scopeView.internalEdges, ...scopeView.boundaryEdges],
          submitted_at: new Date().toISOString(),
        };
      });
    }

    const report = await simulate(graph, agents);
    expect(report.overall).toBe("integrated");
  });

  it("simulateWithStubs returns session and report", async () => {
    const graph = loadExample("multi-scope-order.json");
    const { session, report } = await simulateWithStubs(graph);

    expect(session).toBeDefined();
    expect(session.graphId).toBe("multi_scope_order");
    expect(report.graph_id).toBe("multi_scope_order");
    expect(report.scopes.length).toBe(4);
  });
});
