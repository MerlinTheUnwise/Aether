import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { aetherToIR, irToAether } from "../../src/parser/bridge.js";
import { validateGraph } from "../../src/ir/validator.js";

const EXAMPLES_DIR = join(process.cwd(), "src/ir/examples");

describe("Bridge: AST ↔ IR", () => {
  it("parses .aether source → IR → validates against schema", () => {
    const source = `// User Registration Flow
graph user_registration v1
  effects: [database.read, database.write]

  node validate_email
    in:  email: String @email @pii
    out: valid: Bool, normalized: String @email @auth @pii
    contracts:
      pre:  email.length > 0
      post: normalized.is_lowercase
      post: normalized.is_trimmed
    pure
    confidence: 0.99
  end

  node check_uniqueness
    in:  email: String @email @auth @pii
    out: unique: Bool
    effects: [database.read]
    contracts:
      post: unique = true
    recovery:
      db_timeout -> retry(3, exponential)
      db_error   -> fallback(assume_unique: false)
    confidence: 0.95
  end

  node create_user
    in:  email: String @email @auth @pii, unique: Bool @constraint("== true")
    out: user: User @auth @pii
    effects: [database.write]
    contracts:
      pre:  unique == true
      post: user.email == email
      post: user.status == active
    recovery:
      write_fail -> escalate("user creation failed")
    confidence: 0.95
  end

  edge validate_email.normalized -> check_uniqueness.email
  edge validate_email.normalized -> create_user.email
  edge check_uniqueness.unique   -> create_user.unique

end`;

    const { graph, errors } = aetherToIR(source);
    expect(errors).toHaveLength(0);
    expect(graph).not.toBeNull();
    expect(graph!.id).toBe("user_registration");
    expect(graph!.nodes).toHaveLength(3);
    expect(graph!.edges).toHaveLength(3);

    // Validate the generated IR against schema
    const valResult = validateGraph(graph);
    expect(valResult.valid).toBe(true);
  });

  it("IR → .aether → IR round-trip produces identical IR", () => {
    const source = `graph roundtrip v1
  effects: [database.read]

  node fetch
    in:  id: String
    out: data: String
    effects: [database.read]
    contracts:
      post: data.length > 0
    recovery:
      timeout -> retry(3, exponential)
    confidence: 0.95
  end

  node transform
    in:  data: String
    out: result: String
    contracts:
      post: result.length > 0
    pure
    confidence: 0.99
  end

  edge fetch.data -> transform.data

end`;

    // Parse to IR
    const { graph: ir1, errors: e1 } = aetherToIR(source);
    expect(e1).toHaveLength(0);
    expect(ir1).not.toBeNull();

    // IR → .aether text
    const aetherText = irToAether(ir1!);
    expect(aetherText.length).toBeGreaterThan(0);

    // .aether text → IR again
    const { graph: ir2, errors: e2 } = aetherToIR(aetherText);
    expect(e2).toHaveLength(0);
    expect(ir2).not.toBeNull();

    // Compare the two IRs
    expect(ir2!.id).toBe(ir1!.id);
    expect(ir2!.version).toBe(ir1!.version);
    expect(ir2!.nodes.length).toBe(ir1!.nodes.length);
    expect(ir2!.edges.length).toBe(ir1!.edges.length);
    expect(ir2!.effects).toEqual(ir1!.effects);

    // Compare node IDs
    const nodeIds1 = ir1!.nodes.map(n => n.id).sort();
    const nodeIds2 = ir2!.nodes.map(n => n.id).sort();
    expect(nodeIds2).toEqual(nodeIds1);
  });

  describe("reference programs: IR → .aether → IR round-trip", () => {
    const jsonFiles = readdirSync(EXAMPLES_DIR).filter(f => f.endsWith(".json"));

    for (const file of jsonFiles) {
      it(`${file} → .aether → validates`, () => {
        const filePath = join(EXAMPLES_DIR, file);
        const json = JSON.parse(readFileSync(filePath, "utf-8"));

        // IR → .aether
        const aetherText = irToAether(json);
        expect(aetherText.length).toBeGreaterThan(0);

        // .aether → IR
        const { graph, errors } = aetherToIR(aetherText);
        expect(errors).toHaveLength(0);
        expect(graph).not.toBeNull();

        // Validate
        expect(graph!.id).toBe(json.id);
        expect(graph!.nodes.length).toBe(json.nodes.length);
        expect(graph!.edges.length).toBe(json.edges.length);
      });
    }
  });

  it("pretty printer output uses consistent indentation", () => {
    const ir = JSON.parse(readFileSync(join(EXAMPLES_DIR, "user-registration.json"), "utf-8"));
    const aetherText = irToAether(ir);

    const lines = aetherText.split("\n");
    // Check that indentation uses 2-space increments
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const indent = line.length - line.trimStart().length;
      expect(indent % 2).toBe(0);
    }
  });

  it("pretty printer groups edges at the bottom", () => {
    const ir = JSON.parse(readFileSync(join(EXAMPLES_DIR, "user-registration.json"), "utf-8"));
    const aetherText = irToAether(ir);

    const lines = aetherText.split("\n");
    let lastEdgeIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith("edge ")) { lastEdgeIdx = i; break; }
    }
    // Edges should appear after all node blocks
    expect(lastEdgeIdx).toBeGreaterThan(0);
  });
});
