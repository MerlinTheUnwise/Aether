/**
 * AETHER Service — SQLite Database Adapter
 *
 * A real database adapter using better-sqlite3.
 * Drop-in replacement for AetherDatabase with real persistence,
 * real transactions, real constraints, real failure modes.
 */

import { createRequire } from "module";
import { randomUUID } from "crypto";
import type { DatabaseAdapter } from "./adapter.js";
import type { QueryFilter } from "./database.js";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  private db: any;
  private knownTables: Set<string> = new Set();
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? ":memory:";
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    // Discover existing tables from database schema
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const t of tables as { name: string }[]) {
      this.knownTables.add(t.name);
    }
  }

  async create(table: string, record: Record<string, any>): Promise<{ id: string; record: Record<string, any> }> {
    this.ensureTable(table, record);
    const id = record.id ?? randomUUID();
    const full: Record<string, any> = { ...record, id };

    // Ensure all columns exist
    this.ensureColumns(table, full);

    const columns = Object.keys(full);
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map(c => this.serialize(full[c]));

    try {
      this.db.prepare(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`).run(...values);
    } catch (err: any) {
      if (err.message?.includes("UNIQUE constraint")) {
        throw Object.assign(new Error(`Duplicate ID "${id}" in table "${table}"`), { type: "constraint_violation" });
      }
      throw err;
    }

    return { id, record: full };
  }

  async read(table: string, id: string): Promise<Record<string, any> | null> {
    if (!this.knownTables.has(table)) return null;
    const row = this.db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
    return row ? this.deserializeRow(row) : null;
  }

  async update(table: string, id: string, fields: Record<string, any>): Promise<Record<string, any>> {
    const existing = await this.read(table, id);
    if (!existing) {
      throw Object.assign(new Error(`Record "${id}" not found in "${table}"`), { type: "not_found" });
    }

    this.ensureColumns(table, fields);

    const updates = Object.keys(fields).filter(k => k !== "id");
    if (updates.length === 0) return existing;

    const setClause = updates.map(k => `"${k}" = ?`).join(", ");
    const values = updates.map(k => this.serialize(fields[k]));
    values.push(id);

    this.db.prepare(`UPDATE "${table}" SET ${setClause} WHERE id = ?`).run(...values);

    return (await this.read(table, id))!;
  }

  async delete(table: string, id: string): Promise<boolean> {
    if (!this.knownTables.has(table)) return false;
    const result = this.db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  async query(table: string, filter: QueryFilter): Promise<Record<string, any>[]> {
    if (!this.knownTables.has(table)) return [];

    const { whereClause, params } = this.buildWhere(filter);
    const rows = this.db.prepare(`SELECT * FROM "${table}" WHERE ${whereClause}`).all(...params);
    return rows.map((r: any) => this.deserializeRow(r));
  }

  async count(table: string, filter?: QueryFilter): Promise<number> {
    if (!this.knownTables.has(table)) return 0;

    if (!filter) {
      const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get();
      return row.cnt;
    }

    const { whereClause, params } = this.buildWhere(filter);
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM "${table}" WHERE ${whereClause}`).get(...params);
    return row.cnt;
  }

  async exists(table: string, filter: QueryFilter): Promise<boolean> {
    return (await this.count(table, filter)) > 0;
  }

  // ── SQLite-specific ──────────────────────────────────────────────────────────

  seed(table: string, data: Record<string, any>[]): void {
    if (data.length === 0) return;

    // Ensure table with first record schema
    this.ensureTable(table, data[0]);

    const insert = this.db.transaction((records: Record<string, any>[]) => {
      for (const rec of records) {
        const id = rec.id ?? randomUUID();
        const full: Record<string, any> = { ...rec, id };
        this.ensureColumns(table, full);
        const columns = Object.keys(full);
        const placeholders = columns.map(() => "?").join(", ");
        const values = columns.map(c => this.serialize(full[c]));
        this.db.prepare(`INSERT OR REPLACE INTO "${table}" (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`).run(...values);
      }
    });

    insert(data);
  }

  getPath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private ensureTable(table: string, sampleRecord: Record<string, any>): void {
    if (this.knownTables.has(table)) return;

    const columns = Object.keys({ id: "", ...sampleRecord });
    const colDefs = columns.map(c => {
      if (c === "id") return '"id" TEXT PRIMARY KEY';
      return `"${c}" TEXT`;
    }).join(", ");

    this.db.prepare(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs})`).run();
    this.knownTables.add(table);
  }

  private ensureColumns(table: string, record: Record<string, any>): void {
    const existingCols = new Set(
      this.db.prepare(`PRAGMA table_info("${table}")`).all().map((r: any) => r.name)
    );

    for (const col of Object.keys(record)) {
      if (!existingCols.has(col)) {
        this.db.prepare(`ALTER TABLE "${table}" ADD COLUMN "${col}" TEXT`).run();
        existingCols.add(col);
      }
    }
  }

  private serialize(value: any): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  private deserializeRow(row: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(row)) {
      if (val === null || val === "") {
        result[key] = val;
        continue;
      }
      // Try to parse as JSON (for objects/arrays)
      if (typeof val === "string") {
        if ((val.startsWith("{") && val.endsWith("}")) || (val.startsWith("[") && val.endsWith("]"))) {
          try {
            result[key] = JSON.parse(val);
            continue;
          } catch { /* not JSON, keep as string */ }
        }
        // Try to parse as number
        const num = Number(val);
        if (val !== "" && !isNaN(num) && String(num) === val) {
          result[key] = num;
          continue;
        }
        // Try to parse booleans
        if (val === "true") { result[key] = true; continue; }
        if (val === "false") { result[key] = false; continue; }
      }
      result[key] = val;
    }
    return result;
  }

  private buildWhere(filter: QueryFilter): { whereClause: string; params: any[] } {
    const field = `"${filter.field}"`;

    switch (filter.operator) {
      case "=":
        return { whereClause: `${field} = ?`, params: [this.serialize(filter.value)] };
      case "!=":
        return { whereClause: `${field} != ?`, params: [this.serialize(filter.value)] };
      case ">":
        return { whereClause: `CAST(${field} AS REAL) > ?`, params: [Number(filter.value)] };
      case "<":
        return { whereClause: `CAST(${field} AS REAL) < ?`, params: [Number(filter.value)] };
      case ">=":
        return { whereClause: `CAST(${field} AS REAL) >= ?`, params: [Number(filter.value)] };
      case "<=":
        return { whereClause: `CAST(${field} AS REAL) <= ?`, params: [Number(filter.value)] };
      case "in": {
        const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
        const placeholders = arr.map(() => "?").join(", ");
        return { whereClause: `${field} IN (${placeholders})`, params: arr.map(v => this.serialize(v)) };
      }
      case "not_in": {
        const arr = Array.isArray(filter.value) ? filter.value : [filter.value];
        const placeholders = arr.map(() => "?").join(", ");
        return { whereClause: `${field} NOT IN (${placeholders})`, params: arr.map(v => this.serialize(v)) };
      }
      case "contains":
        return { whereClause: `${field} LIKE ?`, params: [`%${filter.value}%`] };
      default:
        return { whereClause: "1=1", params: [] };
    }
  }
}
