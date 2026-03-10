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

describe("Editor Generate", () => {
  it("empty editor → valid HTML with SVG canvas", () => {
    const html = generateEditor();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<svg");
    expect(html).toContain('id="canvas"');
    expect(html).toContain("AETHER Editor");
  });

  it("empty editor contains Add Node button", () => {
    const html = generateEditor();
    expect(html).toContain("Add Node");
    expect(html).toContain("addNode()");
  });

  it("empty editor contains export/import functionality", () => {
    const html = generateEditor();
    expect(html).toContain("exportGraph");
    expect(html).toContain("importGraph");
    expect(html).toContain("Import");
    expect(html).toContain("Export");
  });

  it("empty editor contains validation error panel", () => {
    const html = generateEditor();
    expect(html).toContain('id="error-panel"');
    expect(html).toContain("validate");
  });

  it("user-registration → HTML contains all 3 node IDs", () => {
    const graph = loadExample("user-registration.json");
    const html = generateEditor(graph);
    expect(html).toContain("validate_email");
    expect(html).toContain("check_uniqueness");
    expect(html).toContain("create_user");
  });

  it("payment-processing → HTML contains all 4 node IDs", () => {
    const graph = loadExample("payment-processing.json");
    const html = generateEditor(graph);
    expect(html).toContain("validate_payment");
    expect(html).toContain("authorize_card");
    expect(html).toContain("capture_funds");
    expect(html).toContain("send_receipt");
  });

  it("HTML contains Copy JSON button", () => {
    const html = generateEditor();
    expect(html).toContain("Copy JSON");
    expect(html).toContain("copyJSON");
  });

  it("HTML contains auto-layout button", () => {
    const html = generateEditor();
    expect(html).toContain("Auto Layout");
    expect(html).toContain("autoLayoutBtn");
  });

  it("HTML contains minimap", () => {
    const html = generateEditor();
    expect(html).toContain('id="minimap"');
  });

  it("HTML contains status bar", () => {
    const html = generateEditor();
    expect(html).toContain('id="status-bar"');
    expect(html).toContain("stat-nodes");
    expect(html).toContain("stat-edges");
  });

  it("HTML contains dark theme colors", () => {
    const html = generateEditor();
    expect(html).toContain("#0a0f1a");
    expect(html).toContain("#6ee7b7");
  });

  it("HTML is self-contained (inline CSS and JS)", () => {
    const html = generateEditor();
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    // No external CSS/JS links except possibly CDN
    expect(html).not.toContain('rel="stylesheet"');
  });

  it("generated HTML includes graph data for round-trip", () => {
    const graph = loadExample("user-registration.json");
    const html = generateEditor(graph);
    expect(html).toContain("__AETHER_GRAPH__");
    expect(html).toContain("__AETHER_GET_GRAPH__");
  });

  it("HTML under 3000 lines", () => {
    const graph = loadExample("payment-processing.json");
    const html = generateEditor(graph);
    const lineCount = html.split("\n").length;
    expect(lineCount).toBeLessThan(3000);
  });
});
