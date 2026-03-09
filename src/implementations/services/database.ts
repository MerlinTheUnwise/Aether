/**
 * AETHER Service — In-Memory Database
 *
 * A real, functional in-memory database. Data persists across node executions
 * within a single graph run. Supports CRUD, queries, bulk ops, snapshots,
 * and configurable failure injection.
 */

import { randomUUID } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface DatabaseConfig {
  latency_ms?: number;
  failure_rate?: number;
  max_records_per_table?: number;
}

export interface QueryFilter {
  field: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "in" | "not_in" | "contains";
  value: any;
}

export interface FailureConfig {
  type: "timeout" | "connection_error" | "constraint_violation" | "not_found";
  probability: number;
  on_operation?: "create" | "read" | "update" | "delete" | "query";
}

export interface DatabaseSnapshot {
  tables: Record<string, Record<string, Record<string, any>>>;
  timestamp: string;
}

// ─── Database ───────────────────────────────────────────────────────────────────

export class AetherDatabase {
  private tables: Map<string, Map<string, Record<string, any>>> = new Map();
  private config: DatabaseConfig;
  private failures: FailureConfig[] = [];

  constructor(config?: DatabaseConfig) {
    this.config = config ?? {};
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async create(table: string, record: Record<string, any>): Promise<{ id: string; record: Record<string, any> }> {
    await this.maybeDelay();
    this.maybeFail("create");

    const t = this.ensureTable(table);
    if (this.config.max_records_per_table && t.size >= this.config.max_records_per_table) {
      throw Object.assign(new Error(`Table "${table}" at capacity (${this.config.max_records_per_table})`), { type: "constraint_violation" });
    }

    const id = record.id ?? randomUUID();
    const full = { ...record, id };
    t.set(id, full);
    return { id, record: full };
  }

  async read(table: string, id: string): Promise<Record<string, any> | null> {
    await this.maybeDelay();
    this.maybeFail("read");

    const t = this.tables.get(table);
    if (!t) return null;
    return t.get(id) ?? null;
  }

  async update(table: string, id: string, fields: Record<string, any>): Promise<Record<string, any>> {
    await this.maybeDelay();
    this.maybeFail("update");

    const t = this.tables.get(table);
    const existing = t?.get(id);
    if (!existing) {
      throw Object.assign(new Error(`Record "${id}" not found in "${table}"`), { type: "not_found" });
    }

    const updated = { ...existing, ...fields, id };
    t!.set(id, updated);
    return updated;
  }

  async delete(table: string, id: string): Promise<boolean> {
    await this.maybeDelay();
    this.maybeFail("delete");

    const t = this.tables.get(table);
    if (!t) return false;
    return t.delete(id);
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  async query(table: string, filter: QueryFilter): Promise<Record<string, any>[]> {
    await this.maybeDelay();
    this.maybeFail("query");

    const t = this.tables.get(table);
    if (!t) return [];

    return [...t.values()].filter((rec) => this.matchFilter(rec, filter));
  }

  async count(table: string, filter?: QueryFilter): Promise<number> {
    if (!filter) {
      const t = this.tables.get(table);
      return t ? t.size : 0;
    }
    return (await this.query(table, filter)).length;
  }

  async exists(table: string, filter: QueryFilter): Promise<boolean> {
    return (await this.query(table, filter)).length > 0;
  }

  // ── Bulk ────────────────────────────────────────────────────────────────────

  async bulkCreate(table: string, records: Record<string, any>[]): Promise<{ created: number; ids: string[] }> {
    const ids: string[] = [];
    for (const rec of records) {
      const result = await this.create(table, rec);
      ids.push(result.id);
    }
    return { created: ids.length, ids };
  }

  async bulkQuery(table: string, ids: string[]): Promise<Record<string, any>[]> {
    const results: Record<string, any>[] = [];
    for (const id of ids) {
      const rec = await this.read(table, id);
      if (rec) results.push(rec);
    }
    return results;
  }

  // ── State ───────────────────────────────────────────────────────────────────

  seed(table: string, data: Record<string, any>[]): void {
    const t = this.ensureTable(table);
    for (const rec of data) {
      const id = rec.id ?? randomUUID();
      t.set(id, { ...rec, id });
    }
  }

  snapshot(): DatabaseSnapshot {
    const tables: Record<string, Record<string, Record<string, any>>> = {};
    for (const [name, t] of this.tables) {
      tables[name] = {};
      for (const [id, rec] of t) {
        tables[name][id] = { ...rec };
      }
    }
    return { tables, timestamp: new Date().toISOString() };
  }

  restore(snapshot: DatabaseSnapshot): void {
    this.tables.clear();
    for (const [name, records] of Object.entries(snapshot.tables)) {
      const t = new Map<string, Record<string, any>>();
      for (const [id, rec] of Object.entries(records)) {
        t.set(id, { ...rec });
      }
      this.tables.set(name, t);
    }
  }

  clear(): void {
    this.tables.clear();
  }

  // ── Failure Injection ───────────────────────────────────────────────────────

  injectFailure(config: FailureConfig): void {
    this.failures.push(config);
  }

  clearFailures(): void {
    this.failures = [];
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private ensureTable(name: string): Map<string, Record<string, any>> {
    let t = this.tables.get(name);
    if (!t) {
      t = new Map();
      this.tables.set(name, t);
    }
    return t;
  }

  private matchFilter(record: Record<string, any>, filter: QueryFilter): boolean {
    const val = record[filter.field];
    switch (filter.operator) {
      case "=": return val === filter.value;
      case "!=": return val !== filter.value;
      case ">": return val > filter.value;
      case "<": return val < filter.value;
      case ">=": return val >= filter.value;
      case "<=": return val <= filter.value;
      case "in": return Array.isArray(filter.value) && filter.value.includes(val);
      case "not_in": return Array.isArray(filter.value) && !filter.value.includes(val);
      case "contains": return typeof val === "string" && val.includes(filter.value);
      default: return false;
    }
  }

  private async maybeDelay(): Promise<void> {
    if (this.config.latency_ms && this.config.latency_ms > 0) {
      await new Promise((r) => setTimeout(r, this.config.latency_ms));
    }
  }

  private maybeFail(operation: string): void {
    // Global failure rate
    if (this.config.failure_rate && Math.random() < this.config.failure_rate) {
      throw Object.assign(new Error("Random database failure"), { type: "connection_error" });
    }

    // Specific failure injections
    for (const fc of this.failures) {
      if (fc.on_operation && fc.on_operation !== operation) continue;
      if (Math.random() < fc.probability) {
        const err = new Error(`Database ${fc.type}: injected failure on ${operation}`);
        (err as any).type = fc.type;
        throw err;
      }
    }
  }
}
