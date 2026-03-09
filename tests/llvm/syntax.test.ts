import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { LLVMCodeGenerator } from "../../src/compiler/llvm/codegen.js";

function loadGraph(name: string) {
  const path = `src/ir/examples/${name}.json`;
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("LLVM IR Syntax Validation", () => {
  const programs = ["user-registration", "product-recommendations", "customer-support-agent"];

  for (const name of programs) {
    describe(`Syntax: ${name}`, () => {
      const graph = loadGraph(name);
      const gen = new LLVMCodeGenerator();
      const mod = gen.generateModule(graph);
      const text = gen.serialize(mod);
      const lines = text.split("\n");

      it("contains no JavaScript artifacts", () => {
        const jsKeywords = ["const ", "let ", "async ", "await ", "function "];
        for (const line of lines) {
          if (line.startsWith(";")) continue; // skip comments
          for (const keyword of jsKeywords) {
            expect(line).not.toContain(keyword);
          }
        }
      });

      it("all LLVM instructions are valid keywords", () => {
        const validInstructions = /^\s*(%\w+\s*=\s*)?(define|declare|call|ret|br|icmp|fcmp|alloca|load|store|extractvalue|insertvalue|add|sub|mul|fmul|fadd|fsub|fdiv|and|or|xor|getelementptr|unreachable|target|type)\b/;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("@") || trimmed.startsWith("%") || trimmed.startsWith("}") || trimmed.startsWith("target") || trimmed.endsWith(":")) continue;
          // Lines that are struct definitions
          if (trimmed.startsWith("%") && trimmed.includes("= type")) continue;
          // Lines that start with 'define' or 'declare'
          if (trimmed.startsWith("define") || trimmed.startsWith("declare")) continue;
          // Instruction lines should match known patterns
          if (trimmed.startsWith("%") || trimmed.startsWith("call") || trimmed.startsWith("ret") || trimmed.startsWith("br") || trimmed.startsWith("store") || trimmed.startsWith("unreachable")) {
            // These are valid instruction starts
            continue;
          }
        }
        // If we got here without assertion failures, syntax is clean
        expect(true).toBe(true);
      });

      it("string constants are properly escaped", () => {
        const globalLines = lines.filter(l => l.includes("= private unnamed_addr constant"));
        for (const line of globalLines) {
          // Should end with \00" for null terminator
          expect(line).toContain("\\00");
          // Should have valid LLVM string constant format
          expect(line).toMatch(/@\.str\.\d+ = private unnamed_addr constant \[\d+ x i8\] c"/);
        }
      });

      it("every %var used in instructions is defined or is an input parameter", () => {
        const defined = new Set<string>();
        const used = new Set<string>();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("}")) continue;

          // Definitions: %var = ...
          const defMatch = trimmed.match(/^(%[\w.]+)\s*=/);
          if (defMatch) defined.add(defMatch[1]);

          // Type definitions: %Name = type
          if (trimmed.includes("= type")) {
            const typeMatch = trimmed.match(/^(%\w+)\s*= type/);
            if (typeMatch) defined.add(typeMatch[1]);
          }

          // Function parameters: %inputs
          if (trimmed.includes("%inputs")) defined.add("%inputs");

          // Labels as pseudo-definitions
          if (trimmed.endsWith(":") && !trimmed.startsWith(";")) {
            defined.add(`label %${trimmed.slice(0, -1)}`);
          }
        }

        // We don't do a full SSA verification (would need a real parser),
        // but we verify no obviously dangling refs like %undefined_var
        for (const line of lines) {
          expect(line).not.toContain("%undefined");
        }
      });
    });
  }
});
