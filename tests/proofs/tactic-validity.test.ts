import { describe, it, expect } from "vitest";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync } from "fs";
import { generateProofExport } from "../../src/proofs/generate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadGraph(name: string): any {
  return JSON.parse(readFileSync(join(examplesDir, `${name}.json`), "utf-8"));
}

function getAllGraphFiles(): string[] {
  const files: string[] = [];
  const entries = readdirSync(examplesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entry.name.replace(".json", ""));
    }
    if (entry.isDirectory()) {
      const subDir = join(examplesDir, entry.name);
      const subEntries = readdirSync(subDir);
      for (const sub of subEntries) {
        if (sub.endsWith(".json")) {
          files.push(join(entry.name, sub.replace(".json", "")));
        }
      }
    }
  }
  return files;
}

describe("Tactic Validity", () => {
  const graphFiles = getAllGraphFiles();

  describe("generated tactic sequences are syntactically valid Lean 4", () => {
    // Valid Lean 4 tactic keywords
    const validTactics = [
      "omega", "tauto", "decide", "exact", "assumption", "simp",
      "intro", "cases", "constructor", "rfl", "trivial", "sorry",
      "apply", "subst", "norm_num",
    ];

    for (const name of graphFiles) {
      it(`${name} — all tactics are valid Lean 4`, () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);

        // Extract tactic blocks: "by <tactic>" patterns
        const tacticBlocks = result.source.match(/\bby\s+(.+?)(?:\n|$)/g) ?? [];

        for (const block of tacticBlocks) {
          const tacticText = block.replace(/^by\s+/, "").trim();
          // Each tactic should start with a known keyword
          const firstWord = tacticText.split(/[\s;(]/)[0].replace(/^·\s*/, "");
          if (firstWord === "sorry") continue; // sorry is valid
          expect(
            validTactics.some(t => firstWord === t),
            `Unknown tactic "${firstWord}" in block: ${block.trim()}`,
          ).toBe(true);
        }
      });
    }
  });

  describe("no empty tactic blocks", () => {
    for (const name of graphFiles) {
      it(`${name} — no empty tactic blocks`, () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);

        // "by" should always be followed by content
        const emptyBy = result.source.match(/\bby\s*\n\s*\n/g);
        expect(emptyBy).toBeNull();
      });
    }
  });

  describe("no duplicate imports", () => {
    for (const name of graphFiles) {
      it(`${name} — no duplicate import lines`, () => {
        const graph = loadGraph(name);
        const result = generateProofExport(graph);

        const importLines = result.source
          .split("\n")
          .filter(line => line.startsWith("import "));

        const uniqueImports = new Set(importLines);
        expect(importLines.length).toBe(uniqueImports.size);
      });
    }
  });

  describe("only used imports are included", () => {
    it("omega tactic triggers Mathlib.Tactic.Omega import", () => {
      // rate-limiter has arithmetic contracts that should trigger omega
      const graph = loadGraph("rate-limiter");
      const result = generateProofExport(graph);

      const hasOmega = result.source.includes("omega") &&
        !result.source.match(/\bomega\b/)?.every(m => m === "omega");

      // If omega tactic is used, import should be present
      if (result.source.match(/\bby\s+omega\b/)) {
        expect(result.source).toContain("import Mathlib.Tactic.Omega");
      }
    });

    it("tauto tactic triggers Mathlib.Tactic.Tauto import", () => {
      // content-moderation has conjunction contracts
      const graph = loadGraph("content-moderation-agent");
      const result = generateProofExport(graph);

      if (result.source.match(/\bby\s+tauto\b/)) {
        expect(result.source).toContain("import Mathlib.Tactic.Tauto");
      }
    });
  });
});
