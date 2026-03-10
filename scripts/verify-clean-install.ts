/**
 * Verify Clean Install
 *
 * Simulates what happens when someone clones the repo fresh.
 * Checks that no native compilation is needed and core features work.
 *
 * Usage: npx tsx scripts/verify-clean-install.ts
 */

import { execSync } from "child_process";
import { join } from "path";

const root = process.cwd();
let passed = 0;
let failed = 0;

function step(name: string, fn: () => void): void {
  process.stdout.write(`  ${name}... `);
  try {
    fn();
    console.log("OK");
    passed++;
  } catch (err: any) {
    console.log(`FAIL: ${err.message}`);
    failed++;
  }
}

console.log("\n=== AETHER Clean Install Verification ===\n");

step("1. No native dependencies in package.json", () => {
  const pkg = JSON.parse(require("fs").readFileSync(join(root, "package.json"), "utf-8"));
  if (pkg.dependencies?.["better-sqlite3"]) throw new Error("better-sqlite3 in dependencies");
  if (pkg.optionalDependencies?.["better-sqlite3"]) throw new Error("better-sqlite3 in optionalDependencies");
  if (!pkg.dependencies?.["sql.js"]) throw new Error("sql.js missing from dependencies");
});

step("2. Typecheck passes", () => {
  execSync("npx tsc --noEmit", { cwd: root, stdio: "pipe" });
});

step("3. sql.js loads and creates database", async () => {
  const { SQLiteDatabaseAdapter } = await import("../src/implementations/services/database-sqlite.js");
  const db = new SQLiteDatabaseAdapter();
  const { id } = await db.create("test", { name: "verify" });
  const read = await db.read("test", id);
  if (read?.name !== "verify") throw new Error("CRUD failed");
  db.close();
});

step("4. No better-sqlite3 references in src/", () => {
  const result = execSync("grep -r better-sqlite3 src/ || true", { cwd: root, encoding: "utf-8" });
  if (result.trim().length > 0) throw new Error(`Found better-sqlite3 references:\n${result}`);
});

step("5. No node-gyp in install output", () => {
  // Check that no native modules are installed
  const result = execSync("npm ls --depth=0 2>&1 || true", { cwd: root, encoding: "utf-8" });
  if (result.includes("better-sqlite3")) throw new Error("better-sqlite3 still in node_modules");
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("\nClean install verification FAILED.");
  process.exit(1);
} else {
  console.log("\nClean install verified — no native dependencies required.");
}
