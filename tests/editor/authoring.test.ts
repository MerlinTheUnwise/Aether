import { describe, it, expect } from "vitest";
import { generateEditor } from "../../src/editor/generate.js";
import type { AetherGraph } from "../../src/ir/validator.js";

describe("Editor Authoring Features", () => {
  const html = generateEditor();

  describe("Quick-add node presets", () => {
    it("has quick-add toolbar", () => {
      expect(html).toContain('id="quick-add-bar"');
    });

    it("quick-add pure node → pure: true, effects: []", () => {
      expect(html).toContain("quickAddPure");
      expect(html).toContain("pure: true, effects: [], confidence: 0.99");
    });

    it("quick-add DB read node → effects: ['database.read'], recovery pre-filled", () => {
      expect(html).toContain("quickAddDbRead");
      expect(html).toContain("effects: ['database.read']");
      expect(html).toContain("db_timeout");
      expect(html).toContain("db_error");
    });

    it("quick-add DB write node → effects: ['database.write'], recovery pre-filled", () => {
      expect(html).toContain("quickAddDbWrite");
      expect(html).toContain("effects: ['database.write']");
      expect(html).toContain("write_fail");
    });

    it("quick-add API call node → effects: ['network'], recovery pre-filled", () => {
      expect(html).toContain("quickAddApi");
      expect(html).toContain("effects: ['network']");
    });

    it("quick-add ML node → effects: ['ml_model.infer'], confidence: 0.80", () => {
      expect(html).toContain("quickAddMl");
      expect(html).toContain("effects: ['ml_model.infer']");
      expect(html).toContain("confidence: 0.80");
    });

    it("ML node preset includes adversarial checks", () => {
      expect(html).toContain("adversarial: ['output.confidence < 0', 'output.confidence > 1']");
    });
  });

  describe("Port type picker", () => {
    it("port dropdown includes String, Bool, Int, Float64", () => {
      expect(html).toContain("<option>String</option>");
      expect(html).toContain("<option>Bool</option>");
      expect(html).toContain("<option>Int</option>");
      expect(html).toContain("<option>Float64</option>");
    });

    it("port dropdown includes List<String>, List<Record>, Record", () => {
      expect(html).toContain("List&lt;String&gt;");
      expect(html).toContain("List&lt;Record&gt;");
      expect(html).toContain("<option>Record</option>");
    });
  });

  describe("Contract templates", () => {
    it("has contract template chips", () => {
      expect(html).toContain("contract-chips");
      expect(html).toContain("contract-chip");
    });

    it("offers non-empty output template", () => {
      expect(html).toContain("output.length > 0");
    });

    it("offers filter/clean template", () => {
      expect(html).toContain("output.length");
      expect(html).toContain("input.length");
    });

    it("offers sorted output template", () => {
      expect(html).toContain("output.is_sorted");
    });

    it("offers no duplicates template", () => {
      expect(html).toContain("output.distinct");
    });

    it("offers subset template", () => {
      expect(html).toContain("x \\u2208 output");
    });

    it("contract chip click appends expression to textarea", () => {
      expect(html).toContain("data-expr");
      expect(html).toContain("data-target");
    });
  });

  describe("Multi-select operations", () => {
    it("tracks multi-selected nodes with Set", () => {
      expect(html).toContain("let multiSelected = new Set()");
    });

    it("shift-click toggles node in multi-selection", () => {
      expect(html).toContain("ev.shiftKey");
      expect(html).toContain("multiSelected.has(node.id)");
      expect(html).toContain("multiSelected.add(node.id)");
      expect(html).toContain("multiSelected.delete(node.id)");
    });

    it("supports selection rectangle with shift-drag", () => {
      expect(html).toContain("isSelecting");
      expect(html).toContain("selection-rect");
      expect(html).toContain("selectionStart");
    });

    it("delete key removes all selected nodes", () => {
      expect(html).toContain("if (multiSelected.size > 0)");
      expect(html).toContain("for (const nid of multiSelected) deleteNode(nid)");
    });

    it("multi-selected nodes have visual indicator", () => {
      expect(html).toContain("multi-selected");
    });

    it("group drag moves all selected nodes", () => {
      expect(html).toContain("dragNode === '__group__'");
      expect(html).toContain("groupDragOffset");
    });

    it("context menu has align horizontally option", () => {
      expect(html).toContain("Align Horizontally");
      expect(html).toContain("align-h");
    });

    it("context menu has align vertically option", () => {
      expect(html).toContain("Align Vertically");
      expect(html).toContain("align-v");
    });

    it("context menu has create scope from selection", () => {
      expect(html).toContain("Create Scope from Selection");
      expect(html).toContain("action === 'scope'");
    });

    it("exposes multiSelected for testing", () => {
      expect(html).toContain("__AETHER_MULTI_SELECTED__");
    });
  });

  describe("Pre-loaded graph editing", () => {
    const graph: AetherGraph = {
      id: "edit-test",
      version: 1,
      effects: [],
      nodes: [
        {
          id: "step1",
          in: { x: { type: "Int" } },
          out: { y: { type: "Int" } },
          contract: {},
          effects: [],
          pure: true,
        },
      ],
      edges: [],
    };

    it("editor embeds provided graph data", () => {
      const html = generateEditor(graph as any);
      expect(html).toContain('"edit-test"');
      expect(html).toContain('"step1"');
    });

    it("editor sets title from graph ID", () => {
      const html = generateEditor(graph as any);
      expect(html).toContain("AETHER Editor");
      expect(html).toContain("edit-test");
    });
  });

  describe("CLI flags", () => {
    it("editor generates without errors for empty graph (--new mode)", () => {
      const html = generateEditor();
      expect(html).toBeTruthy();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html.length).toBeGreaterThan(1000);
    });

    it("editor embeds templates for --template discovery", () => {
      const html = generateEditor();
      expect(html).toContain("crud-entity");
      expect(html).toContain("__AETHER_TEMPLATES__");
    });
  });
});
