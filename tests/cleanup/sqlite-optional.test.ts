/**
 * Tests for SQLite optional dependency handling.
 */

import { describe, it, expect } from "vitest";

describe("SQLite optional dependency", () => {
  it("database-sqlite.ts exports isSQLiteAvailable flag", async () => {
    const mod = await import("../../src/implementations/services/database-sqlite.js");
    expect(typeof mod.isSQLiteAvailable).toBe("boolean");
  });

  it("SQLiteDatabaseAdapter is a class regardless of availability", async () => {
    const mod = await import("../../src/implementations/services/database-sqlite.js");
    expect(typeof mod.SQLiteDatabaseAdapter).toBe("function");
  });

  it("all SQLite test files are properly gated with skipIf", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");

    const testFiles = [
      "tests/services/database-sqlite.test.ts",
      "tests/services/adapter-parity.test.ts",
      "tests/services/real-execution.test.ts",
    ];

    for (const file of testFiles) {
      const content = readFileSync(join(process.cwd(), file), "utf-8");
      expect(
        content.includes("isSQLiteAvailable"),
        `${file} should import and use isSQLiteAvailable for gating`
      ).toBe(true);
      expect(
        content.includes("skipIf"),
        `${file} should use skipIf to gate SQLite tests`
      ).toBe(true);
    }
  });

  it("better-sqlite3 is in optionalDependencies, not dependencies", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));

    expect(pkg.optionalDependencies?.["better-sqlite3"]).toBeDefined();
    expect(pkg.dependencies?.["better-sqlite3"]).toBeUndefined();
  });
});
