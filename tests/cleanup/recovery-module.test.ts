/**
 * Tests for the recovery module extracted from executor.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { executeRecovery, retryWithBackoff, matchesCondition, EscalationError } from "../../src/runtime/recovery.js";
import type { AetherNode } from "../../src/ir/validator.js";
import type { RecoveryContext } from "../../src/runtime/recovery.js";

function makeNode(overrides: Partial<AetherNode> = {}): AetherNode {
  return {
    id: "test_node",
    in: { input: { type: "String" } },
    out: { result: { type: "String" } },
    contract: { pre: [], post: [] },
    confidence: 0.9,
    effects: ["network.call"],
    pure: false,
    recovery: {},
    ...overrides,
  } as AetherNode;
}

function makeContext(impl?: (inputs: Record<string, any>) => Promise<Record<string, any>>): RecoveryContext {
  const impls = new Map<string, (inputs: Record<string, any>) => Promise<Record<string, any>>>();
  if (impl) impls.set("test_node", impl);
  return { nodeImplementations: impls };
}

describe("matchesCondition", () => {
  it("matches when condition appears in error message", () => {
    const error = new Error("network timeout occurred");
    expect(matchesCondition(error, "timeout")).toBe(true);
  });

  it("matches case-insensitively", () => {
    const error = new Error("NETWORK TIMEOUT");
    expect(matchesCondition(error, "timeout")).toBe(true);
  });

  it("matches error type property", () => {
    const error = Object.assign(new Error("something"), { type: "constraint_violation" });
    expect(matchesCondition(error, "constraint_violation")).toBe(true);
  });

  it("matches error code property", () => {
    const error = Object.assign(new Error("something"), { code: "ECONNREFUSED" });
    expect(matchesCondition(error, "ECONNREFUSED")).toBe(true);
  });

  it("returns false when no match", () => {
    const error = new Error("something else");
    expect(matchesCondition(error, "timeout")).toBe(false);
  });
});

describe("retryWithBackoff", () => {
  it("retries up to count times with exponential backoff", async () => {
    let attempts = 0;
    const impl = vi.fn(async () => {
      attempts++;
      if (attempts < 3) throw new Error("fail");
      return { result: "ok" };
    });

    const node = makeNode();
    const context = makeContext(impl);

    const result = await retryWithBackoff(node, { input: "test" }, context, { count: 3 });
    expect(result).toEqual({ result: "ok" });
    expect(impl).toHaveBeenCalledTimes(3);
  }, 10000);

  it("throws after exhausting retries", async () => {
    const impl = vi.fn(async () => { throw new Error("always fails"); });
    const node = makeNode();
    const context = makeContext(impl);

    await expect(retryWithBackoff(node, {}, context, { count: 2 }))
      .rejects.toThrow("always fails");
    expect(impl).toHaveBeenCalledTimes(2);
  }, 10000);
});

describe("executeRecovery", () => {
  it("handles retry with backoff (3 retries, exponential delay)", async () => {
    let attempts = 0;
    const impl = vi.fn(async () => {
      attempts++;
      if (attempts < 2) throw new Error("fail");
      return { result: "recovered" };
    });

    const node = makeNode({
      recovery: {
        fail: { action: "retry", params: { count: 3, backoff: "exponential" } },
      },
    });
    const context = makeContext(impl);

    const result = await executeRecovery(node, new Error("fail"), { input: "x" }, context);
    expect(result).toEqual({ result: "recovered" });
  }, 10000);

  it("handles fallback (returns fallback value)", async () => {
    const node = makeNode({
      recovery: {
        error: { action: "fallback", params: { value: { result: "default" } } },
      },
    });

    const result = await executeRecovery(node, new Error("some error"), {}, makeContext());
    expect(result).toEqual({ result: "default" });
  });

  it("handles fallback with generated defaults when no value provided", async () => {
    const node = makeNode({
      recovery: {
        error: { action: "fallback" },
      },
    });

    const result = await executeRecovery(node, new Error("some error"), {}, makeContext());
    expect(result).toHaveProperty("result");
  });

  it("handles escalate (calls oversight handler)", async () => {
    const node = makeNode({
      recovery: {
        critical: { action: "escalate", params: { message: "needs human" } },
      },
    });

    const oversight = vi.fn(async () => ({ result: "human_approved" }));
    const context: RecoveryContext = {
      nodeImplementations: new Map(),
      onOversightRequired: oversight,
    };

    const result = await executeRecovery(node, new Error("critical issue"), {}, context);
    expect(result).toEqual({ result: "human_approved" });
    expect(oversight).toHaveBeenCalledOnce();
  });

  it("handles escalate (throws EscalationError when no oversight handler)", async () => {
    const node = makeNode({
      recovery: {
        critical: { action: "escalate", params: { message: "needs human" } },
      },
    });

    await expect(executeRecovery(node, new Error("critical issue"), {}, makeContext()))
      .rejects.toThrow(EscalationError);
  });

  it("handles respond (returns status/body)", async () => {
    const node = makeNode({
      recovery: {
        error: { action: "respond", params: { status: 503, body: "Service unavailable" } },
      },
    });

    const result = await executeRecovery(node, new Error("some error"), {}, makeContext());
    expect(result).toEqual({ status: 503, body: "Service unavailable" });
  });

  it("throws original error when no recovery block", async () => {
    const node = makeNode({ recovery: undefined });
    await expect(executeRecovery(node, new Error("fail"), {}, makeContext()))
      .rejects.toThrow("fail");
  });

  it("throws original error when no matching condition", async () => {
    const node = makeNode({
      recovery: {
        timeout: { action: "retry", params: { count: 1 } },
      },
    });

    await expect(executeRecovery(node, new Error("something else"), {}, makeContext()))
      .rejects.toThrow("something else");
  });
});
