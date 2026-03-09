/**
 * Agent Protocol Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createSession,
  CollaborationSession,
  type AgentSubmission,
} from "../../src/agents/protocol.js";
import type { AetherGraph, AetherNode } from "../../src/ir/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

function isNode(n: { id: string; hole?: boolean }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true);
}

describe("Agent Protocol", () => {
  describe("Session Creation", () => {
    it("creates session from scoped graph", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      expect(session.graphId).toBe("multi_scope_order");
      expect(session.originalGraph).toBe(graph);
    });

    it("throws on graph without scopes", () => {
      const graph = loadExample("payment-processing.json");
      expect(() => createSession(graph)).toThrow("no scopes");
    });
  });

  describe("Scope Assignment", () => {
    it("assigns agent to valid scope and returns ScopeView", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      const view = session.assign("agent-1", "order");

      expect(view.scope.id).toBe("order");
      expect(view.graph.nodes.length).toBeGreaterThanOrEqual(2);
      expect(view.boundaryStubs.length).toBeGreaterThan(0);
    });

    it("throws when assigning to nonexistent scope", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      expect(() => session.assign("agent-1", "nonexistent")).toThrow('Scope "nonexistent" not found');
    });

    it("throws when assigning to already-assigned scope", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      session.assign("agent-1", "order");
      expect(() => session.assign("agent-2", "order")).toThrow("already assigned");
    });
  });

  describe("Submission", () => {
    it("accepts valid work submission", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      const view = session.assign("agent-1", "order");

      const scopeNodeIds = new Set(view.scope.nodes);
      const nodes = view.graph.nodes.filter(n => scopeNodeIds.has(n.id) && isNode(n)) as AetherNode[];

      const submission: AgentSubmission = {
        agent_id: "agent-1",
        scope_id: "order",
        nodes,
        edges: [...view.internalEdges, ...view.boundaryEdges],
        submitted_at: new Date().toISOString(),
      };

      const result = session.submit(submission);
      expect(result.accepted).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects submission for wrong scope", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      session.assign("agent-1", "order");

      const submission: AgentSubmission = {
        agent_id: "agent-1",
        scope_id: "payment", // not assigned to this
        nodes: [],
        edges: [],
        submitted_at: new Date().toISOString(),
      };

      const result = session.submit(submission);
      expect(result.accepted).toBe(false);
      expect(result.errors[0]).toContain("not assigned");
    });

    it("rejects submission from wrong agent", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      session.assign("agent-1", "order");

      const submission: AgentSubmission = {
        agent_id: "agent-wrong",
        scope_id: "order",
        nodes: [],
        edges: [],
        submitted_at: new Date().toISOString(),
      };

      const result = session.submit(submission);
      expect(result.accepted).toBe(false);
      expect(result.errors[0]).toContain("not assigned");
    });

    it("rejects submission with nodes outside scope", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);
      const view = session.assign("agent-1", "order");

      // Include a node from the payment scope
      const paymentNode = graph.nodes.find(n => n.id === "process_payment") as AetherNode;

      const submission: AgentSubmission = {
        agent_id: "agent-1",
        scope_id: "order",
        nodes: [paymentNode],
        edges: [],
        submitted_at: new Date().toISOString(),
      };

      const result = session.submit(submission);
      expect(result.accepted).toBe(false);
      expect(result.errors.some(e => e.includes("does not belong to scope"))).toBe(true);
    });
  });

  describe("Session Status", () => {
    it("tracks session status correctly", () => {
      const graph = loadExample("multi-scope-order.json");
      const session = createSession(graph);

      let status = session.status();
      expect(status.total_scopes).toBe(4);
      expect(status.assigned).toBe(0);
      expect(status.pending).toBe(4);

      session.assign("agent-1", "order");
      status = session.status();
      expect(status.assigned).toBe(1);
      expect(status.pending).toBe(3);
    });
  });
});
