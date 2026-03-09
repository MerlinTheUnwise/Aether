/**
 * Tests: API Orchestration — Real-World End-to-End
 *
 * Full e-commerce order flow: auth → inventory → payment → order → shipment → email → response.
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

async function runOrder(
  inputOverrides?: Record<string, any>,
  contractMode: "enforce" | "warn" = "warn",
) {
  const graph = loadGraph();
  const seed = loadSeed();
  const inputs = { ...loadInputs(), ...inputOverrides };

  const ctx = await createExecutionContext(graph, inputs, {
    serviceConfig: { database: { seed } },
    contractMode,
  });

  return execute(ctx);
}

describe("API Orchestration — Real Execution", () => {
  it("valid order flow: auth → inventory → payment → shipment → email → success", async () => {
    const result = await runOrder();

    expect(result.nodesExecuted).toBe(7);
    expect(result.waves).toBeGreaterThanOrEqual(4);

    // Auth
    expect(result.outputs["authenticate_user"].authenticated).toBe(true);
    expect(result.outputs["authenticate_user"].user_id).toBe("user_001");

    // Inventory
    expect(result.outputs["check_inventory_api"].available).toBe(true);
    expect(result.outputs["check_inventory_api"].reserved).toBe(true);
    expect(result.outputs["check_inventory_api"].total_price).toBe(79.99);

    // Payment
    expect(result.outputs["process_order_payment"].charged).toBe(true);
    expect(result.outputs["process_order_payment"].amount).toBe(79.99);

    // Order record
    expect(result.outputs["create_order_record_api"].status).toBe("confirmed");
    expect(result.outputs["create_order_record_api"].order_id).toBeTruthy();

    // Shipment
    expect(result.outputs["create_shipment_api"].shipment_id).toBeTruthy();
    expect(result.outputs["create_shipment_api"].tracking_number).toBeTruthy();

    // Email
    expect(result.outputs["send_order_confirmation"].email_sent).toBe(true);

    // Final response
    expect(result.outputs["respond_success"].status_code).toBe(200);
    expect(result.outputs["respond_success"].response.message).toBe("Order placed successfully");
  });

  it("invalid JWT → respond recovery returns 401", async () => {
    const result = await runOrder({ token: "invalid.token.here" });

    // respond recovery produces status/body outputs
    const authOut = result.outputs["authenticate_user"];
    expect(authOut.status).toBe(401);
    expect(authOut.body).toContain("invalid");
  });

  it("expired JWT → respond recovery returns 401", async () => {
    const expiredPayload = Buffer.from(JSON.stringify({
      user_id: "user_001", role: "customer", exp: 1000000000,
    })).toString("base64");
    const expiredToken = `eyJhbGciOiJIUzI1NiJ9.${expiredPayload}.sig`;

    const result = await runOrder({ token: expiredToken });

    const authOut = result.outputs["authenticate_user"];
    expect(authOut.status).toBe(401);
  });

  it("out of stock → respond recovery returns 409", async () => {
    const result = await runOrder({ product_id: "prod_004" });

    const invOut = result.outputs["check_inventory_api"];
    expect(invOut.status).toBe(409);
    expect(invOut.body).toContain("out of stock");
  });

  it("all contracts pass on valid order", async () => {
    const result = await runOrder();

    expect(result.contractReport).toBeDefined();
    expect(result.contractReport!.violated).toBe(0);
  });

  it("effects properly tracked across the full flow", async () => {
    const result = await runOrder();

    expect(result.effectsPerformed).toContain("auth.verify");
    expect(result.effectsPerformed).toContain("database.read");
    expect(result.effectsPerformed).toContain("database.write");
    expect(result.effectsPerformed).toContain("payment_gateway.write");
    expect(result.effectsPerformed).toContain("shipping.write");
    expect(result.effectsPerformed).toContain("email");
  });

  it("confidence reflects payment processing uncertainty", async () => {
    const result = await runOrder();

    const paymentEntry = result.executionLog.find(e => e.nodeId === "process_order_payment");
    expect(paymentEntry).toBeDefined();
    expect(paymentEntry!.confidence).toBeLessThanOrEqual(0.80);

    expect(result.confidence).toBeLessThanOrEqual(0.80);
  });

  it("high-value order processes successfully", async () => {
    const result = await runOrder({ product_id: "prod_003" });

    expect(result.outputs["check_inventory_api"].total_price).toBe(899.99);
    expect(result.outputs["process_order_payment"].charged).toBe(true);
  });
});
