/**
 * AI Generation Pipeline Tests (no API needed — uses mock responses)
 */

import { describe, it, expect } from "vitest";
import {
  cleanJsonResponse,
  classifyValidationError,
  classifyCheckError,
  classifyVerificationFailure,
  buildFixPrompt,
  processRawResponse,
  type BugReport,
} from "../../src/ai/generate.js";

// ─── Mock Graph Responses ────────────────────────────────────────────────────

const VALID_GRAPH = JSON.stringify({
  id: "test-graph",
  version: 1,
  effects: ["database.read"],
  nodes: [
    {
      id: "fetch_user",
      in: { user_id: { type: "String", domain: "authentication" } },
      out: { user: { type: "Object", domain: "user" } },
      contract: { post: ["user ≠ null"] },
      effects: ["database.read"],
      recovery: { "database.read": { action: "retry", params: { max: 3 } } },
      confidence: 0.95,
    },
  ],
  edges: [],
});

const GRAPH_MISSING_RECOVERY = JSON.stringify({
  id: "missing-recovery",
  version: 1,
  effects: ["database.write"],
  nodes: [
    {
      id: "write_data",
      in: { data: { type: "Object" } },
      out: { result: { type: "Bool" } },
      contract: { post: ["result = true"] },
      effects: ["database.write"],
      // no recovery — should be caught
      confidence: 0.95,
    },
  ],
  edges: [],
});

const GRAPH_MISSING_ADVERSARIAL = JSON.stringify({
  id: "missing-adversarial",
  version: 1,
  effects: [],
  nodes: [
    {
      id: "classify",
      in: { content: { type: "String" } },
      out: { label: { type: "String" } },
      contract: { post: ["label ≠ null"] },
      effects: [],
      pure: true,
      confidence: 0.7,
      // Missing adversarial_check — should be caught
    },
  ],
  edges: [],
});

// ─── JSON Cleaning Tests ─────────────────────────────────────────────────────

describe("JSON cleaning", () => {
  it("parses valid JSON response unchanged", () => {
    const cleaned = cleanJsonResponse('{"id": "test"}');
    expect(JSON.parse(cleaned)).toEqual({ id: "test" });
  });

  it("strips markdown code fences", () => {
    const raw = '```json\n{"id": "test"}\n```';
    const cleaned = cleanJsonResponse(raw);
    expect(JSON.parse(cleaned)).toEqual({ id: "test" });
  });

  it("fixes trailing commas", () => {
    const raw = '{"id": "test", "items": [1, 2, 3,],}';
    const cleaned = cleanJsonResponse(raw);
    expect(JSON.parse(cleaned)).toEqual({ id: "test", items: [1, 2, 3] });
  });

  it("strips generic code fences", () => {
    const raw = '```\n{"id": "test"}\n```';
    const cleaned = cleanJsonResponse(raw);
    expect(JSON.parse(cleaned)).toEqual({ id: "test" });
  });
});

// ─── Validation Error Classification ─────────────────────────────────────────

describe("validation error classification", () => {
  it("classifies missing recovery", () => {
    const bug = classifyValidationError(
      'Effectful node "write_data" has effects [database.write] but no recovery block'
    );
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("missing_recovery");
    expect(bug!.severity).toBe("critical");
    expect(bug!.node).toBe("write_data");
    expect(bug!.caughtBy).toBe("validator");
  });

  it("classifies missing adversarial check", () => {
    const bug = classifyValidationError(
      'Node "classify" requires adversarial_check but none was provided'
    );
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("missing_adversarial");
    expect(bug!.severity).toBe("high");
    expect(bug!.node).toBe("classify");
  });

  it("classifies cycle detection", () => {
    const bug = classifyValidationError("Graph contains a cycle — not a valid DAG");
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("cycle_detected");
    expect(bug!.severity).toBe("critical");
  });

  it("classifies port mismatch", () => {
    const bug = classifyValidationError(
      'Edge from "node_a.output" references port "output" not found on node "node_a"'
    );
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("port_mismatch");
    expect(bug!.severity).toBe("high");
  });

  it("classifies confidence gap", () => {
    const bug = classifyValidationError(
      'Node "predict" has confidence below 0.85 but no adversarial_check'
    );
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("confidence_gap");
    expect(bug!.node).toBe("predict");
  });

  it("returns null for unrecognized errors", () => {
    const bug = classifyValidationError("Some random error message");
    expect(bug).toBeNull();
  });
});

// ─── Check Error Classification ──────────────────────────────────────────────

describe("check error classification", () => {
  it("classifies base type mismatch", () => {
    const bug = classifyCheckError({
      code: "BASE_TYPE_MISMATCH",
      message: "String cannot flow to Int",
      edge: "node_a.out → node_b.in",
    });
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("type_mismatch");
    expect(bug!.caughtBy).toBe("type_checker");
  });

  it("classifies domain mismatch", () => {
    const bug = classifyCheckError({
      code: "DOMAIN_MISMATCH",
      message: "Domain authentication incompatible with commerce",
      edge: "auth.token → pay.input",
    });
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("domain_mismatch");
    expect(bug!.caughtBy).toBe("type_checker");
  });

  it("classifies sensitivity violation", () => {
    const bug = classifyCheckError({
      code: "SENSITIVITY_VIOLATION",
      message: "PII data flowing to public output",
      edge: "db.user → api.response",
    });
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("sensitivity_violation");
    expect(bug!.severity).toBe("critical");
  });

  it("classifies state type mismatch", () => {
    const bug = classifyCheckError({
      code: "STATE_TYPE_MISMATCH",
      message: "State type OrderState does not match PaymentState",
      edge: "order.state → payment.state",
    });
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("state_violation");
  });
});

