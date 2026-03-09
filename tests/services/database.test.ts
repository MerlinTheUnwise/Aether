import { describe, it, expect, beforeEach } from "vitest";
import { AetherDatabase } from "../../src/implementations/services/database.js";

describe("AetherDatabase", () => {
  let db: AetherDatabase;

  beforeEach(() => {
    db = new AetherDatabase();
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────

  it("create → read back → matches", async () => {
    const { id, record } = await db.create("users", { email: "a@b.com", name: "Alice" });
    expect(id).toBeTruthy();
    expect(record.email).toBe("a@b.com");

    const read = await db.read("users", id);
    expect(read).toEqual(record);
  });

  it("query with filter → returns matching records only", async () => {
    await db.create("users", { email: "a@b.com", role: "admin" });
    await db.create("users", { email: "c@d.com", role: "user" });
    await db.create("users", { email: "e@f.com", role: "admin" });

    const admins = await db.query("users", { field: "role", operator: "=", value: "admin" });
    expect(admins).toHaveLength(2);
    expect(admins.every((r) => r.role === "admin")).toBe(true);
  });

  it("update record → read shows updated fields", async () => {
    const { id } = await db.create("users", { email: "a@b.com", name: "Alice" });
    const updated = await db.update("users", id, { name: "Bob" });
    expect(updated.name).toBe("Bob");
    expect(updated.email).toBe("a@b.com");

    const read = await db.read("users", id);
    expect(read!.name).toBe("Bob");
  });

  it("delete record → read returns null", async () => {
    const { id } = await db.create("users", { email: "a@b.com" });
    const deleted = await db.delete("users", id);
    expect(deleted).toBe(true);

    const read = await db.read("users", id);
    expect(read).toBeNull();
  });

  it("exists → true for existing, false for deleted", async () => {
    await db.create("users", { id: "u1", email: "a@b.com" });
    expect(await db.exists("users", { field: "id", operator: "=", value: "u1" })).toBe(true);

    await db.delete("users", "u1");
    expect(await db.exists("users", { field: "id", operator: "=", value: "u1" })).toBe(false);
  });

  // ── Bulk ──────────────────────────────────────────────────────────────────

  it("bulkCreate → all records created", async () => {
    const result = await db.bulkCreate("users", [
      { email: "a@b.com" },
      { email: "c@d.com" },
      { email: "e@f.com" },
    ]);
    expect(result.created).toBe(3);
    expect(result.ids).toHaveLength(3);

    const count = await db.count("users");
    expect(count).toBe(3);
  });

  it("count → correct count", async () => {
    await db.bulkCreate("items", [{ name: "a" }, { name: "b" }, { name: "c" }]);
    expect(await db.count("items")).toBe(3);
    expect(await db.count("items", { field: "name", operator: "=", value: "a" })).toBe(1);
  });

  // ── Seed & Snapshot ───────────────────────────────────────────────────────

  it("seed data → queryable immediately", async () => {
    db.seed("products", [
      { id: "p1", name: "Widget", price: 10 },
      { id: "p2", name: "Gadget", price: 20 },
    ]);

    const p1 = await db.read("products", "p1");
    expect(p1!.name).toBe("Widget");

    const expensive = await db.query("products", { field: "price", operator: ">", value: 15 });
    expect(expensive).toHaveLength(1);
    expect(expensive[0].name).toBe("Gadget");
  });

  it("snapshot/restore → state preserved", async () => {
    await db.create("users", { id: "u1", email: "a@b.com" });
    const snap = db.snapshot();

    await db.create("users", { id: "u2", email: "c@d.com" });
    expect(await db.count("users")).toBe(2);

    db.restore(snap);
    expect(await db.count("users")).toBe(1);
    expect(await db.read("users", "u1")).toBeTruthy();
    expect(await db.read("users", "u2")).toBeNull();
  });

  // ── Query operators ───────────────────────────────────────────────────────

  it("query operators work correctly", async () => {
    db.seed("items", [
      { id: "1", val: 10, name: "alpha" },
      { id: "2", val: 20, name: "beta" },
      { id: "3", val: 30, name: "gamma" },
    ]);

    expect(await db.query("items", { field: "val", operator: "!=", value: 20 })).toHaveLength(2);
    expect(await db.query("items", { field: "val", operator: ">=", value: 20 })).toHaveLength(2);
    expect(await db.query("items", { field: "val", operator: "<=", value: 20 })).toHaveLength(2);
    expect(await db.query("items", { field: "val", operator: "<", value: 20 })).toHaveLength(1);
    expect(await db.query("items", { field: "val", operator: "in", value: [10, 30] })).toHaveLength(2);
    expect(await db.query("items", { field: "val", operator: "not_in", value: [10] })).toHaveLength(2);
    expect(await db.query("items", { field: "name", operator: "contains", value: "eta" })).toHaveLength(1);
  });

  // ── Failure Injection ─────────────────────────────────────────────────────

  it("failure injection: timeout → throws with 'timeout' type", async () => {
    db.injectFailure({ type: "timeout", probability: 1.0 });
    await expect(db.read("users", "u1")).rejects.toThrow(/timeout/i);
  });

  it("failure injection: constraint_violation → throws appropriately", async () => {
    const limited = new AetherDatabase({ max_records_per_table: 1 });
    await limited.create("t", { name: "first" });
    await expect(limited.create("t", { name: "second" })).rejects.toThrow(/capacity/i);
  });

  it("failure injection on specific operation → only that operation fails", async () => {
    db.injectFailure({ type: "timeout", probability: 1.0, on_operation: "read" });

    // Create should work
    const { id } = await db.create("users", { email: "a@b.com" });
    expect(id).toBeTruthy();

    // Read should fail
    await expect(db.read("users", id)).rejects.toThrow(/timeout/i);
  });

  it("clearFailures removes all failures", async () => {
    db.injectFailure({ type: "timeout", probability: 1.0 });
    db.clearFailures();
    // Should not throw
    const result = await db.read("users", "nope");
    expect(result).toBeNull();
  });

  it("update on non-existent record throws not_found", async () => {
    await expect(db.update("users", "nonexistent", { name: "X" })).rejects.toThrow(/not found/i);
  });

  it("read from non-existent table returns null", async () => {
    expect(await db.read("nonexistent", "id")).toBeNull();
  });

  it("query on non-existent table returns empty", async () => {
    expect(await db.query("nonexistent", { field: "x", operator: "=", value: 1 })).toEqual([]);
  });

  it("bulkQuery returns matching records", async () => {
    await db.create("users", { id: "u1", name: "A" });
    await db.create("users", { id: "u2", name: "B" });
    await db.create("users", { id: "u3", name: "C" });

    const results = await db.bulkQuery("users", ["u1", "u3", "u999"]);
    expect(results).toHaveLength(2);
  });

  it("clear removes all data", async () => {
    await db.create("users", { name: "A" });
    await db.create("items", { name: "B" });
    db.clear();
    expect(await db.count("users")).toBe(0);
    expect(await db.count("items")).toBe(0);
  });
});
