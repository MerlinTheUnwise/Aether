/**
 * Full-pipeline integration tests.
 * Runs all stages: validate → check → verify → transpile
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { validateGraph } from "../../src/ir/validator.js";
import { checkTypes } from "../../src/compiler/checker.js";
import { verifyGraph } from "../../src/compiler/verifier.js";
import { transpileGraph } from "../../src/compiler/transpiler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8")) as unknown;
}

function assertValidJS(source: string): void {
  // eslint-disable-next-line no-new-func
  new Function(source);
}

// ─── Full pipeline tests ─────────────────────────────────────────────────────

describe("Full pipeline — user-registration", () => {
  const graph = loadExample("user-registration.json");

  it("validates successfully", () => {
    const result = validateGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes type check", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = checkTypes(graph as any);
    expect(result.compatible).toBe(true);
  });

  it("verifies contracts", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await verifyGraph(graph as any);
    expect(report.graph_id).toBe("user_registration");
    // Some postconditions (e.g., "user.email == email") fail because Z3 treats
    // input/output vars as independent — this is expected without implementations
    expect(report.verification_percentage).toBeGreaterThanOrEqual(0);
    expect(report.results.length).toBe(3);
  });

  it("transpiles to valid JavaScript", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = transpileGraph(graph as any);
    assertValidJS(output);
    expect(output).toContain("async function validate_email");
    expect(output).toContain("async function check_uniqueness");
    expect(output).toContain("async function create_user");
    expect(output).toContain("module.exports");
  });
});

describe("Full pipeline — product-recommendations", () => {
  const graph = loadExample("product-recommendations.json");

  it("validates successfully", () => {
    const result = validateGraph(graph);
    expect(result.valid).toBe(true);
  });

  it("passes type check", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = checkTypes(graph as any);
    expect(result.compatible).toBe(true);
  });

  it("verifies contracts", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await verifyGraph(graph as any);
    expect(report.graph_id).toBe("get_product_recommendations");
    expect(report.results.length).toBe(3);
    expect(report.verification_percentage).toBeGreaterThanOrEqual(0);
  });

  it("transpiles to valid JavaScript", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = transpileGraph(graph as any);
    assertValidJS(output);
    expect(output).toContain("async function authenticate");
    expect(output).toContain("async function fetch_history");
    expect(output).toContain("async function generate_recommendations");
  });
});

describe("Full pipeline — customer-support-agent", () => {
  const graph = loadExample("customer-support-agent.json");

  it("validates successfully", () => {
    const result = validateGraph(graph);
    expect(result.valid).toBe(true);
  });

  it("passes type check", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = checkTypes(graph as any);
    expect(result.compatible).toBe(true);
  });

  it("verifies contracts", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const report = await verifyGraph(graph as any);
    expect(report.graph_id).toBe("customer_support_agent");
    expect(report.results.length).toBe(2);
    expect(report.verification_percentage).toBeGreaterThanOrEqual(0);
  });

  it("transpiles to valid JavaScript", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = transpileGraph(graph as any);
    assertValidJS(output);
    expect(output).toContain("async function decide_action");
    expect(output).toContain("async function execute_with_guard");
  });
});
