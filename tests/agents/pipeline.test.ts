/**
 * Agent Pipeline Tests
 * Verifies multi-agent-marketplace.json passes full pipeline
 * and exported integrated graph passes standalone validation.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { simulateWithStubs } from "../../src/agents/simulator.js";
import { validateGraph } from "../../src/ir/validator.js";
import { checkTypes } from "../../src/compiler/checker.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

describe("Agent Pipeline", () => {
  it("multi-agent-marketplace.json passes full pipeline", async () => {
    const graph = loadExample("multi-agent-marketplace.json");

    // 1. Validate
    const valResult = validateGraph(graph);
    expect(valResult.valid).toBe(true);

    // 2. Type check
    const typeResult = checkTypes(graph as any);
    expect(typeResult.compatible).toBe(true);

    // 3. Collaborate
    const { session, report } = await simulateWithStubs(graph);
    expect(report.overall).toBe("integrated");
    expect(report.verification_percentage).toBe(100);

    // 4. Export
    const exported = session.exportGraph();
    expect(exported.nodes.length).toBe(graph.nodes.length);
    expect(exported.edges.length).toBeGreaterThan(0);
  });

  it("exported integrated graph passes standalone validation", async () => {
    const graph = loadExample("multi-agent-marketplace.json");
    const { session, report } = await simulateWithStubs(graph);

    expect(report.overall).toBe("integrated");

    const exported = session.exportGraph();

    // Exported graph should pass validation (without scope info it's a flat graph)
    const valResult = validateGraph(exported);
    expect(valResult.valid).toBe(true);
  });

  it("scoped-ecommerce exported graph passes validation", async () => {
    const graph = loadExample("scoped-ecommerce.json");
    const { session, report } = await simulateWithStubs(graph);

    expect(report.overall).toBe("integrated");

    const exported = session.exportGraph();
    const valResult = validateGraph(exported);
    expect(valResult.valid).toBe(true);
  });

  it("multi-scope-order exported graph passes validation", async () => {
    const graph = loadExample("multi-scope-order.json");
    const { session, report } = await simulateWithStubs(graph);

    expect(report.overall).toBe("integrated");

    const exported = session.exportGraph();
    const valResult = validateGraph(exported);
    expect(valResult.valid).toBe(true);
  });

  it("marketplace has supervised node and adversarial checks", () => {
    const graph = loadExample("multi-agent-marketplace.json");

    // At least one supervised node
    const supervised = graph.nodes.filter(
      n => !("hole" in n && (n as any).hole === true) && (n as any).supervised
    );
    expect(supervised.length).toBeGreaterThanOrEqual(1);

    // At least one node with adversarial_check
    const adversarial = graph.nodes.filter(
      n => !("hole" in n && (n as any).hole === true) && (n as any).adversarial_check
    );
    expect(adversarial.length).toBeGreaterThanOrEqual(1);
  });

  it("marketplace has 4 scopes and 12+ nodes", () => {
    const graph = loadExample("multi-agent-marketplace.json");
    expect(graph.scopes!.length).toBe(4);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(12);
  });
});
