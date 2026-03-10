import { describe, it, expect } from "vitest";
import { generateDemo, EXAMPLES } from "../../src/demo/generate.js";

describe("Demo Generator", () => {
  const html = generateDemo();

  it("generates valid HTML string", () => {
    expect(typeof html).toBe("string");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("contains input text area", () => {
    expect(html).toContain('<textarea id="user-input"');
  });

  it('contains "Generate AETHER" button', () => {
    expect(html).toContain("Generate AETHER");
    expect(html).toContain('id="generate-btn"');
  });

  it("contains 4 example buttons", () => {
    for (const ex of EXAMPLES) {
      expect(html).toContain(ex.label);
    }
    expect(EXAMPLES).toHaveLength(4);
    // Each example produces an example-btn
    const matches = html.match(/class="example-btn"/g);
    expect(matches).toHaveLength(4);
  });

  it("contains validation display area", () => {
    expect(html).toContain('id="validation-results"');
  });

  it("contains visualization area", () => {
    expect(html).toContain('id="viz-area"');
  });

  it("contains execution simulation area", () => {
    expect(html).toContain('id="execution-results"');
  });

  it("contains verification area", () => {
    expect(html).toContain('id="verification-results"');
  });

  it("contains API key input", () => {
    expect(html).toContain('id="api-key"');
  });

  it("contains all 6 step sections", () => {
    for (let i = 1; i <= 6; i++) {
      expect(html).toContain(`id="step-${i}"`);
    }
  });

  it("embeds validation function in JS", () => {
    expect(html).toContain("function validateAetherIR");
  });

  it("embeds visualization function in JS", () => {
    expect(html).toContain("function renderVisualization");
  });

  it("embeds execution simulation function in JS", () => {
    expect(html).toContain("function simulateExecution");
  });

  it("is self-contained (no external script/link tags)", () => {
    expect(html).not.toMatch(/<script\s+src="/);
    expect(html).not.toMatch(/<link\s+rel="stylesheet"\s+href="/);
  });
});
