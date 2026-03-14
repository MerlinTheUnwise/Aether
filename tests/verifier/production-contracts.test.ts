/**
 * Production Contract Pattern Tests
 *
 * Tests the 7 contract patterns that AetherAutomate workflows produce in production.
 * Verifies parsing, runtime evaluation, and Z3 verification for each pattern.
 */

import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/runtime/evaluator/lexer.js";
import { parse } from "../../src/runtime/evaluator/parser.js";
import { evaluate, builtinFunctions } from "../../src/runtime/evaluator/evaluator.js";
import { verifyNode, getZ3 } from "../../src/compiler/verifier.js";

function makeNode(overrides: Record<string, any>) {
  return {
    id: "test_node",
    in: {} as Record<string, any>,
    out: {} as Record<string, any>,
    contract: { post: [] as string[] },
    effects: [] as string[],
    ...overrides,
  };
}

function parsesCleanly(expression: string) {
  const tokens = tokenize(expression);
  const { ast, errors } = parse(tokens);
  expect(errors, `Parse errors for: ${expression}`).toHaveLength(0);
  return ast;
}

function evaluatesTo(expression: string, variables: Record<string, any>, expected: any) {
  const ast = parsesCleanly(expression);
  const result = evaluate(ast, { variables, functions: builtinFunctions });
  expect(result.success, `Eval failed for: ${expression} — ${result.error}`).toBe(true);
  expect(result.value).toBe(expected);
}

// ─── Parsing ────────────────────────────────────────────────────────────────

describe("Production contract parsing", () => {
  it("Pattern 1: property.length > 0", () => {
    const ast = parsesCleanly("categories.length > 0");
    expect(ast.type).toBe("comparison");
  });

  it("Pattern 2: x in list", () => {
    const ast = parsesCleanly("joke_category in categories");
    expect(ast.type).toBe("membership");
  });

  it("Pattern 3: obj.contains(str) — method call", () => {
    const ast = parsesCleanly('html_body.contains("Hello")');
    expect(ast.type).toBe("method_call");
  });

  it("Pattern 3b: chained property + method call", () => {
    const ast = parsesCleanly('output.data.contains("text")');
    expect(ast.type).toBe("method_call");
  });

  it("Pattern 4: amount > 0", () => {
    const ast = parsesCleanly("amount > 0");
    expect(ast.type).toBe("comparison");
  });

  it('Pattern 5: status == "active"', () => {
    const ast = parsesCleanly('status == "active"');
    expect(ast.type).toBe("comparison");
  });

  it('Pattern 6: amount > 0 && currency != ""', () => {
    const ast = parsesCleanly('amount > 0 && currency != ""');
    expect(ast.type).toBe("logical");
  });

  it("Pattern 7: response.status == 200", () => {
    const ast = parsesCleanly("response.status == 200");
    expect(ast.type).toBe("comparison");
  });
});

// ─── Runtime Evaluation ─────────────────────────────────────────────────────

describe("Production contract runtime evaluation", () => {
  it("Pattern 1: categories.length > 0 with non-empty list", () => {
    evaluatesTo("categories.length > 0", { categories: ["humor", "science"] }, true);
  });

  it("Pattern 1: categories.length > 0 with empty list", () => {
    evaluatesTo("categories.length > 0", { categories: [] }, false);
  });

  it("Pattern 2: joke_category in categories", () => {
    evaluatesTo("joke_category in categories", { joke_category: "humor", categories: ["humor", "science"] }, true);
  });

  it("Pattern 2: value not in list", () => {
    evaluatesTo("joke_category in categories", { joke_category: "sports", categories: ["humor", "science"] }, false);
  });

  it('Pattern 3: html_body.contains("Hello") — true', () => {
    evaluatesTo('html_body.contains("Hello")', { html_body: "<p>Hello World</p>" }, true);
  });

  it('Pattern 3: html_body.contains("Goodbye") — false', () => {
    evaluatesTo('html_body.contains("Goodbye")', { html_body: "<p>Hello World</p>" }, false);
  });

  it("Pattern 4: amount > 0 with positive", () => {
    evaluatesTo("amount > 0", { amount: 50 }, true);
  });

  it("Pattern 4: amount > 0 with negative", () => {
    evaluatesTo("amount > 0", { amount: -1 }, false);
  });

  it('Pattern 5: status == "active"', () => {
    evaluatesTo('status == "active"', { status: "active" }, true);
  });

  it('Pattern 5: email != ""', () => {
    evaluatesTo('email != ""', { email: "test@test.com" }, true);
  });

  it('Pattern 6: amount > 0 && currency != ""', () => {
    evaluatesTo('amount > 0 && currency != ""', { amount: 10, currency: "USD" }, true);
  });

  it("Pattern 7: response.status == 200", () => {
    evaluatesTo("response.status == 200", { response: { status: 200 } }, true);
  });
});

