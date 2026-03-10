/**
 * AETHER Graph Editor — HTML Generator
 *
 * Generates a self-contained interactive HTML editor for creating
 * and modifying AETHER programs visually.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { AetherGraph } from "../ir/validator.js";
import { editorCSS, editorJS, editorHTML } from "./templates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadStdlibTemplates(): unknown[] {
  const patternsDir = join(__dirname, "..", "stdlib", "patterns");
  const templateFiles = [
    "crud-entity.template.json",
    "retry-with-fallback.template.json",
    "auth-gate.template.json",
    "confidence-cascade.template.json",
  ];
  const templates: unknown[] = [];
  for (const file of templateFiles) {
    try {
      const content = readFileSync(join(patternsDir, file), "utf-8");
      templates.push(JSON.parse(content));
    } catch {
      // Skip missing templates
    }
  }
  return templates;
}

/**
 * Generate a complete, self-contained HTML editor.
 * If a graph is provided, the editor opens with it pre-loaded.
 * If no graph, opens an empty editor.
 * Optionally provide a template to pre-instantiate.
 */
export function generateEditor(graph?: AetherGraph, options?: { template?: string }): string {
  const g: AetherGraph = graph || {
    id: "untitled",
    version: 1,
    effects: [],
    nodes: [],
    edges: [],
  };

  const title = g.id || "untitled";
  const graphJSON = JSON.stringify(g);
  const templates = loadStdlibTemplates();
  const templatesJSON = JSON.stringify(templates);
  const css = editorCSS();
  const js = editorJS(graphJSON, templatesJSON);

  return editorHTML(css, js, title);
}
