/**
 * Real Execution Tests
 *
 * Execute AETHER programs with real SQLite database and real filesystem,
 * then verify data actually persists.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import { SQLiteDatabaseAdapter, isSQLiteAvailable } from "../../src/implementations/services/database-sqlite.js";
import { RealFilesystemAdapter } from "../../src/implementations/services/filesystem-real.js";
import { readFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

describe.skipIf(!isSQLiteAvailable)("Real Execution — SQLite", () => {
  const testDir = join(process.cwd(), "test-output", "real-exec-" + process.pid);

  beforeEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it("execute user-registration with real SQLite → user actually in database", async () => {
    const dbFile = join(testDir, "users.db");

    const graph = JSON.parse(
      readFileSync(join(process.cwd(), "src/ir/examples/user-registration.json"), "utf-8")
    );

    const ctx = await createExecutionContext(graph, {
      email: "alice@example.com",
      password: "SecurePass123!",
      name: "Alice Smith",
    }, {
      serviceConfig: {
        mode: "real",
        real: {
          database: { path: dbFile },
        },
      },
      contractMode: "skip",
    });

    const result = await execute(ctx);
    expect(result.nodesExecuted).toBeGreaterThan(0);

    // Verify data persisted in the SQLite file
    const verifyDb = new SQLiteDatabaseAdapter(dbFile);
    try {
      const userCount = await verifyDb.count("users");
      expect(userCount).toBeGreaterThanOrEqual(1);
    } finally {
      verifyDb.close();
    }
  });

  it("execute sales-analytics with real filesystem → report file on disk", async () => {
    const fsDir = join(testDir, "fs");
    mkdirSync(fsDir, { recursive: true });

    const graph = JSON.parse(
      readFileSync(join(process.cwd(), "src/ir/examples/real-world/sales-analytics.json"), "utf-8")
    );

    // Write CSV data to real filesystem
    const realFs = new RealFilesystemAdapter(fsDir);
    await realFs.writeCSV("sales.csv", [
      { product: "Widget", amount: 100, region: "North", date: "2024-01-15" },
      { product: "Gadget", amount: 250, region: "South", date: "2024-01-20" },
      { product: "Widget", amount: 150, region: "North", date: "2024-02-10" },
      { product: "Gizmo", amount: 75, region: "East", date: "2024-02-28" },
      { product: "Gadget", amount: 300, region: "South", date: "2024-03-05" },
    ]);

    const ctx = await createExecutionContext(graph, { file_path: "sales.csv" }, {
      serviceConfig: {
        mode: "real",
        real: {
          database: { path: join(testDir, "sales.db") },
          filesystem: { basePath: fsDir },
        },
      },
      contractMode: "skip",
    });

    const result = await execute(ctx);
    expect(result.nodesExecuted).toBeGreaterThan(0);

    // Check that output files were created on actual disk
    const files = await realFs.listFiles("reports/");
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  it("real mode with SQLite → data readable with separate connection", async () => {
    const dbFile = join(testDir, "separate-conn.db");

    const db1 = new SQLiteDatabaseAdapter(dbFile);
    await db1.create("orders", { id: "o1", customer: "Alice", total: 100 });
    await db1.create("orders", { id: "o2", customer: "Bob", total: 250 });
    await db1.create("orders", { id: "o3", customer: "Carol", total: 175 });
    db1.close();

    // Read with completely separate connection
    const db2 = new SQLiteDatabaseAdapter(dbFile);
    try {
      const count = await db2.count("orders");
      expect(count).toBe(3);

      const carol = await db2.read("orders", "o3");
      expect(carol).not.toBeNull();
      expect(carol!.customer).toBe("Carol");
      expect(carol!.total).toBe(175);

      const highValue = await db2.query("orders", { field: "total", operator: ">=", value: 175 });
      expect(highValue.length).toBe(2);
    } finally {
      db2.close();
    }
  });
});

describe("Real Execution — Container Mode Switch", () => {
  it.skipIf(!isSQLiteAvailable)("ServiceContainer in real mode creates SQLite adapter", async () => {
    const { ServiceContainer } = await import("../../src/implementations/services/container.js");

    const container = ServiceContainer.createDefault({
      mode: "real",
      database: {
        seed: { items: [{ id: "i1", name: "Test" }] },
      },
      real: {
        database: { path: ":memory:" },
      },
    });

    const db = container.get<SQLiteDatabaseAdapter>("database");
    const item = await db.read("items", "i1");
    expect(item).not.toBeNull();
    expect(item!.name).toBe("Test");

    db.close();
  });

  it("ServiceContainer in mock mode (default) creates AetherDatabase", async () => {
    const { ServiceContainer } = await import("../../src/implementations/services/container.js");

    const container = ServiceContainer.createDefault({
      database: {
        seed: { items: [{ id: "i1", name: "Test" }] },
      },
    });

    const db = container.get<any>("database");
    const item = await db.read("items", "i1");
    expect(item).not.toBeNull();
    expect(item!.name).toBe("Test");
  });
});
