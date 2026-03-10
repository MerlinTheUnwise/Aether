/**
 * AETHER Service Adapter Interfaces
 *
 * Defines clean interfaces so mock and real services are interchangeable.
 * The existing in-memory services implement these interfaces.
 * New real adapters also implement them.
 */

import type { QueryFilter } from "./database.js";
import type { HTTPRequest, HTTPResponse } from "./http.js";
import type { Email } from "./email.js";

// ─── Database Adapter ────────────────────────────────────────────────────────

export interface DatabaseAdapter {
  create(table: string, record: Record<string, any>): Promise<{ id: string; record: Record<string, any> }>;
  read(table: string, id: string): Promise<Record<string, any> | null>;
  update(table: string, id: string, fields: Record<string, any>): Promise<Record<string, any>>;
  delete(table: string, id: string): Promise<boolean>;
  query(table: string, filter: QueryFilter): Promise<Record<string, any>[]>;
  count(table: string, filter?: QueryFilter): Promise<number>;
  exists(table: string, filter: QueryFilter): Promise<boolean>;
}

// ─── Filesystem Adapter ──────────────────────────────────────────────────────

export interface FilesystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  listFiles(prefix?: string): Promise<string[]>;
  readCSV(path: string): Promise<Record<string, any>[]>;
  writeCSV(path: string, data: Record<string, any>[]): Promise<void>;
}

// ─── HTTP Adapter ────────────────────────────────────────────────────────────

export interface HTTPAdapter {
  request(req: HTTPRequest): Promise<HTTPResponse>;
}

// ─── Email Adapter ───────────────────────────────────────────────────────────

export interface EmailAdapter {
  send(email: Email): Promise<{ sent: boolean; id: string }>;
}

// ─── Service Mode ────────────────────────────────────────────────────────────

export type ServiceMode = "mock" | "real";