// ─── Z3 Verification ────────────────────────────────────────────────────────

describe("Production contract Z3 verification", () => {
  describe("Pattern 1: Property length", () => {
    it("categories.length > 0 with List axiom → verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { categories: { type: "List<String>" } },
        axioms: ["categories.length > 0"],
        contract: { post: ["categories.length > 0"] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });

    it("name.length > 0 without axiom → failed", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { name: { type: "String" } },
        contract: { post: ["name.length > 0"] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("failed");
    });
  });

  describe("Pattern 2: Set membership", () => {
    it("joke_category in categories with axiom → verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { categories: { type: "List<String>" } },
        out: { joke_category: { type: "String" } },
        axioms: ["joke_category ∈ categories"],
        contract: { post: ["joke_category in categories"] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });
  });

  describe("Pattern 3: String contains (method call)", () => {
    it('html_body.contains("Hello") with axiom → verified', async () => {
      const z3 = await getZ3();
      const node = makeNode({
        out: { html_body: { type: "String" } },
        axioms: ['contains(html_body, "Hello") = true'],
        contract: { post: ['html_body.contains("Hello")'] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });

    it("method-call parses and translates (not unsupported)", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        out: { body: { type: "String" } },
        contract: { post: ['body.contains("test")'] },
      });
      const result = await verifyNode(node, z3);
      // Without axiom it should fail (not unsupported)
      expect(result.postconditions[0].status).not.toBe("unsupported");
    });
  });

  describe("Pattern 4: Numeric comparison", () => {
    it("amount > 0 with axiom → verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { amount: { type: "Float64" } },
        axioms: ["amount > 0"],
        contract: { post: ["amount > 0"] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });

    it("amount > 0 without axiom → failed with counterexample", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { amount: { type: "Float64" } },
        contract: { post: ["amount > 0"] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("failed");
      expect(result.postconditions[0].counterexample).toBeDefined();
    });
  });

  describe("Pattern 5: String equality", () => {
    it('status == "active" with axiom → verified', async () => {
      const z3 = await getZ3();
      const node = makeNode({
        out: { status: { type: "String" } },
        axioms: ['status = "active"'],
        contract: { post: ['status == "active"'] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });

    it('email != "" with axiom → verified', async () => {
      const z3 = await getZ3();
      const node = makeNode({
        out: { email: { type: "String" } },
        axioms: ['email = "test@test.com"'],
        contract: { post: ['email != ""'] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });
  });

  describe("Pattern 6: Boolean combinators", () => {
    it('amount > 0 && currency != "" with axioms → verified', async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { amount: { type: "Float64" }, currency: { type: "String" } },
        axioms: ["amount > 0", 'currency = "USD"'],
        contract: { post: ['amount > 0 && currency != ""'] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });
  });

  describe("Pattern 7: Nested property access", () => {
    it("response.status == 200 with axiom → verified", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        out: { response: { type: "Object" } },
        axioms: ["response_status = 200"],
        contract: { post: ["response.status == 200"] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });
  });

  describe("Combined: Real Automate workflow contracts", () => {
    it("Daily joke precondition: categories.length > 0", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { categories: { type: "List<String>" } },
        out: { joke_category: { type: "String" }, joke_text: { type: "String" } },
        axioms: ["categories.length > 0", "joke_category ∈ categories"],
        contract: {
          pre: ["categories.length > 0"],
          post: ["joke_category in categories"],
        },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });

    it('Email postcondition: html_body.contains("Good morning")', async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { greeting: { type: "String" } },
        out: { html_body: { type: "String" } },
        axioms: ['contains(html_body, "Good morning") = true'],
        contract: { post: ['html_body.contains("Good morning")'] },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
    });

    it("Payment processing: amount > 0 && card_token.length > 0", async () => {
      const z3 = await getZ3();
      const node = makeNode({
        in: { amount: { type: "Float64" }, card_token: { type: "String" } },
        out: { validated_amount: { type: "Float64" }, status: { type: "String" } },
        axioms: ["validated_amount = amount", 'status = "created"'],
        contract: {
          pre: ["amount > 0", "card_token.length > 0"],
          post: ["validated_amount == amount", 'status == "created"'],
        },
      });
      const result = await verifyNode(node, z3);
      expect(result.postconditions[0].status).toBe("verified");
      expect(result.postconditions[1].status).toBe("verified");
    });
  });
});