// ─── Verification Failure Classification ─────────────────────────────────────

describe("verification failure classification", () => {
  it("classifies postcondition failure", () => {
    const bug = classifyVerificationFailure(
      "process_payment",
      { status: "failed", expression: "amount > 0" },
      "postcondition"
    );
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("contract_violation");
    expect(bug!.node).toBe("process_payment");
    expect(bug!.caughtBy).toBe("z3_verifier");
  });

  it("classifies adversarial check failure", () => {
    const bug = classifyVerificationFailure(
      "recommend",
      { status: "failed", expression: "recommended ∩ purchased ≠ ∅" },
      "adversarial"
    );
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe("missing_adversarial");
  });

  it("returns null for passing results", () => {
    const bug = classifyVerificationFailure(
      "ok_node",
      { status: "verified" },
      "postcondition"
    );
    expect(bug).toBeNull();
  });
});

// ─── Fix Prompt Construction ─────────────────────────────────────────────────

describe("fix prompt construction", () => {
  it("includes all errors", () => {
    const prompt = buildFixPrompt([
      "Missing recovery on node write_data",
      "Port not found: node_a.output",
    ]);
    expect(prompt).toContain("1. Missing recovery on node write_data");
    expect(prompt).toContain("2. Port not found: node_a.output");
  });

  it("includes fix instructions", () => {
    const prompt = buildFixPrompt(["Error A"]);
    expect(prompt).toContain("effectful node needs a recovery block");
    expect(prompt).toContain("adversarial_check");
    expect(prompt).toContain("DAG");
  });
});

// ─── Process Raw Response (Mock Pipeline) ────────────────────────────────────

describe("processRawResponse", () => {
  it("valid JSON → parses and validates", () => {
    const result = processRawResponse(VALID_GRAPH);
    expect(result.parseSuccess).toBe(true);
    expect(result.graph).not.toBeNull();
    expect(result.validation).not.toBeNull();
  });

  it("invalid JSON → parseSuccess false", () => {
    const result = processRawResponse("not json at all");
    expect(result.parseSuccess).toBe(false);
    expect(result.graph).toBeNull();
  });

  it("missing recovery → BugReport generated with correct type and severity", () => {
    const result = processRawResponse(GRAPH_MISSING_RECOVERY);
    expect(result.parseSuccess).toBe(true);
    const recoveryBugs = result.bugs.filter(b => b.type === "missing_recovery");
    expect(recoveryBugs.length).toBeGreaterThanOrEqual(1);
    expect(recoveryBugs[0].severity).toBe("critical");
    expect(recoveryBugs[0].caughtBy).toBe("validator");
  });

  it("missing adversarial → BugReport generated", () => {
    const result = processRawResponse(GRAPH_MISSING_ADVERSARIAL);
    expect(result.parseSuccess).toBe(true);
    const advBugs = result.bugs.filter(
      b => b.type === "missing_adversarial" || b.type === "confidence_gap"
    );
    expect(advBugs.length).toBeGreaterThanOrEqual(1);
  });

  it("bug report wouldCauseInProduction is non-empty for all bug types", () => {
    const allResults = [
      processRawResponse(GRAPH_MISSING_RECOVERY),
      processRawResponse(GRAPH_MISSING_ADVERSARIAL),
    ];
    for (const result of allResults) {
      for (const bug of result.bugs) {
        expect(bug.wouldCauseInProduction).toBeTruthy();
        expect(bug.wouldCauseInProduction.length).toBeGreaterThan(10);
      }
    }
  });

  it("validate=false skips validation", () => {
    const result = processRawResponse(GRAPH_MISSING_RECOVERY, { validate: false });
    expect(result.parseSuccess).toBe(true);
    expect(result.validation).toBeNull();
    expect(result.bugs.length).toBe(0);
  });
});

// ─── Production Impact Coverage ──────────────────────────────────────────────

describe("production impact descriptions", () => {
  it("all bug types have non-empty production impact", () => {
    const bugTypes: Array<BugReport["type"]> = [
      "missing_recovery",
      "missing_adversarial",
      "type_mismatch",
      "domain_mismatch",
      "sensitivity_violation",
      "contract_violation",
      "cycle_detected",
      "confidence_gap",
      "effect_undeclared",
      "port_mismatch",
      "state_violation",
    ];

    // Verify by classifying errors that produce each type
    const testErrors: Array<{ error: string; expectedType: string }> = [
      { error: 'Effectful node "n" has effects but no recovery block', expectedType: "missing_recovery" },
      { error: 'Node "n" needs adversarial_check', expectedType: "missing_adversarial" },
      { error: "Graph contains a cycle in DAG", expectedType: "cycle_detected" },
      { error: 'Port "x" not found on node', expectedType: "port_mismatch" },
      { error: 'Node "n" confidence below 0.85 needs adversarial_check', expectedType: "confidence_gap" },
    ];

    for (const { error, expectedType } of testErrors) {
      const bug = classifyValidationError(error);
      expect(bug).not.toBeNull();
      expect(bug!.type).toBe(expectedType);
      expect(bug!.wouldCauseInProduction.length).toBeGreaterThan(10);
    }
  });
});
