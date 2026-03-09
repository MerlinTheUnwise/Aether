/**
 * Feedback Quality Tests
 * Validates that the generate command gives actionable error messages
 * for common AI generation mistakes.
 */

import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { cmdGenerate } from "../../src/cli.js";

const tmpDir = join(__dirname, "../../.test-tmp");

function writeTempIR(name: string, content: string): string {
  mkdirSync(tmpDir, { recursive: true });
  const p = join(tmpDir, `${name}.json`);
  writeFileSync(p, content, "utf-8");
  return p;
}

// Suppress console output during tests
const originalLog = console.log;
const originalError = console.error;

function suppressConsole() {
  console.log = () => {};
  console.error = () => {};
}

function restoreConsole() {
  console.log = originalLog;
  console.error = originalError;
}

describe("Feedback Quality", () => {
  afterAll(() => {
    restoreConsole();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("1. Missing recovery on effectful node", async () => {
    const ir = JSON.stringify({
      id: "test_missing_recovery",
      version: 1,
      effects: ["database.write"],
      nodes: [{
        id: "write_data",
        in: { data: { type: "String" } },
        out: { success: { type: "Bool" } },
        contract: { post: ["success == true"] },
        effects: ["database.write"]
      }],
      edges: []
    });

    const path = writeTempIR("missing-recovery", ir);
    suppressConsole();
    const result = await cmdGenerate(path);
    restoreConsole();

    expect(result.accepted).toBe(false);
    const allErrors = result.steps.flatMap(s => s.errors);
    const hasRecoveryError = allErrors.some(e =>
      e.includes("recovery") && e.includes("effects")
    );
    expect(hasRecoveryError).toBe(true);
  });

  it("2. Missing adversarial_check on low-confidence node", async () => {
    const ir = JSON.stringify({
      id: "test_missing_adversarial",
      version: 1,
      effects: [],
      nodes: [{
        id: "classify",
        in: { data: { type: "String" } },
        out: { label: { type: "String" } },
        contract: { post: ["label.length > 0"] },
        confidence: 0.70,
        pure: true,
        effects: []
      }],
      edges: []
    });

    const path = writeTempIR("missing-adversarial", ir);
    suppressConsole();
    const result = await cmdGenerate(path);
    restoreConsole();

    expect(result.accepted).toBe(false);
    const allErrors = result.steps.flatMap(s => s.errors);
    const hasAdversarialError = allErrors.some(e =>
      e.includes("adversarial_check") || e.includes("confidence")
    );
    expect(hasAdversarialError).toBe(true);
  });

  it("3. Edge referencing nonexistent port", async () => {
    const ir = JSON.stringify({
      id: "test_bad_port",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: { post: ["y.length > 0"] },
          pure: true,
          effects: []
        },
        {
          id: "node_b",
          in: { z: { type: "String" } },
          out: { w: { type: "String" } },
          contract: { post: ["w.length > 0"] },
          pure: true,
          effects: []
        }
      ],
      edges: [
        { from: "node_a.nonexistent", to: "node_b.z" }
      ]
    });

    const path = writeTempIR("bad-port", ir);
    suppressConsole();
    const result = await cmdGenerate(path);
    restoreConsole();

    expect(result.accepted).toBe(false);
    const allErrors = result.steps.flatMap(s => s.errors);
    const hasPortError = allErrors.some(e =>
      e.includes("nonexistent") || e.includes("port")
    );
    expect(hasPortError).toBe(true);
  });

  it("4. Trailing comma in JSON", async () => {
    const badJson = `{
      "id": "test_trailing_comma",
      "version": 1,
      "effects": [],
      "nodes": [
        {
          "id": "node_a",
          "in": {},
          "out": { "y": { "type": "String" } },
          "contract": { "post": ["y.length > 0"] },
          "effects": [],
        }
      ],
      "edges": []
    }`;

    const path = writeTempIR("trailing-comma", badJson);
    suppressConsole();
    const result = await cmdGenerate(path);
    restoreConsole();

    expect(result.accepted).toBe(false);
    const parseStep = result.steps.find(s => s.name === "JSON Parse");
    expect(parseStep).toBeDefined();
    expect(parseStep!.passed).toBe(false);
    const hasTrailingCommaHint = parseStep!.errors.some(e =>
      e.includes("trailing comma") || e.includes("parse error")
    );
    expect(hasTrailingCommaHint).toBe(true);
  });

  it("5. Cycle in edge graph", async () => {
    const ir = JSON.stringify({
      id: "test_cycle",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: { x: { type: "String" } },
          out: { y: { type: "String" } },
          contract: { post: ["y.length > 0"] },
          pure: true,
          effects: []
        },
        {
          id: "node_b",
          in: { y: { type: "String" } },
          out: { x: { type: "String" } },
          contract: { post: ["x.length > 0"] },
          pure: true,
          effects: []
        }
      ],
      edges: [
        { from: "node_a.y", to: "node_b.y" },
        { from: "node_b.x", to: "node_a.x" }
      ]
    });

    const path = writeTempIR("cycle", ir);
    suppressConsole();
    const result = await cmdGenerate(path);
    restoreConsole();

    expect(result.accepted).toBe(false);
    const allErrors = result.steps.flatMap(s => s.errors);
    const hasCycleError = allErrors.some(e =>
      e.toLowerCase().includes("cycle") || e.toLowerCase().includes("dag")
    );
    expect(hasCycleError).toBe(true);
  });

  it("6. Domain mismatch on an edge", async () => {
    const ir = JSON.stringify({
      id: "test_domain_mismatch",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: {},
          out: { result: { type: "String", domain: "authentication" } },
          contract: { post: ["result.length > 0"] },
          pure: true,
          effects: []
        },
        {
          id: "node_b",
          in: { data: { type: "String", domain: "commerce" } },
          out: { output: { type: "String" } },
          contract: { post: ["output.length > 0"] },
          pure: true,
          effects: []
        }
      ],
      edges: [
        { from: "node_a.result", to: "node_b.data" }
      ]
    });

    const path = writeTempIR("domain-mismatch", ir);
    suppressConsole();
    const result = await cmdGenerate(path);
    restoreConsole();

    // Graph is structurally valid but has type errors
    const typeStep = result.steps.find(s => s.name === "Types");
    expect(typeStep).toBeDefined();
    expect(typeStep!.passed).toBe(false);
    const hasDomainError = typeStep!.errors.some(e =>
      e.includes("domain") && e.includes("mismatch")
    );
    expect(hasDomainError).toBe(true);
  });

  it("7. PII sensitivity violation", async () => {
    const ir = JSON.stringify({
      id: "test_pii_violation",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "node_a",
          in: {},
          out: { email: { type: "String", sensitivity: "pii" } },
          contract: { post: ["email.length > 0"] },
          pure: true,
          effects: []
        },
        {
          id: "node_b",
          in: { data: { type: "String", sensitivity: "public" } },
          out: { output: { type: "String" } },
          contract: { post: ["output.length > 0"] },
          pure: true,
          effects: []
        }
      ],
      edges: [
        { from: "node_a.email", to: "node_b.data" }
      ]
    });

    const path = writeTempIR("pii-violation", ir);
    suppressConsole();
    const result = await cmdGenerate(path);
    restoreConsole();

    const typeStep = result.steps.find(s => s.name === "Types");
    expect(typeStep).toBeDefined();
    expect(typeStep!.passed).toBe(false);
    const hasSensitivityError = typeStep!.errors.some(e =>
      e.includes("sensitivity") || e.includes("pii")
    );
    expect(hasSensitivityError).toBe(true);
  });
});
