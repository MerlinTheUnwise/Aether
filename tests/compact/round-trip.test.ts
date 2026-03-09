/**
 * Tests for AETHER Compact Form round-trip
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { emitCompact, parseCompact } from "../../src/compiler/compact.js";
import { validateGraph } from "../../src/ir/validator.js";

const EXAMPLES_DIR = join(import.meta.dirname, "../../src/ir/examples");

describe("Compact Form Round-Trip", () => {
  const exampleFiles = readdirSync(EXAMPLES_DIR).filter(f => f.endsWith(".json"));

  for (const file of exampleFiles) {
    describe(`Reference: ${file.replace(".json", "")}`, () => {
      const filePath = join(EXAMPLES_DIR, file);
      const original = JSON.parse(readFileSync(filePath, "utf-8"));

      it("emits valid compact form", () => {
        const compact = emitCompact(original);
        expect(compact.length).toBeGreaterThan(0);
        expect(compact).toContain(`G:${original.id}`);
        // Should be substantially shorter than JSON
        const jsonLen = JSON.stringify(original).length;
        const compactLen = compact.length;
        // Compact should be at least 30% shorter
        expect(compactLen).toBeLessThan(jsonLen * 0.85);
      });

      it("round-trips back to valid graph", () => {
        const compact = emitCompact(original);
        const roundTripped = parseCompact(compact);

        // Validate the round-tripped graph
        const valResult = validateGraph(roundTripped);
        expect(valResult.valid).toBe(true);
      });

      it("preserves node count and edge count", () => {
        const compact = emitCompact(original);
        const roundTripped = parseCompact(compact);

        expect(roundTripped.nodes.length).toBe(original.nodes.length);
        expect(roundTripped.edges.length).toBe(original.edges.length);
      });

      it("preserves node IDs", () => {
        const compact = emitCompact(original);
        const roundTripped = parseCompact(compact);

        const originalIds = original.nodes.map((n: any) => n.id).sort();
        const roundTrippedIds = roundTripped.nodes.map((n: any) => n.id).sort();
        expect(roundTrippedIds).toEqual(originalIds);
      });

      it("preserves graph ID and version", () => {
        const compact = emitCompact(original);
        const roundTripped = parseCompact(compact);

        expect(roundTripped.id).toBe(original.id);
        expect(roundTripped.version).toBe(original.version);
      });

      it("preserves effects", () => {
        const compact = emitCompact(original);
        const roundTripped = parseCompact(compact);

        expect(roundTripped.effects.sort()).toEqual(original.effects.sort());
      });

      it("preserves edge connections", () => {
        const compact = emitCompact(original);
        const roundTripped = parseCompact(compact);

        const originalEdges = original.edges.map((e: any) => `${e.from}->${e.to}`).sort();
        const roundTrippedEdges = roundTripped.edges.map((e: any) => `${e.from}->${e.to}`).sort();
        expect(roundTrippedEdges).toEqual(originalEdges);
      });

      it("preserves port types for each node", () => {
        const compact = emitCompact(original);
        const roundTripped = parseCompact(compact);

        for (const origNode of original.nodes) {
          const rtNode = roundTripped.nodes.find((n: any) => n.id === origNode.id) as any;
          expect(rtNode).toBeDefined();

          // Check in port types
          for (const [portName, portType] of Object.entries(origNode.in as Record<string, any>)) {
            expect(rtNode.in[portName]).toBeDefined();
            expect(rtNode.in[portName].type).toBe(portType.type);
          }

          // Check out port types
          for (const [portName, portType] of Object.entries(origNode.out as Record<string, any>)) {
            expect(rtNode.out[portName]).toBeDefined();
            expect(rtNode.out[portName].type).toBe(portType.type);
          }
        }
      });
    });
  }
});
