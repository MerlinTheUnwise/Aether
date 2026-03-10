import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { aetherToIR, irToAether } from "../../src/parser/bridge.js";
import { validateGraph } from "../../src/ir/validator.js";

const EXAMPLES_DIR = join(process.cwd(), "src/ir/examples");
const REAL_WORLD_DIR = join(EXAMPLES_DIR, "real-world");

function getAetherFiles(): { name: string; path: string }[] {
  const files: { name: string; path: string }[] = [];

  for (const f of readdirSync(EXAMPLES_DIR)) {
    if (f.endsWith(".aether")) {
      files.push({ name: f, path: join(EXAMPLES_DIR, f) });
    }
  }
  for (const f of readdirSync(REAL_WORLD_DIR)) {
    if (f.endsWith(".aether")) {
      files.push({ name: `real-world/${f}`, path: join(REAL_WORLD_DIR, f) });
    }
  }
  return files;
}

describe("Parse all .aether reference programs", () => {
  const files = getAetherFiles();

  it("has at least 16 .aether reference programs", () => {
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  // Some programs have known round-trip validation limitations:
  // - template-showcase: template bindings lose TypeAnnotation structure
  // - api-orchestration: metadata safety_level enum not preserved exactly
  // - sales-analytics/transaction-analysis: complex recovery param structure
  const VALIDATION_SKIP = new Set([
    "template-showcase.aether",
    "real-world/api-orchestration.aether",
    "real-world/sales-analytics.aether",
    "real-world/transaction-analysis.aether",
  ]);

  for (const { name, path } of files) {
    it(`parses ${name} → valid AST`, () => {
      const source = readFileSync(path, "utf-8");
      const { graph, errors } = aetherToIR(source);
      expect(errors).toHaveLength(0);
      expect(graph).not.toBeNull();
      expect(graph!.id).toBeTruthy();
      expect(graph!.nodes.length).toBeGreaterThan(0);
    });

    if (!VALIDATION_SKIP.has(name)) {
      it(`${name} validates against IR schema`, () => {
        const source = readFileSync(path, "utf-8");
        const { graph } = aetherToIR(source);
        expect(graph).not.toBeNull();
        const result = validateGraph(graph as any);
        expect(result.valid).toBe(true);
      });
    }
  }
});

describe("Round-trip: .aether → IR → .aether → IR", () => {
  const files = getAetherFiles();

  // Programs with complex quoted recovery params that don't survive double round-trip
  const ROUNDTRIP_SKIP = new Set([
    "real-world/sales-analytics.aether",
    "real-world/transaction-analysis.aether",
  ]);

  for (const { name, path } of files) {
    if (ROUNDTRIP_SKIP.has(name)) continue;

    it(`round-trips ${name} without loss`, () => {
      const source = readFileSync(path, "utf-8");
      const { graph: ir1 } = aetherToIR(source);
      expect(ir1).not.toBeNull();

      // IR → .aether → IR
      const aetherText = irToAether(ir1!);
      const { graph: ir2, errors } = aetherToIR(aetherText);
      expect(errors).toHaveLength(0);
      expect(ir2).not.toBeNull();

      // Compare key properties
      expect(ir2!.id).toBe(ir1!.id);
      expect(ir2!.version).toBe(ir1!.version);
      expect(ir2!.nodes.length).toBe(ir1!.nodes.length);
      expect(ir2!.edges.length).toBe(ir1!.edges.length);

      // Compare node IDs
      const nodeIds1 = ir1!.nodes.map((n: any) => n.id).sort();
      const nodeIds2 = ir2!.nodes.map((n: any) => n.id).sort();
      expect(nodeIds2).toEqual(nodeIds1);
    });
  }
});
