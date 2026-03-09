import { describe, it, expect } from "vitest";
import { LLVMCodeGenerator } from "../../../src/compiler/llvm/codegen.js";
import type { AetherNode } from "../../../src/compiler/llvm/types.js";

function makeNode(overrides: Partial<AetherNode> & { id: string }): AetherNode {
  return {
    in: {},
    out: {},
    contract: {},
    effects: [],
    pure: true,
    ...overrides,
  };
}

describe("Recovery Code Generation", () => {
  const gen = new LLVMCodeGenerator();

  describe("retry recovery", () => {
    it("generates retry loop with exponential backoff sleep", () => {
      const node = makeNode({
        id: "check_uniqueness",
        in: { email: { type: "String" } },
        out: { unique: { type: "Bool" } },
        pure: false,
        effects: ["database.read"],
        recovery: {
          db_timeout: {
            action: "retry",
            params: { count: 3, backoff: "exponential" },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_recovery_enter");
      expect(ir).toContain("aether_has_error");
      expect(ir).toContain("handle_recovery_");
      expect(ir).toContain("retry_loop_");
      expect(ir).toContain("aether_sleep_ms");
      expect(ir).toContain("shl i64 1"); // exponential backoff
      expect(ir).toContain("icmp slt i32"); // retry count check
      expect(ir).toContain("retry_exhausted_");
    });

    it("generates retry with linear backoff", () => {
      const node = makeNode({
        id: "fetch_data",
        in: { key: { type: "String" } },
        out: { data: { type: "String" } },
        pure: false,
        effects: ["api.read"],
        recovery: {
          timeout: {
            action: "retry",
            params: { count: 5, backoff: "linear" },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_sleep_ms");
      expect(ir).toContain("mul i64 100"); // linear delay
      expect(ir).not.toContain("shl i64 1"); // no exponential
    });
  });

  describe("fallback recovery", () => {
    it("generates fallback with degraded confidence", () => {
      const node = makeNode({
        id: "lookup_user",
        in: { user_id: { type: "String" } },
        out: { found: { type: "Bool" } },
        pure: false,
        effects: ["database.read"],
        recovery: {
          db_error: {
            action: "fallback",
            params: { value: false },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_recovery_enter");
      expect(ir).toContain("fallback");
      expect(ir).toContain("aether_confidence_set");
      expect(ir).toContain("double 0.5"); // degraded confidence
      expect(ir).toContain("aether_recovery_exit");
    });
  });

  describe("escalate recovery", () => {
    it("generates escalate call with message", () => {
      const node = makeNode({
        id: "process_payment",
        in: { amount: { type: "Float64" } },
        out: { status: { type: "String" } },
        pure: false,
        effects: ["payment.write"],
        recovery: {
          critical_error: {
            action: "escalate",
            params: { message: "payment gateway error" },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_escalate");
      expect(ir).toContain("aether_recovery_exit");
    });
  });

  describe("respond recovery", () => {
    it("generates response struct for API-oriented nodes", () => {
      const node = makeNode({
        id: "api_handler",
        in: { request: { type: "String" } },
        out: { response: { type: "String" } },
        pure: false,
        effects: ["http.write"],
        recovery: {
          bad_request: {
            action: "respond",
            params: { status: 400, body: "bad request" },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_report_error");
      expect(ir).toContain("respond(400");
      expect(ir).toContain("aether_recovery_exit");
    });
  });

  describe("report recovery", () => {
    it("generates report call to channel", () => {
      const node = makeNode({
        id: "send_email",
        in: { to: { type: "String" } },
        out: { sent: { type: "Bool" } },
        pure: false,
        effects: ["email"],
        recovery: {
          email_failed: {
            action: "report",
            params: { channel: "ops-alerts" },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("aether_report_error");
      expect(ir).toContain('report("ops-alerts")');
      expect(ir).toContain("aether_recovery_exit");
    });
  });

  describe("chained recovery", () => {
    it("generates multiple recovery conditions in chain", () => {
      const node = makeNode({
        id: "authorize_card",
        in: { amount: { type: "Float64" } },
        out: { auth_code: { type: "String" } },
        pure: false,
        effects: ["payment_gateway.write"],
        recovery: {
          gateway_timeout: {
            action: "retry",
            params: { count: 3, backoff: "exponential" },
          },
          gateway_error: {
            action: "escalate",
            params: { message: "payment gateway error" },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      // Both recovery patterns present
      expect(ir).toContain("aether_sleep_ms"); // retry
      expect(ir).toContain("aether_escalate"); // escalate
      // Check condition matching
      expect(ir).toContain("aether_string_eq_cstr");
      // Unhandled recovery falls through to fatal
      expect(ir).toContain("aether_fatal");
    });
  });

  describe("no recovery (pure node)", () => {
    it("does not generate recovery wrapper for pure nodes", () => {
      const node = makeNode({
        id: "add_numbers",
        in: { a: { type: "Int" }, b: { type: "Int" } },
        out: { sum: { type: "Int" } },
        pure: true,
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).not.toContain("aether_recovery_enter");
      expect(ir).not.toContain("handle_recovery");
      expect(ir).not.toContain("aether_fatal");
    });
  });

  describe("recovery exhausted", () => {
    it("falls through to aether_fatal when all conditions exhausted", () => {
      const node = makeNode({
        id: "fetch_data",
        in: { url: { type: "String" } },
        out: { data: { type: "String" } },
        pure: false,
        effects: ["http.read"],
        recovery: {
          timeout: {
            action: "retry",
            params: { count: 2, backoff: "exponential" },
          },
        },
      });

      const ir = gen.generateNodeFunction(node);
      expect(ir).toContain("unhandled_recovery_");
      expect(ir).toContain("aether_fatal");
      expect(ir).toContain("unreachable");
    });
  });
});
