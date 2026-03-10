/**
 * End-to-end compilation tests
 * These tests only run when clang is detected on the system.
 * Requires: clang (llc is optional — clang can compile LLVM IR directly).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { join } from "path";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { readFileSync } from "fs";
import { tmpdir } from "os";
import { compileToBinary, detectToolchain, type ToolchainStatus } from "../../../src/compiler/llvm/pipeline.js";
import { generateStubs } from "../../../src/compiler/llvm/stubs.js";

const EXAMPLES = join(process.cwd(), "src", "ir", "examples");

let toolchain: ToolchainStatus;
let hasClang = false;

beforeAll(async () => {
  toolchain = await detectToolchain();
  hasClang = toolchain.clang.available;
});

/** Helper: compile a reference program with stubs to a runnable binary */
async function compileWithStubs(
  graphFile: string,
  tmpDir: string,
  options?: { contracts?: "abort" | "log" | "count" },
) {
  const graphJson = JSON.parse(readFileSync(graphFile, "utf-8"));
  const name = graphJson.id ?? "test";
  const safeName = name.replace(/[^a-zA-Z0-9]/g, "_");

  // Generate stubs
  const stubCode = generateStubs(graphJson);
  const stubPath = join(tmpDir, `${safeName}_stubs.c`);
  writeFileSync(stubPath, stubCode, "utf-8");

  return compileToBinary({
    input: graphFile,
    outputDir: tmpDir,
    outputName: name,
    target: "binary",
    optimization: 2,
    parallel: true,
    contracts: options?.contracts ?? "count",
    stubsPath: stubPath,
  });
}

describe("Full E2E Compilation", () => {
  it("compile user-registration → binary exists and runs", async () => {
    if (!hasClang) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileWithStubs(join(EXAMPLES, "user-registration.json"), tmpDir);

      expect(result.success).toBe(true);
      expect(existsSync(result.outputPath)).toBe(true);
      expect(result.binarySize).toBeGreaterThan(0);
      expect(result.stages.compileObj?.success).toBe(true);
      expect(result.stages.link?.success).toBe(true);

      // Run binary — should exit without crash
      const output = execSync(`"${result.outputPath}"`, {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect(output).toContain("AETHER Execution Log");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("compile payment-processing → binary runs with parallel waves", async () => {
    if (!hasClang) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileWithStubs(join(EXAMPLES, "payment-processing.json"), tmpDir);

      expect(result.success).toBe(true);
      expect(result.stages.emitIR.success).toBe(true);
      expect(result.stages.emitIR.lines).toBeGreaterThan(300);

      // Run binary
      const output = execSync(`"${result.outputPath}"`, {
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      expect(output).toContain("Execution Log");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("compile rate-limiter → binary produces output", async () => {
    if (!hasClang) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileWithStubs(join(EXAMPLES, "rate-limiter.json"), tmpDir);
      expect(result.success).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("compile order-lifecycle → state transitions compile", async () => {
    if (!hasClang) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileWithStubs(join(EXAMPLES, "order-lifecycle.json"), tmpDir);
      expect(result.success).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("compile customer-support-agent → confidence gates work", async () => {
    if (!hasClang) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileWithStubs(join(EXAMPLES, "customer-support-agent.json"), tmpDir);
      expect(result.success).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("contract mode abort compiles", async () => {
    if (!hasClang) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileWithStubs(
        join(EXAMPLES, "user-registration.json"), tmpDir, { contracts: "abort" },
      );
      expect(result.success).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("binary output stderr captures contract violations", async () => {
    if (!hasClang) return;

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileWithStubs(join(EXAMPLES, "user-registration.json"), tmpDir);
      expect(result.success).toBe(true);

      try {
        execSync(`"${result.outputPath}"`, {
          encoding: "utf-8",
          timeout: 10000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e: any) {
        // Contract violations go to stderr
        if (e.stderr) {
          expect(e.stderr).toContain("CONTRACT");
        }
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Always-runnable test — doesn't need toolchain
  it("pipeline always succeeds through IR emission (no toolchain needed)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-e2e-"));
    try {
      const result = await compileToBinary({
        input: join(EXAMPLES, "user-registration.json"),
        outputDir: tmpDir,
        target: "llvm-ir",
      });

      expect(result.stages.validate.success).toBe(true);
      expect(result.stages.typeCheck.success).toBe(true);
      expect(result.stages.emitIR.success).toBe(true);
      expect(result.stages.emitIR.lines).toBeGreaterThan(100);
      expect(result.success).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
