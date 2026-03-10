/**
 * Tests for SQLite Database Adapter
 */

import { describe, it, expect, afterEach } from "vitest";
import { SQLiteDatabaseAdapter } from "../../src/implementations/services/database-sqlite.js";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";

describe("SQLiteDatabaseAdapter", () => {
  const testDbs: SQLiteDatabaseAdapter[] = [];

  function createDb(path?: string): SQLiteDatabaseAdapter {
    const db = new SQLiteDatabaseAdapter(path);
    testDbs.push(db);
    return db;
  }

  afterEach(() => {
    for (const db of testDbs) {
      try { db.close(); } catch {}
    }
    testDbs.length = 0;
  });

  it("create record → read back → matches", async () => {
    const db = createDb();
    const { id, record } = await db.create("users", { name: "Alice", age: 30 });
    expect(id).toBeTruthy();
    expect(record.name).toBe("Alice");

    const read = await db.read("users", id);
    expect(read).not.toBeNull();
    expect(read!.name).toBe("Alice");
    expect(read!.age).toBe(30);
  });

  it("query with filter → correct results", async () => {
    const db = createDb();
    await db.create("users", { id: "u1", name: "Alice", age: 30 });
    await db.create("users", { id: "u2", name: "Bob", age: 25 });
    await db.create("users", { id: "u3", name: "Carol", age: 35 });

    const result = await db.query("users", { field: "age", operator: ">", value: 28 });
    expect(result.length).toBe(2);
    expect(result.map(r => r.name).sort()).toEqual(["Alice", "Carol"]);
  });

  it("update → read shows changes", async () => {
    const db = createDb();
    await db.create("users", { id: "u1", name: "Alice", age: 30 });
    await db.update("users", "u1", { age: 31 });

    const read = await db.read("users", "u1");
    expect(read!.age).toBe(31);
    expect(read!.name).toBe("Alice");
  });

  it("delete → read returns null", async () => {
    const db = createDb();
    await db.create("users", { id: "u1", name: "Alice" });
    const deleted = await db.delete("users", "u1");
    expect(deleted).toBe(true);

    const read = await db.read("users", "u1");
    expect(read).toBeNull();
  });

  it("seed data → queryable", async () => {
    const db = createDb();
    db.seed("products", [
      { id: "p1", name: "Widget", price: 10 },
      { id: "p2", name: "Gadget", price: 25 },
      { id: "p3", name: "Gizmo", price: 15 },
    ]);

    const expensive = await db.query("products", { field: "price", operator: ">=", value: 15 });
    expect(expensive.length).toBe(2);
  });

  it("count → correct", async () => {
    const db = createDb();
    db.seed("items", [
      { id: "i1", category: "A" },
      { id: "i2", category: "B" },
      { id: "i3", category: "A" },
    ]);

    expect(await db.count("items")).toBe(3);
    expect(await db.count("items", { field: "category", operator: "=", value: "A" })).toBe(2);
  });

  it("all 9 query operators work correctly", async () => {
    const db = createDb();
    db.seed("data", [
      { id: "d1", name: "alpha", value: 10 },
      { id: "d2", name: "beta", value: 20 },
      { id: "d3", name: "gamma", value: 30 },
      { id: "d4", name: "delta", value: 20 },
    ]);

    // =
    expect((await db.query("data", { field: "value", operator: "=", value: 20 })).length).toBe(2);
    // !=
    expect((await db.query("data", { field: "value", operator: "!=", value: 20 })).length).toBe(2);
    // >
    expect((await db.query("data", { field: "value", operator: ">", value: 15 })).length).toBe(3);
    // <
    expect((await db.query("data", { field: "value", operator: "<", value: 25 })).length).toBe(3);
    // >=
    expect((await db.query("data", { field: "value", operator: ">=", value: 20 })).length).toBe(3);
    // <=
    expect((await db.query("data", { field: "value", operator: "<=", value: 20 })).length).toBe(3);
    // in
    expect((await db.query("data", { field: "name", operator: "in", value: ["alpha", "gamma"] })).length).toBe(2);
    // not_in
    expect((await db.query("data", { field: "name", operator: "not_in", value: ["alpha", "gamma"] })).length).toBe(2);
    // contains
    expect((await db.query("data", { field: "name", operator: "contains", value: "eta" })).length).toBe(1);
  });

  it("constraint violation (duplicate ID) → throws real error", async () => {
    const db = createDb();
    await db.create("users", { id: "u1", name: "Alice" });

    await expect(db.create("users", { id: "u1", name: "Bob" }))
      .rejects.toThrow("Duplicate ID");
  });

  it("close and reopen → data persists (file-based)", async () => {
    const testDir = join(process.cwd(), "test-output");
    mkdirSync(testDir, { recursive: true });
    const dbFile = join(testDir, "persist-test.db");

    // Clean up from previous test runs
    try { unlinkSync(dbFile); } catch {}

    const db1 = new SQLiteDatabaseAdapter(dbFile);
    await db1.create("users", { id: "u1", name: "Alice", age: 30 });
    db1.close();

    const db2 = createDb(dbFile);
    const read = await db2.read("users", "u1");
    expect(read).not.toBeNull();
    expect(read!.name).toBe("Alice");
    expect(read!.age).toBe(30);

    // Cleanup
    db2.close();
    testDbs.length = 0;
    try { unlinkSync(dbFile); } catch {}
  });

  it("exists → returns boolean correctly", async () => {
    const db = createDb();
    db.seed("items", [{ id: "i1", status: "active" }, { id: "i2", status: "inactive" }]);

    expect(await db.exists("items", { field: "status", operator: "=", value: "active" })).toBe(true);
    expect(await db.exists("items", { field: "status", operator: "=", value: "deleted" })).toBe(false);
  });

  it("read from nonexistent table → null", async () => {
    const db = createDb();
    const result = await db.read("nonexistent", "xyz");
    expect(result).toBeNull();
  });

  it("query nonexistent table → empty array", async () => {
    const db = createDb();
    const result = await db.query("nonexistent", { field: "x", operator: "=", value: 1 });
    expect(result).toEqual([]);
  });

  it("delete from nonexistent table → false", async () => {
    const db = createDb();
    const result = await db.delete("nonexistent", "xyz");
    expect(result).toBe(false);
  });

  it("update nonexistent record → throws", async () => {
    const db = createDb();
    db.seed("users", [{ id: "u1", name: "Alice" }]);
    await expect(db.update("users", "u99", { name: "Nobody" }))
      .rejects.toThrow("not found");
  });

  it("stores complex objects as JSON", async () => {
    const db = createDb();
    await db.create("records", {
      id: "r1",
      tags: ["a", "b", "c"],
      meta: { nested: true, count: 5 },
    });

    const read = await db.read("records", "r1");
    expect(read!.tags).toEqual(["a", "b", "c"]);
    expect(read!.meta).toEqual({ nested: true, count: 5 });
  });

  it("getPath returns the database path", () => {
    const db = createDb();
    expect(db.getPath()).toBe(":memory:");
  });
});
