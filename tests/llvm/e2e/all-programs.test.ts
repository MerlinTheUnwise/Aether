/**
 * Compile all reference programs to binaries (toolchain-gated)
 * Tests only run when native toolchain is detected.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { join } from "path";
import { readdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { compileToBinary, detectToolchain, type ToolchainStatus } from "../../../src/compiler/llvm/pipeline.js";

const EXAMPLES = join(process.cwd(), "src", "ir", "examples");

let toolchain: ToolchainStatus;
let hasToolchain = false;

// Get all reference programs
const programs = readdirSync(EXAMPLES)
  .filter(f => f.endsWith(".json"))
  .map(f => f.replace(".json", ""));

beforeAll(async () => {
  toolchain = await detectToolchain();
  hasToolchain = toolchain.llc.available && toolchain.clang.available && toolchain.runtime.available;
});

describe("All Programs — Pipeline to IR", () => {
  for (const prog of programs) {
    it(`${prog} → pipeline stages succeed up to IR`, async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), `aether-allprog-`));
      try {
        const result = await compileToBinary({
          input: join(EXAMPLES, `${prog}.json`),
          outputDir: tmpDir,
          target: "llvm-ir",
        });

        expect(result.stages.validate.success).toBe(true);
        expect(result.stages.typeCheck.success).toBe(true);
        expect(result.stages.verify.success).toBe(true);
        expect(result.stages.emitIR.success).toBe(true);
        expect(result.stages.emitIR.lines).toBeGreaterThan(0);
        expect(result.success).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }
});

describe("All Programs — Full Compile (toolchain-gated)", () => {
  for (const prog of programs) {
    it(`${prog} → compiles to binary and exits without crash`, async () => {
      if (!hasToolchain) {
        console.log("Skipping: native toolchain not available");
        return;
      }

      const tmpDir = mkdtempSync(join(tmpdir(), `aether-allprog-`));
      try {
        const result = await compileToBinary({
          input: join(EXAMPLES, `${prog}.json`),
          outputDir: tmpDir,
          target: "binary",
        });

        expect(result.success).toBe(true);
        expect(result.binarySize).toBeGreaterThan(0);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  }
});
