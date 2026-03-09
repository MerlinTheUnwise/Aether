import { describe, it, expect } from "vitest";
import { AetherDatabase } from "../../src/implementations/services/database.js";
import { AetherEmailService } from "../../src/implementations/services/email.js";
import { AetherHTTPService } from "../../src/implementations/services/http.js";
import { ServiceContainer } from "../../src/implementations/services/container.js";
import type { ImplementationContext } from "../../src/implementations/types.js";

/**
 * Recovery trigger tests — verify that service failures produce the right
 * error types/messages that the AETHER executor's recovery strategies can match.
 */

function makeContext(services: ServiceContainer): ImplementationContext {
  const effects: string[] = [];
  return {
    nodeId: "test_node",
    effects: ["database.read", "database.write", "email", "http"],
    confidence: 0.9,
    reportEffect: (e) => effects.push(e),
    log: () => {},
    getService: <T>(name: string) => services.get<T>(name),
  };
}

describe("Recovery Triggers — Service Failures", () => {
  it("database timeout on read → retry fires 3 times", async () => {
    const container = ServiceContainer.createDefault();
    const db = container.get<AetherDatabase>("database");
    // exists() calls query() internally, so inject on "query" operation
    db.injectFailure({ type: "timeout", probability: 1.0, on_operation: "query" });

    const ctx = makeContext(container);
    let attempts = 0;

    // Simulate retry(3, exponential)
    const maxRetries = 3;
    let succeeded = false;
    for (let i = 0; i < maxRetries; i++) {
      try {
        ctx.reportEffect("database.read");
        const svc = ctx.getService!<AetherDatabase>("database");
        await svc.exists("users", { field: "email", operator: "=", value: "test@test.com" });
        succeeded = true;
        break;
      } catch (e: any) {
        attempts++;
        expect(e.type).toBe("timeout");
      }
    }

    expect(succeeded).toBe(false);
    expect(attempts).toBe(3);
  });

  it("database error → fallback returns { unique: false }", async () => {
    const container = ServiceContainer.createDefault();
    const db = container.get<AetherDatabase>("database");
    db.injectFailure({ type: "connection_error", probability: 1.0 });

    const ctx = makeContext(container);

    // Simulate check_uniqueness with fallback
    let result: { unique: boolean };
    try {
      ctx.reportEffect("database.read");
      const svc = ctx.getService!<AetherDatabase>("database");
      const exists = await svc.exists("users", { field: "email", operator: "=", value: "test@test.com" });
      result = { unique: !exists };
    } catch (e: any) {
      // Recovery: fallback returns { unique: false }
      expect(e.type).toBe("connection_error");
      result = { unique: false };
    }

    expect(result).toEqual({ unique: false });
  });

  it("email failure → report recovery logs the error", async () => {
    const container = ServiceContainer.createDefault();
    const emailSvc = container.get<AetherEmailService>("email");
    emailSvc.injectFailure({ probability: 1.0, error: "SMTP connection refused" });

    const ctx = makeContext(container);
    const logs: string[] = [];
    const loggingCtx = { ...ctx, log: (msg: string) => logs.push(msg) };

    // Simulate send_email with report recovery
    try {
      loggingCtx.reportEffect("email");
      const svc = loggingCtx.getService!<AetherEmailService>("email");
      await svc.send({
        to: ["user@test.com"],
        from: "noreply@aether.dev",
        subject: "Test",
        body: "Hello",
      });
    } catch (e: any) {
      // Recovery: report — log and re-throw
      loggingCtx.log(`[AETHER:${loggingCtx.nodeId}] ${e.message}`);
      expect(e.message).toBe("SMTP connection refused");
    }

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("SMTP connection refused");
  });

  it("HTTP 401 → respond recovery returns 401", async () => {
    const container = ServiceContainer.createDefault();
    const http = container.get<AetherHTTPService>("http");
    http.injectFailure({ status: 401, probability: 1.0 });

    const ctx = makeContext(container);

    // Simulate authenticate node with respond recovery
    ctx.reportEffect("http");
    const svc = ctx.getService!<AetherHTTPService>("http");
    const response = await svc.request({
      method: "GET",
      path: "/auth",
      headers: { authorization: "Bearer bad-token" },
    });

    // The HTTP service returns 401 directly (not a throw)
    // The respond recovery would return this status
    expect(response.status).toBe(401);

    // Simulate respond recovery producing output
    const recoveryOutput = {
      status: response.status,
      body: { error: "Unauthorized" },
    };
    expect(recoveryOutput.status).toBe(401);
  });

  it("database failure only on specific operation preserves other ops", async () => {
    const container = ServiceContainer.createDefault();
    const db = container.get<AetherDatabase>("database");

    // Only fail on read, create should work
    db.injectFailure({ type: "timeout", probability: 1.0, on_operation: "read" });

    const ctx = makeContext(container);
    const svc = ctx.getService!<AetherDatabase>("database");

    // Create works
    const { id } = await svc.create("users", { email: "test@test.com" });
    expect(id).toBeTruthy();

    // Read fails
    await expect(svc.read("users", id)).rejects.toThrow(/timeout/i);
  });

  it("services from container are shared instances", () => {
    const container = ServiceContainer.createDefault();
    const ctx1 = makeContext(container);
    const ctx2 = makeContext(container);

    // Same database instance — data persists across node executions
    const db1 = ctx1.getService!<AetherDatabase>("database");
    const db2 = ctx2.getService!<AetherDatabase>("database");
    expect(db1).toBe(db2);
  });
});
