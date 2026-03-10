/**
 * Tests for .aether axiom syntax parsing, emission, and bridge round-trip.
 */

import { describe, it, expect } from "vitest";
import { tokenize } from "../../src/parser/lexer.js";
import { parse } from "../../src/parser/parser.js";
import { emit } from "../../src/parser/emitter.js";
import { aetherToIR, irToAether } from "../../src/parser/bridge.js";

const AXIOM_PROGRAM = `graph test_axioms v1
  effects: [database.write]

  node validate_email
    in:  email: String @email
    out: valid: Bool, normalized: String @email
    axioms:
      normalized.is_lowercase = true
      normalized.is_trimmed = true
    contracts:
      post: normalized.is_lowercase
      post: normalized.is_trimmed
    pure
    confidence: 0.99
  end

  node create_user
    in:  email: String, unique: Bool
    out: user: User
    effects: [database.write]
    axioms:
      user.email = email
      user.status = active
    contracts:
      pre:  unique == true
      post: user.email == email
      post: user.status == active
    recovery:
      write_fail -> retry(3, exponential)
  end

  edge validate_email.normalized -> create_user.email

end
`;

describe("Parser axiom support", () => {
  it("parse .aether with axioms block → correct AST", () => {
    const { tokens } = tokenize(AXIOM_PROGRAM);
    const result = parse(tokens, AXIOM_PROGRAM.split("\n"));
    expect(result.errors).toHaveLength(0);
    expect(result.ast).not.toBeNull();

    const graph = result.ast!.graph;
    const nodes = graph.nodes;

    // validate_email should have axioms
    const validateNode = nodes.find((n: any) => n.kind === "node" && n.id === "validate_email") as any;
    expect(validateNode).toBeDefined();
    expect(validateNode.axioms).toBeDefined();
    expect(validateNode.axioms).toHaveLength(2);
    expect(validateNode.axioms[0]).toContain("is_lowercase");
    expect(validateNode.axioms[1]).toContain("is_trimmed");

    // create_user should have axioms
    const createNode = nodes.find((n: any) => n.kind === "node" && n.id === "create_user") as any;
    expect(createNode).toBeDefined();
    expect(createNode.axioms).toBeDefined();
    expect(createNode.axioms).toHaveLength(2);
  });

  it("axioms appear in bridge output (IR JSON has axioms field)", () => {
    const { graph, errors } = aetherToIR(AXIOM_PROGRAM);
    expect(errors).toHaveLength(0);
    expect(graph).not.toBeNull();

    const validateNode = graph!.nodes.find((n: any) => n.id === "validate_email");
    expect(validateNode).toBeDefined();
    expect((validateNode as any).axioms).toBeDefined();
    expect((validateNode as any).axioms).toHaveLength(2);

    const createNode = graph!.nodes.find((n: any) => n.id === "create_user");
    expect(createNode).toBeDefined();
    expect((createNode as any).axioms).toBeDefined();
    expect((createNode as any).axioms).toHaveLength(2);
  });

  it("round-trip: JSON with axioms → .aether → preserves axioms", () => {
    // Start from a known good JSON with axioms
    const json = {
      id: "test_roundtrip",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "my_node",
          in: { x: { type: "Int" } },
          out: { y: { type: "Int" } },
          axioms: ["y = x", "y > 0"],
          contract: { post: ["y == x", "y > 0"] },
          effects: [],
        },
      ],
      edges: [],
    };

    // IR → .aether
    const aetherOutput = irToAether(json as any);
    expect(aetherOutput).toContain("axioms:");
    expect(aetherOutput).toContain("y = x");
    expect(aetherOutput).toContain("y > 0");

    // .aether → IR round-trip
    const { graph, errors } = aetherToIR(aetherOutput);
    expect(errors).toHaveLength(0);
    expect(graph).not.toBeNull();

    const node = graph!.nodes.find((n: any) => n.id === "my_node");
    expect(node).toBeDefined();
    expect((node as any).axioms).toEqual(["y = x", "y > 0"]);
  });

  it("node without axioms parses correctly", () => {
    const src = `graph no_axioms v1
  effects: []

  node simple
    in:  x: Int
    out: y: Int
    contracts:
      post: y > 0
  end

end
`;
    const { tokens } = tokenize(src);
    const result = parse(tokens, src.split("\n"));
    expect(result.errors).toHaveLength(0);

    const node = result.ast!.graph.nodes.find((n: any) => n.kind === "node" && n.id === "simple") as any;
    expect(node).toBeDefined();
    expect(node.axioms).toBeUndefined();
  });

  it("emit preserves axiom ordering (axioms before contracts)", () => {
    const json = {
      id: "test_ordering",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "ordered_node",
          in: { x: { type: "Int" } },
          out: { y: { type: "Int" } },
          axioms: ["y >= 0"],
          contract: { post: ["y >= 0"] },
          effects: [],
        },
      ],
      edges: [],
    };

    const output = irToAether(json as any);

    // axioms should appear before contracts
    const axiomsIdx = output.indexOf("axioms:");
    const contractsIdx = output.indexOf("contracts:");
    expect(axiomsIdx).toBeGreaterThan(-1);
    expect(contractsIdx).toBeGreaterThan(-1);
    expect(axiomsIdx).toBeLessThan(contractsIdx);
  });
});
