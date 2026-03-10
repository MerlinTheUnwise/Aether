/**
 * AETHER Service — Real Filesystem Adapter
 *
 * Uses Node.js fs/promises for actual file I/O.
 * Sandboxed: all paths resolved relative to basePath, with path traversal prevention.
 */

import { readFile, writeFile, appendFile, unlink, stat, readdir, mkdir } from "fs/promises";
import { join, resolve, relative, dirname } from "path";
import type { FilesystemAdapter } from "./adapter.js";

export class RealFilesystemAdapter implements FilesystemAdapter {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = resolve(basePath);
  }

  async readFile(path: string): Promise<string> {
    const fullPath = this.resolveSafe(path);
    try {
      return await readFile(fullPath, "utf-8");
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw Object.assign(new Error(`File not found: ${path}`), { type: "not_found" });
      }
      if (err.code === "EACCES") {
        throw Object.assign(new Error(`Permission denied: ${path}`), { type: "permission_denied" });
      }
      throw err;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolveSafe(path);
    await mkdir(dirname(fullPath), { recursive: true });
    try {
      await writeFile(fullPath, content, "utf-8");
    } catch (err: any) {
      if (err.code === "EACCES") {
        throw Object.assign(new Error(`Permission denied: ${path}`), { type: "permission_denied" });
      }
      if (err.code === "ENOSPC") {
        throw Object.assign(new Error(`Disk full: ${path}`), { type: "disk_full" });
      }
      throw err;
    }
  }

  async appendFile(path: string, content: string): Promise<void> {
    const fullPath = this.resolveSafe(path);
    await mkdir(dirname(fullPath), { recursive: true });
    await appendFile(fullPath, content, "utf-8");
  }

  async deleteFile(path: string): Promise<boolean> {
    const fullPath = this.resolveSafe(path);
    try {
      await unlink(fullPath);
      return true;
    } catch (err: any) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = this.resolveSafe(path);
    try {
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(prefix?: string): Promise<string[]> {
    const results: string[] = [];
    await this.walkDir(this.basePath, results);

    // Convert to relative paths
    const relativePaths = results.map(f => relative(this.basePath, f).replace(/\\/g, "/"));

    if (!prefix) return relativePaths;
    return relativePaths.filter(p => p.startsWith(prefix));
  }

  async readCSV(path: string): Promise<Record<string, any>[]> {
    const content = await this.readFile(path);
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = this.parseCSVLine(lines[0]);
    return lines.slice(1).map(line => {
      const values = this.parseCSVLine(line);
      const record: Record<string, any> = {};
      headers.forEach((h, i) => {
        const val = values[i] ?? "";
        const num = Number(val);
        record[h] = val !== "" && !isNaN(num) ? num : val;
      });
      return record;
    });
  }

  async writeCSV(path: string, data: Record<string, any>[]): Promise<void> {
    if (data.length === 0) {
      await this.writeFile(path, "");
      return;
    }

    const headers = Object.keys(data[0]);
    const lines = [headers.join(",")];
    for (const row of data) {
      lines.push(headers.map(h => this.escapeCSVField(String(row[h] ?? ""))).join(","));
    }
    await this.writeFile(path, lines.join("\n"));
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private resolveSafe(path: string): string {
    // Prevent path traversal
    let normalized = path.replace(/\\/g, "/");
    if (normalized.includes("..")) {
      throw Object.assign(
        new Error(`Path traversal blocked: ${path}`),
        { type: "permission_denied" }
      );
    }

    // Strip leading slash — all paths are relative to basePath
    if (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }

    const fullPath = resolve(this.basePath, normalized);

    // Verify it's still within basePath
    if (!fullPath.startsWith(this.basePath)) {
      throw Object.assign(
        new Error(`Path traversal blocked: ${path}`),
        { type: "permission_denied" }
      );
    }

    return fullPath;
  }

  private async walkDir(dir: string, results: string[]): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.walkDir(fullPath, results);
        } else {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist yet — no files
    }
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  private escapeCSVField(field: string): string {
    if (field.includes(",") || field.includes('"') || field.includes("\n")) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }
}
