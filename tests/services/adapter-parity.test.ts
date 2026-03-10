/**
 * Adapter Parity Tests
 *
 * Run the same operations against both mock and real adapters.
 * Results must be identical — proves real adapters are drop-in replacements.
 */

import { describe, it, expect, afterEach } from "vitest";
import { AetherDatabase } from "../../src/implementations/services/database.js";
import { SQLiteDatabaseAdapter, isSQLiteAvailable } from "../../src/implementations/services/database-sqlite.js";
import { AetherFileSystem } from "../../src/implementations/services/filesystem.js";
import { RealFilesystemAdapter } from "../../src/implementations/services/filesystem-real.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

describe.skipIf(!isSQLiteAvailable)("Adapter Parity — Database", () => {
  const sqliteDbs: SQLiteDatabaseAdapter[] = [];

  afterEach(() => {
    for (const db of sqliteDbs) {
      try { db.close(); } catch {}
    }
    sqliteDbs.length = 0;
  });

  function createMock(): AetherDatabase {
    return new AetherDatabase();
  }

  function createReal(): SQLiteDatabaseAdapter {
    const db = new SQLiteDatabaseAdapter();
    sqliteDbs.push(db);
    return db;
  }

  it("create + read: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    const mockResult = await mock.create("users", { id: "u1", name: "Alice", age: 30 });
    const realResult = await real.create("users", { id: "u1", name: "Alice", age: 30 });

    expect(mockResult.id).toBe(realResult.id);
    expect(mockResult.record.name).toBe(realResult.record.name);

    const mockRead = await mock.read("users", "u1");
    const realRead = await real.read("users", "u1");

    expect(mockRead!.name).toBe(realRead!.name);
    expect(mockRead!.age).toBe(realRead!.age);
    expect(mockRead!.id).toBe(realRead!.id);
  });

  it("query: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    const records = [
      { id: "u1", name: "Alice", status: "active" },
      { id: "u2", name: "Bob", status: "inactive" },
      { id: "u3", name: "Carol", status: "active" },
    ];

    for (const rec of records) {
      await mock.create("users", rec);
      await real.create("users", rec);
    }

    const mockResult = await mock.query("users", { field: "status", operator: "=", value: "active" });
    const realResult = await real.query("users", { field: "status", operator: "=", value: "active" });

    expect(mockResult.length).toBe(realResult.length);
    expect(mockResult.map(r => r.id).sort()).toEqual(realResult.map(r => r.id).sort());
  });

  it("seed + query: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    const seedData = [
      { id: "p1", name: "Widget", price: 10 },
      { id: "p2", name: "Gadget", price: 25 },
      { id: "p3", name: "Gizmo", price: 15 },
    ];

    mock.seed("products", seedData);
    real.seed("products", seedData);

    const mockResult = await mock.query("products", { field: "price", operator: ">=", value: 15 });
    const realResult = await real.query("products", { field: "price", operator: ">=", value: 15 });

    expect(mockResult.length).toBe(realResult.length);
    expect(mockResult.map(r => r.id).sort()).toEqual(realResult.map(r => r.id).sort());
  });

  it("count: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    const seedData = [
      { id: "i1", type: "A" },
      { id: "i2", type: "B" },
      { id: "i3", type: "A" },
    ];

    mock.seed("items", seedData);
    real.seed("items", seedData);

    expect(await mock.count("items")).toBe(await real.count("items"));
    expect(await mock.count("items", { field: "type", operator: "=", value: "A" }))
      .toBe(await real.count("items", { field: "type", operator: "=", value: "A" }));
  });

  it("update + read: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    await mock.create("users", { id: "u1", name: "Alice", age: 30 });
    await real.create("users", { id: "u1", name: "Alice", age: 30 });

    await mock.update("users", "u1", { age: 31 });
    await real.update("users", "u1", { age: 31 });

    const mockRead = await mock.read("users", "u1");
    const realRead = await real.read("users", "u1");

    expect(mockRead!.age).toBe(realRead!.age);
    expect(mockRead!.name).toBe(realRead!.name);
  });

  it("delete: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    await mock.create("users", { id: "u1", name: "Alice" });
    await real.create("users", { id: "u1", name: "Alice" });

    expect(await mock.delete("users", "u1")).toBe(await real.delete("users", "u1"));
    expect(await mock.read("users", "u1")).toBe(await real.read("users", "u1")); // both null
  });

  it("exists: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    mock.seed("items", [{ id: "i1", status: "active" }]);
    real.seed("items", [{ id: "i1", status: "active" }]);

    const filter = { field: "status", operator: "=" as const, value: "active" };
    expect(await mock.exists("items", filter)).toBe(await real.exists("items", filter));

    const filter2 = { field: "status", operator: "=" as const, value: "deleted" };
    expect(await mock.exists("items", filter2)).toBe(await real.exists("items", filter2));
  });
});

describe("Adapter Parity — Filesystem", () => {
  const testDir = join(process.cwd(), "test-output", "parity-fs");

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  function createMock(files?: Record<string, string>): AetherFileSystem {
    return new AetherFileSystem(files);
  }

  function createReal(): RealFilesystemAdapter {
    mkdirSync(testDir, { recursive: true });
    return new RealFilesystemAdapter(testDir);
  }

  it("write + read: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    await mock.writeFile("test.txt", "Hello, World!");
    await real.writeFile("test.txt", "Hello, World!");

    expect(await mock.readFile("test.txt")).toBe(await real.readFile("test.txt"));
  });

  it("writeCSV + readCSV: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    const data = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];

    await mock.writeCSV("data.csv", data);
    await real.writeCSV("data.csv", data);

    const mockResult = await mock.readCSV("data.csv");
    const realResult = await real.readCSV("data.csv");

    expect(mockResult).toEqual(realResult);
  });

  it("exists: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    await mock.writeFile("exists.txt", "yes");
    await real.writeFile("exists.txt", "yes");

    expect(await mock.exists("exists.txt")).toBe(await real.exists("exists.txt"));
    expect(await mock.exists("nope.txt")).toBe(await real.exists("nope.txt"));
  });

  it("delete: mock result === real result", async () => {
    const mock = createMock();
    const real = createReal();

    await mock.writeFile("del.txt", "bye");
    await real.writeFile("del.txt", "bye");

    expect(await mock.deleteFile("del.txt")).toBe(await real.deleteFile("del.txt"));
    expect(await mock.exists("del.txt")).toBe(await real.exists("del.txt"));
  });
});
