/**
 * AETHER Multi-Agent Simulator
 *
 * Test harness that simulates multi-agent collaboration in a single process.
 * Each "agent" is a function that receives a ScopeView and returns a submission.
 */

import type { AetherGraph, AetherNode, AetherEdge } from "../ir/validator.js";
import type { ScopeView } from "../compiler/scopes.js";
import {
  CollaborationSession,
  createSession,
  type AgentSubmission,
  type IntegrationReport,
} from "./protocol.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentFunction = (scopeView: ScopeView) => Promise<AgentSubmission>;

// ─── Default Agent ──────────────────────────────────────────────────────────

function isNode(n: { id: string; hole?: boolean }): n is AetherNode {
  return !("hole" in n && (n as any).hole === true);
}

/**
 * Creates a stub agent that returns the existing nodes from the scope view.
 * This is the simplest possible agent — it just echoes back what was given.
 */
export function createStubAgent(agentId: string): AgentFunction {
  return async (scopeView: ScopeView): Promise<AgentSubmission> => {
    const scopeNodeIds = new Set(scopeView.scope.nodes);
    const nodes = scopeView.graph.nodes.filter(
      n => scopeNodeIds.has(n.id) && isNode(n)
    ) as AetherNode[];

    // Collect edges: internal + boundary edges from the scope view
    const edges: AetherEdge[] = [
      ...scopeView.internalEdges,
      ...scopeView.boundaryEdges,
    ];

    return {
      agent_id: agentId,
      scope_id: scopeView.scope.id,
      nodes,
      edges,
      submitted_at: new Date().toISOString(),
    };
  };
}

// ─── Simulate ───────────────────────────────────────────────────────────────

export async function simulate(
  graph: AetherGraph,
  agents: Map<string, AgentFunction>,
): Promise<IntegrationReport> {
  const session = createSession(graph);
  const scopes = graph.scopes!;

  // Assign agents to scopes and run them
  const tasks: Promise<void>[] = [];

  for (const scope of scopes) {
    const agentFn = agents.get(scope.id);
    if (!agentFn) {
      throw new Error(`No agent function provided for scope "${scope.id}"`);
    }

    const agentId = `agent-${scope.id}`;
    const scopeView = session.assign(agentId, scope.id);

    tasks.push(
      agentFn(scopeView).then(submission => {
        // Ensure agent_id matches assigned agent
        submission.agent_id = agentId;
        session.submit(submission);
      })
    );
  }

  await Promise.all(tasks);

  return session.integrate();
}

/**
 * Simulate with auto-generated stub agents for all scopes.
 */
export async function simulateWithStubs(graph: AetherGraph): Promise<{
  session: CollaborationSession;
  report: IntegrationReport;
}> {
  const session = createSession(graph);
  const scopes = graph.scopes!;

  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    const agentId = `agent-${i + 1}`;
    const scopeView = session.assign(agentId, scope.id);
    const stubAgent = createStubAgent(agentId);
    const submission = await stubAgent(scopeView);
    session.submit(submission);
  }

  const report = session.integrate();
  return { session, report };
}
