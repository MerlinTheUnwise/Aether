/**
 * Tests for toolchain detection
 */

import { describe, it, expect } from "vitest";
import { detectToolchain } from "../../../src/compiler/llvm/pipeline.js";

describe("Toolchain Detection", () => {
  it("detectToolchain → returns status for each tool", async () => {
    const status = await detectToolchain();

    expect(status).toHaveProperty("llc");
    expect(status).toHaveProperty("clang");
    expect(status).toHaveProperty("runtime");

    expect(typeof status.llc.available).toBe("boolean");
    expect(typeof status.clang.available).toBe("boolean");
    expect(typeof status.runtime.available).toBe("boolean");
  });

  it("missing tool → available: false (not an error)", async () => {
    const status = await detectToolchain();

    // Whether tools are present or not, the function should not throw
    // and should return a valid status object
    if (!status.llc.available) {
      expect(status.llc.version).toBeUndefined();
    }
    if (!status.clang.available) {
      expect(status.clang.version).toBeUndefined();
    }
  });

  it("version parsing works for known LLVM version formats", async () => {
    const status = await detectToolchain();

    if (status.llc.available && status.llc.version) {
      // Version should match X.Y.Z format
      expect(status.llc.version).toMatch(/^\d+\.\d+\.\d+$/);
    }

    if (status.clang.available && status.clang.version) {
      expect(status.clang.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("runtime detection checks for libaether_runtime.a", async () => {
    const status = await detectToolchain();

    if (status.runtime.available) {
      expect(status.runtime.path).toBeDefined();
      expect(status.runtime.path).toContain("libaether_runtime");
    }
  });
});
