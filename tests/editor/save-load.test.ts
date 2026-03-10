import { describe, it, expect } from "vitest";
import { generateEditor } from "../../src/editor/generate.js";
import type { AetherGraph } from "../../src/ir/validator.js";

const testGraph: AetherGraph = {
  id: "test-save-load",
  version: 2,
  effects: ["database.read"],
  nodes: [
    {
      id: "node_a",
      in: { input: { type: "String" } },
      out: { output: { type: "String" } },
      contract: { pre: ["input.input != null"], post: ["output.output != null"] },
      effects: [],
      pure: true,
    },
    {
      id: "node_b",
      in: { data: { type: "String" } },
      out: { result: { type: "Int" } },
      contract: { post: ["output.result > 0"] },
      effects: ["database.read"],
      recovery: { db_error: { action: "retry", params: { max: 3, backoff: "exponential" } } },
    },
  ],
  edges: [{ from: "node_a.output", to: "node_b.data" }],
};

describe("Editor Save/Load", () => {
  describe("Save JSON", () => {
    it("save function creates Blob with application/json type", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("function saveGraph()");
      expect(html).toContain("JSON.stringify(graph, null, 2)");
      expect(html).toContain("application/json");
    });

    it("save uses graph.id as filename", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("(graph.id || 'untitled') + '.json'");
    });

    it("save marks clean after download", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("markClean()");
    });

    it("save is bound to Ctrl+S", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toMatch(/ctrlKey.*key === 's'/s);
      expect(html).toContain("saveGraph()");
    });

    it("save generates JSON matching current graph state", () => {
      const html = generateEditor(testGraph as any);
      // Graph is embedded as JSON in the editor
      expect(html).toContain('"test-save-load"');
      expect(html).toContain('"node_a"');
      expect(html).toContain('"node_b"');
    });
  });

  describe("Save Compact (.aether)", () => {
    it("has saveCompact function", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("function saveCompact()");
    });

    it("saveCompact creates text/plain Blob", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("text/plain");
    });

    it("saveCompact downloads as .aether", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("'.aether'");
    });

    it("graphToCompact emits graph header", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("function graphToCompact(g)");
      expect(html).toContain("'G:' + (g.id || 'untitled')");
    });

    it("graphToCompact emits nodes with N: prefix", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("'N:' + node.id");
    });

    it("graphToCompact emits edges with E: prefix", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("'E:' + e.from");
    });

    it("toolbar has Save .aether button", () => {
      const html = generateEditor(testGraph as any);
      expect(html).toContain("Save .aether");
      expect(html).toContain("saveCompactBtn()");
    });
  });

  describe("Load JSON", () => {
    it("has loadJSON function that parses and pushes history", () => {
      const html = generateEditor();
      expect(html).toContain("function loadJSON(text)");
      expect(html).toContain("graph = JSON.parse(text)");
      expect(html).toContain("history.push(graph)");
    });

    it("load is bound to Ctrl+O", () => {
      const html = generateEditor();
      expect(html).toMatch(/ctrlKey.*key === 'o'/s);
      expect(html).toContain("openFile()");
    });

    it("open file accepts .json and .aether", () => {
      const html = generateEditor();
      expect(html).toContain(".json,.aether");
    });
  });

  describe("Load Compact", () => {
    it("has loadCompact function for .aether files", () => {
      const html = generateEditor();
      expect(html).toContain("function loadCompact(text)");
    });

    it("loadCompact parses G: header for graph ID and version", () => {
      const html = generateEditor();
      expect(html).toContain("trimmed.startsWith('G:')");
    });

    it("loadCompact parses N: H: I: node prefixes", () => {
      const html = generateEditor();
      expect(html).toContain("([NIH]):");
    });

    it("loadCompact parses E: edges", () => {
      const html = generateEditor();
      expect(html).toContain("trimmed.startsWith('E:')");
    });

    it("loadCompact handles contracts, recovery, adversarial blocks", () => {
      const html = generateEditor();
      expect(html).toContain("trimmed.startsWith('C[')");
      expect(html).toContain("trimmed.startsWith('R[')");
      expect(html).toContain("trimmed.startsWith('A[')");
    });
  });

  describe("New Graph", () => {
    it("has newGraph function", () => {
      const html = generateEditor();
      expect(html).toContain("function newGraph()");
    });

    it("new graph creates valid empty structure", () => {
      const html = generateEditor();
      expect(html).toContain("{ id: id, version: version, effects: [], nodes: [], edges: [] }");
    });

    it("new is bound to Ctrl+N", () => {
      const html = generateEditor();
      expect(html).toMatch(/ctrlKey.*key === 'n'/s);
      expect(html).toContain("newGraph()");
    });

    it("new graph warns if dirty", () => {
      const html = generateEditor();
      // newGraph checks isDirty
      expect(html).toContain("isDirty && !confirm");
    });

    it("toolbar has New button", () => {
      const html = generateEditor();
      expect(html).toContain("newGraphBtn()");
    });
  });
});
