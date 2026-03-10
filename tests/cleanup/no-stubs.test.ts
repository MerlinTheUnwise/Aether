/**
 * Verify no stubs remain in the codebase.
 * Every exported function must be a real implementation.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

const srcDir = join(process.cwd(), "src");

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      results.push(...collectTsFiles(fullPath));
    } else if (extname(entry.name) === ".ts") {
      results.push(fullPath);
    }
  }
  return results;
}

describe("No Stubs", () => {
  const files = collectTsFiles(srcDir);

  it("no source file contains 'Not implemented'", () => {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/Not implemented/gi);
      expect(matches, `Found "Not implemented" in ${file}`).toBeNull();
    }
  });

  it("no source file throws a stub error", () => {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/throw new Error.*stub/gi);
      expect(matches, `Found stub throw in ${file}`).toBeNull();
    }
  });

  it("no source file throws a session placeholder error", () => {
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const matches = content.match(/throw new Error.*Session \d/gi);
      expect(matches, `Found session placeholder throw in ${file}`).toBeNull();
    }
  });

  it("recovery.ts exports real functions, not stubs", async () => {
    const recovery = await import("../../src/runtime/recovery.js");
    expect(typeof recovery.executeRecovery).toBe("function");
    expect(typeof recovery.retryWithBackoff).toBe("function");
    expect(typeof recovery.matchesCondition).toBe("function");
    expect(typeof recovery.EscalationError).toBe("function");
  });
});
