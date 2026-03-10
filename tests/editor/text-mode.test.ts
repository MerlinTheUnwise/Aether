import { describe, it, expect } from "vitest";
import { generateEditor } from "../../src/editor/generate.js";

describe("Editor Text Mode", () => {
  it("generates editor with text editor HTML elements", () => {
    const html = generateEditor();
    expect(html).toContain('id="text-editor"');
    expect(html).toContain('id="text-editor-container"');
    expect(html).toContain('id="text-line-numbers"');
    expect(html).toContain('id="text-highlight-overlay"');
    expect(html).toContain('id="text-error-bar"');
  });

  it("generates editor with view mode buttons", () => {
    const html = generateEditor();
    expect(html).toContain('id="view-visual"');
    expect(html).toContain('id="view-text"');
    expect(html).toContain('id="view-split"');
    expect(html).toContain("Visual");
    expect(html).toContain("Text");
    expect(html).toContain("Split");
  });

  it("includes syntax highlighting CSS classes", () => {
    const html = generateEditor();
    expect(html).toContain("hl-keyword");
    expect(html).toContain("hl-annotation");
    expect(html).toContain("hl-comment");
    expect(html).toContain("hl-string");
    expect(html).toContain("hl-number");
    expect(html).toContain("hl-arrow");
  });

  it("includes text editor JavaScript functions", () => {
    const html = generateEditor();
    expect(html).toContain("highlightAether");
    expect(html).toContain("syncVisualToText");
    expect(html).toContain("setViewMode");
    expect(html).toContain("graphToAether");
    expect(html).toContain("updateLineNumbers");
    expect(html).toContain("validateAetherText");
  });

  it("includes split-view CSS", () => {
    const html = generateEditor();
    expect(html).toContain("split-view");
    expect(html).toContain("JetBrains Mono");
  });

  it("visual mode is active by default", () => {
    const html = generateEditor();
    // The visual button should have the 'active' class
    expect(html).toContain('id="view-visual" class="tb-btn view-btn active"');
  });

  it("generates editor with a pre-loaded graph", () => {
    const graph = {
      id: "test_graph",
      version: 1,
      effects: ["database.read"],
      nodes: [
        {
          id: "node1",
          in: { data: { type: "String" } },
          out: { result: { type: "Bool" } },
          contract: { post: ["result == true"] },
          effects: [],
        },
      ],
      edges: [],
    };
    const html = generateEditor(graph as any);
    expect(html).toContain("test_graph");
  });
});
