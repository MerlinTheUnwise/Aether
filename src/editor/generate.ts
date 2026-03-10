/**
 * AETHER Graph Editor — HTML Generator
 *
 * Generates a self-contained interactive HTML editor for creating
 * and modifying AETHER programs visually.
 */

import type { AetherGraph } from "../ir/validator.js";
import { editorCSS, editorJS, editorHTML } from "./templates.js";

/**
 * Generate a complete, self-contained HTML editor.
 * If a graph is provided, the editor opens with it pre-loaded.
 * If no graph, opens an empty editor.
 */
export function generateEditor(graph?: AetherGraph): string {
  const g: AetherGraph = graph || {
    id: "untitled",
    version: 1,
    effects: [],
    nodes: [],
    edges: [],
  };

  const title = g.id || "untitled";
  const graphJSON = JSON.stringify(g);
  const css = editorCSS();
  const js = editorJS(graphJSON);

  return editorHTML(css, js, title);
}
