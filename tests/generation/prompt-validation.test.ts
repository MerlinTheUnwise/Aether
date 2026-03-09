/**
 * Generation Prompt Validation Tests
 * Ensures the generation prompt contains all required sections and matches the current schema.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const promptPath = join(__dirname, "../../prompts/generate-ir.md");
const schemaPath = join(__dirname, "../../src/ir/schema.json");

describe("Generation Prompt Validation", () => {
  let promptContent: string;

  it("prompt file exists and is readable", () => {
    promptContent = readFileSync(promptPath, "utf-8");
    expect(promptContent.length).toBeGreaterThan(0);
  });

  it("contains Section 1: Role and Format", () => {
    promptContent = readFileSync(promptPath, "utf-8");
    expect(promptContent).toContain("Section 1: Role and Format");
    expect(promptContent).toContain("You are an AETHER compiler");
    expect(promptContent).toContain("valid JSON");
  });

  it("contains Section 2: Schema Reference", () => {
    promptContent = readFileSync(promptPath, "utf-8");
    expect(promptContent).toContain("Section 2: Schema Reference");
    expect(promptContent).toContain("AetherGraph");
    expect(promptContent).toContain("AetherNode");
    expect(promptContent).toContain("AetherEdge");
  });

  it("contains Section 3: Generation Rules", () => {
    promptContent = readFileSync(promptPath, "utf-8");
    expect(promptContent).toContain("Section 3: Generation Rules");
    expect(promptContent).toContain("Node Construction Rules");
    expect(promptContent).toContain("Edge Construction Rules");
    expect(promptContent).toContain("Type Annotation Rules");
    expect(promptContent).toContain("Contract Expression Syntax");
    expect(promptContent).toContain("Recovery Action Types");
  });

  it("contains Section 4: Example Mappings", () => {
    promptContent = readFileSync(promptPath, "utf-8");
    expect(promptContent).toContain("Section 4: Example Mappings");
    expect(promptContent).toContain("Example 1");
    expect(promptContent).toContain("Example 2");
    expect(promptContent).toContain("Example 3");
  });

  it("contains Section 5: Self-Check", () => {
    promptContent = readFileSync(promptPath, "utf-8");
    expect(promptContent).toContain("Section 5: Self-Check");
    expect(promptContent).toContain("contract.post");
    expect(promptContent).toContain("adversarial_check");
    expect(promptContent).toContain("acyclic");
  });

  it("embedded schema matches current schema.json", () => {
    promptContent = readFileSync(promptPath, "utf-8");
    const schemaContent = readFileSync(schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);

    // Check that key schema elements are present in the prompt
    expect(promptContent).toContain(schema.$id);
    expect(promptContent).toContain(schema.title);

    // Check that all required top-level properties are referenced
    for (const prop of schema.required) {
      expect(promptContent).toContain(`"${prop}"`);
    }

    // Check that all definition names are present
    for (const defName of Object.keys(schema.definitions)) {
      expect(promptContent).toContain(defName);
    }
  });
});
