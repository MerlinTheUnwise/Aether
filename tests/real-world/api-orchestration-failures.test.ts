/**
 * Tests: API Orchestration — Failure Modes
 *
 * Tests every failure mode: auth, inventory, payment, shipment, email.
 * Each triggers the correct recovery strategy.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { execute, createExecutionContext } from "../../src/runtime/executor.js";
import type { AetherGraph } from "../../src/ir/validator.js";

function loadGraph(): AetherGraph {
  return JSON.parse(readFileSync("src/ir/examples/real-world/api-orchestration.json", "utf-8"));
}

function loadSeed(): Record<string, any[]> {
  return JSON.parse(readFileSync("test-data/api-orchestration/seed.json", "utf-8"));
}

function loadInputs(): Record<string, any> {
  return JSON.parse(readFileSync("test-data/api-orchestration/inputs.json", "utf-8"));
}

async function runWithOverrides(
  overrides: Map<string, (inputs: Record<string, any>) => Promise<Record<string, any>>>,
  inputOverrides?: Record<string, any>,
) {
  const graph = loadGraph();
  const seed = loadSeed();
  const inputs = { ...loadInputs(), ...inputOverrides };

  const ctx = await createExecutionContext(graph, inputs, {
    serviceConfig: { database: { seed } },
    contractMode: "warn",
    implementations: overrides,
  });

  return execute(ctx);
}

describe("API Orchestration — Failure Modes", () => {
  it("auth failure → respond recovery returns 401", async () => {
    const overrides = new Map<string, any>();
    overrides.set("authenticate_user", async () => {
      throw Object.assign(new Error("Token verification failed"), { type: "invalid_token" });
    });

    const result = await runWithOverrides(overrides);

    // respond recovery returns { status: 401, body: "..." }
    const authOut = result.outputs["authenticate_user"];
    expect(authOut.status).toBe(401);
  });

  it("inventory failure → respond recovery returns 409", async () => {
    const overrides = new Map<string, any>();
    overrides.set("check_inventory_api", async () => {
      throw Object.assign(new Error("Product unavailable"), { type: "out_of_stock" });
    });

    const result = await runWithOverrides(overrides);

    const invOut = result.outputs["check_inventory_api"];
    expect(invOut.status).toBe(409);
  });

  it("payment declined → respond recovery returns 402", async () => {
    const overrides = new Map<string, any>();
    overrides.set("process_order_payment", async () => {
      throw Object.assign(new Error("Card declined"), { type: "payment_declined" });
    });

    const result = await runWithOverrides(overrides);

    const payOut = result.outputs["process_order_payment"];
    expect(payOut.status).toBe(402);
  });

  it("payment gateway timeout → retry fires then throws", async () => {
    let attempts = 0;
    const overrides = new Map<string, any>();
    overrides.set("process_order_payment", async () => {
      attempts++;
      throw Object.assign(new Error("Gateway timeout"), { type: "gateway_timeout" });
    });

    // Retry exhausts then throws
    await expect(runWithOverrides(overrides)).rejects.toThrow();

    // 1 original + 3 retries = 4
    expect(attempts).toBe(4);
  });

  it("shipment failure → escalation fires", async () => {
    const overrides = new Map<string, any>();
    overrides.set("create_shipment_api", async () => {
      throw Object.assign(new Error("Shipping API down"), { type: "shipping_unavailable" });
    });

    // Escalation throws EscalationError
    await expect(runWithOverrides(overrides)).rejects.toThrow(/[Ee]scalation/);
  });

  it("email failure → retry fires then throws", async () => {
    let emailAttempts = 0;
    const overrides = new Map<string, any>();
    overrides.set("send_order_confirmation", async () => {
      emailAttempts++;
      throw Object.assign(new Error("SMTP unavailable"), { type: "email_failure" });
    });

    await expect(runWithOverrides(overrides)).rejects.toThrow();

    // 1 original + 3 retries = 4
    expect(emailAttempts).toBe(4);
  });
});
