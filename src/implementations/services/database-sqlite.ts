/**
 * AETHER Service — SQLite Database Adapter
 *
 * A real database adapter using sql.js (SQLite compiled to WebAssembly).
 * Pure JavaScript — no native compilation, no node-gyp, no C++ compiler.
 * Works on any platform with Node.js 18+.
 */

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { randomUUID } from "crypto";
import { createRequire } from "module";
import type { DatabaseAdapter } from "./adapter.js";
import type { QueryFilter } from "./database.js";

const require = createRequire(import.meta.url);

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  private db: SqlJsDatabase | null = null;
  private knownTables: Set<string> = new Set();
  private dbPath: string;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? ":memory:";
  }

  /** Lazy initialization — load WASM on first use */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    const SQL = await initSqlJs();

    if (this.dbPath !== ":memory:") {
      try {
        const fs = await import("fs");
        if (fs.existsSync(this.dbPath)) {
          const buffer = fs.readFileSync(this.dbPath);
          this.db = new SQL.Database(buffer);
        } else {
          this.db = new SQL.Database();
        }
      } catch {
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    // Enable foreign keys
    this.db.run("PRAGMA foreign_keys = ON");

    // Discover existing tables
    const result = this.db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    if (result.length > 0) {
      for (const row of result[0].values) {
        this.knownTables.add(row[0] as string);
      }
    }

    this.initialized = true;
  }

  /** Save database to file (for persistence) */
  async save(): Promise<void> {
    if (this.dbPath === ":memory:" || !this.db) return;
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  /** Auto-save after mutations for file-based databases */
  private autoSave(): void {
    if (this.dbPath === ":memory:" || !this.db) return;
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  async create(table: string, record: Record<string, any>): Promise<{ id: string; record: Record<string, any> }> {
    await this.ensureInitialized();
    this.ensureTable(table, record);
    const id = record.id ?? randomUUID();
    const full: Record<string, any> = { ...record, id };

    this.ensureColumns(table, full);

    const columns = Object.keys(full);
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map(c => this.serialize(full[c]));

    try {
      this.db!.run(
        `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
        values
      );
    } catch (err: any) {
      if (err.message?.includes("UNIQUE constraint")) {
        throw Object.assign(new Error(`Duplicate ID "${id}" in table "${table}"`), { type: "constraint_violation" });
      }
      throw err;
    }

    this.autoSave();
    return { id, record: full };
  }

  async read(table: string, id: string): Promise<Record<string, any> | null> {
    await this.ensureInitialized();
    if (!this.knownTables.has(table)) return null;
    const result = this.db!.exec(`SELECT * FROM "${table}" WHERE id = ?`, [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return this.resultRowToRecord(result[0].columns, result[0].values[0]);
  }

  async update(table: string, id: string, fields: Record<string, any>): Promise<Record<string, any>> {
    await this.ensureInitialized();
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

    this.db!.run(`UPDATE "${table}" SET ${setClause} WHERE id = ?`, values);

    this.autoSave();
    return (await this.read(table, id))!;
  }

  async delete(table: string, id: string): Promise<boolean> {
    await this.ensureInitialized();
    if (!this.knownTables.has(table)) return false;
    this.db!.run(`DELETE FROM "${table}" WHERE id = ?`, [id]);
    const modified = this.db!.getRowsModified() > 0;
    if (modified) this.autoSave();
    return modified;
  }

  async query(table: string, filter: QueryFilter): Promise<Record<string, any>[]> {
    await this.ensureInitialized();
    if (!this.knownTables.has(table)) return [];

    const { whereClause, params } = this.buildWhere(filter);
    const result = this.db!.exec(`SELECT * FROM "${table}" WHERE ${whereClause}`, params);
    if (result.length === 0) return [];
    return this.resultToRecords(result[0]);
  }

  async count(table: string, filter?: QueryFilter): Promise<number> {
    await this.ensureInitialized();
    if (!this.knownTables.has(table)) return 0;

    if (!filter) {
      const result = this.db!.exec(`SELECT COUNT(*) as cnt FROM "${table}"`);
      return result[0].values[0][0] as number;
    }

    const { whereClause, params } = this.buildWhere(filter);
    const result = this.db!.exec(`SELECT COUNT(*) as cnt FROM "${table}" WHERE ${whereClause}`, params);
    return result[0].values[0][0] as number;
  }

  async exists(table: string, filter: QueryFilter): Promise<boolean> {
    return (await this.count(table, filter)) > 0;
  }

  // ── SQLite-specific ──────────────────────────────────────────────────────────

  async seed(table: string, data: Record<string, any>[]): Promise<void> {
    if (data.length === 0) return;
    await this.ensureInitialized();

    this.ensureTable(table, data[0]);

    for (const rec of data) {
      const id = rec.id ?? randomUUID();
      const full: Record<string, any> = { ...rec, id };
      this.ensureColumns(table, full);
      const columns = Object.keys(full);
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map(c => this.serialize(full[c]));
      this.db!.run(
        `INSERT OR REPLACE INTO "${table}" (${columns.map(c => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
        values
      );
    }

    this.autoSave();
  }

  getPath(): string {
    return this.dbPath;
  }

  close(): void {
    if (this.db) {
      // Auto-save to file on close if file-based
      if (this.dbPath !== ":memory:") {
        try {
          const fs = require("fs") as typeof import("fs");
          const path = require("path") as typeof import("path");
          const dir = path.dirname(this.dbPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          const data = this.db.export();
          fs.writeFileSync(this.dbPath, Buffer.from(data));
        } catch {
          // Best-effort save on close
        }
      }
      this.db.close();
      this.db = null;
      this.initialized = false;
      this.initPromise = null;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private ensureTable(table: string, sampleRecord: Record<string, any>): void {
    if (this.knownTables.has(table)) return;

    const columns = Object.keys({ id: "", ...sampleRecord });
    const colDefs = columns.map(c => {
      if (c === "id") return '"id" TEXT PRIMARY KEY';
      return `"${c}" TEXT`;
    }).join(", ");

    this.db!.run(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs})`);
    this.knownTables.add(table);
  }

  private ensureColumns(table: string, record: Record<string, any>): void {
    const result = this.db!.exec(`PRAGMA table_info("${table}")`);
    const existingCols = new Set<string>();
    if (result.length > 0) {
      for (const row of result[0].values) {
        existingCols.add(row[1] as string); // column name is at index 1
      }
    }

    for (const col of Object.keys(record)) {
      if (!existingCols.has(col)) {
        this.db!.run(`ALTER TABLE "${table}" ADD COLUMN "${col}" TEXT`);
        existingCols.add(col);
      }
    }
  }

  private serialize(value: any): any {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  private resultRowToRecord(columns: string[], values: any[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (let i = 0; i < columns.length; i++) {
      const key = columns[i];
      const val = values[i];
      result[key] = this.deserializeValue(val);
    }
    return result;
  }

  private resultToRecords(queryResult: { columns: string[]; values: any[][] }): Record<string, any>[] {
    return queryResult.values.map(row => this.resultRowToRecord(queryResult.columns, row));
  }

  private deserializeValue(val: any): any {
    if (val === null || val === "") return val;
    if (typeof val === "string") {
      // Try JSON parse for objects/arrays
      if ((val.startsWith("{") && val.endsWith("}")) || (val.startsWith("[") && val.endsWith("]"))) {
        try { return JSON.parse(val); } catch { /* not JSON */ }
      }
      // Try number
      const num = Number(val);
      if (val !== "" && !isNaN(num) && String(num) === val) return num;
      // Booleans
      if (val === "true") return true;
      if (val === "false") return false;
    }
    return val;
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
