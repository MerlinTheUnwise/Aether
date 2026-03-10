import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generateEditor } from "../../src/editor/generate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const patternsDir = join(__dirname, "../../src/stdlib/patterns");

function loadTemplate(name: string): any {
  return JSON.parse(readFileSync(join(patternsDir, name), "utf-8"));
}

describe("Editor Template Palette", () => {
  describe("Template loading", () => {
    it("editor embeds all 4 stdlib templates", () => {
      const html = generateEditor();
      expect(html).toContain("crud-entity");
      expect(html).toContain("retry-with-fallback");
      expect(html).toContain("auth-gate");
      expect(html).toContain("confidence-cascade");
    });

    it("editor has template palette sidebar", () => {
      const html = generateEditor();
      expect(html).toContain('id="template-palette"');
      expect(html).toContain("Template Palette");
    });

    it("toolbar has Templates toggle button", () => {
      const html = generateEditor();
      expect(html).toContain("toggleTemplatePalette()");
      expect(html).toContain(">Templates<");
    });

    it("template palette has tpl-card elements", () => {
      const html = generateEditor();
      expect(html).toContain("tpl-card");
      expect(html).toContain("tpl-name");
      expect(html).toContain("tpl-desc");
      expect(html).toContain("tpl-params");
    });
  });

  describe("CRUD template instantiation", () => {
    it("CRUD template has 6 nodes", () => {
      const tpl = loadTemplate("crud-entity.template.json");
      expect(tpl.nodes).toHaveLength(6);
    });

    it("CRUD template has correct node IDs", () => {
      const tpl = loadTemplate("crud-entity.template.json");
      const ids = tpl.nodes.map((n: any) => n.id);
      expect(ids).toContain("validate_input");
      expect(ids).toContain("check_exists");
      expect(ids).toContain("create_entity");
      expect(ids).toContain("read_entity");
      expect(ids).toContain("update_entity");
      expect(ids).toContain("delete_entity");
    });

    it("CRUD template has 3 parameters", () => {
      const tpl = loadTemplate("crud-entity.template.json");
      expect(tpl.parameters).toHaveLength(3);
      expect(tpl.parameters.map((p: any) => p.name)).toEqual(["Entity", "IdType", "storage_effect"]);
    });
  });

  describe("Auth gate template instantiation", () => {
    it("auth-gate template has 3 nodes", () => {
      const tpl = loadTemplate("auth-gate.template.json");
      expect(tpl.nodes).toHaveLength(3);
    });

    it("auth-gate template has token/user/permissions pipeline", () => {
      const tpl = loadTemplate("auth-gate.template.json");
      const ids = tpl.nodes.map((n: any) => n.id);
      expect(ids).toEqual(["validate_token", "load_user", "check_permissions"]);
    });
  });

  describe("Instantiation logic", () => {
    it("editor embeds instantiateTemplate function", () => {
      const html = generateEditor();
      expect(html).toContain("function instantiateTemplate(tpl, instanceId, bindings)");
    });

    it("instantiated nodes get prefixed IDs", () => {
      const html = generateEditor();
      // newId = instanceId + '_' + tplNode.id
      expect(html).toContain("instanceId + '_' + tplNode.id");
    });

    it("instantiation substitutes $Param types", () => {
      const html = generateEditor();
      expect(html).toContain("v.type.startsWith('$')");
      expect(html).toContain("v.type.substring(1)");
    });

    it("instantiation substitutes $Param in effects", () => {
      const html = generateEditor();
      expect(html).toContain("eff.startsWith('$')");
    });

    it("instantiation remaps edge node IDs", () => {
      const html = generateEditor();
      expect(html).toContain("nodeIdMap[fromParts[0]]");
    });

    it("binding form validates required parameters", () => {
      const html = generateEditor();
      expect(html).toContain("Missing binding for");
    });

    it("binding form requires instance ID", () => {
      const html = generateEditor();
      expect(html).toContain("Instance ID is required");
    });
  });

  describe("Template palette rendering", () => {
    it("shows template description", () => {
      const html = generateEditor();
      expect(html).toContain("tpl.description");
    });

    it("shows node and edge counts", () => {
      const html = generateEditor();
      expect(html).toContain("nodes");
      expect(html).toContain("edges");
      expect(html).toContain("tpl-nodes");
    });

    it("shows parameter list with kind tags", () => {
      const html = generateEditor();
      expect(html).toContain("kind-tag");
      expect(html).toContain("param.kind");
    });
  });
});
