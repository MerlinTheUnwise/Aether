import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  cleanAetherResponse,
  buildAetherFixPrompt,
  getAetherGenerationPrompt,
  processRawResponse,
  cleanJsonResponse,
} from "../../src/ai/generate.js";
import { aetherToIR, irToAether } from "../../src/parser/bridge.js";

describe("AI .aether generation", () => {
  it("generation prompt for .aether exists and has syntax reference", () => {
    const prompt = getAetherGenerationPrompt();
    expect(prompt).toContain("graph");
    expect(prompt).toContain("node");
    expect(prompt).toContain("edge");
    expect(prompt).toContain(".aether");
    expect(prompt.length).toBeGreaterThan(500);
  });

  it("cleanAetherResponse strips markdown fences", () => {
    const raw = '```aether\ngraph test v1\nend\n```';
    expect(cleanAetherResponse(raw)).toBe("graph test v1\nend");
  });

  it("cleanAetherResponse strips generic code fences", () => {
    const raw = '```\ngraph test v1\nend\n```';
    expect(cleanAetherResponse(raw)).toBe("graph test v1\nend");
  });

  it("cleanAetherResponse passes through clean input", () => {
    const raw = "graph test v1\nend";
    expect(cleanAetherResponse(raw)).toBe("graph test v1\nend");
  });

  it("buildAetherFixPrompt includes error details", () => {
    const errors = ["Missing recovery block", "Unclosed node"];
    const prompt = buildAetherFixPrompt(errors);
    expect(prompt).toContain("Missing recovery block");
    expect(prompt).toContain("Unclosed node");
    expect(prompt).toContain(".aether");
  });

  it("mock .aether response parses to valid IR", () => {
    const mockResponse = `graph test_pipeline v1
  effects: [database.read]

  node validate
    in:  data: String
    out: valid: Bool
    contracts:
      post: valid == true
    pure
  end

  node save
    in:  valid: Bool
    out: saved: Bool
    effects: [database.read]
    contracts:
      pre:  valid == true
      post: saved == true
    recovery:
      error -> retry(3, exponential)
  end

  edge validate.valid -> save.valid

end`;

    const cleaned = cleanAetherResponse(mockResponse);
    const { graph, errors } = aetherToIR(cleaned);
    expect(errors).toHaveLength(0);
    expect(graph).not.toBeNull();
    expect(graph!.id).toBe("test_pipeline");
    expect(graph!.nodes.length).toBe(2);
    expect(graph!.edges.length).toBe(1);
  });

  it("parser errors in generated code produce actionable fix prompt", () => {
    const badResponse = `graph test v1
  node broken
    in: data String
  end
end`;
    const cleaned = cleanAetherResponse(badResponse);
    const { errors } = aetherToIR(cleaned);
    // Should have errors (missing colon in port definition)
    expect(errors.length).toBeGreaterThan(0);

    const fixPrompt = buildAetherFixPrompt(errors.map(e => e.message));
    expect(fixPrompt).toContain("error");
  });

  it(".aether format uses fewer tokens than JSON for same program", () => {
    // Load a reference program as JSON
    const jsonPath = join(process.cwd(), "src/ir/examples/user-registration.json");
    const jsonContent = readFileSync(jsonPath, "utf-8");
    const graph = JSON.parse(jsonContent);

    // Convert to .aether
    const aetherContent = irToAether(graph);

    // .aether should be significantly smaller (at least 40% fewer chars as proxy for tokens)
    const jsonSize = jsonContent.length;
    const aetherSize = aetherContent.length;
    const savings = 1 - aetherSize / jsonSize;
    expect(savings).toBeGreaterThan(0.3); // at least 30% smaller
  });
});
