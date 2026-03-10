import { describe, it, expect } from "vitest";
import { generateEditor } from "../../src/editor/generate.js";

describe("Editor State Management", () => {
  const html = generateEditor();

  describe("Undo/Redo system", () => {
    it("editor embeds history object with past/present/future", () => {
      expect(html).toContain("const history = {");
      expect(html).toContain("past: []");
      expect(html).toContain("present: null");
      expect(html).toContain("future: []");
    });

    it("history has push, undo, redo methods", () => {
      expect(html).toContain("push(g)");
      expect(html).toContain("undo()");
      expect(html).toContain("redo()");
    });

    it("undo is bound to Ctrl+Z", () => {
      expect(html).toContain("history.undo()");
      expect(html).toMatch(/ctrlKey.*key === 'z'.*!ev.shiftKey/s);
    });

    it("redo is bound to Ctrl+Shift+Z", () => {
      expect(html).toContain("history.redo()");
      expect(html).toMatch(/ctrlKey.*key === 'z'.*ev.shiftKey/s);
    });

    it("history limit is 50 states max", () => {
      expect(html).toContain("HISTORY_LIMIT = 50");
      expect(html).toContain("if (this.past.length > HISTORY_LIMIT) this.past.shift()");
    });

    it("undo clears future on new push", () => {
      expect(html).toContain("this.future = []");
    });

    it("exposes history for testing", () => {
      expect(html).toContain("__AETHER_HISTORY__");
    });
  });

  describe("Dirty state tracking", () => {
    it("tracks dirty state with isDirty flag", () => {
      expect(html).toContain("let isDirty = false");
    });

    it("markDirty sets isDirty to true", () => {
      expect(html).toContain("function markDirty()");
      expect(html).toContain("isDirty = true");
    });

    it("markClean sets isDirty to false", () => {
      expect(html).toContain("function markClean()");
      expect(html).toContain("isDirty = false");
    });

    it("shows unsaved indicator in status bar", () => {
      expect(html).toContain("dirty-indicator");
      expect(html).toContain("Unsaved changes");
    });

    it("shows saved indicator when clean", () => {
      expect(html).toContain("clean-indicator");
      expect(html).toContain("Saved");
    });

    it("warns on browser close if dirty", () => {
      expect(html).toContain("beforeunload");
      expect(html).toContain("if (isDirty)");
    });

    it("recordChange pushes history and marks dirty", () => {
      expect(html).toContain("function recordChange()");
      expect(html).toContain("history.push(graph)");
      expect(html).toContain("markDirty()");
    });

    it("exposes dirty state for testing", () => {
      expect(html).toContain("__AETHER_IS_DIRTY__");
      expect(html).toContain("__AETHER_MARK_CLEAN__");
    });
  });
});
