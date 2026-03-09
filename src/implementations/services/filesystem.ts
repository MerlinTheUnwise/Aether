/**
 * AETHER Service — File System
 *
 * Sandboxed in-memory filesystem for file I/O operations.
 * Supports text files, CSV parsing, and failure injection.
 */

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FileEntry {
  content: string;
  created_at: string;
  modified_at: string;
}

interface FSFailureConfig {
  type: "not_found" | "permission_denied" | "disk_full";
  path?: string;
}

// ─── File System ────────────────────────────────────────────────────────────────

export class AetherFileSystem {
  private files: Map<string, FileEntry> = new Map();
  private failures: FSFailureConfig[] = [];

  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      const now = new Date().toISOString();
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(path, { content, created_at: now, modified_at: now });
      }
    }
  }

  async readFile(path: string): Promise<string> {
    this.maybeFailForPath(path, "not_found");
    const entry = this.files.get(path);
    if (!entry) {
      throw Object.assign(new Error(`File not found: ${path}`), { type: "not_found" });
    }
    return entry.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.maybeFailForPath(path, "disk_full");
    this.maybeFailForPath(path, "permission_denied");

    const now = new Date().toISOString();
    const existing = this.files.get(path);
    this.files.set(path, {
      content,
      created_at: existing?.created_at ?? now,
      modified_at: now,
    });
  }

  async appendFile(path: string, content: string): Promise<void> {
    this.maybeFailForPath(path, "disk_full");
    const existing = this.files.get(path);
    const now = new Date().toISOString();
    if (existing) {
      existing.content += content;
      existing.modified_at = now;
    } else {
      this.files.set(path, { content, created_at: now, modified_at: now });
    }
  }

  async deleteFile(path: string): Promise<boolean> {
    this.maybeFailForPath(path, "permission_denied");
    return this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async listFiles(prefix?: string): Promise<string[]> {
    const all = [...this.files.keys()];
    if (!prefix) return all;
    return all.filter((p) => p.startsWith(prefix));
  }

  // ── CSV ─────────────────────────────────────────────────────────────────────

  async readCSV(path: string): Promise<Record<string, any>[]> {
    const content = await this.readFile(path);
    const lines = content.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = this.parseCSVLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = this.parseCSVLine(line);
      const record: Record<string, any> = {};
      headers.forEach((h, i) => {
        const val = values[i] ?? "";
        // Try to parse as number
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
      lines.push(headers.map((h) => this.escapeCSVField(String(row[h] ?? ""))).join(","));
    }
    await this.writeFile(path, lines.join("\n"));
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  getAll(): Map<string, string> {
    const result = new Map<string, string>();
    for (const [path, entry] of this.files) {
      result.set(path, entry.content);
    }
    return result;
  }

  clear(): void {
    this.files.clear();
  }

  injectFailure(config: FSFailureConfig): void {
    this.failures.push(config);
  }

  clearFailures(): void {
    this.failures = [];
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private maybeFailForPath(path: string, failType: string): void {
    for (const fc of this.failures) {
      if (fc.type !== failType) continue;
      if (fc.path && fc.path !== path) continue;
      const err = new Error(`Filesystem ${fc.type}: ${path}`);
      (err as any).type = fc.type;
      throw err;
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
