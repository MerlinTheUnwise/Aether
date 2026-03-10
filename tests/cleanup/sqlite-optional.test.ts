/**
 * Tests for SQLite dependency — verifies sql.js (pure WASM) is used instead of native deps.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("SQLite dependency (sql.js)", () => {
  it("database-sqlite.ts exports SQLiteDatabaseAdapter class", async () => {
    const mod = await import("../../src/implementations/services/database-sqlite.js");
    expect(typeof mod.SQLiteDatabaseAdapter).toBe("function");
  });

  it("SQLiteDatabaseAdapter works without native compilation", async () => {
    const { SQLiteDatabaseAdapter } = await import("../../src/implementations/services/database-sqlite.js");
    const db = new SQLiteDatabaseAdapter();
    const { id } = await db.create("test", { name: "works" });
    const read = await db.read("test", id);
    expect(read!.name).toBe("works");
    db.close();
  });

  it("no better-sqlite3 imports anywhere in src/", () => {
    const srcDir = join(process.cwd(), "src");
    const files = collectTsFiles(srcDir);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const relative = file.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "");
      expect(
        content.includes("better-sqlite3"),
        `${relative} should not reference better-sqlite3`
      ).toBe(false);
    }
  });

  it("sql.js is in dependencies (not optionalDependencies)", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    expect(pkg.dependencies?.["sql.js"]).toBeDefined();
    expect(pkg.dependencies?.["better-sqlite3"]).toBeUndefined();
    expect(pkg.optionalDependencies?.["better-sqlite3"]).toBeUndefined();
  });
});
