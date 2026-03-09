/**
 * Standard Template Library Tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { validateTemplate, instantiateTemplate } from "../../src/compiler/templates.js";
import type { AetherTemplate, AetherTemplateInstance } from "../../src/ir/validator.js";

const patternsDir = join(__dirname, "../../src/stdlib/patterns");

function loadTemplate(name: string): AetherTemplate {
  return JSON.parse(readFileSync(join(patternsDir, `${name}.template.json`), "utf-8"));
}

describe("Standard Template Library", () => {
  describe("all templates validate", () => {
    const templates = [
      "crud-entity",
      "retry-with-fallback",
      "auth-gate",
      "confidence-cascade",
    ];

    for (const name of templates) {
      it(`${name} validates as a valid template`, () => {
        const template = loadTemplate(name);
        const result = validateTemplate(template);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    }
  });

  describe("all templates can be instantiated", () => {
    it("crud-entity instantiates with reasonable bindings", () => {
      const template = loadTemplate("crud-entity");
      const instance: AetherTemplateInstance = {
        id: "user_crud",
        template: "crud-entity",
        bindings: {
          Entity: { type: "User" },
          IdType: { type: "UserID" },
          storage_effect: "database.write",
        },
      };
      const result = instantiateTemplate(template, instance);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.nodes.length).toBeGreaterThan(0);
    });

    it("retry-with-fallback instantiates with reasonable bindings", () => {
      const template = loadTemplate("retry-with-fallback");
      const instance: AetherTemplateInstance = {
        id: "api_retry",
        template: "retry-with-fallback",
        bindings: {
          T_in: { type: "APIRequest" },
          T_out: { type: "APIResponse" },
          max_retries: 3,
          primary_effect: "network.call",
          fallback_node: "cache_lookup",
        },
      };
      const result = instantiateTemplate(template, instance, new Set(["cache_lookup"]));
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.nodes.length).toBe(2);
    });

    it("auth-gate instantiates with reasonable bindings", () => {
      const template = loadTemplate("auth-gate");
      const instance: AetherTemplateInstance = {
        id: "main_auth",
        template: "auth-gate",
        bindings: {
          TokenType: { type: "JWT" },
          UserType: { type: "AuthenticatedUser" },
          auth_effect: "auth.verify",
        },
      };
      const result = instantiateTemplate(template, instance);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.nodes.length).toBe(3);
    });

    it("confidence-cascade instantiates with reasonable bindings", () => {
      const template = loadTemplate("confidence-cascade");
      const instance: AetherTemplateInstance = {
        id: "review_cascade",
        template: "confidence-cascade",
        bindings: {
          InputType: { type: "Document" },
          OutputType: { type: "ReviewResult" },
          threshold: 0.8,
        },
      };
      const result = instantiateTemplate(template, instance);
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.nodes.length).toBe(3);
    });
  });
});
