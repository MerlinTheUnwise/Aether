import { describe, it, expect } from "vitest";
import { generateEditor } from "../../src/editor/generate.js";
import type { AetherGraph } from "../../src/ir/validator.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, "../../src/ir/examples");

function loadExample(name: string): AetherGraph {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf-8"));
}

/**
 * Extract the embedded graph JSON from generated editor HTML.
 * The graph is embedded as the argument to `let graph = {...};` in the JS.
 */
function extractGraphFromHTML(html: string): AetherGraph {
  // The graph is embedded as: let graph = <JSON>;
  // Find it in the script section
  const marker = "let graph = ";
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error("Could not find graph data in HTML");

  const jsonStart = startIdx + marker.length;
  // Parse the JSON by tracking brace depth
  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIdx = jsonStart;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"' && !escaped) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) { endIdx = i + 1; break; }
    }
  }

  const jsonStr = html.substring(jsonStart, endIdx);
  return JSON.parse(jsonStr);
}

describe("Editor Round-Trip", () => {
  it("user-registration: load → extract → matches original", () => {
    const original = loadExample("user-registration.json");
    const html = generateEditor(original);
    const extracted = extractGraphFromHTML(html);

    expect(extracted.id).toBe(original.id);
    expect(extracted.version).toBe(original.version);
    expect(extracted.nodes.length).toBe(original.nodes.length);
    expect(extracted.edges.length).toBe(original.edges.length);

    // Verify each node ID present
    const originalIds = original.nodes.map(n => n.id).sort();
    const extractedIds = extracted.nodes.map(n => n.id).sort();
    expect(extractedIds).toEqual(originalIds);

    // Verify each edge present
    const originalEdges = original.edges.map(e => `${e.from}->${e.to}`).sort();
    const extractedEdges = extracted.edges.map(e => `${e.from}->${e.to}`).sort();
    expect(extractedEdges).toEqual(originalEdges);

    // Deep equality of the full graph
    expect(extracted).toEqual(original);
  });

  it("payment-processing: load → extract → matches original", () => {
    const original = loadExample("payment-processing.json");
    const html = generateEditor(original);
    const extracted = extractGraphFromHTML(html);

    expect(extracted.id).toBe(original.id);
    expect(extracted.nodes.length).toBe(original.nodes.length);
    expect(extracted.edges.length).toBe(original.edges.length);

    const originalIds = original.nodes.map(n => n.id).sort();
    const extractedIds = extracted.nodes.map(n => n.id).sort();
    expect(extractedIds).toEqual(originalIds);

    expect(extracted).toEqual(original);
  });

  it("order-lifecycle with state types: round-trip preserves state_types", () => {
    const original = loadExample("order-lifecycle.json");
    const html = generateEditor(original);
    const extracted = extractGraphFromHTML(html);

    expect(extracted.id).toBe(original.id);
    expect(extracted.state_types).toBeDefined();
    expect(extracted.state_types!.length).toBe(original.state_types!.length);
    expect(extracted).toEqual(original);
  });

  it("empty graph round-trips correctly", () => {
    const html = generateEditor();
    const extracted = extractGraphFromHTML(html);

    expect(extracted.id).toBe("untitled");
    expect(extracted.nodes).toEqual([]);
    expect(extracted.edges).toEqual([]);
  });
});
