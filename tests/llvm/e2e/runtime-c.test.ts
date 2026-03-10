/**
 * C Runtime Library Tests
 * Compiles and runs test_runtime.c to verify the C runtime library.
 * Gated on clang availability.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { join } from "path";
import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { detectToolchain, type ToolchainStatus } from "../../../src/compiler/llvm/pipeline.js";
import { checkClang } from "../../../src/compiler/llvm/runtime/build-runtime.js";

let hasClang = false;

beforeAll(async () => {
  const toolchain = await detectToolchain();
  hasClang = toolchain.clang.available;
});

function getAugmentedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  if (process.platform === "win32") {
    env.PATH = ["C:\\Program Files\\LLVM\\bin", "C:\\Program Files (x86)\\LLVM\\bin", env.PATH || ""].join(";");
  }
  return env;
}

describe("C Runtime Library", () => {
  it("test_runtime.c compiles and all assertions pass", () => {
    if (!hasClang) return;

    const runtimeDir = join(process.cwd(), "src", "compiler", "llvm", "runtime");
    const tmpDir = mkdtempSync(join(tmpdir(), "aether-runtime-"));
    const ext = process.platform === "win32" ? ".exe" : "";
    const outPath = join(tmpDir, `test_runtime${ext}`);

    try {
      // Compile
      execSync(
        `clang "${join(runtimeDir, "test_runtime.c")}" "${join(runtimeDir, "aether_runtime.c")}" -I "${runtimeDir}" -D_CRT_SECURE_NO_WARNINGS -o "${outPath}"`,
        { encoding: "utf-8", timeout: 30000, env: getAugmentedEnv() },
      );

      // Run
      const output = execSync(`"${outPath}"`, {
        encoding: "utf-8",
        timeout: 10000,
        env: getAugmentedEnv(),
      });

      expect(output).toContain("All C runtime tests passed");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("checkClang detects clang", () => {
    const result = checkClang();
    if (hasClang) {
      expect(result.found).toBe(true);
      expect(result.version).toBeTruthy();
    }
  });
});
