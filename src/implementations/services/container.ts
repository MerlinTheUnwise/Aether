/**
 * AETHER Service — Container
 *
 * Central service registry that provides services to node implementations.
 * Manages lifecycle and failure injection across all services.
 */

import { AetherDatabase, type DatabaseConfig, type FailureConfig } from "./database.js";
import { AetherHTTPService, type RouteHandler } from "./http.js";
import { AetherEmailService } from "./email.js";
import { AetherFileSystem } from "./filesystem.js";
import { AetherMLService, sentimentModel, moderationModel, recommendationModel, type MLModel } from "./ml.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ServiceContainerConfig {
  database?: DatabaseConfig & { seed?: Record<string, Record<string, any>[]> };
  http?: { routes?: Record<string, RouteHandler> };
  email?: {};
  filesystem?: { files?: Record<string, string> };
  ml?: { models?: Record<string, MLModel> };
}

// ─── Container ──────────────────────────────────────────────────────────────────

export class ServiceContainer {
  private services: Map<string, any> = new Map();

  constructor() {}

  register<T>(name: string, service: T): void {
    this.services.set(name, service);
  }

  get<T>(name: string): T {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: "${name}". Available: ${[...this.services.keys()].join(", ")}`);
    }
    return service as T;
  }

  has(name: string): boolean {
    return this.services.has(name);
  }

  static createDefault(config?: ServiceContainerConfig): ServiceContainer {
    const container = new ServiceContainer();

    // Database
    const db = new AetherDatabase(config?.database);
    if (config?.database?.seed) {
      for (const [table, records] of Object.entries(config.database.seed)) {
        db.seed(table, records);
      }
    }
    container.register("database", db);

    // HTTP
    const http = new AetherHTTPService();
    if (config?.http?.routes) {
      for (const [key, handler] of Object.entries(config.http.routes)) {
        const [method, ...pathParts] = key.split(" ");
        http.registerRoute(method, pathParts.join(" "), handler);
      }
    }
    container.register("http", http);

    // Email
    container.register("email", new AetherEmailService());

    // Filesystem
    container.register("filesystem", new AetherFileSystem(config?.filesystem?.files));

    // ML
    const ml = new AetherMLService();
    ml.registerModel("sentiment", sentimentModel);
    ml.registerModel("moderation", moderationModel);
    ml.registerModel("recommendation", recommendationModel);
    if (config?.ml?.models) {
      for (const [name, model] of Object.entries(config.ml.models)) {
        ml.registerModel(name, model);
      }
    }
    container.register("ml", ml);

    return container;
  }

  injectFailures(config: Record<string, any>): void {
    for (const [service, failConfig] of Object.entries(config)) {
      const svc = this.services.get(service);
      if (svc && typeof svc.injectFailure === "function") {
        svc.injectFailure(failConfig);
      }
    }
  }

  clearAllFailures(): void {
    for (const svc of this.services.values()) {
      if (typeof svc.clearFailures === "function") {
        svc.clearFailures();
      }
    }
  }
}
