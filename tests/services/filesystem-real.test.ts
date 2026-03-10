/**
 * Tests for Real Filesystem Adapter
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RealFilesystemAdapter } from "../../src/implementations/services/filesystem-real.js";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

describe("RealFilesystemAdapter", () => {
  const testDir = join(process.cwd(), "test-output", "fs-test");

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it("write → read → matches", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.writeFile("hello.txt", "Hello, World!");
    const content = await fs.readFile("hello.txt");
    expect(content).toBe("Hello, World!");
  });

  it("readCSV → parses correctly", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.writeFile("data.csv", "name,age,score\nAlice,30,95.5\nBob,25,88.0");
    const records = await fs.readCSV("data.csv");
    expect(records.length).toBe(2);
    expect(records[0].name).toBe("Alice");
    expect(records[0].age).toBe(30);
    expect(records[0].score).toBe(95.5);
  });

  it("writeCSV → produces valid CSV → readable", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    const data = [
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
    ];
    await fs.writeCSV("output.csv", data);
    const readBack = await fs.readCSV("output.csv");
    expect(readBack.length).toBe(2);
    expect(readBack[0].name).toBe("Alice");
    expect(readBack[1].age).toBe(25);
  });

  it("path traversal blocked → error", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await expect(fs.readFile("../../../etc/passwd"))
      .rejects.toThrow("Path traversal blocked");
  });

  it("file not found → appropriate error", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await expect(fs.readFile("nonexistent.txt"))
      .rejects.toThrow("File not found");
  });

  it("delete → exists returns false", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.writeFile("temp.txt", "temporary");
    expect(await fs.exists("temp.txt")).toBe(true);

    const deleted = await fs.deleteFile("temp.txt");
    expect(deleted).toBe(true);
    expect(await fs.exists("temp.txt")).toBe(false);
  });

  it("delete nonexistent → returns false", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    const deleted = await fs.deleteFile("nope.txt");
    expect(deleted).toBe(false);
  });

  it("listFiles → correct listing", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.writeFile("a.txt", "aaa");
    await fs.writeFile("b.txt", "bbb");
    await fs.writeFile("sub/c.txt", "ccc");

    const all = await fs.listFiles();
    expect(all.sort()).toEqual(["a.txt", "b.txt", "sub/c.txt"]);

    const subOnly = await fs.listFiles("sub/");
    expect(subOnly).toEqual(["sub/c.txt"]);
  });

  it("appendFile → appends content", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.writeFile("log.txt", "line1\n");
    await fs.appendFile("log.txt", "line2\n");
    const content = await fs.readFile("log.txt");
    expect(content).toBe("line1\nline2\n");
  });

  it("appendFile creates file if not exists", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.appendFile("new.txt", "first");
    const content = await fs.readFile("new.txt");
    expect(content).toBe("first");
  });

  it("creates nested directories as needed", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.writeFile("deep/nested/dir/file.txt", "deep content");
    const content = await fs.readFile("deep/nested/dir/file.txt");
    expect(content).toBe("deep content");
  });

  it("writeCSV with empty data → empty file", async () => {
    const fs = new RealFilesystemAdapter(testDir);
    await fs.writeCSV("empty.csv", []);
    const content = await fs.readFile("empty.csv");
    expect(content).toBe("");
  });
});
