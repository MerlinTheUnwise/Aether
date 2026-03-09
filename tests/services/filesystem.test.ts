import { describe, it, expect, beforeEach } from "vitest";
import { AetherFileSystem } from "../../src/implementations/services/filesystem.js";

describe("AetherFileSystem", () => {
  let fs: AetherFileSystem;

  beforeEach(() => {
    fs = new AetherFileSystem();
  });

  it("write + read → correct content", async () => {
    await fs.writeFile("/data/test.txt", "Hello, World!");
    const content = await fs.readFile("/data/test.txt");
    expect(content).toBe("Hello, World!");
  });

  it("readCSV → parses CSV correctly", async () => {
    await fs.writeFile("/data.csv", "name,age,city\nAlice,30,NYC\nBob,25,LA");
    const records = await fs.readCSV("/data.csv");
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ name: "Alice", age: 30, city: "NYC" });
    expect(records[1]).toEqual({ name: "Bob", age: 25, city: "LA" });
  });

  it("writeCSV → produces valid CSV", async () => {
    const data = [
      { name: "Alice", score: 95 },
      { name: "Bob", score: 87 },
    ];
    await fs.writeCSV("/out.csv", data);
    const content = await fs.readFile("/out.csv");
    expect(content).toContain("name,score");
    expect(content).toContain("Alice,95");

    // Round-trip
    const parsed = await fs.readCSV("/out.csv");
    expect(parsed).toEqual(data);
  });

  it("delete + exists → false", async () => {
    await fs.writeFile("/tmp.txt", "temp");
    expect(await fs.exists("/tmp.txt")).toBe(true);

    await fs.deleteFile("/tmp.txt");
    expect(await fs.exists("/tmp.txt")).toBe(false);
  });

  it("listFiles with prefix → filters correctly", async () => {
    await fs.writeFile("/data/a.txt", "a");
    await fs.writeFile("/data/b.txt", "b");
    await fs.writeFile("/logs/c.txt", "c");

    const dataFiles = await fs.listFiles("/data/");
    expect(dataFiles).toHaveLength(2);
    expect(dataFiles.every((f) => f.startsWith("/data/"))).toBe(true);

    const allFiles = await fs.listFiles();
    expect(allFiles).toHaveLength(3);
  });

  it("failure injection: not_found → throws", async () => {
    fs.injectFailure({ type: "not_found", path: "/secret.txt" });
    await expect(fs.readFile("/secret.txt")).rejects.toThrow(/not_found/);
  });

  it("failure injection: permission_denied → throws on write", async () => {
    fs.injectFailure({ type: "permission_denied" });
    await expect(fs.writeFile("/file.txt", "data")).rejects.toThrow(/permission_denied/);
  });

  it("failure injection: disk_full → throws on write", async () => {
    fs.injectFailure({ type: "disk_full" });
    await expect(fs.writeFile("/file.txt", "data")).rejects.toThrow(/disk_full/);
  });

  it("appendFile adds to existing content", async () => {
    await fs.writeFile("/log.txt", "line1\n");
    await fs.appendFile("/log.txt", "line2\n");
    expect(await fs.readFile("/log.txt")).toBe("line1\nline2\n");
  });

  it("appendFile creates file if not exists", async () => {
    await fs.appendFile("/new.txt", "hello");
    expect(await fs.readFile("/new.txt")).toBe("hello");
  });

  it("read non-existent file throws", async () => {
    await expect(fs.readFile("/nope.txt")).rejects.toThrow(/not found/i);
  });

  it("constructor with initial files", async () => {
    const fs2 = new AetherFileSystem({ "/a.txt": "aaa", "/b.txt": "bbb" });
    expect(await fs2.readFile("/a.txt")).toBe("aaa");
    expect(await fs2.readFile("/b.txt")).toBe("bbb");
  });

  it("getAll returns all file contents", async () => {
    await fs.writeFile("/a.txt", "A");
    await fs.writeFile("/b.txt", "B");
    const all = fs.getAll();
    expect(all.get("/a.txt")).toBe("A");
    expect(all.get("/b.txt")).toBe("B");
  });

  it("CSV with quoted fields", async () => {
    await fs.writeFile("/q.csv", 'name,desc\nAlice,"has, comma"\nBob,"has ""quotes"""');
    const records = await fs.readCSV("/q.csv");
    expect(records[0].desc).toBe("has, comma");
    expect(records[1].desc).toBe('has "quotes"');
  });

  it("writeCSV with empty data", async () => {
    await fs.writeCSV("/empty.csv", []);
    expect(await fs.readFile("/empty.csv")).toBe("");
  });

  it("clearFailures removes failures", async () => {
    fs.injectFailure({ type: "not_found" });
    fs.clearFailures();
    await fs.writeFile("/ok.txt", "ok");
    expect(await fs.readFile("/ok.txt")).toBe("ok");
  });
});
