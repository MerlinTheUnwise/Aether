/**
 * Clean Install Tests
 *
 * Verifies that the project works without any native compilation.
 * sql.js (WASM) replaces better-sqlite3 (native C++).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

describe("Clean Install — No Native Dependencies", () => {
  it("sql.js imports and creates a database", async () => {
    const initSqlJs = (await import("sql.js")).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run("CREATE TABLE test (id TEXT PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO test VALUES (?, ?)", ["1", "hello"]);
    const result = db.exec("SELECT * FROM test");
    expect(result[0].values[0][1]).toBe("hello");
    db.close();
  });

  it("SQLiteDatabaseAdapter CRUD works", async () => {
    const { SQLiteDatabaseAdapter } = await import("../../src/implementations/services/database-sqlite.js");
    const db = new SQLiteDatabaseAdapter();

    // Create
    const { id } = await db.create("users", { name: "Alice", age: 30 });
    expect(id).toBeTruthy();

    // Read
    const read = await db.read("users", id);
    expect(read!.name).toBe("Alice");

    // Update
    await db.update("users", id, { age: 31 });
    const updated = await db.read("users", id);
    expect(updated!.age).toBe(31);

    // Delete
    const deleted = await db.delete("users", id);
    expect(deleted).toBe(true);

    db.close();
  });

  it("no require('better-sqlite3') calls anywhere in src/", () => {
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

    const srcDir = join(process.cwd(), "src");
    const files = collectTsFiles(srcDir);
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const relative = file.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "");
      expect(
        content.includes("better-sqlite3"),
        `${relative} still references better-sqlite3`
      ).toBe(false);
    }
  });

  it("package.json has sql.js in dependencies, no better-sqlite3", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));

    expect(pkg.dependencies["sql.js"]).toBeDefined();
    expect(pkg.dependencies["better-sqlite3"]).toBeUndefined();
    expect(pkg.optionalDependencies?.["better-sqlite3"]).toBeUndefined();
    expect(pkg.optionalDependencies?.["@types/better-sqlite3"]).toBeUndefined();
  });
});
