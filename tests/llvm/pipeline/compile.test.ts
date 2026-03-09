/**
 * Tests for the full native compilation pipeline
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { compileToBinary, detectToolchain } from "../../../src/compiler/llvm/pipeline.js";

const EXAMPLES = join(process.cwd(), "src", "ir", "examples");

describe("Compilation Pipeline", () => {
  it("full pipeline on user-registration → all stages succeed up to emitIR", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
    try {
      const result = await compileToBinary({
        input: join(EXAMPLES, "user-registration.json"),
        outputDir: tmpDir,
        target: "llvm-ir",
      });

      expect(result.stages.validate.success).toBe(true);
      expect(result.stages.validate.duration_ms).toBeGreaterThanOrEqual(0);
      expect(result.stages.typeCheck.success).toBe(true);
      expect(result.stages.verify.success).toBe(true);
      expect(result.stages.verify.percentage).toBeGreaterThanOrEqual(0);
      expect(result.stages.emitIR.success).toBe(true);
      expect(result.stages.emitIR.lines).toBeGreaterThan(0);
      expect(result.stages.emitIR.outputPath).toContain(".ll");
      expect(result.success).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pipeline with invalid graph → aborts at validate stage", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
    const invalidPath = join(tmpDir, "invalid.json");
    writeFileSync(invalidPath, JSON.stringify({ id: "test", version: 1 }), "utf-8");

    try {
      const result = await compileToBinary({
        input: invalidPath,
        outputDir: tmpDir,
        target: "llvm-ir",
      });

      expect(result.success).toBe(false);
      expect(result.stages.validate.success).toBe(false);
      expect(result.stages.validate.errors).toBeDefined();
      expect(result.stages.validate.errors!.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pipeline with type errors → aborts at typeCheck stage", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
    // Create a graph with valid schema but type mismatch
    const badGraph = {
      id: "type-error-test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "a",
          in: {},
          out: { result: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
        {
          id: "b",
          in: { value: { type: "String" } },
          out: {},
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [{ from: "a.result", to: "b.value" }],
    };
    const badPath = join(tmpDir, "type-error.json");
    writeFileSync(badPath, JSON.stringify(badGraph), "utf-8");

    try {
      const result = await compileToBinary({
        input: badPath,
        outputDir: tmpDir,
        target: "llvm-ir",
      });

      expect(result.success).toBe(false);
      expect(result.stages.validate.success).toBe(true);
      expect(result.stages.typeCheck.success).toBe(false);
      expect(result.stages.typeCheck.errors).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pipeline produces correct output path", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
    try {
      const result = await compileToBinary({
        input: join(EXAMPLES, "user-registration.json"),
        outputDir: tmpDir,
        outputName: "custom-name",
        target: "llvm-ir",
      });

      expect(result.success).toBe(true);
      expect(result.outputPath).toContain("custom-name.ll");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pipeline with --target llvm-ir → stops after IR generation", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
    try {
      const result = await compileToBinary({
        input: join(EXAMPLES, "user-registration.json"),
        outputDir: tmpDir,
        target: "llvm-ir",
      });

      expect(result.success).toBe(true);
      expect(result.stages.compileObj).toBeUndefined();
      expect(result.stages.link).toBeUndefined();
      expect(result.outputPath).toContain(".ll");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pipeline with --target object → stops after llc (if available)", async () => {
    const toolchain = await detectToolchain();
    if (!toolchain.llc.available) {
      // If llc not available, pipeline fails gracefully
      const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
      try {
        const result = await compileToBinary({
          input: join(EXAMPLES, "user-registration.json"),
          outputDir: tmpDir,
          target: "object",
        });
        // Should fail because llc is missing, but IR should still be generated
        expect(result.stages.emitIR.success).toBe(true);
        expect(result.errors.some(e => e.includes("llc"))).toBe(true);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
    try {
      const result = await compileToBinary({
        input: join(EXAMPLES, "user-registration.json"),
        outputDir: tmpDir,
        target: "object",
      });

      expect(result.stages.compileObj).toBeDefined();
      expect(result.stages.compileObj!.success).toBe(true);
      expect(result.stages.link).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("pipeline verbose mode → logs each stage", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-pipeline-"));
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => { logs.push(args.join(" ")); };

    try {
      await compileToBinary({
        input: join(EXAMPLES, "user-registration.json"),
        outputDir: tmpDir,
        target: "llvm-ir",
        verbose: true,
      });

      expect(logs.some(l => l.includes("Stage 1"))).toBe(true);
      expect(logs.some(l => l.includes("Stage 2"))).toBe(true);
      expect(logs.some(l => l.includes("Stage 3"))).toBe(true);
      expect(logs.some(l => l.includes("Stage 4"))).toBe(true);
    } finally {
      console.log = origLog;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
